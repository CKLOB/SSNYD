const { EmbedBuilder } = require("discord.js");
const { searchTracks } = require("./spotify");

const GENRE_MAP = {
  케이팝: "k-pop",
  kpop: "k-pop",
  케팝: "k-pop",
  팝: "pop",
  pop: "pop",
  록: "rock",
  락: "rock",
  rock: "rock",
  힙합: "hip-hop",
  hiphop: "hip-hop",
  "hip-hop": "hip-hop",
  재즈: "jazz",
  jazz: "jazz",
  알앤비: "r-n-b",
  rnb: "r-n-b",
  "r&b": "r-n-b",
  인디: "indie",
  indie: "indie",
  일렉: "electronic",
  electronic: "electronic",
  일렉트로닉: "electronic",
  클래식: "classical",
  classical: "classical",
  로파이: "lo-fi",
  lofi: "lo-fi",
};

const GENRE_LIST = [
  "케이팝",
  "팝",
  "록",
  "힙합",
  "재즈",
  "알앤비",
  "인디",
  "일렉트로닉",
  "클래식",
  "로파이",
];

function buildTrackEmbed(track, title, color) {
  const artists = track.artists.map((a) => a.name).join(", ");
  const albumArt = track.album?.images?.[0]?.url;
  const spotifyUrl = track.external_urls?.spotify;
  const preview = track.preview_url;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: "🎵 제목", value: track.name, inline: true },
      { name: "🎤 아티스트", value: artists, inline: true },
      {
        name: "💿 앨범",
        value: track.album?.name ?? "알 수 없음",
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

const RECOMMEND_CMDS = ["!노추", "!노래", "!오노추"];

async function handleMusic(message) {
  const content = message.content.trim();

  const recCmd = RECOMMEND_CMDS.find(
    (cmd) => content === cmd || content.startsWith(cmd + " "),
  );
  if (recCmd) {
    const input = content.slice(recCmd.length).trim().toLowerCase();
    const genreKey =
      input || GENRE_LIST[Math.floor(Math.random() * GENRE_LIST.length)];
    const genre = GENRE_MAP[genreKey];

    if (input && !genre) {
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
      const offset = Math.floor(Math.random() * 20) * 5;
      const data = await searchTracks(genre, 10, offset);
      const tracks = data.tracks?.items;
      if (!tracks || tracks.length === 0) {
        message.reply(
          "😢 추천 곡을 찾지 못했습니다. 다른 장르를 시도해보세요.",
        );
        return true;
      }

      const picked = tracks[Math.floor(Math.random() * tracks.length)];
      const label = input ? genreKey : `${genreKey} (랜덤)`;
      const embed = buildTrackEmbed(picked, `🎧 ${label} 추천 노래`, 0x1db954);
      message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      message.reply(
        "❌ Spotify API 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      );
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
      const data = await searchTracks(query, 1);
      const track = data.tracks?.items?.[0];
      if (!track) {
        message.reply(`😢 **${query}** 검색 결과가 없습니다.`);
        return true;
      }

      const embed = buildTrackEmbed(track, `🔍 "${query}" 검색 결과`, 0x5865f2);
      message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      message.reply(
        "❌ Spotify API 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      );
    }
    return true;
  }

  return false;
}

module.exports = { handleMusic };
