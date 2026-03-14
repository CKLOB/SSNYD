const mysql = require("mysql2/promise");

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
      id VARCHAR(30) PRIMARY KEY,
      username VARCHAR(100) NOT NULL,
      balance BIGINT NOT NULL DEFAULT 150000,
      last_attendance DATETIME NULL,
      last_work DATETIME NULL,
      last_support DATETIME NULL
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      channel_id VARCHAR(30) NOT NULL,
      channel_name VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      hour TINYINT NOT NULL,
      minute TINYINT NOT NULL
    )
  `);
}

async function getUser(id, username) {
  await pool.execute(
    `INSERT IGNORE INTO users (id, username) VALUES (?, ?)`,
    [id, username]
  );
  const [rows] = await pool.execute(`SELECT * FROM users WHERE id = ?`, [id]);
  return rows[0];
}

async function updateBalance(id, delta) {
  await pool.execute(
    `UPDATE users SET balance = balance + ? WHERE id = ?`,
    [delta, id]
  );
}

async function setField(id, field, value) {
  const allowed = ["last_attendance", "last_work", "last_support"];
  if (!allowed.includes(field)) throw new Error(`Invalid field: ${field}`);
  await pool.execute(`UPDATE users SET ${field} = ? WHERE id = ?`, [value, id]);
}

async function getTopUsers(limit = 10) {
  const [rows] = await pool.execute(
    `SELECT * FROM users ORDER BY balance DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

async function addSchedule(channelId, channelName, message, hour, minute) {
  const [result] = await pool.execute(
    `INSERT INTO schedules (channel_id, channel_name, message, hour, minute) VALUES (?, ?, ?, ?, ?)`,
    [channelId, channelName, message, hour, minute]
  );
  return result.insertId;
}

async function getSchedules() {
  const [rows] = await pool.execute(`SELECT * FROM schedules ORDER BY id`);
  return rows;
}

async function deleteSchedule(id) {
  const [result] = await pool.execute(`DELETE FROM schedules WHERE id = ?`, [id]);
  return result.affectedRows > 0;
}

module.exports = { init, getUser, updateBalance, setField, getTopUsers, addSchedule, getSchedules, deleteSchedule };
