import {
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import { EmbedBuilder, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import youtubeDl from "youtube-dl-exec";

export interface QueueItem {
  title: string;
  url?: string;
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
  ytdlProcess?: ReturnType<typeof youtubeDl.exec>;
  leaveTimeout?: ReturnType<typeof setTimeout>;
}

const players = new Map<string, GuildPlayer>();

function killYtdlProcess(gp: GuildPlayer): void {
  if (!gp.ytdlProcess || gp.ytdlProcess.killed) return;
  try {
    gp.ytdlProcess.kill("SIGKILL");
  } catch (_) {}
  gp.ytdlProcess = undefined;
}

async function playNext(guildId: string): Promise<void> {
  const gp = players.get(guildId);
  if (!gp) return;

  killYtdlProcess(gp);

  if (gp.queue.length === 0) {
    gp.current = null;
    gp.leaveTimeout = setTimeout(() => {
      const g = players.get(guildId);
      if (g && g.current === null && g.queue.length === 0) {
        killYtdlProcess(g);
        players.delete(guildId);
        try {
          g.connection.destroy();
        } catch (_) {}
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

  if (!item.url) {
    console.error("[Music] 트랙 URL이 없습니다:", item);
    gp.current = null;
    await gp.textChannel
      .send(`❌ **${item.title}** - URL이 없어 건너뜁니다.`)
      .catch(() => {});
    await playNext(guildId);
    return;
  }

  try {
    const subprocess = youtubeDl.exec(
      item.url,
      {
        format: "bestaudio[acodec=opus]/bestaudio",
        output: "-",
        quiet: true,
        noWarnings: true,
        noPlaylist: true,
      },
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    gp.ytdlProcess = subprocess;

    let stderr = "";
    subprocess.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    void subprocess.catch((err: unknown) => {
      if (gp.ytdlProcess === subprocess) {
        console.error("[Music] yt-dlp 프로세스 오류:", err, stderr.slice(0, 500));
      }
    });

    if (!subprocess.stdout) throw new Error("yt-dlp stdout 스트림을 열 수 없습니다.");
    const probe = await demuxProbe(subprocess.stdout);
    const resource = createAudioResource(probe.stream, { inputType: probe.type });
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

    const existing = players.get(guildId);
    if (existing) {
      connection.destroy();
      gp = existing;
    } else {
      const player = createAudioPlayer();
      connection.subscribe(player);

      const newGp: GuildPlayer = { connection, player, queue: [], current: null, textChannel };
      gp = newGp;
      players.set(guildId, newGp);

      player.on(AudioPlayerStatus.Idle, () => void playNext(guildId));
      player.on("error", (error) => {
        console.error("[Music] Player Error:", error);
        killYtdlProcess(newGp);
        void playNext(guildId);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        if (!players.has(guildId)) return;
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          players.delete(guildId);
          killYtdlProcess(newGp);
          try {
            connection.destroy();
          } catch (_) {}
        }
      });
    }
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
  killYtdlProcess(gp);
  gp.player.stop(true);
  players.delete(guildId);
  try {
    gp.connection.destroy();
  } catch (_) {}
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
