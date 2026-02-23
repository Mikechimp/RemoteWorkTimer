const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'remoteworkpal.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT NOT NULL DEFAULT 'general',
    start_time TEXT NOT NULL DEFAULT (datetime('now')),
    end_time TEXT,
    task_count INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    task_type TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

module.exports = db;
