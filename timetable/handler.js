import { EmbedBuilder } from "discord.js";
import https from "https";
import {
  kstNow,
  toNeisDateStr,
  fetchWithRetry,
  NEIS_KEY,
  ATPT_CODE,
  SCHOOL_CODE,
} from "../utils.js";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const CLASS_COLORS = [0x3b82f6, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xef4444, 0xec4899];

function getClassFromRoles(member) {
  for (const role of member.roles.cache.values()) {
    const simpleMatch = role.name.match(/^(\d+)반$/);
    if (simpleMatch) return { grade: 2, classNum: parseInt(simpleMatch[1]) };

    const fullMatch = role.name.match(/^(\d+)-(\d+)$/);
    if (fullMatch)
      return {
        grade: parseInt(fullMatch[1]),
        classNum: parseInt(fullMatch[2]),
      };
  }
  return null;
}

function getTargetDate() {
  const kst = kstNow();
  const t = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  let target = new Date(kst);
  if (t >= 16 * 60 + 40) target = new Date(target.getTime() + 24 * 60 * 60 * 1000);

  while (target.getUTCDay() === 0 || target.getUTCDay() === 6)
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);

  return target;
}

function fetchTimetable(dateStr, grade, classNum) {
  const url =
    `https://open.neis.go.kr/hub/hisTimetable` +
    `?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=100` +
    `&ATPT_OFCDC_SC_CODE=${ATPT_CODE}` +
    `&SD_SCHUL_CODE=${SCHOOL_CODE}` +
    `&ALL_TI_YMD=${dateStr}` +
    `&GRADE=${grade}` +
    `&CLASS_NM=${classNum}`;

  console.log(`[NEIS] 시간표 요청 — ${dateStr} grade=${grade} class=${classNum}`);
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      console.log(`[NEIS] 시간표 응답 — status=${res.statusCode}`);
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        console.log(`[NEIS] 시간표 raw (${raw.length}B) — ${raw.slice(0, 200)}`);
        try {
          const json = JSON.parse(raw);
          if (!json.hisTimetable) {
            resolve(null);
            return;
          }
          const rows = json.hisTimetable[1].row;
          rows.sort((a, b) => parseInt(a.PERIO) - parseInt(b.PERIO));
          resolve(
            rows.map((r) => ({
              period: parseInt(r.PERIO),
              subject: r.ITRT_CNTNT.trim(),
            })),
          );
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error("NEIS API 요청 시간 초과")));
    req.on("error", reject);
  });
}

async function handleTimetable(message) {
  const cmd = message.content.trim();
  const match = cmd.match(/^!(?:시간표|ㅅㄱㅍ)\s*(?:(\d)-(\d+))?$/);
  if (!match) return false;

  let grade, classNum;

  if (match[1] && match[2]) {
    grade = parseInt(match[1]);
    classNum = parseInt(match[2]);
    if (grade < 1 || grade > 3 || classNum < 1) {
      message.reply("❌ 학년은 1~3, 반은 1 이상의 숫자로 입력해줘! (예: `!시간표 2-3`)");
      return true;
    }
  } else {
    const info = getClassFromRoles(message.member);
    if (!info) {
      message.reply("❌ 반 역할이 없습니다. (예: `1반`, `2-1`) 관리자에게 문의하세요.");
      return true;
    }
    ({ grade, classNum } = info);
  }
  const target = getTargetDate();
  const dateStr = toNeisDateStr(target);
  const dayName = DAY_NAMES[target.getUTCDay()];
  const month = target.getUTCMonth() + 1;
  const day = target.getUTCDate();

  try {
    const rows = await fetchWithRetry(() => fetchTimetable(dateStr, grade, classNum));
    if (!rows || rows.length === 0) {
      message.reply(`😢 ${month}월 ${day}일(${dayName}) 시간표 정보가 없습니다.`);
      return true;
    }

    const seen = new Set();
    const deduped = rows.filter((r) => {
      const key = `${r.period}:${r.subject}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const lines = deduped.map((r) => `**${r.period}교시**  -  ${r.subject}`);
    const color = CLASS_COLORS[(classNum - 1) % CLASS_COLORS.length];

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`📚 ${grade} - ${classNum} 시간표`)
      .setDescription(`📅 **${month}월 ${day}일 (${dayName}요일)**\n\n${lines.join("\n")}`);

    message.reply({ embeds: [embed] });
  } catch (err) {
    console.error(`[NEIS] 시간표 최종 실패 —`, err);
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("❌ 시간표 정보 오류")
      .addFields(
        { name: "오류 유형", value: err.name || "Error", inline: true },
        { name: "재시도", value: "2회 재시도 후 실패", inline: true },
        { name: "메시지", value: err.message || "알 수 없는 오류", inline: false },
      )
      .setTimestamp();
    message.reply({ embeds: [embed] });
  }

  return true;
}

export { handleTimetable };
