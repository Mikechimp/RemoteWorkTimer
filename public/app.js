// ═══ Remote Work Pal ═══════════════════════════════════════
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let activeSession = null;
let timerInterval = null;

// ─── API Helper ──────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ─── Toast ───────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  $('#toast-container').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

// ─── Formatters ──────────────────────────────────────────
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtShortDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtPace(tasks, sec) {
  if (sec < 60) return '0.0';
  return (tasks / (sec / 3600)).toFixed(1);
}

function fmtTime(utcStr) {
  if (!utcStr) return '';
  const d = new Date(utcStr + 'Z');
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

const TYPE_LABELS = { h2h: 'H2H', graph: 'Graph', general: 'GEN' };

// ─── Navigation ──────────────────────────────────────────
$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#view-${btn.dataset.view}`).classList.add('active');

    if (btn.dataset.view === 'dashboard') {
      loadTodayStats();
      loadRecentSessions();
    }
    if (btn.dataset.view === 'sessions') {
      loadWeekChart();
      loadSessionHistory();
    }
  });
});

// ─── Theme Toggle ────────────────────────────────────────
function setTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('rwp-theme', dark ? 'dark' : 'light');
  $('#dark-mode-toggle').checked = dark;
}

$('#theme-toggle').addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  setTheme(!isDark);
});

$('#dark-mode-toggle').addEventListener('change', (e) => {
  setTheme(e.target.checked);
});

// Init theme
const savedTheme = localStorage.getItem('rwp-theme');
setTheme(savedTheme !== 'light');

// ─── Active Session ──────────────────────────────────────
async function loadActiveSession() {
  try {
    activeSession = await api('/sessions/active');
    updateSessionUI();
  } catch (e) { /* silent */ }
}

function updateSessionUI() {
  const el = $('#active-session');
  if (!activeSession) {
    el.classList.add('hidden');
    clearInterval(timerInterval);
    return;
  }

  el.classList.remove('hidden');
  $('#session-type-label').textContent = TYPE_LABELS[activeSession.task_type] || activeSession.task_type;
  $('#session-task-count').textContent = activeSession.task_count;

  const startMs = new Date(activeSession.start_time + 'Z').getTime();
  clearInterval(timerInterval);

  function tick() {
    const elapsed = (Date.now() - startMs) / 1000;
    $('#session-timer').textContent = fmtDuration(elapsed);
    $('#session-pace').textContent = fmtPace(activeSession.task_count, elapsed);
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

// Start session
$$('.start-card').forEach(card => {
  card.addEventListener('click', async () => {
    try {
      activeSession = await api('/sessions', { method: 'POST', body: { task_type: card.dataset.type } });
      updateSessionUI();
      loadTodayStats();
      toast('Session started', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
});

// +1 task
$('#task-done-btn').addEventListener('click', async () => {
  if (!activeSession) return;
  try {
    activeSession = await api(`/sessions/${activeSession.id}/increment`, { method: 'POST' });
    $('#session-task-count').textContent = activeSession.task_count;
    // Force pace recalc on next tick
    toast(`Task #${activeSession.task_count} logged`, 'success');
  } catch (e) { toast(e.message, 'error'); }
});

// Stop session
$('#stop-session-btn').addEventListener('click', async () => {
  if (!activeSession) return;
  try {
    await api(`/sessions/${activeSession.id}/stop`, { method: 'POST' });
    activeSession = null;
    updateSessionUI();
    loadTodayStats();
    loadRecentSessions();
    toast('Session stopped', 'info');
  } catch (e) { toast(e.message, 'error'); }
});

// ─── Today Stats ─────────────────────────────────────────
async function loadTodayStats() {
  try {
    const s = await api('/stats/today');
    $('#today-tasks').textContent = s.total_tasks;
    $('#today-time').textContent = fmtShortDuration(s.total_seconds);
    $('#today-pace').textContent = s.total_seconds > 60 ? fmtPace(s.total_tasks, s.total_seconds) : '0.0';
  } catch (e) { /* silent */ }
}

// ─── Recent Sessions ─────────────────────────────────────
async function loadRecentSessions() {
  try {
    const sessions = await api('/sessions?limit=5');
    const el = $('#recent-sessions');
    if (sessions.length === 0) {
      el.innerHTML = '<div class="empty-state">No sessions yet. Start one above.</div>';
      return;
    }
    el.innerHTML = sessions.filter(s => s.end_time).map(s => `
      <div class="session-item">
        <div class="si-type">${esc(TYPE_LABELS[s.task_type] || s.task_type)}</div>
        <div class="si-details">
          <div class="si-stats">${s.task_count} tasks in ${fmtShortDuration(s.duration_seconds || 0)}</div>
          <div class="si-time">${fmtTime(s.start_time)}</div>
        </div>
      </div>
    `).join('');
  } catch (e) { /* silent */ }
}

// ─── Template Tabs ───────────────────────────────────────
$$('.tt-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tt-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.template-builder').forEach(b => b.classList.add('hidden'));
    $(`#tt-${tab.dataset.tt}`).classList.remove('hidden');
  });
});

// ─── H2H Template Builder ────────────────────────────────
let h2hState = { winner: 'a', qualities: [], issues: [] };

// Winner toggle
$$('[data-winner]').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('[data-winner]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    h2hState.winner = chip.dataset.winner;
    renderH2HPreview();
  });
});

// Quality chips
$$('#h2h-qualities .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('active');
    const val = chip.dataset.val;
    if (chip.classList.contains('active')) {
      h2hState.qualities.push(val);
    } else {
      h2hState.qualities = h2hState.qualities.filter(q => q !== val);
    }
    renderH2HPreview();
  });
});

// Issue chips
$$('#h2h-issues .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('active');
    const val = chip.dataset.val;
    if (chip.classList.contains('active')) {
      h2hState.issues.push(val);
    } else {
      h2hState.issues = h2hState.issues.filter(i => i !== val);
    }
    renderH2HPreview();
  });
});

$('#h2h-notes').addEventListener('input', renderH2HPreview);

function renderH2HPreview() {
  const { winner, qualities, issues } = h2hState;
  const notes = $('#h2h-notes').value.trim();
  const preview = $('#h2h-preview');

  if (winner === 'tie') {
    let text = 'Both responses are roughly equal in quality.';
    if (qualities.length > 0) {
      text += ` Both are ${joinList(qualities)}.`;
    }
    if (notes) text += ` ${notes}`;
    preview.textContent = text;
    preview.classList.add('has-content');
    return;
  }

  const w = winner.toUpperCase();
  const l = winner === 'a' ? 'B' : 'A';

  if (qualities.length === 0 && issues.length === 0) {
    preview.textContent = 'Select qualities and/or issues to generate text...';
    preview.classList.remove('has-content');
    return;
  }

  let text = `Response ${w} is the better response.`;

  if (qualities.length > 0) {
    text += ` Response ${w} is ${joinList(qualities)}.`;
  }

  if (issues.length > 0) {
    text += ` Response ${l} ${joinList(issues)}.`;
  }

  if (notes) text += ` ${notes}`;

  preview.textContent = text;
  preview.classList.add('has-content');
}

function joinList(arr) {
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
}

$('#h2h-copy').addEventListener('click', () => {
  const text = $('#h2h-preview').textContent;
  if (text && !text.includes('Select')) {
    navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success'));
  }
});

// ─── Graph Review Template Builder ───────────────────────
let graphState = { verdict: 'pass', observations: [] };

// Verdict toggle
$$('[data-verdict]').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('[data-verdict]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    graphState.verdict = chip.dataset.verdict;
    renderGraphPreview();
  });
});

// Observation chips
$$('#graph-observations .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('active');
    const val = chip.dataset.val;
    if (chip.classList.contains('active')) {
      graphState.observations.push(val);
    } else {
      graphState.observations = graphState.observations.filter(o => o !== val);
    }
    renderGraphPreview();
  });
});

$('#graph-notes').addEventListener('input', renderGraphPreview);

function renderGraphPreview() {
  const { verdict, observations } = graphState;
  const notes = $('#graph-notes').value.trim();
  const preview = $('#graph-preview');

  if (observations.length === 0) {
    preview.textContent = 'Select observations to generate text...';
    preview.classList.remove('has-content');
    return;
  }

  const v = verdict === 'pass' ? 'PASS' : 'FAIL';
  let text = `Verdict: ${v}\n\n`;
  text += observations.join('. ') + '.';

  if (notes) text += `\n\n${notes}`;

  preview.textContent = text;
  preview.classList.add('has-content');
}

$('#graph-copy').addEventListener('click', () => {
  const text = $('#graph-preview').textContent;
  if (text && !text.includes('Select')) {
    navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success'));
  }
});

// ─── Sessions View / Week Chart ──────────────────────────
async function loadWeekChart() {
  try {
    const data = await api('/stats/week');
    const chart = $('#week-chart');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build 7-day array
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const found = data.find(r => r.day === key);
      days.push({
        label: dayNames[d.getDay()],
        tasks: found ? found.total_tasks : 0,
        seconds: found ? found.total_seconds : 0,
      });
    }

    const maxTasks = Math.max(...days.map(d => d.tasks), 1);

    chart.innerHTML = days.map(d => `
      <div class="wc-bar">
        <div class="wc-count">${d.tasks || ''}</div>
        <div class="wc-fill" style="height: ${Math.max(d.tasks / maxTasks * 80, 2)}%"></div>
        <div class="wc-label">${d.label}</div>
      </div>
    `).join('');

    // Week totals
    const totalTasks = days.reduce((s, d) => s + d.tasks, 0);
    const totalSec = days.reduce((s, d) => s + d.seconds, 0);
    const weekStats = $('#week-stats');
    weekStats.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${totalTasks}</div>
        <div class="stat-label">Tasks</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtShortDuration(totalSec)}</div>
        <div class="stat-label">Total Time</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalSec > 60 ? fmtPace(totalTasks, totalSec) : '0.0'}</div>
        <div class="stat-label">Avg Pace</div>
      </div>
    `;
  } catch (e) { /* silent */ }
}

async function loadSessionHistory() {
  try {
    const sessions = await api('/sessions?limit=50');
    const el = $('#session-history');
    const completed = sessions.filter(s => s.end_time);

    if (completed.length === 0) {
      el.innerHTML = '<div class="empty-state">No completed sessions yet.</div>';
      return;
    }

    el.innerHTML = completed.map(s => `
      <div class="session-item" data-id="${s.id}">
        <div class="si-type">${esc(TYPE_LABELS[s.task_type] || s.task_type)}</div>
        <div class="si-details">
          <div class="si-stats">${s.task_count} tasks in ${fmtShortDuration(s.duration_seconds || 0)} (${fmtPace(s.task_count, s.duration_seconds || 0)}/hr)</div>
          <div class="si-time">${fmtTime(s.start_time)}</div>
        </div>
        <button class="si-delete" data-del="${s.id}" title="Delete">&times;</button>
      </div>
    `).join('');

    el.querySelectorAll('.si-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Delete this session?')) {
          try {
            await api(`/sessions/${btn.dataset.del}`, { method: 'DELETE' });
            loadSessionHistory();
            loadWeekChart();
            loadTodayStats();
          } catch (e) { toast(e.message, 'error'); }
        }
      });
    });
  } catch (e) { /* silent */ }
}

// ─── Mango Fix Bookmarklet ───────────────────────────────
const MANGO_CSS = `
  * { max-width: 100vw !important; }
  body { overflow-x: hidden !important; }
  table { display: block !important; overflow-x: auto !important; width: 100% !important; }
  pre, code { white-space: pre-wrap !important; word-break: break-word !important; }
  .container, .main-content, [class*="container"], [class*="wrapper"], [class*="content"] {
    max-width: 100% !important; width: 100% !important; padding: 8px !important;
    overflow-x: hidden !important;
  }
  [class*="sidebar"], [class*="side-panel"] {
    position: static !important; width: 100% !important;
  }
  [style*="width:"], [style*="min-width:"] {
    max-width: 100% !important; min-width: 0 !important;
  }
  img, svg, canvas, video { max-width: 100% !important; height: auto !important; }
  [class*="flex"], [class*="grid"] {
    flex-wrap: wrap !important;
  }
  [class*="col-"], [class*="column"] {
    flex: 1 1 100% !important; max-width: 100% !important;
  }
  textarea, input, select { max-width: 100% !important; font-size: 16px !important; }
  button, [role="button"], a.btn { min-height: 44px !important; min-width: 44px !important; }
`.replace(/\n\s*/g, ' ').trim();

const bookmarkletCode = `javascript:void((function(){var s=document.createElement('style');s.textContent='${MANGO_CSS.replace(/'/g, "\\'")}';document.head.appendChild(s);document.querySelector('meta[name=viewport]')||document.head.insertAdjacentHTML('beforeend','<meta name=viewport content=\"width=device-width,initial-scale=1\">');})())`;

$('#mango-bookmarklet').href = bookmarkletCode;
$('#bookmarklet-code').textContent = bookmarkletCode;

$('#copy-bookmarklet').addEventListener('click', () => {
  navigator.clipboard.writeText(bookmarkletCode).then(
    () => toast('Bookmarklet code copied!', 'success'),
    () => toast('Copy failed — long press to select the code above', 'error')
  );
});

// ─── Init ────────────────────────────────────────────────
loadActiveSession();
loadTodayStats();
loadRecentSessions();

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
