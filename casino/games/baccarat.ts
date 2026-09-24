import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
} from "discord.js";
import { getUser, tryAdjustBalance } from "../../db.js";
import {
  sleep,
  parseBet,
  fmt,
  startGame,
  claimButton,
  endGame,
  insufficientEmbed,
  createDeck,
  Card,
} from "./shared.js";
import { Ctx } from "../../ctx.js";

type BacSide = "player" | "banker" | "tie";

function bacVal(card: Card): number {
  if (["10", "J", "Q", "K"].includes(card.v)) return 0;
  if (card.v === "A") return 1;
  return parseInt(card.v);
}

function bacHandVal(hand: Card[]): number {
  return hand.reduce((s, c) => s + bacVal(c), 0) % 10;
}

function cardStr(cards: Card[]): string {
  return cards.map((c) => `${c.s}${c.v}`).join("  ");
}

interface BaccaratResult {
  player: Card[];
  banker: Card[];
  pVal: number;
  bVal: number;
  winner: BacSide;
}

function runBaccarat(): BaccaratResult {
  const deck = createDeck();
  const player = [deck.pop()!, deck.pop()!];
  const banker = [deck.pop()!, deck.pop()!];

  let pVal = bacHandVal(player);
  let bVal = bacHandVal(banker);

  if (pVal <= 5 && pVal < 8 && bVal < 8) {
    const pThird = deck.pop()!;
    player.push(pThird);
    pVal = bacHandVal(player);
    const pt = bacVal(pThird);

    if (bVal <= 2) banker.push(deck.pop()!);
    else if (bVal === 3 && pt !== 8) banker.push(deck.pop()!);
    else if (bVal === 4 && pt >= 2 && pt <= 7) banker.push(deck.pop()!);
    else if (bVal === 5 && pt >= 4 && pt <= 7) banker.push(deck.pop()!);
    else if (bVal === 6 && pt >= 6 && pt <= 7) banker.push(deck.pop()!);
  } else if (bVal <= 5 && bVal < 8 && pVal >= 6) {
    banker.push(deck.pop()!);
  }

  bVal = bacHandVal(banker);
  pVal = bacHandVal(player);
  const winner: BacSide = pVal > bVal ? "player" : bVal > pVal ? "banker" : "tie";
  return { player, banker, pVal, bVal, winner };
}

export async function handleBaccarat(ctx: Ctx, args: string[]): Promise<void> {
  const user = await getUser(ctx.guildId!, ctx.authorId, ctx.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) {
    ctx.reply(error);
    return;
  }

  const uid = ctx.authorId;
  const gid = startGame(uid);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bac_player_${uid}_${amount}_${gid}`)
      .setLabel("플레이어")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bac_tie_${uid}_${amount}_${gid}`)
      .setLabel("타이")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bac_banker_${uid}_${amount}_${gid}`)
      .setLabel("뱅커")
      .setStyle(ButtonStyle.Secondary),
  );

  ctx.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("🎴 바카라")
        .setDescription(`베팅 금액: **${amount!.toLocaleString()}원**\n어디에 베팅할까요?`),
    ],
    components: [row],
  });
}

export async function handleBaccaratButton(interaction: ButtonInteraction): Promise<void> {
  const [, sideStr, userId, amountStr, gameId] = interaction.customId.split("_");
  const side = sideStr as BacSide;
  const amount = parseInt(amountStr);
  if (!(await claimButton(interaction, userId, gameId))) return;

  try {
    await playBaccarat(interaction, side, userId, amount);
  } finally {
    endGame(userId);
  }
}

async function playBaccarat(
  interaction: ButtonInteraction,
  side: BacSide,
  userId: string,
  amount: number,
): Promise<void> {
  await interaction.deferUpdate();

  const { player, banker, pVal, bVal, winner } = runBaccarat();

  const isTie = winner === "tie";
  const userWin = side === winner;
  const sideLabel: Record<BacSide, string> = {
    player: "👤 플레이어",
    banker: "🏦 뱅커",
    tie: "🤝 타이",
  };

  // 타이 적중 8배, 뱅커 승리 0.95배, 타이인데 다른 쪽 베팅이면 반환
  let delta: number;
  if (isTie) delta = side === "tie" ? amount * 8 : 0;
  else if (userWin) delta = side === "banker" ? Math.floor(amount * 0.95) : amount;
  else delta = -amount;

  // 결과를 먼저 뽑고 손익을 한 번에 반영한다 (예전: 잔액 조회 → 차감 → 지급으로 DB 왕복 최대 6번)
  const balance = await tryAdjustBalance(interaction.guildId!, userId, delta, amount);
  if (balance === null) {
    await interaction.editReply({ embeds: [insufficientEmbed("🎴 바카라")], components: [] });
    return;
  }

  const resultText = isTie
    ? side === "tie"
      ? "🎉 타이 적중!"
      : "🤝 타이 (베팅 반환)"
    : userWin
      ? "🎉 승리!"
      : "😔 패배";
  const resultColor = userWin || (isTie && side === "tie") ? 0x22c55e : isTie ? 0x6b7280 : 0xef4444;

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("🎴 바카라")
        .setDescription("🂠  🂠  카드를 배분하고 있습니다...\n🂠  🂠"),
    ],
    components: [],
  });
  await sleep(800);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("🎴 바카라")
        .addFields(
          { name: "👤 플레이어", value: cardStr(player.slice(0, 1)) + "  🂠", inline: true },
          { name: "🏦 뱅커", value: cardStr(banker.slice(0, 1)) + "  🂠", inline: true },
        ),
    ],
  });
  await sleep(800);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("🎴 바카라")
        .addFields(
          {
            name: "👤 플레이어",
            value: `${cardStr(player.slice(0, 2))}  **(${bacHandVal(player.slice(0, 2))})**`,
            inline: true,
          },
          {
            name: "🏦 뱅커",
            value: `${cardStr(banker.slice(0, 2))}  **(${bacHandVal(banker.slice(0, 2))})**`,
            inline: true,
          },
        )
        .setFooter({
          text:
            player.length > 2 || banker.length > 2 ? "3번째 카드 배분 중..." : "결과 집계 중...",
        }),
    ],
  });
  await sleep(900);

  if (player.length > 2 || banker.length > 2) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle("🎴 바카라")
          .addFields(
            { name: "👤 플레이어", value: `${cardStr(player)}  **(${pVal})**`, inline: true },
            { name: "🏦 뱅커", value: `${cardStr(banker)}  **(${bVal})**`, inline: true },
          )
          .setFooter({ text: "결과 집계 중..." }),
      ],
    });
    await sleep(900);
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(resultColor)
        .setTitle("🎴 바카라")
        .addFields(
          { name: "👤 플레이어", value: `${cardStr(player)}  **(${pVal})**`, inline: true },
          { name: "🏦 뱅커", value: `${cardStr(banker)}  **(${bVal})**`, inline: true },
          { name: "내 베팅", value: sideLabel[side], inline: true },
          { name: "판정", value: resultText, inline: true },
          { name: "손익", value: fmt(delta), inline: true },
          { name: "현재 잔액", value: `${balance.toLocaleString()}원`, inline: true },
        ),
    ],
  });
}
