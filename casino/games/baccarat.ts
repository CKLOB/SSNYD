import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  ButtonInteraction,
} from "discord.js";
import { getUser, updateBalance } from "../../db.js";
import { sleep, parseBet, fmt, activeGamblers, createDeck, Card } from "./shared.js";

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

export async function handleBaccarat(message: Message, args: string[]): Promise<void> {
  const user = await getUser(message.guild!.id, message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) {
    message.reply(error);
    return;
  }

  const uid = message.author.id;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bac_player_${uid}_${amount}`)
      .setLabel("플레이어")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bac_tie_${uid}_${amount}`)
      .setLabel("타이")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bac_banker_${uid}_${amount}`)
      .setLabel("뱅커")
      .setStyle(ButtonStyle.Secondary),
  );

  activeGamblers.add(uid);
  message.reply({
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
  const parts = interaction.customId.split("_");
  const side = parts[1] as BacSide;
  const userId = parts[2];
  const amount = parseInt(parts[3]);

  if (interaction.user.id !== userId) {
    interaction.reply({ content: "❌ 이 게임은 당신의 게임이 아닙니다.", ephemeral: true });
    return;
  }

  const user = await getUser(interaction.guildId!, userId, interaction.user.username);
  if (user.balance < amount) {
    activeGamblers.delete(userId);
    interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("🎴 바카라")
          .setDescription("❌ 잔액이 부족합니다."),
      ],
      components: [],
    });
    return;
  }

  await updateBalance(interaction.guildId!, userId, -amount);
  const { player, banker, pVal, bVal, winner } = runBaccarat();

  const isTie = winner === "tie";
  const userWin = side === winner;
  const sideLabel: Record<BacSide, string> = {
    player: "👤 플레이어",
    banker: "🏦 뱅커",
    tie: "🤝 타이",
  };

  let delta: number;
  if (isTie && side === "tie") {
    delta = amount * 8;
    await updateBalance(interaction.guildId!, userId, amount + delta);
  } else if (isTie) {
    delta = 0;
    await updateBalance(interaction.guildId!, userId, amount);
  } else if (userWin) {
    delta = side === "banker" ? Math.floor(amount * 0.95) : amount;
    await updateBalance(interaction.guildId!, userId, amount + delta);
  } else {
    delta = -amount;
  }

  const updated = await getUser(interaction.guildId!, userId, interaction.user.username);
  const resultText = isTie
    ? side === "tie"
      ? "🎉 타이 적중!"
      : "🤝 타이 (베팅 반환)"
    : userWin
      ? "🎉 승리!"
      : "😔 패배";
  const resultColor = userWin || (isTie && side === "tie") ? 0x22c55e : isTie ? 0x6b7280 : 0xef4444;

  await interaction.deferUpdate();

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
          { name: "현재 잔액", value: `${updated.balance.toLocaleString()}원`, inline: true },
        ),
    ],
  });
  activeGamblers.delete(userId);
}
