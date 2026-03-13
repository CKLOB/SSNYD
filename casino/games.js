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
  if (amount > balance) return { error: "❌ 잔액이 부족합니다" };
  return { amount };
}

function fmt(n) {
  return (n >= 0 ? "+" : "") + n.toLocaleString() + "원";
}

// ─── COINFLIP ────────────────────────────────────────────────────────────────

const CF_HEADS_GIF = "https://cdn.discordapp.com/attachments/1481328528833380454/1481872541520892014/202603131311_3.gif";
const CF_TAILS_GIF = "https://cdn.discordapp.com/attachments/1481328528833380454/1481872528333996154/202603131311_2.gif";

async function handleCoinflip(message, args) {
  const user = await getUser(message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) return message.reply(error);

  const uid = message.author.id;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cf_heads_${uid}_${amount}`)
      .setLabel("앞면")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`cf_tails_${uid}_${amount}`)
      .setLabel("뒷면")
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("🪙 코인플립")
    .setDescription(`베팅 금액: **${amount.toLocaleString()}원**\n앞면 / 뒷면 중 선택하세요.`);

  activeGamblers.add(uid);
  message.reply({ embeds: [embed], components: [row] });
}

async function handleCoinflipButton(interaction) {
  const parts = interaction.customId.split("_");
  const choice = parts[1]; // "heads" or "tails"
  const userId = parts[2];
  const amount = parseInt(parts[3]);

  if (interaction.user.id !== userId)
    return interaction.reply({
      content: "❌ 이 게임은 당신의 게임이 아닙니다.",
      ephemeral: true,
    });

  const result = Math.random() < 0.5 ? "heads" : "tails";
  const win = choice === result;
  const delta = win ? amount : -amount;

  await updateBalance(userId, delta);
  const updated = await getUser(userId, interaction.user.username);

  const gifUrl = result === "heads" ? CF_HEADS_GIF : CF_TAILS_GIF;

  await interaction.deferUpdate();

  // GIF 표시
  const gifEmbed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("🪙 코인플립")
    .setDescription("코인이 돌아가고 있습니다...")
    .setImage(gifUrl);

  await interaction.editReply({ embeds: [gifEmbed], components: [] });
  await sleep(2000);

  // 결과 표시
  const resultEmbed = new EmbedBuilder()
    .setColor(win ? 0x22c55e : 0xef4444)
    .setTitle("🪙 코인플립")
    .addFields(
      { name: "선택", value: choice === "heads" ? "앞면 🪙" : "뒷면 💀", inline: true },
      { name: "결과", value: result === "heads" ? "앞면 🪙" : "뒷면 💀", inline: true },
      { name: "판정", value: win ? "🎉 승리!" : "😔 패배", inline: true },
      { name: "베팅", value: `${amount.toLocaleString()}원`, inline: true },
      { name: "손익", value: fmt(delta), inline: true },
      { name: "현재 잔액", value: `${updated.balance.toLocaleString()}원`, inline: true },
    );

  await interaction.editReply({ embeds: [resultEmbed] });
  activeGamblers.delete(userId);
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
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bj_stand_${userId}`)
      .setLabel("스탠드")
      .setStyle(ButtonStyle.Secondary),
  );
}

const bjGames = new Map();
const activeGamblers = new Set();

function isGambling(userId) {
  return activeGamblers.has(userId);
}

async function handleBlackjack(message, args) {
  if (bjGames.has(message.author.id))
    return message.reply("❌ 이미 진행 중인 블랙잭 게임이 있습니다.");

  const user = await getUser(message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) return message.reply(error);

  await updateBalance(message.author.id, -amount);

  const deck = createDeck();
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];
  const pVal = bjHandVal(player);
  const dVal = bjHandVal(dealer);

  if (pVal === 21) {
    let delta, resultText;
    if (dVal === 21) {
      await updateBalance(message.author.id, amount);
      delta = 0;
      resultText = "🤝 무승부 (블랙잭 vs 블랙잭)";
    } else {
      await updateBalance(message.author.id, amount * 2);
      delta = amount;
      resultText = "🎉 블랙잭! 승리!";
    }
    const updated = await getUser(message.author.id, message.author.username);
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
  activeGamblers.add(message.author.id);

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
      activeGamblers.delete(userId);
      const updated = await getUser(userId, interaction.user.username);
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
    activeGamblers.delete(userId);
    while (bjHandVal(game.dealer) < 17) game.dealer.push(game.deck.pop());

    const pVal = bjHandVal(game.player);
    const dVal = bjHandVal(game.dealer);

    let delta, resultText;
    if (dVal > 21 || pVal > dVal) {
      delta = game.bet;
      resultText = "🎉 승리!";
      await updateBalance(userId, game.bet * 2);
    } else if (pVal === dVal) {
      delta = 0;
      resultText = "🤝 무승부";
      await updateBalance(userId, game.bet);
    } else {
      delta = -game.bet;
      resultText = "😔 패배";
    }

    const updated = await getUser(userId, interaction.user.username);
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
  const user = await getUser(message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) return message.reply(error);

  const uid = message.author.id;
  const row = new ActionRowBuilder().addComponents(
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

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("🎴 바카라")
    .setDescription(
      `베팅 금액: **${amount.toLocaleString()}원**\n어디에 베팅할까요?`,
    );
  activeGamblers.add(message.author.id);
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

  const user = await getUser(userId, interaction.user.username);
  if (user.balance < amount) {
    activeGamblers.delete(userId);
    return interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("🎴 바카라")
          .setDescription("❌ 잔액이 부족합니다."),
      ],
      components: [],
    });
  }

  await updateBalance(userId, -amount);
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
    await updateBalance(userId, amount + delta);
  } else if (isTie) {
    delta = 0;
    await updateBalance(userId, amount);
  } else if (userWin) {
    delta = Math.floor(amount * 0.95);
    await updateBalance(userId, amount + delta);
  } else {
    delta = -amount;
  }

  const updated = await getUser(userId, interaction.user.username);
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
  activeGamblers.delete(userId);
}

// ─── ROULETTE ────────────────────────────────────────────────────────────────

const RED_NUMS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const ROULETTE_GIFS = [
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481972772111650930/202603132003.gif?ex=69b54232&is=69b3f0b2&hm=37b2d8ab6beafaa5a6f2d33089a4e841f5831605a1d2f269830c9ae1645d2f0b&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481973086520741908/202603132003_1.gif?ex=69b5427d&is=69b3f0fd&hm=aa35c593c6e9b329125ce5d7b1bd90db813625dc7aa62ddf1837bd1f1fc9c1d7&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481973579259187381/202603132003_2.gif?ex=69b542f3&is=69b3f173&hm=2dd76ef13f77757a8f08006b2d3594f2e0b50ec02d0c779b23ccf782129a9628&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481978496048955459/0313_1.gif?ex=69b54787&is=69b3f607&hm=2d49d5f057e8ae9208733a8e7609d12aa2e779ba20b24617e4b04506b05b8b24&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481979229712416868/0313_11.gif?ex=69b54836&is=69b3f6b6&hm=30d424e449f5713591996fde24355b1a7072fcd3c352750120800f875b2cfaf0&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481979461829136415/0313_12.gif?ex=69b5486d&is=69b3f6ed&hm=89c5527cd61c4b6d3b46c4f92a62a3208c8e4fa852c3714a6d3c32b39509cc01&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481979764406354011/0313_13.gif?ex=69b548b5&is=69b3f735&hm=630fb82c89b1a25f3131497dfea6cd435c8bbbaa9431a7286b94bd720cf361b5&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481979998305779803/0313_14.gif?ex=69b548ed&is=69b3f76d&hm=17f5174c6e3f8ee53ae0e62a39ecb2474db23527ae38300522089aaab47e4b0d&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481980290820866229/0313_15.gif?ex=69b54933&is=69b3f7b3&hm=6e5c30887d015b088485e49adadb83da76d885da89e0325c1f911b377d02647a&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481980504285909104/0313_16.gif?ex=69b54966&is=69b3f7e6&hm=57f933d655a9be72fd6aa8af6f0b60e9babdda68931d1fc0c62681a44732fc6a&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481980802224095335/0313_17.gif?ex=69b549ad&is=69b3f82d&hm=dadf48e46f5b203b303685f553c76a5023eaec667cf3d5ce00254fb63f19d728&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481981323315777567/0313_18.gif?ex=69b54a29&is=69b3f8a9&hm=97d743f6b947ab2776d7fdf2e5d77fbdee672e9dfbfc91b8fb2fbf003ca56341&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481981830935613521/0313_19.gif?ex=69b54aa2&is=69b3f922&hm=ba49f3f2c3d264ea1999cc323d8fca27e655640d9628ae8ddd026697aa0840bd&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481982207324196885/0313_110.gif?ex=69b54afc&is=69b3f97c&hm=ff63b9d827ba1b6fde8caf2d119efe63c1220bae92acb001e415c72ee546f4bc&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481982513210724473/0313_111.gif?ex=69b54b45&is=69b3f9c5&hm=0cec8213d3095692fcfaf575c4c883d91b7a1b6a29ba9bed1ed8fe76a2e88ff0&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481982835790319757/0313_112.gif?ex=69b54b91&is=69b3fa11&hm=23826f73f1d18b86c931b10caf4574cc7c5cd7deb33ba917c8ef608c4966e513&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481983190724771847/0313_113.gif?ex=69b54be6&is=69b3fa66&hm=2a608d21b5b9b5c3368fda6992e870d535c95c678d84e66c3c8f7411d5bb9295&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481983400024870973/0313_114.gif?ex=69b54c18&is=69b3fa98&hm=d1c799a308b30a50bce41eb4519c701a5cb981f5d3da13c0390cddff951a9c0b&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481983607580004462/0313_115.gif?ex=69b54c49&is=69b3fac9&hm=ff7e3761505535c4a845c3f1d3564890f7ff41dc4fb30c08e2d04433cf6f64cd&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481983930524766310/0313_116.gif?ex=69b54c96&is=69b3fb16&hm=670d6a9c0013fa681e64e7dde838dc73f4c66ffd8f7d823d4d1d757fefe149a1&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481984223412883477/0313_117.gif?ex=69b54cdc&is=69b3fb5c&hm=c4933999244a760d57e1a66305690f4782fd996183cd610edc3d1f7171944e74&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481984480200622120/0313_118.gif?ex=69b54d1a&is=69b3fb9a&hm=21683e2013b08dd08f2d9c722ae9ab14ed076bf9bfaa28f69196456b099cd8ff&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481984648249737389/0313_119.gif?ex=69b54d42&is=69b3fbc2&hm=0f82442be925eb8e8e74a585ed0c08bbb2edea9243341967ba8e8f4723eca812&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481984911211757628/0313_120.gif?ex=69b54d80&is=69b3fc00&hm=02aceef0c0ae002395569e01ccf154dea8e7ab61b7ae395edf8787ca8cf34457&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481985172990595242/0313_121.gif?ex=69b54dbf&is=69b3fc3f&hm=835e13de8b68a9372b8e9818907905f45e2125e6e95593f92ce279bc6da1c3b2&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481985329346117674/0313_122.gif?ex=69b54de4&is=69b3fc64&hm=625646eb91b609facba5cce29f32dfd64b573e81d3359a7a0885d24aea17409b&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481985578433118318/0313_123.gif?ex=69b54e1f&is=69b3fc9f&hm=3b955f3cc131fc0ddf73006953314de5d574b2fb2910c6a1c86889c1d34480b3&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481985754602274866/0313_124.gif?ex=69b54e49&is=69b3fcc9&hm=378c4497f65e3779b6708fa2706ce4ae644c26b1b69bbe907ff60e5afa3db02d&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481985897464463420/0313_125.gif?ex=69b54e6b&is=69b3fceb&hm=f23ecb33e334e7d89f8896f6c0ff16679c9d66d95a3fb479dc0472ff69345e47&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481986082911424675/0313_126.gif?ex=69b54e98&is=69b3fd18&hm=4c57b0cc6cd2051252ec09ac7389bb866a60c7249089b7461400ca5b9210edc8&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481986286343557331/0313_127.gif?ex=69b54ec8&is=69b3fd48&hm=1abaf09a3ea6ceee33aedde9ff43bd29462f2c8231c62a70b8cec735d7cfd7cb&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481986510055145503/0313_128.gif?ex=69b54efd&is=69b3fd7d&hm=ddf1b25045c3b473709d4a841ee1bf3b1a70ccd8c55f832193bb98d085c76004&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481986724878880918/0313_129.gif?ex=69b54f31&is=69b3fdb1&hm=667b0199ce06aef12c20b9fbb5acdbba9b161a6fdfb02f2d90208349b0567cd1&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481986918504730624/0313_130.gif?ex=69b54f5f&is=69b3fddf&hm=05e82738ff1be63109228ade6b9025e1771d72786afe3f2ca8c58493011809c6&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481987100789313546/0313_131.gif?ex=69b54f8a&is=69b3fe0a&hm=00343b2ad617716a408e2f229c37166e1b9d5f164cd5e32ca8a16d055159412a&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481987256918212608/0313_132.gif?ex=69b54fb0&is=69b3fe30&hm=6a940828898c93a30054483a06067af616023f8e93834e26620b70776708ba4c&",
  "https://cdn.discordapp.com/attachments/1481972735684120607/1481987493384687726/0313_133.gif?ex=69b54fe8&is=69b3fe68&hm=efe6cd1d76afe749e1893352c6cf3a441cb5c0ce7d4764538876ec8cf254e4c9&",
];

async function handleRoulette(message, args) {
  const user = await getUser(message.author.id, message.author.username);
  const { error, amount } = parseBet(args[0], user.balance);
  if (error) return message.reply(error);

  const uid = message.author.id;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rl_odd_${uid}_${amount}`).setLabel("홀").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rl_even_${uid}_${amount}`).setLabel("짝").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rl_black_${uid}_${amount}`).setLabel("검").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rl_red_${uid}_${amount}`).setLabel("빨").setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("룰렛")
    .setDescription(`베팅 금액: **${amount.toLocaleString()}원**\n홀 / 짝 / 검 / 빨 중 선택하세요.`);

  activeGamblers.add(uid);
  message.reply({ embeds: [embed], components: [row] });
}

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

  const user = await getUser(userId, interaction.user.username);
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

  await updateBalance(userId, -amount);

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

  if (win) await updateBalance(userId, amount * 2);

  const delta = win ? amount : -amount;
  const updated = await getUser(userId, interaction.user.username);
  const betLabel = { odd: "홀", even: "짝", black: "⚫ 검", red: "🔴 빨" }[
    betType
  ];

  await interaction.deferUpdate();

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("룰렛")
        .setImage(ROULETTE_GIFS[result])
        .setFooter({ text: "룰렛이 돌아가고 있습니다..." }),
    ],
    components: [],
  });
  await sleep(4000);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(win ? 0x22c55e : 0xef4444)
        .setTitle("🎡 룰렛")
        .setDescription(`> ${colorEmoji} **${result}** ${colorEmoji}`)
        .setImage(ROULETTE_GIFS[result])
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
  if (id.startsWith("cf_")) return handleCoinflipButton(interaction);
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
  isGambling,
};
