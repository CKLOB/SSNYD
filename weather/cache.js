import https from "https";
import { kstNow } from "../utils.js";

const KMA_KEY = process.env.KMA_API_KEY;
const AIR_KEY = process.env.AIR_API_KEY;
const NX = process.env.WEATHER_NX ?? "58"; // 광주광역시
const NY = process.env.WEATHER_NY ?? "74";
const AIR_STATION = process.env.AIR_STATION ?? "광산구";
const CACHE_TTL = 10 * 60 * 1000;

let cached = null;
let cachedAt = 0;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

// 초단기실황: 매시각 :40 이후 발표
function ultraSrtBase(kst) {
  const y = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const h = kst.getUTCHours();
  const m = kst.getUTCMinutes();

  if (m >= 40) {
    return { base_date: `${y}${mo}${d}`, base_time: String(h).padStart(2, "0") + "00" };
  }
  if (h === 0) {
    const prev = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
    const py = prev.getUTCFullYear();
    const pm = String(prev.getUTCMonth() + 1).padStart(2, "0");
    const pd = String(prev.getUTCDate()).padStart(2, "0");
    return { base_date: `${py}${pm}${pd}`, base_time: "2300" };
  }
  return { base_date: `${y}${mo}${d}`, base_time: String(h - 1).padStart(2, "0") + "00" };
}

// 단기예보: 02, 05, 08, 11, 14, 17, 20, 23시 발표
function shortFcstBase(kst) {
  const TIMES = [2, 5, 8, 11, 14, 17, 20, 23];
  const y = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const totalMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  let baseHour = -1;
  for (const t of TIMES) {
    if (totalMin >= t * 60 + 10) baseHour = t;
  }

  if (baseHour === -1) {
    const prev = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
    return {
      base_date: `${prev.getUTCFullYear()}${String(prev.getUTCMonth() + 1).padStart(2, "0")}${String(prev.getUTCDate()).padStart(2, "0")}`,
      base_time: "2300",
    };
  }
  return { base_date: `${y}${mo}${d}`, base_time: String(baseHour).padStart(2, "0") + "00" };
}

function toStatus(sky, pty) {
  if (pty === 1 || pty === 4 || pty === 5) return "비";
  if (pty === 2 || pty === 6) return "비";
  if (pty === 3 || pty === 7) return "눈";
  if (sky === 1) return "맑음";
  if (sky === 3) return "구름많음";
  return "흐림";
}

// 풍속한냉지수 (T <= 10°C, V >= 4.8 km/h) / 간이 열지수 (T >= 27°C)
function calcFeelsLike(temp, windMs, humidity) {
  const v = windMs * 3.6;
  if (temp <= 10 && v >= 4.8) {
    return Math.round(
      13.12 + 0.6215 * temp - 11.37 * Math.pow(v, 0.16) + 0.3965 * temp * Math.pow(v, 0.16),
    );
  }
  if (temp >= 27 && humidity >= 40) {
    return Math.round(
      temp + 0.33 * (humidity / 100) * 6.105 * Math.exp((17.27 * temp) / (237.3 + temp)) - 4,
    );
  }
  return temp;
}

function toDustLevel(pm10) {
  if (pm10 <= 30) return "좋음";
  if (pm10 <= 80) return "보통";
  if (pm10 <= 150) return "나쁨";
  return "매우나쁨";
}

export async function getWeatherData() {
  if (cached && Date.now() - cachedAt < CACHE_TTL) return cached;
  if (!KMA_KEY) throw new Error("KMA_API_KEY 환경변수 없음");
  if (!AIR_KEY) throw new Error("AIR_API_KEY 환경변수 없음");

  const kst = kstNow();
  const ncstBase = ultraSrtBase(kst);
  const fcstBase = shortFcstBase(kst);
  const todayStr = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
  const curHourStr = String(kst.getUTCHours()).padStart(2, "0") + "00";

  const KMA = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";

  const [ncst, fcst, air] = await Promise.all([
    fetchJson(
      `${KMA}/getUltraSrtNcst?serviceKey=${encodeURIComponent(KMA_KEY)}&pageNo=1&numOfRows=10&dataType=JSON` +
        `&base_date=${ncstBase.base_date}&base_time=${ncstBase.base_time}&nx=${NX}&ny=${NY}`,
    ),
    fetchJson(
      `${KMA}/getVilageFcst?serviceKey=${encodeURIComponent(KMA_KEY)}&pageNo=1&numOfRows=500&dataType=JSON` +
        `&base_date=${fcstBase.base_date}&base_time=${fcstBase.base_time}&nx=${NX}&ny=${NY}`,
    ),
    fetchJson(
      `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty` +
        `?serviceKey=${encodeURIComponent(AIR_KEY)}&stationName=${encodeURIComponent(AIR_STATION)}` +
        `&dataTerm=DAILY&pageNo=1&numOfRows=1&returnType=json&ver=1.0`,
    ),
  ]);

  if (ncst.response.header.resultCode !== "00")
    throw new Error(`기상청 실황 오류: ${ncst.response.header.resultMsg}`);
  if (fcst.response.header.resultCode !== "00")
    throw new Error(`기상청 예보 오류: ${fcst.response.header.resultMsg}`);
  if (air.response.header.resultCode !== "00")
    throw new Error(`에어코리아 오류: ${air.response.header.resultMsg}`);

  // 초단기실황
  const ncstItems = ncst.response.body.items.item;
  const obs = (cat) => ncstItems.find((i) => i.category === cat)?.obsrValue;
  const temp = Math.round(parseFloat(obs("T1H") ?? 0));
  const wsd = parseFloat(obs("WSD") ?? 0);
  const reh = parseFloat(obs("REH") ?? 50);
  const ptyNow = parseInt(obs("PTY") ?? 0);

  // 단기예보
  const fcstItems = fcst.response.body.items.item;
  const fv = (cat) =>
    fcstItems.find((i) => i.category === cat && i.fcstDate === todayStr && i.fcstTime >= curHourStr)
      ?.fcstValue;

  const sky = parseInt(fv("SKY") ?? 1);
  const ptyFcst = parseInt(fv("PTY") ?? ptyNow);

  const tmxItem = fcstItems.find((i) => i.category === "TMX" && i.fcstDate === todayStr);
  const tmnToday = fcstItems.find((i) => i.category === "TMN" && i.fcstDate === todayStr);
  const todayTmps = fcstItems
    .filter((i) => i.category === "TMP" && i.fcstDate === todayStr)
    .map((i) => parseFloat(i.fcstValue));
  const tempMax = Math.max(tmxItem ? Math.round(parseFloat(tmxItem.fcstValue)) : temp + 5, temp);
  const tempMin = Math.min(
    tmnToday
      ? Math.round(parseFloat(tmnToday.fcstValue))
      : todayTmps.length
        ? Math.round(Math.min(...todayTmps))
        : temp - 5,
    temp,
  );

  // 에어코리아 PM10
  const airItem = air.response.body.items?.[0];
  const pm10Raw = parseFloat(airItem?.pm10Value ?? airItem?.pm10Value24 ?? 50);

  cached = {
    temp,
    feels_like: calcFeelsLike(temp, wsd, reh),
    status: toStatus(sky, ptyNow || ptyFcst),
    temp_max: tempMax,
    temp_min: tempMin,
    dust: toDustLevel(isNaN(pm10Raw) ? 50 : pm10Raw),
  };
  cachedAt = Date.now();
  return cached;
}
