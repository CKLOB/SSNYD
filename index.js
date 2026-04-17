import "dotenv/config";
import { Client, Events, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { handleCasino, handleButtonInteraction } from "./casino/handler.js";
import { handleMeal } from "./meal/handler.js";
import { handleScheduler, initScheduler } from "./scheduler/handler.js";
import { handleTimetable } from "./timetable/handler.js";
import { init as initDb } from "./db.js";
import { handleRandom } from "./random/handler.js";
import { handleMusic } from "./music/handler.js";
import { handleStatus } from "./status/handler.js";
import { handleAcademic } from "./academic/handler.js";

async function handleHelp(message) {
  if (message.content.trim() !== "!명령어") return false;
  const embed = new EmbedBuilder()
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
        value: "`!시간표` — 오늘(또는 다음 날) 시간표",
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
          "`!노추` / `!노래` / `!오노추` — 랜덤 노래 추천",
          "`!노추 [장르]` — 장르별 노래 추천 (케이팝, 팝, 록, 힙합 등)",
          "`!가수 [키워드]` — 노래/아티스트 검색",
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
  message.reply({ embeds: [embed] });
  return true;
}

const token = process.env.DISCORD_TOKEN;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  await initDb();
  initScheduler(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  await handleButtonInteraction(interaction);
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
  await handleMeal(message);
});

client.login(token);
