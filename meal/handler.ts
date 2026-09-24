import { EmbedBuilder, Message, ChatInputCommandInteraction } from "discord.js";
import {
  kstNow,
  toNeisDateStr,
  fetchWithRetry,
  fetchNeis,
  onEveryKstMinute,
  getFallbackMeal,
} from "../utils.js";
import { getMealEnabled, setMealEnabled } from "../db.js";
import { Ctx, ctxFromMessage, ctxFromInteraction, handleAdminToggle } from "../ctx.js";
import { TtlCache } from "../cache.js";

type MealDay = "auto" | "today" | "tomorrow";

// 텍스트 명령 → (끼니, 날짜). "auto"는 지금 시각 기준 다음 끼니.
const MEAL_CMDS: Record<string, { type: number; day: MealDay }> = {
  "!밥": { type: 0, day: "auto" },
  "!ㅂ": { type: 0, day: "auto" },
  "!q": { type: 0, day: "auto" },
  "!급식": { type: 0, day: "auto" },
  "!ㄱㅅ": { type: 0, day: "auto" },
  "!ㄳ": { type: 0, day: "auto" },
  "!rt": { type: 0, day: "auto" },
  "!오늘아침": { type: 1, day: "today" },
  "!아침": { type: 1, day: "today" },
  "!오늘점심": { type: 2, day: "today" },
  "!점심": { type: 2, day: "today" },
  "!오늘저녁": { type: 3, day: "today" },
  "!저녁": { type: 3, day: "today" },
  "!내일아침": { type: 1, day: "tomorrow" },
  "!내일점심": { type: 2, day: "tomorrow" },
  "!내일저녁": { type: 3, day: "tomorrow" },
};

const MEAL_LABELS: Record<number, string> = { 1: "조식", 2: "중식", 3: "석식" };
const DAY_MS = 24 * 60 * 60 * 1000;

// 예열이 30분마다 돌기 때문에 TTL을 그보다 약간 길게 둬서 예열 사이에 캐시가 비는 구간을 없앤다.
// "급식 없음"(주말/방학)도 짧게 캐시해서 매번 NEIS를 다시 부르지 않게 한다.
const MEAL_TTL_MS = 40 * 60 * 1000;
const NO_MEAL_TTL_MS = 10 * 60 * 1000;
const mealTtl = (r: MealResult | null) => (r ? MEAL_TTL_MS : NO_MEAL_TTL_MS);

interface MealResult {
  menu: string;
  cal: string;
}

const mealCache = new TtlCache<MealResult | null>(100);

interface MealTarget {
  type: number;
  dateStr: string;
  dayLabel: string;
}

function resolveMeal(type: number, day: MealDay): MealTarget {
  const kst = kstNow();
  const todayStr = toNeisDateStr(kst);
  const tomorrowStr = toNeisDateStr(new Date(kst.getTime() + DAY_MS));

  if (day === "today") return { type, dateStr: todayStr, dayLabel: "오늘" };
  if (day === "tomorrow") return { type, dateStr: tomorrowStr, dayLabel: "내일" };

  const t = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (t < 7 * 60 + 40) return { type: 1, dateStr: todayStr, dayLabel: "오늘" };
  if (t < 12 * 60 + 40) return { type: 2, dateStr: todayStr, dayLabel: "오늘" };
  if (t < 18 * 60 + 40) return { type: 3, dateStr: todayStr, dayLabel: "오늘" };
  return { type: 1, dateStr: tomorrowStr, dayLabel: "내일" };
}

async function fetchMeal(dateStr: string, mealType: number): Promise<MealResult | null> {
  const json = await fetchNeis("mealServiceDietInfo", {
    pIndex: 1,
    pSize: 10,
    MLSV_YMD: dateStr,
    MMEAL_SC_CODE: mealType,
  });
  const row = json.mealServiceDietInfo?.[1]?.row?.[0];
  if (!row) return null;
  const menu = String(row.DDISH_NM)
    .replace(/\*/g, "")
    .split(/<br\/>/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");
  return { menu, cal: row.CAL_INFO || "" };
}

function loadMeal(dateStr: string, mealType: number, force = false): Promise<MealResult | null> {
  const key = `${dateStr}_${mealType}`;
  const loader = () => fetchWithRetry(() => fetchMeal(dateStr, mealType));
  return force ? mealCache.load(key, loader, mealTtl) : mealCache.getOrLoad(key, loader, mealTtl);
}

// 오늘 + 내일 급식을 미리 받아둔다 (저녁 이후 !밥은 내일 아침을 보여주므로 내일 것도 필요)
async function warmMealCache(): Promise<void> {
  const kst = kstNow();
  const dates = [toNeisDateStr(kst), toNeisDateStr(new Date(kst.getTime() + DAY_MS))];
  const jobs = dates.flatMap((dateStr) => [1, 2, 3].map((type) => ({ dateStr, type })));
  const results = await Promise.allSettled(jobs.map((j) => loadMeal(j.dateStr, j.type, true)));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const { dateStr, type } = jobs[i];
      console.warn(`[NEIS] 급식 캐시 예열 실패 (${dateStr} type=${type}): ${r.reason?.message}`);
    }
  });
}

export function initMealCacheWarmer(): void {
  warmMealCache().catch(() => {});
  onEveryKstMinute((kst) => {
    if (kst.getUTCMinutes() % 30 === 0) return warmMealCache();
  });
}

function errorEmbed(error: Error): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle("❌ 급식 정보 오류")
    .addFields(
      { name: "오류 유형", value: error.name || "Error", inline: true },
      { name: "재시도", value: "2회 재시도 후 실패", inline: true },
      { name: "메시지", value: error.message || "알 수 없는 오류", inline: false },
    )
    .setTimestamp();
}

async function executeMeal(ctx: Ctx, { type, dateStr, dayLabel }: MealTarget): Promise<void> {
  const key = `${dateStr}_${type}`;
  let result = mealCache.get(key);
  let apiError: Error | null = null;

  if (result === undefined) {
    await ctx.defer();
    try {
      result = await loadMeal(dateStr, type);
    } catch (err) {
      apiError = err as Error;
      result = null;
      console.warn(
        `[NEIS] 급식 API 호출 실패, fallback 데이터 사용을 시도합니다: ${apiError.message}`,
      );
    }
  }

  let isFallback = false;
  if (!result) {
    const fb = getFallbackMeal(dateStr, type);
    if (fb) {
      result = fb;
      isFallback = true;
    }
  }

  if (!result) {
    // API 자체가 실패했는데 "급식 없음"이라고 하면 헷갈리므로 오류를 그대로 보여준다
    await ctx.reply(
      apiError
        ? { embeds: [errorEmbed(apiError)] }
        : `😢 ${dayLabel} ${MEAL_LABELS[type]} 급식 정보가 없습니다.`,
    );
    return;
  }

  const month = parseInt(dateStr.slice(4, 6));
  const day = parseInt(dateStr.slice(6, 8));
  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(`🍽️ ${month}월 ${day}일 ${MEAL_LABELS[type]}`)
    .setDescription(result.menu)
    .setFooter({ text: isFallback ? `${result.cal} · ⚠️ 수동 등록된 임시 정보` : result.cal });
  await ctx.reply({ embeds: [embed] });
}

export async function handleMeal(message: Message): Promise<boolean> {
  const [cmd, arg] = message.content.trim().split(/\s+/);
  const setting = arg?.toLowerCase();

  if (cmd === "!밥" && (setting === "on" || setting === "off")) {
    await handleAdminToggle(ctxFromMessage(message), setting === "on", "급식", setMealEnabled);
    return true;
  }

  const spec = MEAL_CMDS[cmd];
  if (!spec) return false;

  // 급식 기능이 꺼진 서버에서는 아예 반응하지 않는다
  if (message.guild && !(await getMealEnabled(message.guild.id))) return true;

  await executeMeal(ctxFromMessage(message), resolveMeal(spec.type, spec.day));
  return true;
}

export async function handleMealSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const ctx = ctxFromInteraction(interaction);

  // /밥 설정:on|off — 관리자가 아니면 본인에게만 보이는 에러로 응답한다
  const setting = interaction.commandName === "밥" ? interaction.options.getString("설정") : null;
  if (setting === "on" || setting === "off") {
    await handleAdminToggle(ctx, setting === "on", "급식", setMealEnabled);
    return;
  }

  if (interaction.guildId && !(await getMealEnabled(interaction.guildId))) {
    await ctx.replyPrivate("🔒 현재 서버에서 급식 기능이 비활성화되어 있습니다.");
    return;
  }

  if (interaction.commandName === "밥") {
    await executeMeal(ctx, resolveMeal(0, "auto"));
    return;
  }

  // commandName === "급식"
  const mealMap: Record<string, number> = { 아침: 1, 점심: 2, 저녁: 3 };
  const type = mealMap[interaction.options.getString("끼니", true)];
  const day = interaction.options.getString("날짜") === "내일" ? "tomorrow" : "today";
  await executeMeal(ctx, resolveMeal(type, day));
}
