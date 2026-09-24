import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  Message,
  MessageFlags,
  Options,
  ChatInputCommandInteraction,
} from "discord.js";
import { handleCasino, handleButtonInteraction, handleCasinoSlash } from "./casino/handler.js";
import { handleMeal, handleMealSlash, initMealCacheWarmer } from "./meal/handler.js";
import { handleScheduler, initScheduler, handleSchedulerSlash } from "./scheduler/handler.js";
import { handleTimetable, handleTimetableSlash } from "./timetable/handler.js";
import { init as initDb } from "./db.js";
import { handleRandom } from "./random/handler.js";
import { handleGif, handleGifSlash, initGifCache } from "./gif/handler.js";
import { handleMusic, handleMusicSlash } from "./music/handler.js";
import { handleStatus, handleStatusSlash } from "./status/handler.js";
import { handleAcademic, handleAcademicSlash } from "./academic/handler.js";
import { handleWeather, handleWeatherSlash } from "./weather/handler.js";
import { initWeatherCacheWarmer } from "./weather/cache.js";
import { sendBotStatus } from "./webhook.js";
import { registerCommands } from "./commands.js";

// 매번 새로 만들 필요 없는 고정 내용이라 한 번만 만든다
const HELP_EMBED = new EmbedBuilder()
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
      name: "🖼️ GIF",
      value: [
        "`!gif등록 키워드 URL` — 키워드에 GIF 등록 (GIF 파일 첨부도 가능)",
        "`!gif목록` — 등록된 키워드 확인",
        "`!gif삭제 키워드` — 등록 해제",
        "※ 메시지에 등록한 키워드가 들어 있으면 봇이 GIF를 보냅니다",
      ].join("\n"),
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

const GUILD_ONLY = new Set([
  "출석",
  "일",
  "잔액",
  "지원금",
  "랭킹",
  "송금",
  "도박",
  "코인",
  "블랙잭",
  "바카라",
  "룰렛",
  "시간표",
  "보내기",
  "알림목록",
  "알림삭제",
  "알림삭제전체",
  "play",
  "스킵",
  "정지",
  "일시정지",
  "재개",
  "큐",
  "노추",
  "가수",
  "gif등록",
  "gif목록",
  "gif삭제",
]);

const token = process.env.DISCORD_TOKEN;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  // 봇은 지난 메시지/리액션/스티커 등을 캐시에서 다시 꺼내 쓰지 않는다.
  // 기본값(채널당 메시지 200개 등)으로 두면 서버가 많을수록 메모리만 계속 먹는다.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 25,
    ReactionManager: 0,
    ReactionUserManager: 0,
    GuildStickerManager: 0,
    GuildScheduledEventManager: 0,
    StageInstanceManager: 0,
    PresenceManager: 0,
    GuildInviteManager: 0,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 60 * 60, lifetime: 30 * 60 },
  },
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  try {
    await initDb();
  } catch (e) {
    console.error("DB 연결 실패:", (e as Error).message);
    return;
  }

  initMealCacheWarmer();
  initWeatherCacheWarmer();
  // 서로 의존하지 않는 초기화는 동시에 진행해서 부팅을 빠르게 한다
  const results = await Promise.allSettled([
    initGifCache(),
    initScheduler(readyClient),
    sendBotStatus("online"),
    registerCommands(readyClient.user.id, process.env.GUILD_ID),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error("[Init]", r.reason);
  }
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await sendBotStatus("offline");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 핸들러 곳곳에서 await 없이 보내는 답장이 실패(권한 없음, 메시지 삭제됨 등)하면 unhandled rejection이 되고,
// Node 기본 설정에서는 그 한 번으로 봇 프로세스 전체가 죽는다. 로그만 남기고 계속 돌게 한다.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

type SlashHandler = (i: ChatInputCommandInteraction) => Promise<void>;

const SLASH_HANDLERS: Record<string, SlashHandler> = {
  밥: handleMealSlash,
  급식: handleMealSlash,
  시간표: handleTimetableSlash,
  학사일정: handleAcademicSlash,
  날씨: handleWeatherSlash,
  상태: (i) => handleStatusSlash(i, client),
  명령어: async (i) => void (await i.reply({ embeds: [HELP_EMBED] })),
};
for (const name of [
  "출석",
  "일",
  "잔액",
  "지원금",
  "랭킹",
  "송금",
  "도박",
  "코인",
  "블랙잭",
  "바카라",
  "룰렛",
])
  SLASH_HANDLERS[name] = handleCasinoSlash;
for (const name of ["play", "스킵", "정지", "일시정지", "재개", "큐", "노추", "가수"])
  SLASH_HANDLERS[name] = handleMusicSlash;
for (const name of ["보내기", "알림목록", "알림삭제", "알림삭제전체"])
  SLASH_HANDLERS[name] = handleSchedulerSlash;
for (const name of ["gif등록", "gif목록", "gif삭제"]) SLASH_HANDLERS[name] = handleGifSlash;

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    if (!interaction.guildId && GUILD_ONLY.has(interaction.commandName)) {
      await interaction.reply({
        content: "❌ 이 명령어는 서버에서만 사용할 수 있습니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await SLASH_HANDLERS[interaction.commandName]?.(interaction);
  } catch (err) {
    console.error(`[Interaction] ${interaction.isCommand() ? interaction.commandName : ""}`, err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "❌ 처리 중 오류가 발생했습니다.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

type MessageHandler = (message: Message) => Promise<boolean>;

// "!"로 시작하는 명령 메시지용. 순서가 곧 우선순위다.
const COMMAND_HANDLERS: MessageHandler[] = [
  async (m) => {
    if (m.content.trim() !== "!명령어") return false;
    await m.reply({ embeds: [HELP_EMBED] });
    return true;
  },
  (m) => handleStatus(m, client),
  handleCasino,
  handleRandom,
  handleMusic,
  handleScheduler,
  handleTimetable,
  handleAcademic,
  handleWeather,
  handleGif,
  handleMeal,
];

// 일반 채팅 메시지는 명령 파서를 전부 거칠 필요 없이, 알림 설정 마법사 입력과 GIF 키워드만 보면 된다
const CHAT_HANDLERS: MessageHandler[] = [handleScheduler, handleGif];

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const handlers = message.content.trimStart().startsWith("!") ? COMMAND_HANDLERS : CHAT_HANDLERS;
  try {
    for (const handle of handlers) {
      if (await handle(message)) return;
    }
  } catch (err) {
    console.error(`[Message] ${message.content.slice(0, 50)}`, err);
  }
});

client.login(token);
