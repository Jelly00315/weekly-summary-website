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
    intro: 'A working record of progress, results, questions, and the plan for the week ahead.'
  };
}

function getSettings() {
  if (cloudState) {
    const settings = { ...defaultSettings(), ...(cloudState.settings || {}) };
    if (settings.headline === 'Research, week by week.') settings.headline = 'Work, week by week.';
    return settings;
  }
  try {
    const settings = { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    if (settings.headline === 'Research, week by week.') settings.headline = 'Work, week by week.';
    return settings;
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
        ...(type === 'ink' ? { drawing: block.drawing || '' } : { html: block.html || '' })
      };
    });
  } else {
    if (old.body || old.privateBody) blocks.push({ id: uid(), type: 'text', title: 'Progress & results', html: old.privateBody || old.body, color: '#20211e' });
    if (old.publicBody) blocks.push({ id: uid(), type: 'text', title: 'Shared notes', html: old.publicBody, color: '#20211e' });
    if (old.drawing) blocks.push({ id: uid(), type: 'ink', title: 'Handwritten Note', drawing: old.drawing, color: '#24414a' });
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
  if (migratedLegacyWeeks) queueCloudSave();
}

function queueCloudSave() {
  if (!cloudState || !currentUser) return;
  clearTimeout(saveTimer);
  const status = document.querySelector('#saveStatus');
  if (status) status.textContent = 'Saving...';
  saveTimer = setTimeout(async () => {
    const { error } = await db.from('notebooks').upsert({ user_id: currentUser.id, content: cloudState, updated_at: new Date().toISOString() });
    const nextStatus = document.querySelector('#saveStatus');
    if (nextStatus) nextStatus.textContent = error ? 'Cloud save failed' : 'Saved to cloud';
  }, 550);
}

async function saveCloudNow() {
  if (!cloudState || !currentUser) return null;
  clearTimeout(saveTimer);
  const status = document.querySelector('#saveStatus');
  if (status) status.textContent = 'Saving...';
  const { error } = await db.from('notebooks').upsert({ user_id: currentUser.id, content: cloudState, updated_at: new Date().toISOString() });
  const nextStatus = document.querySelector('#saveStatus');
  if (nextStatus) nextStatus.textContent = error ? 'Cloud save failed' : 'Saved to cloud';
  return error;
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
        <div class="account-control"><span>${escapeHtml(currentUser?.email || '')}</span><button id="shareNotebook">Share</button><button id="logout">Log out</button><button id="deleteAccount" class="delete-account">Delete account</button></div>
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
        <div class="year-actions"><button id="addYear" class="primary">+ Add year</button></div>
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
  document.querySelector('#logout').onclick = () => db.auth.signOut().then(() => location.href = './');
  document.querySelector('#deleteAccount').onclick = deleteAccount;
  document.querySelector('#shareNotebook').onclick = openShareDialog;
  document.querySelectorAll('[data-delete-year]').forEach(button => button.onclick = () => deleteYear(Number(button.dataset.deleteYear)));
  document.querySelectorAll('[data-add-week]').forEach(button => button.onclick = () => addWeek(Number(button.dataset.addWeek)));
  document.querySelectorAll('[data-week-open]').forEach(button => button.onclick = () => { location.href = `?week=${button.dataset.weekOpen}`; });
  document.querySelectorAll('[data-remove-week]').forEach(button => button.onclick = () => deleteListedWeek(button.dataset.removeWeek));
  document.querySelectorAll('[data-highlight-week]').forEach(button => button.onclick = () => toggleWeekHighlight(button.dataset.highlightWeek));
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
      <section id="blocks" class="blocks">${week.blocks.map(block => renderBlock(block, settings)).join('')}</section>
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

function renderBlock(block, settings) {
  if (block.type === 'ink') return `
    <article class="note-block ink-block" data-block="${block.id}">
      <header class="block-header">
        <input class="block-title" value="${escapeHtml(block.title || 'Handwritten Note')}" aria-label="Block title">
        <div class="block-tools"><label>Ink <input class="block-color" type="color" value="${block.color || '#24414a'}"></label><button class="eraser-toggle" aria-pressed="false">Eraser</button><button class="clear-ink">Clear</button><button class="remove-block">Delete</button></div>
      </header>
      <canvas class="ink-canvas"></canvas>
      <p class="ink-tip">Pressure-sensitive with a compatible stylus. Select Eraser to remove individual strokes.</p>
    </article>`;
  return `
    <article class="note-block text-block" data-block="${block.id}">
      <header class="block-header">
        <input class="block-title" value="${escapeHtml(block.title || 'Note')}" aria-label="Block title">
        <button class="remove-block">Delete</button>
      </header>
      <div class="toolbar">
        <button data-command="bold"><b>B</b></button>
        <button data-command="italic"><i>I</i></button>
        <button data-command="hiliteColor">Highlight</button>
        <button data-command="insertUnorderedList">List</button>
        <select class="font-select" aria-label="Font">${fontOptions(settings)}</select>
        <label>Text <input class="block-color" type="color" value="${block.color || '#20211e'}"></label>
      </div>
      <div class="text-editor" contenteditable="true" style="color:${block.color || '#20211e'}" data-placeholder="Type your work update here...">${block.html || ''}</div>
    </article>`;
}

function bindWeek(date, week) {
  const persist = () => { putWeek(date, week); const status = document.querySelector('#saveStatus'); if (status) status.textContent = 'Saved just now'; };
  document.querySelector('#weekSummary').oninput = e => { week.summary = e.target.value; persist(); };
  document.querySelector('#saveWeek').onclick = persist;
  document.querySelector('#showBlockChoices').onclick = () => { const choices = document.querySelector('#blockChoices'); choices.hidden = !choices.hidden; };
  document.querySelectorAll('[data-add-type]').forEach(button => button.onclick = () => {
    week.blocks.push(button.dataset.addType === 'ink'
      ? { id: uid(), type: 'ink', title: 'Handwritten Note', drawing: '', color: '#24414a' }
      : { id: uid(), type: 'text', title: 'Note', html: '', color: '#20211e' });
    putWeek(date, week);
    renderWeek(date);
  });
  document.querySelector('#deleteWeek').onclick = () => deleteListedWeek(iso(date));
  document.querySelector('#fontUpload').onchange = event => uploadFont(event, date);
  document.querySelector('#cssUpload').onchange = event => uploadWeekCss(event, date);
  document.querySelector('#clearCustomCss').onclick = () => {
    localStorage.removeItem(localUserKey(LOCAL_CSS_PREFIX));
    document.querySelector('#localWeekStyle')?.remove();
    renderWeek(date);
  };
  document.querySelectorAll('.note-block').forEach(element => bindBlock(element, week, persist));
}

function bindBlock(element, week, persist) {
  const block = week.blocks.find(item => item.id === element.dataset.block);
  element.querySelector('.block-title').oninput = e => { block.title = e.target.value; persist(); };
  element.querySelector('.remove-block').onclick = () => {
    if (!confirm(`Delete “${block.title || 'this block'}”? This cannot be undone.`)) return;
    week.blocks = week.blocks.filter(item => item.id !== block.id);
    element.remove();
    persist();
  };
  const color = element.querySelector('.block-color');
  color.oninput = e => {
    block.color = e.target.value;
    if (block.type === 'text') element.querySelector('.text-editor').style.color = block.color;
    persist();
  };
  if (block.type === 'ink') {
    const canvas = element.querySelector('canvas');
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
  editor.oninput = () => { block.html = editor.innerHTML; persist(); };
  editor.addEventListener('keyup', rememberSelection);
  editor.addEventListener('mouseup', rememberSelection);
  element.querySelectorAll('[data-command]').forEach(button => {
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => {
      restoreSelection();
      const value = button.dataset.command === 'hiliteColor' ? '#fff09a' : null;
      document.execCommand(button.dataset.command, false, value);
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
  if (block.drawing) { const image = new Image(); image.onload = () => context.drawImage(image, 0, 0, width, height); image.src = block.drawing; }
  let active = false;
  let last;
  const point = event => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top, pressure: Math.max(.12, event.pointerType === 'pen' ? event.pressure : .5) }; };
  canvas.onpointerdown = event => { active = true; last = point(event); canvas.setPointerCapture(event.pointerId); };
  canvas.onpointermove = event => {
    if (!active) return;
    const next = point(event);
    context.beginPath();
    const erasing = isErasing();
    context.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    context.strokeStyle = erasing ? '#000' : block.color;
    context.lineWidth = erasing ? 9 + next.pressure * 18 : 1 + next.pressure * 5.5;
    context.moveTo(last.x, last.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    last = next;
  };
  canvas.onpointerup = () => { active = false; block.drawing = canvas.toDataURL(); persist(); };
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
        ? `<article class="note-block"><h2>${escapeHtml(block.title || 'Handwritten Note')}</h2>${block.drawing ? `<img class="shared-ink" src="${block.drawing}" alt="Handwritten Note">` : '<p>No handwriting added.</p>'}</article>`
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
    renderWelcome(`Cloud setup is not complete yet: ${error.message}`);
  }
}

start();
