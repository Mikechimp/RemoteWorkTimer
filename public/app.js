// ═══ Remote Work Pal v4 — Polished Launch Flow ═══════════════
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let config = { handshake_url: '', multimango_url: '', timer_api_url: '' };
let timerPollInterval = null;

// ─── External Session Tracking ──────────────────────────────
// Tracks when user opens an external site so we can greet them on return
const sessions = {
  handshake: { active: false, launchedAt: null, site: 'Handshake' },
  multimango: { active: false, launchedAt: null, site: 'Multimango' },
};

function launchExternal(key, url, label) {
  sessions[key].active = true;
  sessions[key].launchedAt = Date.now();
  updateSessionUI();
  window.open(url, '_blank');
  toast(`Opened ${label} — switch back here when done`, 'info');
}

function getElapsed(launchedAt) {
  if (!launchedAt) return '0:00';
  const sec = Math.floor((Date.now() - launchedAt) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${String(rm).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateSessionUI() {
  // Update Handshake hub session banner
  const hsBanner = $('#hs-session-banner');
  const hsTime = $('#hs-session-time');
  if (sessions.handshake.active && hsBanner) {
    hsBanner.classList.remove('hidden');
    hsTime.textContent = getElapsed(sessions.handshake.launchedAt);
  } else if (hsBanner) {
    hsBanner.classList.add('hidden');
  }

  // Update Multimango hub session banner
  const mmBanner = $('#mm-session-banner');
  const mmTime = $('#mm-session-time');
  if (sessions.multimango.active && mmBanner) {
    mmBanner.classList.remove('hidden');
    mmTime.textContent = getElapsed(sessions.multimango.launchedAt);
  } else if (mmBanner) {
    mmBanner.classList.add('hidden');
  }

  // Update dashboard card subtexts
  const hsStatus = $('#hs-status');
  const mmStatus = $('#mm-status');
  if (sessions.handshake.active) {
    hsStatus.textContent = 'Session Active — ' + getElapsed(sessions.handshake.launchedAt);
    hsStatus.classList.add('hub-active');
  } else {
    hsStatus.textContent = 'Open Projects';
    hsStatus.classList.remove('hub-active');
  }
  if (sessions.multimango.active) {
    mmStatus.textContent = 'Session Active — ' + getElapsed(sessions.multimango.launchedAt);
    mmStatus.classList.add('hub-active');
  } else {
    mmStatus.textContent = 'Open Workspace';
    mmStatus.classList.remove('hub-active');
  }

  // Dashboard active session bar
  const bar = $('#active-session-bar');
  const activeSession = sessions.handshake.active ? sessions.handshake :
                         sessions.multimango.active ? sessions.multimango : null;
  if (activeSession) {
    bar.classList.remove('hidden');
    $('#active-session-site').textContent = activeSession.site;
    $('#active-session-elapsed').textContent = getElapsed(activeSession.launchedAt);
  } else {
    bar.classList.add('hidden');
  }
}

// Tick session timers every second when visible
let sessionTickInterval = null;
function startSessionTick() {
  clearInterval(sessionTickInterval);
  sessionTickInterval = setInterval(() => {
    if (sessions.handshake.active || sessions.multimango.active) {
      updateSessionUI();
    }
  }, 1000);
}
startSessionTick();

// Detect when user returns to the app
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    let returnedFrom = null;
    let elapsed = '';

    // Check which session was active and calculate time
    for (const [key, session] of Object.entries(sessions)) {
      if (session.active) {
        elapsed = getElapsed(session.launchedAt);
        returnedFrom = session.site;
        // Mark session ended
        session.active = false;
        session.launchedAt = null;
      }
    }

    if (returnedFrom) {
      updateSessionUI();
      toast(`Welcome back! You were on ${returnedFrom} for ${elapsed}`, 'success');
    }
  }
});

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
  }, 3000);
}

// ─── Navigation ──────────────────────────────────────────
function navigateTo(viewName) {
  const nav = $('.bottom-nav');
  nav.style.display = '';

  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $(`#view-${viewName}`);
  if (target) target.classList.add('active');

  // Update session indicators when returning to dashboard
  if (viewName === 'dashboard') updateSessionUI();
}

$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.view));
});

// Quick access buttons
$('#quick-templates').addEventListener('click', () => navigateTo('templates'));
$('#quick-settings').addEventListener('click', () => navigateTo('settings'));

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

const savedTheme = localStorage.getItem('rwp-theme');
setTheme(savedTheme !== 'light');

// ─── Config Loading ──────────────────────────────────────
async function loadConfig() {
  try {
    config = await api('/config');
    updateTimerStatus();
  } catch (e) { /* silent */ }
}

// ─── Hub Cards (Dashboard) ──────────────────────────────
$('#card-handshake').addEventListener('click', () => {
  if (!config.handshake_url) {
    toast('Configure Handshake URL in Settings first', 'error');
    navigateTo('settings');
    $('#setting-handshake').focus();
    return;
  }
  navigateTo('handshake');
});

$('#card-multimango').addEventListener('click', () => {
  if (!config.multimango_url) {
    toast('Configure Multimango URL in Settings first', 'error');
    navigateTo('settings');
    $('#setting-multimango').focus();
    return;
  }
  navigateTo('multimango');
});

// ─── Handshake Hub ───────────────────────────────────────
function getHandshakeBase() {
  try {
    const url = new URL(config.handshake_url);
    return url.origin;
  } catch (e) {
    return config.handshake_url.replace(/\/+$/, '');
  }
}

$('#hs-back').addEventListener('click', () => navigateTo('dashboard'));

$('#hs-open-full').addEventListener('click', () => {
  launchExternal('handshake', config.handshake_url, 'Handshake');
});

$$('.hs-tile').forEach(tile => {
  tile.addEventListener('click', () => {
    const path = tile.dataset.hsPath;
    const base = getHandshakeBase();
    const label = tile.querySelector('span').textContent;
    launchExternal('handshake', base + path, label);
  });
});

// ─── Multimango Hub ─────────────────────────────────────
$('#mm-back').addEventListener('click', () => navigateTo('dashboard'));

$('#mm-open-full').addEventListener('click', () => {
  launchExternal('multimango', config.multimango_url, 'Multimango');
});

// ─── Timer Status ────────────────────────────────────────
async function updateTimerStatus() {
  const section = $('#timer-section');
  const placeholder = $('#timer-placeholder');
  const live = $('#timer-live');

  if (!config.timer_api_url) {
    section.style.display = '';
    placeholder.style.display = '';
    live.classList.add('hidden');
    clearInterval(timerPollInterval);
    return;
  }

  try {
    const status = await api('/timer-status');
    if (status.enabled && status.data) {
      placeholder.style.display = 'none';
      live.classList.remove('hidden');
      const d = status.data;
      $('#timer-value').textContent = d.time || d.elapsed || d.duration || JSON.stringify(d);
      clearInterval(timerPollInterval);
      timerPollInterval = setInterval(updateTimerStatus, 30000);
    } else {
      placeholder.querySelector('span').textContent = 'Timer API configured but not responding';
      placeholder.style.display = '';
      live.classList.add('hidden');
    }
  } catch (e) {
    placeholder.querySelector('span').textContent = 'Timer syncs with Handshake when available';
    placeholder.style.display = '';
    live.classList.add('hidden');
  }
}

// ─── Settings ────────────────────────────────────────────
async function loadSettings() {
  try {
    const cfg = await api('/config');
    $('#setting-handshake').value = cfg.handshake_url || '';
    $('#setting-multimango').value = cfg.multimango_url || '';
    $('#setting-timer').value = cfg.timer_api_url || '';
  } catch (e) { /* silent */ }
}

$('#save-settings').addEventListener('click', async () => {
  const settings = {
    handshake_url: $('#setting-handshake').value.trim(),
    multimango_url: $('#setting-multimango').value.trim(),
    timer_api_url: $('#setting-timer').value.trim(),
  };

  try {
    await api('/settings', { method: 'PUT', body: settings });
    toast('Settings saved', 'success');
    await loadConfig();
  } catch (e) {
    toast('Failed to save: ' + e.message, 'error');
  }
});

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

$$('[data-winner]').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('[data-winner]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    h2hState.winner = chip.dataset.winner;
    renderH2HPreview();
  });
});

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

$$('[data-verdict]').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('[data-verdict]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    graphState.verdict = chip.dataset.verdict;
    renderGraphPreview();
  });
});

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

// ─── Handshake Fix Bookmarklet ───────────────────────────
const HS_CSS = `
  .main-content, .main-container, [class*="Container"], [class*="container"] {
    max-width: 100% !important; width: 100% !important;
    padding-left: 12px !important; padding-right: 12px !important;
    overflow-x: hidden !important;
  }
  [class*="sidebar"], [class*="Sidebar"], [class*="side-nav"], nav[class*="navigation"] {
    position: static !important; width: 100% !important;
    max-height: none !important; overflow: visible !important;
  }
  [class*="grid"], [class*="Grid"] {
    grid-template-columns: 1fr !important;
  }
  [class*="card"], [class*="Card"], [class*="posting"], [class*="Posting"] {
    width: 100% !important; max-width: 100% !important;
    margin-left: 0 !important; margin-right: 0 !important;
  }
  table { display: block !important; overflow-x: auto !important; width: 100% !important; }
  img, svg, video { max-width: 100% !important; height: auto !important; }
  button, [role="button"], a[class*="btn"], a[class*="Btn"] {
    min-height: 44px !important; min-width: 44px !important;
    font-size: 16px !important;
  }
  input, select, textarea {
    font-size: 16px !important; max-width: 100% !important;
    min-height: 44px !important;
  }
  body { overflow-x: hidden !important; -webkit-text-size-adjust: 100% !important; }
  * { max-width: 100vw !important; }
  h1, h2, h3 { word-break: break-word !important; }
  p, li, span, div { word-wrap: break-word !important; overflow-wrap: break-word !important; }
`.replace(/\n\s*/g, ' ').trim();

const hsBookmarkletCode = `javascript:void((function(){var s=document.createElement('style');s.textContent='${HS_CSS.replace(/'/g, "\\'")}';document.head.appendChild(s);document.querySelector('meta[name=viewport]')||document.head.insertAdjacentHTML('beforeend','<meta name=viewport content="width=device-width,initial-scale=1">');})())`;

$('#hs-bookmarklet').href = hsBookmarkletCode;
$('#hs-bookmarklet-code').textContent = hsBookmarkletCode;

$('#copy-hs-bookmarklet').addEventListener('click', () => {
  navigator.clipboard.writeText(hsBookmarkletCode).then(
    () => toast('Handshake Fix code copied!', 'success'),
    () => toast('Copy failed — long press to select the code above', 'error')
  );
});

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

const bookmarkletCode = `javascript:void((function(){var s=document.createElement('style');s.textContent='${MANGO_CSS.replace(/'/g, "\\'")}';document.head.appendChild(s);document.querySelector('meta[name=viewport]')||document.head.insertAdjacentHTML('beforeend','<meta name=viewport content="width=device-width,initial-scale=1">');})())`;

$('#mango-bookmarklet').href = bookmarkletCode;
$('#bookmarklet-code').textContent = bookmarkletCode;

$('#copy-bookmarklet').addEventListener('click', () => {
  navigator.clipboard.writeText(bookmarkletCode).then(
    () => toast('Bookmarklet code copied!', 'success'),
    () => toast('Copy failed — long press to select the code above', 'error')
  );
});

// ─── Init ────────────────────────────────────────────────
loadConfig();
loadSettings();

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
