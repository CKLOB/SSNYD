const WEBHOOK_URL = process.env.WEBHOOK_URL;

function getKSTString() {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export async function sendBotStatus(type) {
  if (!WEBHOOK_URL) return;

  const isOnline = type === "online";
  const embed = {
    color: isOnline ? 0x57f287 : 0xed4245,
    title: isOnline ? "🟢 SSNYD 봇 온라인" : "🔴 SSNYD 봇 오프라인",
    description: isOnline ? "봇이 정상적으로 시작되었습니다." : "봇이 종료되었습니다.",
    fields: [{ name: "시각", value: getKSTString(), inline: true }],
    timestamp: new Date().toISOString(),
  };

  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  }).catch(() => {});
}
