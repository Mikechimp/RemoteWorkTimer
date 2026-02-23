require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Health ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── Config (env + DB merged, read-only) ─────────────────
app.get('/api/config', (req, res) => {
  const overrides = {};
  db.prepare('SELECT key, value FROM settings').all()
    .forEach(r => { overrides[r.key] = r.value; });

  res.json({
    handshake_url: overrides.handshake_url || process.env.HANDSHAKE_PROJECT_URL || '',
    multimango_url: overrides.multimango_url || process.env.MULTIMANGO_URL || '',
    timer_api_url: overrides.timer_api_url || process.env.HANDSHAKE_TIMER_API_URL || '',
  });
});

// ─── Settings (DB store, read/write) ─────────────────────
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  res.json(out);
});

app.put('/api/settings', (req, res) => {
  const entries = req.body;
  if (!entries || typeof entries !== 'object') {
    return res.status(400).json({ error: 'Expected object of key/value pairs' });
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const tx = db.transaction((pairs) => {
    for (const [k, v] of Object.entries(pairs)) {
      upsert.run(k, String(v || ''));
    }
  });

  tx(entries);
  res.json({ ok: true });
});

// ─── Timer Proxy ─────────────────────────────────────────
app.get('/api/timer-status', async (req, res) => {
  const overrides = {};
  db.prepare('SELECT key, value FROM settings').all()
    .forEach(r => { overrides[r.key] = r.value; });

  const timerUrl = overrides.timer_api_url || process.env.HANDSHAKE_TIMER_API_URL;

  if (!timerUrl) {
    return res.json({ enabled: false });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(timerUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    res.json({ enabled: true, data });
  } catch (err) {
    res.json({ enabled: false, error: err.message });
  }
});

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

// ─── Templates ──────────────────────────────────────────
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Remote Work Hub running at http://localhost:${PORT}`);
});
