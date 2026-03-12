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
  await setField(
    message.author.id,
    "last_attendance",
    toMysqlDatetime(new Date()),
  );
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
  //const reward = 400000; // 꼼수
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
  await setField(
    message.author.id,
    "last_support",
    toMysqlDatetime(new Date()),
  );
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

async function handleTransfer(message, args) {
  const mention = message.mentions.users.first();
  if (!mention)
    return message.reply(
      "❌ 송금할 대상을 멘션해주세요. 예) `!송금 @이름 10000`",
    );
  if (mention.id === message.author.id)
    return message.reply("❌ 자기 자신에게는 송금할 수 없습니다.");
  if (mention.bot) return message.reply("❌ 봇에게는 송금할 수 없습니다.");

  const amountStr = args[1];
  if (!amountStr)
    return message.reply("❌ 송금 금액을 입력하세요. 예) `!송금 @이름 10000`");

  const sender = await getUser(message.author.id, message.author.username);
  const amount =
    amountStr.toLowerCase() === "올인" || amountStr.toLowerCase() === "all"
      ? sender.balance
      : amountStr.toLowerCase() === "반" || amountStr.toLowerCase() === "half"
        ? Math.floor(sender.balance / 2)
        : parseInt(amountStr);

  if (isNaN(amount)) return message.reply("❌ 올바른 금액을 입력하세요.");
  if (amount < 1000) return message.reply("❌ 최소 송금 금액은 1,000원입니다.");
  if (amount > sender.balance) return message.reply("❌ 잔액이 부족합니다.");

  const taxRate = Math.floor(Math.random() * 21) + 10; // 10~30%
  const tax = Math.floor(amount * (taxRate / 100));
  const received = amount - tax;

  await updateBalance(message.author.id, -amount);
  await getUser(mention.id, mention.username);
  await updateBalance(mention.id, received);

  const senderUpdated = await getUser(
    message.author.id,
    message.author.username,
  );

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("💸 송금 완료")
    .addFields(
      { name: "받는 사람", value: `<@${mention.id}>`, inline: true },
      { name: "송금액", value: `${amount.toLocaleString()}원`, inline: true },
      { name: "증여세율", value: `${taxRate}%`, inline: true },
      { name: "세금", value: `-${tax.toLocaleString()}원`, inline: true },
      {
        name: "실수령액",
        value: `${received.toLocaleString()}원`,
        inline: true,
      },
      {
        name: "내 잔액",
        value: `${senderUpdated.balance.toLocaleString()}원`,
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
  handleTransfer,
};
