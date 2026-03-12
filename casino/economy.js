const { EmbedBuilder } = require("discord.js");
const { getUser, updateBalance, setField, getTopUsers } = require("./db");

function toMysqlDatetime(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function cooldownLeft(lastTime, ms) {
  if (!lastTime) return null;
  const diff = Date.now() - new Date(lastTime).getTime();
  if (diff >= ms) return null;
  const rem = ms - diff;
  const h = Math.floor(rem / 3600000);
  const m = Math.floor((rem % 3600000) / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  return `${h}시간 ${m}분 ${s}초`;
}

async function handleAttendance(message) {
  const user = await getUser(message.author.id, message.author.username);
  const left = cooldownLeft(user.last_attendance, 24 * 60 * 60 * 1000);
  if (left) return message.reply(`⏳ **${left}** 후에 출석할 수 있습니다.`);

  await updateBalance(message.author.id, 20000);
  await setField(message.author.id, "last_attendance", toMysqlDatetime(new Date()));
  const updated = await getUser(message.author.id, message.author.username);

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("📅 출석 완료!")
    .addFields(
      { name: "보상", value: "+20,000원", inline: true },
      {
        name: "현재 잔액",
        value: `${updated.balance.toLocaleString()}원`,
        inline: true,
      },
    );
  message.reply({ embeds: [embed] });
}

async function handleWork(message) {
  const user = await getUser(message.author.id, message.author.username);
  const left = cooldownLeft(user.last_work, 90 * 1000);
  if (left) return message.reply(`⏳ **${left}** 후에 다시 일할 수 있습니다.`);

  const reward = Math.floor(Math.random() * 4001) + 1000;
  await updateBalance(message.author.id, reward);
  await setField(message.author.id, "last_work", toMysqlDatetime(new Date()));
  const updated = await getUser(message.author.id, message.author.username);

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("💼 노동 완료!")
    .addFields(
      { name: "보상", value: `+${reward.toLocaleString()}원`, inline: true },
      {
        name: "현재 잔액",
        value: `${updated.balance.toLocaleString()}원`,
        inline: true,
      },
    );
  message.reply({ embeds: [embed] });
}

async function handleBalance(message) {
  const user = await getUser(message.author.id, message.author.username);
  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(`💰 ${message.author.username}의 잔액`)
    .setDescription(`**${user.balance.toLocaleString()}원**`);
  message.reply({ embeds: [embed] });
}

async function handleSupport(message) {
  const user = await getUser(message.author.id, message.author.username);
  if (user.balance > 0)
    return message.reply("❌ 잔액이 0원일 때만 지원금을 받을 수 있습니다.");

  const left = cooldownLeft(user.last_support, 60 * 60 * 1000);
  if (left)
    return message.reply(`⏳ **${left}** 후에 다시 신청할 수 있습니다.`);

  await updateBalance(message.author.id, 30000);
  await setField(message.author.id, "last_support", toMysqlDatetime(new Date()));
  const updated = await getUser(message.author.id, message.author.username);

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("🆘 지원금 지급")
    .addFields(
      { name: "지원금", value: "+30,000원", inline: true },
      {
        name: "현재 잔액",
        value: `${updated.balance.toLocaleString()}원`,
        inline: true,
      },
    );
  message.reply({ embeds: [embed] });
}

async function handleRanking(message) {
  const users = await getTopUsers(10);
  const medals = ["🥇", "🥈", "🥉"];
  const list = users
    .map(
      (u, i) =>
        `${medals[i] ?? `${i + 1}.`} **${u.username}** — ${u.balance.toLocaleString()}원`,
    )
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("🏆 잔액 랭킹")
    .setDescription(list || "데이터 없음");
  message.reply({ embeds: [embed] });
}

module.exports = {
  handleAttendance,
  handleWork,
  handleBalance,
  handleSupport,
  handleRanking,
};
