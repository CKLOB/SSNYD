import { EmbedBuilder, Message, ChatInputCommandInteraction, GuildMember } from "discord.js";
import { kstNow, toNeisDateStr, fetchWithRetry, fetchNeis } from "../utils.js";
import { Ctx, ctxFromMessage, ctxFromInteraction } from "../ctx.js";
import { TtlCache } from "../cache.js";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const CLASS_COLORS = [0x3b82f6, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xef4444, 0xec4899];

// 시간표는 하루 중에 거의 바뀌지 않는다. 방학/주말처럼 데이터가 없는 경우도 짧게 캐시한다.
const TIMETABLE_TTL_MS = 30 * 60 * 1000;
const NO_TIMETABLE_TTL_MS = 10 * 60 * 1000;
const timetableCache = new TtlCache<TimetableRow[] | null>(300);

interface ClassInfo {
  grade: number;
  classNum: number;
}

interface TimetableRow {
  period: number;
  subject: string;
}

// "3반" → 2학년 3반, "2-1" → 2학년 1반
function getClassFromRoles(member: GuildMember): ClassInfo | null {
  for (const role of member.roles.cache.values()) {
    const simpleMatch = role.name.match(/^(\d+)반$/);
    if (simpleMatch) return { grade: 2, classNum: parseInt(simpleMatch[1]) };

    const fullMatch = role.name.match(/^(\d+)-(\d+)$/);
    if (fullMatch) return { grade: parseInt(fullMatch[1]), classNum: parseInt(fullMatch[2]) };
  }
  return null;
}

function getTargetDate(): Date {
  const kst = kstNow();
  const t = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  let target = new Date(kst);
  if (t >= 16 * 60 + 40) target = new Date(target.getTime() + 24 * 60 * 60 * 1000);

  while (target.getUTCDay() === 0 || target.getUTCDay() === 6)
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);

  return target;
}

async function fetchTimetable(
  dateStr: string,
  grade: number,
  classNum: number,
): Promise<TimetableRow[] | null> {
  const json = await fetchNeis("hisTimetable", {
    pIndex: 1,
    pSize: 100,
    ALL_TI_YMD: dateStr,
    GRADE: grade,
    CLASS_NM: classNum,
  });
  const rows: any[] | undefined = json.hisTimetable?.[1]?.row;
  if (!rows) return null;

  // NEIS가 같은 교시를 중복으로 주는 경우가 있어서 저장 전에 한 번 정리해 둔다
  const seen = new Set<string>();
  return rows
    .map((r) => ({ period: parseInt(r.PERIO), subject: String(r.ITRT_CNTNT).trim() }))
    .sort((a, b) => a.period - b.period)
    .filter((r) => {
      const key = `${r.period}:${r.subject}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function executeTimetable(ctx: Ctx, grade: number, classNum: number): Promise<void> {
  const target = getTargetDate();
  const dateStr = toNeisDateStr(target);
  const dayName = DAY_NAMES[target.getUTCDay()];
  const month = target.getUTCMonth() + 1;
  const day = target.getUTCDate();

  try {
    const cacheKey = `${dateStr}:${grade}:${classNum}`;
    let rows = timetableCache.get(cacheKey);
    if (rows === undefined) {
      await ctx.defer();
      rows = await timetableCache.getOrLoad(
        cacheKey,
        () => fetchWithRetry(() => fetchTimetable(dateStr, grade, classNum)),
        (r) => (r && r.length > 0 ? TIMETABLE_TTL_MS : NO_TIMETABLE_TTL_MS),
      );
    }
    if (!rows || rows.length === 0) {
      ctx.reply(`😢 ${month}월 ${day}일(${dayName}) 시간표 정보가 없습니다.`);
      return;
    }

    const lines = rows.map((r) => `**${r.period}교시**  -  ${r.subject}`);
    const color = CLASS_COLORS[(classNum - 1) % CLASS_COLORS.length];

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`📚 ${grade} - ${classNum} 시간표`)
      .setDescription(`📅 **${month}월 ${day}일 (${dayName}요일)**\n\n${lines.join("\n")}`);

    ctx.reply({ embeds: [embed] });
  } catch (err) {
    console.error(`[NEIS] 시간표 최종 실패 —`, err);
    const error = err as Error;
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ 시간표 정보 오류")
      .addFields(
        { name: "오류 유형", value: error.name || "Error", inline: true },
        { name: "재시도", value: "2회 재시도 후 실패", inline: true },
        { name: "메시지", value: error.message || "알 수 없는 오류", inline: false },
      )
      .setTimestamp();
    ctx.reply({ embeds: [embed] });
  }
}

const CLASS_INPUT_ERROR = "❌ 학년은 1~3, 반은 1 이상의 숫자로 입력해줘! (예: `2-3`)";
const NO_ROLE_ERROR = "❌ 반 역할이 없습니다. (예: `1반`, `2-1`) 관리자에게 문의하세요.";

function isValidClass(grade: number, classNum: number): boolean {
  return grade >= 1 && grade <= 3 && classNum >= 1;
}

export async function handleTimetable(message: Message): Promise<boolean> {
  const match = message.content.trim().match(/^!(?:시간표|ㅅㄱㅍ)\s*(?:(\d)-(\d+))?$/);
  if (!match) return false;

  let info: ClassInfo | null;
  if (match[1] && match[2]) {
    info = { grade: parseInt(match[1]), classNum: parseInt(match[2]) };
    if (!isValidClass(info.grade, info.classNum)) {
      message.reply("❌ 학년은 1~3, 반은 1 이상의 숫자로 입력해줘! (예: `!시간표 2-3`)");
      return true;
    }
  } else {
    info = message.member ? getClassFromRoles(message.member) : null;
    if (!info) {
      message.reply(NO_ROLE_ERROR);
      return true;
    }
  }

  await executeTimetable(ctxFromMessage(message), info.grade, info.classNum);
  return true;
}

export async function handleTimetableSlash(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const input = interaction.options.getString("학년반");

  let info: ClassInfo | null;
  if (input) {
    const match = input.match(/^(\d)-(\d+)$/);
    if (!match) {
      await interaction.reply("❌ 올바른 형식으로 입력해줘! (예: `2-3`)");
      return;
    }
    info = { grade: parseInt(match[1]), classNum: parseInt(match[2]) };
    if (!isValidClass(info.grade, info.classNum)) {
      await interaction.reply(CLASS_INPUT_ERROR);
      return;
    }
  } else {
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    if (!member) {
      await interaction.reply(
        "❌ 반 역할 정보를 가져올 수 없습니다. 직접 학년-반을 입력해주세요. (예: `2-3`)",
      );
      return;
    }
    info = getClassFromRoles(member);
    if (!info) {
      await interaction.reply(NO_ROLE_ERROR);
      return;
    }
  }

  await executeTimetable(ctxFromInteraction(interaction), info.grade, info.classNum);
}
