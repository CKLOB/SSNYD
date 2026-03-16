const { EmbedBuilder } = require("discord.js");
const { kstNow } = require("../utils");
const { TIMETABLE } = require("./data");

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function getClassFromRoles(member) {
  for (let i = 1; i <= 4; i++) {
    if (member.roles.cache.some((r) => r.name === `${i}반`)) return i;
  }
  return null;
}

// 오늘 기준 다음 수업일 계산 (16:40 이후면 내일로, 주말 스킵)
function getTargetDate() {
  const kst = kstNow();
  const t = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  let target = new Date(kst);
  if (t >= 16 * 60 + 40)
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);

  while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }

  return target;
}

async function handleTimetable(message) {
  const cmd = message.content.trim();
  if (cmd !== "!시간표" && cmd !== "!ㅅㄱㅍ") return false;

  const classNum = getClassFromRoles(message.member);
  if (!classNum) {
    message.reply("❌ 반 역할이 없습니다. 관리자에게 문의하세요.");
    return true;
  }

  const target = getTargetDate();
  const dayName = DAY_NAMES[target.getUTCDay()];
  const month = target.getUTCMonth() + 1;
  const day = target.getUTCDate();

  const data = TIMETABLE[classNum];
  const subjects = data.schedule[dayName];

  if (!subjects || subjects.length === 0) {
    message.reply("😢 해당 요일의 시간표 정보가 없습니다.");
    return true;
  }

  const lines = subjects.map(
    (subject, i) => `**${i + 1}교시**  -  ${subject || "―"}`,
  );

  const embed = new EmbedBuilder()
    .setColor(data.color)
    .setTitle(`📚 ${data.name} 시간표`)
    .setDescription(
      `📅 **${month}월 ${day}일 (${dayName}요일)**\n\n${lines.join("\n")}`,
    );

  message.reply({ embeds: [embed] });
  return true;
}

module.exports = { handleTimetable };
