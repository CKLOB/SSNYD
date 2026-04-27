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

export interface Schedule extends RowDataPacket {
  id: number;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  message: string;
  hour: number;
  minute: number;
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
      minute TINYINT NOT NULL
    )
  `);
  try {
    await pool.execute(
      `ALTER TABLE schedules ADD COLUMN guild_id VARCHAR(30) NOT NULL DEFAULT '' AFTER id`,
    );
  } catch (_) {}
}

async function getUser(guildId: string, id: string, username: string): Promise<User> {
  await pool.execute(`INSERT IGNORE INTO users (id, guild_id, username) VALUES (?, ?, ?)`, [
    id,
    guildId,
    username,
  ]);
  const [rows] = await pool.execute<User[]>(
    `SELECT * FROM users WHERE id = ? AND guild_id = ?`,
    [id, guildId],
  );
  return rows[0];
}

async function updateBalance(guildId: string, id: string, delta: number): Promise<void> {
  await pool.execute(`UPDATE users SET balance = balance + ? WHERE id = ? AND guild_id = ?`, [
    delta,
    id,
    guildId,
  ]);
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
): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO schedules (guild_id, channel_id, channel_name, message, hour, minute) VALUES (?, ?, ?, ?, ?, ?)`,
    [guildId, channelId, channelName, message, hour, minute],
  );
  return result.insertId;
}

async function getAllSchedules(): Promise<Schedule[]> {
  const [rows] = await pool.execute<Schedule[]>(`SELECT * FROM schedules ORDER BY id`);
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
  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM schedules WHERE guild_id = ?`,
    [guildId],
  );
  return result.affectedRows;
}

interface GuildSettingsRow extends RowDataPacket {
  gambling_enabled: number;
}

async function getGamblingEnabled(guildId: string): Promise<boolean> {
  const [rows] = await pool.execute<GuildSettingsRow[]>(
    `SELECT gambling_enabled FROM guild_settings WHERE guild_id = ?`,
    [guildId],
  );
  return rows.length === 0 ? true : rows[0].gambling_enabled === 1;
}

async function setGamblingEnabled(guildId: string, enabled: boolean): Promise<void> {
  await pool.execute(
    `INSERT INTO guild_settings (guild_id, gambling_enabled) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE gambling_enabled = VALUES(gambling_enabled)`,
    [guildId, enabled ? 1 : 0],
  );
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
  setField,
  getTopUsers,
  addSchedule,
  getAllSchedules,
  getSchedules,
  deleteSchedule,
  deleteAllSchedules,
  getGamblingEnabled,
  setGamblingEnabled,
};
