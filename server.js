const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Sessions ────────────────────────────────────────────

app.get('/api/sessions', (req, res) => {
  const { limit } = req.query;
  const rows = db.prepare(`
    SELECT s.*,
      CASE WHEN s.end_time IS NOT NULL
        THEN (julianday(s.end_time) - julianday(s.start_time)) * 86400
        ELSE NULL
      END AS duration_seconds
    FROM sessions s
    ORDER BY s.start_time DESC
    LIMIT ?
  `).all(limit ? Number(limit) : 50);
  res.json(rows);
});

app.get('/api/sessions/active', (req, res) => {
  const session = db.prepare(`
    SELECT s.*,
      (julianday(datetime('now')) - julianday(s.start_time)) * 86400 AS elapsed_seconds
    FROM sessions s
    WHERE s.end_time IS NULL
    ORDER BY s.start_time DESC
    LIMIT 1
  `).get();
  res.json(session || null);
});

app.post('/api/sessions', (req, res) => {
  const { task_type } = req.body;
  // Stop any active session first
  db.prepare("UPDATE sessions SET end_time = datetime('now') WHERE end_time IS NULL").run();
  const info = db.prepare('INSERT INTO sessions (task_type) VALUES (?)').run(task_type || 'general');
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(session);
});

app.post('/api/sessions/:id/stop', (req, res) => {
  db.prepare("UPDATE sessions SET end_time = datetime('now') WHERE id = ? AND end_time IS NULL").run(req.params.id);
  const session = db.prepare(`
    SELECT s.*,
      (julianday(s.end_time) - julianday(s.start_time)) * 86400 AS duration_seconds
    FROM sessions s WHERE id = ?
  `).get(req.params.id);
  res.json(session);
});

app.post('/api/sessions/:id/increment', (req, res) => {
  db.prepare('UPDATE sessions SET task_count = task_count + 1 WHERE id = ?').run(req.params.id);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  res.json(session);
});

app.delete('/api/sessions/:id', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Stats ───────────────────────────────────────────────

app.get('/api/stats/today', (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS sessions_count,
      COALESCE(SUM(s.task_count), 0) AS total_tasks,
      COALESCE(SUM(
        CASE WHEN s.end_time IS NOT NULL
          THEN (julianday(s.end_time) - julianday(s.start_time)) * 86400
          ELSE 0
        END
      ), 0) AS total_seconds
    FROM sessions s
    WHERE date(s.start_time) = date('now')
  `).get();
  res.json(stats);
});

app.get('/api/stats/week', (req, res) => {
  const rows = db.prepare(`
    SELECT
      date(s.start_time) AS day,
      COUNT(*) AS sessions_count,
      COALESCE(SUM(s.task_count), 0) AS total_tasks,
      COALESCE(SUM(
        CASE WHEN s.end_time IS NOT NULL
          THEN (julianday(s.end_time) - julianday(s.start_time)) * 86400
          ELSE 0
        END
      ), 0) AS total_seconds
    FROM sessions s
    WHERE date(s.start_time) >= date('now', '-7 days')
    GROUP BY date(s.start_time)
    ORDER BY day ASC
  `).all();
  res.json(rows);
});

// ─── Saved Templates ────────────────────────────────────

app.get('/api/templates', (req, res) => {
  const rows = db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/templates', (req, res) => {
  const { name, task_type, content } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const info = db.prepare('INSERT INTO templates (name, task_type, content) VALUES (?, ?, ?)')
    .run(name, task_type || 'general', JSON.stringify(content || {}));
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(template);
});

app.delete('/api/templates/:id', (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Remote Work Pal running at http://localhost:${PORT}`);
});
