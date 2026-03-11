const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { getUser, updateBalance } = require("./db");

function parseBet(arg, balance) {
  if (!arg) return { error: "❌ 베팅 금액을 입력하세요." };
  const lower = arg.toLowerCase();
  let amount;

  if (lower === "올인" || lower === "all") {
    amount = balance;
  } else if (lower === "반" || lower === "half") {
    amount = Math.floor(balance / 2);
  } else {
    amount = parseInt(arg);
    if (isNaN(amount)) return { error: "❌ 올바른 베팅 금액을 입력하세요." };
  }

  if (amount < 1000) return { error: "❌ 최소 베팅 금액은 1,000원입니다." };
  if (amount > balance) return { error: "❌ 잔액이 부족합니다." };
  return { amount };
}

function fmt(n) {
  return (n >= 0 ? "+" : "") + n.toLocaleString() + "원";
}

// ─── COINFLIP ────────────────────────────────────────────────────────────────

async function handleCoinflip(message, args) {
  const user = getUser(message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) return message.reply(error);

  const win = Math.random() < 0.5;
  const delta = win ? amount : -amount;
  updateBalance(message.author.id, delta);
  const updated = getUser(message.author.id, message.author.username);

  const embed = new EmbedBuilder()
    .setColor(win ? 0x22c55e : 0xef4444)
    .setTitle("🪙 코인플립")
    .addFields(
      {
        name: "결과",
        value: win ? "앞면 🪙 승리!" : "뒷면 💀 패배",
        inline: false,
      },
      { name: "베팅", value: `${amount.toLocaleString()}원`, inline: true },
      { name: "손익", value: fmt(delta), inline: true },
      {
        name: "현재 잔액",
        value: `${updated.balance.toLocaleString()}원`,
        inline: true,
      },
    );
  message.reply({ embeds: [embed] });
}

// ─── BLACKJACK ───────────────────────────────────────────────────────────────

const SUITS = ["♠", "♥", "♦", "♣"];
const VALUES = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const v of VALUES) deck.push({ s, v });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function bjVal(card) {
  if (card.v === "A") return 11;
  if (["J", "Q", "K"].includes(card.v)) return 10;
  return parseInt(card.v);
}

function bjHandVal(hand) {
  let total = hand.reduce((s, c) => s + bjVal(c), 0);
  let aces = hand.filter((c) => c.v === "A").length;
  while (total > 21 && aces-- > 0) total -= 10;
  return total;
}

function bjHandStr(hand, hideSecond = false) {
  return hand
    .map((c, i) => (hideSecond && i === 1 ? "🂠" : `${c.s}${c.v}`))
    .join("  ");
}

function buildBjRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj_hit_${userId}`)
      .setLabel("히트")
      .setEmoji("🃏")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`bj_stand_${userId}`)
      .setLabel("스탠드")
      .setEmoji("✋")
      .setStyle(ButtonStyle.Danger),
  );
}

const bjGames = new Map();

async function handleBlackjack(message, args) {
  if (bjGames.has(message.author.id))
    return message.reply("❌ 이미 진행 중인 블랙잭 게임이 있습니다.");

  const user = getUser(message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) return message.reply(error);

  updateBalance(message.author.id, -amount);

  const deck = createDeck();
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];
  const pVal = bjHandVal(player);
  const dVal = bjHandVal(dealer);

  if (pVal === 21) {
    let delta, resultText;
    if (dVal === 21) {
      updateBalance(message.author.id, amount);
      delta = 0;
      resultText = "🤝 무승부 (블랙잭 vs 블랙잭)";
    } else {
      updateBalance(message.author.id, amount * 2);
      delta = amount;
      resultText = "🎉 블랙잭! 승리!";
    }
    const updated = getUser(message.author.id, message.author.username);
    const embed = new EmbedBuilder()
      .setColor(delta >= 0 ? 0xf59e0b : 0x6b7280)
      .setTitle("🃏 블랙잭")
      .addFields(
        {
          name: "내 패",
          value: `${bjHandStr(player)} (${pVal})`,
          inline: false,
        },
        {
          name: "딜러 패",
          value: `${bjHandStr(dealer)} (${dVal})`,
          inline: false,
        },
        { name: "결과", value: resultText, inline: true },
        { name: "손익", value: fmt(delta), inline: true },
        {
          name: "현재 잔액",
          value: `${updated.balance.toLocaleString()}원`,
          inline: true,
        },
      );
    return message.reply({ embeds: [embed] });
  }

  bjGames.set(message.author.id, { deck, player, dealer, bet: amount });

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("🃏 블랙잭")
    .addFields(
      { name: "내 패", value: `${bjHandStr(player)} (${pVal})`, inline: false },
      { name: "딜러 패", value: bjHandStr(dealer, true), inline: false },
    )
    .setFooter({ text: "버튼을 눌러 진행하세요." });
  message.reply({
    embeds: [embed],
    components: [buildBjRow(message.author.id)],
  });
}

async function handleBjButton(interaction) {
  const parts = interaction.customId.split("_");
  const action = parts[1];
  const userId = parts[2];

  if (interaction.user.id !== userId)
    return interaction.reply({
      content: "❌ 이 게임은 당신의 게임이 아닙니다.",
      ephemeral: true,
    });

  const game = bjGames.get(userId);
  if (!game) return interaction.update({ components: [] });

  if (action === "hit") {
    game.player.push(game.deck.pop());
    const val = bjHandVal(game.player);

    if (val > 21) {
      bjGames.delete(userId);
      const updated = getUser(userId, interaction.user.username);
      const embed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("🃏 블랙잭")
        .addFields(
          {
            name: "내 패",
            value: `${bjHandStr(game.player)} (${val})`,
            inline: false,
          },
          {
            name: "딜러 패",
            value: `${bjHandStr(game.dealer)} (${bjHandVal(game.dealer)})`,
            inline: false,
          },
          { name: "결과", value: "💥 버스트! 패배", inline: true },
          { name: "손익", value: fmt(-game.bet), inline: true },
          {
            name: "현재 잔액",
            value: `${updated.balance.toLocaleString()}원`,
            inline: true,
          },
        );
      return interaction.update({ embeds: [embed], components: [] });
    }

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("🃏 블랙잭")
      .addFields(
        {
          name: "내 패",
          value: `${bjHandStr(game.player)} (${val})`,
          inline: false,
        },
        { name: "딜러 패", value: bjHandStr(game.dealer, true), inline: false },
      )
      .setFooter({ text: "버튼을 눌러 진행하세요." });
    return interaction.update({
      embeds: [embed],
      components: [buildBjRow(userId)],
    });
  }

  if (action === "stand") {
    bjGames.delete(userId);
    while (bjHandVal(game.dealer) < 17) game.dealer.push(game.deck.pop());

    const pVal = bjHandVal(game.player);
    const dVal = bjHandVal(game.dealer);

    let delta, resultText;
    if (dVal > 21 || pVal > dVal) {
      delta = game.bet;
      resultText = "🎉 승리!";
      updateBalance(userId, game.bet * 2);
    } else if (pVal === dVal) {
      delta = 0;
      resultText = "🤝 무승부";
      updateBalance(userId, game.bet);
    } else {
      delta = -game.bet;
      resultText = "😔 패배";
    }

    const updated = getUser(userId, interaction.user.username);
    const embed = new EmbedBuilder()
      .setColor(delta > 0 ? 0x22c55e : delta === 0 ? 0x6b7280 : 0xef4444)
      .setTitle("🃏 블랙잭")
      .addFields(
        {
          name: "내 패",
          value: `${bjHandStr(game.player)} (${pVal})`,
          inline: false,
        },
        {
          name: "딜러 패",
          value: `${bjHandStr(game.dealer)} (${dVal})`,
          inline: false,
        },
        { name: "결과", value: resultText, inline: true },
        { name: "손익", value: fmt(delta), inline: true },
        {
          name: "현재 잔액",
          value: `${updated.balance.toLocaleString()}원`,
          inline: true,
        },
      );
    return interaction.update({ embeds: [embed], components: [] });
  }
}

// ─── BACCARAT ────────────────────────────────────────────────────────────────

function bacVal(card) {
  if (["10", "J", "Q", "K"].includes(card.v)) return 0;
  if (card.v === "A") return 1;
  return parseInt(card.v);
}

function bacHandVal(hand) {
  return hand.reduce((s, c) => s + bacVal(c), 0) % 10;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cardStr(cards) {
  return cards.map((c) => `${c.s}${c.v}`).join("  ");
}

function runBaccarat() {
  const deck = createDeck();
  const player = [deck.pop(), deck.pop()];
  const banker = [deck.pop(), deck.pop()];

  let pVal = bacHandVal(player);
  let bVal = bacHandVal(banker);

  if (pVal <= 5 && pVal < 8 && bVal < 8) {
    const pThird = deck.pop();
    player.push(pThird);
    pVal = bacHandVal(player);
    const pt = bacVal(pThird);

    if (bVal <= 2) banker.push(deck.pop());
    else if (bVal === 3 && pt !== 8) banker.push(deck.pop());
    else if (bVal === 4 && pt >= 2 && pt <= 7) banker.push(deck.pop());
    else if (bVal === 5 && pt >= 4 && pt <= 7) banker.push(deck.pop());
    else if (bVal === 6 && pt >= 6 && pt <= 7) banker.push(deck.pop());
  } else if (bVal <= 5 && bVal < 8 && pVal >= 6) {
    banker.push(deck.pop());
  }

  bVal = bacHandVal(banker);
  pVal = bacHandVal(player);
  const winner = pVal > bVal ? "player" : bVal > pVal ? "banker" : "tie";
  return { player, banker, pVal, bVal, winner };
}

async function handleBaccarat(message, args) {
  const user = getUser(message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) return message.reply(error);

  const uid = message.author.id;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bac_player_${uid}_${amount}`)
      .setLabel("플레이어")
      .setEmoji("👤")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`bac_tie_${uid}_${amount}`)
      .setLabel("타이")
      .setEmoji("🤝")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bac_banker_${uid}_${amount}`)
      .setLabel("뱅커")
      .setEmoji("🏦")
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("🎴 바카라")
    .setDescription(
      `베팅 금액: **${amount.toLocaleString()}원**\n어디에 베팅할까요?`,
    );
  message.reply({ embeds: [embed], components: [row] });
}

async function handleBaccaratButton(interaction) {
  const parts = interaction.customId.split("_");
  const side = parts[1];
  const userId = parts[2];
  const amount = parseInt(parts[3]);

  if (interaction.user.id !== userId)
    return interaction.reply({
      content: "❌ 이 게임은 당신의 게임이 아닙니다.",
      ephemeral: true,
    });

  const user = getUser(userId, interaction.user.username);
  if (user.balance < amount)
    return interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("🎴 바카라")
          .setDescription("❌ 잔액이 부족합니다."),
      ],
      components: [],
    });

  updateBalance(userId, -amount);
  const { player, banker, pVal, bVal, winner } = runBaccarat();

  const isTie = winner === "tie";
  const userWin = side === winner;
  const sideLabel = {
    player: "👤 플레이어",
    banker: "🏦 뱅커",
    tie: "🤝 타이",
  }[side];

  let delta;
  if (isTie && side === "tie") {
    delta = amount * 8;
    updateBalance(userId, amount + delta);
  } else if (isTie) {
    delta = 0;
    updateBalance(userId, amount);
  } else if (userWin) {
    delta = Math.floor(amount * 0.95);
    updateBalance(userId, amount + delta);
  } else {
    delta = -amount;
  }

  const updated = getUser(userId, interaction.user.username);
  const resultText = isTie
    ? side === "tie"
      ? "🎉 타이 적중!"
      : "🤝 타이 (베팅 반환)"
    : userWin
      ? "🎉 승리!"
      : "😔 패배";
  const resultColor =
    userWin || (isTie && side === "tie")
      ? 0x22c55e
      : isTie
        ? 0x6b7280
        : 0xef4444;

  // 애니메이션: 카드 배분 → 플레이어 공개 → 뱅커 공개 → 결과
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
          {
            name: "👤 플레이어",
            value: cardStr(player.slice(0, 1)) + "  🂠",
            inline: true,
          },
          {
            name: "🏦 뱅커",
            value: cardStr(banker.slice(0, 1)) + "  🂠",
            inline: true,
          },
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
            player.length > 2 || banker.length > 2
              ? "3번째 카드 배분 중..."
              : "결과 집계 중...",
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
            {
              name: "👤 플레이어",
              value: `${cardStr(player)}  **(${pVal})**`,
              inline: true,
            },
            {
              name: "🏦 뱅커",
              value: `${cardStr(banker)}  **(${bVal})**`,
              inline: true,
            },
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
          {
            name: "👤 플레이어",
            value: `${cardStr(player)}  **(${pVal})**`,
            inline: true,
          },
          {
            name: "🏦 뱅커",
            value: `${cardStr(banker)}  **(${bVal})**`,
            inline: true,
          },
          { name: "내 베팅", value: sideLabel, inline: true },
          { name: "판정", value: resultText, inline: true },
          { name: "손익", value: fmt(delta), inline: true },
          {
            name: "현재 잔액",
            value: `${updated.balance.toLocaleString()}원`,
            inline: true,
          },
        ),
    ],
  });
}

// ─── ROULETTE ────────────────────────────────────────────────────────────────

const RED_NUMS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

async function handleRoulette(message) {
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("🎡 룰렛")
    .setDescription("🔧 현재 룰렛은 **점검중**입니다.\n잠시 후 다시 이용해주세요.");
  return message.reply({ embeds: [embed] });
}

/*
async function handleRouletteOriginal(message, args) {
  const user = getUser(message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) return message.reply(error);

  const uid = message.author.id;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rl_odd_${uid}_${amount}`)
      .setLabel("홀")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rl_even_${uid}_${amount}`)
      .setLabel("짝")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rl_black_${uid}_${amount}`)
      .setLabel("검")
      .setEmoji("⚫")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`rl_red_${uid}_${amount}`)
      .setLabel("빨")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),
  );

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("🎡 룰렛")
    .setDescription(
      `베팅 금액: **${amount.toLocaleString()}원**\n홀 / 짝 / ⚫ 검 / 🔴 빨 중 선택하세요.`,
    );
  message.reply({ embeds: [embed], components: [row] });
}
*/

async function handleRouletteButton(interaction) {
  const parts = interaction.customId.split("_");
  const betType = parts[1];
  const userId = parts[2];
  const amount = parseInt(parts[3]);

  if (interaction.user.id !== userId)
    return interaction.reply({
      content: "❌ 이 게임은 당신의 게임이 아닙니다.",
      ephemeral: true,
    });

  const user = getUser(userId, interaction.user.username);
  if (user.balance < amount)
    return interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("🎡 룰렛")
          .setDescription("❌ 잔액이 부족합니다."),
      ],
      components: [],
    });

  updateBalance(userId, -amount);

  const result = Math.floor(Math.random() * 37);
  const colorEmoji = result === 0 ? "🟢" : RED_NUMS.has(result) ? "🔴" : "⚫";

  const win =
    betType === "odd"
      ? result !== 0 && result % 2 === 1
      : betType === "even"
        ? result !== 0 && result % 2 === 0
        : betType === "red"
          ? RED_NUMS.has(result)
          : betType === "black"
            ? result !== 0 && !RED_NUMS.has(result)
            : false;

  if (win) updateBalance(userId, amount * 2);

  const delta = win ? amount : -amount;
  const updated = getUser(userId, interaction.user.username);
  const betLabel = { odd: "홀", even: "짝", black: "⚫ 검", red: "🔴 빨" }[
    betType
  ];

  const numColor = (n) => (n === 0 ? "🟢" : RED_NUMS.has(n) ? "🔴" : "⚫");
  const spinLine = (nums) =>
    nums.map((n) => `${numColor(n)}**${n}**`).join("  ");

  await interaction.deferUpdate();

  const delays = [200, 200, 200, 200, 200, 350, 350, 500, 650, 850];
  for (let i = 0; i < delays.length; i++) {
    const shown = Array.from({ length: 5 }, () =>
      Math.floor(Math.random() * 37),
    );
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle("🎡 룰렛")
          .setDescription(`🎡  ${spinLine(shown)}  🎡`)
          .setFooter({ text: "룰렛이 돌아가고 있습니다..." }),
      ],
      components: [],
    });
    await sleep(delays[i]);
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(win ? 0x22c55e : 0xef4444)
        .setTitle("🎡 룰렛")
        .setDescription(`> ${colorEmoji} **${result}** ${colorEmoji}`)
        .addFields(
          { name: "베팅", value: betLabel, inline: true },
          { name: "판정", value: win ? "🎉 승리!" : "😔 패배", inline: true },
          { name: "손익", value: fmt(delta), inline: true },
          {
            name: "현재 잔액",
            value: `${updated.balance.toLocaleString()}원`,
            inline: true,
          },
        ),
    ],
  });
}

async function handleButtonInteraction(interaction) {
  const id = interaction.customId;
  if (id.startsWith("bj_")) return handleBjButton(interaction);
  if (id.startsWith("bac_")) return handleBaccaratButton(interaction);
  if (id.startsWith("rl_")) return handleRouletteButton(interaction);
}

module.exports = {
  handleCoinflip,
  handleBlackjack,
  handleBaccarat,
  handleRoulette,
  handleButtonInteraction,
};
