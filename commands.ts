import { REST, Routes, SlashCommandBuilder, RESTPostAPIApplicationCommandsJSONBody } from "discord.js";

const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder().setName("밥").setDescription("현재 시간대 급식을 확인합니다").toJSON(),

  new SlashCommandBuilder()
    .setName("급식")
    .setDescription("특정 끼니/날짜의 급식을 확인합니다")
    .addStringOption((opt) =>
      opt
        .setName("끼니")
        .setDescription("조회할 끼니")
        .setRequired(true)
        .addChoices(
          { name: "아침", value: "아침" },
          { name: "점심", value: "점심" },
          { name: "저녁", value: "저녁" },
        ),
    )
    .addStringOption((opt) =>
      opt
        .setName("날짜")
        .setDescription("오늘 또는 내일 (기본: 오늘)")
        .setRequired(false)
        .addChoices({ name: "오늘", value: "오늘" }, { name: "내일", value: "내일" }),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("시간표")
    .setDescription("시간표를 확인합니다")
    .addStringOption((opt) =>
      opt
        .setName("학년반")
        .setDescription("조회할 학년-반 (예: 2-3). 없으면 내 역할 사용")
        .setRequired(false),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("학사일정")
    .setDescription("학사일정을 확인합니다")
    .addIntegerOption((opt) =>
      opt
        .setName("월")
        .setDescription("조회할 월 (1~12). 없으면 이번 달")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(12),
    )
    .toJSON(),

  new SlashCommandBuilder().setName("날씨").setDescription("현재 날씨 및 미세먼지를 확인합니다").toJSON(),

  new SlashCommandBuilder().setName("상태").setDescription("봇 업타임, 핑, 메모리, API 상태를 확인합니다").toJSON(),

  new SlashCommandBuilder().setName("출석").setDescription("매일 출석 체크 (150,000원 지급)").toJSON(),

  new SlashCommandBuilder().setName("일").setDescription("10,000~30,000원 벌기 (1분 쿨다운)").toJSON(),

  new SlashCommandBuilder().setName("잔액").setDescription("내 잔액을 확인합니다").toJSON(),

  new SlashCommandBuilder().setName("지원금").setDescription("잔액 0원일 때 100,000원 지원금 신청").toJSON(),

  new SlashCommandBuilder().setName("랭킹").setDescription("서버 잔액 TOP 10 랭킹").toJSON(),

  new SlashCommandBuilder()
    .setName("송금")
    .setDescription("다른 유저에게 송금합니다")
    .addUserOption((opt) =>
      opt.setName("대상").setDescription("송금할 대상").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("금액").setDescription("송금할 금액 (숫자, 올인, 반)").setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("도박")
    .setDescription("도박 기능 활성화/비활성화 (관리자 전용) 또는 상태 확인")
    .addStringOption((opt) =>
      opt
        .setName("설정")
        .setDescription("on 또는 off")
        .setRequired(false)
        .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("코인")
    .setDescription("코인플립 게임")
    .addStringOption((opt) =>
      opt.setName("금액").setDescription("베팅 금액 (숫자, 올인, 반)").setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("블랙잭")
    .setDescription("블랙잭 게임")
    .addStringOption((opt) =>
      opt.setName("금액").setDescription("베팅 금액 (숫자, 올인, 반)").setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("바카라")
    .setDescription("바카라 게임")
    .addStringOption((opt) =>
      opt.setName("금액").setDescription("베팅 금액 (숫자, 올인, 반)").setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("룰렛")
    .setDescription("룰렛 게임")
    .addStringOption((opt) =>
      opt.setName("금액").setDescription("베팅 금액 (숫자, 올인, 반)").setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("유튜브에서 음악을 검색하거나 URL로 재생합니다")
    .addStringOption((opt) =>
      opt
        .setName("검색어")
        .setDescription("검색할 제목 또는 유튜브 URL")
        .setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder().setName("스킵").setDescription("현재 곡을 건너뜁니다").toJSON(),

  new SlashCommandBuilder().setName("정지").setDescription("재생을 정지하고 음성채널에서 나갑니다").toJSON(),

  new SlashCommandBuilder().setName("일시정지").setDescription("재생을 일시정지합니다").toJSON(),

  new SlashCommandBuilder().setName("재개").setDescription("일시정지된 재생을 재개합니다").toJSON(),

  new SlashCommandBuilder().setName("큐").setDescription("재생 대기열을 확인합니다").toJSON(),

  new SlashCommandBuilder()
    .setName("노추")
    .setDescription("Spotify 랜덤 노래 추천")
    .addStringOption((opt) =>
      opt
        .setName("장르")
        .setDescription("장르 선택 (없으면 랜덤)")
        .setRequired(false)
        .addChoices(
          { name: "케이팝", value: "케이팝" },
          { name: "팝", value: "팝" },
          { name: "제이팝", value: "제이팝" },
          { name: "밴드", value: "밴드" },
          { name: "힙합", value: "힙합" },
          { name: "알앤비", value: "알앤비" },
          { name: "인디", value: "인디" },
        ),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("가수")
    .setDescription("Spotify에서 노래/아티스트를 검색합니다")
    .addStringOption((opt) =>
      opt.setName("검색어").setDescription("검색할 노래 또는 아티스트").setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("보내기")
    .setDescription("정기 알림을 설정합니다")
    .addChannelOption((opt) =>
      opt.setName("채널").setDescription("메시지를 보낼 채널").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("메시지").setDescription("보낼 메시지 내용").setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("시간")
        .setDescription("매일 보낼 시간 (HH:MM 형식, 예: 08:30)")
        .setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder().setName("알림목록").setDescription("등록된 알림 목록을 확인합니다").toJSON(),

  new SlashCommandBuilder()
    .setName("알림삭제")
    .setDescription("등록된 알림을 삭제합니다")
    .addIntegerOption((opt) =>
      opt.setName("번호").setDescription("삭제할 알림 번호").setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder().setName("알림삭제전체").setDescription("이 서버의 알림을 전체 삭제합니다").toJSON(),

  new SlashCommandBuilder().setName("명령어").setDescription("사용 가능한 명령어 목록을 확인합니다").toJSON(),
];

export async function registerCommands(clientId: string, guildId?: string): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN이 없습니다.");
  const rest = new REST().setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
  console.log(`[Slash] ${commands.length}개 커맨드 등록 완료`);
}
