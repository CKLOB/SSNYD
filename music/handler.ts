import { AudioPlayerStatus } from "@discordjs/voice";
import { EmbedBuilder, Message, ChatInputCommandInteraction } from "discord.js";
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
import { Ctx, ctxFromMessage, ctxFromInteraction } from "../ctx.js";

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

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ─── Spotify 추천 / 검색 ────────────────────────────────────────────────────

async function executeRecommend(ctx: Ctx, genreInput: string | null): Promise<void> {
  const genreKey = genreInput ?? pick(GENRE_LIST);
  await ctx.defer();
  try {
    const artist = pick(GENRE_ARTISTS[genreKey]);
    const data = await searchTracks(`artist:"${artist}"`, 10, 0);
    const tracks = data.tracks?.items;
    if (!tracks || tracks.length === 0) {
      await ctx.reply("😢 추천 곡을 찾지 못했습니다. 다시 시도해보세요.");
      return;
    }
    const label = genreInput ? genreKey : `${genreKey} (랜덤)`;
    await ctx.reply({ embeds: [buildTrackEmbed(pick(tracks), `🎧 ${label} 추천 노래`, 0x1db954)] });
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Spotify API 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
}

async function executeArtistSearch(ctx: Ctx, query: string): Promise<void> {
  await ctx.defer();
  try {
    const data = await searchTracks(query, 10);
    const tracks = data.tracks?.items;
    if (!tracks || tracks.length === 0) {
      await ctx.reply(`😢 **${query}** 검색 결과가 없습니다.`);
      return;
    }
    const unique = [...new Map(tracks.map((t) => [t.id, t])).values()];
    await ctx.reply({
      embeds: [buildTrackEmbed(pick(unique), `🔍 "${query}" 검색 결과`, 0x5865f2)],
    });
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Spotify API 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
}

// ─── 유튜브 재생 ────────────────────────────────────────────────────────────

const PLAY_USAGE_EMBED = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle("🎵 음악 재생")
  .setDescription("음성 채널에 입장한 후 아래 명령어를 사용하세요.")
  .addFields(
    { name: "🔍 제목으로 검색", value: "`!play [제목]`\n예: `!play 아이유 Celebrity`" },
    {
      name: "🔗 URL로 재생",
      value: "`!play url [유튜브 URL]`\n예: `!play url https://youtu.be/...`",
    },
    { name: "⚙️ 기타 명령어", value: "`!스킵` `!정지` `!일시정지` `!재개` `!큐`" },
  );

// URL이면 영상 정보를, 아니면 검색 결과 첫 번째 영상을 찾는다. 실패하면 사용자에게 보낼 문구.
async function resolveTrack(arg: string, requestedBy: string): Promise<QueueItem | string> {
  if (play.yt_validate(arg) === "video") {
    try {
      const d = (await play.video_info(arg)).video_details;
      return {
        title: d.title ?? "알 수 없음",
        url: d.url ?? arg,
        requestedBy,
        duration: d.durationRaw ?? "?:??",
        thumbnail: d.thumbnails?.[0]?.url,
      };
    } catch (err) {
      console.error("[Music] video_info 오류:", err);
      return "❌ 영상 정보를 불러올 수 없습니다. URL을 확인해주세요.";
    }
  }

  try {
    const results = await play.search(arg, { source: { youtube: "video" }, limit: 1 });
    const video = results[0];
    if (!video) return `😢 **${arg}** 검색 결과가 없습니다.`;
    if (!video.url) {
      console.error("[Music] 검색 결과 URL 없음:", video);
      return `😢 **${arg}** 에 대한 재생 가능한 영상을 찾지 못했습니다.`;
    }
    return {
      title: video.title ?? "알 수 없음",
      url: video.url,
      requestedBy,
      duration: video.durationRaw ?? "?:??",
      thumbnail: video.thumbnails?.[0]?.url,
    };
  } catch (err) {
    console.error("[Music] 검색 오류:", err);
    return "❌ 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  }
}

async function executePlay(ctx: Ctx, arg: string): Promise<void> {
  if (!ctx.guild || !ctx.channel) return;

  const voiceChannel = ctx.voiceChannel;
  if (!voiceChannel) {
    await ctx.reply("❌ 음성 채널에 먼저 입장해주세요!");
    return;
  }
  const botMember = ctx.guild.members.me;
  const perms = botMember ? voiceChannel.permissionsFor(botMember) : null;
  if (!perms?.has("Connect") || !perms?.has("Speak")) {
    await ctx.reply("❌ 해당 음성 채널에 접근 권한이 없습니다.");
    return;
  }
  if (!arg) {
    await ctx.reply({ embeds: [PLAY_USAGE_EMBED] });
    return;
  }

  // 예전 텍스트 명령은 "검색 중..." 메시지를 보냈다가 지웠는데(API 2번), 이제 입력 중 표시로 대신한다
  await ctx.defer();
  const item = await resolveTrack(arg, ctx.username);
  if (typeof item === "string") {
    await ctx.reply(item);
    return;
  }

  try {
    const result = await addToQueue(ctx.guild.id, voiceChannel, ctx.channel, item);
    if (result === "queued") {
      const { queue } = getQueue(ctx.guild.id);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📋 대기열에 추가됨")
        .setDescription(`**[${item.title}](${item.url})**`)
        .addFields(
          { name: "⏱️ 길이", value: item.duration, inline: true },
          { name: "📍 대기 순서", value: `${queue.length}번째`, inline: true },
        );
      if (item.thumbnail) embed.setThumbnail(item.thumbnail);
      await ctx.reply({ embeds: [embed] });
    } else if (ctx.isInteraction) {
      // 텍스트 명령은 플레이어가 "지금 재생 중" 임베드를 보내므로 따로 답하지 않는다
      await ctx.reply({ content: `▶️ 재생을 시작합니다: **${item.title}**` });
    }
  } catch (err) {
    console.error("[Music] addToQueue 오류:", err);
    await ctx.reply(`❌ 오류가 발생했습니다: ${(err as Error).message}`);
  }
}

function buildQueueEmbed(guildId: string): EmbedBuilder | null {
  const { current, queue } = getQueue(guildId);
  if (!current && queue.length === 0) return null;

  const embed = new EmbedBuilder().setColor(0xff0000).setTitle("🎵 재생 대기열");
  if (current) {
    const statusIcon = getPlayerStatus(guildId) === AudioPlayerStatus.Paused ? "⏸️" : "▶️";
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
    if (queue.length > 10) embed.setFooter({ text: `외 ${queue.length - 10}곡 더...` });
  }
  return embed;
}

// 스킵/정지/일시정지/재개/큐 — prefix는 재개 안내 문구에 쓴다 ("!" 또는 "/")
function executeControl(ctx: Ctx, cmd: string, prefix: string): Promise<unknown> {
  const guildId = ctx.guildId!;
  switch (cmd) {
    case "스킵": {
      const skipped = skip(guildId);
      return ctx.reply(
        skipped ? `⏭️ **${skipped.title}** 건너뜁니다.` : "📭 현재 재생 중인 곡이 없습니다.",
      );
    }
    case "정지":
      return ctx.reply(
        stop(guildId)
          ? "⏹️ 재생을 정지하고 음성 채널에서 나갑니다."
          : "📭 현재 재생 중인 곡이 없습니다.",
      );
    case "일시정지":
      return ctx.reply(
        pause(guildId)
          ? `⏸️ 일시정지했습니다. \`${prefix}재개\` 로 이어서 재생할 수 있습니다.`
          : "📭 일시정지할 수 있는 곡이 없습니다.",
      );
    case "재개":
      return ctx.reply(
        resume(guildId) ? "▶️ 재생을 재개합니다." : "📭 재개할 수 있는 곡이 없습니다.",
      );
    default: {
      const embed = buildQueueEmbed(guildId);
      return ctx.reply(embed ? { embeds: [embed] } : "📭 현재 재생 중인 곡이 없습니다.");
    }
  }
}

const TEXT_CONTROLS: Record<string, string> = {
  "!스킵": "스킵",
  "!정지": "정지",
  "!일시정지": "일시정지",
  "!재개": "재개",
  "!큐": "큐",
  "!대기열": "큐",
};

// ─── 메인 핸들러 ────────────────────────────────────────────────────────────

export async function handleMusic(message: Message): Promise<boolean> {
  const content = message.content.trim();

  const recCmd = RECOMMEND_CMDS.find((cmd) => content === cmd || content.startsWith(cmd + " "));
  if (recCmd) {
    const input = content.slice(recCmd.length).trim();
    if (input && !GENRE_LIST.includes(input)) {
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
    await executeRecommend(ctxFromMessage(message), input || null);
    return true;
  }

  if (content.startsWith("!가수 ")) {
    const query = content.slice("!가수 ".length).trim();
    if (!query) {
      message.reply("❌ 검색어를 입력해주세요. 예: `!가수 아이유`");
      return true;
    }
    await executeArtistSearch(ctxFromMessage(message), query);
    return true;
  }

  if (content === "!play" || content.startsWith("!play ")) {
    let arg = content.slice("!play".length).trim();
    if (arg.toLowerCase().startsWith("url ")) {
      arg = arg.slice(4).trim();
      if (play.yt_validate(arg) !== "video") {
        message.reply("❌ 올바른 유튜브 영상 URL을 입력해주세요.");
        return true;
      }
    }
    await executePlay(ctxFromMessage(message), arg);
    return true;
  }

  const control = TEXT_CONTROLS[content];
  if (control) {
    if (message.guild) await executeControl(ctxFromMessage(message), control, "!");
    return true;
  }

  return false;
}

export async function handleMusicSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const cmd = interaction.commandName;
  const ctx = ctxFromInteraction(interaction);

  if (cmd === "노추") {
    await executeRecommend(ctx, interaction.options.getString("장르"));
    return;
  }
  if (cmd === "가수") {
    await executeArtistSearch(ctx, interaction.options.getString("검색어", true));
    return;
  }
  if (!interaction.guildId) {
    await ctx.replyPrivate("❌ 이 명령어는 서버에서만 사용할 수 있습니다.");
    return;
  }
  if (cmd === "play") {
    await executePlay(ctx, interaction.options.getString("검색어", true).trim());
    return;
  }
  await executeControl(ctx, cmd, "/");
}
