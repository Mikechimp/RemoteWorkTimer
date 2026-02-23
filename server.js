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

// ─── Dashboard Summary ──────────────────────────────────
app.get('/api/stats/dashboard', (req, res) => {
  // Today's stats
  const today = db.prepare(`
    SELECT
      COUNT(*) AS sessions_count,
      COALESCE(SUM(s.task_count), 0) AS total_tasks,
      COALESCE(SUM(
        CASE WHEN s.end_time IS NOT NULL
          THEN (julianday(s.end_time) - julianday(s.start_time)) * 86400
          ELSE (julianday(datetime('now')) - julianday(s.start_time)) * 86400
        END
      ), 0) AS total_seconds
    FROM sessions s
    WHERE date(s.start_time) = date('now')
  `).get();

  // Weekly breakdown (last 7 days)
  const week = db.prepare(`
    SELECT
      date(s.start_time) AS day,
      COUNT(*) AS sessions_count,
      COALESCE(SUM(
        CASE WHEN s.end_time IS NOT NULL
          THEN (julianday(s.end_time) - julianday(s.start_time)) * 86400
          ELSE 0
        END
      ), 0) AS total_seconds
    FROM sessions s
    WHERE date(s.start_time) >= date('now', '-6 days')
    GROUP BY date(s.start_time)
    ORDER BY day ASC
  `).all();

  // Streak: count consecutive days with sessions ending today or yesterday
  const activeDays = db.prepare(`
    SELECT DISTINCT date(s.start_time) AS day
    FROM sessions s
    WHERE s.end_time IS NOT NULL
    ORDER BY day DESC
  `).all().map(r => r.day);

  let streak = 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  // Check if today or yesterday has a session (allows continuing streak)
  const hasToday = activeDays.includes(todayStr);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const startFrom = hasToday ? todayStr : (activeDays.includes(yesterday) ? yesterday : null);

  if (startFrom) {
    let checkDate = new Date(startFrom + 'T00:00:00');
    for (const day of activeDays) {
      const expected = checkDate.toISOString().slice(0, 10);
      if (day === expected) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (day < expected) {
        break;
      }
    }
  }

  // Best streak
  let bestStreak = 0;
  let currentRun = 0;
  for (let i = 0; i < activeDays.length; i++) {
    if (i === 0) {
      currentRun = 1;
    } else {
      const prev = new Date(activeDays[i - 1] + 'T00:00:00');
      const curr = new Date(activeDays[i] + 'T00:00:00');
      const diff = (prev - curr) / 86400000;
      if (diff === 1) {
        currentRun++;
      } else {
        currentRun = 1;
      }
    }
    bestStreak = Math.max(bestStreak, currentRun);
  }

  // Total all-time hours for level system
  const allTime = db.prepare(`
    SELECT COALESCE(SUM(
      (julianday(s.end_time) - julianday(s.start_time)) * 86400
    ), 0) AS total_seconds
    FROM sessions s
    WHERE s.end_time IS NOT NULL
  `).get();

  const totalHours = allTime.total_seconds / 3600;

  // Level thresholds (hours)
  const levels = [
    { level: 1,  title: 'Newcomer',     hours: 0 },
    { level: 2,  title: 'Getting Started', hours: 2 },
    { level: 3,  title: 'Regular',       hours: 5 },
    { level: 4,  title: 'Committed',     hours: 10 },
    { level: 5,  title: 'Dedicated',     hours: 20 },
    { level: 6,  title: 'Powerhouse',    hours: 40 },
    { level: 7,  title: 'Expert',        hours: 70 },
    { level: 8,  title: 'Veteran',       hours: 100 },
    { level: 9,  title: 'Elite',         hours: 150 },
    { level: 10, title: 'Legend',        hours: 200 },
  ];

  let currentLevel = levels[0];
  let nextLevel = levels[1];
  for (let i = levels.length - 1; i >= 0; i--) {
    if (totalHours >= levels[i].hours) {
      currentLevel = levels[i];
      nextLevel = levels[i + 1] || null;
      break;
    }
  }

  // Daily goal from settings (default 4 hours = 14400 seconds)
  const goalRow = db.prepare("SELECT value FROM settings WHERE key = 'daily_goal_hours'").get();
  const dailyGoalHours = goalRow ? parseFloat(goalRow.value) : 4;

  // Week total
  const weekTotal = week.reduce((sum, d) => sum + d.total_seconds, 0);

  res.json({
    today: {
      seconds: Math.round(today.total_seconds),
      sessions: today.sessions_count,
      tasks: today.total_tasks,
      goal_seconds: dailyGoalHours * 3600,
      goal_hours: dailyGoalHours,
    },
    week: {
      days: week,
      total_seconds: Math.round(weekTotal),
    },
    streak: {
      current: streak,
      best: bestStreak,
    },
    level: {
      current: currentLevel,
      next: nextLevel,
      total_hours: Math.round(totalHours * 10) / 10,
      progress: nextLevel ? (totalHours - currentLevel.hours) / (nextLevel.hours - currentLevel.hours) : 1,
    },
  });
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
