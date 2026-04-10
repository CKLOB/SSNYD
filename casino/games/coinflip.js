import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getUser, updateBalance } from "../../db.js";
import { sleep, parseBet, fmt, activeGamblers } from "./shared.js";

const CF_HEADS_GIF =
  "https://cdn.discordapp.com/attachments/1481328528833380454/1481872541520892014/202603131311_3.gif";
const CF_TAILS_GIF =
  "https://cdn.discordapp.com/attachments/1481328528833380454/1481872528333996154/202603131311_2.gif";

async function handleCoinflip(message, args) {
  const user = await getUser(message.guild.id, message.author.id, message.author.username);
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
  const choice = parts[1];
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

  await updateBalance(interaction.guildId, userId, delta);
  const updated = await getUser(interaction.guildId, userId, interaction.user.username);
  const gifUrl = result === "heads" ? CF_HEADS_GIF : CF_TAILS_GIF;

  await interaction.deferUpdate();
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
          {
            name: "선택",
            value: choice === "heads" ? "앞면 🪙" : "뒷면 💀",
            inline: true,
          },
          {
            name: "결과",
            value: result === "heads" ? "앞면 🪙" : "뒷면 💀",
            inline: true,
          },
          { name: "판정", value: win ? "🎉 승리!" : "😔 패배", inline: true },
          { name: "베팅", value: `${amount.toLocaleString()}원`, inline: true },
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

export { handleCoinflip, handleCoinflipButton };
