import { Message, Client, TextChannel, ChatInputCommandInteraction } from "discord.js";
import {
  addSchedule,
  getAllSchedules,
  getSchedules,
  deleteSchedule,
  deleteAllSchedules,
  deactivateSchedule,
  ScheduleType,
  Schedule,
} from "../db.js";

type SetupStep =
  | "channel"
  | "message"
  | "time"
  | "schedule_type"
  | "weekdays"
  | "day_of_month"
  | "target_date";

interface PendingState {
  step: SetupStep;
  channelId?: string;
  channelName?: string;
  message?: string;
  hour?: number;
  minute?: number;
  scheduleType?: ScheduleType;
  weekdays?: number[];
  dayOfMonth?: number;
  targetDate?: string;
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

const pendingSetup = new Map<string, PendingState>();

function pendingKey(userId: string, guildId: string): string {
  return `${userId}:${guildId}`;
}

function sanitizeMessage(msg: string): string {
  return msg.replace(/@(everyone|here)/gi, "@​$1");
}

function parseScheduleType(input: string): ScheduleType | null {
  const map: Record<string, ScheduleType> = {
    "1": "daily",
    매일: "daily",
    daily: "daily",
    "2": "weekdays",
    평일: "weekdays",
    weekdays: "weekdays",
    "3": "weekends",
    주말: "weekends",
    weekends: "weekends",
    "4": "weekly",
    매주: "weekly",
    weekly: "weekly",
    "5": "monthly",
    매월: "monthly",
    monthly: "monthly",
    "6": "once",
    "1회": "once",
    once: "once",
    한번: "once",
  };
  return map[input.toLowerCase().trim()] ?? null;
}

function parseDays(input: string): number[] | null {
  const parts = input.split(/[,，\s]+/).filter(Boolean);
  const days = new Set<number>();
  for (const part of parts) {
    const trimmed = part.trim();
    const num = parseInt(trimmed);
    if (!isNaN(num) && num >= 0 && num <= 6) {
      days.add(num);
      continue;
    }
    const idx = DAY_NAMES.indexOf(trimmed);
    if (idx !== -1) {
      days.add(idx);
      continue;
    }
    return null;
  }
  return days.size > 0 ? [...days].sort((a, b) => a - b) : null;
}

function parseTargetDate(input: string): string | null {
  const normalized = input.replace(/[./]/g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const y = match[1];
  const m = match[2].padStart(2, "0");
  const d = match[3].padStart(2, "0");
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (isNaN(date.getTime())) return null;
  return `${y}-${m}-${d}`;
}

function formatScheduleLabel(
  type: ScheduleType,
  weekdays: string | null,
  dayOfMonth: number | null,
  targetDate: string | null,
): string {
  switch (type) {
    case "daily":
      return "매일";
    case "weekdays":
      return "평일(월~금)";
    case "weekends":
      return "주말(토~일)";
    case "weekly": {
      if (!weekdays) return "매주";
      try {
        const days: number[] = JSON.parse(weekdays);
        return `매주 ${days.map((d) => DAY_NAMES[d]).join("·")}`;
      } catch {
        return "매주";
      }
    }
    case "monthly":
      return dayOfMonth ? `매월 ${dayOfMonth}일` : "매월";
    case "once":
      return targetDate ? `${targetDate} 1회` : "1회";
    default:
      return "매일";
  }
}

function toDateStr(val: string | Date | null): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, "0")}-${String(val.getDate()).padStart(2, "0")}`;
  }
  return val;
}

function scheduleLabel(s: Schedule): string {
  return formatScheduleLabel(
    s.schedule_type ?? "daily",
    s.weekdays,
    s.day_of_month,
    toDateStr(s.target_date),
  );
}

function shouldFire(s: Schedule, kst: Date): boolean {
  if (!s.is_active) return false;
  const h = kst.getUTCHours();
  const min = kst.getUTCMinutes();
  if (h !== s.hour || min !== s.minute) return false;

  const dow = kst.getUTCDay();
  const dom = kst.getUTCDate();
  const dateStr = kst.toISOString().slice(0, 10);

  switch (s.schedule_type ?? "daily") {
    case "daily":
      return true;
    case "weekdays":
      return dow >= 1 && dow <= 5;
    case "weekends":
      return dow === 0 || dow === 6;
    case "weekly": {
      if (!s.weekdays) return false;
      try {
        const days: number[] = JSON.parse(s.weekdays);
        return days.includes(dow);
      } catch {
        return false;
      }
    }
    case "monthly":
      return s.day_of_month !== null && dom === s.day_of_month;
    case "once": {
      const td = toDateStr(s.target_date);
      return !!td && td === dateStr;
    }
    default:
      return true;
  }
}

export function initScheduler(client: Client): void {
  let lastFiredMinute = -1;
  let isRunning = false;

  setInterval(async () => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const minuteKey = kst.getUTCHours() * 60 + kst.getUTCMinutes();

    if (minuteKey === lastFiredMinute) return;
    if (isRunning) return;

    isRunning = true;
    lastFiredMinute = minuteKey;

    try {
      let schedules: Schedule[];
      try {
        schedules = await getAllSchedules();
      } catch (e) {
        console.error("스케줄 조회 실패:", (e as Error).message);
        return;
      }

      for (const s of schedules) {
        if (!shouldFire(s, kst)) continue;

        let channel = client.channels.cache.get(s.channel_id);
        if (!channel) {
          try {
            channel = (await client.channels.fetch(s.channel_id)) ?? undefined;
          } catch (e) {
            console.error(`채널 페치 실패 (채널 ${s.channel_id}):`, (e as Error).message);
          }
        }
        if (channel?.isTextBased()) {
          (channel as TextChannel).send(s.message).catch((e: Error) => {
            console.error(`메시지 전송 실패 (채널 ${s.channel_id}):`, e.message);
          });
        }

        if (s.schedule_type === "once") {
          deactivateSchedule(s.id).catch((e: Error) => {
            console.error(`스케줄 비활성화 실패 (id ${s.id}):`, e.message);
          });
        }
      }
    } finally {
      isRunning = false;
    }
  }, 30 * 1000);
}

async function saveAndConfirm(
  message: Message,
  state: PendingState,
  guildId: string,
): Promise<void> {
  const weekdaysJson = state.weekdays ? JSON.stringify(state.weekdays) : null;
  await addSchedule(
    guildId,
    state.channelId!,
    state.channelName!,
    sanitizeMessage(state.message!),
    state.hour!,
    state.minute!,
    state.scheduleType!,
    weekdaysJson,
    state.dayOfMonth ?? null,
    state.targetDate ?? null,
  );
  const hh = String(state.hour).padStart(2, "0");
  const mm = String(state.minute).padStart(2, "0");
  const label = formatScheduleLabel(
    state.scheduleType!,
    weekdaysJson,
    state.dayOfMonth ?? null,
    state.targetDate ?? null,
  );
  await message.reply(
    `✅ **[${label}] ${hh}:${mm}**에 **#${state.channelName}** 채널로 메세지를 보낼게요.`,
  );
}

const SCHEDULE_TYPE_MENU = `🔄 반복 유형을 선택해주세요:
1️⃣ 매일
2️⃣ 평일만 (월~금)
3️⃣ 주말만 (토~일)
4️⃣ 매주 특정 요일
5️⃣ 매월 특정 날짜
6️⃣ 특정 날짜 1회`;

export async function handleScheduler(message: Message): Promise<boolean> {
  if (!message.guild) return false;

  const content = message.content.trim();
  const userId = message.author.id;
  const guildId = message.guild.id;
  const key = pendingKey(userId, guildId);

  if (content === "!보내기취소") {
    if (pendingSetup.has(key)) {
      pendingSetup.delete(key);
      message.reply("✅ 설정을 취소했습니다.");
    } else {
      message.reply("❌ 진행 중인 설정이 없습니다.");
    }
    return true;
  }

  if (pendingSetup.has(key)) {
    const state = pendingSetup.get(key)!;

    if (state.step === "channel") {
      const mentioned = message.mentions.channels.first();
      if (!mentioned) {
        message.reply("❌ 채널을 멘션해주세요. 예: `#일반`");
        return true;
      }
      state.channelId = mentioned.id;
      state.channelName = (mentioned as TextChannel).name;
      state.step = "message";
      message.reply("📝 보낼 메세지를 입력해주세요.");
      return true;
    }

    if (state.step === "message") {
      state.message = content;
      state.step = "time";
      message.reply("⏰ 몇 시에 보낼까요? (형식: `HH:MM`, 예: `08:30`)");
      return true;
    }

    if (state.step === "time") {
      const match = content.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) {
        message.reply("❌ 형식이 올바르지 않습니다. 예: `08:30`");
        return true;
      }
      const hour = parseInt(match[1]);
      const minute = parseInt(match[2]);
      if (hour > 23 || minute > 59) {
        message.reply("❌ 올바른 시간을 입력하세요. (00:00 ~ 23:59)");
        return true;
      }
      state.hour = hour;
      state.minute = minute;
      state.step = "schedule_type";
      message.reply(SCHEDULE_TYPE_MENU);
      return true;
    }

    if (state.step === "schedule_type") {
      const scheduleType = parseScheduleType(content);
      if (!scheduleType) {
        message.reply(
          "❌ 올바른 유형을 선택해주세요. (1~6 또는 매일/평일/주말/매주/매월/1회)\n" +
            SCHEDULE_TYPE_MENU,
        );
        return true;
      }
      state.scheduleType = scheduleType;

      if (scheduleType === "daily" || scheduleType === "weekdays" || scheduleType === "weekends") {
        await saveAndConfirm(message, state, guildId);
        pendingSetup.delete(key);
      } else if (scheduleType === "weekly") {
        state.step = "weekdays";
        message.reply(
          "📅 요일을 선택해주세요. (쉼표로 구분)\n" +
            "`월 화 수 목 금 토 일` 또는 `1 2 3 4 5 6 0`\n" +
            "예: `월,금` 또는 `1,5`",
        );
      } else if (scheduleType === "monthly") {
        state.step = "day_of_month";
        message.reply("📅 매월 몇 일에 보낼까요? (1~31)");
      } else if (scheduleType === "once") {
        state.step = "target_date";
        message.reply("📅 날짜를 입력해주세요. (형식: `YYYY-MM-DD`, 예: `2026-07-04`)");
      }
      return true;
    }

    if (state.step === "weekdays") {
      const days = parseDays(content);
      if (!days) {
        message.reply(
          "❌ 요일 형식이 올바르지 않습니다.\n" +
            "`월 화 수 목 금 토 일` 또는 `1 2 3 4 5 6 0` 중에서 쉼표로 구분해서 입력하세요.\n" +
            "예: `월,금` 또는 `1,5`",
        );
        return true;
      }
      state.weekdays = days;
      await saveAndConfirm(message, state, guildId);
      pendingSetup.delete(key);
      return true;
    }

    if (state.step === "day_of_month") {
      const day = parseInt(content);
      if (isNaN(day) || day < 1 || day > 31) {
        message.reply("❌ 1~31 사이의 숫자를 입력해주세요.");
        return true;
      }
      state.dayOfMonth = day;
      await saveAndConfirm(message, state, guildId);
      pendingSetup.delete(key);
      return true;
    }

    if (state.step === "target_date") {
      const date = parseTargetDate(content);
      if (!date) {
        message.reply("❌ 날짜 형식이 올바르지 않습니다. 예: `2026-07-04`");
        return true;
      }
      state.targetDate = date;
      await saveAndConfirm(message, state, guildId);
      pendingSetup.delete(key);
      return true;
    }
  }

  if (content === "!보내기") {
    pendingSetup.set(key, { step: "channel" });
    message.reply(
      "📌 어떤 채널에 보낼까요? 채널을 멘션해주세요. 예: `#일반`\n(취소: `!보내기취소`)",
    );
    return true;
  }

  if (content === "!알림목록") {
    const schedules = await getSchedules(guildId);
    if (schedules.length === 0) {
      message.reply("📭 등록된 알림이 없습니다.");
    } else {
      const list = schedules
        .map((s) => {
          const hh = String(s.hour).padStart(2, "0");
          const mm = String(s.minute).padStart(2, "0");
          return `${s.id}. **[${scheduleLabel(s)}] ${hh}:${mm}** → **#${s.channel_name}** — ${s.message}`;
        })
        .join("\n");
      message.reply(`📋 **등록된 알림 목록**\n${list}`);
    }
    return true;
  }

  if (content === "!알림삭제전체") {
    const count = await deleteAllSchedules(guildId);
    if (count === 0) {
      message.reply("📭 삭제할 알림이 없습니다.");
    } else {
      message.reply(`✅ 이 서버의 알림 **${count}개**를 모두 삭제했습니다.`);
    }
    return true;
  }

  if (content.startsWith("!알림삭제")) {
    const num = parseInt(content.slice("!알림삭제".length).trim());
    if (isNaN(num)) {
      message.reply("❌ 올바른 번호를 입력하세요. `!알림목록`으로 번호를 확인하세요.");
    } else {
      const deleted = await deleteSchedule(num, guildId);
      if (deleted) {
        message.reply(`✅ ${num}번 알림을 삭제했습니다.`);
      } else {
        message.reply(`❌ ${num}번 알림을 찾을 수 없습니다.`);
      }
    }
    return true;
  }

  return false;
}

export async function handleSchedulerSlash(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ 이 명령어는 서버에서만 사용할 수 있습니다.",
      ephemeral: true,
    });
    return;
  }

  const cmd = interaction.commandName;
  const guildId = interaction.guildId;

  switch (cmd) {
    case "보내기": {
      const channel = interaction.options.getChannel("채널", true) as TextChannel;
      const msg = interaction.options.getString("메시지", true);
      const time = interaction.options.getString("시간", true);
      const repeatType = interaction.options.getString("반복", true) as ScheduleType;
      const weekdayStr = interaction.options.getString("요일");
      const dateStr = interaction.options.getString("날짜");

      const match = time.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) {
        await interaction.reply({
          content: "❌ 시간 형식이 올바르지 않습니다. 예: `08:30`",
          ephemeral: true,
        });
        return;
      }
      const hour = parseInt(match[1]);
      const minute = parseInt(match[2]);
      if (hour > 23 || minute > 59) {
        await interaction.reply({
          content: "❌ 올바른 시간을 입력하세요. (00:00 ~ 23:59)",
          ephemeral: true,
        });
        return;
      }

      let weekdaysJson: string | null = null;
      let dayOfMonth: number | null = null;
      let targetDate: string | null = null;

      if (repeatType === "weekly") {
        if (!weekdayStr) {
          await interaction.reply({
            content: "❌ `매주` 반복은 `요일` 옵션이 필요합니다. 예: `월,금`",
            ephemeral: true,
          });
          return;
        }
        const days = parseDays(weekdayStr);
        if (!days) {
          await interaction.reply({
            content: "❌ 요일 형식이 올바르지 않습니다. 예: `월,금` 또는 `1,5`",
            ephemeral: true,
          });
          return;
        }
        weekdaysJson = JSON.stringify(days);
      } else if (repeatType === "monthly") {
        if (!dateStr) {
          await interaction.reply({
            content: "❌ `매월` 반복은 `날짜` 옵션에 날짜(1~31)를 입력하세요.",
            ephemeral: true,
          });
          return;
        }
        dayOfMonth = parseInt(dateStr);
        if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
          await interaction.reply({
            content: "❌ 날짜는 1~31 사이의 숫자로 입력하세요.",
            ephemeral: true,
          });
          return;
        }
      } else if (repeatType === "once") {
        if (!dateStr) {
          await interaction.reply({
            content: "❌ `1회` 반복은 `날짜` 옵션에 날짜(YYYY-MM-DD)를 입력하세요.",
            ephemeral: true,
          });
          return;
        }
        targetDate = parseTargetDate(dateStr);
        if (!targetDate) {
          await interaction.reply({
            content: "❌ 날짜 형식이 올바르지 않습니다. 예: `2026-07-04`",
            ephemeral: true,
          });
          return;
        }
      }

      const sanitized = sanitizeMessage(msg);
      await addSchedule(
        guildId,
        channel.id,
        channel.name,
        sanitized,
        hour,
        minute,
        repeatType,
        weekdaysJson,
        dayOfMonth,
        targetDate,
      );

      const hh = String(hour).padStart(2, "0");
      const mm = String(minute).padStart(2, "0");
      const label = formatScheduleLabel(repeatType, weekdaysJson, dayOfMonth, targetDate);
      await interaction.reply(
        `✅ **[${label}] ${hh}:${mm}**에 **#${channel.name}** 채널로 메세지를 보낼게요.`,
      );
      break;
    }

    case "알림목록": {
      const schedules = await getSchedules(guildId);
      if (schedules.length === 0) {
        await interaction.reply("📭 등록된 알림이 없습니다.");
      } else {
        const list = schedules
          .map((s) => {
            const hh = String(s.hour).padStart(2, "0");
            const mm = String(s.minute).padStart(2, "0");
            return `${s.id}. **[${scheduleLabel(s)}] ${hh}:${mm}** → **#${s.channel_name}** — ${s.message}`;
          })
          .join("\n");
        await interaction.reply(`📋 **등록된 알림 목록**\n${list}`);
      }
      break;
    }

    case "알림삭제전체": {
      const count = await deleteAllSchedules(guildId);
      if (count === 0) {
        await interaction.reply("📭 삭제할 알림이 없습니다.");
      } else {
        await interaction.reply(`✅ 이 서버의 알림 **${count}개**를 모두 삭제했습니다.`);
      }
      break;
    }

    case "알림삭제": {
      const num = interaction.options.getInteger("번호", true);
      const deleted = await deleteSchedule(num, guildId);
      if (deleted) {
        await interaction.reply(`✅ ${num}번 알림을 삭제했습니다.`);
      } else {
        await interaction.reply(`❌ ${num}번 알림을 찾을 수 없습니다.`);
      }
      break;
    }
  }
}
