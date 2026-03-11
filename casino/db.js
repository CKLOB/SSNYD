const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "casino_db.json");

function load() {
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, "{}", "utf8");
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getUser(id, username) {
  const data = load();
  if (!data[id]) {
    data[id] = {
      id,
      username,
      balance: 150000,
      last_attendance: null,
      last_work: null,
      last_support: null,
    };
    save(data);
  }
  return data[id];
}

function updateBalance(id, delta) {
  const data = load();
  data[id].balance += delta;
  save(data);
}

function setField(id, field, value) {
  const data = load();
  data[id][field] = value;
  save(data);
}

function getTopUsers(limit = 10) {
  const data = load();
  return Object.values(data)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

module.exports = { getUser, updateBalance, setField, getTopUsers };
