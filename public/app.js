/**
 * app.js — Frontend logic for the Remote Work Timer.
 *
 * This file handles all client-side behavior: navigation between views,
 * API communication, project/task/entry CRUD, live timer ticking, report
 * generation, and modal dialogs.
 *
 * EDITABLE PARAMETERS (search for these to find where to change them):
 *  - API base path: currently '/api' — change in the api() function.
 *  - Toast duration: currently 3500ms — change in showToast().
 *  - Timer tick interval: currently 1000ms (1 second) — change in startActiveTimerTick().
 *  - Default report date range: currently "this week" — change in initReportDates().
 *  - Date/time display format: change the toLocaleString options in formatDateTime().
 *  - Money format: change the prefix '$' in formatMoney().
 */

// ─── State ───────────────────────────────────────────────

/** Currently selected project ID (null when on the projects dashboard). */
let currentProjectId = null;

/** Full project object for the currently selected project (used for back navigation). */
let currentProject = null;

/** Currently selected task ID (null when not viewing a task's entries). */
let currentTaskId = null;

/** Interval ID for the live timer ticker (cleared when timer stops). */
let activeTimerInterval = null;

/** ID of the time entry currently being edited in the manual entry modal (null = creating new). */
let editingEntryId = null;

// ─── Helpers ─────────────────────────────────────────────

/**
 * Make a JSON API request to the backend.
 *
 * @param {string} path — API path appended to '/api', e.g. '/projects' becomes '/api/projects'.
 *   Change the '/api' prefix here if you rename the API route base in server.js.
 * @param {object} opts — fetch options. The 'body' property is auto-stringified to JSON.
 *   @param {string}  opts.method — HTTP method ('GET', 'POST', 'PUT', 'DELETE')
 *   @param {object}  opts.body   — request payload (will be JSON.stringify'd)
 * @returns {Promise<object|string>} Parsed JSON response, or text if not JSON.
 * @throws {Error} With the server's error message if the response is not ok.
 */
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

/**
 * Format a duration in seconds as "HH:MM:SS".
 *
 * @param {number} seconds — total elapsed seconds to format
 * @returns {string} Formatted string like "02:15:30"
 *
 * Change padStart(2, '0') to padStart(1, '0') if you don't want leading zeros.
 */
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Format seconds as decimal hours (e.g. 9000 → "2.50").
 *
 * @param {number} seconds — total seconds
 * @returns {string} Decimal hours with 2 decimal places.
 *
 * Change .toFixed(2) to .toFixed(1) for fewer decimal places.
 */
function formatHours(seconds) {
  return (seconds / 3600).toFixed(2);
}

/**
 * Format a numeric amount as a dollar string (e.g. 42.5 → "$42.50").
 *
 * @param {number} amount — dollar amount
 * @returns {string} Formatted money string.
 *
 * Change the '$' prefix to any currency symbol you need (e.g. '€', '£').
 */
function formatMoney(amount) {
  return '$' + Number(amount).toFixed(2);
}

/**
 * Format a UTC datetime string for display to the user.
 *
 * @param {string} dtStr — UTC datetime string from the database (e.g. '2025-01-15 14:30:00').
 *   The 'Z' suffix is appended to treat it as UTC before converting to local time.
 * @returns {string} Localized date/time string, or '—' if input is falsy.
 *
 * Change the toLocaleString options to control the display format:
 *  - month: 'short'|'long'|'numeric' — how the month appears
 *  - day: 'numeric'|'2-digit' — how the day appears
 *  - hour/minute: '2-digit'|'numeric' — 12h vs 24h depends on user's locale
 *  - Add year: 'numeric' to include the year
 */
function formatDateTime(dtStr) {
  if (!dtStr) return '—';
  const d = new Date(dtStr + 'Z');
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Shorthand for document.querySelector.
 * @param {string} sel — CSS selector
 * @returns {Element|null}
 */
function $(sel) { return document.querySelector(sel); }

/**
 * Shorthand for document.querySelectorAll.
 * @param {string} sel — CSS selector
 * @returns {NodeList}
 */
function $$(sel) { return document.querySelectorAll(sel); }

/**
 * HTML-escape a string to prevent XSS when inserting user content into innerHTML.
 *
 * @param {string} str — raw string to escape
 * @returns {string} HTML-safe string with <, >, &, " escaped
 */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Toast Notifications ─────────────────────────────────

/**
 * Show a temporary toast notification at the top-right of the screen.
 *
 * @param {string} message — text to display
 * @param {string} type    — 'error' (red, default), 'success' (green), or 'info' (blue).
 *   The CSS class `toast-${type}` is applied for styling.
 *
 * EDITABLE PARAMETERS:
 *  - 3500: how long the toast stays visible (ms) before fading out.
 *  - 300: fade-out animation duration (ms) before the element is removed.
 */
function showToast(message, type = 'error') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  // Trigger slide-in animation on next frame
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/**
 * Wrapper around api() that catches errors and shows them as toast notifications.
 * Use this for all user-facing API calls so errors are always visible.
 *
 * @param {string} path — API path (same as api())
 * @param {object} opts — fetch options (same as api())
 * @returns {Promise<object|string>} API response
 * @throws {Error} Re-throws after showing the toast, so callers can also catch if needed.
 */
async function safeApi(path, opts) {
  try {
    return await api(path, opts);
  } catch (err) {
    showToast(err.message);
    throw err;
  }
}

// ─── Views / Tabs ────────────────────────────────────────

/**
 * Tab switching: clicking a tab shows the corresponding view and hides the others.
 * Each tab has a data-view attribute ('dashboard' or 'reports') that maps to a
 * #view-{name} element. When switching to 'reports', initReportDates() is called.
 * When switching to 'dashboard', the view resets to the projects list.
 */
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(el => el.classList.remove('active'));
    tab.classList.add('active');
    $$('.view').forEach(el => el.classList.add('hidden'));
    $(`#view-${tab.dataset.view}`).classList.remove('hidden');
    if (tab.dataset.view === 'reports') initReportDates();
    if (tab.dataset.view === 'dashboard') {
      // Reset to projects view when switching back to dashboard
      showProjectsView();
    }
  });
});

// ─── Dashboard Navigation ────────────────────────────────

/**
 * Navigate back to the projects grid (top-level dashboard view).
 * Resets all navigation state and hides task/entry panels.
 */
function showProjectsView() {
  currentProjectId = null;
  currentProject = null;
  currentTaskId = null;
  $('#projects-section').classList.remove('hidden');
  $('#task-panel').classList.add('hidden');
  $('#entries-panel').classList.add('hidden');
}

/**
 * Navigate into a project to view its tasks.
 *
 * @param {object} project — the full project object from the API, containing:
 *   @param {number} project.id    — project ID (used to load tasks)
 *   @param {string} project.name  — displayed as the panel title
 *   @param {string} project.color — applied as the title text color
 */
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

/**
 * Navigate into a task to view its time entries.
 *
 * @param {object} task — the full task object from the API, containing:
 *   @param {number} task.id   — task ID (used to load entries)
 *   @param {string} task.name — displayed in the panel title as "Entries: {name}"
 */
function showEntriesView(task) {
  currentTaskId = task.id;
  $('#projects-section').classList.add('hidden');
  $('#task-panel').classList.add('hidden');
  $('#entries-panel').classList.remove('hidden');
  $('#entries-panel-title').textContent = `Entries: ${task.name}`;
  loadEntries(task.id);
}

// ─── Active Timer Ticker ─────────────────────────────────

/**
 * Start the live-ticking timer display in the top bar.
 * Updates every second to show elapsed time since the entry started.
 *
 * @param {object} entry — active time entry from GET /api/active, containing:
 *   @param {string} entry.start_time    — UTC start timestamp (e.g. '2025-01-15 14:30:00')
 *   @param {string} entry.project_name  — project name displayed in the bar
 *   @param {string} entry.task_name     — task name displayed in the bar
 *
 * EDITABLE PARAMETERS:
 *  - 1000: interval in ms between ticker updates. Lower = smoother but more CPU.
 */
function startActiveTimerTick(entry) {
  const bar = $('#active-timer-bar');
  const elapsedEl = $('#active-elapsed');
  const projectEl = $('#active-project-name');
  const taskEl = $('#active-task-name');

  bar.classList.remove('hidden');
  projectEl.textContent = entry.project_name;
  taskEl.textContent = entry.task_name;

  /** Convert the UTC start_time to a local millisecond timestamp for elapsed calculation. */
  const startMs = new Date(entry.start_time + 'Z').getTime();
  clearInterval(activeTimerInterval);
  activeTimerInterval = setInterval(() => {
    const elapsed = (Date.now() - startMs) / 1000;
    elapsedEl.textContent = formatDuration(elapsed);
  }, 1000);
  // Fire immediately so there's no 1-second blank
  const elapsed = (Date.now() - startMs) / 1000;
  elapsedEl.textContent = formatDuration(elapsed);
}

/**
 * Stop the live timer ticker and hide the active timer bar.
 * Called when the user stops a timer or when no active timer exists.
 */
function stopActiveTimerTick() {
  clearInterval(activeTimerInterval);
  $('#active-timer-bar').classList.add('hidden');
}

/**
 * Fetch the currently active timer from the server and sync the UI.
 * If a timer is running, starts the ticker. Otherwise hides the bar.
 * Fails silently since timer refresh is non-critical.
 */
async function refreshActiveTimer() {
  try {
    const entry = await api('/active');
    if (entry) {
      startActiveTimerTick(entry);
    } else {
      stopActiveTimerTick();
    }
  } catch (_err) {
    // Non-critical: timer refresh failure shouldn't block the UI
  }
}

/**
 * "Stop" button in the active timer bar. Stops whatever timer is currently
 * running, refreshes the timer bar, and reloads the project/task lists.
 */
$('#stop-active-btn').addEventListener('click', async () => {
  try {
    const entry = await api('/active');
    if (entry) {
      await safeApi(`/tasks/${entry.task_id}/stop`, { method: 'POST' });
      stopActiveTimerTick();
      if (currentProjectId) loadTasks(currentProjectId);
      loadProjects();
    }
  } catch (_err) { /* toast already shown by safeApi */ }
});

// ─── Projects ────────────────────────────────────────────

/**
 * Fetch all projects from the server and render them as cards in the project grid.
 * Each card shows: name, task count, total hours logged, hourly rate (if > 0),
 * and action buttons (Open, Edit, Delete).
 *
 * The empty state message can be changed in the innerHTML below.
 */
async function loadProjects() {
  try {
    const projects = await api('/projects');
    const grid = $('#project-list');
    grid.innerHTML = projects.length === 0
      ? '<div class="empty-state"><p>No projects yet.</p><p class="dim">Create a project to start tracking time.</p></div>'
      : '';

    for (const project of projects) {
      const card = document.createElement('div');
      card.className = 'project-card';
      /** --card-color is a CSS custom property used by .project-card::before for the accent stripe. */
      card.style.setProperty('--card-color', project.color);
      card.innerHTML = `
        <h3>${esc(project.name)}</h3>
        <div class="project-meta">
          <span>${project.task_count} task${project.task_count !== 1 ? 's' : ''}</span>
          <span>${formatHours(project.total_seconds)}h logged</span>
          ${project.rate > 0 ? `<span>${formatMoney(project.rate)}/hr</span>` : ''}
        </div>
        <div class="project-actions">
          <button class="btn btn-primary btn-sm open-btn">Open</button>
          <button class="btn btn-ghost btn-sm edit-btn">Edit</button>
          <button class="btn btn-danger btn-sm del-btn">Delete</button>
        </div>
      `;
      card.querySelector('.open-btn').addEventListener('click', (evt) => {
        evt.stopPropagation();
        showTasksView(project);
      });
      card.querySelector('.edit-btn').addEventListener('click', (evt) => {
        evt.stopPropagation();
        openProjectModal(project);
      });
      card.querySelector('.del-btn').addEventListener('click', async (evt) => {
        evt.stopPropagation();
        if (confirm(`Delete project "${project.name}" and all its tasks?`)) {
          try {
            await safeApi(`/projects/${project.id}`, { method: 'DELETE' });
            refreshActiveTimer();
            loadProjects();
          } catch (_err) { /* toast already shown by safeApi */ }
        }
      });
      /** Clicking anywhere on the card opens the project (same as the Open button). */
      card.addEventListener('click', () => showTasksView(project));
      grid.appendChild(card);
    }
  } catch (_err) {
    showToast('Failed to load projects');
  }
}

// ─── Project Modal ───────────────────────────────────────

/** ID of the project being edited in the modal, or null if creating a new project. */
let editingProjectId = null;

/** "New Project" button opens the project modal in create mode. */
$('#add-project-btn').addEventListener('click', () => openProjectModal());

/**
 * Open the project create/edit modal.
 *
 * @param {object|undefined} project — pass an existing project object to edit it,
 *   or call with no argument to create a new project.
 *   @param {number} project.id    — project ID (stored in editingProjectId)
 *   @param {string} project.name  — pre-filled in the name input
 *   @param {number} project.rate  — pre-filled in the rate input
 *   @param {string} project.color — pre-filled in the color picker
 *
 * EDITABLE PARAMETERS:
 *  - Default rate for new projects: change the '0' in the rate input default.
 *  - Default color for new projects: change '#4f46e5' in the color input default.
 *  - 50: delay in ms before focusing the name input (allows the modal animation to start).
 */
function openProjectModal(project) {
  editingProjectId = project ? project.id : null;
  $('#modal-title').textContent = project ? 'Edit Project' : 'New Project';
  $('#pf-name').value = project ? project.name : '';
  $('#pf-rate').value = project ? project.rate : 0;
  $('#pf-color').value = project ? project.color : '#4f46e5';
  $('#modal-overlay').classList.remove('hidden');
  setTimeout(() => $('#pf-name').focus(), 50);
}

/**
 * Close the project modal and reset state.
 */
function closeProjectModal() {
  $('#modal-overlay').classList.add('hidden');
}

/** Cancel button closes the modal. */
$('#modal-cancel').addEventListener('click', closeProjectModal);

/** Clicking the dark overlay background closes the modal. */
$('#modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('#modal-overlay')) closeProjectModal();
});

/**
 * Project form submit handler. Creates a new project or updates an existing one.
 * Reads values from the modal form inputs:
 *  - #pf-name  — project name (trimmed)
 *  - #pf-rate  — hourly rate (parsed as float, defaults to 0)
 *  - #pf-color — hex color string
 */
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
  } catch (_err) { /* toast already shown by safeApi */ }
});

// ─── Tasks ───────────────────────────────────────────────

/** "Back to Projects" button navigates up from the tasks view. */
$('#back-to-projects').addEventListener('click', () => {
  showProjectsView();
  loadProjects();
});

/** "Add" button creates a new task from the input field. */
$('#add-task-btn').addEventListener('click', addTask);

/** Pressing Enter in the task name input also adds the task. */
$('#new-task-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTask();
});

/**
 * Create a new task under the current project.
 * Reads the task name from #new-task-input, sends POST to the API,
 * then clears the input and reloads the task list.
 */
async function addTask() {
  const input = $('#new-task-input');
  const name = input.value.trim();
  if (!name || !currentProjectId) return;
  try {
    await safeApi(`/projects/${currentProjectId}/tasks`, { method: 'POST', body: { name } });
    input.value = '';
    loadTasks(currentProjectId);
  } catch (_err) { /* toast already shown by safeApi */ }
}

/** Task ID for the manual entry modal — set when opening the modal. */
let manualEntryTaskId = null;

/**
 * Fetch and render all tasks for a project.
 *
 * @param {number} projectId — project ID to load tasks for
 *
 * Each task card shows:
 *  - Completion checkbox (toggle complete/incomplete)
 *  - Task name and total logged time
 *  - Start/Stop timer button (only for incomplete tasks)
 *  - "Entries" button to view time entries
 *  - "+" button to add a manual time entry
 *  - Delete button
 */
async function loadTasks(projectId) {
  try {
    const tasks = await api(`/projects/${projectId}/tasks`);
    const list = $('#task-list');
    list.innerHTML = '';

    if (tasks.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No tasks yet.</p><p class="dim">Add a task above to start tracking time.</p></div>';
      return;
    }

    for (const task of tasks) {
      const card = document.createElement('div');
      card.className = 'task-card' + (task.completed ? ' completed' : '');
      /** running_entry_id is non-null if there's an active timer for this task. */
      const isRunning = !!task.running_entry_id;

      card.innerHTML = `
        <button class="task-check ${task.completed ? 'done' : ''}">${task.completed ? '&#10003;' : ''}</button>
        <div class="task-info">
          <div class="task-name">${esc(task.name)}</div>
          <div class="task-time">${formatDuration(task.total_seconds)} logged</div>
        </div>
        <div class="task-actions">
          ${!task.completed ? (isRunning
            ? `<button class="btn btn-danger btn-sm stop-btn">Stop</button>`
            : `<button class="btn btn-success btn-sm start-btn">Start</button>`
          ) : ''}
          <button class="btn btn-ghost btn-sm entries-btn" title="View time entries">Entries</button>
          <button class="btn btn-ghost btn-sm manual-btn" title="Add manual entry">+</button>
          <button class="btn btn-danger btn-sm del-btn" title="Delete task">&times;</button>
        </div>
      `;

      /** Toggle task completion on checkbox click (sends completed: 0 or 1). */
      card.querySelector('.task-check').addEventListener('click', async () => {
        try {
          await safeApi(`/tasks/${task.id}`, { method: 'PUT', body: { completed: task.completed ? 0 : 1 } });
          loadTasks(projectId);
        } catch (_err) { /* toast already shown by safeApi */ }
      });

      /** Start timer for this task (auto-stops any other running timer on the server). */
      const startBtn = card.querySelector('.start-btn');
      if (startBtn) {
        startBtn.addEventListener('click', async () => {
          try {
            await safeApi(`/tasks/${task.id}/start`, { method: 'POST' });
            loadTasks(projectId);
            refreshActiveTimer();
          } catch (_err) { /* toast already shown by safeApi */ }
        });
      }

      /** Stop the running timer for this task. */
      const stopBtn = card.querySelector('.stop-btn');
      if (stopBtn) {
        stopBtn.addEventListener('click', async () => {
          try {
            await safeApi(`/tasks/${task.id}/stop`, { method: 'POST' });
            loadTasks(projectId);
            refreshActiveTimer();
            loadProjects();
          } catch (_err) { /* toast already shown by safeApi */ }
        });
      }

      /** Open the entries view for this task. */
      card.querySelector('.entries-btn').addEventListener('click', () => {
        showEntriesView(task);
      });

      /** Open the manual entry modal to add a time entry for this task. */
      card.querySelector('.manual-btn').addEventListener('click', () => {
        openManualEntryModal(task.id);
      });

      /** Delete this task (with confirmation dialog). */
      card.querySelector('.del-btn').addEventListener('click', async () => {
        if (confirm(`Delete task "${task.name}"?`)) {
          try {
            await safeApi(`/tasks/${task.id}`, { method: 'DELETE' });
            loadTasks(projectId);
            refreshActiveTimer();
            loadProjects();
          } catch (_err) { /* toast already shown by safeApi */ }
        }
      });

      list.appendChild(card);
    }
  } catch (_err) {
    showToast('Failed to load tasks');
  }
}

// ─── Time Entries Panel ──────────────────────────────────

/** "Back to Tasks" button navigates up from entries to the task list. */
$('#back-to-tasks').addEventListener('click', () => {
  if (currentProject) {
    showTasksView(currentProject);
  } else {
    showProjectsView();
  }
});

/**
 * Fetch and render all time entries for a task.
 *
 * @param {number} taskId — task ID to load entries for
 *
 * Each entry card shows:
 *  - Start → End time range (or "now" if still running)
 *  - Duration (or "Running...")
 *  - Notes (if any)
 *  - Edit button (only for completed entries)
 *  - Delete button
 */
async function loadEntries(taskId) {
  try {
    const entries = await api(`/tasks/${taskId}/entries`);
    const list = $('#entries-list');
    list.innerHTML = '';

    if (entries.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No time entries yet.</p><p class="dim">Start a timer or add a manual entry.</p></div>';
      return;
    }

    for (const timeEntry of entries) {
      const card = document.createElement('div');
      const isRunning = !timeEntry.end_time;
      card.className = 'entry-card' + (isRunning ? ' running' : '');

      const duration = timeEntry.duration_seconds
        ? formatDuration(timeEntry.duration_seconds)
        : 'Running...';

      card.innerHTML = `
        <div class="entry-times">
          <div class="entry-range">${formatDateTime(timeEntry.start_time)} &rarr; ${isRunning ? 'now' : formatDateTime(timeEntry.end_time)}</div>
          <div class="entry-duration">${duration}</div>
        </div>
        ${timeEntry.notes ? `<div class="entry-notes">${esc(timeEntry.notes)}</div>` : ''}
        <div class="entry-actions">
          ${!isRunning ? `<button class="btn btn-ghost btn-sm edit-entry-btn" title="Edit entry">Edit</button>` : ''}
          <button class="btn btn-danger btn-sm del-entry-btn" title="Delete entry">&times;</button>
        </div>
      `;

      /** Edit button opens the manual entry modal pre-filled with this entry's data. */
      const editBtn = card.querySelector('.edit-entry-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          openEditEntryModal(timeEntry);
        });
      }

      /** Delete button removes this time entry (with confirmation). */
      card.querySelector('.del-entry-btn').addEventListener('click', async () => {
        if (confirm('Delete this time entry?')) {
          try {
            await safeApi(`/entries/${timeEntry.id}`, { method: 'DELETE' });
            loadEntries(taskId);
            refreshActiveTimer();
            loadProjects();
          } catch (_err) { /* toast already shown by safeApi */ }
        }
      });

      list.appendChild(card);
    }
  } catch (_err) {
    showToast('Failed to load entries');
  }
}

// ─── Manual Entry Modal ──────────────────────────────────

/**
 * Open the manual entry modal in "create" mode for a specific task.
 *
 * @param {number} taskId — the task to create a manual entry for.
 *   Sets manualEntryTaskId so the form submit handler knows which task to use.
 *
 * EDITABLE PARAMETERS:
 *  - 50: delay in ms before focusing the start input.
 */
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

/**
 * Open the manual entry modal in "edit" mode pre-filled with an existing entry.
 *
 * @param {object} entry — time entry object from the API, containing:
 *   @param {number} entry.id         — entry ID (stored in editingEntryId)
 *   @param {number} entry.task_id    — parent task ID
 *   @param {string} entry.start_time — UTC start time string
 *   @param {string} entry.end_time   — UTC end time string
 *   @param {string} entry.notes      — entry notes text
 */
function openEditEntryModal(entry) {
  editingEntryId = entry.id;
  manualEntryTaskId = entry.task_id;
  $('#manual-modal-title').textContent = 'Edit Time Entry';
  $('#manual-save-btn').textContent = 'Update Entry';

  // Convert UTC time strings to local datetime-local input format
  const startLocal = utcToLocalDatetimeInput(entry.start_time);
  const endLocal = utcToLocalDatetimeInput(entry.end_time);
  $('#me-start').value = startLocal;
  $('#me-end').value = endLocal;
  $('#me-notes').value = entry.notes || '';
  $('#manual-modal-overlay').classList.remove('hidden');
  setTimeout(() => $('#me-start').focus(), 50);
}

/**
 * Convert a UTC datetime string from the database into the format expected
 * by an HTML <input type="datetime-local"> element (YYYY-MM-DDTHH:MM).
 *
 * @param {string} utcStr — UTC datetime string (e.g. '2025-01-15 14:30:00')
 * @returns {string} Local datetime string for the input (e.g. '2025-01-15T09:30')
 *   or '' if the input is falsy.
 */
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

/**
 * Close the manual entry modal and clear the editing state.
 */
function closeManualModal() {
  $('#manual-modal-overlay').classList.add('hidden');
  editingEntryId = null;
}

/** Cancel button closes the manual entry modal. */
$('#manual-cancel').addEventListener('click', closeManualModal);

/** Clicking the dark overlay background closes the manual entry modal. */
$('#manual-modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('#manual-modal-overlay')) closeManualModal();
});

/**
 * Manual entry form submit handler.
 * Creates a new entry (POST) or updates an existing one (PUT) depending on
 * whether editingEntryId is set.
 *
 * Reads values from the modal form inputs:
 *  - #me-start — local datetime, converted to UTC 'YYYY-MM-DD HH:MM:SS' for the API
 *  - #me-end   — local datetime, converted to UTC 'YYYY-MM-DD HH:MM:SS' for the API
 *  - #me-notes — optional text note
 *
 * Validates that end is after start before submitting.
 */
$('#manual-entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const start = new Date($('#me-start').value);
  const end = new Date($('#me-end').value);
  if (isNaN(start) || isNaN(end) || end <= start) {
    showToast('Invalid date range. End must be after start.');
    return;
  }

  /** Convert local dates to UTC strings in 'YYYY-MM-DD HH:MM:SS' format for the server. */
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
  } catch (_err) { /* toast already shown by safeApi */ }
});

// ─── Global Keyboard Shortcuts ───────────────────────────

/**
 * Escape key closes any open modal.
 * Add more keyboard shortcuts here as needed (e.g. 'n' for new project).
 */
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

/**
 * Set the default date range for reports: from Monday of the current week to today.
 *
 * EDITABLE PARAMETERS:
 *  - The "from" date logic: change `((today.getDay() + 6) % 7)` to adjust the
 *    start-of-week day (current formula makes Monday the start).
 *    For Sunday-start weeks, use `today.getDay()` instead.
 *  - To default to a different range (e.g. current month), replace the date
 *    calculations entirely.
 */
function initReportDates() {
  const today = new Date();
  const monday = new Date(today);
  /** Calculate days since Monday: (getDay() + 6) % 7 maps Sun=6, Mon=0, Tue=1, etc. */
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  $('#report-from').value = monday.toISOString().split('T')[0];
  $('#report-to').value = today.toISOString().split('T')[0];
}

/** "Generate" button fetches and renders the report. */
$('#run-report-btn').addEventListener('click', generateReport);

/**
 * Fetch report data for the selected date range and render summary cards + detail table.
 *
 * Reads date range from:
 *  - #report-from — start date (YYYY-MM-DD)
 *  - #report-to   — end date (YYYY-MM-DD)
 *
 * Makes parallel API calls to:
 *  - GET /api/reports?from=...&to=...         → detailed entries
 *  - GET /api/reports/summary?from=...&to=... → per-project summary
 *
 * Renders:
 *  1. Summary cards for each project (hours + earnings)
 *  2. A "Total" summary card
 *  3. A detailed table with one row per time entry
 *  4. A footer row with totals
 */
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

    // ── Summary cards (one per project) ──
    let totalHours = 0;
    let totalEarnings = 0;
    summaryEl.innerHTML = '';

    for (const project of summary) {
      const hours = project.total_seconds / 3600;
      const earnings = hours * project.rate;
      totalHours += hours;
      totalEarnings += earnings;

      summaryEl.innerHTML += `
        <div class="summary-card" style="--card-color:${project.color}">
          <div class="label">${esc(project.project_name)}</div>
          <div class="value">${hours.toFixed(2)}h</div>
          <div class="sub">${project.entry_count} entries${project.rate > 0 ? ' &middot; ' + formatMoney(earnings) : ''}</div>
        </div>
      `;
    }

    // ── "Total" summary card ──
    summaryEl.innerHTML += `
      <div class="summary-card" style="--card-color:var(--success)">
        <div class="label">Total</div>
        <div class="value">${totalHours.toFixed(2)}h</div>
        <div class="sub">${formatMoney(totalEarnings)} earned</div>
      </div>
    `;

    // ── Detailed entries table ──
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

    /** Table footer with column totals for Hours and Earnings. */
    $('#report-foot').innerHTML = `
      <tr>
        <td colspan="4">Total</td>
        <td>${totalHours.toFixed(2)}</td>
        <td>${formatMoney(totalEarnings)}</td>
        <td></td>
      </tr>
    `;
  } catch (_err) { /* toast already shown by safeApi */ }
}

/**
 * "Export CSV" button. Opens the CSV download endpoint in a new tab.
 * Reads the date range from #report-from and #report-to.
 */
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

/** On page load: render the projects dashboard and sync the active timer. */
loadProjects();
refreshActiveTimer();
