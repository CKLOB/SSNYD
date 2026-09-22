import {
  EmbedBuilder,
  Message,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import https from "https";
import {
  kstNow,
  toNeisDateStr,
  fetchWithRetry,
  getFallbackMeal,
  NEIS_KEY,
  ATPT_CODE,
  SCHOOL_CODE,
} from "../utils.js";
import { getMealEnabled, setMealEnabled } from "../db.js";
import { Ctx, ctxFromMessage, ctxFromInteraction } from "../ctx.js";

const MEAL_CMDS = new Set([
  "!밥",
  "!ㅂ",
  "!q",
  "!급식",
  "!ㄱㅅ",
  "!ㄳ",
  "!rt",
  "!오늘아침",
  "!아침",
  "!오늘점심",
  "!점심",
  "!오늘저녁",
  "!저녁",
  "!내일아침",
  "!내일점심",
  "!내일저녁",
]);

const MEAL_LABELS: Record<number, string> = { 1: "조식", 2: "중식", 3: "석식" };

const CACHE_TTL = 30 * 60 * 1000;
const mealCache = new Map<string, { data: MealResult; cachedAt: number }>();

interface MealTime {
  type: number;
  dateStr: string;
  dayLabel: string;
}

function getMealByTime(): MealTime {
  const kst = kstNow();
  const t = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const todayStr = toNeisDateStr(kst);
  const tomorrowStr = toNeisDateStr(new Date(kst.getTime() + 24 * 60 * 60 * 1000));

  if (t < 7 * 60 + 40) return { type: 1, dateStr: todayStr, dayLabel: "오늘" };
  if (t < 12 * 60 + 40) return { type: 2, dateStr: todayStr, dayLabel: "오늘" };
  if (t < 18 * 60 + 40) return { type: 3, dateStr: todayStr, dayLabel: "오늘" };
  return { type: 1, dateStr: tomorrowStr, dayLabel: "내일" };
}

interface MealResult {
  menu: string;
  cal: string;
}

function fetchMeal(dateStr: string, mealType: number): Promise<MealResult | null> {
  const url =
    `https://open.neis.go.kr/hub/mealServiceDietInfo` +
    `?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=10` +
    `&ATPT_OFCDC_SC_CODE=${ATPT_CODE}` +
    `&SD_SCHUL_CODE=${SCHOOL_CODE}` +
    `&MLSV_YMD=${dateStr}` +
    `&MMEAL_SC_CODE=${mealType}`;

  console.log(`[NEIS] 급식 요청 — ${dateStr} type=${mealType}`);
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      console.log(`[NEIS] 급식 응답 — status=${res.statusCode}`);
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.setEncoding("utf8");
      let raw = "";
      res.on("data", (chunk: string) => (raw += chunk));
      res.on("end", () => {
        console.log(`[NEIS] 급식 raw (${raw.length}B) — ${raw.slice(0, 200)}`);
        try {
          const json = JSON.parse(raw);
          if (!json.mealServiceDietInfo) {
            resolve(null);
            return;
          }
          const row = json.mealServiceDietInfo[1].row[0];
          const menu = row.DDISH_NM.replace(/\*/g, "")
            .split(/<br\/>/i)
            .map((item: string) => item.trim())
            .filter((item: string) => item)
            .map((item: string) => `- ${item}`)
            .join("\n");
          resolve({ menu, cal: row.CAL_INFO || "" });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(4000, () => req.destroy(new Error("NEIS API 요청 시간 초과")));
    req.on("error", reject);
  });
}

async function warmMealCacheForToday(): Promise<void> {
  const dateStr = toNeisDateStr(kstNow());
  for (const mealType of [1, 2, 3]) {
    try {
      const result = await fetchWithRetry(() => fetchMeal(dateStr, mealType));
      if (result) mealCache.set(`${dateStr}_${mealType}`, { data: result, cachedAt: Date.now() });
    } catch (err) {
      console.warn(`[NEIS] 급식 캐시 예열 실패 (type=${mealType}): ${(err as Error).message}`);
    }
  }
}

export function initMealCacheWarmer(): void {
  let lastFiredMinute = -1;
  setInterval(() => {
    const kst = kstNow();
    const minuteKey = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    if (minuteKey === lastFiredMinute) return;
    if (kst.getUTCMinutes() % 30 === 0) {
      lastFiredMinute = minuteKey;
      warmMealCacheForToday().catch((err) =>
        console.error("[NEIS] 급식 캐시 예열 실패:", (err as Error).message),
      );
    }
  }, 30 * 1000);
}

async function executeMeal(
  ctx: Ctx,
  mealType: number,
  dateStr: string,
  dayLabel: string,
): Promise<void> {
  try {
    const cacheKey = `${dateStr}_${mealType}`;
    const cached = mealCache.get(cacheKey);

    let result: MealResult | null = null;
    let isFallback = false;
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      result = cached.data;
    } else {
      try {
        result = await fetchWithRetry(() => fetchMeal(dateStr, mealType));
        if (result) mealCache.set(cacheKey, { data: result, cachedAt: Date.now() });
      } catch (err) {
        console.warn(
          `[NEIS] 급식 API 호출 실패, fallback 데이터 사용을 시도합니다: ${(err as Error).message}`,
        );
      }
    }
    if (!result) {
      const fb = getFallbackMeal(dateStr, mealType);
      if (fb) {
        result = fb;
        isFallback = true;
      }
    }
    if (result) {
      const month = parseInt(dateStr.slice(4, 6));
      const day = parseInt(dateStr.slice(6, 8));
      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`🍽️ ${month}월 ${day}일 ${MEAL_LABELS[mealType]}`)
        .setDescription(result.menu)
        .setFooter({ text: isFallback ? `${result.cal} · ⚠️ 수동 등록된 임시 정보` : result.cal });
      ctx.reply({ embeds: [embed] });
    } else {
      ctx.reply(`😢 ${dayLabel} ${MEAL_LABELS[mealType]} 급식 정보가 없습니다.`);
    }
  } catch (err) {
    console.error(`[NEIS] 급식 최종 실패 —`, err);
    const error = err as Error;
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ 급식 정보 오류")
      .addFields(
        { name: "오류 유형", value: error.name || "Error", inline: true },
        { name: "재시도", value: "2회 재시도 후 실패", inline: true },
        { name: "메시지", value: error.message || "알 수 없는 오류", inline: false },
      )
      .setTimestamp();
    ctx.reply({ embeds: [embed] });
  }
}

async function handleMealToggle(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("❌ 이 명령어는 서버에서만 사용할 수 있습니다.");
    return;
  }
  if (!message.member!.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("❌ 서버 관리자 권한이 필요합니다.");
    return;
  }
  const enable = args[0]?.toLowerCase() === "on";
  await setMealEnabled(message.guild.id, enable);
  await message.reply(
    enable ? "✅ 급식 기능이 **활성화**되었습니다." : "🔒 급식 기능이 **비활성화**되었습니다.",
  );
}

export async function handleMeal(message: Message): Promise<boolean> {
  const content = message.content.trim();
  const parts = content.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  if (cmd === "!밥" && ["on", "off"].includes(args[0]?.toLowerCase() ?? "")) {
    await handleMealToggle(message, args);
    return true;
  }

  if (!MEAL_CMDS.has(cmd)) return false;

  if (message.guild && !(await getMealEnabled(message.guild.id))) {
    return true;
  }

  const kst = kstNow();
  const todayStr = toNeisDateStr(kst);
  const tomorrowStr = toNeisDateStr(new Date(kst.getTime() + 24 * 60 * 60 * 1000));

  let mealType: number, dayLabel: string, dateStr: string;

  if (["!밥", "!ㅂ", "!q", "!급식", "!ㄱㅅ", "!ㄳ", "!rt"].includes(cmd)) {
    ({ type: mealType, dayLabel, dateStr } = getMealByTime());
  } else if (["!오늘아침", "!아침"].includes(cmd)) {
    mealType = 1;
    dayLabel = "오늘";
    dateStr = todayStr;
  } else if (["!오늘점심", "!점심"].includes(cmd)) {
    mealType = 2;
    dayLabel = "오늘";
    dateStr = todayStr;
  } else if (["!오늘저녁", "!저녁"].includes(cmd)) {
    mealType = 3;
    dayLabel = "오늘";
    dateStr = todayStr;
  } else if (cmd === "!내일아침") {
    mealType = 1;
    dayLabel = "내일";
    dateStr = tomorrowStr;
  } else if (cmd === "!내일점심") {
    mealType = 2;
    dayLabel = "내일";
    dateStr = tomorrowStr;
  } else {
    mealType = 3;
    dayLabel = "내일";
    dateStr = tomorrowStr;
  }

  await executeMeal(ctxFromMessage(message), mealType, dateStr, dayLabel);
  return true;
}

export async function handleMealSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.guildId && !(await getMealEnabled(interaction.guildId))) {
    await interaction.reply({
      content: "🔒 현재 서버에서 급식 기능이 비활성화되어 있습니다.",
      ephemeral: true,
    });
    return;
  }

  const commandName = interaction.commandName;
  const kst = kstNow();
  const todayStr = toNeisDateStr(kst);
  const tomorrowStr = toNeisDateStr(new Date(kst.getTime() + 24 * 60 * 60 * 1000));

  let mealType: number, dayLabel: string, dateStr: string;

  if (commandName === "밥") {
    ({ type: mealType, dayLabel, dateStr } = getMealByTime());
  } else {
    // commandName === "급식"
    const 끼니 = interaction.options.getString("끼니", true);
    const 날짜 = interaction.options.getString("날짜") ?? "오늘";
    const mealMap: Record<string, number> = { 아침: 1, 점심: 2, 저녁: 3 };
    mealType = mealMap[끼니];
    dayLabel = 날짜;
    dateStr = 날짜 === "내일" ? tomorrowStr : todayStr;
  }

  await executeMeal(ctxFromInteraction(interaction), mealType, dateStr, dayLabel);
}
