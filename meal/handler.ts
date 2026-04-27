import { EmbedBuilder, Message } from "discord.js";
import https from "https";
import {
  kstNow,
  toNeisDateStr,
  fetchWithRetry,
  NEIS_KEY,
  ATPT_CODE,
  SCHOOL_CODE,
} from "../utils.js";

const MEAL_LABELS: Record<number, string> = { 1: "조식", 2: "중식", 3: "석식" };

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
    req.setTimeout(8000, () => req.destroy(new Error("NEIS API 요청 시간 초과")));
    req.on("error", reject);
  });
}

export async function handleMeal(message: Message): Promise<boolean> {
  const content = message.content.trim();
  const kst = kstNow();
  const todayStr = toNeisDateStr(kst);
  const tomorrowStr = toNeisDateStr(new Date(kst.getTime() + 24 * 60 * 60 * 1000));

  let mealType: number, dayLabel: string, dateStr: string;

  if (["!밥", "!ㅂ", "!q", "!급식", "!ㄱㅅ", "!ㄳ", "!rt"].includes(content)) {
    ({ type: mealType, dayLabel, dateStr } = getMealByTime());
  } else if (["!오늘아침", "!아침"].includes(content)) {
    mealType = 1; dayLabel = "오늘"; dateStr = todayStr;
  } else if (["!오늘점심", "!점심"].includes(content)) {
    mealType = 2; dayLabel = "오늘"; dateStr = todayStr;
  } else if (["!오늘저녁", "!저녁"].includes(content)) {
    mealType = 3; dayLabel = "오늘"; dateStr = todayStr;
  } else if (content === "!내일아침") {
    mealType = 1; dayLabel = "내일"; dateStr = tomorrowStr;
  } else if (content === "!내일점심") {
    mealType = 2; dayLabel = "내일"; dateStr = tomorrowStr;
  } else if (content === "!내일저녁") {
    mealType = 3; dayLabel = "내일"; dateStr = tomorrowStr;
  } else return false;

  try {
    const result = await fetchWithRetry(() => fetchMeal(dateStr, mealType));
    if (result) {
      const month = parseInt(dateStr.slice(4, 6));
      const day = parseInt(dateStr.slice(6, 8));
      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`🍽️ ${month}월 ${day}일 ${MEAL_LABELS[mealType]}`)
        .setDescription(result.menu)
        .setFooter({ text: result.cal });
      message.reply({ embeds: [embed] });
    } else {
      message.reply(`😢 ${dayLabel} ${MEAL_LABELS[mealType]} 급식 정보가 없습니다.`);
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
    message.reply({ embeds: [embed] });
  }
  return true;
}
