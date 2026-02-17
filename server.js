/**
 * server.js — Express API server for the Remote Work Timer.
 *
 * Serves the static frontend from /public and exposes REST endpoints for
 * projects, tasks, time entries, reports, and the active timer.
 *
 * EDITABLE PARAMETERS:
 *  - PORT: change the default port (3000) via the PORT environment variable
 *    or by editing the fallback value below.
 *  - All SQL queries use UTC timestamps via SQLite's datetime('now').
 *  - Duration math converts julian-day differences to seconds (* 86400).
 */
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();

/**
 * Server port. Set the PORT environment variable to override.
 * @default 3000
 */
const PORT = process.env.PORT || 3000;

/** Parse incoming JSON request bodies. */
app.use(express.json());

/** Serve static files (index.html, app.js, style.css) from the /public folder. */
app.use(express.static(path.join(__dirname, 'public')));

// Reusable SQL fragment for computing duration in seconds from a time entry
const DURATION_SEC = `(julianday(te.end_time) - julianday(te.start_time)) * 86400`;
const DURATION_HOURS = `(julianday(te.end_time) - julianday(te.start_time)) * 24`;

// ─── Projects ───────────────────────────────────────────

/**
 * GET /api/projects
 * Returns all non-archived projects with computed fields:
 *  - task_count: number of tasks belonging to the project
 *  - total_seconds: total logged time across all tasks (only completed entries)
 *
 * No parameters. Results ordered by created_at DESC (newest first).
 *
 * To include archived projects, remove the `WHERE p.archived = 0` clause.
 */
app.get('/api/projects', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT p.*,
        COUNT(DISTINCT t.id) AS task_count,
        COALESCE(SUM(
          CASE WHEN te.end_time IS NOT NULL THEN ${DURATION_SEC} ELSE 0 END
        ), 0) AS total_seconds
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      LEFT JOIN time_entries te ON te.task_id = t.id
      WHERE p.archived = 0
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

/**
 * POST /api/projects
 * Create a new project.
 *
 * Request body parameters:
 *  @param {string} name     — (required) project display name
 *  @param {number} rate     — hourly rate in dollars, defaults to 0
 *  @param {string} color    — hex color for the project card, defaults to '#4f46e5'
 *
 * Returns the newly created project row (HTTP 201).
 */
app.post('/api/projects', (req, res) => {
  const { name, rate, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const info = db.prepare('INSERT INTO projects (name, rate, color) VALUES (?, ?, ?)').run(
      name, rate || 0, color || '#4f46e5'
    );
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * PUT /api/projects/:id
 * Update an existing project. Uses COALESCE so you can send only the fields
 * you want to change — omitted fields keep their current values.
 *
 * URL parameters:
 *  @param {number} id       — (required) project ID in the URL path
 *
 * Request body parameters (all optional):
 *  @param {string} name     — new project name
 *  @param {number} rate     — new hourly rate
 *  @param {string} color    — new hex color
 *  @param {number} archived — set to 1 to archive, 0 to unarchive
 *
 * Returns the updated project row.
 */
app.put('/api/projects/:id', (req, res) => {
  const { name, rate, color, archived } = req.body;
  try {
    db.prepare(`
      UPDATE projects
      SET name = COALESCE(?, name), rate = COALESCE(?, rate),
          color = COALESCE(?, color), archived = COALESCE(?, archived)
      WHERE id = ?
    `).run(name, rate, color, archived, req.params.id);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * DELETE /api/projects/:id
 * Delete a project and all its tasks/entries (via CASCADE). Also stops any
 * running timers for tasks in this project before deletion.
 *
 * URL parameters:
 *  @param {number} id — (required) project ID to delete
 *
 * Returns { ok: true } on success.
 */
app.delete('/api/projects/:id', (req, res) => {
  try {
    // Stop any running timers for tasks in this project before deleting
    db.prepare(`
      UPDATE time_entries SET end_time = datetime('now')
      WHERE end_time IS NULL AND task_id IN (SELECT id FROM tasks WHERE project_id = ?)
    `).run(req.params.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// ─── Tasks ──────────────────────────────────────────────

/**
 * GET /api/projects/:projectId/tasks
 * List all tasks for a given project with computed fields:
 *  - total_seconds: total logged time for the task (completed entries only)
 *  - running_entry_id: ID of the active timer entry, or NULL if not running
 *
 * URL parameters:
 *  @param {number} projectId — (required) parent project ID
 *
 * Results are ordered: incomplete tasks first (completed ASC), then newest first.
 */
app.get('/api/projects/:projectId/tasks', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT t.*,
        COALESCE(SUM(
          CASE WHEN te.end_time IS NOT NULL THEN ${DURATION_SEC} ELSE 0 END
        ), 0) AS total_seconds,
        (SELECT te2.id FROM time_entries te2
         WHERE te2.task_id = t.id AND te2.end_time IS NULL LIMIT 1) AS running_entry_id
      FROM tasks t
      LEFT JOIN time_entries te ON te.task_id = t.id
      WHERE t.project_id = ?
      GROUP BY t.id
      ORDER BY t.completed ASC, t.created_at DESC
    `).all(req.params.projectId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tasks' });
  }
});

/**
 * POST /api/projects/:projectId/tasks
 * Create a new task under a project.
 *
 * URL parameters:
 *  @param {number} projectId — (required) parent project ID
 *
 * Request body parameters:
 *  @param {string} name — (required) task display name
 *
 * Returns the newly created task row (HTTP 201).
 */
app.post('/api/projects/:projectId/tasks', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const info = db.prepare('INSERT INTO tasks (project_id, name) VALUES (?, ?)').run(req.params.projectId, name);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

/**
 * PUT /api/tasks/:id
 * Update a task. Uses COALESCE so omitted fields stay unchanged.
 *
 * URL parameters:
 *  @param {number} id — (required) task ID
 *
 * Request body parameters (all optional):
 *  @param {string} name      — new task name
 *  @param {number} completed — set to 1 to mark complete, 0 to reopen
 *
 * Returns the updated task row.
 */
app.put('/api/tasks/:id', (req, res) => {
  const { name, completed } = req.body;
  try {
    db.prepare('UPDATE tasks SET name = COALESCE(?, name), completed = COALESCE(?, completed) WHERE id = ?')
      .run(name, completed, req.params.id);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

/**
 * DELETE /api/tasks/:id
 * Delete a task and all its time entries (via CASCADE).
 *
 * URL parameters:
 *  @param {number} id — (required) task ID to delete
 *
 * Returns { ok: true } on success.
 */
app.delete('/api/tasks/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ─── Time Entries ───────────────────────────────────────

/**
 * POST /api/tasks/:taskId/start
 * Start a timer for a task. Enforces a single global timer — if another task
 * has a running timer, it is automatically stopped before the new one starts.
 *
 * URL parameters:
 *  @param {number} taskId — (required) task to start timing
 *
 * Returns the new time_entry row (HTTP 201) with start_time set to now.
 * Returns HTTP 409 if this specific task already has a running timer.
 */
app.post('/api/tasks/:taskId/start', (req, res) => {
  try {
    // Stop any globally running timer first (enforce single timer)
    const running = db.prepare('SELECT id, task_id FROM time_entries WHERE end_time IS NULL').get();
    if (running) {
      if (running.task_id === Number(req.params.taskId)) {
        return res.status(409).json({ error: 'Timer already running for this task' });
      }
      db.prepare("UPDATE time_entries SET end_time = datetime('now') WHERE id = ?").run(running.id);
    }
    const info = db.prepare("INSERT INTO time_entries (task_id, start_time) VALUES (?, datetime('now'))").run(req.params.taskId);
    const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Failed to start timer' });
  }
});

/**
 * POST /api/tasks/:taskId/stop
 * Stop the running timer for a task by setting end_time to now.
 *
 * URL parameters:
 *  @param {number} taskId — (required) task whose timer to stop
 *
 * Returns the updated time_entry row.
 * Returns HTTP 404 if no running timer exists for this task.
 */
app.post('/api/tasks/:taskId/stop', (req, res) => {
  try {
    const entry = db.prepare('SELECT * FROM time_entries WHERE task_id = ? AND end_time IS NULL').get(req.params.taskId);
    if (!entry) return res.status(404).json({ error: 'No running timer for this task' });
    db.prepare("UPDATE time_entries SET end_time = datetime('now') WHERE id = ?").run(entry.id);
    const updated = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entry.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop timer' });
  }
});

/**
 * POST /api/tasks/:taskId/entries
 * Add a manual time entry (for retroactively logging work).
 *
 * URL parameters:
 *  @param {number} taskId — (required) task to add the entry to
 *
 * Request body parameters:
 *  @param {string} start_time — (required) UTC datetime string, e.g. '2025-01-15 09:00:00'
 *  @param {string} end_time   — (required) UTC datetime string, must be after start_time
 *  @param {string} notes      — optional text note, defaults to ''
 *
 * Returns the new time_entry row (HTTP 201).
 */
app.post('/api/tasks/:taskId/entries', (req, res) => {
  const { start_time, end_time, notes } = req.body;
  if (!start_time || !end_time) return res.status(400).json({ error: 'start_time and end_time required' });
  try {
    const info = db.prepare('INSERT INTO time_entries (task_id, start_time, end_time, notes) VALUES (?, ?, ?, ?)')
      .run(req.params.taskId, start_time, end_time, notes || '');
    const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create entry' });
  }
});

/**
 * GET /api/tasks/:taskId/entries
 * List all time entries for a task, with a computed duration_seconds field.
 * Running entries (end_time IS NULL) have duration_seconds = NULL.
 *
 * URL parameters:
 *  @param {number} taskId — (required) task whose entries to list
 *
 * Results ordered by start_time DESC (most recent first).
 */
app.get('/api/tasks/:taskId/entries', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT te.*,
        CASE WHEN te.end_time IS NOT NULL THEN ${DURATION_SEC} ELSE NULL END AS duration_seconds
      FROM time_entries te
      WHERE te.task_id = ?
      ORDER BY te.start_time DESC
    `).all(req.params.taskId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load entries' });
  }
});

/**
 * PUT /api/entries/:id
 * Update a time entry. Uses COALESCE so omitted fields stay unchanged.
 *
 * URL parameters:
 *  @param {number} id — (required) time entry ID
 *
 * Request body parameters (all optional):
 *  @param {string} start_time — new start datetime (UTC string)
 *  @param {string} end_time   — new end datetime (UTC string)
 *  @param {string} notes      — new notes text
 *
 * Returns the updated time_entry row.
 */
app.put('/api/entries/:id', (req, res) => {
  const { start_time, end_time, notes } = req.body;
  try {
    db.prepare(`
      UPDATE time_entries
      SET start_time = COALESCE(?, start_time), end_time = COALESCE(?, end_time), notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(start_time, end_time, notes, req.params.id);
    const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id);
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

/**
 * DELETE /api/entries/:id
 * Delete a single time entry.
 *
 * URL parameters:
 *  @param {number} id — (required) time entry ID to delete
 *
 * Returns { ok: true } on success.
 */
app.delete('/api/entries/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM time_entries WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// ─── Reports ────────────────────────────────────────────

/**
 * GET /api/reports
 * Fetch detailed time entries within a date range, joined with project/task info.
 *
 * Query parameters:
 *  @param {string} from — (required) start date, format 'YYYY-MM-DD'
 *  @param {string} to   — (required) end date, format 'YYYY-MM-DD'
 *
 * Returns an array of entries with: project_name, rate, color, task_name,
 * start_time, end_time, notes, duration_seconds. Only completed entries included.
 */
app.get('/api/reports', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
  try {
    const rows = db.prepare(`
      SELECT
        p.name AS project_name, p.rate, p.color,
        t.name AS task_name,
        te.start_time, te.end_time, te.notes,
        ${DURATION_SEC} AS duration_seconds
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      JOIN projects p ON p.id = t.project_id
      WHERE te.end_time IS NOT NULL
        AND date(te.start_time) >= date(?)
        AND date(te.start_time) <= date(?)
      ORDER BY te.start_time ASC
    `).all(from, to);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

/**
 * GET /api/reports/summary
 * Fetch aggregated time per project within a date range.
 *
 * Query parameters:
 *  @param {string} from — (required) start date, format 'YYYY-MM-DD'
 *  @param {string} to   — (required) end date, format 'YYYY-MM-DD'
 *
 * Returns an array with per-project: project_id, project_name, rate, color,
 * total_seconds, entry_count. Ordered by total time DESC.
 */
app.get('/api/reports/summary', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to query params required' });
  try {
    const rows = db.prepare(`
      SELECT
        p.id AS project_id, p.name AS project_name, p.rate, p.color,
        SUM(${DURATION_SEC}) AS total_seconds,
        COUNT(te.id) AS entry_count
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      JOIN projects p ON p.id = t.project_id
      WHERE te.end_time IS NOT NULL
        AND date(te.start_time) >= date(?)
        AND date(te.start_time) <= date(?)
      GROUP BY p.id
      ORDER BY total_seconds DESC
    `).all(from, to);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

/**
 * GET /api/reports/csv
 * Export time entries as a downloadable CSV file for invoicing.
 *
 * Query parameters:
 *  @param {string} from — (required) start date, format 'YYYY-MM-DD'
 *  @param {string} to   — (required) end date, format 'YYYY-MM-DD'
 *
 * CSV columns: Project, Task, Start, End, Notes, Hours, Rate, Earnings.
 * The filename includes the date range (e.g. time-report-2025-01-01-to-2025-01-31.csv).
 *
 * To add or remove CSV columns, edit the SELECT query and the csv header string below.
 */
app.get('/api/reports/csv', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to query params required' });
  try {
    const rows = db.prepare(`
      SELECT
        p.name AS project, t.name AS task,
        te.start_time, te.end_time, te.notes,
        ROUND(${DURATION_HOURS}, 2) AS hours,
        p.rate,
        ROUND(${DURATION_HOURS} * p.rate, 2) AS earnings
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      JOIN projects p ON p.id = t.project_id
      WHERE te.end_time IS NOT NULL
        AND date(te.start_time) >= date(?)
        AND date(te.start_time) <= date(?)
      ORDER BY te.start_time ASC
    `).all(from, to);

    const escapeCsvField = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

    let csv = 'Project,Task,Start,End,Notes,Hours,Rate,Earnings\n';
    for (const row of rows) {
      csv += [
        escapeCsvField(row.project),
        escapeCsvField(row.task),
        escapeCsvField(row.start_time),
        escapeCsvField(row.end_time),
        escapeCsvField(row.notes),
        row.hours,
        row.rate,
        row.earnings,
      ].join(',') + '\n';
    }

  const rows = db.prepare(`
    SELECT
      p.name AS project,
      t.name AS task,
      te.start_time,
      te.end_time,
      te.notes,
      ROUND((julianday(te.end_time) - julianday(te.start_time)) * 24, 2) AS hours,
      p.rate,
      ROUND((julianday(te.end_time) - julianday(te.start_time)) * 24 * p.rate, 2) AS earnings
    FROM time_entries te
    JOIN tasks t ON t.id = te.task_id
    JOIN projects p ON p.id = t.project_id
    WHERE te.end_time IS NOT NULL
      AND date(te.start_time) >= date(?)
      AND date(te.start_time) <= date(?)
    ORDER BY te.start_time ASC
  `).all(from, to);

  /** CSV header row — edit this to add/remove columns in the export. */
  let csv = 'Project,Task,Start,End,Notes,Hours,Rate,Earnings\n';
  for (const r of rows) {
    const escapedNotes = (r.notes || '').replace(/"/g, '""');
    csv += `"${r.project}","${r.task}","${r.start_time}","${r.end_time}","${escapedNotes}",${r.hours},${r.rate},${r.earnings}\n`;
  }
});

// ─── Active timer (global) ──────────────────────────────

/**
 * GET /api/active
 * Returns the single currently-running time entry (if any), joined with its
 * task name, project name, and project color for display in the active timer bar.
 *
 * No parameters. Returns the entry object or null if no timer is running.
 * Only one timer can run globally at a time (enforced by the /start endpoint).
 */
app.get('/api/active', (req, res) => {
  try {
    const entry = db.prepare(`
      SELECT te.*, t.name AS task_name, p.name AS project_name, p.color
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      JOIN projects p ON p.id = t.project_id
      WHERE te.end_time IS NULL
      LIMIT 1
    `).get();
    res.json(entry || null);
  } catch (err) {
    res.status(500).json({ error: 'Failed to check active timer' });
  }
});

/**
 * Start the Express server on the configured PORT.
 * Change PORT at the top of this file or set the PORT environment variable.
 */
app.listen(PORT, () => {
  console.log(`Remote Work Timer running at http://localhost:${PORT}`);
});
