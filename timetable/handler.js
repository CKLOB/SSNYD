const { EmbedBuilder } = require("discord.js");
const https = require("https");
const { kstNow, toNeisDateStr, NEIS_KEY, ATPT_CODE, SCHOOL_CODE } = require("../utils");

const GRADE = 2;

function getClassFromRoles(member) {
  for (let i = 1; i <= 4; i++) {
    if (member.roles.cache.some((r) => r.name === `${i}반`)) return i;
  }
  return null;
}

function fetchTimetable(dateStr, classNum) {
  const url =
    `https://open.neis.go.kr/hub/hisTimetable` +
    `?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=20` +
    `&ATPT_OFCDC_SC_CODE=${ATPT_CODE}` +
    `&SD_SCHUL_CODE=${SCHOOL_CODE}` +
    `&GRADE=${GRADE}` +
    `&CLASS_NM=${classNum}` +
    `&TI_FROM_YMD=${dateStr}` +
    `&TI_TO_YMD=${dateStr}`;

  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(raw);
            if (!json.hisTimetable) { resolve(null); return; }
            resolve(json.hisTimetable[1].row);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function handleTimetable(message) {
  if (message.content.trim() !== "!시간표") return false;

  const kst = kstNow();
  const t = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  let targetDate = new Date(kst);
  if (t >= 16 * 60 + 40) targetDate = new Date(kst.getTime() + 24 * 60 * 60 * 1000);

  while (targetDate.getUTCDay() === 0 || targetDate.getUTCDay() === 6) {
    targetDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  }

  const classNum = getClassFromRoles(message.member);
  if (!classNum) {
    message.reply("❌ 반 역할이 없습니다. 관리자에게 문의하세요.");
    return true;
  }

  const dateStr = toNeisDateStr(targetDate);

  try {
    const rows = await fetchTimetable(dateStr, classNum);
    if (!rows || rows.length === 0) {
      message.reply("😢 시간표 정보가 없습니다.");
      return true;
    }

    const month = parseInt(dateStr.slice(4, 6));
    const day = parseInt(dateStr.slice(6, 8));
    const timetable = rows
      .sort((a, b) => parseInt(a.PERIO) - parseInt(b.PERIO))
      .map((r) => `**${r.PERIO}교시** ${r.ITRT_CNTNT}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`📚 ${month}월 ${day}일 2학년 ${classNum}반 시간표`)
      .setDescription(timetable);

    message.reply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    message.reply("❌ 시간표를 불러오는 중 오류가 발생했습니다.");
  }

  return true;
}

module.exports = { handleTimetable };
