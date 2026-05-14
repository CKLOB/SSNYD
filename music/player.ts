import {
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import { EmbedBuilder, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import play from "play-dl";

export interface QueueItem {
  title: string;
  url: string;
  requestedBy: string;
  duration: string;
  thumbnail?: string;
}

interface GuildPlayer {
  connection: VoiceConnection;
  player: AudioPlayer;
  queue: QueueItem[];
  current: QueueItem | null;
  textChannel: GuildTextBasedChannel;
  leaveTimeout?: ReturnType<typeof setTimeout>;
}

const players = new Map<string, GuildPlayer>();

async function playNext(guildId: string): Promise<void> {
  const gp = players.get(guildId);
  if (!gp) return;

  if (gp.queue.length === 0) {
    gp.current = null;
    gp.leaveTimeout = setTimeout(() => {
      const g = players.get(guildId);
      if (g && g.current === null && g.queue.length === 0) {
        try {
          g.connection.destroy();
        } catch (_) {}
        players.delete(guildId);
      }
    }, 30_000);
    return;
  }

  if (gp.leaveTimeout) {
    clearTimeout(gp.leaveTimeout);
    gp.leaveTimeout = undefined;
  }

  const item = gp.queue.shift()!;
  gp.current = item;

  try {
    const stream = await play.stream(item.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    gp.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("🎵 지금 재생 중")
      .setDescription(`**[${item.title}](${item.url})**`)
      .addFields(
        { name: "⏱️ 길이", value: item.duration, inline: true },
        { name: "👤 신청자", value: item.requestedBy, inline: true },
        ...(gp.queue.length > 0
          ? [{ name: "📋 대기", value: `${gp.queue.length}곡`, inline: true }]
          : []),
      );
    if (item.thumbnail) embed.setThumbnail(item.thumbnail);
    await gp.textChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error("[Music] 재생 오류:", err);
    gp.current = null;
    await gp.textChannel
      .send(`❌ **${item.title}** 재생 중 오류가 발생했습니다. 건너뜁니다.`)
      .catch(() => {});
    await playNext(guildId);
  }
}

export async function addToQueue(
  guildId: string,
  voiceChannel: VoiceBasedChannel,
  textChannel: GuildTextBasedChannel,
  item: QueueItem,
): Promise<"playing" | "queued"> {
  let gp = players.get(guildId);

  if (!gp) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    } catch {
      connection.destroy();
      throw new Error("음성 채널 연결에 실패했습니다.");
    }

    const player = createAudioPlayer();
    connection.subscribe(player);

    gp = { connection, player, queue: [], current: null, textChannel };
    players.set(guildId, gp);

    player.on(AudioPlayerStatus.Idle, () => void playNext(guildId));

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (!players.has(guildId)) return;
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        try {
          connection.destroy();
        } catch (_) {}
        players.delete(guildId);
      }
    });
  } else {
    gp.textChannel = textChannel;
  }

  const wasIdle = gp.current === null && gp.queue.length === 0;
  gp.queue.push(item);

  if (wasIdle) {
    await playNext(guildId);
    return "playing";
  }
  return "queued";
}

export function skip(guildId: string): QueueItem | null {
  const gp = players.get(guildId);
  if (!gp || gp.current === null) return null;
  const skipped = gp.current;
  gp.player.stop(true);
  return skipped;
}

export function stop(guildId: string): boolean {
  const gp = players.get(guildId);
  if (!gp) return false;
  gp.queue = [];
  gp.current = null;
  gp.player.stop(true);
  try {
    gp.connection.destroy();
  } catch (_) {}
  players.delete(guildId);
  return true;
}

export function pause(guildId: string): boolean {
  const gp = players.get(guildId);
  if (!gp || gp.current === null) return false;
  return gp.player.pause();
}

export function resume(guildId: string): boolean {
  const gp = players.get(guildId);
  if (!gp) return false;
  return gp.player.unpause();
}

export function getQueue(guildId: string): { current: QueueItem | null; queue: QueueItem[] } {
  const gp = players.get(guildId);
  if (!gp) return { current: null, queue: [] };
  return { current: gp.current, queue: [...gp.queue] };
}

export function getPlayerStatus(guildId: string): AudioPlayerStatus | null {
  const gp = players.get(guildId);
  if (!gp) return null;
  return gp.player.state.status;
}
