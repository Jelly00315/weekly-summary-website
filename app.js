const app = document.querySelector('#app');
const SETTINGS_KEY = 'je-week-summary-settings-v2';
const WEEK_PREFIX = 'week-notes:';
const LOCAL_FONT_PREFIX = 'je-week-local-font:';
const LOCAL_CSS_PREFIX = 'je-week-local-css:';
const SUPABASE_URL = 'https://zfzwdmcrqiylxjuycpmp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NbhL62YORIdN-hJawvsj2w_meoP2iPq';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let cloudState = null;
let currentUser = null;
let saveTimer = null;
let activeShare = null;
let deferredInstallPrompt = null;
let offlinePendingSync = false;

const OFFLINE_DB = 'je-week-summary-offline';
const OFFLINE_STORE = 'notebooks';

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(OFFLINE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadOfflineNotebook(userId) {
  const database = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const request = database.transaction(OFFLINE_STORE).objectStore(OFFLINE_STORE).get(userId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

async function saveOfflineNotebook() {
  if (!currentUser || !cloudState) return;
  const database = await openOfflineDb();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(OFFLINE_STORE, 'readwrite');
    transaction.objectStore(OFFLINE_STORE).put({ content: JSON.parse(JSON.stringify(cloudState)), pendingSync: offlinePendingSync }, currentUser.id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function deleteOfflineNotebook(userId) {
  const database = await openOfflineDb();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(OFFLINE_STORE, 'readwrite');
    transaction.objectStore(OFFLINE_STORE).delete(userId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, amount) => { const next = new Date(d); next.setDate(next.getDate() + amount); return next; };
const monday = d => { const next = new Date(d); next.setHours(0, 0, 0, 0); next.setDate(next.getDate() - ((next.getDay() + 6) % 7)); return next; };
const weekLabel = d => `${d.getMonth() + 1}.${d.getDate()} - ${addDays(d, 6).getMonth() + 1}.${addDays(d, 6).getDate()}`;
const escapeHtml = (value = '') => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function safeRichHtml(value = '') {
  const template = document.createElement('template');
  template.innerHTML = value;
  template.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(node => node.remove());
  template.content.querySelectorAll('*').forEach(node => [...node.attributes].forEach(attribute => {
    if (attribute.name.toLowerCase().startsWith('on') || /javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
  }));
  return template.innerHTML;
}

function defaultSettings() {
  const today = new Date();
  const year = today.getFullYear();
  const currentWeek = iso(monday(today));
  return {
    years: [year],
    background: '#f4f0e7',
    backgroundHistory: [],
    weekIndex: { [String(year)]: [currentWeek] },
    highlightedWeeks: [],
    fontName: 'Times New Roman',
    headline: 'Work, week by week.',
    intro: 'A working record of progress, results, questions, and the plan for the week ahead.',
    todoVisible: false,
    todos: []
  };
}

function normalizeTodoSettings(settings) {
  const statuses = new Set(['not-started', 'in-progress', 'waiting', 'done']);
  return {
    ...settings,
    todoVisible: Boolean(settings.todoVisible),
    todos: Array.isArray(settings.todos) ? settings.todos.filter(item => item && typeof item === 'object').map(item => ({
      id: /^[a-z0-9-]+$/i.test(item.id || '') ? item.id : uid(),
      title: String(item.title || '').slice(0, 120),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate || '') ? item.dueDate : '',
      intro: String(item.intro || '').slice(0, 300),
      status: statuses.has(item.status) ? item.status : 'not-started'
    })) : []
  };
}

function getSettings() {
  if (cloudState) {
    const settings = { ...defaultSettings(), ...(cloudState.settings || {}) };
    if (settings.headline === 'Research, week by week.') settings.headline = 'Work, week by week.';
    return normalizeTodoSettings(settings);
  }
  try {
    const settings = { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    if (settings.headline === 'Research, week by week.') settings.headline = 'Work, week by week.';
    return normalizeTodoSettings(settings);
  }
  catch { return defaultSettings(); }
}

function putSettings(settings) {
  if (cloudState) { cloudState.settings = settings; queueCloudSave(); }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { alert('This browser could not save that setting. Uploaded font files may be too large.'); }
}

function defaultBlocks() {
  return [
    { id: uid(), type: 'text', title: 'Note', html: '', color: '#20211e' }
  ];
}

function localUserKey(prefix) {
  return `${prefix}${currentUser ? currentUser.id : 'anonymous'}`;
}

function getLocalFont() {
  try { return JSON.parse(localStorage.getItem(localUserKey(LOCAL_FONT_PREFIX)) || 'null'); }
  catch { return null; }
}

function getLocalCss() {
  return localStorage.getItem(localUserKey(LOCAL_CSS_PREFIX)) || '';
}

function normalizeWeek(value) {
  const old = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  let blocks = [];

  if (Array.isArray(old.blocks)) {
    blocks = old.blocks.filter(block => block && typeof block === 'object').map(block => {
      const type = block.type === 'ink' ? 'ink' : 'text';
      const legacyTitle = ['Research notes', 'Work notes'].includes(block.title) ? 'Note' : block.title;
      const title = type === 'ink' && block.title === 'Handwritten notes' ? 'Handwritten Note' : legacyTitle;
      return {
        ...block,
        id: block.id || uid(),
        type,
        title: title || (type === 'ink' ? 'Handwritten Note' : 'Note'),
        color: block.color || (type === 'ink' ? '#24414a' : '#20211e'),
        ...(type === 'ink' ? {
          drawing: block.drawing || '',
          height: Math.min(1200, Math.max(150, Number(block.height) || 300)),
          paper: block.paper === 'lined' ? 'lined' : 'blank',
          lineSpacing: Math.min(80, Math.max(12, Number(block.lineSpacing) || 28)),
          penWidth: Math.min(5, Math.max(.1, Number(block.penWidth) || .5)),
          pressureSensitivity: Math.min(100, Math.max(0, Number.isFinite(Number(block.pressureSensitivity)) ? Number(block.pressureSensitivity) : 65))
        } : { html: block.html || '' })
      };
    });
  } else {
    if (old.body || old.privateBody) blocks.push({ id: uid(), type: 'text', title: 'Progress & results', html: old.privateBody || old.body, color: '#20211e' });
    if (old.publicBody) blocks.push({ id: uid(), type: 'text', title: 'Shared notes', html: old.publicBody, color: '#20211e' });
    if (old.drawing) blocks.push({ id: uid(), type: 'ink', title: 'Handwritten Note', drawing: old.drawing, color: '#24414a', height: 300, paper: 'blank', lineSpacing: 28, penWidth: .5, pressureSensitivity: 65 });
  }

  return { ...old, summary: typeof old.summary === 'string' ? old.summary : '', blocks: blocks.length ? blocks : defaultBlocks() };
}

function getWeek(date) {
  if (cloudState) return normalizeWeek(cloudState.weeks && cloudState.weeks[iso(date)]);
  try {
    return normalizeWeek(JSON.parse(localStorage.getItem(`${WEEK_PREFIX}${iso(date)}`) || '{}'));
  } catch { return { summary: '', blocks: defaultBlocks() }; }
}

function putWeek(date, value) {
  if (cloudState) { cloudState.weeks = cloudState.weeks || {}; cloudState.weeks[iso(date)] = value; queueCloudSave(); }
  try { localStorage.setItem(`${WEEK_PREFIX}${iso(date)}`, JSON.stringify(value)); }
  catch { alert('This week could not be saved. Try removing a large handwriting block.'); }
}

function collectLocalState() {
  const state = { settings: getSettings(), weeks: {} };
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(WEEK_PREFIX)) continue;
    try { state.weeks[key.slice(WEEK_PREFIX.length)] = normalizeWeek(JSON.parse(localStorage.getItem(key))); } catch { /* ignore invalid legacy data */ }
  }
  return state;
}

async function loadCloudState() {
  const { data, error } = await db.from('notebooks').select('content').eq('user_id', currentUser.id).maybeSingle();
  if (error) throw error;
  if (data && data.content) cloudState = data.content;
  else {
    cloudState = { settings: defaultSettings(), weeks: {} };
    const { error: insertError } = await db.from('notebooks').upsert({ user_id: currentUser.id, content: cloudState });
    if (insertError) throw insertError;
  }
  cloudState.settings = { ...defaultSettings(), ...(cloudState.settings || {}) };
  cloudState.weeks = cloudState.weeks || {};
  let migratedLegacyWeeks = false;
  if (cloudState.settings.fontData) {
    let movedFontLocally = false;
    try {
      localStorage.setItem(localUserKey(LOCAL_FONT_PREFIX), JSON.stringify({ name: 'Uploaded Work Font', data: cloudState.settings.fontData }));
      movedFontLocally = true;
    } catch { /* leave the cloud copy available until local storage has room */ }
    if (movedFontLocally) {
      delete cloudState.settings.fontData;
      cloudState.settings.fontName = 'Times New Roman';
      migratedLegacyWeeks = true;
    }
  }
  const migratedWeeks = {};
  Object.entries(cloudState.weeks).forEach(([key, week]) => {
    const date = new Date(`${key}T12:00:00`);
    const correctedKey = !Number.isNaN(date.getTime()) && date.getDay() === 0 ? iso(addDays(date, 1)) : key;
    if (correctedKey !== key) migratedLegacyWeeks = true;
    if (!Array.isArray(week && week.blocks)) migratedLegacyWeeks = true;
    migratedWeeks[correctedKey] = normalizeWeek(week);
  });
  cloudState.weeks = migratedWeeks;
  const correctedIndex = {};
  Object.entries(cloudState.settings.weekIndex || {}).forEach(([year, keys]) => {
    correctedIndex[year] = Array.isArray(keys) ? [...new Set(keys.map(key => {
      const date = new Date(`${key}T12:00:00`);
      if (!Number.isNaN(date.getTime()) && date.getDay() === 0) {
        migratedLegacyWeeks = true;
        return iso(addDays(date, 1));
      }
      return key;
    }))] : keys;
  });
  cloudState.settings.weekIndex = correctedIndex;
  cloudState.settings.highlightedWeeks = (cloudState.settings.highlightedWeeks || []).map(key => {
    const date = new Date(`${key}T12:00:00`);
    if (!Number.isNaN(date.getTime()) && date.getDay() === 0) {
      migratedLegacyWeeks = true;
      return iso(addDays(date, 1));
    }
    return key;
  });
  offlinePendingSync = false;
  saveOfflineNotebook().catch(() => {});
  if (migratedLegacyWeeks) queueCloudSave();
}

function queueCloudSave() {
  if (!cloudState || !currentUser) return;
  if (!navigator.onLine) offlinePendingSync = true;
  saveOfflineNotebook().catch(() => {});
  clearTimeout(saveTimer);
  const status = document.querySelector('#saveStatus');
  if (status) status.textContent = 'Saving...';
  saveTimer = setTimeout(async () => {
    if (!navigator.onLine) {
      const offlineStatus = document.querySelector('#saveStatus');
      if (offlineStatus) offlineStatus.textContent = 'Saved offline';
      return;
    }
    const { error } = await db.from('notebooks').upsert({ user_id: currentUser.id, content: cloudState, updated_at: new Date().toISOString() });
    offlinePendingSync = Boolean(error);
    saveOfflineNotebook().catch(() => {});
    const nextStatus = document.querySelector('#saveStatus');
    if (nextStatus) nextStatus.textContent = error ? 'Cloud save failed' : 'Saved to cloud';
  }, 550);
}

async function saveCloudNow() {
  if (!cloudState || !currentUser) return null;
  await saveOfflineNotebook().catch(() => {});
  clearTimeout(saveTimer);
  if (!navigator.onLine) {
    const offlineStatus = document.querySelector('#saveStatus');
    if (offlineStatus) offlineStatus.textContent = 'Saved offline';
    return null;
  }
  const status = document.querySelector('#saveStatus');
  if (status) status.textContent = 'Saving...';
  const { error } = await db.from('notebooks').upsert({ user_id: currentUser.id, content: cloudState, updated_at: new Date().toISOString() });
  offlinePendingSync = Boolean(error);
  saveOfflineNotebook().catch(() => {});
  const nextStatus = document.querySelector('#saveStatus');
  if (nextStatus) nextStatus.textContent = error ? 'Cloud save failed' : 'Saved to cloud';
  return error;
}

function showToast(message) {
  document.querySelector('.save-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'save-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 220);
  }, 1800);
}

function removeWeek(date) {
  if (cloudState && cloudState.weeks) { delete cloudState.weeks[iso(date)]; queueCloudSave(); }
  localStorage.removeItem(`${WEEK_PREFIX}${iso(date)}`);
}

function weeksIn(year) {
  const first = monday(new Date(year, 0, 4));
  const nextFirst = monday(new Date(year + 1, 0, 4));
  const result = [];
  for (let date = first; date < nextFirst; date = addDays(date, 7)) result.push(new Date(date));
  return result;
}

function weekYear(date) {
  return addDays(monday(date), 3).getFullYear();
}

function weekNumber(date) {
  const year = weekYear(date);
  const firstWeek = monday(new Date(year, 0, 4));
  return Math.round((monday(date) - firstWeek) / 604800000) + 1;
}

function listedWeeks(year) {
  const saved = getSettings().weekIndex && getSettings().weekIndex[String(year)];
  if (!Array.isArray(saved)) return weeksIn(year);
  return [...new Set(saved)].map(value => monday(new Date(`${value}T12:00:00`)))
    .filter(date => !Number.isNaN(date.getTime()) && weekYear(date) === year)
    .sort((a, b) => b - a);
}

function chapterNumber(year) {
  const years = [...new Set(getSettings().years)].sort((a, b) => a - b);
  return years.indexOf(year) + 1;
}

async function applyFont(settings) {
  const localFont = getLocalFont();
  let writingFont = settings.fontName;
  if (localFont && localFont.data) {
    try {
      const face = new FontFace(localFont.name, `url(${localFont.data})`);
      await face.load();
      document.fonts.add(face);
      writingFont = localFont.name;
    } catch { writingFont = settings.fontName; }
  }
  document.documentElement.style.setProperty('--paper', settings.background);
  document.documentElement.style.setProperty('--writing-font', `'${writingFont}', 'SimSun', '宋体', 'Times New Roman', serif`);
}

function renderHome() {
  document.querySelector('#localWeekStyle')?.remove();
  const settings = getSettings();
  applyFont(settings);
  const years = [...new Set(settings.years)].sort((a, b) => b - a);
  app.className = '';
  app.innerHTML = `
    <main class="book">
      <header class="masthead">
        <a class="wordmark" href="./">Je<span>Week</span>Summary</a>
        <span class="edition">Work weekly update</span>
        <div class="account-control"><span>${escapeHtml(currentUser?.email || '')}</span><label class="import-backup-button">Import backup<input class="import-backup-input" type="file" accept=".json,application/json"></label><button id="shareNotebook">Share</button><button id="logout">Log out</button><button id="deleteAccount" class="delete-account">Delete account</button></div>
        <div class="paper-control">
          <label>Paper <input id="backgroundColor" type="color" value="${settings.background}"></label>
          <div class="color-history" aria-label="Previous background colors">
            ${settings.backgroundHistory.map(color => `<span class="saved-color"><button class="color-chip" data-color="${color}" style="--chip:${color}" title="Use ${color}" aria-label="Use saved color ${color}"></button><button class="delete-color" data-delete-color="${color}" title="Delete saved color" aria-label="Delete saved color ${color}">×</button></span>`).join('')}
          </div>
        </div>
      </header>
      <section class="cover">
        <p class="kicker">Work weekly notebook / contents</p>
        <h1 contenteditable="true" id="headline">${settings.headline}</h1>
        <p class="intro" contenteditable="true" id="intro">${settings.intro}</p>
        <div class="year-actions"><button id="addYear" class="primary">+ Add year</button><button id="toggleTodos" class="todo-toggle">${settings.todoVisible ? 'Hide to-do list' : 'Show to-do list'}</button></div>
        ${settings.todoVisible ? renderTodoPanel(settings) : ''}
      </section>
      <section class="contents">
        ${years.map(year => renderYear(year)).join('')}
      </section>
    </main>`;

  document.querySelector('#headline').oninput = e => { const next = getSettings(); next.headline = e.currentTarget.innerHTML; putSettings(next); };
  document.querySelector('#intro').oninput = e => { const next = getSettings(); next.intro = e.currentTarget.innerHTML; putSettings(next); };
  document.querySelector('#backgroundColor').onchange = e => selectBackground(e.target.value);
  document.querySelectorAll('.color-chip').forEach(button => button.onclick = () => selectBackground(button.dataset.color));
  document.querySelectorAll('[data-delete-color]').forEach(button => button.onclick = () => deleteSavedColor(button.dataset.deleteColor));
  document.querySelector('#addYear').onclick = addYear;
  document.querySelector('#toggleTodos').onclick = toggleTodoPanel;
  document.querySelector('#logout').onclick = () => db.auth.signOut().then(() => location.href = './');
  document.querySelector('#deleteAccount').onclick = deleteAccount;
  document.querySelector('#shareNotebook').onclick = openShareDialog;
  document.querySelector('.import-backup-input').onchange = importWeekBackup;
  document.querySelectorAll('[data-delete-year]').forEach(button => button.onclick = () => deleteYear(Number(button.dataset.deleteYear)));
  document.querySelectorAll('[data-add-week]').forEach(button => button.onclick = () => addWeek(Number(button.dataset.addWeek)));
  document.querySelectorAll('[data-week-open]').forEach(button => button.onclick = () => { location.href = `?week=${button.dataset.weekOpen}`; });
  document.querySelectorAll('[data-remove-week]').forEach(button => button.onclick = () => deleteListedWeek(button.dataset.removeWeek));
  document.querySelectorAll('[data-highlight-week]').forEach(button => button.onclick = () => toggleWeekHighlight(button.dataset.highlightWeek));
  if (settings.todoVisible) bindTodoPanel();
}

const TODO_STATUS_LABELS = { 'not-started': 'Not started', 'in-progress': 'In progress', waiting: 'Waiting', done: 'Done' };

function renderTodoPanel(settings) {
  const today = iso(new Date());
  return `<section class="todo-panel" aria-labelledby="todoHeading">
    <header><div><p class="kicker">Current reminders</p><h2 id="todoHeading">To-do list</h2></div><span>${settings.todos.filter(item => item.status !== 'done').length} remaining</span></header>
    <form id="addTodo" class="todo-add-form">
      <label>Homework or project<input name="title" maxlength="120" required placeholder="What needs to be done?"></label>
      <label>Due date<input name="dueDate" type="date" required></label>
      <label>Brief introduction<textarea name="intro" maxlength="300" rows="2" placeholder="A short reminder or next step"></textarea></label>
      <label>Progress<select name="status">${Object.entries(TODO_STATUS_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <button class="primary" type="submit">+ Add task</button>
    </form>
    <div class="todo-list">${settings.todos.length ? settings.todos.map(item => {
      const timing = item.status !== 'done' && item.dueDate && item.dueDate < today ? ' overdue' : item.status !== 'done' && item.dueDate === today ? ' due-today' : '';
      return `<article class="todo-item status-${item.status}${timing}" data-todo-id="${item.id}">
        <input class="todo-title" data-todo-field="title" maxlength="120" value="${escapeHtml(item.title)}" aria-label="Task title">
        <input data-todo-field="dueDate" type="date" value="${item.dueDate}" aria-label="Due date">
        <textarea data-todo-field="intro" maxlength="300" rows="2" aria-label="Brief introduction">${escapeHtml(item.intro)}</textarea>
        <select data-todo-field="status" aria-label="Progress status">${Object.entries(TODO_STATUS_LABELS).map(([value, label]) => `<option value="${value}"${item.status === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <button type="button" class="delete-todo" aria-label="Delete ${escapeHtml(item.title || 'task')}">Delete</button>
      </article>`;
    }).join('') : '<p class="todo-empty">No reminders yet. Add a homework item or project above.</p>'}</div>
  </section>`;
}

function toggleTodoPanel() {
  const settings = getSettings();
  settings.todoVisible = !settings.todoVisible;
  putSettings(settings);
  renderHome();
}

function bindTodoPanel() {
  document.querySelector('#addTodo').onsubmit = event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') || '').trim();
    if (!title) return alert('Please enter a homework or project name.');
    const settings = getSettings();
    settings.todos.push({ id: uid(), title, dueDate: String(form.get('dueDate') || ''), intro: String(form.get('intro') || '').trim(), status: String(form.get('status') || 'not-started') });
    putSettings(settings);
    renderHome();
  };
  document.querySelectorAll('[data-todo-field]').forEach(control => control.onchange = () => {
    const itemElement = control.closest('[data-todo-id]');
    const settings = getSettings();
    const item = settings.todos.find(todo => todo.id === itemElement.dataset.todoId);
    if (!item) return;
    item[control.dataset.todoField] = control.value;
    putSettings(settings);
    renderHome();
  });
  document.querySelectorAll('.delete-todo').forEach(button => button.onclick = () => {
    const itemId = button.closest('[data-todo-id]').dataset.todoId;
    const settings = getSettings();
    const item = settings.todos.find(todo => todo.id === itemId);
    if (!item || !confirm(`Delete “${item.title || 'this task'}”? This cannot be undone.`)) return;
    settings.todos = settings.todos.filter(todo => todo.id !== itemId);
    putSettings(settings);
    renderHome();
  });
}

function renderYear(year) {
  const entries = listedWeeks(year);
  const highlighted = new Set(getSettings().highlightedWeeks || []);
  const written = entries.filter(date => { const week = getWeek(date); return week.summary || (week.blocks || []).some(block => block.html || block.drawing); }).length;
  return `
    <section class="year-chapter">
      <header>
        <span class="chapter-number">CHAPTER ${String(chapterNumber(year)).padStart(2, '0')}</span>
        <h2>${year}</h2>
        <span class="year-count">${written} written weeks</span>
        <button class="add-week" data-add-week="${year}" aria-label="Add a week to ${year}">+ Add week</button>
        <button class="delete-year" data-delete-year="${year}" aria-label="Delete ${year}">- Remove year</button>
      </header>
      <div class="chapters">
        ${entries.map((date, index) => {
          const week = getWeek(date);
          const key = iso(date);
          const isHighlighted = highlighted.has(key);
          return `<div class="chapter${isHighlighted ? ' highlighted' : ''}"><span class="chapter-no">W${String(weekNumber(date)).padStart(2, '0')}</span><button class="chapter-main" data-week-open="${key}"><span class="chapter-date">${weekLabel(date)}</span><span class="chapter-summary">${escapeHtml(week.summary || 'Untitled work week')}</span><span class="arrow">Open</span></button><button class="highlight-week" data-highlight-week="${key}" aria-pressed="${isHighlighted}" title="${isHighlighted ? 'Remove highlight' : 'Highlight important week'}">${isHighlighted ? 'Important' : 'Highlight'}</button><button class="remove-week" data-remove-week="${key}" aria-label="Remove week ${weekLabel(date)}">-</button></div>`;
        }).join('')}
      </div>
    </section>`;
}

function selectBackground(color) {
  const settings = getSettings();
  if (settings.background !== color) settings.backgroundHistory = [settings.background, ...settings.backgroundHistory.filter(item => item !== settings.background && item !== color)].slice(0, 3);
  settings.background = color;
  putSettings(settings);
  renderHome();
}

function deleteSavedColor(color) {
  const settings = getSettings();
  settings.backgroundHistory = settings.backgroundHistory.filter(item => item !== color);
  putSettings(settings);
  renderHome();
}

async function deleteAccount() {
  const deletedUserId = currentUser.id;
  const answer = prompt(`Permanently delete ${currentUser.email || 'this account'} and all of its weeks?\n\nType DELETE to confirm.`);
  if (answer !== 'DELETE') {
    if (answer !== null) alert('Account deletion was cancelled. You must type DELETE exactly.');
    return;
  }

  const button = document.querySelector('#deleteAccount');
  if (button) { button.disabled = true; button.textContent = 'Deleting...'; }
  clearTimeout(saveTimer);
  const { error } = await db.rpc('delete_own_account');
  if (error) {
    if (button) { button.disabled = false; button.textContent = 'Delete account'; }
    alert(`The account could not be deleted: ${error.message}`);
    return;
  }

  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(localUserKey(LOCAL_FONT_PREFIX));
  localStorage.removeItem(localUserKey(LOCAL_CSS_PREFIX));
  [...Array(localStorage.length)].map((_, index) => localStorage.key(index))
    .filter(key => key && key.startsWith(WEEK_PREFIX))
    .forEach(key => localStorage.removeItem(key));
  await db.auth.signOut();
  await deleteOfflineNotebook(deletedUserId).catch(() => {});
  location.href = './';
}

function addYear() {
  const settings = getSettings();
  const suggested = Math.max(...settings.years) + 1;
  const answer = prompt('Enter the year to add:', String(suggested));
  if (answer === null) return;
  const year = Number(answer);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return alert('Please enter a year between 1900 and 2200.');
  if (settings.years.includes(year)) return alert(`${year} is already in your notebook.`);
  settings.years.push(year);
  settings.weekIndex = { ...(settings.weekIndex || {}), [String(year)]: [] };
  putSettings(settings);
  renderHome();
}

function addWeek(year) {
  const existing = listedWeeks(year);
  const currentWeek = monday(new Date());
  const suggested = existing.length
    ? addDays(existing[0], 7)
    : year === weekYear(currentWeek) ? currentWeek : weeksIn(year)[0];
  const answer = prompt(`Enter any date in the week you want to add to ${year} (YYYY-MM-DD):`, iso(suggested));
  if (answer === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(answer)) return alert('Please enter the date as YYYY-MM-DD.');
  const requested = new Date(`${answer}T12:00:00`);
  const [inputYear, inputMonth, inputDay] = answer.split('-').map(Number);
  if (Number.isNaN(requested.getTime()) || requested.getFullYear() !== inputYear || requested.getMonth() + 1 !== inputMonth || requested.getDate() !== inputDay) return alert('That date is not valid.');
  const date = monday(requested);
  if (weekYear(date) !== year) return alert(`That week belongs to the ${weekYear(date)} weekly calendar. Please add it under ${weekYear(date)}.`);
  const key = iso(date);
  const settings = getSettings();
  const weeks = listedWeeks(year).map(iso);
  if (weeks.includes(key)) return alert(`${weekLabel(date)} already exists in ${year}.`);
  settings.weekIndex = { ...(settings.weekIndex || {}), [String(year)]: [...weeks, key].sort().reverse() };
  putSettings(settings);
  renderHome();
}

async function deleteListedWeek(key) {
  const date = monday(new Date(`${key}T12:00:00`));
  if (!confirm(`Remove ${weekLabel(date)} and delete all of its notes? This cannot be undone.`)) return;
  const previousState = cloudState ? JSON.parse(JSON.stringify(cloudState)) : null;
  const year = weekYear(date);
  const settings = getSettings();
  settings.weekIndex = { ...(settings.weekIndex || {}), [String(year)]: listedWeeks(year).map(iso).filter(value => value !== key) };
  settings.highlightedWeeks = (settings.highlightedWeeks || []).filter(value => value !== key);
  if (cloudState) {
    cloudState.settings = settings;
    delete cloudState.weeks[key];
    const error = await saveCloudNow();
    if (error) {
      cloudState = previousState;
      alert(`The week was not deleted because the cloud save failed: ${error.message}`);
      renderHome();
      return;
    }
  }
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* cloud copy is authoritative */ }
  localStorage.removeItem(`${WEEK_PREFIX}${key}`);
  renderHome();
}

function toggleWeekHighlight(key) {
  const settings = getSettings();
  const highlighted = new Set(settings.highlightedWeeks || []);
  if (highlighted.has(key)) highlighted.delete(key); else highlighted.add(key);
  settings.highlightedWeeks = [...highlighted];
  putSettings(settings);
  renderHome();
}

function deleteYear(year) {
  if (!confirm(`Delete ${year} and every saved week inside it? This cannot be undone.`)) return;
  listedWeeks(year).forEach(removeWeek);
  const settings = getSettings();
  settings.years = settings.years.filter(item => item !== year);
  settings.weekIndex = { ...(settings.weekIndex || {}) };
  delete settings.weekIndex[String(year)];
  settings.highlightedWeeks = (settings.highlightedWeeks || []).filter(key => weekYear(new Date(`${key}T12:00:00`)) !== year);
  if (!settings.years.length) {
    const defaults = defaultSettings();
    settings.years = defaults.years;
    settings.weekIndex = defaults.weekIndex;
  }
  putSettings(settings);
  renderHome();
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(value) {
  return String(value || 'note').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'note';
}

function htmlToMarkdown(html) {
  const template = document.createElement('template');
  template.innerHTML = safeRichHtml(html);
  const convert = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/([\\`*_{}\[\]])/g, '\\$1');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const content = [...node.childNodes].map(convert).join('');
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'b' || tag === 'strong') return `**${content}**`;
    if (tag === 'i' || tag === 'em') return `*${content}*`;
    if (tag === 'li') return `- ${content.trim()}\n`;
    if (tag === 'p' || tag === 'div') return `${content.trim()}\n\n`;
    if (tag === 'ul' || tag === 'ol') return `${content}\n`;
    return content;
  };
  return [...template.content.childNodes].map(convert).join('').replace(/\n{3,}/g, '\n\n').trim();
}

function downloadWeekBackup(date, week) {
  const backup = { format: 'JeWeekSummary-week', version: 1, exportedAt: new Date().toISOString(), weekStart: iso(date), week };
  downloadFile(`JeWeekSummary-${iso(date)}.json`, JSON.stringify(backup, null, 2), 'application/json');
}

function sanitizeImportedWeek(value) {
  const week = normalizeWeek(value);
  return {
    summary: String(week.summary || '').slice(0, 180),
    blocks: week.blocks.slice(0, 100).map(block => {
      const color = /^#[0-9a-f]{6}$/i.test(block.color || '') ? block.color : (block.type === 'ink' ? '#24414a' : '#20211e');
      if (block.type === 'ink') return {
        id: uid(), type: 'ink', title: String(block.title || 'Handwritten Note').slice(0, 200), color,
        drawing: /^data:image\/png;base64,/i.test(block.drawing || '') ? block.drawing : '',
        drawingWidth: Number(block.drawingWidth) || undefined, drawingHeight: Number(block.drawingHeight) || undefined,
        height: inkHeight(block), paper: block.paper === 'lined' ? 'lined' : 'blank',
        lineSpacing: inkLineSpacing(block), penWidth: inkPenWidth(block), pressureSensitivity: inkPressureSensitivity(block)
      };
      return { id: uid(), type: 'text', title: String(block.title || 'Note').slice(0, 200), color, html: safeRichHtml(block.html || '') };
    })
  };
}

async function importWeekBackup(event) {
  const input = event.currentTarget;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) return alert('That backup is larger than 50 MB and cannot be imported.');

  let backup;
  try { backup = JSON.parse(await file.text()); }
  catch { return alert('This is not a valid JSON backup file.'); }
  if (!backup || backup.format !== 'JeWeekSummary-week' || backup.version !== 1 || !backup.week) {
    return alert('This file is not a supported JeWeekSummary week backup.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(backup.weekStart || '')) return alert('The backup does not contain a valid week date.');
  const parsedDate = new Date(`${backup.weekStart}T12:00:00`);
  if (Number.isNaN(parsedDate.getTime()) || iso(parsedDate) !== backup.weekStart) return alert('The backup week date is invalid.');
  const date = monday(parsedDate);
  const key = iso(date);
  if (cloudState?.weeks?.[key] && !confirm(`${weekLabel(date)} already has saved content. Replace it with this backup?`)) return;

  const importedWeek = sanitizeImportedWeek(backup.week);
  const year = weekYear(date);
  const settings = getSettings();
  if (!settings.years.includes(year)) settings.years.push(year);
  const existingKeys = Array.isArray(settings.weekIndex?.[String(year)]) ? settings.weekIndex[String(year)] : [];
  settings.weekIndex = { ...(settings.weekIndex || {}), [String(year)]: [...new Set([...existingKeys, key])].sort().reverse() };
  putSettings(settings);
  putWeek(date, importedWeek);
  const error = await saveCloudNow();
  if (error) alert(`The week was restored locally, but cloud synchronization failed: ${error.message}`);
  else showToast('Backup imported.');
  location.href = `?week=${key}`;
}

function printWeek(date) {
  const previousTitle = document.title;
  document.title = `JeWeekSummary-${iso(date)}`;
  window.addEventListener('afterprint', () => { document.title = previousTitle; }, { once: true });
  window.print();
}

function renderWeek(date) {
  const settings = getSettings();
  const localFont = getLocalFont();
  const week = getWeek(date);
  applyFont(settings);
  app.className = '';
  app.innerHTML = `
    <main class="notebook">
      <header class="notebook-nav">
        <a href="./" class="back">&#8592; Contents</a>
        <a class="wordmark small" href="./">Je<span>Week</span>Summary</a>
        <span id="saveStatus">Saved to cloud</span>
      </header>
      <section class="week-heading">
        <p class="kicker">Weekly update / ${date.getFullYear()}</p>
        <h1>${weekLabel(date)}</h1>
        <input id="weekSummary" maxlength="180" value="${escapeHtml(week.summary)}" placeholder="One-sentence finding or focus for this week">
      </section>
      <section id="blocks" class="blocks">${week.blocks.map((block, index) => renderBlock(block, settings, index, week.blocks.length)).join('')}</section>
      <section class="add-block">
        <button id="showBlockChoices" class="add-block-button">+ Add block</button>
        <div id="blockChoices" class="block-choices" hidden>
          <button data-add-type="text">Typing block</button>
          <button data-add-type="ink">Handwriting block</button>
        </div>
      </section>
      <footer class="notebook-footer">
        <label class="font-upload">Writing font
          <span>${escapeHtml(localFont?.name || settings.fontName)}</span>
          <input id="fontUpload" type="file" accept=".ttf,.otf,.woff,.woff2,font/*">
        </label>
        <label class="font-upload">Week page CSS
          <span>${getLocalCss() ? 'Local style active' : 'No local style'}</span>
          <input id="cssUpload" type="file" accept=".css,text/css">
        </label>
        <button id="clearCustomCss" class="danger" ${getLocalCss() ? '' : 'disabled'}>Clear CSS</button>
        <button id="downloadPdf" class="export-button">Download PDF</button>
        <button id="downloadBackup" class="export-button">Editable backup</button>
        <label class="export-button import-backup-button">Import backup<input class="import-backup-input" type="file" accept=".json,application/json"></label>
        <button id="deleteWeek" class="danger">Delete week</button>
        <button id="saveWeek" class="primary">Save update</button>
      </footer>
    </main>`;
  document.querySelector('#localWeekStyle')?.remove();
  const customStyle = document.createElement('style');
  customStyle.id = 'localWeekStyle';
  customStyle.textContent = getLocalCss();
  document.head.appendChild(customStyle);
  bindWeek(date, week);
}

function fontOptions(settings) {
  const localFont = getLocalFont();
  const fonts = [
    { value: localFont?.name, label: localFont?.name },
    { value: settings.fontName, label: settings.fontName },
    { value: 'Times New Roman', label: 'Times New Roman' },
    { value: 'SimSun', label: '宋体 (SimSun)' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Courier New', label: 'Courier New' }
  ];
  const seen = new Set();
  return fonts.filter(font => font.value && !seen.has(font.value) && seen.add(font.value))
    .map(font => `<option value="${escapeHtml(font.value)}">${escapeHtml(font.label)}</option>`).join('');
}

function inkHeight(block) {
  return Math.min(1200, Math.max(150, Number(block.height) || 300));
}

function inkLineSpacing(block) {
  return Math.min(80, Math.max(12, Number(block.lineSpacing) || 28));
}

function inkPenWidth(block) {
  return Math.min(5, Math.max(.1, Number(block.penWidth) || .5));
}

function inkPressureSensitivity(block) {
  const value = Number(block.pressureSensitivity);
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 65));
}

const LATEX_SYMBOLS = Object.freeze({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  pm: '±', times: '×', div: '÷', cdot: '·', sum: '∑', prod: '∏', int: '∫', sqrt: '√', infty: '∞',
  approx: '≈', neq: '≠', leq: '≤', geq: '≥', equiv: '≡', propto: '∝', partial: '∂', nabla: '∇',
  in: '∈', notin: '∉', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩',
  leftarrow: '←', rightarrow: '→', leftrightarrow: '↔', Leftarrow: '⇐', Rightarrow: '⇒', Leftrightarrow: '⇔',
  degree: '°', ell: 'ℓ', hbar: 'ℏ', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨'
});

const SUPERSCRIPT_SYMBOLS = Object.freeze({ '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' });
const SUBSCRIPT_SYMBOLS = Object.freeze({ '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', x: 'ₓ' });

function scriptSymbols(value, symbols) {
  const converted = [...value].map(character => symbols[character]);
  return converted.every(Boolean) ? converted.join('') : null;
}

function replaceLatexAtCaret(editor, afterDelimiter = false) {
  const selection = window.getSelection();
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || range.startContainer.nodeType !== Node.TEXT_NODE) return false;
  const textNode = range.startContainer;
  const beforeCaret = textNode.data.slice(0, range.startOffset);
  const delimiterMatch = afterDelimiter ? beforeCaret.match(/(\s)$/) : null;
  if (afterDelimiter && !delimiterMatch) return false;
  const delimiter = delimiterMatch ? delimiterMatch[1] : '';
  const expression = delimiter ? beforeCaret.slice(0, -delimiter.length) : beforeCaret;
  let match = expression.match(/\\sqrt\{([^{}]+)\}$/);
  let replacement;

  if (match) {
    const command = match[1].match(/^\\([A-Za-z]+)$/);
    const radicand = command && LATEX_SYMBOLS[command[1]] ? LATEX_SYMBOLS[command[1]] : match[1];
    replacement = radicand.length === 1 ? `√${radicand}` : `√(${radicand})`;
  } else {
    match = expression.match(/\^(?:\{([0-9+\-=()ni]+)\}|([0-9+\-=()ni]))$/);
    if (match) replacement = scriptSymbols(match[1] || match[2], SUPERSCRIPT_SYMBOLS);
  }
  if (!replacement) {
    match = expression.match(/_(?:\{([0-9+\-=()aehijklmnoprstx]+)\}|([0-9+\-=()aehijklmnoprstx]))$/);
    if (match) replacement = scriptSymbols(match[1] || match[2], SUBSCRIPT_SYMBOLS);
  }
  if (!replacement) {
    match = expression.match(/\\([A-Za-z]+)$/);
    if (match) replacement = LATEX_SYMBOLS[match[1]];
  }
  if (!match || !replacement) return false;
  replacement += delimiter;
  const matchedLength = match[0].length + delimiter.length;
  const replacementStart = range.startOffset - matchedLength;
  textNode.replaceData(replacementStart, matchedLength, replacement);
  range.setStart(textNode, replacementStart + replacement.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function renderBlock(block, settings, index, total) {
  const orderControls = `<div class="block-order"><label>Block <input class="block-position" type="number" min="1" max="${total}" value="${index + 1}" aria-label="Block position"></label><button type="button" class="move-block-up" ${index === 0 ? 'disabled' : ''}>Up</button><button type="button" class="move-block-down" ${index === total - 1 ? 'disabled' : ''}>Down</button></div>`;
  if (block.type === 'ink') return `
    <article class="note-block ink-block" data-block="${block.id}">
      <header class="block-header">
        ${orderControls}
        <input class="block-title" value="${escapeHtml(block.title || 'Handwritten Note')}" aria-label="Block title">
        <div class="block-tools"><label>Ink <input class="block-color" type="color" value="${block.color || '#24414a'}"></label><label>Pen mm <input class="pen-width" type="number" min="0.1" max="5" step="0.1" value="${inkPenWidth(block)}"></label><label class="pressure-control">Sensitivity <input class="pressure-sensitivity" type="range" min="0" max="100" step="5" value="${inkPressureSensitivity(block)}"><output>${inkPressureSensitivity(block)}%</output></label><label>Height <input class="canvas-height" type="number" min="150" max="1200" step="25" value="${inkHeight(block)}"></label><label>Paper <select class="paper-style"><option value="blank"${block.paper !== 'lined' ? ' selected' : ''}>Blank</option><option value="lined"${block.paper === 'lined' ? ' selected' : ''}>Horizontal lines</option></select></label><label>Line gap <input class="line-spacing" type="number" min="12" max="80" value="${inkLineSpacing(block)}" ${block.paper === 'lined' ? '' : 'disabled'}></label><button class="eraser-toggle" aria-pressed="false">Eraser</button><button class="clear-ink">Clear</button><button class="remove-block">Delete</button></div>
      </header>
      <canvas class="ink-canvas${block.paper === 'lined' ? ' lined' : ''}" style="height:${inkHeight(block)}px;--line-spacing:${inkLineSpacing(block)}px"></canvas>
      <p class="ink-tip">Pen width and pressure sensitivity apply to new strokes. Select Eraser to remove individual strokes.</p>
    </article>`;
  return `
    <article class="note-block text-block" data-block="${block.id}">
      <header class="block-header">
        ${orderControls}
        <input class="block-title" value="${escapeHtml(block.title || 'Note')}" aria-label="Block title">
        <div class="block-tools"><button class="download-markdown">Download .md</button><button class="remove-block">Delete</button></div>
      </header>
      <div class="toolbar">
        <button type="button" data-command="bold" aria-pressed="false"><b>B</b></button>
        <button type="button" data-command="italic" aria-pressed="false"><i>I</i></button>
        <button type="button" data-command="hiliteColor" aria-pressed="false">Highlight</button>
        <button type="button" data-command="insertUnorderedList" aria-pressed="false">List</button>
        <span class="latex-hint" title="Complete notation with Space, Enter, or Tab">Math: \\mu · R^2 · \\sqrt{R} + Space</span>
        <select class="font-select" aria-label="Font">${fontOptions(settings)}</select>
        <label class="font-size-control">Size <input class="font-size-input" type="number" min="6" max="144" value="17" aria-label="Font size in pixels"><button class="apply-font-size" type="button">Set</button></label>
        <label>Text <input class="block-color" type="color" value="${block.color || '#20211e'}"></label>
      </div>
      <div class="text-editor" contenteditable="true" style="color:${block.color || '#20211e'}" data-placeholder="Type your work update here...">${block.html || ''}</div>
    </article>`;
}

function bindWeek(date, week) {
  const persist = () => { putWeek(date, week); const status = document.querySelector('#saveStatus'); if (status) status.textContent = 'Saved just now'; };
  document.querySelector('#weekSummary').oninput = e => { week.summary = e.target.value; persist(); };
  document.querySelector('#saveWeek').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    putWeek(date, week);
    const error = await saveCloudNow();
    button.disabled = false;
    if (error) return alert(`The update could not be saved: ${error.message}`);
    showToast('Saved.');
  };
  document.querySelector('#showBlockChoices').onclick = () => { const choices = document.querySelector('#blockChoices'); choices.hidden = !choices.hidden; };
  document.querySelectorAll('[data-add-type]').forEach(button => button.onclick = () => {
    week.blocks.push(button.dataset.addType === 'ink'
      ? { id: uid(), type: 'ink', title: 'Handwritten Note', drawing: '', color: '#24414a', height: 300, paper: 'blank', lineSpacing: 28, penWidth: .5, pressureSensitivity: 65 }
      : { id: uid(), type: 'text', title: 'Note', html: '', color: '#20211e' });
    putWeek(date, week);
    renderWeek(date);
  });
  document.querySelector('#deleteWeek').onclick = () => deleteListedWeek(iso(date));
  document.querySelector('#downloadPdf').onclick = () => printWeek(date);
  document.querySelector('#downloadBackup').onclick = () => downloadWeekBackup(date, week);
  document.querySelector('.import-backup-input').onchange = importWeekBackup;
  document.querySelector('#fontUpload').onchange = event => uploadFont(event, date);
  document.querySelector('#cssUpload').onchange = event => uploadWeekCss(event, date);
  document.querySelector('#clearCustomCss').onclick = () => {
    localStorage.removeItem(localUserKey(LOCAL_CSS_PREFIX));
    document.querySelector('#localWeekStyle')?.remove();
    renderWeek(date);
  };
  document.querySelectorAll('.note-block').forEach(element => bindBlock(element, week, persist, date));
}

function moveBlock(week, blockId, requestedPosition, persist, date) {
  const currentIndex = week.blocks.findIndex(block => block.id === blockId);
  if (currentIndex < 0) return;
  const targetIndex = Math.min(week.blocks.length - 1, Math.max(0, requestedPosition - 1));
  if (currentIndex === targetIndex) return renderWeek(date);
  const [movedBlock] = week.blocks.splice(currentIndex, 1);
  week.blocks.splice(targetIndex, 0, movedBlock);
  persist();
  renderWeek(date);
}

function bindBlock(element, week, persist, date) {
  const block = week.blocks.find(item => item.id === element.dataset.block);
  const currentIndex = () => week.blocks.findIndex(item => item.id === block.id);
  const positionInput = element.querySelector('.block-position');
  positionInput.onchange = () => moveBlock(week, block.id, Number(positionInput.value) || currentIndex() + 1, persist, date);
  positionInput.onkeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      positionInput.blur();
    }
  };
  element.querySelector('.move-block-up').onclick = () => moveBlock(week, block.id, currentIndex(), persist, date);
  element.querySelector('.move-block-down').onclick = () => moveBlock(week, block.id, currentIndex() + 2, persist, date);
  element.querySelector('.block-title').oninput = e => { block.title = e.target.value; persist(); };
  element.querySelector('.remove-block').onclick = () => {
    if (!confirm(`Delete “${block.title || 'this block'}”? This cannot be undone.`)) return;
    week.blocks = week.blocks.filter(item => item.id !== block.id);
    persist();
    renderWeek(date);
  };
  const color = element.querySelector('.block-color');
  color.oninput = e => {
    block.color = e.target.value;
    if (block.type === 'text') element.querySelector('.text-editor').style.color = block.color;
    persist();
  };
  if (block.type === 'ink') {
    const canvas = element.querySelector('canvas');
    const heightInput = element.querySelector('.canvas-height');
    const paperSelect = element.querySelector('.paper-style');
    const spacingInput = element.querySelector('.line-spacing');
    const penWidthInput = element.querySelector('.pen-width');
    const sensitivityInput = element.querySelector('.pressure-sensitivity');
    const sensitivityOutput = element.querySelector('.pressure-control output');
    penWidthInput.onchange = () => {
      block.penWidth = Math.min(5, Math.max(.1, Number(penWidthInput.value) || .5));
      penWidthInput.value = String(block.penWidth);
      persist();
    };
    sensitivityInput.oninput = () => {
      block.pressureSensitivity = Math.min(100, Math.max(0, Number(sensitivityInput.value) || 0));
      sensitivityOutput.value = `${block.pressureSensitivity}%`;
      persist();
    };
    heightInput.onchange = () => {
      block.height = Math.min(1200, Math.max(150, Number(heightInput.value) || 300));
      persist();
      renderWeek(date);
    };
    paperSelect.onchange = () => {
      block.paper = paperSelect.value === 'lined' ? 'lined' : 'blank';
      spacingInput.disabled = block.paper !== 'lined';
      canvas.classList.toggle('lined', block.paper === 'lined');
      persist();
    };
    spacingInput.onchange = () => {
      block.lineSpacing = Math.min(80, Math.max(12, Number(spacingInput.value) || 28));
      spacingInput.value = String(block.lineSpacing);
      canvas.style.setProperty('--line-spacing', `${block.lineSpacing}px`);
      persist();
    };
    let erasing = false;
    const eraserButton = element.querySelector('.eraser-toggle');
    eraserButton.onclick = () => {
      erasing = !erasing;
      eraserButton.classList.toggle('active', erasing);
      eraserButton.setAttribute('aria-pressed', String(erasing));
      canvas.classList.toggle('erasing', erasing);
    };
    setupCanvas(canvas, block, persist, () => erasing);
    element.querySelector('.clear-ink').onclick = () => {
      if (!confirm('Clear this handwriting block? This cannot be undone.')) return;
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      block.drawing = '';
      persist();
    };
    return;
  }
  element.querySelector('.download-markdown').onclick = () => {
    const title = block.title || 'Note';
    const markdown = `# ${title}\n\n${htmlToMarkdown(block.html || '')}\n`;
    downloadFile(`${iso(date)}-${safeFilename(title)}.md`, markdown, 'text/markdown;charset=utf-8');
  };
  const editor = element.querySelector('.text-editor');
  let savedRange = null;
  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) savedRange = selection.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    editor.focus();
    if (!savedRange) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
  };
  editor.oninput = () => {
    replaceLatexAtCaret(editor, true);
    block.html = editor.innerHTML;
    persist();
  };
  editor.addEventListener('keydown', event => {
    if ((event.key === ' ' || event.key === 'Enter' || event.key === 'Tab') && replaceLatexAtCaret(editor)) {
      block.html = editor.innerHTML;
      persist();
    }
  });
  editor.addEventListener('keyup', rememberSelection);
  editor.addEventListener('mouseup', rememberSelection);
  editor.addEventListener('touchend', () => setTimeout(rememberSelection));
  const rangeHasHighlight = range => {
    const isYellow = node => {
      if (!(node instanceof Element)) return false;
      const color = getComputedStyle(node).backgroundColor.replace(/\s/g, '');
      return color === 'rgb(255,240,154)' || color === 'rgba(255,240,154,1)';
    };
    let ancestor = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    while (ancestor && ancestor !== editor) {
      if (isYellow(ancestor)) return true;
      ancestor = ancestor.parentElement;
    }
    return [...editor.querySelectorAll('*')].some(node => {
      try { return range.intersectsNode(node) && isYellow(node); } catch { return false; }
    });
  };
  element.querySelectorAll('[data-command]').forEach(button => {
    button.onpointerdown = rememberSelection;
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => {
      restoreSelection();
      const command = button.dataset.command;
      let active;
      if (command === 'hiliteColor') {
        const selection = window.getSelection();
        active = selection.rangeCount ? rangeHasHighlight(selection.getRangeAt(0)) : false;
        document.execCommand('hiliteColor', false, active ? 'transparent' : '#fff09a');
        active = !active;
      } else {
        document.execCommand(command, false, null);
        active = document.queryCommandState(command);
      }
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      block.html = editor.innerHTML;
      rememberSelection();
      persist();
    };
  });
  const fontSelect = element.querySelector('.font-select');
  fontSelect.onmousedown = rememberSelection;
  fontSelect.onchange = event => {
    restoreSelection();
    document.execCommand('fontName', false, event.target.value);
    block.html = editor.innerHTML;
    rememberSelection();
    persist();
  };
  const sizeInput = element.querySelector('.font-size-input');
  const sizeButton = element.querySelector('.apply-font-size');
  sizeInput.onpointerdown = rememberSelection;
  sizeButton.onmousedown = event => event.preventDefault();
  sizeButton.onclick = () => {
    const size = Math.min(144, Math.max(6, Number(sizeInput.value) || 17));
    sizeInput.value = String(size);
    restoreSelection();
    const existingLargeFonts = [...editor.querySelectorAll('font[size="7"]')];
    existingLargeFonts.forEach(node => node.dataset.existingSizeSeven = 'true');
    document.execCommand('fontSize', false, '7');
    editor.querySelectorAll('font[size="7"]:not([data-existing-size-seven])').forEach(node => {
      const replacement = document.createElement('span');
      replacement.style.fontSize = `${size}px`;
      replacement.innerHTML = node.innerHTML;
      node.replaceWith(replacement);
    });
    existingLargeFonts.forEach(node => delete node.dataset.existingSizeSeven);
    block.html = editor.innerHTML;
    rememberSelection();
    persist();
  };
}

function setupCanvas(canvas, block, persist, isErasing) {
  const context = canvas.getContext('2d');
  const ratio = devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.lineCap = 'round';
  if (block.drawing) {
    const image = new Image();
    image.onload = () => {
      const savedWidth = Number(block.drawingWidth) || image.naturalWidth;
      const savedHeight = Number(block.drawingHeight) || image.naturalHeight;
      const proportionalHeight = width * (savedHeight / savedWidth);
      context.globalCompositeOperation = 'source-over';
      context.drawImage(image, 0, 0, width, proportionalHeight);
    };
    image.src = block.drawing;
  }
  let active = false;
  let last;
  const point = event => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top, pressure: event.pointerType === 'pen' ? Math.min(1, Math.max(.05, event.pressure)) : .5 }; };
  canvas.onpointerdown = event => { active = true; last = point(event); canvas.setPointerCapture(event.pointerId); };
  canvas.onpointermove = event => {
    if (!active) return;
    const next = point(event);
    context.beginPath();
    const erasing = isErasing();
    context.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    context.strokeStyle = erasing ? '#000' : block.color;
    const baseWidth = inkPenWidth(block) * (96 / 25.4);
    const sensitivity = inkPressureSensitivity(block) / 100;
    const pressureFactor = Math.max(.2, 1 + (next.pressure - .5) * 1.5 * sensitivity);
    context.lineWidth = erasing ? 9 + next.pressure * 18 : baseWidth * pressureFactor;
    context.moveTo(last.x, last.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    last = next;
  };
  canvas.onpointerup = () => {
    active = false;
    block.drawing = canvas.toDataURL();
    block.drawingWidth = width;
    block.drawingHeight = height;
    persist();
  };
}

async function openShareDialog() {
  let { data, error } = await db.from('share_links').select('token, enabled').eq('user_id', currentUser.id).maybeSingle();
  if (error) return alert(`Could not create a sharing link: ${error.message}`);
  if (!data) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    const token = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    const result = await db.from('share_links').insert({ user_id: currentUser.id, token, enabled: true }).select('token, enabled').single();
    if (result.error) return alert(`Could not create a sharing link: ${result.error.message}`);
    data = result.data;
  } else if (!data.enabled) {
    const result = await db.from('share_links').update({ enabled: true }).eq('user_id', currentUser.id).select('token, enabled').single();
    if (result.error) return alert(`Could not enable sharing: ${result.error.message}`);
    data = result.data;
  }
  const url = `${location.origin}${location.pathname}?share=${data.token}`;
  try { await navigator.clipboard.writeText(url); } catch { /* the prompt still exposes the URL */ }
  const answer = prompt('Read-only sharing is ON. The link was copied. Type DISABLE to revoke it, or close this box to keep sharing:', url);
  if (answer === 'DISABLE') {
    await db.from('share_links').update({ enabled: false }).eq('user_id', currentUser.id);
    alert('Read-only sharing is now disabled.');
  }
}

function renderWelcome(message = '') {
  app.className = '';
  app.innerHTML = `
    <main class="welcome">
      <a class="wordmark" href="./">Je<span>Week</span>Summary</a>
      <section>
        <p class="kicker">Work weekly notebook</p>
        <h1>Keep the work.<br>Plan what comes next.</h1>
        <p>Sign in to open your synchronized notebook on any phone or computer. A read-only sharing link opens a published notebook without an account.</p>
        ${message ? `<p class="welcome-error">${escapeHtml(message)}</p>` : ''}
        <div class="login-options">
          <button id="googleLogin" class="google-login">Continue with Google</button>
          <span>or</span>
          <form id="emailLogin" class="email-login">
            <label for="loginEmail">Email address</label>
            <div><input id="loginEmail" name="email" type="email" autocomplete="email" required placeholder="you@example.com"><button type="submit">Email me a sign-in link</button></div>
            <p id="emailLoginStatus" role="status"></p>
          </form>
        </div>
      </section>
    </main>`;
  document.querySelector('#googleLogin').onclick = async () => {
    const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
    if (error) alert(error.message);
  };
  document.querySelector('#emailLogin').onsubmit = async event => {
    event.preventDefault();
    const email = event.currentTarget.elements.email.value.trim();
    const status = document.querySelector('#emailLoginStatus');
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    status.textContent = 'Sending your secure sign-in link...';
    const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    button.disabled = false;
    status.textContent = error ? error.message : 'Check your email and open the sign-in link.';
  };
}

function renderSharedHome(token) {
  document.querySelector('#localWeekStyle')?.remove();
  const settings = getSettings();
  applyFont(settings);
  const years = [...new Set(settings.years)].sort((a, b) => b - a);
  app.className = '';
  app.innerHTML = `
    <main class="book shared-book">
      <header class="masthead"><a class="wordmark" href="./">Je<span>Week</span>Summary</a><span class="edition">Read-only shared notebook</span></header>
      <section class="cover"><p class="kicker">Published work record</p><h1>${safeRichHtml(settings.headline)}</h1><p class="intro">${safeRichHtml(settings.intro)}</p></section>
      <section class="contents">${years.map(year => `
        <section class="year-chapter"><header><span class="chapter-number">CHAPTER ${String(chapterNumber(year)).padStart(2, '0')}</span><h2>${year}</h2></header>
        <div class="chapters">${listedWeeks(year).map(date => { const week = getWeek(date); const important = (settings.highlightedWeeks || []).includes(iso(date)); return `<button class="chapter shared-chapter${important ? ' highlighted' : ''}" data-shared-week="${iso(date)}"><span class="chapter-no">W${String(weekNumber(date)).padStart(2, '0')}</span><span class="chapter-date">${weekLabel(date)}</span><span class="chapter-summary">${escapeHtml(week.summary || 'Untitled work week')}</span><span class="arrow">${important ? 'Important' : 'Read'}</span></button>`; }).join('')}</div></section>`).join('')}</section>
    </main>`;
  document.querySelectorAll('[data-shared-week]').forEach(button => button.onclick = () => { location.href = `?share=${token}&week=${button.dataset.sharedWeek}`; });
}

function renderSharedWeek(date, token) {
  document.querySelector('#localWeekStyle')?.remove();
  const settings = getSettings();
  const week = getWeek(date);
  applyFont(settings);
  app.className = '';
  app.innerHTML = `
    <main class="notebook shared-notebook">
      <header class="notebook-nav"><a href="?share=${token}" class="back">&#8592; Shared contents</a><span class="edition">Read only</span></header>
      <section class="week-heading"><p class="kicker">Published work update / ${date.getFullYear()}</p><h1>${weekLabel(date)}</h1><p class="shared-summary">${escapeHtml(week.summary || 'Untitled work week')}</p></section>
      <section class="blocks">${week.blocks.map(block => block.type === 'ink'
        ? `<article class="note-block"><h2>${escapeHtml(block.title || 'Handwritten Note')}</h2>${block.drawing ? `<img class="shared-ink${block.paper === 'lined' ? ' lined' : ''}" style="height:${inkHeight(block)}px;max-height:none;--line-spacing:${inkLineSpacing(block)}px" src="${block.drawing}" alt="Handwritten Note">` : '<p>No handwriting added.</p>'}</article>`
        : `<article class="note-block shared-text"><h2>${escapeHtml(block.title || 'Note')}</h2><div style="color:${block.color || '#20211e'}">${block.html ? safeRichHtml(block.html) : '<p>No notes added.</p>'}</div></article>`).join('')}</section>
    </main>`;
}

function uploadFont(event, date) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 1500000) return alert('Please choose a font smaller than 1.5 MB so it can be saved in this browser.');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      localStorage.setItem(localUserKey(LOCAL_FONT_PREFIX), JSON.stringify({ name: 'Uploaded Work Font', data: reader.result }));
    } catch {
      alert('This browser could not store that font. Try a smaller font file.');
      return;
    }
    renderWeek(date);
  };
  reader.readAsDataURL(file);
}

function uploadWeekCss(event, date) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 100000) return alert('Please choose a CSS file smaller than 100 KB.');
  const reader = new FileReader();
  reader.onload = () => {
    const css = String(reader.result || '');
    if (/@import\b|url\s*\(/i.test(css)) return alert('For privacy, local CSS cannot use @import or url(...).');
    try { localStorage.setItem(localUserKey(LOCAL_CSS_PREFIX), css); }
    catch { return alert('This browser could not store that CSS file.'); }
    renderWeek(date);
  };
  reader.readAsText(file);
}

async function start() {
  const params = new URLSearchParams(location.search);
  const share = params.get('share');
  const selectedWeek = params.get('week');
  if (share) {
    const { data, error } = await db.rpc('get_shared_notebook', { p_token: share });
    const content = Array.isArray(data) ? data[0]?.content : data?.content;
    if (error || !content) return renderWelcome('That sharing link is unavailable or has been revoked.');
    cloudState = content;
    cloudState.settings = { ...defaultSettings(), ...(cloudState.settings || {}) };
    cloudState.weeks = cloudState.weeks || {};
    activeShare = share;
    if (selectedWeek) renderSharedWeek(monday(new Date(`${selectedWeek}T12:00:00`)), share);
    else renderSharedHome(share);
    return;
  }
  const { data: { session } } = await db.auth.getSession();
  if (!session) return renderWelcome();
  currentUser = session.user;
  try {
    await loadCloudState();
    if (selectedWeek) renderWeek(monday(new Date(`${selectedWeek}T12:00:00`)));
    else renderHome();
  } catch (error) {
    const offlineRecord = await loadOfflineNotebook(currentUser.id).catch(() => null);
    if (!offlineRecord) return renderWelcome(navigator.onLine
      ? `Cloud setup is not complete yet: ${error.message}`
      : 'You are offline. Connect once to download this notebook to the app.');
    cloudState = offlineRecord.content || offlineRecord;
    offlinePendingSync = Boolean(offlineRecord.pendingSync);
    cloudState.settings = { ...defaultSettings(), ...(cloudState.settings || {}) };
    cloudState.weeks = cloudState.weeks || {};
    if (selectedWeek) renderWeek(monday(new Date(`${selectedWeek}T12:00:00`)));
    else renderHome();
    showToast('Offline mode');
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  document.querySelector('#installApp').hidden = false;
});

document.querySelector('#installApp').onclick = async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.querySelector('#installApp').hidden = true;
};

window.addEventListener('appinstalled', () => { document.querySelector('#installApp').hidden = true; });
window.addEventListener('online', () => {
  if (!currentUser || !cloudState || !offlinePendingSync) return;
  saveCloudNow().then(error => {
    if (!error) showToast('Back online. Saved to cloud.');
  });
});

function showAppUpdateNotice() {
  if (document.querySelector('.app-update')) return;
  const button = document.createElement('button');
  button.className = 'app-update';
  button.type = 'button';
  button.textContent = 'New version available — Reload';
  button.onclick = () => location.reload();
  document.body.appendChild(button);
}

if ('serviceWorker' in navigator) window.addEventListener('load', async () => {
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showAppUpdateNotice();
      });
    });
    await registration.update();
  } catch { /* the online website still works without app installation */ }
});

start();
