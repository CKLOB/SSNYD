function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function toMysqlDatetime(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// YYYY-MM-DD (출석 날짜 비교용)
function toKSTDateStr(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// YYYYMMDD (NEIS API 파라미터용)
function toNeisDateStr(kstDate) {
  const y = kstDate.getUTCFullYear();
  const m = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kstDate.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

const NEIS_KEY = process.env.NEIS_API_KEY || "c11ea26f8c614f50bd7b19d2f3228e6d";
const ATPT_CODE = "F10";
const SCHOOL_CODE = "7380292";

module.exports = { kstNow, toMysqlDatetime, toKSTDateStr, toNeisDateStr, NEIS_KEY, ATPT_CODE, SCHOOL_CODE };
