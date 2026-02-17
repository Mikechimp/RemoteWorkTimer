// ─── State ───────────────────────────────────────────────
let currentProjectId = null;
let activeTimerInterval = null;

// ─── Helpers ─────────────────────────────────────────────
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
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatHours(seconds) {
  return (seconds / 3600).toFixed(2);
}

function formatMoney(amount) {
  return '$' + Number(amount).toFixed(2);
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

// ─── Views / Tabs ────────────────────────────────────────
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.view').forEach(v => v.classList.add('hidden'));
    $(`#view-${tab.dataset.view}`).classList.remove('hidden');
    if (tab.dataset.view === 'reports') initReportDates();
  });
});

// ─── Active Timer Ticker ─────────────────────────────────
function startActiveTimerTick(entry) {
  const bar = $('#active-timer-bar');
  const elapsedEl = $('#active-elapsed');
  const projectEl = $('#active-project-name');
  const taskEl = $('#active-task-name');

  bar.classList.remove('hidden');
  projectEl.textContent = entry.project_name;
  taskEl.textContent = entry.task_name;

  const startMs = new Date(entry.start_time + 'Z').getTime();
  clearInterval(activeTimerInterval);
  activeTimerInterval = setInterval(() => {
    const elapsed = (Date.now() - startMs) / 1000;
    elapsedEl.textContent = formatDuration(elapsed);
  }, 1000);
  // fire immediately
  const elapsed = (Date.now() - startMs) / 1000;
  elapsedEl.textContent = formatDuration(elapsed);
}

function stopActiveTimerTick() {
  clearInterval(activeTimerInterval);
  $('#active-timer-bar').classList.add('hidden');
}

async function refreshActiveTimer() {
  const entry = await api('/active');
  if (entry) {
    startActiveTimerTick(entry);
  } else {
    stopActiveTimerTick();
  }
}

$('#stop-active-btn').addEventListener('click', async () => {
  const entry = await api('/active');
  if (entry) {
    await api(`/tasks/${entry.task_id}/stop`, { method: 'POST' });
    stopActiveTimerTick();
    if (currentProjectId) loadTasks(currentProjectId);
    loadProjects();
  }
});

// ─── Projects ────────────────────────────────────────────
async function loadProjects() {
  const projects = await api('/projects');
  const grid = $('#project-list');
  grid.innerHTML = projects.length === 0
    ? '<p style="color:var(--text-dim)">No projects yet. Create one to get started.</p>'
    : '';

  for (const p of projects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.style.setProperty('--card-color', p.color);
    card.innerHTML = `
      <h3>${esc(p.name)}</h3>
      <div class="project-meta">
        <span>${p.task_count} task${p.task_count !== 1 ? 's' : ''}</span>
        <span>${formatHours(p.total_seconds)}h logged</span>
        ${p.rate > 0 ? `<span>${formatMoney(p.rate)}/hr</span>` : ''}
      </div>
      <div class="project-actions">
        <button class="btn btn-primary btn-sm open-btn">Open</button>
        <button class="btn btn-ghost btn-sm edit-btn">Edit</button>
        <button class="btn btn-danger btn-sm del-btn">Delete</button>
      </div>
    `;
    card.querySelector('.open-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openProject(p);
    });
    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openProjectModal(p);
    });
    card.querySelector('.del-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete project "${p.name}" and all its tasks?`)) {
        await api(`/projects/${p.id}`, { method: 'DELETE' });
        loadProjects();
      }
    });
    card.addEventListener('click', () => openProject(p));
    grid.appendChild(card);
  }
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Project Modal ───────────────────────────────────────
let editingProjectId = null;

$('#add-project-btn').addEventListener('click', () => openProjectModal());

function openProjectModal(project) {
  editingProjectId = project ? project.id : null;
  $('#modal-title').textContent = project ? 'Edit Project' : 'New Project';
  $('#pf-name').value = project ? project.name : '';
  $('#pf-rate').value = project ? project.rate : 0;
  $('#pf-color').value = project ? project.color : '#4f46e5';
  $('#modal-overlay').classList.remove('hidden');
  $('#pf-name').focus();
}

$('#modal-cancel').addEventListener('click', () => {
  $('#modal-overlay').classList.add('hidden');
});

$('#project-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: $('#pf-name').value.trim(),
    rate: parseFloat($('#pf-rate').value) || 0,
    color: $('#pf-color').value,
  };
  if (editingProjectId) {
    await api(`/projects/${editingProjectId}`, { method: 'PUT', body });
  } else {
    await api('/projects', { method: 'POST', body });
  }
  $('#modal-overlay').classList.add('hidden');
  loadProjects();
});

// ─── Tasks ───────────────────────────────────────────────
function openProject(project) {
  currentProjectId = project.id;
  $('#task-panel-title').textContent = project.name;
  $('#task-panel-title').style.color = project.color;
  $('#task-panel').classList.remove('hidden');
  loadTasks(project.id);
}

$('#back-to-projects').addEventListener('click', () => {
  currentProjectId = null;
  $('#task-panel').classList.add('hidden');
});

$('#add-task-btn').addEventListener('click', addTask);
$('#new-task-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTask();
});

async function addTask() {
  const input = $('#new-task-input');
  const name = input.value.trim();
  if (!name || !currentProjectId) return;
  await api(`/projects/${currentProjectId}/tasks`, { method: 'POST', body: { name } });
  input.value = '';
  loadTasks(currentProjectId);
}

let manualEntryTaskId = null;

async function loadTasks(projectId) {
  const tasks = await api(`/projects/${projectId}/tasks`);
  const list = $('#task-list');
  list.innerHTML = '';

  for (const t of tasks) {
    const card = document.createElement('div');
    card.className = 'task-card' + (t.completed ? ' completed' : '');
    const isRunning = !!t.running_entry_id;

    card.innerHTML = `
      <button class="task-check ${t.completed ? 'done' : ''}">${t.completed ? '&#10003;' : ''}</button>
      <div class="task-info">
        <div class="task-name">${esc(t.name)}</div>
        <div class="task-time">${formatDuration(t.total_seconds)} logged</div>
      </div>
      <div class="task-actions">
        ${!t.completed ? (isRunning
          ? `<button class="btn btn-danger btn-sm stop-btn">Stop</button>`
          : `<button class="btn btn-success btn-sm start-btn">Start</button>`
        ) : ''}
        <button class="btn btn-ghost btn-sm manual-btn" title="Add manual entry">+</button>
        <button class="btn btn-danger btn-sm del-btn" title="Delete task">&times;</button>
      </div>
    `;

    card.querySelector('.task-check').addEventListener('click', async () => {
      await api(`/tasks/${t.id}`, { method: 'PUT', body: { completed: t.completed ? 0 : 1 } });
      loadTasks(projectId);
    });

    const startBtn = card.querySelector('.start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        // Stop any other running timer first
        const active = await api('/active');
        if (active) await api(`/tasks/${active.task_id}/stop`, { method: 'POST' });
        await api(`/tasks/${t.id}/start`, { method: 'POST' });
        loadTasks(projectId);
        refreshActiveTimer();
      });
    }

    const stopBtn = card.querySelector('.stop-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        await api(`/tasks/${t.id}/stop`, { method: 'POST' });
        loadTasks(projectId);
        refreshActiveTimer();
        loadProjects();
      });
    }

    card.querySelector('.manual-btn').addEventListener('click', () => {
      manualEntryTaskId = t.id;
      $('#me-start').value = '';
      $('#me-end').value = '';
      $('#me-notes').value = '';
      $('#manual-modal-overlay').classList.remove('hidden');
    });

    card.querySelector('.del-btn').addEventListener('click', async () => {
      if (confirm(`Delete task "${t.name}"?`)) {
        await api(`/tasks/${t.id}`, { method: 'DELETE' });
        loadTasks(projectId);
        refreshActiveTimer();
        loadProjects();
      }
    });

    list.appendChild(card);
  }
}

// ─── Manual Entry Modal ──────────────────────────────────
$('#manual-cancel').addEventListener('click', () => {
  $('#manual-modal-overlay').classList.add('hidden');
});

$('#manual-entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!manualEntryTaskId) return;
  const start = new Date($('#me-start').value);
  const end = new Date($('#me-end').value);
  if (isNaN(start) || isNaN(end) || end <= start) {
    alert('Invalid date range');
    return;
  }
  await api(`/tasks/${manualEntryTaskId}/entries`, {
    method: 'POST',
    body: {
      start_time: start.toISOString().replace('T', ' ').slice(0, 19),
      end_time: end.toISOString().replace('T', ' ').slice(0, 19),
      notes: $('#me-notes').value.trim(),
    }
  });
  $('#manual-modal-overlay').classList.add('hidden');
  if (currentProjectId) loadTasks(currentProjectId);
  loadProjects();
});

// ─── Reports ─────────────────────────────────────────────
function initReportDates() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  $('#report-from').value = monday.toISOString().split('T')[0];
  $('#report-to').value = today.toISOString().split('T')[0];
}

$('#run-report-btn').addEventListener('click', generateReport);

async function generateReport() {
  const from = $('#report-from').value;
  const to = $('#report-to').value;
  if (!from || !to) return;

  const [entries, summary] = await Promise.all([
    api(`/reports?from=${from}&to=${to}`),
    api(`/reports/summary?from=${from}&to=${to}`),
  ]);

  // Summary cards
  const summaryEl = $('#report-summary');
  let totalHours = 0;
  let totalEarnings = 0;
  summaryEl.innerHTML = '';

  for (const s of summary) {
    const hours = s.total_seconds / 3600;
    const earnings = hours * s.rate;
    totalHours += hours;
    totalEarnings += earnings;

    summaryEl.innerHTML += `
      <div class="summary-card" style="--card-color:${s.color}">
        <div class="label">${esc(s.project_name)}</div>
        <div class="value">${hours.toFixed(2)}h</div>
        <div class="sub">${s.entry_count} entries${s.rate > 0 ? ' &middot; ' + formatMoney(earnings) : ''}</div>
      </div>
    `;
  }

  // Totals card
  summaryEl.innerHTML += `
    <div class="summary-card" style="--card-color:var(--success)">
      <div class="label">Total</div>
      <div class="value">${totalHours.toFixed(2)}h</div>
      <div class="sub">${formatMoney(totalEarnings)} earned</div>
    </div>
  `;

  // Detailed table
  const body = $('#report-body');
  body.innerHTML = '';
  let tHours = 0, tEarnings = 0;

  for (const r of entries) {
    const hours = r.duration_seconds / 3600;
    const earnings = hours * r.rate;
    tHours += hours;
    tEarnings += earnings;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span style="color:${r.color}">&bull;</span> ${esc(r.project_name)}</td>
      <td>${esc(r.task_name)}</td>
      <td>${r.start_time}</td>
      <td>${r.end_time}</td>
      <td>${hours.toFixed(2)}</td>
      <td>${formatMoney(earnings)}</td>
      <td>${esc(r.notes || '')}</td>
    `;
    body.appendChild(row);
  }

  $('#report-foot').innerHTML = `
    <tr>
      <td colspan="4">Total</td>
      <td>${tHours.toFixed(2)}</td>
      <td>${formatMoney(tEarnings)}</td>
      <td></td>
    </tr>
  `;
}

$('#export-csv-btn').addEventListener('click', () => {
  const from = $('#report-from').value;
  const to = $('#report-to').value;
  if (!from || !to) return;
  window.open(`/api/reports/csv?from=${from}&to=${to}`, '_blank');
});

// ─── Init ────────────────────────────────────────────────
loadProjects();
refreshActiveTimer();
