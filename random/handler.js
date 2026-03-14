const { EmbedBuilder } = require("discord.js");

// 멤버 목록 가져오기 (봇 제외)
async function getHumanMembers(guild) {
  const members = await guild.members.fetch();
  return members.filter((m) => !m.user.bot).map((m) => m);
}

// Fisher-Yates 셔플 후 앞 n개 선택
function pickRandom(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// 금액 랜덤 분배 (min 5%, max 25%)
function distributeAmount(total, count) {
  const minAmount = Math.ceil(total * 0.05);
  const maxAmount = Math.floor(total * 0.25);

  const amounts = [];
  let remaining = total;

  for (let i = 0; i < count - 1; i++) {
    const left = count - i - 1;
    const lo = Math.max(minAmount, remaining - maxAmount * left);
    const hi = Math.min(maxAmount, remaining - minAmount * left);
    const amount = lo + Math.floor(Math.random() * (hi - lo + 1));
    amounts.push(amount);
    remaining -= amount;
  }
  amounts.push(remaining);

  // 셔플 (마지막 사람이 항상 나머지를 받는 편향 제거)
  for (let i = amounts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [amounts[i], amounts[j]] = [amounts[j], amounts[i]];
  }

  return amounts;
}

function formatWon(amount) {
  return amount.toLocaleString("ko-KR") + "원";
}

// !1 ~ !9 랜덤 지목
async function handleRandomPick(message, count) {
  if (!message.guild) return message.reply("서버에서만 사용 가능한 명령어입니다.");

  const members = await getHumanMembers(message.guild);

  if (members.length < count) {
    return message.reply(
      `❌ 서버 멤버가 부족합니다. (필요: ${count}명, 현재: ${members.length}명)`
    );
  }

  const picked = pickRandom(members, count);
  const mentions = picked.map((m) => `<@${m.id}>`).join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎯 랜덤 선택 결과 (${count}명)`)
    .setDescription(mentions)
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}

// !폭탄 [금액] 랜덤 정산
async function handleBomb(message, args) {
  if (!message.guild) return message.reply("서버에서만 사용 가능한 명령어입니다.");

  const raw = args[0]?.replace(/,/g, "");
  const total = parseInt(raw, 10);

  if (!raw || isNaN(total) || total <= 0) {
    return message.reply("❌ 올바른 금액을 입력해주세요. 예: `!폭탄 100000`");
  }

  const members = await getHumanMembers(message.guild);
  const count = Math.min(9, members.length);

  if (count < 2) {
    return message.reply("❌ 참가 가능한 멤버가 너무 적습니다. (최소 2명)");
  }

  const minAmount = Math.ceil(total * 0.05);
  const maxAmount = Math.floor(total * 0.25);

  if (minAmount * count > total || maxAmount * count < total) {
    return message.reply(
      `❌ ${count}명에게 분배하기에 적합하지 않은 금액입니다.\n` +
        `(1인당 최소 ${formatWon(minAmount)}, 최대 ${formatWon(maxAmount)})`
    );
  }

  const picked = pickRandom(members, count);
  const amounts = distributeAmount(total, count);
  const maxAmount_ = Math.max(...amounts);

  const lines = picked.map((member, i) => {
    const suffix = amounts[i] === maxAmount_ ? " 💀" : "";
    return `<@${member.id}>: **${formatWon(amounts[i])}**${suffix}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xff4444)
    .setTitle("💣 회식 폭탄 정산 결과")
    .addFields(
      { name: "총 금액", value: formatWon(total), inline: true },
      {
        name: "참가자",
        value: `${count}명 (서버 멤버 중 랜덤 선택)`,
        inline: true,
      }
    )
    .setDescription(lines.join("\n"))
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}

async function handleRandom(message) {
  const content = message.content.trim();

  // !1 ~ !9
  const pickMatch = content.match(/^!([1-9])$/);
  if (pickMatch) {
    await handleRandomPick(message, parseInt(pickMatch[1], 10));
    return true;
  }

  // !폭탄 [금액]
  const bombMatch = content.match(/^!폭탄(?:\s+(.+))?$/);
  if (bombMatch) {
    const args = bombMatch[1] ? bombMatch[1].trim().split(/\s+/) : [];
    await handleBomb(message, args);
    return true;
  }

  return false;
}

module.exports = { handleRandom };
