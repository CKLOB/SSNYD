const {
  addSchedule,
  getAllSchedules,
  getSchedules,
  deleteSchedule,
  deleteAllSchedules,
} = require("../db");

const pendingSetup = new Map();

function initScheduler(client) {
  setInterval(async () => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const h = kst.getUTCHours();
    const min = kst.getUTCMinutes();

    const schedules = await getAllSchedules();
    for (const s of schedules) {
      if (h === s.hour && min === s.minute) {
        const channel = client.channels.cache.get(s.channel_id);
        if (channel) channel.send(`# ${s.message}`);
      }
    }
  }, 60 * 1000);
}

async function handleScheduler(message) {
  const content = message.content.trim();
  const userId = message.author.id;
  const guildId = message.guild.id;

  if (pendingSetup.has(userId)) {
    const state = pendingSetup.get(userId);

    if (state.step === "channel") {
      const mentioned = message.mentions.channels.first();
      if (!mentioned) {
        message.reply("❌ 채널을 멘션해주세요. 예: `#일반`");
        return true;
      }
      state.channelId = mentioned.id;
      state.channelName = mentioned.name;
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
      await addSchedule(guildId, state.channelId, state.channelName, state.message, hour, minute);
      pendingSetup.delete(userId);
      const hh = String(hour).padStart(2, "0");
      const mm = String(minute).padStart(2, "0");
      message.reply(
        `✅ 매일 **${hh}:${mm}**에 **#${state.channelName}** 채널로 메세지를 보낼게요.`,
      );
      return true;
    }
  }

  if (content === "!보내기") {
    pendingSetup.set(userId, { step: "channel" });
    message.reply("📌 어떤 채널에 보낼까요? 채널을 멘션해주세요. 예: `#일반`");
    return true;
  }

  if (content === "!보내기취소") {
    if (pendingSetup.has(userId)) {
      pendingSetup.delete(userId);
      message.reply("✅ 설정을 취소했습니다.");
    } else {
      message.reply("❌ 진행 중인 설정이 없습니다.");
    }
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

module.exports = { handleScheduler, initScheduler };
