/* =========================================================
   TASKFLOW · script.js
   Vanilla JavaScript productivity app. No backend: all data is
   saved in localStorage, so it survives page refreshes.

   Sections
     1. Configuration & constants
     2. Utilities (DOM, dates, storage, escaping)
     3. Data model (normalize, sample data, load & persist)
     4. Filtering & sorting
     5. Rendering (chrome, dashboard, tasks, calendar, categories, settings)
     6. Modals, confirmations & toasts
     7. Actions (tasks, categories, import / export, theme)
     8. Routing & clock
     9. Event wiring & initialisation
   ========================================================= */

(() => {
  'use strict';

  /* =======================================================
     1. CONFIGURATION & CONSTANTS
     ======================================================= */

  const APP_VERSION = '1.0.0';

  const STORAGE_KEYS = {
    tasks: 'taskflow.tasks.v1',
    categories: 'taskflow.categories.v1',
    settings: 'taskflow.settings.v1'
  };

  const PRIORITIES = {
    high:   { label: 'High',   color: '#EF4444', rank: 0 },
    medium: { label: 'Medium', color: '#F59E0B', rank: 1 },
    low:    { label: 'Low',    color: '#10B981', rank: 2 }
  };

  const SORT_OPTIONS = [
    { value: 'deadline-asc',   label: 'Deadline: soonest first' },
    { value: 'deadline-desc',  label: 'Deadline: latest first' },
    { value: 'created-desc',   label: 'Newest added' },
    { value: 'created-asc',    label: 'Oldest added' },
    { value: 'priority',       label: 'Priority: high first' },
    { value: 'completed-desc', label: 'Recently completed' },
    { value: 'title',          label: 'Title (A–Z)' }
  ];

  const COLORS = ['#4F46E5', '#7C3AED', '#2563EB', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899'];
  const UNCATEGORIZED_COLOR = '#94A3B8';

  const PAGES = {
    dashboard:  { title: 'Dashboard',       subtitle: 'Your productivity at a glance' },
    tasks:      { title: 'My Tasks',        subtitle: 'Everything on your plate, in one place' },
    completed:  { title: 'Completed Tasks', subtitle: 'Celebrate what you have finished' },
    calendar:   { title: 'Calendar',        subtitle: 'Deadlines laid out day by day' },
    categories: { title: 'Categories',      subtitle: 'Organize tasks by area of life' },
    settings:   { title: 'Settings',        subtitle: 'Personalize TASKFLOW to your flow' }
  };

  const DEFAULT_SETTINGS = {
    name: 'User',
    theme: 'light',
    defaultPriority: 'medium',
    confirmDelete: true
  };

  const DEFAULT_CATEGORIES = [
    { id: 'cat-work',     name: 'Work',     color: '#4F46E5' },
    { id: 'cat-personal', name: 'Personal', color: '#7C3AED' },
    { id: 'cat-study',    name: 'Study',    color: '#0EA5E9' },
    { id: 'cat-health',   name: 'Health',   color: '#10B981' },
    { id: 'cat-finance',  name: 'Finance',  color: '#F59E0B' }
  ];

  /** Returns a fresh copy of the default filter state (avoids shared references). */
  const defaultFilters = () => ({
    tasks:     { search: '', status: 'all', priority: 'all', category: 'all', sort: 'deadline-asc' },
    completed: { search: '', priority: 'all', category: 'all', sort: 'completed-desc' }
  });

  /** Single source of truth for the in-memory app state. */
  const state = {
    route: 'dashboard',
    tasks: [],
    categories: [],
    settings: { ...DEFAULT_SETTINGS },
    filters: defaultFilters(),
    calendar: null,          // { year, month } — set in init()
    charts: {},              // Chart.js instances keyed by name
    selectedColor: COLORS[0],
    lastDay: '',
    pendingAction: null      // callback for the confirm modal
  };

  /* =======================================================
     2. UTILITIES
     ======================================================= */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /** Safely escape text before injecting it into innerHTML. */
  const esc = (value = '') =>
    String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

  /** Sets textContent of an element by id (safe, no HTML injection). */
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---- Date helpers (local time, YYYY-MM-DD strings) ---- */
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const todayISO = () => toISO(new Date());
  const addDays = (iso, days) => {
    const d = parseISO(iso);
    d.setDate(d.getDate() + days);
    return toISO(d);
  };
  const daysBetween = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 86400000);
  const formatDate = (iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
    parseISO(iso).toLocaleDateString(undefined, opts);

  /* ---- Icons: lucide replaces <i data-lucide> with inline SVG ---- */
  const refreshIcons = () => {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  };

  /* ---- Storage helpers (never throw) ---- */
  const readStore = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      console.warn(`TASKFLOW: could not read "${key}"`, err);
      return fallback;
    }
  };

  const writeStore = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.error('TASKFLOW: could not save data', err);
      toast('Could not save changes. Your browser storage may be full.', 'error');
    }
  };

  const persistTasks = () => writeStore(STORAGE_KEYS.tasks, state.tasks);
  const persistCategories = () => writeStore(STORAGE_KEYS.categories, state.categories);
  const persistSettings = () => writeStore(STORAGE_KEYS.settings, state.settings);

  /* =======================================================
     3. DATA MODEL
     ======================================================= */

  /** Ensures a task object has every expected field with a valid value. */
  function normalizeTask(raw) {
    const completed = !!raw.completed;
    return {
      id: String(raw.id || uid()),
      title: String(raw.title || 'Untitled task').trim().slice(0, 120) || 'Untitled task',
      description: String(raw.description || '').slice(0, 500),
      category: String(raw.category || ''),
      priority: PRIORITIES[raw.priority] ? raw.priority : 'medium',
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline || '') ? raw.deadline : '',
      completed,
      createdAt: Number(raw.createdAt) || Date.now(),
      completedAt: completed ? (Number(raw.completedAt) || Date.now()) : null
    };
  }

  /** Ensures a category object is valid. */
  function normalizeCategory(raw) {
    return {
      id: String(raw.id || `cat-${uid()}`),
      name: String(raw.name || 'Untitled').trim().slice(0, 32) || 'Untitled',
      color: /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color : COLORS[0]
    };
  }

  /** Realistic starter tasks shown on first launch. Dates are relative to today. */
  function buildSampleTasks() {
    const today = todayISO();
    const now = Date.now();
    const DAY = 86400000;

    const make = (title, description, category, priority, offset, completed = false, createdDaysAgo = 0) => ({
      id: uid(),
      title,
      description,
      category,
      priority,
      deadline: offset === null ? '' : addDays(today, offset),
      completed,
      createdAt: now - createdDaysAgo * DAY,
      completedAt: completed ? now - DAY / 2 : null
    });

    return [
      make('Finish Q4 marketing report', 'Compile campaign metrics and draft the executive summary for the leadership review.', 'cat-work', 'high', -2, false, 6),
      make('Submit project proposal', 'Final review of scope, timeline and budget before sending it to the client.', 'cat-work', 'high', 1, false, 3),
      make('Prepare for midterm exam', 'Revise chapters 4 to 7, solve past papers and make flashcards for key formulas.', 'cat-study', 'high', 3, false, 5),
      make('Read "Atomic Habits" chapter 9', 'Take notes on habit stacking and pick one idea to apply this week.', 'cat-personal', 'low', 0, false, 2),
      make('Renew gym membership', '', 'cat-health', 'medium', -1, false, 9),
      make('Pay electricity bill', 'Auto-pay failed last month. Pay manually through the utility portal.', 'cat-finance', 'high', 0, false, 4),
      make('Team stand-up notes', 'Share the weekly summary in the design and engineering channel.', 'cat-work', 'medium', 5, false, 1),
      make('Plan weekend hike', 'Check the weather, pack water and snacks, and invite two friends.', 'cat-personal', 'low', 6, false, 2),
      make('Morning run: 5K', '', 'cat-health', 'medium', -3, true, 4),
      make('Update resume', 'Add the latest internship project and refresh the skills section.', 'cat-study', 'medium', 10, true, 8),
      make('Buy groceries for the week', '', 'cat-personal', 'low', null, false, 1),
      make('Quarterly budget review', 'Compare actual spending against the plan and flag categories over budget.', 'cat-finance', 'medium', 12, false, 0)
    ];
  }

  /** Loads everything from localStorage. Seeds sample data on first launch. */
  function loadData() {
    const storedTasks = readStore(STORAGE_KEYS.tasks, null);
    if (Array.isArray(storedTasks)) {
      state.tasks = storedTasks.filter((t) => t && typeof t === 'object').map(normalizeTask);
    } else {
      // First launch: seed realistic sample tasks so the app looks alive.
      state.tasks = buildSampleTasks();
      persistTasks();
    }

    const storedCategories = readStore(STORAGE_KEYS.categories, null);
    if (Array.isArray(storedCategories)) {
      state.categories = storedCategories.filter((c) => c && typeof c === 'object').map(normalizeCategory);
    } else {
      state.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
      persistCategories();
    }

    const storedSettings = readStore(STORAGE_KEYS.settings, {});
    state.settings = { ...DEFAULT_SETTINGS, ...(storedSettings || {}) };
  }

  /* ---- Task & category lookups ---- */
  const findTask = (id) => state.tasks.find((t) => t.id === id);
  const findCategory = (id) => state.categories.find((c) => c.id === id);
  const categoryName = (id) => findCategory(id)?.name ?? 'Uncategorized';
  const categoryColor = (id) => findCategory(id)?.color ?? UNCATEGORIZED_COLOR;

  const isOverdue = (t) => !t.completed && !!t.deadline && t.deadline < todayISO();
  const isDueToday = (t) => !t.completed && t.deadline === todayISO();

  /** Human-friendly deadline text, e.g. "Due tomorrow" or "Overdue by 2 days". */
  function deadlineLabel(task) {
    if (!task.deadline) return 'No deadline';
    if (task.completed) return `Was due ${formatDate(task.deadline)}`;

    const diff = daysBetween(task.deadline, todayISO());
    if (diff === 0) return 'Due today';
    if (diff === 1) return 'Due tomorrow';
    if (diff === -1) return 'Overdue by 1 day';
    if (diff < -1) return `Overdue by ${-diff} days`;
    if (diff <= 6) return `Due ${parseISO(task.deadline).toLocaleDateString(undefined, { weekday: 'long' })}`;
    return `Due ${formatDate(task.deadline)}`;
  }

  /* =======================================================
     4. FILTERING & SORTING
     ======================================================= */

  /** Returns tasks that match the current filters of a panel ('tasks' or 'completed'). */
  function visibleTasks(panel) {
    const f = state.filters[panel];
    const query = f.search.trim().toLowerCase();

    return state.tasks.filter((t) => {
      if (panel === 'completed' && !t.completed) return false;

      if (panel === 'tasks') {
        if (f.status === 'pending' && t.completed) return false;
        if (f.status === 'completed' && !t.completed) return false;
        if (f.status === 'overdue' && !isOverdue(t)) return false;
      }

      if (f.priority !== 'all' && t.priority !== f.priority) return false;
      if (f.category !== 'all' && t.category !== f.category) return false;

      if (query) {
        const haystack = `${t.title} ${t.description} ${categoryName(t.category)}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  /** Sorts a list of tasks by the chosen sort key. Tasks with no deadline go last. */
  function sortTasks(list, sort) {
    const copy = [...list];

    const byDeadline = (a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    };

    switch (sort) {
      case 'deadline-desc':
        return copy.sort((a, b) => {
          if (!a.deadline || !b.deadline) return byDeadline(a, b);
          return b.deadline.localeCompare(a.deadline);
        });
      case 'created-desc':
        return copy.sort((a, b) => b.createdAt - a.createdAt);
      case 'created-asc':
        return copy.sort((a, b) => a.createdAt - b.createdAt);
      case 'priority':
        return copy.sort((a, b) =>
          PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank || byDeadline(a, b));
      case 'completed-desc':
        return copy.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      case 'title':
        return copy.sort((a, b) => a.title.localeCompare(b.title));
      case 'deadline-asc':
      default:
        return copy.sort((a, b) => byDeadline(a, b) || b.createdAt - a.createdAt);
    }
  }

  /* =======================================================
     5. RENDERING
     ======================================================= */

  /** Single entry point: re-renders chrome and the active page. */
  function render() {
    renderChrome();
    renderCategorySelects();

    switch (state.route) {
      case 'dashboard':  renderDashboard(); break;
      case 'tasks':      renderTaskPanel('tasks'); break;
      case 'completed':  renderTaskPanel('completed'); break;
      case 'calendar':   renderCalendar(); break;
      case 'categories': renderCategories(); break;
      case 'settings':   renderSettings(); break;
      default: break;
    }
    refreshIcons();
  }

  /* ---- Sidebar: pending badge, today's progress, user card ---- */
  function renderChrome() {
    const pending = state.tasks.filter((t) => !t.completed).length;
    setText('navPendingCount', pending);

    const today = state.tasks.filter((t) => t.deadline === todayISO());
    const done = today.filter((t) => t.completed).length;
    const pct = today.length ? Math.round((done / today.length) * 100) : 0;
    setText('todayPct', `${pct}%`);
    const bar = document.getElementById('todayBar');
    if (bar) bar.style.width = `${pct}%`;
    setText('todayText', today.length
      ? `${done} of ${today.length} due today completed`
      : 'Nothing due today. Enjoy it!');

    const name = state.settings.name.trim();
    setText('userName', name || 'User');
    setText('userAvatar', (name.charAt(0) || 'U').toUpperCase());
  }

  /* ---- Filter dropdowns (categories change over time) ---- */
  function renderCategorySelects() {
    const options = state.categories
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
      .join('');

    ['tasks', 'completed'].forEach((panel) => {
      const f = state.filters[panel];
      // If the selected category was deleted, fall back to "All".
      if (f.category !== 'all' && f.category !== '' && !findCategory(f.category)) {
        f.category = 'all';
      }
      const select = document.getElementById(`${panel}Category`);
      if (!select) return;
      select.innerHTML =
        '<option value="all">All categories</option>' +
        '<option value="">Uncategorized</option>' +
        options;
      select.value = f.category;
    });
  }

  /* ---- Dashboard ---- */
  function renderDashboard() {
    const total = state.tasks.length;
    const completed = state.tasks.filter((t) => t.completed).length;
    const pending = total - completed;
    const overdue = state.tasks.filter(isOverdue).length;
    const dueToday = state.tasks.filter(isDueToday).length;
    const rate = total ? Math.round((completed / total) * 100) : 0;

    // Welcome banner
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = state.settings.name.trim();
    setText('welcomeTitle', `${greeting}, ${name || 'User'}`);
    setText('welcomeSub', pending === 0
      ? "You're all caught up. Enjoy the calm, or plan what's next."
      : `You have ${pending} open ${pending === 1 ? 'task' : 'tasks'}${overdue ? `, ${overdue} of them overdue` : ''}.`);

    // Stat cards
    setText('statTotal', total);
    setText('statTotalSub', total
      ? `Across ${new Set(state.tasks.map((t) => t.category)).size} categories`
      : 'Add your first task to begin');
    setText('statCompleted', completed);
    setText('statCompletedSub', `${rate}% completion rate`);
    setText('statPending', pending);
    setText('statPendingSub', `${dueToday} due today`);
    setText('statOverdue', overdue);
    setText('statOverdueSub', overdue ? 'Needs your attention' : 'Nothing overdue. Great work!');

    renderProgressChart(completed, pending, rate);
    renderWeekChart();
    renderRecentAndUpcoming();
  }

  /** Reads a CSS custom property so charts match the active theme. */
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /** Creates (or replaces) a Chart.js instance. Safe if Chart.js failed to load. */
  function makeChart(key, canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    if (state.charts[key]) state.charts[key].destroy();
    state.charts[key] = new window.Chart(canvas, config);
  }

  function renderProgressChart(completed, pending, rate) {
    const hasData = completed + pending > 0;
    setText('progressPct', `${rate}%`);
    setText('legendCompleted', completed);
    setText('legendPending', pending);

    makeChart('progress', 'progressChart', {
      type: 'doughnut',
      data: {
        labels: ['Completed', 'Pending'],
        datasets: [{
          data: hasData ? [completed, pending] : [1],
          backgroundColor: hasData
            ? [cssVar('--accent'), cssVar('--accent-soft-strong')]
            : [cssVar('--ring')],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '76%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: hasData }
        },
        animation: { animateRotate: true, duration: 900 }
      }
    });
  }

  function renderWeekChart() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(todayISO(), i - 6));
    const counts = days.map((day) =>
      state.tasks.filter((t) => t.completed && t.completedAt && toISO(new Date(t.completedAt)) === day).length);
    const total = counts.reduce((sum, n) => sum + n, 0);

    setText('metricWeek', total);
    setText('metricAvg', (total / 7).toFixed(1));

    // Category with the most tasks overall
    const tally = {};
    state.tasks.forEach((t) => { tally[t.category] = (tally[t.category] || 0) + 1; });
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    setText('metricTop', top ? categoryName(top[0]) : '—');

    makeChart('week', 'weekChart', {
      type: 'bar',
      data: {
        labels: days.map((d) => parseISO(d).toLocaleDateString(undefined, { weekday: 'short' })),
        datasets: [{
          label: 'Completed',
          data: counts,
          backgroundColor: days.map((_, i) => (i === 6 ? cssVar('--accent') : cssVar('--accent-soft-strong'))),
          borderRadius: 8,
          maxBarThickness: 32
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: cssVar('--muted') } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: cssVar('--muted') },
            grid: { color: cssVar('--border') }
          }
        }
      }
    });
  }

  /** Compact row used on the dashboard. */
  function miniTaskHTML(t) {
    const overdue = isOverdue(t);
    return `
      <div class="mini-task${t.completed ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}">
        <button class="check${t.completed ? ' checked' : ''}" type="button" data-action="toggle" data-id="${t.id}"
                aria-label="${t.completed ? 'Mark as pending' : 'Mark as completed'}" aria-pressed="${t.completed}">
          <i data-lucide="check"></i>
        </button>
        <div class="mini-body">
          <strong>${esc(t.title)}</strong>
          <small>
            <span class="dot" style="--c:${categoryColor(t.category)}"></span>
            ${esc(categoryName(t.category))} · ${esc(deadlineLabel(t))}
          </small>
        </div>
        <span class="badge badge-${t.priority}">${PRIORITIES[t.priority].label}</span>
      </div>`;
  }

  function renderRecentAndUpcoming() {
    const recent = [...state.tasks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
    const upcoming = state.tasks
      .filter((t) => !t.completed && t.deadline)
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
      .slice(0, 5);

    document.getElementById('recentList').innerHTML = recent.length
      ? recent.map(miniTaskHTML).join('')
      : emptyState({
          title: 'No tasks yet',
          text: 'Tasks you add will appear here.',
          compact: true,
          action: '<button class="btn btn-primary" type="button" data-action="new-task"><i data-lucide="plus"></i>Add a task</button>'
        });

    document.getElementById('upcomingList').innerHTML = upcoming.length
      ? upcoming.map(miniTaskHTML).join('')
      : emptyState({
          title: 'Nothing scheduled',
          text: 'Give your tasks deadlines to see what is coming up.',
          compact: true
        });
  }

  /* ---- Task panels (My Tasks & Completed) ---- */
  function renderTaskPanel(panel) {
    const f = state.filters[panel];
    const base = panel === 'completed' ? state.tasks.filter((t) => t.completed) : state.tasks;
    const list = sortTasks(visibleTasks(panel), f.sort);
    const container = document.getElementById(`${panel}List`);

    syncControls(panel);
    setText(`${panel}Count`, `Showing ${list.length} of ${base.length} ${base.length === 1 ? 'task' : 'tasks'}`);

    if (panel === 'completed') {
      const clearBtn = document.getElementById('clearCompletedBtn');
      if (clearBtn) clearBtn.disabled = base.length === 0;
    }

    if (base.length === 0) {
      container.innerHTML = panel === 'completed'
        ? emptyState({
            title: 'Nothing completed yet',
            text: 'Finish a task and it will show up here as a win.'
          })
        : emptyState({
            title: 'Your task list is empty',
            text: 'Add your first task to start planning. Deadlines, priorities and categories are all optional.',
            action: '<button class="btn btn-primary" type="button" data-action="new-task"><i data-lucide="plus"></i>Add a task</button>'
          });
    } else if (list.length === 0) {
      container.innerHTML = emptyState({
        title: 'No tasks match these filters',
        text: 'Try a different search term, or reset the filters.',
        action: `<button class="btn btn-ghost" type="button" data-action="reset-filters" data-panel="${panel}"><i data-lucide="rotate-ccw"></i>Reset filters</button>`
      });
    } else {
      container.innerHTML = list.map((t, i) => taskCardHTML(t, i)).join('');
    }

    refreshIcons();
  }

  /** Writes the current filter state back into the controls (only when changed). */
  function syncControls(panel) {
    const f = state.filters[panel];
    const values = { Search: f.search, Priority: f.priority, Category: f.category, Sort: f.sort };
    if (panel === 'tasks') values.Status = f.status;

    Object.entries(values).forEach(([key, value]) => {
      const el = document.getElementById(`${panel}${key}`);
      if (el && el.value !== value) el.value = value;
    });

    // Keep the top-bar search in sync with the tasks search (unless the user is typing in it).
    const global = document.getElementById('globalSearch');
    if (panel === 'tasks' && global && document.activeElement !== global) {
      global.value = f.search;
    }
  }

  /** Full task card used on the My Tasks and Completed pages. */
  function taskCardHTML(t, index = 0) {
    const overdue = isOverdue(t);
    const p = PRIORITIES[t.priority];

    return `
      <article class="task-card${t.completed ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}"
               style="--i:${Math.min(index, 12)};--prio:${p.color}">
        <button class="check${t.completed ? ' checked' : ''}" type="button" data-action="toggle" data-id="${t.id}"
                aria-label="${t.completed ? 'Mark as pending' : 'Mark as completed'}" aria-pressed="${t.completed}">
          <i data-lucide="check"></i>
        </button>

        <div class="task-main">
          <div class="task-top">
            <h4 class="task-title">
              <button class="linkish" type="button" data-action="edit" data-id="${t.id}">${esc(t.title)}</button>
            </h4>
            <span class="badge badge-${t.priority}">${p.label}</span>
          </div>
          ${t.description ? `<p class="task-desc">${esc(t.description)}</p>` : ''}
          <div class="task-meta">
            <span class="chip" style="--c:${categoryColor(t.category)}">
              <span class="dot"></span>${esc(categoryName(t.category))}
            </span>
            <span class="deadline${overdue ? ' danger' : ''}">
              <i data-lucide="calendar"></i>${esc(deadlineLabel(t))}
            </span>
          </div>
        </div>

        <div class="task-actions">
          <button class="icon-btn" type="button" data-action="edit" data-id="${t.id}" aria-label="Edit task">
            <i data-lucide="pencil"></i>
          </button>
          <button class="icon-btn danger" type="button" data-action="delete" data-id="${t.id}" aria-label="Delete task">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </article>`;
  }

  /** Reusable empty-state with an inline SVG illustration. */
  function emptyState({ title, text, action = '', compact = false }) {
    return `
      <div class="empty-state${compact ? ' compact' : ''}">
        <svg class="empty-art" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
          <ellipse cx="80" cy="110" rx="58" ry="6" class="empty-shadow"></ellipse>
          <rect x="30" y="18" width="100" height="78" rx="16" class="empty-paper"></rect>
          <rect x="46" y="38" width="48" height="7" rx="3.5" class="empty-line"></rect>
          <rect x="46" y="54" width="68" height="7" rx="3.5" class="empty-line"></rect>
          <rect x="46" y="70" width="36" height="7" rx="3.5" class="empty-line"></rect>
          <circle cx="122" cy="40" r="18" class="empty-badge"></circle>
          <path d="M113 40l6 6 11-12" class="empty-check"></path>
        </svg>
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
        ${action}
      </div>`;
  }

  /* ---- Calendar ---- */
  function renderCalendar() {
    const { year, month } = state.calendar;
    const first = new Date(year, month, 1);
    const startOffset = first.getDay();           // 0 = Sunday
    const today = todayISO();

    setText('calTitle', first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

    const monthPrefix = `${year}-${pad(month + 1)}`;
    const inMonth = state.tasks.filter((t) => t.deadline && t.deadline.startsWith(monthPrefix)).length;
    setText('calSummary', `${inMonth} ${inMonth === 1 ? 'deadline' : 'deadlines'} this month`);

    // Group tasks by deadline date
    const byDate = {};
    state.tasks.forEach((t) => {
      if (!t.deadline) return;
      if (!byDate[t.deadline]) byDate[t.deadline] = [];
      byDate[t.deadline].push(t);
    });

    // Build a fixed 6-week grid (42 cells), including spill-over days
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const date = new Date(year, month, 1 - startOffset + i);
      cells.push({ iso: toISO(date), day: date.getDate(), other: date.getMonth() !== month });
    }

    document.getElementById('calGrid').innerHTML = cells.map((cell) => {
      const items = (byDate[cell.iso] || []).sort((a, b) =>
        Number(a.completed) - Number(b.completed) ||
        PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank);
      const shown = items.slice(0, 3);
      const extra = items.length - shown.length;

      return `
        <div class="cal-cell${cell.other ? ' is-other' : ''}${cell.iso === today ? ' is-today' : ''}"
             data-date="${cell.iso}" role="button" tabindex="0" aria-label="Add a task on ${cell.iso}">
          <span class="cal-day">${cell.day}</span>
          <div class="cal-events">
            ${shown.map((t) => `
              <button class="cal-event${t.completed ? ' is-done' : ''}${isOverdue(t) ? ' is-overdue' : ''}"
                      type="button" data-action="edit" data-id="${t.id}"
                      style="--c:${categoryColor(t.category)}" title="${esc(t.title)}">${esc(t.title)}</button>`).join('')}
            ${extra > 0 ? `<span class="cal-more">+${extra} more</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  /* ---- Categories ---- */
  function renderCategories() {
    const grid = document.getElementById('categoryGrid');

    if (!state.categories.length) {
      grid.innerHTML = emptyState({
        title: 'No categories yet',
        text: 'Create categories such as Work, Study or Health to group your tasks.',
        action: '<button class="btn btn-primary" type="button" data-action="new-category"><i data-lucide="plus"></i>New category</button>'
      });
      return;
    }

    grid.innerHTML = state.categories.map((c, i) => {
      const list = state.tasks.filter((t) => t.category === c.id);
      const done = list.filter((t) => t.completed).length;
      const pct = list.length ? Math.round((done / list.length) * 100) : 0;

      return `
        <article class="card category-card" style="--c:${c.color};--i:${i}">
          <div class="cat-head">
            <span class="cat-icon"><i data-lucide="folder"></i></span>
            <div class="cat-actions">
              <button class="icon-btn" type="button" data-action="edit-category" data-id="${c.id}" aria-label="Edit ${esc(c.name)}">
                <i data-lucide="pencil"></i>
              </button>
              <button class="icon-btn danger" type="button" data-action="delete-category" data-id="${c.id}" aria-label="Delete ${esc(c.name)}">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>
          <h3>${esc(c.name)}</h3>
          <p class="muted">${list.length} ${list.length === 1 ? 'task' : 'tasks'} · ${list.length - done} pending</p>
          <div class="progress"><span style="width:${pct}%"></span></div>
          <div class="cat-foot">
            <span>${pct}% complete</span>
            <button class="link-btn" type="button" data-action="view-category" data-id="${c.id}">
              View tasks <i data-lucide="arrow-right"></i>
            </button>
          </div>
        </article>`;
    }).join('');
  }

  /* ---- Settings ---- */
  function renderSettings() {
    document.getElementById('settingsName').value = state.settings.name;
    document.getElementById('defaultPriority').value = state.settings.defaultPriority;
    document.getElementById('confirmDeleteToggle').checked = state.settings.confirmDelete;
    document.getElementById('darkModeToggle').checked = state.settings.theme === 'dark';
    setText('storageInfo', `${state.tasks.length} tasks and ${state.categories.length} categories saved in this browser.`);
    setText('appVersion', APP_VERSION);
  }

  /* =======================================================
     6. MODALS, CONFIRMATIONS & TOASTS
     ======================================================= */

  function openBackdrop(el) {
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => {
      const target = el.querySelector('[data-autofocus]') ||
        el.querySelector('input:not([type="hidden"]), textarea, select, button');
      target?.focus();
    });
  }

  function closeBackdrop(el) {
    if (!el) return;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    if (!isModalOpen()) document.body.classList.remove('no-scroll');
  }

  const isModalOpen = () => !!document.querySelector('.modal-backdrop.open');

  /** Shows a confirmation dialog; runs onConfirm only if the user agrees. */
  function askConfirm({ title, message, confirmLabel = 'Confirm', onConfirm }) {
    setText('confirmTitle', title);
    setText('confirmMessage', message);
    document.getElementById('confirmOk').textContent = confirmLabel;
    state.pendingAction = onConfirm;
    openBackdrop(document.getElementById('confirmModal'));
  }

  /** Marks a form field as invalid and shows the message under it. */
  function showFieldError(field, message) {
    field.classList.add('invalid');
    const err = field.closest('.field')?.querySelector('.error');
    if (err) err.textContent = message;
    field.focus();
  }

  function clearFieldError(field) {
    field.classList.remove('invalid');
    const err = field.closest('.field')?.querySelector('.error');
    if (err) err.textContent = '';
  }

  /**
   * Shows a toast notification.
   * @param {string} message
   * @param {'success'|'error'|'info'} type
   * @param {number} duration  milliseconds before auto-dismiss
   */
  function toast(message, type = 'info', duration = 3200) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = { success: 'circle-check', error: 'circle-alert', info: 'info' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <i data-lucide="${icons[type] || 'info'}"></i>
      <span></span>
      <button class="toast-close" type="button" aria-label="Dismiss"><i data-lucide="x"></i></button>`;
    el.querySelector('span').textContent = message;

    container.appendChild(el);
    while (container.children.length > 4) container.firstElementChild.remove();
    refreshIcons();

    const dismiss = () => {
      clearTimeout(timer);
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 300);
    };
    el.querySelector('.toast-close').addEventListener('click', dismiss);
    const timer = setTimeout(dismiss, duration);
  }

  /* =======================================================
     7. ACTIONS
     ======================================================= */

  /* ---- Task modal ---- */
  function fillTaskCategorySelect(selected) {
    const select = document.getElementById('taskCategory');
    select.innerHTML =
      '<option value="">Uncategorized</option>' +
      state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    select.value = findCategory(selected) ? selected : '';
  }

  function setPriorityRadio(value) {
    document.querySelectorAll('input[name="priority"]').forEach((radio) => {
      radio.checked = radio.value === value;
    });
  }

  /**
   * Opens the task modal.
   * @param {object|null} task      existing task to edit, or null to create
   * @param {object}      defaults  optional prefill: { deadline, category, priority }
   */
  function openTaskModal(task = null, defaults = {}) {
    const form = document.getElementById('taskForm');
    form.reset();
    document.querySelectorAll('#taskForm .invalid').forEach(clearFieldError);

    const isEdit = !!task;
    document.getElementById('taskModalTitle').textContent = isEdit ? 'Edit task' : 'New task';
    document.getElementById('taskSubmit').textContent = isEdit ? 'Save changes' : 'Create task';

    document.getElementById('taskId').value = task?.id || '';
    document.getElementById('taskTitle').value = task?.title || '';
    document.getElementById('taskDesc').value = task?.description || '';
    document.getElementById('taskDeadline').value = task?.deadline ?? defaults.deadline ?? '';
    fillTaskCategorySelect(task?.category ?? defaults.category ?? state.categories[0]?.id ?? '');
    setPriorityRadio(task?.priority || defaults.priority || state.settings.defaultPriority);

    document.getElementById('completedRow').hidden = !isEdit;
    document.getElementById('taskCompleted').checked = !!task?.completed;

    openBackdrop(document.getElementById('taskModal'));
  }

  function handleTaskSubmit(e) {
    e.preventDefault();

    const titleField = document.getElementById('taskTitle');
    const title = titleField.value.trim();
    if (!title) {
      showFieldError(titleField, 'Please give this task a title.');
      return;
    }

    const data = {
      title,
      description: document.getElementById('taskDesc').value.trim(),
      category: document.getElementById('taskCategory').value,
      priority: document.querySelector('input[name="priority"]:checked')?.value || 'medium',
      deadline: document.getElementById('taskDeadline').value
    };

    const id = document.getElementById('taskId').value;
    const existing = id ? findTask(id) : null;

    if (existing) {
      const completed = document.getElementById('taskCompleted').checked;
      Object.assign(existing, data, {
        completed,
        completedAt: completed ? (existing.completedAt || Date.now()) : null
      });
      toast('Task updated', 'success');
    } else {
      state.tasks.unshift(normalizeTask({ ...data, id: uid(), createdAt: Date.now(), completed: false }));
      toast('Task created', 'success');
    }

    persistTasks();
    closeBackdrop(document.getElementById('taskModal'));
    render();
  }

  /** Toggles completion and keeps completedAt in sync. */
  function toggleTask(id) {
    const task = findTask(id);
    if (!task) return;
    task.completed = !task.completed;
    task.completedAt = task.completed ? Date.now() : null;
    persistTasks();
    toast(task.completed ? 'Task completed. Nice work!' : 'Task moved back to pending',
      task.completed ? 'success' : 'info');
    render();
  }

  /**
   * Deletes one or more tasks, asking first when the user has that option on.
   * @param {{ids: string[], title: string, message: string, force?: boolean}} options
   *        force = always confirm, even when "confirm before deleting" is off.
   */
  function requestDelete({ ids, title, message, force = false }) {
    const remove = () => {
      state.tasks = state.tasks.filter((t) => !ids.includes(t.id));
      persistTasks();
      render();
      toast(ids.length === 1 ? 'Task deleted' : `${ids.length} tasks deleted`, 'success');
    };

    if (!force && !state.settings.confirmDelete) {
      remove();
      return;
    }
    askConfirm({ title, message, confirmLabel: 'Delete', onConfirm: remove });
  }

  function resetFilters(panel) {
    state.filters[panel] = defaultFilters()[panel];
    if (panel === 'tasks') {
      const global = document.getElementById('globalSearch');
      if (global) global.value = '';
    }
    render();
  }

  function viewCategory(id) {
    state.filters.tasks.category = id;
    navigate('tasks');
  }

  /* ---- Category modal ---- */
  function renderSwatches() {
    document.getElementById('swatches').innerHTML = COLORS.map((c) => `
      <button type="button" class="swatch${c === state.selectedColor ? ' selected' : ''}"
              data-color="${c}" style="--c:${c}" aria-label="Color ${c}"
              aria-pressed="${c === state.selectedColor}"></button>`).join('');
  }

  function openCategoryModal(category = null) {
    document.getElementById('categoryForm').reset();
    document.querySelectorAll('#categoryForm .invalid').forEach(clearFieldError);

    document.getElementById('categoryId').value = category?.id || '';
    document.getElementById('categoryName').value = category?.name || '';
    document.getElementById('categoryModalTitle').textContent = category ? 'Edit category' : 'New category';
    document.getElementById('categorySubmit').textContent = category ? 'Save changes' : 'Create category';

    state.selectedColor = category?.color || COLORS[state.categories.length % COLORS.length];
    renderSwatches();
    openBackdrop(document.getElementById('categoryModal'));
  }

  function handleCategorySubmit(e) {
    e.preventDefault();
    const nameField = document.getElementById('categoryName');
    const name = nameField.value.trim();
    const id = document.getElementById('categoryId').value;

    if (!name) {
      showFieldError(nameField, 'Give your category a name.');
      return;
    }
    const duplicate = state.categories.some((c) =>
      c.id !== id && c.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      showFieldError(nameField, 'A category with this name already exists.');
      return;
    }

    const existing = id ? findCategory(id) : null;
    if (existing) {
      Object.assign(existing, { name, color: state.selectedColor });
      toast('Category updated', 'success');
    } else {
      state.categories.push({ id: `cat-${uid()}`, name, color: state.selectedColor });
      toast('Category created', 'success');
    }

    persistCategories();
    closeBackdrop(document.getElementById('categoryModal'));
    render();
  }

  function deleteCategory(id) {
    const category = findCategory(id);
    if (!category) return;
    const count = state.tasks.filter((t) => t.category === id).length;

    askConfirm({
      title: `Delete "${category.name}"?`,
      message: count
        ? `${count} ${count === 1 ? 'task' : 'tasks'} in this category will become uncategorized. The tasks themselves are kept.`
        : 'This category has no tasks, so nothing else will change.',
      confirmLabel: 'Delete category',
      onConfirm: () => {
        state.categories = state.categories.filter((c) => c.id !== id);
        state.tasks.forEach((t) => { if (t.category === id) t.category = ''; });
        persistCategories();
        persistTasks();
        render();
        toast('Category deleted', 'success');
      }
    });
  }

  /* ---- Calendar navigation ---- */
  function shiftMonth(delta) {
    const d = new Date(state.calendar.year, state.calendar.month + delta, 1);
    state.calendar = { year: d.getFullYear(), month: d.getMonth() };
    renderCalendar();
    refreshIcons();
  }

  function goToToday() {
    const d = new Date();
    state.calendar = { year: d.getFullYear(), month: d.getMonth() };
    renderCalendar();
  }

  /* ---- Theme ---- */
  function applyTheme(theme) {
    const isDark = theme === 'dark';
    state.settings.theme = isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.settings.theme);
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isDark ? '#0B1020' : '#4F46E5');

    const btn = document.getElementById('themeToggle');
    btn.innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}"></i>`;
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');

    persistSettings();
    refreshIcons();
  }

  /* ---- Import / export ---- */
  function exportData() {
    const payload = {
      app: 'TASKFLOW',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      tasks: state.tasks,
      categories: state.categories
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `taskflow-backup-${todayISO()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast('Backup downloaded', 'success');
  }

  async function importData(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      toast('That file could not be read. Please choose a TASKFLOW backup (.json).', 'error');
      return;
    }

    if (!data || !Array.isArray(data.tasks)) {
      toast('That file is not a valid TASKFLOW backup.', 'error');
      return;
    }

    askConfirm({
      title: 'Replace your current data?',
      message: `This replaces your ${state.tasks.length} current tasks with ${data.tasks.length} from the backup.`,
      confirmLabel: 'Import',
      onConfirm: () => {
        state.tasks = data.tasks
          .filter((t) => t && typeof t === 'object')
          .map(normalizeTask);
        if (Array.isArray(data.categories) && data.categories.length) {
          state.categories = data.categories
            .filter((c) => c && typeof c === 'object')
            .map(normalizeCategory);
        }
        persistTasks();
        persistCategories();
        render();
        toast('Backup imported', 'success');
      }
    });
  }

  /* =======================================================
     8. ROUTING & CLOCK
     ======================================================= */

  function setSidebar(open) {
    document.getElementById('app').classList.toggle('sidebar-open', open);
    document.getElementById('menuBtn')?.setAttribute('aria-expanded', String(open));
  }

  const closeSidebar = () => setSidebar(false);

  /** Changes the page by updating the URL hash (keeps refresh + back/forward working). */
  function navigate(route) {
    if (location.hash === `#${route}`) applyRoute();
    else location.hash = route;
  }

  /** Activates the page that matches the current hash. */
  function applyRoute() {
    const hashRoute = location.hash.replace('#', '');
    const route = PAGES[hashRoute] ? hashRoute : 'dashboard';
    const changed = route !== state.route;
    state.route = route;

    document.querySelectorAll('.page').forEach((page) => {
      page.classList.toggle('active', page.dataset.page === route);
    });
    document.querySelectorAll('.nav-link').forEach((link) => {
      const active = link.dataset.route === route;
      link.classList.toggle('active', active);
      link.setAttribute('aria-current', active ? 'page' : 'false');
    });

    setText('pageTitle', PAGES[route].title);
    setText('pageSubtitle', PAGES[route].subtitle);
    document.title = `${PAGES[route].title} · TASKFLOW`;

    closeSidebar();
    render();
    if (changed) window.scrollTo(0, 0);
  }

  /** Live clock + automatic refresh when the day changes (so overdue status stays correct). */
  function tickClock() {
    const now = new Date();
    setText('clockDate', now.toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    }));
    setText('clockTime', now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));

    const today = toISO(now);
    if (today !== state.lastDay) {
      state.lastDay = today;
      render();
    }
  }

  /* =======================================================
     9. EVENT WIRING & INITIALISATION
     ======================================================= */

  /** Handles clicks on any element with data-action. */
  function runAction({ action, id, panel }) {
    switch (action) {
      case 'toggle':
        return toggleTask(id);
      case 'edit': {
        const task = findTask(id);
        return task && openTaskModal(task);
      }
      case 'delete': {
        const task = findTask(id);
        return task && requestDelete({
          ids: [task.id],
          title: 'Delete this task?',
          message: `"${task.title}" will be permanently removed.`
        });
      }
      case 'new-task':
        return openTaskModal();
      case 'reset-filters':
        return resetFilters(panel);
      case 'new-category':
        return openCategoryModal();
      case 'edit-category':
        return openCategoryModal(findCategory(id));
      case 'delete-category':
        return deleteCategory(id);
      case 'view-category':
        return viewCategory(id);
      default:
        return undefined;
    }
  }

  /** Single delegated click handler for the whole document. */
  function handleClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      runAction(actionEl.dataset);
      return;
    }

    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      closeBackdrop(closeBtn.closest('.modal-backdrop'));
      return;
    }

    if (e.target.classList?.contains('modal-backdrop')) {
      closeBackdrop(e.target);
      return;
    }

    const cell = e.target.closest('.cal-cell');
    if (cell) openTaskModal(null, { deadline: cell.dataset.date });
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      const open = document.querySelector('.modal-backdrop.open');
      if (open) closeBackdrop(open);
      else if (document.querySelector('.topbar.search-open')) {
        document.querySelector('.topbar').classList.remove('search-open');
        document.getElementById('globalSearchToggle').setAttribute('aria-expanded', 'false');
        document.getElementById('globalSearchToggle').setAttribute('aria-label', 'Open search');
      }
      else closeSidebar();
      return;
    }

    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');

    // "/" focuses the global search, like most productivity apps
    if (e.key === '/' && !typing && !isModalOpen()) {
      e.preventDefault();
      document.getElementById('globalSearch').focus();
      return;
    }

    // Keyboard support for calendar day cells
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('cal-cell')) {
      e.preventDefault();
      openTaskModal(null, { deadline: e.target.dataset.date });
    }
  }

  /** Filter controls on the My Tasks and Completed pages. */
  function bindPanel(panel) {
    document.getElementById(`${panel}Search`).addEventListener('input', (e) => {
      state.filters[panel].search = e.target.value;
      renderTaskPanel(panel);
    });

    ['Priority', 'Category', 'Sort'].forEach((key) => {
      document.getElementById(`${panel}${key}`).addEventListener('change', (e) => {
        state.filters[panel][key.toLowerCase()] = e.target.value;
        renderTaskPanel(panel);
      });
    });
  }

  /** Fills the static priority and sort dropdowns from the config constants. */
  function populateStaticSelects() {
    ['tasks', 'completed'].forEach((panel) => {
      document.getElementById(`${panel}Priority`).innerHTML =
        '<option value="all">All priorities</option>' +
        Object.entries(PRIORITIES)
          .map(([value, p]) => `<option value="${value}">${p.label}</option>`).join('');

      document.getElementById(`${panel}Sort`).innerHTML =
        SORT_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
    });
  }

  function bindSettings() {
    document.getElementById('profileForm').addEventListener('submit', (e) => {
      e.preventDefault();
      state.settings.name = document.getElementById('settingsName').value.trim().slice(0, 32) || 'User';
      persistSettings();
      render();
      toast('Profile saved', 'success');
    });

    document.getElementById('defaultPriority').addEventListener('change', (e) => {
      state.settings.defaultPriority = e.target.value;
      persistSettings();
      toast('Default priority updated', 'success');
    });

    document.getElementById('confirmDeleteToggle').addEventListener('change', (e) => {
      state.settings.confirmDelete = e.target.checked;
      persistSettings();
      toast(e.target.checked ? 'You will be asked before deleting' : 'Deletes will happen immediately', 'info');
    });

    document.getElementById('darkModeToggle').addEventListener('change', (e) => {
      applyTheme(e.target.checked ? 'dark' : 'light');
      render();
    });

    document.getElementById('exportBtn').addEventListener('click', exportData);

    document.getElementById('importFile').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) importData(file);
      e.target.value = '';
    });

    document.getElementById('resetSamplesBtn').addEventListener('click', () => {
      askConfirm({
        title: 'Restore sample tasks?',
        message: 'Your current tasks will be replaced with the starter examples.',
        confirmLabel: 'Restore',
        onConfirm: () => {
          state.tasks = buildSampleTasks();
          persistTasks();
          render();
          toast('Sample tasks restored', 'success');
        }
      });
    });

    document.getElementById('clearAllBtn').addEventListener('click', () => {
      askConfirm({
        title: 'Clear all data?',
        message: 'All tasks and categories will be permanently removed from this browser. This cannot be undone.',
        confirmLabel: 'Clear everything',
        onConfirm: () => {
          state.tasks = [];
          state.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
          state.settings = { ...DEFAULT_SETTINGS };
          persistTasks();
          persistCategories();
          persistSettings();
          applyTheme(state.settings.theme);
          render();
          toast('All data cleared', 'info');
        }
      });
    });
  }

  function bindEvents() {
    // Mobile navigation
    document.getElementById('menuBtn').addEventListener('click', () => {
      setSidebar(!document.getElementById('app').classList.contains('sidebar-open'));
    });
    document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

    // Top bar
    document.getElementById('globalSearchToggle').addEventListener('click', (e) => {
      const topbar = e.currentTarget.closest('.topbar');
      const isOpen = topbar.classList.toggle('search-open');
      e.currentTarget.setAttribute('aria-expanded', String(isOpen));
      e.currentTarget.setAttribute('aria-label', isOpen ? 'Close search' : 'Open search');
      if (isOpen) document.getElementById('globalSearch').focus();
    });
    document.getElementById('themeToggle').addEventListener('click', () => {
      applyTheme(state.settings.theme === 'dark' ? 'light' : 'dark');
      render();
    });
    document.getElementById('addTaskBtn').addEventListener('click', () => openTaskModal());

    document.getElementById('globalSearch').addEventListener('input', (e) => {
      state.filters.tasks.search = e.target.value;
      if (state.route === 'tasks') renderTaskPanel('tasks');
      else navigate('tasks');
    });

    // Forms
    document.getElementById('taskForm').addEventListener('submit', handleTaskSubmit);
    document.getElementById('categoryForm').addEventListener('submit', handleCategorySubmit);
    document.getElementById('swatches').addEventListener('click', (e) => {
      const btn = e.target.closest('.swatch');
      if (!btn) return;
      state.selectedColor = btn.dataset.color;
      renderSwatches();
    });

    // Confirm modal
    document.getElementById('confirmOk').addEventListener('click', () => {
      const action = state.pendingAction;
      state.pendingAction = null;
      closeBackdrop(document.getElementById('confirmModal'));
      action?.();
    });

    // Task & completed panels
    bindPanel('tasks');
    bindPanel('completed');
    document.getElementById('tasksStatus').addEventListener('change', (e) => {
      state.filters.tasks.status = e.target.value;
      renderTaskPanel('tasks');
    });
    document.getElementById('clearCompletedBtn').addEventListener('click', () => {
      const ids = state.tasks.filter((t) => t.completed).map((t) => t.id);
      if (!ids.length) return;
      requestDelete({
        ids,
        title: 'Clear completed tasks?',
        message: `${ids.length} completed ${ids.length === 1 ? 'task' : 'tasks'} will be removed permanently.`,
        force: true
      });
    });

    // Calendar navigation
    document.getElementById('calPrev').addEventListener('click', () => shiftMonth(-1));
    document.getElementById('calNext').addEventListener('click', () => shiftMonth(1));
    document.getElementById('calToday').addEventListener('click', goToToday);

    // Settings
    bindSettings();

    // Global delegation, keyboard, live validation, and routing
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('input', (e) => {
      if (e.target.classList?.contains('invalid')) clearFieldError(e.target);
    });
    window.addEventListener('hashchange', applyRoute);
  }

  function init() {
    loadData();

    if (window.Chart) {
      window.Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    }

    const now = new Date();
    state.calendar = { year: now.getFullYear(), month: now.getMonth() };
    state.lastDay = todayISO();

    applyTheme(state.settings.theme);
    populateStaticSelects();
    bindEvents();

    tickClock();
    setInterval(tickClock, 1000);

    applyRoute();
    refreshIcons();
  }

  // The script is loaded with `defer`, so the DOM is ready. Guard just in case.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
