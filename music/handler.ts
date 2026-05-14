import { AudioPlayerStatus } from "@discordjs/voice";
import { EmbedBuilder, GuildMember, Message } from "discord.js";
import play from "play-dl";
import { searchTracks, SpotifyTrack } from "./spotify.js";
import {
  addToQueue,
  getPlayerStatus,
  getQueue,
  pause,
  resume,
  skip,
  stop,
  QueueItem,
} from "./player.js";

// ─── Spotify 추천 (기존 기능 유지) ─────────────────────────────────────────

function buildTrackEmbed(track: SpotifyTrack, title: string, color: number): EmbedBuilder {
  const artists = track.artists.map((a) => a.name).join(", ");
  const albumArt = track.album?.images?.[0]?.url;
  const spotifyUrl = track.external_urls?.spotify;
  const preview = track.preview_url;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: "🎵 제목", value: track.name.trim().slice(0, 1024), inline: true },
      { name: "🎤 아티스트", value: artists.trim().slice(0, 1024), inline: true },
      {
        name: "💿 앨범",
        value: (track.album?.name ?? "알 수 없음").trim().slice(0, 1024),
        inline: false,
      },
    );

  if (albumArt) embed.setThumbnail(albumArt);
  if (spotifyUrl) embed.setURL(spotifyUrl);
  if (preview)
    embed.setFooter({
      text: "🔗 제목을 클릭하면 Spotify에서 열립니다 | 미리듣기: " + preview,
    });
  else embed.setFooter({ text: "🔗 제목을 클릭하면 Spotify에서 열립니다" });

  return embed;
}

const GENRE_ARTISTS: Record<string, string[]> = {
  케이팝: [
    "BTS",
    "아이유",
    "NewJeans",
    "BLACKPINK",
    "TWICE",
    "aespa",
    "빅뱅",
    "레드벨벳",
    "세븐틴",
    "비투비",
    "god",
    "서태지와 아이들",
  ],
  팝: ["Taylor Swift", "Ariana Grande", "Bruno Mars", "Billie Eilish", "The Weeknd", "maroon 5"],
  제이팝: [
    "그린애플",
    "요네즈 켄시",
    "아라시",
    "우타다 히카루",
    "RADWIMPS",
    "Aimyon",
    "King Gnu",
    "YOASOBI",
  ],
  밴드: [
    "검정치마",
    "혁오",
    "실리카겔",
    "리도어",
    "봉제인간",
    "너드커넥션",
    "wave to earth",
    "놀이도감",
    "손애플",
  ],
  힙합: [
    "Travis Scott",
    "빈지노",
    "김하온",
    "식케이",
    "창모",
    "저스디스",
    "pH-1",
    "다이나믹 듀오",
    "재지팩트",
    "머쉬베놈",
    "이센스",
    "제이통",
    "코드 쿤스트",
  ],
  알앤비: ["Frank Ocean", "SZA", "Daniel Caesar", "H.E.R.", "Bryson Tiller", "The Weeknd"],
  인디: [
    "검정치마",
    "잔나비",
    "새소년",
    "카더가든",
    "10cm",
    "한로로",
    "리도어",
    "wave to earth",
    "허회경",
    "백예린",
  ],
};

const GENRE_LIST = Object.keys(GENRE_ARTISTS);
const RECOMMEND_CMDS = ["!노추", "!오노추"] as const;

// ─── 음성채널 검증 헬퍼 ─────────────────────────────────────────────────────

function getVoiceChannel(message: Message) {
  if (!message.guild) return null;
  const member = message.member as GuildMember | null;
  return member?.voice?.channel ?? null;
}

// ─── 메인 핸들러 ────────────────────────────────────────────────────────────

export async function handleMusic(message: Message): Promise<boolean> {
  const content = message.content.trim();

  // ── Spotify 추천 ──────────────────────────────────────────────────────────
  const recCmd = RECOMMEND_CMDS.find((cmd) => content === cmd || content.startsWith(cmd + " "));
  if (recCmd) {
    const input = content.slice(recCmd.length).trim();
    const genreKey =
      GENRE_LIST.find((g) => g === input) ||
      (input === "" ? GENRE_LIST[Math.floor(Math.random() * GENRE_LIST.length)] : null);

    if (input && !genreKey) {
      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle("🎧 노래 추천")
        .setDescription(
          "장르를 입력하면 해당 장르의 노래를 추천해드립니다!\n\n**사용법:** `!노추 [장르]`",
        )
        .addFields({ name: "🎼 사용 가능한 장르", value: GENRE_LIST.join(" / ") });
      message.reply({ embeds: [embed] });
      return true;
    }

    try {
      const artists = GENRE_ARTISTS[genreKey!];
      const artist = artists[Math.floor(Math.random() * artists.length)];
      const data = await searchTracks(`artist:"${artist}"`, 10, 0);
      const tracks = data.tracks?.items;
      if (!tracks || tracks.length === 0) {
        message.reply("😢 추천 곡을 찾지 못했습니다. 다시 시도해보세요.");
        return true;
      }
      const picked = tracks[Math.floor(Math.random() * tracks.length)];
      const label = input ? genreKey : `${genreKey} (랜덤)`;
      const embed = buildTrackEmbed(picked, `🎧 ${label} 추천 노래`, 0x1db954);
      message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      message.reply("❌ Spotify API 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
    return true;
  }

  // ── !가수 검색 ────────────────────────────────────────────────────────────
  if (content.startsWith("!가수 ")) {
    const query = content.slice("!가수 ".length).trim();
    if (!query) {
      message.reply("❌ 검색어를 입력해주세요. 예: `!가수 아이유`");
      return true;
    }
    try {
      const data = await searchTracks(query, 10);
      const tracks = data.tracks?.items;
      if (!tracks || tracks.length === 0) {
        message.reply(`😢 **${query}** 검색 결과가 없습니다.`);
        return true;
      }
      const unique = [...new Map(tracks.map((t) => [t.id, t])).values()];
      const picked = unique[Math.floor(Math.random() * unique.length)];
      const embed = buildTrackEmbed(picked, `🔍 "${query}" 검색 결과`, 0x5865f2);
      message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      message.reply("❌ Spotify API 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
    return true;
  }

  // ── !play 재생 ───────────────────────────────────────────────────────────
  if (content === "!play" || content.startsWith("!play ")) {
    if (!message.guild) return true;

    const voiceChannel = getVoiceChannel(message);
    if (!voiceChannel) {
      message.reply("❌ 음성 채널에 먼저 입장해주세요!");
      return true;
    }

    const botMember = message.guild.members.me;
    const perms = botMember ? voiceChannel.permissionsFor(botMember) : null;
    if (!perms?.has("Connect") || !perms?.has("Speak")) {
      message.reply("❌ 해당 음성 채널에 접근 권한이 없습니다.");
      return true;
    }

    const arg = content.slice("!play".length).trim();

    if (!arg) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("🎵 음악 재생")
        .setDescription("음성 채널에 입장한 후 아래 명령어를 사용하세요.")
        .addFields(
          {
            name: "🔍 제목으로 검색",
            value: "`!play [제목]`\n예: `!play 아이유 Celebrity`",
          },
          {
            name: "🔗 URL로 재생",
            value: "`!play url [유튜브 URL]`\n예: `!play url https://youtu.be/...`",
          },
          {
            name: "⚙️ 기타 명령어",
            value: "`!스킵` `!정지` `!일시정지` `!재개` `!큐`",
          },
        );
      message.reply({ embeds: [embed] });
      return true;
    }

    let item: QueueItem;

    // URL 재생
    if (arg.toLowerCase().startsWith("url ")) {
      const url = arg.slice(4).trim();
      if (play.yt_validate(url) !== "video") {
        message.reply("❌ 올바른 유튜브 영상 URL을 입력해주세요.");
        return true;
      }

      const loadingMsg = await message.reply("🔍 영상 정보를 불러오는 중...");
      try {
        const info = await play.video_info(url);
        const d = info.video_details;
        item = {
          title: d.title ?? "알 수 없음",
          url: d.url,
          requestedBy: message.author.username,
          duration: d.durationRaw ?? "?:??",
          thumbnail: d.thumbnails?.[0]?.url,
        };
        await loadingMsg.delete().catch(() => {});
      } catch (err) {
        console.error("[Music] video_info 오류:", err);
        await loadingMsg
          .edit("❌ 영상 정보를 불러올 수 없습니다. URL을 확인해주세요.")
          .catch(() => {});
        return true;
      }
    } else {
      // 제목 검색
      const loadingMsg = await message.reply(`🔍 **${arg}** 검색 중...`);
      try {
        const results = await play.search(arg, { source: { youtube: "video" }, limit: 1 });
        if (!results.length) {
          await loadingMsg.edit(`😢 **${arg}** 검색 결과가 없습니다.`).catch(() => {});
          return true;
        }
        const video = results[0];
        item = {
          title: video.title ?? "알 수 없음",
          url: video.url,
          requestedBy: message.author.username,
          duration: video.durationRaw ?? "?:??",
          thumbnail: video.thumbnails?.[0]?.url,
        };
        await loadingMsg.delete().catch(() => {});
      } catch (err) {
        console.error("[Music] 검색 오류:", err);
        await loadingMsg
          .edit("❌ 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.")
          .catch(() => {});
        return true;
      }
    }

    try {
      const result = await addToQueue(
        message.guild.id,
        voiceChannel,
        message.channel as import("discord.js").GuildTextBasedChannel,
        item,
      );
      if (result === "queued") {
        const { queue } = getQueue(message.guild.id);
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📋 대기열에 추가됨")
          .setDescription(`**[${item.title}](${item.url})**`)
          .addFields(
            { name: "⏱️ 길이", value: item.duration, inline: true },
            { name: "📍 대기 순서", value: `${queue.length}번째`, inline: true },
          );
        if (item.thumbnail) embed.setThumbnail(item.thumbnail);
        message.reply({ embeds: [embed] });
      }
    } catch (err) {
      console.error("[Music] addToQueue 오류:", err);
      message.reply(`❌ 오류가 발생했습니다: ${(err as Error).message}`);
    }
    return true;
  }

  // ── !스킵 ─────────────────────────────────────────────────────────────────
  if (content === "!스킵") {
    if (!message.guild) return true;
    const skipped = skip(message.guild.id);
    if (!skipped) {
      message.reply("📭 현재 재생 중인 곡이 없습니다.");
    } else {
      message.reply(`⏭️ **${skipped.title}** 건너뜁니다.`);
    }
    return true;
  }

  // ── !정지 ─────────────────────────────────────────────────────────────────
  if (content === "!정지") {
    if (!message.guild) return true;
    const stopped = stop(message.guild.id);
    if (!stopped) {
      message.reply("📭 현재 재생 중인 곡이 없습니다.");
    } else {
      message.reply("⏹️ 재생을 정지하고 음성 채널에서 나갑니다.");
    }
    return true;
  }

  // ── !일시정지 ─────────────────────────────────────────────────────────────
  if (content === "!일시정지") {
    if (!message.guild) return true;
    const paused = pause(message.guild.id);
    if (!paused) {
      message.reply("📭 일시정지할 수 있는 곡이 없습니다.");
    } else {
      message.reply("⏸️ 일시정지했습니다. `!재개` 로 이어서 재생할 수 있습니다.");
    }
    return true;
  }

  // ── !재개 ─────────────────────────────────────────────────────────────────
  if (content === "!재개") {
    if (!message.guild) return true;
    const resumed = resume(message.guild.id);
    if (!resumed) {
      message.reply("📭 재개할 수 있는 곡이 없습니다.");
    } else {
      message.reply("▶️ 재생을 재개합니다.");
    }
    return true;
  }

  // ── !큐 / !대기열 ─────────────────────────────────────────────────────────
  if (content === "!큐" || content === "!대기열") {
    if (!message.guild) return true;

    const { current, queue } = getQueue(message.guild.id);
    const status = getPlayerStatus(message.guild.id);

    if (!current && queue.length === 0) {
      message.reply("📭 현재 재생 중인 곡이 없습니다.");
      return true;
    }

    const embed = new EmbedBuilder().setColor(0xff0000).setTitle("🎵 재생 대기열");

    if (current) {
      const statusIcon = status === AudioPlayerStatus.Paused ? "⏸️" : "▶️";
      embed.addFields({
        name: `${statusIcon} 지금 재생 중`,
        value: `[${current.title}](${current.url}) \`${current.duration}\` — ${current.requestedBy}`,
      });
    }

    if (queue.length > 0) {
      const lines = queue
        .slice(0, 10)
        .map(
          (item, i) =>
            `**${i + 1}.** [${item.title}](${item.url}) \`${item.duration}\` — ${item.requestedBy}`,
        )
        .join("\n");
      embed.addFields({ name: `📋 대기열 (${queue.length}곡)`, value: lines });
      if (queue.length > 10) {
        embed.setFooter({ text: `외 ${queue.length - 10}곡 더...` });
      }
    }

    message.reply({ embeds: [embed] });
    return true;
  }

  return false;
}
