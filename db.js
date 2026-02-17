/**
 * db.js — Database initialization and schema definition.
 *
 * This module creates (or opens) an SQLite database file and sets up the three
 * core tables used by the application: projects, tasks, and time_entries.
 *
 * EDITABLE PARAMETERS:
 *  - Database file name: change 'timetracker.db' below to use a different file.
 *  - Default project rate: change DEFAULT 0 in the projects table to set a
 *    different starting hourly rate for new projects.
 *  - Default project color: change DEFAULT '#4f46e5' to set a different default
 *    color hex value for new projects.
 */
const Database = require('better-sqlite3');
const path = require('path');

/**
 * Open (or create) the SQLite database file.
 * @param {string} 'timetracker.db' — the database filename stored in the same
 *   directory as this script. Change this string to rename or relocate the DB.
 */
const db = new Database(path.join(__dirname, 'timetracker.db'));

/**
 * Enable WAL (Write-Ahead Logging) journal mode for better concurrent read
 * performance. Change to 'DELETE' or 'TRUNCATE' if WAL causes issues.
 */
db.pragma('journal_mode = WAL');

/**
 * Enable foreign key constraint enforcement so that deleting a project
 * automatically cascades to its tasks and time entries.
 */
db.pragma('foreign_keys = ON');

db.exec(`
  /**
   * projects — Each row is a client/project you track time for.
   *
   * Columns you may want to change defaults for:
   *  - rate  REAL DEFAULT 0         → default hourly rate for new projects (dollars)
   *  - color TEXT DEFAULT '#4f46e5' → default card accent color (hex string)
   *  - archived INTEGER DEFAULT 0   → 0 = active, 1 = archived (hidden from dashboard)
   */
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rate REAL DEFAULT 0,
    color TEXT DEFAULT '#4f46e5',
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  /**
   * tasks — Individual work items that belong to a project.
   *
   * Columns you may want to change defaults for:
   *  - completed INTEGER DEFAULT 0 → 0 = open, 1 = completed
   *
   * ON DELETE CASCADE: deleting a project removes all its tasks automatically.
   */
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  /**
   * time_entries — Individual time tracking records tied to a task.
   *
   * Key behavior:
   *  - end_time is NULL while a timer is actively running.
   *  - notes defaults to an empty string.
   *  - Times are stored as UTC text strings (e.g. '2025-01-15 14:30:00').
   *
   * ON DELETE CASCADE: deleting a task removes all its time entries automatically.
   */
  CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );
`);

module.exports = db;
