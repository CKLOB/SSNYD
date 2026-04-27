import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  ButtonInteraction,
} from "discord.js";
import { getUser, updateBalance } from "../../db.js";
import { parseBet, fmt, activeGamblers, createDeck, Card } from "./shared.js";

interface BjGame {
  deck: Card[];
  player: Card[];
  dealer: Card[];
  bet: number;
  guildId: string;
}

const bjGames = new Map<string, BjGame>();

function bjVal(card: Card): number {
  if (card.v === "A") return 11;
  if (["J", "Q", "K"].includes(card.v)) return 10;
  return parseInt(card.v);
}

function bjHandVal(hand: Card[]): number {
  let total = hand.reduce((s, c) => s + bjVal(c), 0);
  let aces = hand.filter((c) => c.v === "A").length;
  while (total > 21 && aces-- > 0) total -= 10;
  return total;
}

function bjHandStr(hand: Card[], hideSecond = false): string {
  return hand.map((c, i) => (hideSecond && i === 1 ? "🂠" : `${c.s}${c.v}`)).join("  ");
}

function buildBjRow(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj_hit_${userId}`)
      .setLabel("히트")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bj_stand_${userId}`)
      .setLabel("스탠드")
      .setStyle(ButtonStyle.Secondary),
  );
}

export async function handleBlackjack(message: Message, args: string[]): Promise<void> {
  if (bjGames.has(message.author.id)) {
    message.reply("❌ 이미 진행 중인 블랙잭 게임이 있습니다.");
    return;
  }

  const user = await getUser(message.guild!.id, message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) {
    message.reply(error);
    return;
  }

  await updateBalance(message.guild!.id, message.author.id, -amount!);

  const deck = createDeck();
  const player = [deck.pop()!, deck.pop()!];
  const dealer = [deck.pop()!, deck.pop()!];
  const pVal = bjHandVal(player);
  const dVal = bjHandVal(dealer);

  if (pVal === 21) {
    let delta: number, resultText: string;
    if (dVal === 21) {
      await updateBalance(message.guild!.id, message.author.id, amount!);
      delta = 0;
      resultText = "🤝 무승부 (블랙잭 vs 블랙잭)";
    } else {
      await updateBalance(message.guild!.id, message.author.id, amount! * 2);
      delta = amount!;
      resultText = "🎉 블랙잭! 승리!";
    }
    const updated = await getUser(message.guild!.id, message.author.id, message.author.username);
    message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(delta >= 0 ? 0xf59e0b : 0x6b7280)
          .setTitle("🃏 블랙잭")
          .addFields(
            { name: "내 패", value: `${bjHandStr(player)} (${pVal})`, inline: false },
            { name: "딜러 패", value: `${bjHandStr(dealer)} (${dVal})`, inline: false },
            { name: "결과", value: resultText, inline: true },
            { name: "손익", value: fmt(delta), inline: true },
            { name: "현재 잔액", value: `${updated.balance.toLocaleString()}원`, inline: true },
          ),
      ],
    });
    return;
  }

  bjGames.set(message.author.id, {
    deck,
    player,
    dealer,
    bet: amount!,
    guildId: message.guild!.id,
  });
  activeGamblers.add(message.author.id);

  message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("🃏 블랙잭")
        .addFields(
          { name: "내 패", value: `${bjHandStr(player)} (${pVal})`, inline: false },
          { name: "딜러 패", value: bjHandStr(dealer, true), inline: false },
        )
        .setFooter({ text: "버튼을 눌러 진행하세요." }),
    ],
    components: [buildBjRow(message.author.id)],
  });
}

export async function handleBjButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split("_");
  const action = parts[1];
  const userId = parts[2];

  if (interaction.user.id !== userId) {
    interaction.reply({ content: "❌ 이 게임은 당신의 게임이 아닙니다.", ephemeral: true });
    return;
  }

  const game = bjGames.get(userId);
  if (!game) {
    interaction.update({ components: [] });
    return;
  }

  if (action === "hit") {
    game.player.push(game.deck.pop()!);
    const val = bjHandVal(game.player);

    if (val > 21) {
      bjGames.delete(userId);
      activeGamblers.delete(userId);
      const updated = await getUser(game.guildId, userId, interaction.user.username);
      interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("🃏 블랙잭")
            .addFields(
              { name: "내 패", value: `${bjHandStr(game.player)} (${val})`, inline: false },
              {
                name: "딜러 패",
                value: `${bjHandStr(game.dealer)} (${bjHandVal(game.dealer)})`,
                inline: false,
              },
              { name: "결과", value: "💥 버스트! 패배", inline: true },
              { name: "손익", value: fmt(-game.bet), inline: true },
              { name: "현재 잔액", value: `${updated.balance.toLocaleString()}원`, inline: true },
            ),
        ],
        components: [],
      });
      return;
    }

    interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle("🃏 블랙잭")
          .addFields(
            { name: "내 패", value: `${bjHandStr(game.player)} (${val})`, inline: false },
            { name: "딜러 패", value: bjHandStr(game.dealer, true), inline: false },
          )
          .setFooter({ text: "버튼을 눌러 진행하세요." }),
      ],
      components: [buildBjRow(userId)],
    });
    return;
  }

  if (action === "stand") {
    bjGames.delete(userId);
    activeGamblers.delete(userId);
    while (bjHandVal(game.dealer) < 17) game.dealer.push(game.deck.pop()!);

    const pVal = bjHandVal(game.player);
    const dVal = bjHandVal(game.dealer);

    let delta: number, resultText: string;
    if (dVal > 21 || pVal > dVal) {
      delta = game.bet;
      resultText = "🎉 승리!";
      await updateBalance(game.guildId, userId, game.bet * 2);
    } else if (pVal === dVal) {
      delta = 0;
      resultText = "🤝 무승부";
      await updateBalance(game.guildId, userId, game.bet);
    } else {
      delta = -game.bet;
      resultText = "😔 패배";
    }

    const updated = await getUser(game.guildId, userId, interaction.user.username);
    interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(delta > 0 ? 0x22c55e : delta === 0 ? 0x6b7280 : 0xef4444)
          .setTitle("🃏 블랙잭")
          .addFields(
            { name: "내 패", value: `${bjHandStr(game.player)} (${pVal})`, inline: false },
            { name: "딜러 패", value: `${bjHandStr(game.dealer)} (${dVal})`, inline: false },
            { name: "결과", value: resultText, inline: true },
            { name: "손익", value: fmt(delta), inline: true },
            { name: "현재 잔액", value: `${updated.balance.toLocaleString()}원`, inline: true },
          ),
      ],
      components: [],
    });
  }
}
