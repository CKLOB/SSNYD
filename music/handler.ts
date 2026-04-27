import { EmbedBuilder, Message } from "discord.js";
import { searchTracks, SpotifyTrack } from "./spotify.js";

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

const RECOMMEND_CMDS = ["!노추", "!노래", "!오노추"] as const;

export async function handleMusic(message: Message): Promise<boolean> {
  const content = message.content.trim();

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
        .addFields({
          name: "🎼 사용 가능한 장르",
          value: GENRE_LIST.join(" / "),
        });
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

  return false;
}
