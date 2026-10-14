import { kstNow, fetchJson, fetchWithRetry, onEveryKstMinute } from "../utils.js";
import { TtlCache } from "../cache.js";

const KMA_KEY = process.env.KMA_API_KEY;
const AIR_KEY = process.env.AIR_API_KEY;
const NX = process.env.WEATHER_NX ?? "58"; // 광주광역시
const NY = process.env.WEATHER_NY ?? "74";
const AIR_STATION = process.env.AIR_STATION ?? "광산구";

export interface WeatherData {
  temp: number;
  feels_like: number;
  status: string;
  temp_max: number;
  temp_min: number;
  dust: string;
}

// 30분마다 예열하므로 TTL을 조금 더 길게 둬서 예열 사이에 캐시가 비지 않게 한다
const WEATHER_TTL_MS = 40 * 60 * 1000;
const weatherCache = new TtlCache<WeatherData>(1);
const WEATHER_KEY = "current";
// API가 잠깐 죽어 있을 때는 이 시간 안에 받아둔 마지막 정상값으로 대신 답한다
const STALE_MAX_MS = 3 * 60 * 60 * 1000;
let lastGood: { data: WeatherData; at: number } | null = null;

const KMA_TIMEOUT_MS = 8000;
const RESULT_NO_DATA = "03";

// 초단기실황: 매시각 :40 이후 발표
function ultraSrtBase(kst: Date): { base_date: string; base_time: string } {
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
function shortFcstBase(kst: Date): { base_date: string; base_time: string } {
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

function toStatus(sky: number, pty: number): string {
  if (pty === 1 || pty === 4 || pty === 5) return "비";
  if (pty === 2 || pty === 6) return "비";
  if (pty === 3 || pty === 7) return "눈";
  if (sky === 1) return "맑음";
  if (sky === 3) return "구름많음";
  return "흐림";
}

// 풍속한냉지수 (T <= 10°C, V >= 4.8 km/h) / 간이 열지수 (T >= 27°C)
function calcFeelsLike(temp: number, windMs: number, humidity: number): number {
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

function toDustLevel(pm10: number): string {
  if (pm10 <= 30) return "좋음";
  if (pm10 <= 80) return "보통";
  if (pm10 <= 150) return "나쁨";
  return "매우나쁨";
}

export function peekWeatherData(): WeatherData | undefined {
  return weatherCache.get(WEATHER_KEY);
}

// 동시에 여러 명이 !날씨를 쳐도 API 3종 호출은 한 번만 나간다
export async function getWeatherData(force = false): Promise<WeatherData> {
  try {
    const data = await (force
      ? weatherCache.load(WEATHER_KEY, fetchWeather, () => WEATHER_TTL_MS)
      : weatherCache.getOrLoad(WEATHER_KEY, fetchWeather, () => WEATHER_TTL_MS));
    lastGood = { data, at: Date.now() };
    return data;
  } catch (err) {
    if (lastGood && Date.now() - lastGood.at < STALE_MAX_MS) {
      console.warn("[Weather] 조회 실패, 이전 값 사용:", (err as Error).message);
      return lastGood.data;
    }
    throw err;
  }
}

// data.go.kr은 간헐적으로 느리거나 200 OK에 XML 에러를 돌려주므로 재시도한다
function fetchKma(url: string): Promise<any> {
  return fetchWithRetry(() => fetchJson(url, KMA_TIMEOUT_MS), 2, "Weather");
}

// 미세먼지는 부가 정보라 실패해도 날씨 전체를 실패시키지 않는다
async function fetchDust(): Promise<string> {
  try {
    const air = await fetchKma(
      `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty` +
        `?serviceKey=${encodeURIComponent(AIR_KEY!)}&stationName=${encodeURIComponent(AIR_STATION)}` +
        `&dataTerm=DAILY&pageNo=1&numOfRows=1&returnType=json&ver=1.0`,
    );
    if (air?.response?.header?.resultCode !== "00")
      throw new Error(`에어코리아 오류: ${air?.response?.header?.resultMsg ?? "Unknown"}`);
    const airItem = air.response.body.items?.[0];
    const pm10Raw = parseFloat(airItem?.pm10Value ?? airItem?.pm10Value24);
    return isNaN(pm10Raw) ? "정보 없음" : toDustLevel(pm10Raw);
  } catch (err) {
    console.warn("[Weather] 미세먼지 조회 실패:", (err as Error).message);
    return "정보 없음";
  }
}

async function fetchWeather(): Promise<WeatherData> {
  if (!KMA_KEY) throw new Error("KMA_API_KEY 환경변수 없음");
  if (!AIR_KEY) throw new Error("AIR_API_KEY 환경변수 없음");

  const kst = kstNow();
  const ncstBase = ultraSrtBase(kst);
  const fcstBase = shortFcstBase(kst);
  const todayStr = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
  const curHourStr = String(kst.getUTCHours()).padStart(2, "0") + "00";

  const KMA = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";
  const ncstUrl = (base: { base_date: string; base_time: string }) =>
    `${KMA}/getUltraSrtNcst?serviceKey=${encodeURIComponent(KMA_KEY)}&pageNo=1&numOfRows=10&dataType=JSON` +
    `&base_date=${base.base_date}&base_time=${base.base_time}&nx=${NX}&ny=${NY}`;

  const [ncstFirst, fcst, dust] = await Promise.all([
    fetchKma(ncstUrl(ncstBase)),
    fetchKma(
      `${KMA}/getVilageFcst?serviceKey=${encodeURIComponent(KMA_KEY)}&pageNo=1&numOfRows=500&dataType=JSON` +
        `&base_date=${fcstBase.base_date}&base_time=${fcstBase.base_time}&nx=${NX}&ny=${NY}`,
    ),
    fetchDust(),
  ]);

  // :40 발표분이 늦게 올라오면 NO_DATA가 오므로 한 시간 전 실황으로 다시 받는다
  let ncst = ncstFirst;
  if (ncst?.response?.header?.resultCode === RESULT_NO_DATA)
    ncst = await fetchKma(ncstUrl(ultraSrtBase(new Date(kst.getTime() - 60 * 60 * 1000))));

  if (ncst?.response?.header?.resultCode !== "00")
    throw new Error(`기상청 실황 오류: ${ncst?.response?.header?.resultMsg ?? "Unknown"}`);
  if (fcst?.response?.header?.resultCode !== "00")
    throw new Error(`기상청 예보 오류: ${fcst?.response?.header?.resultMsg ?? "Unknown"}`);

  // 초단기실황
  const ncstItems: any[] = ncst.response.body.items?.item ?? [];
  const obs = (cat: string): string | undefined =>
    ncstItems.find((i) => i.category === cat)?.obsrValue;
  const temp = Math.round(parseFloat(obs("T1H") ?? "0"));
  const wsd = parseFloat(obs("WSD") ?? "0");
  const reh = parseFloat(obs("REH") ?? "50");
  const ptyNow = parseInt(obs("PTY") ?? "0");

  // 단기예보
  const fcstItems: any[] = fcst.response.body.items?.item ?? [];
  const fv = (cat: string): string | undefined =>
    fcstItems.find((i) => i.category === cat && i.fcstDate === todayStr && i.fcstTime >= curHourStr)
      ?.fcstValue;

  const sky = parseInt(fv("SKY") ?? "1");
  const ptyFcst = parseInt(fv("PTY") ?? String(ptyNow));

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

  return {
    temp,
    feels_like: calcFeelsLike(temp, wsd, reh),
    status: toStatus(sky, ptyNow || ptyFcst),
    temp_max: tempMax,
    temp_min: tempMin,
    dust,
  };
}

export function initWeatherCacheWarmer(): void {
  onEveryKstMinute(async (kst) => {
    if (kst.getUTCMinutes() % 30 !== 0) return;
    await getWeatherData(true).catch((err) =>
      console.error("[Weather] 캐시 예열 실패:", (err as Error).message),
    );
  });
}
