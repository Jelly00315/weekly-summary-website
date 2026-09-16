const app = document.querySelector('#app');
const SETTINGS_KEY = 'je-week-summary-settings-v2';
const WEEK_PREFIX = 'week-notes:';
const SUPABASE_URL = 'https://zfzwdmcrqiylxjuycpmp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NbhL62YORIdN-hJawvsj2w_meoP2iPq';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let cloudState = null;
let currentUser = null;
let saveTimer = null;
let activeShare = null;

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const iso = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
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
    fontData: '',
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
  Object.entries(cloudState.weeks).forEach(([key, week]) => {
    if (!Array.isArray(week && week.blocks)) migratedLegacyWeeks = true;
    cloudState.weeks[key] = normalizeWeek(week);
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
  if (settings.fontData) {
    try {
      const face = new FontFace('Uploaded Work Font', `url(${settings.fontData})`);
      await face.load();
      document.fonts.add(face);
      settings.fontName = 'Uploaded Work Font';
    } catch { settings.fontName = 'Times New Roman'; }
  }
  document.documentElement.style.setProperty('--paper', settings.background);
  document.documentElement.style.setProperty('--writing-font', `'${settings.fontName}', 'Times New Roman', serif`);
}

function renderHome() {
  const settings = getSettings();
  applyFont(settings);
  const years = [...new Set(settings.years)].sort((a, b) => b - a);
  app.className = '';
  app.innerHTML = `
    <main class="book">
      <header class="masthead">
        <a class="wordmark" href="./">Je<span>Week</span>Summary</a>
        <span class="edition">Work weekly update</span>
        <div class="account-control"><span>${escapeHtml(currentUser?.email || '')}</span><button id="shareNotebook">Share</button><button id="logout">Log out</button></div>
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
          return `<div class="chapter${isHighlighted ? ' highlighted' : ''}"><span class="chapter-no">${String(index + 1).padStart(2, '0')}</span><button class="chapter-main" data-week-open="${key}"><span class="chapter-date">${weekLabel(date)}</span><span class="chapter-summary">${escapeHtml(week.summary || 'Untitled work week')}</span><span class="arrow">Open</span></button><button class="highlight-week" data-highlight-week="${key}" aria-pressed="${isHighlighted}" title="${isHighlighted ? 'Remove highlight' : 'Highlight important week'}">${isHighlighted ? 'Important' : 'Highlight'}</button><button class="remove-week" data-remove-week="${key}" aria-label="Remove week ${weekLabel(date)}">-</button></div>`;
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
  const answer = prompt(`Enter any date in the week you want to add to ${year} (YYYY-MM-DD):`, `${year}-01-01`);
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
  putSettings(settings);
  renderHome();
}

function renderWeek(date) {
  const settings = getSettings();
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
          <span>${escapeHtml(settings.fontName)}</span>
          <input id="fontUpload" type="file" accept=".ttf,.otf,.woff,.woff2,font/*">
        </label>
        <button id="deleteWeek" class="danger">Delete week</button>
        <button id="saveWeek" class="primary">Save update</button>
      </footer>
    </main>`;
  bindWeek(date, week);
}

function renderBlock(block, settings) {
  if (block.type === 'ink') return `
    <article class="note-block ink-block" data-block="${block.id}">
      <header class="block-header">
        <input class="block-title" value="${escapeHtml(block.title || 'Handwritten Note')}" aria-label="Block title">
        <div class="block-tools"><label>Ink <input class="block-color" type="color" value="${block.color || '#24414a'}"></label><button class="clear-ink">Clear</button><button class="remove-block">Delete</button></div>
      </header>
      <canvas class="ink-canvas"></canvas>
      <p class="ink-tip">Pressure-sensitive with a compatible stylus.</p>
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
        <select class="font-select" aria-label="Font"><option>${escapeHtml(settings.fontName)}</option><option>Times New Roman</option><option>Arial</option><option>Georgia</option><option>Courier New</option></select>
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
    setupCanvas(canvas, block, persist);
    element.querySelector('.clear-ink').onclick = () => {
      if (!confirm('Clear this handwriting block? This cannot be undone.')) return;
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      block.drawing = '';
      persist();
    };
    return;
  }
  const editor = element.querySelector('.text-editor');
  editor.oninput = () => { block.html = editor.innerHTML; persist(); };
  element.querySelectorAll('[data-command]').forEach(button => button.onclick = () => {
    editor.focus();
    const value = button.dataset.command === 'hiliteColor' ? '#fff09a' : null;
    document.execCommand(button.dataset.command, false, value);
    block.html = editor.innerHTML;
    persist();
  });
  element.querySelector('.font-select').onchange = e => { editor.focus(); document.execCommand('fontName', false, e.target.value); block.html = editor.innerHTML; persist(); };
}

function setupCanvas(canvas, block, persist) {
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
    context.strokeStyle = block.color;
    context.lineWidth = 1 + next.pressure * 5.5;
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
        <button id="googleLogin" class="google-login">Continue with Google</button>
      </section>
    </main>`;
  document.querySelector('#googleLogin').onclick = async () => {
    const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
    if (error) alert(error.message);
  };
}

function renderSharedHome(token) {
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
        <div class="chapters">${listedWeeks(year).map((date, index) => { const week = getWeek(date); const important = (settings.highlightedWeeks || []).includes(iso(date)); return `<button class="chapter shared-chapter${important ? ' highlighted' : ''}" data-shared-week="${iso(date)}"><span class="chapter-no">${String(index + 1).padStart(2, '0')}</span><span class="chapter-date">${weekLabel(date)}</span><span class="chapter-summary">${escapeHtml(week.summary || 'Untitled work week')}</span><span class="arrow">${important ? 'Important' : 'Read'}</span></button>`; }).join('')}</div></section>`).join('')}</section>
    </main>`;
  document.querySelectorAll('[data-shared-week]').forEach(button => button.onclick = () => { location.href = `?share=${token}&week=${button.dataset.sharedWeek}`; });
}

function renderSharedWeek(date, token) {
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
    const settings = getSettings();
    settings.fontData = reader.result;
    settings.fontName = 'Uploaded Work Font';
    putSettings(settings);
    renderWeek(date);
  };
  reader.readAsDataURL(file);
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
