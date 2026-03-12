const { EmbedBuilder } = require("discord.js");
const https = require("https");

const NEIS_API_KEY =
  process.env.NEIS_API_KEY || "c11ea26f8c614f50bd7b19d2f3228e6d";
const ATPT_CODE = "F10";
const SCHOOL_CODE = "7380292";
const GRADE = 2;

function getKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function toDateStr(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function getClassFromRoles(member) {
  for (let i = 1; i <= 4; i++) {
    if (member.roles.cache.some((r) => r.name === `${i}반`)) return i;
  }
  return null;
}

function fetchTimetable(dateStr, classNum) {
  const url =
    `https://open.neis.go.kr/hub/hisTimetable` +
    `?KEY=${NEIS_API_KEY}&Type=json&pIndex=1&pSize=20` +
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
            if (!json.hisTimetable) {
              resolve(null);
              return;
            }
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
  const content = message.content.trim();
  if (content !== "!시간표") return false;

  const kst = getKST();
  const t = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  let targetDate = new Date(kst);
  if (t >= 16 * 60 + 40) targetDate = new Date(kst.getTime() + 24 * 60 * 60 * 1000);

  // 주말이면 다음 월요일로
  while (targetDate.getUTCDay() === 0 || targetDate.getUTCDay() === 6) {
    targetDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  }

  const classNum = getClassFromRoles(message.member);
  if (!classNum) {
    message.reply("❌ 반 역할이 없습니다. 관리자에게 문의하세요.");
    return true;
  }

  const dateStr = toDateStr(targetDate);

  try {
    const rows = await fetchTimetable(dateStr, classNum);
    if (!rows || rows.length === 0) {
      message.reply("😢 오늘 시간표 정보가 없습니다.");
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
