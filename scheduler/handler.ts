import { Message, Client, TextChannel, ChatInputCommandInteraction } from "discord.js";
import {
  addSchedule,
  getAllSchedules,
  getSchedules,
  deleteSchedule,
  deleteAllSchedules,
} from "../db.js";

type SetupStep = "channel" | "message" | "time";

interface PendingState {
  step: SetupStep;
  channelId?: string;
  channelName?: string;
  message?: string;
}

const pendingSetup = new Map<string, PendingState>();

function pendingKey(userId: string, guildId: string): string {
  return `${userId}:${guildId}`;
}

export function initScheduler(client: Client): void {
  let lastFiredMinute = -1;

  setInterval(async () => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const h = kst.getUTCHours();
    const min = kst.getUTCMinutes();
    const minuteKey = h * 60 + min;

    if (minuteKey === lastFiredMinute) return;
    lastFiredMinute = minuteKey;

    let schedules;
    try {
      schedules = await getAllSchedules();
    } catch (e) {
      console.error("스케줄 조회 실패:", (e as Error).message);
      return;
    }

    for (const s of schedules) {
      if (h === s.hour && min === s.minute) {
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
      }
    }
  }, 30 * 1000);
}

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
      message.reply("⏰ 매일 몇 시에 보낼까요? (형식: `HH:MM`)");
      return true;
    }

    if (state.step === "time") {
      const match = content.match(/^(\d{2}):(\d{2})$/);
      if (!match) {
        message.reply("❌ 형식이 올바르지 않습니다. 예: `23:50`");
        return true;
      }
      const hour = parseInt(match[1]);
      const minute = parseInt(match[2]);
      if (hour > 23 || minute > 59) {
        message.reply("❌ 올바른 시간을 입력하세요. (00:00 ~ 23:59)");
        return true;
      }
      await addSchedule(
        guildId,
        state.channelId!,
        state.channelName!,
        state.message!,
        hour,
        minute,
      );
      pendingSetup.delete(key);
      const hh = String(hour).padStart(2, "0");
      const mm = String(minute).padStart(2, "0");
      message.reply(
        `✅ 매일 **${hh}:${mm}**에 **#${state.channelName}** 채널로 메세지를 보낼게요.`,
      );
      return true;
    }
  }

  if (content === "!보내기") {
    pendingSetup.set(key, { step: "channel" });
    message.reply("📌 어떤 채널에 보낼까요? 채널을 멘션해주세요. 예: `#일반`");
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
          return `${s.id}. **${hh}:${mm}** → **#${s.channel_name}** — ${s.message}`;
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
      message.reply(`❌ 올바른 번호를 입력하세요. \`!알림목록\`으로 번호를 확인하세요.`);
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

      const match = time.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) {
        await interaction.reply("❌ 시간 형식이 올바르지 않습니다. 예: `08:30`");
        return;
      }
      const hour = parseInt(match[1]);
      const minute = parseInt(match[2]);
      if (hour > 23 || minute > 59) {
        await interaction.reply("❌ 올바른 시간을 입력하세요. (00:00 ~ 23:59)");
        return;
      }

      await addSchedule(guildId, channel.id, channel.name, msg, hour, minute);
      const hh = String(hour).padStart(2, "0");
      const mm = String(minute).padStart(2, "0");
      await interaction.reply(
        `✅ 매일 **${hh}:${mm}**에 **#${channel.name}** 채널로 메세지를 보낼게요.`,
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
            return `${s.id}. **${hh}:${mm}** → **#${s.channel_name}** — ${s.message}`;
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
