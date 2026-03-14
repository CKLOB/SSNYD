const { EmbedBuilder } = require("discord.js");
const { TIMETABLE } = require("./data");

const DAYS = ["월", "화", "수", "목", "금"];

function getClassFromRoles(member) {
  for (let i = 1; i <= 4; i++) {
    if (member.roles.cache.some((r) => r.name === `${i}반`)) return i;
  }
  return null;
}

function buildDayField(day, subjects) {
  const lines = subjects.map((subject, i) =>
    `**${i + 1}교시** ${subject || "―"}`
  );
  return { name: `📅 ${day}요일`, value: lines.join("\n"), inline: false };
}

async function handleTimetable(message) {
  if (message.content.trim() !== "!시간표") return false;

  const classNum = getClassFromRoles(message.member);
  if (!classNum) {
    message.reply("❌ 반 역할이 없습니다. 관리자에게 문의하세요.");
    return true;
  }

  const data = TIMETABLE[classNum];

  const fields = DAYS.map((day) => buildDayField(day, data.schedule[day]));

  const embed = new EmbedBuilder()
    .setColor(data.color)
    .setTitle(`📚 ${data.name} 시간표`)
    .addFields(fields);

  message.reply({ embeds: [embed] });
  return true;
}

module.exports = { handleTimetable };
