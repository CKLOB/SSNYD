import { existsSync, readFileSync } from "fs";

const WEBHOOK_URL = process.env.WEBHOOK_URL;

function detectEnv() {
  try {
    if (process.env.CLOUDTYPE_ENV || process.env.CLOUDTYPE) {
      return "☁️ CloudType";
    }
  } catch (_) {}

  try {
    if (existsSync("/.dockerenv")) return "🐳 Docker";
  } catch (_) {}

  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf8");
    if (cgroup.includes("docker")) return "🐳 Docker";
  } catch (_) {}

  return "💻 Local";
}

function getKSTString() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export async function sendBotStatus(type) {
  if (!WEBHOOK_URL) return;

  const isOnline = type === "online";
  const embed = {
    color: isOnline ? 0x57f287 : 0xed4245,
    title: isOnline ? "🟢 섹시노예들 봇 온라인" : "🔴 섹시노예들 봇 오프라인",
    description: isOnline ? "봇이 정상적으로 시작되었습니다." : "봇이 종료되었습니다.",
    fields: [
      { name: "환경", value: detectEnv(), inline: false },
      { name: "시각", value: getKSTString(), inline: false },
    ],
  };

  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  }).catch(() => {});
}
