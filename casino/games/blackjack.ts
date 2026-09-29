import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  MessageFlags,
} from "discord.js";
import {
  getUser,
  getBalance,
  updateBalance,
  tryAdjustBalance,
  updateBalanceAndGet,
} from "../../db.js";
import { parseBet, fmt, startGame, endGame, createDeck, Card } from "./shared.js";
import { Ctx } from "../../ctx.js";

interface BjGame {
  id: string;
  deck: Card[];
  player: Card[];
  dealer: Card[];
  bet: number;
  guildId: string;
  createdAt: number;
}

const BJ_TTL_MS = 15 * 60 * 1000;
const bjGames = new Map<string, BjGame>();

setInterval(
  () => {
    const now = Date.now();
    for (const [userId, game] of bjGames) {
      if (now - game.createdAt > BJ_TTL_MS) {
        bjGames.delete(userId);
        endGame(userId);
        updateBalance(game.guildId, userId, game.bet).catch((e: Error) => {
          console.error(`[BJ TTL] 환불 실패 (user ${userId}):`, e.message);
        });
      }
    }
  },
  5 * 60 * 1000,
);

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

function buildBjRow(userId: string, gameId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj_hit_${userId}_${gameId}`)
      .setLabel("히트")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bj_stand_${userId}_${gameId}`)
      .setLabel("스탠드")
      .setStyle(ButtonStyle.Secondary),
  );
}

export async function handleBlackjack(ctx: Ctx, args: string[]): Promise<void> {
  if (bjGames.has(ctx.authorId)) {
    ctx.reply("❌ 이미 진행 중인 블랙잭 게임이 있습니다.");
    return;
  }

  const user = await getUser(ctx.guildId!, ctx.authorId, ctx.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) {
    ctx.reply(error);
    return;
  }

  // 잔액 확인과 차감을 한 쿼리로 (그 사이 송금으로 잔액이 줄어도 음수가 되지 않게)
  if ((await tryAdjustBalance(ctx.guildId!, ctx.authorId, -amount!, amount!)) === null) {
    ctx.reply("❌ 잔액이 부족합니다");
    return;
  }

  const deck = createDeck();
  const player = [deck.pop()!, deck.pop()!];
  const dealer = [deck.pop()!, deck.pop()!];
  const pVal = bjHandVal(player);
  const dVal = bjHandVal(dealer);

  if (pVal === 21) {
    let delta: number, resultText: string, balance: number;
    if (dVal === 21) {
      balance = await updateBalanceAndGet(ctx.guildId!, ctx.authorId, amount!);
      delta = 0;
      resultText = "🤝 무승부 (블랙잭 vs 블랙잭)";
    } else {
      balance = await updateBalanceAndGet(ctx.guildId!, ctx.authorId, amount! * 2);
      delta = amount!;
      resultText = "🎉 블랙잭! 승리!";
    }
    ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(delta >= 0 ? 0xf59e0b : 0x6b7280)
          .setTitle("🃏 블랙잭")
          .addFields(
            { name: "내 패", value: `${bjHandStr(player)} (${pVal})`, inline: false },
            { name: "딜러 패", value: `${bjHandStr(dealer)} (${dVal})`, inline: false },
            { name: "결과", value: resultText, inline: true },
            { name: "손익", value: fmt(delta), inline: true },
            { name: "현재 잔액", value: `${balance.toLocaleString()}원`, inline: true },
          ),
      ],
    });
    return;
  }

  // 방치된 게임은 아래 TTL 정리에서 15분 뒤 환불되므로 도박 잠금도 그보다 조금 길게 잡는다
  const gameId = startGame(ctx.authorId, BJ_TTL_MS + 5 * 60 * 1000);
  bjGames.set(ctx.authorId, {
    id: gameId,
    deck,
    player,
    dealer,
    bet: amount!,
    guildId: ctx.guildId!,
    createdAt: Date.now(),
  });

  ctx.reply({
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
    components: [buildBjRow(ctx.authorId, gameId)],
  });
}

export async function handleBjButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, userId, gameId] = interaction.customId.split("_");

  if (interaction.user.id !== userId) {
    interaction.reply({
      content: "❌ 이 게임은 당신의 게임이 아닙니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  // 예전 게임 메시지의 버튼으로 지금 게임을 조작하지 못하게 게임 id까지 맞춰 본다
  const game = bjGames.get(userId);
  if (!game || game.id !== gameId) {
    await interaction.editReply({ components: [] });
    return;
  }

  if (action === "hit") {
    game.player.push(game.deck.pop()!);
    const val = bjHandVal(game.player);

    if (val > 21) {
      bjGames.delete(userId);
      endGame(userId);
      const balance = await getBalance(game.guildId, userId);
      await interaction.editReply({
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
              { name: "현재 잔액", value: `${balance.toLocaleString()}원`, inline: true },
            ),
        ],
        components: [],
      });
      return;
    }

    await interaction.editReply({
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
      components: [buildBjRow(userId, gameId)],
    });
    return;
  }

  if (action === "stand") {
    bjGames.delete(userId);
    endGame(userId);
    while (bjHandVal(game.dealer) < 17) game.dealer.push(game.deck.pop()!);

    const pVal = bjHandVal(game.player);
    const dVal = bjHandVal(game.dealer);

    let delta: number, resultText: string, balance: number;
    if (dVal > 21 || pVal > dVal) {
      delta = game.bet;
      resultText = "🎉 승리!";
      balance = await updateBalanceAndGet(game.guildId, userId, game.bet * 2);
    } else if (pVal === dVal) {
      delta = 0;
      resultText = "🤝 무승부";
      balance = await updateBalanceAndGet(game.guildId, userId, game.bet);
    } else {
      delta = -game.bet;
      resultText = "😔 패배";
      balance = await getBalance(game.guildId, userId);
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(delta > 0 ? 0x22c55e : delta === 0 ? 0x6b7280 : 0xef4444)
          .setTitle("🃏 블랙잭")
          .addFields(
            { name: "내 패", value: `${bjHandStr(game.player)} (${pVal})`, inline: false },
            { name: "딜러 패", value: `${bjHandStr(game.dealer)} (${dVal})`, inline: false },
            { name: "결과", value: resultText, inline: true },
            { name: "손익", value: fmt(delta), inline: true },
            { name: "현재 잔액", value: `${balance.toLocaleString()}원`, inline: true },
          ),
      ],
      components: [],
    });
  }
}
