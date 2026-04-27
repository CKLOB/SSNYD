import { EmbedBuilder, Message } from "discord.js";
import { getWeatherData } from "./cache.js";

const STATUS_EMOJI: Record<string, string> = {
  맑음: "☀️",
  흐림: "☁️",
  구름많음: "⛅",
  비: "🌧️",
  눈: "❄️",
};
const DUST_EMOJI: Record<string, string> = { 좋음: "🟢", 보통: "🟡", 나쁨: "🔴", 매우나쁨: "🟣" };
const COMMANDS = ["!날씨", "!ㄴㅆ"];

export async function handleWeather(message: Message): Promise<boolean> {
  if (!COMMANDS.includes(message.content.trim())) return false;

  try {
    const d = await getWeatherData();
    const embed = new EmbedBuilder()
      .setColor(0xff8a00)
      .setTitle(`${STATUS_EMOJI[d.status] ?? "🌤️"} 현재 날씨`)
      .addFields(
        { name: "🌡️ 기온", value: `${d.temp}°C (체감 ${d.feels_like}°C)`, inline: false },
        { name: "📊 상태", value: d.status, inline: true },
        { name: "🔺 최고 / 🔻 최저", value: `${d.temp_max}°C / ${d.temp_min}°C`, inline: true },
        { name: "🌫️ 미세먼지", value: `${DUST_EMOJI[d.dust] ?? "🟡"} ${d.dust}`, inline: false },
      );
    await message.reply({ embeds: [embed] });
  } catch (err) {
    console.error("[Weather]", err);
    await message.reply("❌ 날씨 정보를 불러오지 못했습니다.");
  }
  return true;
}
