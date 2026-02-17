// ─── State ───────────────────────────────────────────────
let currentProjectId = null;
let currentProject = null;
let currentTaskId = null;
let activeTimerInterval = null;
let editingEntryId = null;
let hourlyReminderInterval = null;

// ─── Native Desktop Notifications ───────────────────────
function sendDesktopNotification(title, body) {
  if (window.electronAPI && window.electronAPI.sendNotification) {
    window.electronAPI.sendNotification(title, body);
  }
}

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

function formatDateTime(dtStr) {
  if (!dtStr) return '—';
  const d = new Date(dtStr + 'Z');
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Toast Notifications ─────────────────────────────────
function showToast(message, type = 'error') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Wrap api calls with error handling
async function safeApi(path, opts) {
  try {
    return await api(path, opts);
  } catch (err) {
    showToast(err.message);
    throw err;
  }
}

// ─── Views / Tabs ────────────────────────────────────────
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.view').forEach(v => v.classList.add('hidden'));
    $(`#view-${tab.dataset.view}`).classList.remove('hidden');
    if (tab.dataset.view === 'reports') initReportDates();
    if (tab.dataset.view === 'dashboard') {
      // Reset to projects view when switching back to dashboard
      showProjectsView();
    }
  });
});

// ─── Dashboard Navigation ────────────────────────────────
function showProjectsView() {
  currentProjectId = null;
  currentProject = null;
  currentTaskId = null;
  $('#projects-section').classList.remove('hidden');
  $('#task-panel').classList.add('hidden');
  $('#entries-panel').classList.add('hidden');
}

function showTasksView(project) {
  currentProjectId = project.id;
  currentProject = project;
  currentTaskId = null;
  $('#projects-section').classList.add('hidden');
  $('#task-panel').classList.remove('hidden');
  $('#entries-panel').classList.add('hidden');
  $('#task-panel-title').textContent = project.name;
  $('#task-panel-title').style.color = project.color;
  loadTasks(project.id);
}

function showEntriesView(task) {
  currentTaskId = task.id;
  $('#projects-section').classList.add('hidden');
  $('#task-panel').classList.add('hidden');
  $('#entries-panel').classList.remove('hidden');
  $('#entries-panel-title').textContent = `Entries: ${task.name}`;
  loadEntries(task.id);
}

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

  // Hourly reminder notification
  clearInterval(hourlyReminderInterval);
  hourlyReminderInterval = setInterval(() => {
    const elapsedSecs = (Date.now() - startMs) / 1000;
    const hours = Math.floor(elapsedSecs / 3600);
    sendDesktopNotification(
      'Timer Still Running',
      `"${entry.task_name}" on ${entry.project_name} — ${formatDuration(elapsedSecs)} elapsed`
    );
  }, 60 * 60 * 1000); // every hour
}

function stopActiveTimerTick() {
  clearInterval(activeTimerInterval);
  clearInterval(hourlyReminderInterval);
  $('#active-timer-bar').classList.add('hidden');
}

async function refreshActiveTimer() {
  try {
    const entry = await api('/active');
    if (entry) {
      startActiveTimerTick(entry);
    } else {
      stopActiveTimerTick();
    }
  } catch (e) {
    // silently fail - timer refresh is non-critical
  }
}

$('#stop-active-btn').addEventListener('click', async () => {
  try {
    const entry = await api('/active');
    if (entry) {
      const startMs = new Date(entry.start_time + 'Z').getTime();
      const elapsed = (Date.now() - startMs) / 1000;
      await safeApi(`/tasks/${entry.task_id}/stop`, { method: 'POST' });
      sendDesktopNotification('Timer Stopped', `"${entry.task_name}" on ${entry.project_name} — ${formatDuration(elapsed)} logged`);
      stopActiveTimerTick();
      if (currentProjectId) loadTasks(currentProjectId);
      loadProjects();
    }
  } catch (e) { /* already shown via toast */ }
});

// ─── Projects ────────────────────────────────────────────
async function loadProjects() {
  try {
    const projects = await api('/projects');
    const grid = $('#project-list');
    grid.innerHTML = projects.length === 0
      ? '<div class="empty-state"><p>No projects yet.</p><p class="dim">Create a project to start tracking time.</p></div>'
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
        showTasksView(p);
      });
      card.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openProjectModal(p);
      });
      card.querySelector('.del-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete project "${p.name}" and all its tasks?`)) {
          try {
            await safeApi(`/projects/${p.id}`, { method: 'DELETE' });
            refreshActiveTimer();
            loadProjects();
          } catch (e) { /* toast shown */ }
        }
      });
      card.addEventListener('click', () => showTasksView(p));
      grid.appendChild(card);
    }
  } catch (e) {
    showToast('Failed to load projects');
  }
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
  setTimeout(() => $('#pf-name').focus(), 50);
}

function closeProjectModal() {
  $('#modal-overlay').classList.add('hidden');
}

$('#modal-cancel').addEventListener('click', closeProjectModal);

$('#modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('#modal-overlay')) closeProjectModal();
});

$('#project-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: $('#pf-name').value.trim(),
    rate: parseFloat($('#pf-rate').value) || 0,
    color: $('#pf-color').value,
  };
  try {
    if (editingProjectId) {
      await safeApi(`/projects/${editingProjectId}`, { method: 'PUT', body });
    } else {
      await safeApi('/projects', { method: 'POST', body });
    }
    closeProjectModal();
    loadProjects();
  } catch (e) { /* toast shown */ }
});

// ─── Tasks ───────────────────────────────────────────────
$('#back-to-projects').addEventListener('click', () => {
  showProjectsView();
  loadProjects();
});

$('#add-task-btn').addEventListener('click', addTask);
$('#new-task-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTask();
});

async function addTask() {
  const input = $('#new-task-input');
  const name = input.value.trim();
  if (!name || !currentProjectId) return;
  try {
    await safeApi(`/projects/${currentProjectId}/tasks`, { method: 'POST', body: { name } });
    input.value = '';
    loadTasks(currentProjectId);
  } catch (e) { /* toast shown */ }
}

let manualEntryTaskId = null;

async function loadTasks(projectId) {
  try {
    const tasks = await api(`/projects/${projectId}/tasks`);
    const list = $('#task-list');
    list.innerHTML = '';

    if (tasks.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No tasks yet.</p><p class="dim">Add a task above to start tracking time.</p></div>';
      return;
    }

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
          <button class="btn btn-ghost btn-sm entries-btn" title="View time entries">Entries</button>
          <button class="btn btn-ghost btn-sm manual-btn" title="Add manual entry">+</button>
          <button class="btn btn-danger btn-sm del-btn" title="Delete task">&times;</button>
        </div>
      `;

      card.querySelector('.task-check').addEventListener('click', async () => {
        try {
          await safeApi(`/tasks/${t.id}`, { method: 'PUT', body: { completed: t.completed ? 0 : 1 } });
          loadTasks(projectId);
        } catch (e) { /* toast shown */ }
      });

      const startBtn = card.querySelector('.start-btn');
      if (startBtn) {
        startBtn.addEventListener('click', async () => {
          try {
            await safeApi(`/tasks/${t.id}/start`, { method: 'POST' });
            sendDesktopNotification('Timer Started', `Tracking time for "${t.name}"`);
            loadTasks(projectId);
            refreshActiveTimer();
          } catch (e) { /* toast shown */ }
        });
      }

      const stopBtn = card.querySelector('.stop-btn');
      if (stopBtn) {
        stopBtn.addEventListener('click', async () => {
          try {
            await safeApi(`/tasks/${t.id}/stop`, { method: 'POST' });
            const elapsed = formatDuration(t.total_seconds);
            sendDesktopNotification('Timer Stopped', `"${t.name}" — ${elapsed} total logged`);
            loadTasks(projectId);
            refreshActiveTimer();
            loadProjects();
          } catch (e) { /* toast shown */ }
        });
      }

      card.querySelector('.entries-btn').addEventListener('click', () => {
        showEntriesView(t);
      });

      card.querySelector('.manual-btn').addEventListener('click', () => {
        openManualEntryModal(t.id);
      });

      card.querySelector('.del-btn').addEventListener('click', async () => {
        if (confirm(`Delete task "${t.name}"?`)) {
          try {
            await safeApi(`/tasks/${t.id}`, { method: 'DELETE' });
            loadTasks(projectId);
            refreshActiveTimer();
            loadProjects();
          } catch (e) { /* toast shown */ }
        }
      });

      list.appendChild(card);
    }
  } catch (e) {
    showToast('Failed to load tasks');
  }
}

// ─── Time Entries Panel ──────────────────────────────────
$('#back-to-tasks').addEventListener('click', () => {
  if (currentProject) {
    showTasksView(currentProject);
  } else {
    showProjectsView();
  }
});

async function loadEntries(taskId) {
  try {
    const entries = await api(`/tasks/${taskId}/entries`);
    const list = $('#entries-list');
    list.innerHTML = '';

    if (entries.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No time entries yet.</p><p class="dim">Start a timer or add a manual entry.</p></div>';
      return;
    }

    for (const e of entries) {
      const card = document.createElement('div');
      const isRunning = !e.end_time;
      card.className = 'entry-card' + (isRunning ? ' running' : '');

      const duration = e.duration_seconds
        ? formatDuration(e.duration_seconds)
        : 'Running...';

      card.innerHTML = `
        <div class="entry-times">
          <div class="entry-range">${formatDateTime(e.start_time)} &rarr; ${isRunning ? 'now' : formatDateTime(e.end_time)}</div>
          <div class="entry-duration">${duration}</div>
        </div>
        ${e.notes ? `<div class="entry-notes">${esc(e.notes)}</div>` : ''}
        <div class="entry-actions">
          ${!isRunning ? `<button class="btn btn-ghost btn-sm edit-entry-btn" title="Edit entry">Edit</button>` : ''}
          <button class="btn btn-danger btn-sm del-entry-btn" title="Delete entry">&times;</button>
        </div>
      `;

      const editBtn = card.querySelector('.edit-entry-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          openEditEntryModal(e);
        });
      }

      card.querySelector('.del-entry-btn').addEventListener('click', async () => {
        if (confirm('Delete this time entry?')) {
          try {
            await safeApi(`/entries/${e.id}`, { method: 'DELETE' });
            loadEntries(taskId);
            refreshActiveTimer();
            loadProjects();
          } catch (err) { /* toast shown */ }
        }
      });

      list.appendChild(card);
    }
  } catch (e) {
    showToast('Failed to load entries');
  }
}

// ─── Manual Entry Modal ──────────────────────────────────
function openManualEntryModal(taskId) {
  manualEntryTaskId = taskId;
  editingEntryId = null;
  $('#manual-modal-title').textContent = 'Add Manual Time Entry';
  $('#manual-save-btn').textContent = 'Save Entry';
  $('#me-start').value = '';
  $('#me-end').value = '';
  $('#me-notes').value = '';
  $('#manual-modal-overlay').classList.remove('hidden');
  setTimeout(() => $('#me-start').focus(), 50);
}

function openEditEntryModal(entry) {
  editingEntryId = entry.id;
  manualEntryTaskId = entry.task_id;
  $('#manual-modal-title').textContent = 'Edit Time Entry';
  $('#manual-save-btn').textContent = 'Update Entry';

  // Convert UTC time strings to local datetime-local format
  const startLocal = utcToLocalDatetimeInput(entry.start_time);
  const endLocal = utcToLocalDatetimeInput(entry.end_time);
  $('#me-start').value = startLocal;
  $('#me-end').value = endLocal;
  $('#me-notes').value = entry.notes || '';
  $('#manual-modal-overlay').classList.remove('hidden');
  setTimeout(() => $('#me-start').focus(), 50);
}

function utcToLocalDatetimeInput(utcStr) {
  if (!utcStr) return '';
  const d = new Date(utcStr + 'Z');
  // Format as YYYY-MM-DDTHH:MM for datetime-local input
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function closeManualModal() {
  $('#manual-modal-overlay').classList.add('hidden');
  editingEntryId = null;
}

$('#manual-cancel').addEventListener('click', closeManualModal);

$('#manual-modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('#manual-modal-overlay')) closeManualModal();
});

$('#manual-entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const start = new Date($('#me-start').value);
  const end = new Date($('#me-end').value);
  if (isNaN(start) || isNaN(end) || end <= start) {
    showToast('Invalid date range. End must be after start.');
    return;
  }

  const body = {
    start_time: start.toISOString().replace('T', ' ').slice(0, 19),
    end_time: end.toISOString().replace('T', ' ').slice(0, 19),
    notes: $('#me-notes').value.trim(),
  };

  try {
    if (editingEntryId) {
      await safeApi(`/entries/${editingEntryId}`, { method: 'PUT', body });
    } else {
      if (!manualEntryTaskId) return;
      await safeApi(`/tasks/${manualEntryTaskId}/entries`, { method: 'POST', body });
    }
    closeManualModal();
    if (currentTaskId) loadEntries(currentTaskId);
    if (currentProjectId) loadTasks(currentProjectId);
    loadProjects();
  } catch (err) { /* toast shown */ }
});

// ─── Global Keyboard Shortcuts ───────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Close any open modal
    if (!$('#modal-overlay').classList.contains('hidden')) {
      closeProjectModal();
    }
    if (!$('#manual-modal-overlay').classList.contains('hidden')) {
      closeManualModal();
    }
  }
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
  if (!from || !to) {
    showToast('Please select a date range');
    return;
  }

  try {
    const [entries, summary] = await Promise.all([
      safeApi(`/reports?from=${from}&to=${to}`),
      safeApi(`/reports/summary?from=${from}&to=${to}`),
    ]);

    const summaryEl = $('#report-summary');
    const emptyEl = $('#report-empty');
    const tableEl = $('#report-table');

    if (entries.length === 0) {
      summaryEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      tableEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    tableEl.classList.remove('hidden');

    // Summary cards
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
        <td>${formatDateTime(r.start_time)}</td>
        <td>${formatDateTime(r.end_time)}</td>
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
  } catch (e) { /* toast shown */ }
}

$('#export-csv-btn').addEventListener('click', () => {
  const from = $('#report-from').value;
  const to = $('#report-to').value;
  if (!from || !to) {
    showToast('Please select a date range first');
    return;
  }
  window.open(`/api/reports/csv?from=${from}&to=${to}`, '_blank');
});

// ─── Init ────────────────────────────────────────────────
loadProjects();
refreshActiveTimer();
