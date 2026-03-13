const { EmbedBuilder } = require("discord.js");
const https = require("https");
const { kstNow, toNeisDateStr, NEIS_KEY, ATPT_CODE, SCHOOL_CODE } = require("../utils");

const MEAL_LABELS = { 1: "조식", 2: "중식", 3: "석식" };

function getMealByTime() {
  const kst = kstNow();
  const t = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const todayStr = toNeisDateStr(kst);
  const tomorrowStr = toNeisDateStr(new Date(kst.getTime() + 24 * 60 * 60 * 1000));

  if (t < 7 * 60 + 30) return { type: 1, dateStr: todayStr, dayLabel: "오늘" };
  if (t < 12 * 60 + 30) return { type: 2, dateStr: todayStr, dayLabel: "오늘" };
  if (t < 18 * 60 + 30) return { type: 3, dateStr: todayStr, dayLabel: "오늘" };
  return { type: 1, dateStr: tomorrowStr, dayLabel: "내일" };
}

function fetchMeal(dateStr, mealType) {
  const url =
    `https://open.neis.go.kr/hub/mealServiceDietInfo` +
    `?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=10` +
    `&ATPT_OFCDC_SC_CODE=${ATPT_CODE}` +
    `&SD_SCHUL_CODE=${SCHOOL_CODE}` +
    `&MLSV_YMD=${dateStr}` +
    `&MMEAL_SC_CODE=${mealType}`;

  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(raw);
            if (!json.mealServiceDietInfo) { resolve(null); return; }
            const row = json.mealServiceDietInfo[1].row[0];
            const menu = row.DDISH_NM.replace(/\*/g, "")
              .split(/<br\/>/i)
              .map((item) => item.trim())
              .filter((item) => item)
              .map((item) => `- ${item}`)
              .join("\n");
            resolve({ menu, cal: row.CAL_INFO || "" });
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function handleMeal(message) {
  const content = message.content.trim();
  const kst = kstNow();
  const todayStr = toNeisDateStr(kst);
  const tomorrowStr = toNeisDateStr(new Date(kst.getTime() + 24 * 60 * 60 * 1000));

  let mealType, dayLabel, dateStr;

  if (["!밥", "!ㅂ", "!급식", "!ㄱㅅ", "!ㄳ"].includes(content)) {
    ({ type: mealType, dayLabel, dateStr } = getMealByTime());
  } else if (content === "!오늘아침") { mealType = 1; dayLabel = "오늘"; dateStr = todayStr; }
  else if (content === "!오늘점심") { mealType = 2; dayLabel = "오늘"; dateStr = todayStr; }
  else if (content === "!오늘저녁") { mealType = 3; dayLabel = "오늘"; dateStr = todayStr; }
  else if (content === "!내일아침") { mealType = 1; dayLabel = "내일"; dateStr = tomorrowStr; }
  else if (content === "!내일점심") { mealType = 2; dayLabel = "내일"; dateStr = tomorrowStr; }
  else if (content === "!내일저녁") { mealType = 3; dayLabel = "내일"; dateStr = tomorrowStr; }
  else return false;

  try {
    const result = await fetchMeal(dateStr, mealType);
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
    console.error(err);
    message.reply("❌ 급식 정보를 불러오는 중 오류가 발생했습니다.");
  }
  return true;
}

module.exports = { handleMeal };
