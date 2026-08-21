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

db.exec(`
  CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    hue INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS week_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    week_start TEXT NOT NULL,
    panel TEXT NOT NULL CHECK(panel IN ('manufacturing','installing')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_row_id INTEGER NOT NULL REFERENCES week_rows(id),
    day TEXT NOT NULL CHECK(day IN ('mon','tue','wed','thu','fri')),
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_week_rows_lookup ON week_rows(week_start, panel, sort_order);
  CREATE INDEX IF NOT EXISTS idx_assignments_row ON assignments(week_row_id, day);
`);

// Seed a starter worker roster on first run, so the schedule isn't blank on install.
const workerCount = db.prepare("SELECT COUNT(*) AS n FROM workers").get().n;
if (workerCount === 0) {
  const insertWorker = db.prepare(
    "INSERT INTO workers (name, hue, sort_order) VALUES (?, ?, ?)"
  );
  const starters = ["Blay", "Sam", "Darcy", "Shooter", "Moo", "Michael"];
  const insertMany = db.transaction((names) => {
    names.forEach((name, i) => insertWorker.run(name, (i * 137) % 360, i));
  });
  insertMany(starters);
}

module.exports = db;
