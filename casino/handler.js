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

const GAMBLING_CMDS = new Set(["!코인", "!블랙잭", "!바카라", "!룰렛"]);

async function handleCasino(message) {
  const parts = message.content.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  if (GAMBLING_CMDS.has(cmd) && isGambling(message.author.id)) {
    message.reply("🎰 진행 중인 도박 게임이 있습니다. 게임이 끝난 후 이용해주세요.");
    return true;
  }

  switch (cmd) {
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

export { handleCasino, handleButtonInteraction };
