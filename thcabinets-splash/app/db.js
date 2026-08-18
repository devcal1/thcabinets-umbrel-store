const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_DIR = process.env.DB_DIR || path.join(__dirname, "db");
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, "photos.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    thumb_filename TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

module.exports = db;
