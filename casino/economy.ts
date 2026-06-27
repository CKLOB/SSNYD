import { EmbedBuilder } from "discord.js";
import { getUser, updateBalance, setField, getTopUsers } from "../db.js";
import { toMysqlDatetime, toKSTDateStr } from "../utils.js";
import { parseAmountInput } from "./games/shared.js";
import { Ctx } from "../ctx.js";

function cooldownLeft(lastTime: string | null, ms: number): string | null {
  if (!lastTime) return null;
  const diff = Date.now() - new Date(lastTime).getTime();
  if (diff >= ms) return null;
  const rem = ms - diff;
  const h = Math.floor(rem / 3600000);
  const m = Math.floor((rem % 3600000) / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  return `${h}시간 ${m}분 ${s}초`;
}

export async function handleAttendance(ctx: Ctx): Promise<void> {
  const guildId = ctx.guildId!;
  const user = await getUser(guildId, ctx.authorId, ctx.username);
  if (user.last_attendance) {
    const lastDate = toKSTDateStr(new Date(user.last_attendance));
    const today = toKSTDateStr(new Date());
    if (lastDate >= today) {
      ctx.reply("⏳ 오늘 이미 출석했습니다. 내일 다시 출석하세요.");
      return;
    }
  }

  await updateBalance(guildId, ctx.authorId, 150000);
  await setField(guildId, ctx.authorId, "last_attendance", toMysqlDatetime(new Date()));
  const updated = await getUser(guildId, ctx.authorId, ctx.username);

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("📅 출석 완료!")
    .addFields(
      { name: "보상", value: "+150,000원", inline: true },
      { name: "현재 잔액", value: `${updated.balance.toLocaleString()}원`, inline: true },
    );
  ctx.reply({ embeds: [embed] });
}

export async function handleWork(ctx: Ctx): Promise<void> {
  const guildId = ctx.guildId!;
  const user = await getUser(guildId, ctx.authorId, ctx.username);
  const left = cooldownLeft(user.last_work, 60 * 1000);
  if (left) {
    ctx.reply(`⏳ **${left}** 후에 다시 일할 수 있습니다.`);
    return;
  }

  const reward = Math.floor(Math.random() * 20001) + 10000;
  await updateBalance(guildId, ctx.authorId, reward);
  await setField(guildId, ctx.authorId, "last_work", toMysqlDatetime(new Date()));
  const updated = await getUser(guildId, ctx.authorId, ctx.username);

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("💼 노동 완료!")
    .addFields(
      { name: "보상", value: `+${reward.toLocaleString()}원`, inline: true },
      { name: "현재 잔액", value: `${updated.balance.toLocaleString()}원`, inline: true },
    );
  ctx.reply({ embeds: [embed] });
}

export async function handleBalance(ctx: Ctx): Promise<void> {
  const user = await getUser(ctx.guildId!, ctx.authorId, ctx.username);
  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(`💰 ${ctx.username}의 잔액`)
    .setDescription(`**${user.balance.toLocaleString()}원**`);
  ctx.reply({ embeds: [embed] });
}

export async function handleSupport(ctx: Ctx): Promise<void> {
  const guildId = ctx.guildId!;
  const user = await getUser(guildId, ctx.authorId, ctx.username);
  if (user.balance > 0) {
    ctx.reply("❌ 잔액이 0원일 때만 지원금을 받을 수 있습니다.");
    return;
  }

  const left = cooldownLeft(user.last_support, 60 * 60 * 1000);
  if (left) {
    ctx.reply(`⏳ **${left}** 후에 다시 신청할 수 있습니다.`);
    return;
  }

  await updateBalance(guildId, ctx.authorId, 100000);
  await setField(guildId, ctx.authorId, "last_support", toMysqlDatetime(new Date()));
  const updated = await getUser(guildId, ctx.authorId, ctx.username);

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("🆘 지원금 지급")
    .addFields(
      { name: "지원금", value: "+100,000원", inline: true },
      { name: "현재 잔액", value: `${updated.balance.toLocaleString()}원`, inline: true },
    );
  ctx.reply({ embeds: [embed] });
}

export async function handleTransfer(
  ctx: Ctx,
  targetId: string,
  targetUsername: string,
  targetBot: boolean,
  amountStr: string,
): Promise<void> {
  const guildId = ctx.guildId!;

  if (targetId === ctx.authorId) {
    ctx.reply("❌ 자기 자신에게는 송금할 수 없습니다.");
    return;
  }
  if (targetBot) {
    ctx.reply("❌ 봇에게는 송금할 수 없습니다.");
    return;
  }

  const sender = await getUser(guildId, ctx.authorId, ctx.username);
  const { error: parseErr, amount: parsedAmount } = parseAmountInput(amountStr || undefined, sender.balance);
  if (parseErr || parsedAmount === undefined) {
    ctx.reply(parseErr ?? "❌ 올바른 금액을 입력하세요.");
    return;
  }
  const amount = parsedAmount;
  if (amount < 1000) {
    ctx.reply("❌ 최소 송금 금액은 1,000원입니다.");
    return;
  }
  if (amount > sender.balance) {
    ctx.reply("❌ 잔액이 부족합니다.");
    return;
  }

  const taxRate = Math.floor(Math.random() * 16) + 1;
  const tax = Math.floor(amount * (taxRate / 100));
  const received = amount - tax;

  await updateBalance(guildId, ctx.authorId, -amount);
  await getUser(guildId, targetId, targetUsername);
  await updateBalance(guildId, targetId, received);
  const senderUpdated = await getUser(guildId, ctx.authorId, ctx.username);

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("💸 송금 완료")
    .addFields(
      { name: "받는 사람", value: `<@${targetId}>`, inline: true },
      { name: "송금액", value: `${amount.toLocaleString()}원`, inline: true },
      { name: "증여세율", value: `${taxRate}%`, inline: true },
      { name: "세금", value: `-${tax.toLocaleString()}원`, inline: true },
      { name: "실수령액", value: `${received.toLocaleString()}원`, inline: true },
      { name: "내 잔액", value: `${senderUpdated.balance.toLocaleString()}원`, inline: true },
    );
  ctx.reply({ embeds: [embed] });
}

export async function handleRanking(ctx: Ctx): Promise<void> {
  const users = await getTopUsers(ctx.guildId!, 10);
  const medals = ["🥇", "🥈", "🥉"];
  const list = users
    .map(
      (u, i) => `${medals[i] ?? `${i + 1}.`} **${u.username}** — ${u.balance.toLocaleString()}원`,
    )
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("🏆 잔액 랭킹")
    .setDescription(list || "데이터 없음");
  ctx.reply({ embeds: [embed] });
}
