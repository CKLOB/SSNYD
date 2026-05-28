import { PermissionFlagsBits, Message, ChatInputCommandInteraction, GuildMember } from "discord.js";
import {
  handleAttendance,
  handleWork,
  handleBalance,
  handleSupport,
  handleRanking,
  handleTransfer,
} from "./economy.js";
import {
  handleCoinflip,
  handleBlackjack,
  handleBaccarat,
  handleRoulette,
  handleButtonInteraction,
  isGambling,
} from "./games.js";
import { getGamblingEnabled, setGamblingEnabled } from "../db.js";
import { ctxFromMessage, ctxFromInteraction } from "../ctx.js";

const GAMBLING_CMDS = new Set([
  "!코인",
  "!블랙잭",
  "!바카라",
  "!룰렛",
  "!출석",
  "!일",
  "!노동",
  "!지원금",
]);

async function handleGamblingToggle(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("❌ 이 명령어는 서버에서만 사용할 수 있습니다.");
    return;
  }
  const subCmd = args[0]?.toLowerCase() || "";

  if (subCmd === "on" || subCmd === "off") {
    if (!message.member!.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply("❌ 서버 관리자 권한이 필요합니다.");
      return;
    }
    const enable = subCmd === "on";
    await setGamblingEnabled(message.guild.id, enable);
    await message.reply(
      enable ? "✅ 도박 기능이 **활성화**되었습니다." : "🔒 도박 기능이 **비활성화**되었습니다.",
    );
  } else {
    const enabled = await getGamblingEnabled(message.guild.id);
    await message.reply(
      `🎰 현재 도박 기능: ${enabled ? "**활성화** ✅" : "**비활성화** 🔒"}\n사용법: \`!도박 on\` / \`!도박 off\``,
    );
  }
}

export async function handleCasino(message: Message): Promise<boolean> {
  const parts = message.content.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  const ALL_CASINO_CMDS = new Set([...GAMBLING_CMDS, "!도박", "!잔액", "!랭킹", "!송금"]);

  if (!message.guild) {
    if (ALL_CASINO_CMDS.has(cmd)) {
      await message.reply("❌ 이 명령어는 서버에서만 사용할 수 있습니다.");
      return true;
    }
    return false;
  }

  if (GAMBLING_CMDS.has(cmd)) {
    if (message.guild && !(await getGamblingEnabled(message.guild.id))) {
      await message.reply("🔒 현재 서버에서 도박 기능이 비활성화되어 있습니다.");
      return true;
    }
    if (isGambling(message.author.id)) {
      await message.reply("🎰 진행 중인 도박 게임이 있습니다. 게임이 끝난 후 이용해주세요.");
      return true;
    }
  }

  switch (cmd) {
    case "!도박":
      await handleGamblingToggle(message, args);
      return true;
    case "!출석":
      await handleAttendance(ctxFromMessage(message));
      return true;
    case "!일":
    case "!노동":
      await handleWork(ctxFromMessage(message));
      return true;
    case "!잔액":
      await handleBalance(ctxFromMessage(message));
      return true;
    case "!지원금":
      await handleSupport(ctxFromMessage(message));
      return true;
    case "!랭킹":
      await handleRanking(ctxFromMessage(message));
      return true;
    case "!송금": {
      const mention = message.mentions.users.first();
      if (!mention) {
        await message.reply("❌ 송금할 대상을 멘션해주세요. 예) `!송금 @이름 10000`");
        return true;
      }
      await handleTransfer(ctxFromMessage(message), mention.id, mention.username, mention.bot, args[1]);
      return true;
    }
    case "!코인":
      await handleCoinflip(ctxFromMessage(message), args);
      return true;
    case "!블랙잭":
      await handleBlackjack(ctxFromMessage(message), args);
      return true;
    case "!바카라":
      await handleBaccarat(ctxFromMessage(message), args);
      return true;
    case "!룰렛":
      await handleRoulette(ctxFromMessage(message), args);
      return true;
    default:
      return false;
  }
}

export async function handleCasinoSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "❌ 이 명령어는 서버에서만 사용할 수 있습니다.", ephemeral: true });
    return;
  }

  const cmd = interaction.commandName;
  const ctx = ctxFromInteraction(interaction);

  const GAMBLING_SLASH = new Set(["코인", "블랙잭", "바카라", "룰렛", "출석", "일", "지원금"]);

  if (GAMBLING_SLASH.has(cmd)) {
    if (!(await getGamblingEnabled(interaction.guildId))) {
      await interaction.reply({ content: "🔒 현재 서버에서 도박 기능이 비활성화되어 있습니다.", ephemeral: true });
      return;
    }
    if (isGambling(interaction.user.id)) {
      await interaction.reply({ content: "🎰 진행 중인 도박 게임이 있습니다. 게임이 끝난 후 이용해주세요.", ephemeral: true });
      return;
    }
  }

  switch (cmd) {
    case "도박": {
      const subCmd = interaction.options.getString("설정") ?? "";
      if (subCmd === "on" || subCmd === "off") {
        const member = interaction.member instanceof GuildMember ? interaction.member : null;
        if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
          await interaction.reply({ content: "❌ 서버 관리자 권한이 필요합니다.", ephemeral: true });
          return;
        }
        const enable = subCmd === "on";
        await setGamblingEnabled(interaction.guildId, enable);
        await interaction.reply(
          enable ? "✅ 도박 기능이 **활성화**되었습니다." : "🔒 도박 기능이 **비활성화**되었습니다.",
        );
      } else {
        const enabled = await getGamblingEnabled(interaction.guildId);
        await interaction.reply(
          `🎰 현재 도박 기능: ${enabled ? "**활성화** ✅" : "**비활성화** 🔒"}\n사용법: \`/도박 설정:on\` / \`/도박 설정:off\``,
        );
      }
      break;
    }
    case "출석":
      await handleAttendance(ctx);
      break;
    case "일":
      await handleWork(ctx);
      break;
    case "잔액":
      await handleBalance(ctx);
      break;
    case "지원금":
      await handleSupport(ctx);
      break;
    case "랭킹":
      await handleRanking(ctx);
      break;
    case "송금": {
      const target = interaction.options.getUser("대상", true);
      const amountStr = interaction.options.getString("금액", true);
      await handleTransfer(ctx, target.id, target.username, target.bot, amountStr);
      break;
    }
    case "코인": {
      const amount = interaction.options.getString("금액", true);
      await handleCoinflip(ctx, [amount]);
      break;
    }
    case "블랙잭": {
      const amount = interaction.options.getString("금액", true);
      await handleBlackjack(ctx, [amount]);
      break;
    }
    case "바카라": {
      const amount = interaction.options.getString("금액", true);
      await handleBaccarat(ctx, [amount]);
      break;
    }
    case "룰렛": {
      const amount = interaction.options.getString("금액", true);
      await handleRoulette(ctx, [amount]);
      break;
    }
  }
}

export { handleButtonInteraction };
