import { EmbedBuilder } from "discord.js";
import https from "https";
import { kstNow, toNeisDateStr, NEIS_KEY, ATPT_CODE, SCHOOL_CODE } from "../utils.js";
import { ping as dbPing } from "../db.js";

function checkNeis() {
  const dateStr = toNeisDateStr(kstNow());
  const url =
    `https://open.neis.go.kr/hub/mealServiceDietInfo` +
    `?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=1` +
    `&ATPT_OFCDC_SC_CODE=${ATPT_CODE}` +
    `&SD_SCHUL_CODE=${SCHOOL_CODE}` +
    `&MLSV_YMD=${dateStr}` +
    `&MMEAL_SC_CODE=2`;

  return new Promise((resolve) => {
    const start = Date.now();
    const req = https.get(url, (res) => {
      res.resume();
      if (res.statusCode !== 200) {
        resolve({ ok: false, ms: null, error: `HTTP ${res.statusCode}` });
      } else {
        resolve({ ok: true, ms: Date.now() - start });
      }
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ ok: false, ms: null, error: "timeout (5s 초과)" });
    });
    req.on("error", (err) => {
      resolve({ ok: false, ms: null, error: err.message });
    });
  });
}

async function handleStatus(message, client) {
  if (message.content.trim() !== "!상태") return false;

  const uptimeSec = Math.floor((client.uptime ?? 0) / 1000);
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;
  const uptimeStr = `${h}시간 ${m}분 ${s}초`;

  const wsPing = client.ws.ping;
  const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

  const [neis, db] = await Promise.allSettled([
    checkNeis(),
    (async () => {
      const start = Date.now();
      const ms = await dbPing();
      return { ok: true, ms };
    })(),
  ]);

  const neisResult =
    neis.status === "fulfilled" ? neis.value : { ok: false, error: neis.reason?.message };
  const dbResult = db.status === "fulfilled" ? db.value : { ok: false, error: db.reason?.message };

  const neisText = neisResult.ok ? `✅ 정상 (${neisResult.ms}ms)` : `❌ 오류 — ${neisResult.error}`;
  const dbText = dbResult.ok ? `✅ 정상 (${dbResult.ms}ms)` : `❌ 오류 — ${dbResult.error}`;

  const allOk = neisResult.ok && dbResult.ok;

  const embed = new EmbedBuilder()
    .setColor(allOk ? 0x10b981 : 0xef4444)
    .setTitle("🤖 봇 상태")
    .addFields(
      { name: "⏱️ 업타임", value: uptimeStr, inline: true },
      { name: "📡 WebSocket 핑", value: `${wsPing}ms`, inline: true },
      { name: "🧠 메모리", value: `${memMB} MB`, inline: true },
      { name: "🏫 NEIS API", value: neisText, inline: false },
      { name: "🗄️ DB", value: dbText, inline: false },
    )
    .setTimestamp();

  message.reply({ embeds: [embed] });
  return true;
}

export { handleStatus };
