import { PermissionFlagsBits, Message } from "discord.js";
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

  if (!message.guild) {
    await message.reply("❌ 이 명령어는 서버에서만 사용할 수 있습니다.");
    return true;
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
      await handleAttendance(message);
      return true;
    case "!일":
    case "!노동":
      await handleWork(message);
      return true;
    case "!잔액":
      await handleBalance(message);
      return true;
    case "!지원금":
      await handleSupport(message);
      return true;
    case "!랭킹":
      await handleRanking(message);
      return true;
    case "!송금":
      await handleTransfer(message, args);
      return true;
    case "!코인":
      await handleCoinflip(message, args);
      return true;
    case "!블랙잭":
      await handleBlackjack(message, args);
      return true;
    case "!바카라":
      await handleBaccarat(message, args);
      return true;
    case "!룰렛":
      await handleRoulette(message, args);
      return true;
    default:
      return false;
  }
}

export { handleButtonInteraction };
