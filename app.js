const app = document.querySelector('#app');
const SETTINGS_KEY = 'je-week-summary-settings-v2';
const WEEK_PREFIX = 'week-notes:';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const iso = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
const addDays = (d, amount) => { const next = new Date(d); next.setDate(next.getDate() + amount); return next; };
const monday = d => { const next = new Date(d); next.setHours(0, 0, 0, 0); next.setDate(next.getDate() - ((next.getDay() + 6) % 7)); return next; };
const weekLabel = d => `${d.getMonth() + 1}.${d.getDate()} - ${addDays(d, 6).getMonth() + 1}.${addDays(d, 6).getDate()}`;
const escapeHtml = (value = '') => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function defaultSettings() {
  const year = new Date().getFullYear();
  return {
    years: [year - 2, year - 1, year],
    background: '#f4f0e7',
    backgroundHistory: [],
    fontName: 'Times New Roman',
    fontData: '',
    headline: 'Research, week by week.',
    intro: 'A working record of progress, results, questions, and the plan for the week ahead.'
  };
}

function getSettings() {
  try { return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return defaultSettings(); }
}

function putSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { alert('This browser could not save that setting. Uploaded font files may be too large.'); }
}

function defaultBlocks() {
  return [
    { id: uid(), type: 'text', title: 'Progress & results', html: '', color: '#20211e' },
    { id: uid(), type: 'text', title: 'Next week plan', html: '', color: '#20211e' }
  ];
}

function getWeek(date) {
  try {
    const old = JSON.parse(localStorage.getItem(`${WEEK_PREFIX}${iso(date)}`) || '{}');
    if (Array.isArray(old.blocks)) return { summary: '', ...old };
    const blocks = [];
    if (old.body || old.privateBody) blocks.push({ id: uid(), type: 'text', title: 'Progress & results', html: old.privateBody || old.body, color: '#20211e' });
    if (old.publicBody) blocks.push({ id: uid(), type: 'text', title: 'Shared notes', html: old.publicBody, color: '#20211e' });
    if (old.drawing) blocks.push({ id: uid(), type: 'ink', title: 'Handwritten notes', drawing: old.drawing, color: '#24414a' });
    return { summary: old.summary || '', blocks: blocks.length ? blocks : defaultBlocks() };
  } catch { return { summary: '', blocks: defaultBlocks() }; }
}

function putWeek(date, value) {
  try { localStorage.setItem(`${WEEK_PREFIX}${iso(date)}`, JSON.stringify(value)); }
  catch { alert('This week could not be saved. Try removing a large handwriting block.'); }
}

function weeksIn(year) {
  const first = monday(new Date(year, 0, 4));
  const nextFirst = monday(new Date(year + 1, 0, 4));
  const result = [];
  for (let date = first; date < nextFirst; date = addDays(date, 7)) result.push(new Date(date));
  return result;
}

async function applyFont(settings) {
  if (settings.fontData) {
    try {
      const face = new FontFace('Uploaded Research Font', `url(${settings.fontData})`);
      await face.load();
      document.fonts.add(face);
      settings.fontName = 'Uploaded Research Font';
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
        <span class="edition">Research weekly update</span>
        <div class="paper-control">
          <label>Paper <input id="backgroundColor" type="color" value="${settings.background}"></label>
          <div class="color-history" aria-label="Previous background colors">
            ${settings.backgroundHistory.map(color => `<button class="color-chip" data-color="${color}" style="--chip:${color}" title="Use ${color}"></button>`).join('')}
          </div>
        </div>
      </header>
      <section class="cover">
        <p class="kicker">Research notebook / contents</p>
        <h1 contenteditable="true" id="headline">${settings.headline}</h1>
        <p class="intro" contenteditable="true" id="intro">${settings.intro}</p>
        <div class="year-actions"><button id="addYear" class="primary">+ Add year</button></div>
      </section>
      <section class="contents">
        ${years.map((year, index) => renderYear(year, index)).join('')}
      </section>
    </main>`;

  document.querySelector('#headline').oninput = e => { const next = getSettings(); next.headline = e.currentTarget.innerHTML; putSettings(next); };
  document.querySelector('#intro').oninput = e => { const next = getSettings(); next.intro = e.currentTarget.innerHTML; putSettings(next); };
  document.querySelector('#backgroundColor').onchange = e => selectBackground(e.target.value);
  document.querySelectorAll('.color-chip').forEach(button => button.onclick = () => selectBackground(button.dataset.color));
  document.querySelector('#addYear').onclick = addYear;
  document.querySelectorAll('[data-delete-year]').forEach(button => button.onclick = () => deleteYear(Number(button.dataset.deleteYear)));
  document.querySelectorAll('[data-week]').forEach(button => button.onclick = () => { location.href = `?week=${button.dataset.week}`; });
}

function renderYear(year, index) {
  const entries = weeksIn(year);
  const written = entries.filter(date => { const week = getWeek(date); return week.summary || week.blocks.some(block => block.html || block.drawing); }).length;
  return `
    <section class="year-chapter">
      <header>
        <span class="chapter-number">CHAPTER ${String(index + 1).padStart(2, '0')}</span>
        <h2>${year}</h2>
        <span class="year-count">${written} written weeks</span>
        <button class="delete-year" data-delete-year="${year}" aria-label="Delete ${year}">- Remove year</button>
      </header>
      <div class="chapters">
        ${entries.map((date, index) => {
          const week = getWeek(date);
          return `<button class="chapter" data-week="${iso(date)}"><span class="chapter-no">${String(index + 1).padStart(2, '0')}</span><span class="chapter-date">${weekLabel(date)}</span><span class="chapter-summary">${escapeHtml(week.summary || 'Untitled research week')}</span><span class="arrow">Open</span></button>`;
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

function addYear() {
  const settings = getSettings();
  const suggested = Math.max(...settings.years) + 1;
  const answer = prompt('Enter the year to add:', String(suggested));
  if (answer === null) return;
  const year = Number(answer);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return alert('Please enter a year between 1900 and 2200.');
  if (settings.years.includes(year)) return alert(`${year} is already in your notebook.`);
  settings.years.push(year);
  putSettings(settings);
  renderHome();
}

function deleteYear(year) {
  if (!confirm(`Delete ${year} and every saved week inside it? This cannot be undone.`)) return;
  weeksIn(year).forEach(date => localStorage.removeItem(`${WEEK_PREFIX}${iso(date)}`));
  const settings = getSettings();
  settings.years = settings.years.filter(item => item !== year);
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
        <span id="saveStatus">Saved locally</span>
      </header>
      <section class="week-heading">
        <p class="kicker">Research weekly update / ${date.getFullYear()}</p>
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
        <input class="block-title" value="${escapeHtml(block.title || 'Handwritten notes')}" aria-label="Block title">
        <div class="block-tools"><label>Ink <input class="block-color" type="color" value="${block.color || '#24414a'}"></label><button class="clear-ink">Clear</button><button class="remove-block">Delete</button></div>
      </header>
      <canvas class="ink-canvas"></canvas>
      <p class="ink-tip">Pressure-sensitive with a compatible stylus.</p>
    </article>`;
  return `
    <article class="note-block text-block" data-block="${block.id}">
      <header class="block-header">
        <input class="block-title" value="${escapeHtml(block.title || 'Research notes')}" aria-label="Block title">
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
      <div class="text-editor" contenteditable="true" style="color:${block.color || '#20211e'}" data-placeholder="Type your research update here...">${block.html || ''}</div>
    </article>`;
}

function bindWeek(date, week) {
  const persist = () => { putWeek(date, week); const status = document.querySelector('#saveStatus'); if (status) status.textContent = 'Saved just now'; };
  document.querySelector('#weekSummary').oninput = e => { week.summary = e.target.value; persist(); };
  document.querySelector('#saveWeek').onclick = persist;
  document.querySelector('#showBlockChoices').onclick = () => { const choices = document.querySelector('#blockChoices'); choices.hidden = !choices.hidden; };
  document.querySelectorAll('[data-add-type]').forEach(button => button.onclick = () => {
    week.blocks.push(button.dataset.addType === 'ink'
      ? { id: uid(), type: 'ink', title: 'Handwritten notes', drawing: '', color: '#24414a' }
      : { id: uid(), type: 'text', title: 'Research notes', html: '', color: '#20211e' });
    putWeek(date, week);
    renderWeek(date);
  });
  document.querySelector('#deleteWeek').onclick = () => {
    if (!confirm(`Delete the entire week ${weekLabel(date)}? This cannot be undone.`)) return;
    localStorage.removeItem(`${WEEK_PREFIX}${iso(date)}`);
    location.href = './';
  };
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

function uploadFont(event, date) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 1500000) return alert('Please choose a font smaller than 1.5 MB so it can be saved in this browser.');
  const reader = new FileReader();
  reader.onload = () => {
    const settings = getSettings();
    settings.fontData = reader.result;
    settings.fontName = 'Uploaded Research Font';
    putSettings(settings);
    renderWeek(date);
  };
  reader.readAsDataURL(file);
}

const selectedWeek = new URLSearchParams(location.search).get('week');
if (selectedWeek) renderWeek(monday(new Date(`${selectedWeek}T12:00:00`)));
else renderHome();
