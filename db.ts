import mysql from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

export interface User extends RowDataPacket {
  id: string;
  guild_id: string;
  username: string;
  balance: number;
  last_attendance: string | null;
  last_work: string | null;
  last_support: string | null;
}

export type ScheduleType = "daily" | "weekdays" | "weekends" | "weekly" | "monthly" | "once";

export interface Schedule extends RowDataPacket {
  id: number;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  message: string;
  hour: number;
  minute: number;
  schedule_type: ScheduleType;
  weekdays: string | null;
  day_of_month: number | null;
  target_date: string | null;
  is_active: number;
}

const DEFAULT_BALANCE = 150000;

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  // last_* 컬럼은 UTC 문자열로 저장하므로 읽을 때도 UTC로 해석한다 (호스트 TZ가 KST여도 쿨다운 계산이 맞도록)
  timezone: "Z",
  // DATE(target_date)는 시간대 변환 없이 "YYYY-MM-DD" 문자열로 받는다
  dateStrings: ["DATE"],
  connectionLimit: 10,
  // 유휴 커넥션이 NAT/방화벽에 끊겨서 첫 쿼리가 에러 나는 걸 막는다
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
});

interface NameRow extends RowDataPacket {
  name: string;
}

// 예전에는 부팅마다 ALTER TABLE을 전부 던지고 실패를 무시했는데(기본키 재생성은 매번 성공해서
// 테이블 전체를 다시 만들었다), 이제 스키마를 한 번 읽어서 필요한 변경만 적용한다.
async function getColumns(table: string): Promise<Set<string>> {
  const [rows] = await pool.execute<NameRow[]>(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  return new Set(rows.map((r) => r.name));
}

async function getIndexColumns(table: string, index: string): Promise<string[]> {
  const [rows] = await pool.execute<NameRow[]>(
    `SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     ORDER BY SEQ_IN_INDEX`,
    [table, index],
  );
  return rows.map((r) => r.name);
}

async function addMissingColumns(table: string, columns: Record<string, string>): Promise<void> {
  const existing = await getColumns(table);
  for (const [name, ddl] of Object.entries(columns)) {
    if (!existing.has(name)) await pool.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

async function addIndexIfMissing(table: string, index: string, columns: string): Promise<void> {
  if ((await getIndexColumns(table, index)).length === 0) {
    await pool.execute(`ALTER TABLE ${table} ADD INDEX ${index} (${columns})`);
  }
}

async function init(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(30) NOT NULL,
      guild_id VARCHAR(30) NOT NULL DEFAULT '',
      username VARCHAR(100) NOT NULL,
      balance BIGINT NOT NULL DEFAULT ${DEFAULT_BALANCE},
      last_attendance DATETIME NULL,
      last_work DATETIME NULL,
      last_support DATETIME NULL,
      PRIMARY KEY (id, guild_id),
      INDEX idx_guild_balance (guild_id, balance)
    )
  `);
  await addMissingColumns("users", { guild_id: "VARCHAR(30) NOT NULL DEFAULT ''" });
  const pk = await getIndexColumns("users", "PRIMARY");
  if (pk.join(",") !== "id,guild_id") {
    await pool.execute(
      `ALTER TABLE users ${pk.length ? "DROP PRIMARY KEY," : ""} ADD PRIMARY KEY (id, guild_id)`,
    );
  }
  // !랭킹은 guild_id로 거르고 balance로 정렬하는데, 기본키(id, guild_id)로는 풀스캔이 된다
  await addIndexIfMissing("users", "idx_guild_balance", "guild_id, balance");

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id VARCHAR(30) NOT NULL PRIMARY KEY,
      gambling_enabled TINYINT(1) NOT NULL DEFAULT 1,
      meal_enabled TINYINT(1) NOT NULL DEFAULT 1
    )
  `);
  await addMissingColumns("guild_settings", { meal_enabled: "TINYINT(1) NOT NULL DEFAULT 1" });

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(30) NOT NULL DEFAULT '',
      channel_id VARCHAR(30) NOT NULL,
      channel_name VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      hour TINYINT NOT NULL,
      minute TINYINT NOT NULL,
      schedule_type VARCHAR(20) NOT NULL DEFAULT 'daily',
      weekdays VARCHAR(20) NULL,
      day_of_month TINYINT NULL,
      target_date DATE NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1
    )
  `);
  await addMissingColumns("schedules", {
    guild_id: "VARCHAR(30) NOT NULL DEFAULT '' AFTER id",
    schedule_type: "VARCHAR(20) NOT NULL DEFAULT 'daily'",
    weekdays: "VARCHAR(20) NULL",
    day_of_month: "TINYINT NULL",
    target_date: "DATE NULL",
    is_active: "TINYINT(1) NOT NULL DEFAULT 1",
  });

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS gif_triggers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(30) NOT NULL,
      keyword VARCHAR(100) NOT NULL,
      data MEDIUMBLOB NOT NULL,
      content_type VARCHAR(50) NOT NULL DEFAULT 'image/gif',
      created_by VARCHAR(30) NOT NULL,
      UNIQUE KEY uniq_guild_keyword (guild_id, keyword)
    )
  `);
}

// 흔한 경우(이미 있는 유저)는 SELECT 한 번으로 끝낸다. 예전엔 매번 INSERT IGNORE + SELECT 두 번 왕복.
async function getUser(guildId: string, id: string, username: string): Promise<User> {
  const [rows] = await pool.execute<User[]>(`SELECT * FROM users WHERE id = ? AND guild_id = ?`, [
    id,
    guildId,
  ]);
  if (rows[0]) {
    // 닉네임을 바꾼 유저가 랭킹에 옛 이름으로 남지 않게 — 응답을 기다릴 필요는 없다
    if (rows[0].username !== username) {
      pool
        .execute(`UPDATE users SET username = ? WHERE id = ? AND guild_id = ?`, [
          username,
          id,
          guildId,
        ])
        .catch((e: Error) => console.error("[DB] 닉네임 갱신 실패:", e.message));
    }
    return rows[0];
  }

  await pool.execute(`INSERT IGNORE INTO users (id, guild_id, username) VALUES (?, ?, ?)`, [
    id,
    guildId,
    username,
  ]);
  const [created] = await pool.execute<User[]>(
    `SELECT * FROM users WHERE id = ? AND guild_id = ?`,
    [id, guildId],
  );
  return created[0];
}

async function updateBalance(guildId: string, id: string, delta: number): Promise<void> {
  await pool.execute(`UPDATE users SET balance = balance + ? WHERE id = ? AND guild_id = ?`, [
    delta,
    id,
    guildId,
  ]);
}

interface BalanceRow extends RowDataPacket {
  balance: number;
}

async function getBalance(guildId: string, id: string): Promise<number> {
  const [rows] = await pool.execute<BalanceRow[]>(
    `SELECT balance FROM users WHERE id = ? AND guild_id = ?`,
    [id, guildId],
  );
  return rows[0]?.balance ?? 0;
}

// updateBalance + getUser을 따로 부르면 매번 왕복이 3번(UPDATE, SELECT, ...)이라,
// 결과 잔액이 바로 필요한 호출부를 위해 UPDATE 후 잔액만 가볍게 다시 읽는다.
async function updateBalanceAndGet(guildId: string, id: string, delta: number): Promise<number> {
  await updateBalance(guildId, id, delta);
  return getBalance(guildId, id);
}

// 잔액이 minBalance 이상일 때만 delta를 반영한다 (조건 검사와 갱신이 한 쿼리라 동시 요청에도 안전).
// 성공하면 새 잔액, 잔액이 모자라면 null.
async function tryAdjustBalance(
  guildId: string,
  id: string,
  delta: number,
  minBalance: number,
): Promise<number | null> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE users SET balance = balance + ? WHERE id = ? AND guild_id = ? AND balance >= ?`,
    [delta, id, guildId, minBalance],
  );
  if (result.affectedRows === 0) return null;
  return getBalance(guildId, id);
}

type RewardField = "last_attendance" | "last_work" | "last_support";
const REWARD_FIELDS: readonly RewardField[] = ["last_attendance", "last_work", "last_support"];

// 쿨다운 보상(출석/노동/지원금) 지급. field가 cutoff 이전일 때만 지급하고 시각을 기록한다.
// 조건 확인과 지급을 한 UPDATE로 처리해서, 명령을 연타해도 보상이 두 번 들어가지 않는다.
async function claimReward(
  guildId: string,
  id: string,
  field: RewardField,
  reward: number,
  now: string,
  cutoff: string,
  opts: { requireZeroBalance?: boolean } = {},
): Promise<number | null> {
  if (!REWARD_FIELDS.includes(field)) throw new Error(`Invalid field: ${field}`);
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE users SET balance = balance + ?, ${field} = ?
     WHERE id = ? AND guild_id = ? AND (${field} IS NULL OR ${field} <= ?)
     ${opts.requireZeroBalance ? "AND balance <= 0" : ""}`,
    [reward, now, id, guildId, cutoff],
  );
  if (result.affectedRows === 0) return null;
  return getBalance(guildId, id);
}

// 받는 사람이 아직 DB에 없으면 기본 잔액 + 입금액으로 만들고, 있으면 입금만 한다 (왕복 1번)
async function creditUser(
  guildId: string,
  id: string,
  username: string,
  amount: number,
): Promise<void> {
  await pool.execute(
    `INSERT INTO users (id, guild_id, username, balance) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE balance = balance + ?`,
    [id, guildId, username, DEFAULT_BALANCE + amount, amount],
  );
}

interface RankingRow extends RowDataPacket {
  username: string;
  balance: number;
}

async function getTopUsers(guildId: string, limit = 10): Promise<RankingRow[]> {
  const [rows] = await pool.execute<RankingRow[]>(
    `SELECT username, balance FROM users WHERE guild_id = ? ORDER BY balance DESC LIMIT ?`,
    [guildId, limit],
  );
  return rows;
}

async function addSchedule(
  guildId: string,
  channelId: string,
  channelName: string,
  message: string,
  hour: number,
  minute: number,
  scheduleType: ScheduleType = "daily",
  weekdays: string | null = null,
  dayOfMonth: number | null = null,
  targetDate: string | null = null,
): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO schedules (guild_id, channel_id, channel_name, message, hour, minute, schedule_type, weekdays, day_of_month, target_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      guildId,
      channelId,
      channelName,
      message,
      hour,
      minute,
      scheduleType,
      weekdays,
      dayOfMonth,
      targetDate,
    ],
  );
  return result.insertId;
}

async function deactivateSchedule(id: number): Promise<void> {
  await pool.execute(`UPDATE schedules SET is_active = 0 WHERE id = ?`, [id]);
}

async function getAllSchedules(): Promise<Schedule[]> {
  const [rows] = await pool.execute<Schedule[]>(
    `SELECT * FROM schedules WHERE is_active = 1 ORDER BY id`,
  );
  return rows;
}

async function getSchedules(guildId: string): Promise<Schedule[]> {
  const [rows] = await pool.execute<Schedule[]>(
    `SELECT * FROM schedules WHERE guild_id = ? ORDER BY id`,
    [guildId],
  );
  return rows;
}

async function deleteSchedule(id: number, guildId: string): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM schedules WHERE id = ? AND guild_id = ?`,
    [id, guildId],
  );
  return result.affectedRows > 0;
}

async function deleteAllSchedules(guildId: string): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(`DELETE FROM schedules WHERE guild_id = ?`, [
    guildId,
  ]);
  return result.affectedRows;
}

type GuildFlag = "gambling_enabled" | "meal_enabled";
const GUILD_FLAGS: readonly GuildFlag[] = ["gambling_enabled", "meal_enabled"];

interface GuildSettingsRow extends RowDataPacket {
  gambling_enabled: number;
  meal_enabled: number;
}

// 명령마다 조회되는데 관리자가 토글할 때만 바뀌므로, 쓰기 시점에 직접 갱신하는 캐시로 충분하다.
// 한 번 조회할 때 두 플래그를 같이 읽어서 도박/급식 첫 조회가 각각 DB를 치지 않게 한다.
const guildSettingsCache = new Map<string, Record<GuildFlag, boolean>>();

async function getGuildFlag(guildId: string, flag: GuildFlag): Promise<boolean> {
  const cached = guildSettingsCache.get(guildId);
  if (cached) return cached[flag];

  const [rows] = await pool.execute<GuildSettingsRow[]>(
    `SELECT gambling_enabled, meal_enabled FROM guild_settings WHERE guild_id = ?`,
    [guildId],
  );
  const settings = {
    gambling_enabled: rows[0] ? rows[0].gambling_enabled === 1 : true,
    meal_enabled: rows[0] ? rows[0].meal_enabled === 1 : true,
  };
  guildSettingsCache.set(guildId, settings);
  return settings[flag];
}

async function setGuildFlag(guildId: string, flag: GuildFlag, enabled: boolean): Promise<void> {
  if (!GUILD_FLAGS.includes(flag)) throw new Error(`Invalid flag: ${flag}`);
  await pool.execute(
    `INSERT INTO guild_settings (guild_id, ${flag}) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE ${flag} = VALUES(${flag})`,
    [guildId, enabled ? 1 : 0],
  );
  const cached = guildSettingsCache.get(guildId);
  if (cached) cached[flag] = enabled;
}

const getGamblingEnabled = (guildId: string) => getGuildFlag(guildId, "gambling_enabled");
const setGamblingEnabled = (guildId: string, enabled: boolean) =>
  setGuildFlag(guildId, "gambling_enabled", enabled);
const getMealEnabled = (guildId: string) => getGuildFlag(guildId, "meal_enabled");
const setMealEnabled = (guildId: string, enabled: boolean) =>
  setGuildFlag(guildId, "meal_enabled", enabled);

interface GifTriggerRow extends RowDataPacket {
  guild_id: string;
  keyword: string;
}

interface GifDataRow extends RowDataPacket {
  data: Buffer;
  content_type: string;
}

// 반환값 true = 기존 키워드를 덮어썼음 (mysql은 UPDATE 시 affectedRows를 2로 준다)
async function addGifTrigger(
  guildId: string,
  keyword: string,
  data: Buffer,
  contentType: string,
  createdBy: string,
): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO gif_triggers (guild_id, keyword, data, content_type, created_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data), content_type = VALUES(content_type), created_by = VALUES(created_by)`,
    [guildId, keyword, data, contentType, createdBy],
  );
  return result.affectedRows === 2;
}

async function getGifTrigger(guildId: string, keyword: string): Promise<GifDataRow | null> {
  const [rows] = await pool.execute<GifDataRow[]>(
    `SELECT data, content_type FROM gif_triggers WHERE guild_id = ? AND keyword = ?`,
    [guildId, keyword],
  );
  return rows[0] ?? null;
}

async function getAllGifKeywords(): Promise<GifTriggerRow[]> {
  const [rows] = await pool.execute<GifTriggerRow[]>(`SELECT guild_id, keyword FROM gif_triggers`);
  return rows;
}

async function getGifKeywords(guildId: string): Promise<string[]> {
  const [rows] = await pool.execute<GifTriggerRow[]>(
    `SELECT keyword FROM gif_triggers WHERE guild_id = ? ORDER BY id`,
    [guildId],
  );
  return rows.map((r) => r.keyword);
}

async function deleteGifTrigger(guildId: string, keyword: string): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM gif_triggers WHERE guild_id = ? AND keyword = ?`,
    [guildId, keyword],
  );
  return result.affectedRows > 0;
}

async function ping(): Promise<number> {
  const start = Date.now();
  await pool.execute("SELECT 1");
  return Date.now() - start;
}

export {
  init,
  ping,
  getUser,
  getBalance,
  updateBalance,
  updateBalanceAndGet,
  tryAdjustBalance,
  claimReward,
  creditUser,
  getTopUsers,
  addSchedule,
  deactivateSchedule,
  getAllSchedules,
  getSchedules,
  deleteSchedule,
  deleteAllSchedules,
  getGamblingEnabled,
  setGamblingEnabled,
  getMealEnabled,
  setMealEnabled,
  addGifTrigger,
  getGifTrigger,
  getAllGifKeywords,
  getGifKeywords,
  deleteGifTrigger,
};
