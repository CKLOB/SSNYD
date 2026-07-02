import fs from "fs";
import path from "path";

function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function toMysqlDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// YYYY-MM-DD (출석 날짜 비교용)
function toKSTDateStr(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// YYYYMMDD (NEIS API 파라미터용)
function toNeisDateStr(kstDate: Date): string {
  const y = kstDate.getUTCFullYear();
  const m = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kstDate.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

const NEIS_KEY = process.env.NEIS_API_KEY ?? "";
const ATPT_CODE = "F10";
const SCHOOL_CODE = "7380292";

async function fetchWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt <= maxRetries) {
        console.warn(`[NEIS] 재시도 ${attempt}/${maxRetries} — ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastErr;
}

function readFallbackFile<T>(filename: string, empty: T): T {
  try {
    const filePath = path.join(process.cwd(), "fallback", filename);
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return empty;
  }
}

interface FallbackMeal {
  menu: string;
  cal: string;
}

// NEIS API 점검/장애 시 fallback/meal.json에 수동 등록한 급식 정보를 대신 사용
function getFallbackMeal(dateStr: string, mealType: number): FallbackMeal | null {
  const data = readFallbackFile<Record<string, Record<string, FallbackMeal>>>("meal.json", {});
  return data[dateStr]?.[String(mealType)] ?? null;
}

interface FallbackScheduleRow {
  day: number;
  event: string;
}

// NEIS API 점검/장애 시 fallback/academic.json에 수동 등록한 학사일정을 대신 사용
function getFallbackSchedule(year: number, month: number): FallbackScheduleRow[] {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const data = readFallbackFile<Record<string, FallbackScheduleRow[]>>("academic.json", {});
  return data[key] ?? [];
}

export {
  kstNow,
  toMysqlDatetime,
  toKSTDateStr,
  toNeisDateStr,
  fetchWithRetry,
  getFallbackMeal,
  getFallbackSchedule,
  NEIS_KEY,
  ATPT_CODE,
  SCHOOL_CODE,
};
