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

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

async function init(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(30) NOT NULL,
      guild_id VARCHAR(30) NOT NULL DEFAULT '',
      username VARCHAR(100) NOT NULL,
      balance BIGINT NOT NULL DEFAULT 150000,
      last_attendance DATETIME NULL,
      last_work DATETIME NULL,
      last_support DATETIME NULL,
      PRIMARY KEY (id, guild_id)
    )
  `);
  try {
    await pool.execute(`ALTER TABLE users ADD COLUMN guild_id VARCHAR(30) NOT NULL DEFAULT ''`);
  } catch (_) {}
  try {
    await pool.execute(`ALTER TABLE users DROP PRIMARY KEY, ADD PRIMARY KEY (id, guild_id)`);
  } catch (_) {}
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id VARCHAR(30) NOT NULL PRIMARY KEY,
      gambling_enabled TINYINT(1) NOT NULL DEFAULT 1
    )
  `);
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
  try {
    await pool.execute(
      `ALTER TABLE schedules ADD COLUMN guild_id VARCHAR(30) NOT NULL DEFAULT '' AFTER id`,
    );
  } catch (_) {}
  try {
    await pool.execute(
      `ALTER TABLE schedules ADD COLUMN schedule_type VARCHAR(20) NOT NULL DEFAULT 'daily'`,
    );
  } catch (_) {}
  try {
    await pool.execute(`ALTER TABLE schedules ADD COLUMN weekdays VARCHAR(20) NULL`);
  } catch (_) {}
  try {
    await pool.execute(`ALTER TABLE schedules ADD COLUMN day_of_month TINYINT NULL`);
  } catch (_) {}
  try {
    await pool.execute(`ALTER TABLE schedules ADD COLUMN target_date DATE NULL`);
  } catch (_) {}
  try {
    await pool.execute(`ALTER TABLE schedules ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1`);
  } catch (_) {}
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

async function getUser(guildId: string, id: string, username: string): Promise<User> {
  await pool.execute(`INSERT IGNORE INTO users (id, guild_id, username) VALUES (?, ?, ?)`, [
    id,
    guildId,
    username,
  ]);
  const [rows] = await pool.execute<User[]>(`SELECT * FROM users WHERE id = ? AND guild_id = ?`, [
    id,
    guildId,
  ]);
  return rows[0];
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

// updateBalance + getUser을 따로 부르면 매번 왕복이 3번(UPDATE, INSERT IGNORE, SELECT *)이라,
// 결과 잔액이 바로 필요한 호출부(카지노 버튼 등)를 위해 UPDATE 후 잔액만 가볍게 다시 읽는다.
async function updateBalanceAndGet(guildId: string, id: string, delta: number): Promise<number> {
  await pool.execute(`UPDATE users SET balance = balance + ? WHERE id = ? AND guild_id = ?`, [
    delta,
    id,
    guildId,
  ]);
  const [rows] = await pool.execute<BalanceRow[]>(
    `SELECT balance FROM users WHERE id = ? AND guild_id = ?`,
    [id, guildId],
  );
  return rows[0].balance;
}

async function setField(
  guildId: string,
  id: string,
  field: "last_attendance" | "last_work" | "last_support",
  value: string,
): Promise<void> {
  const allowed = ["last_attendance", "last_work", "last_support"];
  if (!allowed.includes(field)) throw new Error(`Invalid field: ${field}`);
  await pool.execute(`UPDATE users SET ${field} = ? WHERE id = ? AND guild_id = ?`, [
    value,
    id,
    guildId,
  ]);
}

async function getTopUsers(guildId: string, limit = 10): Promise<User[]> {
  const [rows] = await pool.execute<User[]>(
    `SELECT * FROM users WHERE guild_id = ? ORDER BY balance DESC LIMIT ?`,
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

interface GuildSettingsRow extends RowDataPacket {
  gambling_enabled: number;
}

// 도박 명령마다 조회되는데 관리자가 토글할 때만 바뀌므로, 쓰기 시점에 직접 갱신하는 캐시로 충분하다.
const gamblingEnabledCache = new Map<string, boolean>();

async function getGamblingEnabled(guildId: string): Promise<boolean> {
  const cached = gamblingEnabledCache.get(guildId);
  if (cached !== undefined) return cached;

  const [rows] = await pool.execute<GuildSettingsRow[]>(
    `SELECT gambling_enabled FROM guild_settings WHERE guild_id = ?`,
    [guildId],
  );
  const enabled = rows.length === 0 ? true : rows[0].gambling_enabled === 1;
  gamblingEnabledCache.set(guildId, enabled);
  return enabled;
}

async function setGamblingEnabled(guildId: string, enabled: boolean): Promise<void> {
  await pool.execute(
    `INSERT INTO guild_settings (guild_id, gambling_enabled) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE gambling_enabled = VALUES(gambling_enabled)`,
    [guildId, enabled ? 1 : 0],
  );
  gamblingEnabledCache.set(guildId, enabled);
}

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
  updateBalance,
  updateBalanceAndGet,
  setField,
  getTopUsers,
  addSchedule,
  deactivateSchedule,
  getAllSchedules,
  getSchedules,
  deleteSchedule,
  deleteAllSchedules,
  getGamblingEnabled,
  setGamblingEnabled,
  addGifTrigger,
  getGifTrigger,
  getAllGifKeywords,
  getGifKeywords,
  deleteGifTrigger,
};
