import https from "https";
import { EmbedBuilder, Message } from "discord.js";
import { kstNow, NEIS_KEY, ATPT_CODE, SCHOOL_CODE, fetchWithRetry } from "../utils.js";

interface ScheduleRow {
  AA_YMD: string;
  EVENT_NM: string;
}

function fetchAcademicSchedule(year: number, month: number): Promise<ScheduleRow[]> {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const fromDate = `${year}${mm}01`;
  const toDate = `${year}${mm}${String(lastDay).padStart(2, "0")}`;

  const url =
    `https://open.neis.go.kr/hub/SchoolSchedule` +
    `?KEY=${NEIS_KEY}&Type=json` +
    `&ATPT_OFCDC_SC_CODE=${ATPT_CODE}` +
    `&SD_SCHUL_CODE=${SCHOOL_CODE}` +
    `&AA_FROM_YMD=${fromDate}&AA_TO_YMD=${toDate}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let raw = "";
      res.on("data", (chunk: string) => (raw += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(raw);
          if (json.RESULT) {
            if (json.RESULT.CODE === "INFO-200") return resolve([]);
            return reject(new Error(`${json.RESULT.CODE}: ${json.RESULT.MESSAGE}`));
          }
          resolve(json.SchoolSchedule?.[1]?.row ?? []);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error("NEIS API timeout")));
    req.on("error", reject);
  });
}

export async function handleAcademic(message: Message): Promise<boolean> {
  const content = message.content.trim();
  if (!content.startsWith("!학사일정")) return false;

  const now = kstNow();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;

  const rest = content.slice("!학사일정".length).trim();
  if (rest) {
    const match = rest.match(/^(\d{1,2})월?$/);
    if (!match) {
      await message.reply("올바른 형식으로 입력해줘! (예: `!학사일정` 또는 `!학사일정 4월`)");
      return true;
    }
    month = parseInt(match[1], 10);
    if (month < 1 || month > 12) {
      await message.reply("1~12 사이의 달을 입력해줘!");
      return true;
    }
  }

  try {
    const rows = await fetchWithRetry(() => fetchAcademicSchedule(year, month));

    if (rows.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x6b7280)
        .setTitle(`📅 ${year}년 ${month}월 학사일정`)
        .setDescription("이번 달 등록된 학사일정이 없어!")
        .setFooter({ text: "NEIS 학사일정" });
      await message.reply({ embeds: [embed] });
      return true;
    }

    const byDay = new Map<number, Set<string>>();
    for (const row of rows) {
      const day = parseInt(row.AA_YMD.slice(6, 8), 10);
      if (!byDay.has(day)) byDay.set(day, new Set());
      byDay.get(day)!.add(row.EVENT_NM);
    }

    const lines = [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, events]) => `**${day}일** ㅡ ${[...events].join(", ")}`);

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`📅 ${year}년 ${month}월 학사일정`)
      .setDescription(lines.join("\n"))
      .setFooter({ text: "NEIS 학사일정" })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (err) {
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ 오류 발생")
      .setDescription("학사일정을 불러오는 중 오류가 발생했어!")
      .setFooter({ text: (err as Error).message });
    await message.reply({ embeds: [embed] });
  }

  return true;
}
