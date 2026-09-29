import { Message, ChatInputCommandInteraction, MessageFlags } from "discord.js";
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
import { Ctx, ctxFromMessage, ctxFromInteraction, handleAdminToggle } from "../ctx.js";

// 텍스트 명령 → 슬래시 명령 이름. 같은 로직을 쓰도록 텍스트 명령을 슬래시 이름으로 정규화한다.
const TEXT_TO_SLASH: Record<string, string> = {
  "!도박": "도박",
  "!출석": "출석",
  "!일": "일",
  "!노동": "일",
  "!잔액": "잔액",
  "!지원금": "지원금",
  "!랭킹": "랭킹",
  "!송금": "송금",
  "!코인": "코인",
  "!블랙잭": "블랙잭",
  "!바카라": "바카라",
  "!룰렛": "룰렛",
};

// 도박 기능이 꺼져 있거나 게임이 진행 중이면 막는 명령
const GAMBLING_CMDS = new Set(["코인", "블랙잭", "바카라", "룰렛", "출석", "일", "지원금"]);

const GAMES: Record<string, (ctx: Ctx, args: string[]) => Promise<void>> = {
  코인: handleCoinflip,
  블랙잭: handleBlackjack,
  바카라: handleBaccarat,
  룰렛: handleRoulette,
};

const ECONOMY: Record<string, (ctx: Ctx) => Promise<void>> = {
  출석: handleAttendance,
  일: handleWork,
  잔액: handleBalance,
  지원금: handleSupport,
  랭킹: handleRanking,
};

// 공통 진입 검사. 통과하면 true.
// (슬래시는 기존처럼 본인에게만, 텍스트는 기존처럼 채널에 답장)
async function checkGambling(ctx: Ctx, cmd: string): Promise<boolean> {
  if (!GAMBLING_CMDS.has(cmd)) return true;
  const notice = ctx.isInteraction ? ctx.replyPrivate : ctx.reply;
  if (!(await getGamblingEnabled(ctx.guildId!))) {
    await notice("🔒 현재 서버에서 도박 기능이 비활성화되어 있습니다.");
    return false;
  }
  if (isGambling(ctx.authorId)) {
    await notice("🎰 진행 중인 도박 게임이 있습니다. 게임이 끝난 후 이용해주세요.");
    return false;
  }
  return true;
}

async function handleGamblingSetting(ctx: Ctx, subCmd: string, usage: string): Promise<void> {
  if (subCmd === "on" || subCmd === "off") {
    await handleAdminToggle(ctx, subCmd === "on", "도박", setGamblingEnabled);
    return;
  }
  const enabled = await getGamblingEnabled(ctx.guildId!);
  await ctx.reply(
    `🎰 현재 도박 기능: ${enabled ? "**활성화** ✅" : "**비활성화** 🔒"}\n사용법: ${usage}`,
  );
}

export async function handleCasino(message: Message): Promise<boolean> {
  const parts = message.content.trim().split(/\s+/);
  const cmd = TEXT_TO_SLASH[parts[0].toLowerCase()];
  if (!cmd) return false;
  const args = parts.slice(1);

  if (!message.guild) {
    await message.reply("❌ 이 명령어는 서버에서만 사용할 수 있습니다.");
    return true;
  }

  const ctx = ctxFromMessage(message);
  if (!(await checkGambling(ctx, cmd))) return true;

  if (cmd === "도박") {
    await handleGamblingSetting(ctx, args[0]?.toLowerCase() ?? "", "`!도박 on` / `!도박 off`");
  } else if (cmd === "송금") {
    const mention = message.mentions.users.first();
    if (!mention) {
      await message.reply("❌ 송금할 대상을 멘션해주세요. 예) `!송금 @이름 10000`");
      return true;
    }
    await handleTransfer(ctx, mention.id, mention.username, mention.bot, args[1]);
  } else if (GAMES[cmd]) {
    await GAMES[cmd](ctx, args);
  } else {
    await ECONOMY[cmd](ctx);
  }
  return true;
}

export async function handleCasinoSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ 이 명령어는 서버에서만 사용할 수 있습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cmd = interaction.commandName;
  const ctx = ctxFromInteraction(interaction);
  if (!(await checkGambling(ctx, cmd))) return;

  if (cmd === "도박") {
    await handleGamblingSetting(
      ctx,
      interaction.options.getString("설정") ?? "",
      "`/도박 설정:on` / `/도박 설정:off`",
    );
  } else if (cmd === "송금") {
    const target = interaction.options.getUser("대상", true);
    const amountStr = interaction.options.getString("금액", true);
    await handleTransfer(ctx, target.id, target.username, target.bot, amountStr);
  } else if (GAMES[cmd]) {
    await GAMES[cmd](ctx, [interaction.options.getString("금액", true)]);
  } else if (ECONOMY[cmd]) {
    await ECONOMY[cmd](ctx);
  }
}

export { handleButtonInteraction };
