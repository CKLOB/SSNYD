import { EmbedBuilder } from "discord.js";
import { getUser, claimReward, creditUser, tryAdjustBalance, getTopUsers } from "../db.js";
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

const ATTENDANCE_REWARD = 150000;
const SUPPORT_REWARD = 100000;
const WORK_COOLDOWN_MS = 60 * 1000;
const SUPPORT_COOLDOWN_MS = 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 오늘 KST 자정 시각 (last_* 컬럼은 UTC로 저장되므로 UTC Date로 돌려준다)
function kstMidnight(): Date {
  return new Date(new Date(`${toKSTDateStr(new Date())}T00:00:00Z`).getTime() - KST_OFFSET_MS);
}

function rewardEmbed(color: number, title: string, label: string, reward: number, balance: number) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: label, value: `+${reward.toLocaleString()}원`, inline: true },
      { name: "현재 잔액", value: `${balance.toLocaleString()}원`, inline: true },
    );
}

export async function handleAttendance(ctx: Ctx): Promise<void> {
  const guildId = ctx.guildId!;
  const user = await getUser(guildId, ctx.authorId, ctx.username);
  const alreadyMsg = "⏳ 오늘 이미 출석했습니다. 내일 다시 출석하세요.";
  if (user.last_attendance) {
    const lastDate = toKSTDateStr(new Date(user.last_attendance));
    if (lastDate >= toKSTDateStr(new Date())) {
      ctx.reply(alreadyMsg);
      return;
    }
  }

  // 위 검사는 빠른 안내용이고, 실제 지급 여부는 DB 조건부 UPDATE가 결정한다 (연타 중복 지급 방지)
  const now = toMysqlDatetime(new Date());
  // DATETIME은 초 단위라 "자정 1초 전 이하" = "오늘 출석 안 함"
  const cutoff = toMysqlDatetime(new Date(kstMidnight().getTime() - 1000));
  const balance = await claimReward(
    guildId,
    ctx.authorId,
    "last_attendance",
    ATTENDANCE_REWARD,
    now,
    cutoff,
  );
  if (balance === null) {
    ctx.reply(alreadyMsg);
    return;
  }
  ctx.reply({
    embeds: [rewardEmbed(0x22c55e, "📅 출석 완료!", "보상", ATTENDANCE_REWARD, balance)],
  });
}

export async function handleWork(ctx: Ctx): Promise<void> {
  const guildId = ctx.guildId!;
  const user = await getUser(guildId, ctx.authorId, ctx.username);
  const left = cooldownLeft(user.last_work, WORK_COOLDOWN_MS);
  if (left) {
    ctx.reply(`⏳ **${left}** 후에 다시 일할 수 있습니다.`);
    return;
  }

  const reward = Math.floor(Math.random() * 20001) + 10000;
  const nowMs = Date.now();
  const balance = await claimReward(
    guildId,
    ctx.authorId,
    "last_work",
    reward,
    toMysqlDatetime(new Date(nowMs)),
    toMysqlDatetime(new Date(nowMs - WORK_COOLDOWN_MS)),
  );
  if (balance === null) {
    ctx.reply("⏳ 잠시 후에 다시 일할 수 있습니다.");
    return;
  }
  ctx.reply({ embeds: [rewardEmbed(0x3b82f6, "💼 노동 완료!", "보상", reward, balance)] });
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
  const notZeroMsg = "❌ 잔액이 0원일 때만 지원금을 받을 수 있습니다.";
  if (user.balance > 0) {
    ctx.reply(notZeroMsg);
    return;
  }

  const left = cooldownLeft(user.last_support, SUPPORT_COOLDOWN_MS);
  if (left) {
    ctx.reply(`⏳ **${left}** 후에 다시 신청할 수 있습니다.`);
    return;
  }

  const nowMs = Date.now();
  const balance = await claimReward(
    guildId,
    ctx.authorId,
    "last_support",
    SUPPORT_REWARD,
    toMysqlDatetime(new Date(nowMs)),
    toMysqlDatetime(new Date(nowMs - SUPPORT_COOLDOWN_MS)),
    { requireZeroBalance: true },
  );
  if (balance === null) {
    ctx.reply(notZeroMsg);
    return;
  }
  ctx.reply({
    embeds: [rewardEmbed(0xf59e0b, "🆘 지원금 지급", "지원금", SUPPORT_REWARD, balance)],
  });
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
  const { error: parseErr, amount: parsedAmount } = parseAmountInput(
    amountStr || undefined,
    sender.balance,
  );
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

  // 잔액 확인과 출금을 한 쿼리로 — 송금을 연달아 보내도 잔액 이상 빠져나가지 않는다
  const senderBalance = await tryAdjustBalance(guildId, ctx.authorId, -amount, amount);
  if (senderBalance === null) {
    ctx.reply("❌ 잔액이 부족합니다.");
    return;
  }
  await creditUser(guildId, targetId, targetUsername, received);

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("💸 송금 완료")
    .addFields(
      { name: "받는 사람", value: `<@${targetId}>`, inline: true },
      { name: "송금액", value: `${amount.toLocaleString()}원`, inline: true },
      { name: "증여세율", value: `${taxRate}%`, inline: true },
      { name: "세금", value: `-${tax.toLocaleString()}원`, inline: true },
      { name: "실수령액", value: `${received.toLocaleString()}원`, inline: true },
      { name: "내 잔액", value: `${senderBalance.toLocaleString()}원`, inline: true },
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
