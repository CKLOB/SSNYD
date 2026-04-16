import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

async function init() {
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

async function getUser(guildId, id, username) {
  await pool.execute(`INSERT IGNORE INTO users (id, guild_id, username) VALUES (?, ?, ?)`, [
    id,
    guildId,
    username,
  ]);
  const [rows] = await pool.execute(`SELECT * FROM users WHERE id = ? AND guild_id = ?`, [
    id,
    guildId,
  ]);
  return rows[0];
}

async function updateBalance(guildId, id, delta) {
  await pool.execute(`UPDATE users SET balance = balance + ? WHERE id = ? AND guild_id = ?`, [
    delta,
    id,
    guildId,
  ]);
}

async function setField(guildId, id, field, value) {
  const allowed = ["last_attendance", "last_work", "last_support"];
  if (!allowed.includes(field)) throw new Error(`Invalid field: ${field}`);
  await pool.execute(`UPDATE users SET ${field} = ? WHERE id = ? AND guild_id = ?`, [
    value,
    id,
    guildId,
  ]);
}

async function getTopUsers(guildId, limit = 10) {
  const [rows] = await pool.execute(
    `SELECT * FROM users WHERE guild_id = ? ORDER BY balance DESC LIMIT ?`,
    [guildId, limit],
  );
  return rows;
}

async function addSchedule(guildId, channelId, channelName, message, hour, minute) {
  const [result] = await pool.execute(
    `INSERT INTO schedules (guild_id, channel_id, channel_name, message, hour, minute) VALUES (?, ?, ?, ?, ?, ?)`,
    [guildId, channelId, channelName, message, hour, minute],
  );
  return result.insertId;
}

async function getAllSchedules() {
  const [rows] = await pool.execute(`SELECT * FROM schedules ORDER BY id`);
  return rows;
}

async function getSchedules(guildId) {
  const [rows] = await pool.execute(`SELECT * FROM schedules WHERE guild_id = ? ORDER BY id`, [
    guildId,
  ]);
  return rows;
}

async function deleteSchedule(id, guildId) {
  const [result] = await pool.execute(`DELETE FROM schedules WHERE id = ? AND guild_id = ?`, [
    id,
    guildId,
  ]);
  return result.affectedRows > 0;
}

async function deleteAllSchedules(guildId) {
  const [result] = await pool.execute(`DELETE FROM schedules WHERE guild_id = ?`, [guildId]);
  return result.affectedRows;
}

async function ping() {
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
};
