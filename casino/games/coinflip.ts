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
} from "./shared.js";
import { Ctx } from "../../ctx.js";

const CF_HEADS_GIF =
  "https://cdn.discordapp.com/attachments/1481328528833380454/1481872541520892014/202603131311_3.gif";
const CF_TAILS_GIF =
  "https://cdn.discordapp.com/attachments/1481328528833380454/1481872528333996154/202603131311_2.gif";

export async function handleCoinflip(ctx: Ctx, args: string[]): Promise<void> {
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
      .setCustomId(`cf_heads_${uid}_${amount}_${gid}`)
      .setLabel("앞면")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`cf_tails_${uid}_${amount}_${gid}`)
      .setLabel("뒷면")
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("🪙 코인플립")
    .setDescription(`베팅 금액: **${amount!.toLocaleString()}원**\n앞면 / 뒷면 중 선택하세요.`);

  ctx.reply({ embeds: [embed], components: [row] });
}

export async function handleCoinflipButton(interaction: ButtonInteraction): Promise<void> {
  const [, choice, userId, amountStr, gameId] = interaction.customId.split("_");
  const amount = parseInt(amountStr);
  if (!(await claimButton(interaction, userId, gameId))) return;

  try {
    await interaction.deferUpdate();

    const result = Math.random() < 0.5 ? "heads" : "tails";
    const win = choice === result;
    const delta = win ? amount : -amount;

    // 베팅 후 송금 등으로 잔액이 줄었을 수 있어서 정산 시점에 다시 확인한다 (예전엔 잔액이 음수가 될 수 있었다)
    const balance = await tryAdjustBalance(interaction.guildId!, userId, delta, amount);
    if (balance === null) {
      await interaction.editReply({ embeds: [insufficientEmbed("🪙 코인플립")], components: [] });
      return;
    }
    const gifUrl = result === "heads" ? CF_HEADS_GIF : CF_TAILS_GIF;

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3b82f6)
          .setTitle("🪙 코인플립")
          .setDescription("코인이 돌아가고 있습니다...")
          .setImage(gifUrl),
      ],
      components: [],
    });
    await sleep(2000);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(win ? 0x22c55e : 0xef4444)
          .setTitle("🪙 코인플립")
          .addFields(
            { name: "선택", value: choice === "heads" ? "앞면 🪙" : "뒷면 💀", inline: true },
            { name: "결과", value: result === "heads" ? "앞면 🪙" : "뒷면 💀", inline: true },
            { name: "판정", value: win ? "🎉 승리!" : "😔 패배", inline: true },
            { name: "베팅", value: `${amount.toLocaleString()}원`, inline: true },
            { name: "손익", value: fmt(delta), inline: true },
            { name: "현재 잔액", value: `${balance.toLocaleString()}원`, inline: true },
          ),
      ],
    });
  } finally {
    endGame(userId);
  }
}
