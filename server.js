const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Reusable SQL fragment for computing duration in seconds from a time entry
const DURATION_SEC = `(julianday(te.end_time) - julianday(te.start_time)) * 86400`;
const DURATION_HOURS = `(julianday(te.end_time) - julianday(te.start_time)) * 24`;

// ─── Projects ───────────────────────────────────────────

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

app.delete('/api/tasks/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ─── Time Entries ───────────────────────────────────────

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

app.delete('/api/entries/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM time_entries WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// ─── Reports ────────────────────────────────────────────

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

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="time-report-${from}-to-${to}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// ─── Active timer (global) ──────────────────────────────

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

app.listen(PORT, () => {
  console.log(`Remote Work Timer running at http://localhost:${PORT}`);
});
