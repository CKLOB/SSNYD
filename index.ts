import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  Message,
  ButtonInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import { handleCasino, handleButtonInteraction, handleCasinoSlash } from "./casino/handler.js";
import { handleMeal, handleMealSlash } from "./meal/handler.js";
import { handleScheduler, initScheduler, handleSchedulerSlash } from "./scheduler/handler.js";
import { handleTimetable, handleTimetableSlash } from "./timetable/handler.js";
import { init as initDb } from "./db.js";
import { handleRandom } from "./random/handler.js";
import { handleMusic, handleMusicSlash } from "./music/handler.js";
import { handleStatus, handleStatusSlash } from "./status/handler.js";
import { handleAcademic, handleAcademicSlash } from "./academic/handler.js";
import { handleWeather, handleWeatherSlash } from "./weather/handler.js";
import { sendBotStatus } from "./webhook.js";
import { registerCommands } from "./commands.js";

async function handleHelp(message: Message): Promise<boolean> {
  if (message.content.trim() !== "!명령어") return false;
  const embed = buildHelpEmbed();
  message.reply({ embeds: [embed] });
  return true;
}

function buildHelpEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📖 명령어 목록")
    .addFields(
      {
        name: "🍽️ 급식",
        value: [
          "`!밥` / `!급식` — 현재 시간대 급식",
          "`!아침` / `!점심` / `!저녁` — 오늘 해당 끼니",
          "`!오늘아침` / `!오늘점심` / `!오늘저녁`",
          "`!내일아침` / `!내일점심` / `!내일저녁`",
        ].join("\n"),
      },
      {
        name: "📅 시간표",
        value: [
          "`!시간표` / `!ㅅㄱㅍ` — 내 반 시간표 (역할 필요)",
          "`!시간표 N-M` / `!ㅅㄱㅍ N-M` — N학년 M반 시간표 (역할 불필요)",
        ].join("\n"),
      },
      {
        name: "🗓️ 학사일정",
        value: ["`!학사일정` — 이번 달 학사일정", "`!학사일정 N월` — N월 학사일정"].join("\n"),
      },
      {
        name: "💰 경제",
        value: [
          "`!출석` — 매일 10,000원 지급",
          "`!일` / `!노동` — 10,000~30,000원 (1분 쿨다운)",
          "`!잔액` — 내 잔액 확인",
          "`!지원금` — 잔액 0원일 때 100,000원 (1시간 쿨다운)",
          "`!송금 @멘션 금액` — 다른 유저에게 송금",
          "`!랭킹` — 서버 잔액 TOP 10",
        ].join("\n"),
      },
      {
        name: "🎰 도박",
        value: [
          "`!코인 금액` — 코인플립 (앞/뒷면)",
          "`!블랙잭 금액` — 블랙잭",
          "`!바카라 금액` — 바카라 (플레이어/뱅커/타이)",
          "`!룰렛 금액` — 룰렛 (홀/짝/검/빨)",
          "※ 금액 대신 `올인` / `반` 사용 가능",
        ].join("\n"),
      },
      {
        name: "🎧 음악",
        value: [
          "`!play [제목]` — 유튜브에서 검색 후 재생",
          "`!play url [URL]` — 유튜브 URL로 바로 재생",
          "`!스킵` — 현재 곡 건너뜀",
          "`!정지` — 재생 중지 및 음성채널 퇴장",
          "`!일시정지` / `!재개` — 일시정지 / 재개",
          "`!큐` / `!대기열` — 재생 대기열 확인",
          "`!노추` / `!오노추` — Spotify 랜덤 노래 추천",
          "`!노추 [장르]` — 장르별 노래 추천 (케이팝, 팝, 힙합 등)",
          "`!가수 [키워드]` — Spotify 노래/아티스트 검색",
        ].join("\n"),
      },
      {
        name: "🌤️ 날씨",
        value: "`!날씨` / `!ㄴㅆ` — 현재 날씨 및 미세먼지",
      },
      {
        name: "🤖 봇 상태",
        value: "`!상태` — 봇 업타임, 핑, 메모리, API 상태 확인",
      },
      {
        name: "🔔 알림",
        value: [
          "`!보내기` — 정기 알림 설정",
          "`!알림목록` — 등록된 알림 확인",
          "`!알림삭제 번호` — 알림 삭제",
          "`!알림삭제전체` — 이 서버 알림 전체 삭제",
          "`!보내기취소` — 설정 중 취소",
        ].join("\n"),
      },
    );
}

async function handleHelpSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = buildHelpEmbed();
  await interaction.reply({ embeds: [embed] });
}

const token = process.env.DISCORD_TOKEN;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  try {
    await initDb();
    initScheduler(readyClient);
    await sendBotStatus("online");
    const clientId = readyClient.user.id;
    const guildId = process.env.GUILD_ID;
    await registerCommands(clientId, guildId).catch(console.error);
  } catch (e) {
    console.error("DB 연결 실패:", (e as Error).message);
  }
});

async function shutdown(): Promise<void> {
  await sendBotStatus("offline");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const GUILD_ONLY = new Set([
  "출석", "일", "잔액", "지원금", "랭킹", "송금", "도박",
  "코인", "블랙잭", "바카라", "룰렛",
  "시간표", "보내기", "알림목록", "알림삭제", "알림삭제전체",
  "play", "스킵", "정지", "일시정지", "재개", "큐", "노추", "가수",
]);

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction as ButtonInteraction);
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.guildId && GUILD_ONLY.has(interaction.commandName)) {
    await interaction.reply({ content: "❌ 이 명령어는 서버에서만 사용할 수 있습니다.", ephemeral: true });
    return;
  }

  const i = interaction as ChatInputCommandInteraction;

  switch (i.commandName) {
    case "밥":
    case "급식":
      await handleMealSlash(i);
      break;
    case "시간표":
      await handleTimetableSlash(i);
      break;
    case "학사일정":
      await handleAcademicSlash(i);
      break;
    case "날씨":
      await handleWeatherSlash(i);
      break;
    case "상태":
      await handleStatusSlash(i, client);
      break;
    case "출석":
    case "일":
    case "잔액":
    case "지원금":
    case "랭킹":
    case "송금":
    case "도박":
    case "코인":
    case "블랙잭":
    case "바카라":
    case "룰렛":
      await handleCasinoSlash(i);
      break;
    case "play":
    case "스킵":
    case "정지":
    case "일시정지":
    case "재개":
    case "큐":
    case "노추":
    case "가수":
      await handleMusicSlash(i);
      break;
    case "보내기":
    case "알림목록":
    case "알림삭제":
    case "알림삭제전체":
      await handleSchedulerSlash(i);
      break;
    case "명령어":
      await handleHelpSlash(i);
      break;
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (await handleHelp(message)) return;
  if (await handleStatus(message, client)) return;
  if (await handleCasino(message)) return;
  if (await handleRandom(message)) return;
  if (await handleMusic(message)) return;
  if (await handleScheduler(message)) return;
  if (await handleTimetable(message)) return;
  if (await handleAcademic(message)) return;
  if (await handleWeather(message)) return;
  await handleMeal(message);
});

client.login(token);
