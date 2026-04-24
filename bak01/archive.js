/* ─────────────────────────────────────────────────────────────
   archive.js — reads from the same localStorage as app.js
   ───────────────────────────────────────────────────────────── */

const DAYS     = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const PALETTE  = ['#fde8c8','#d8edf8','#d8f0e4','#ede0f8','#fde0e0','#e0f4f8'];
const PALETTE_H= ['#e8a040','#4a90d9','#3aaa60','#8a50d0','#d06060','#30a0b8'];

/* ── LOAD ────────────────────────────────────────────────── */
function loadArchive() {
  return JSON.parse(localStorage.getItem('hs_archive') || '[]');
}

/* ── UTILS ───────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getCoursesForDay(entry, studentId, day) {
  const student  = (entry.snapshot.students || []).find(s => s.id === studentId);
  if (!student) return [];
  const removed  = entry.snapshot.removals?.[studentId]?.[day] || [];
  const hidden   = entry.snapshot.hidden?.[studentId] || [];
  const defaults = (student.courses || [])
    .filter(c => !removed.includes(c.id))
    .map(c => ({ ...c, isOverride: false }));
  const extras = (entry.snapshot.overrides?.[studentId]?.[day] || [])
    .map(c => ({ ...c, isOverride: true }));
  return { courses: [...defaults, ...extras], hiddenDay: hidden.includes(day) };
}

function completionStats(entry) {
  let total = 0, done = 0;
  (entry.snapshot.students || []).forEach(student => {
    DAYS.forEach(day => {
      const hidden = (entry.snapshot.hidden?.[student.id] || []).includes(day);
      if (hidden) return;
      const { courses } = getCoursesForDay(entry, student.id, day);
      courses.forEach(course => {
        total++;
        if (entry.snapshot.checks?.[student.id]?.[day]?.[course.id]) done++;
      });
    });
  });
  return { total, done, pct: total === 0 ? 0 : Math.round((done/total)*100) };
}

function studentStats(entry, studentId) {
  let total = 0, done = 0;
  DAYS.forEach(day => {
    const hidden = (entry.snapshot.hidden?.[studentId] || []).includes(day);
    if (hidden) return;
    const { courses } = getCoursesForDay(entry, studentId, day);
    courses.forEach(course => {
      total++;
      if (entry.snapshot.checks?.[studentId]?.[day]?.[course.id]) done++;
    });
  });
  return { total, done, pct: total === 0 ? 0 : Math.round((done/total)*100) };
}

/* ── SIDEBAR ─────────────────────────────────────────────── */
let _currentEntry = null;
let _archive = [];

function renderSidebar(filter = '') {
  const list = document.getElementById('week-list');
  list.innerHTML = '';

  const filtered = filter
    ? _archive.filter(e =>
        e.label.toLowerCase().includes(filter.toLowerCase()) ||
        (e.snapshot.students||[]).some(s => s.name.toLowerCase().includes(filter.toLowerCase()))
      )
    : _archive;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="sidebar-empty">${filter ? 'No results.' : 'No archived weeks yet.<br>Close a week from the tracker to see it here.'}</div>`;
    return;
  }

  filtered.forEach(entry => {
    const { done, total, pct } = completionStats(entry);
    const pillClass = pct === 100 ? '' : pct > 0 ? 'partial' : 'empty';
    const closed = new Date(entry.closedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'});

    const item = document.createElement('div');
    item.className = 'week-list-item' + (_currentEntry?.weekKey === entry.weekKey ? ' active' : '');
    item.innerHTML = `
      <div class="week-list-label">${escHtml(entry.label)}</div>
      <div class="week-list-meta">Closed ${closed}</div>
      <div class="week-list-stats">
        <span class="stat-pill ${pillClass}">${pct}% complete</span>
      </div>
    `;
    item.addEventListener('click', () => {
      _currentEntry = entry;
      renderSidebar(document.getElementById('archive-search').value);
      renderDetail(entry);
    });
    list.appendChild(item);
  });
}

/* ── DETAIL PANEL ────────────────────────────────────────── */
function renderDetail(entry) {
  document.getElementById('detail-empty').classList.add('hidden');
  const content = document.getElementById('detail-content');
  content.classList.remove('hidden');
  content.innerHTML = '';

  const closed = new Date(entry.closedAt).toLocaleDateString('en-US',{
    weekday:'long', month:'long', day:'numeric', year:'numeric'
  });

  /* — heading — */
  const heading = document.createElement('div');
  heading.className = 'detail-heading';
  heading.innerHTML = `
    <div class="detail-title">${escHtml(entry.label)}</div>
    <div class="detail-closed">Archived on ${closed}</div>
  `;
  content.appendChild(heading);

  /* — summary strip — */
  const { done, total, pct } = completionStats(entry);
  const students = entry.snapshot.students || [];
  const strip = document.createElement('div');
  strip.className = 'detail-summary-strip';
  strip.innerHTML = `
    <div class="summary-card highlight">
      <div class="summary-card-value">${pct}%</div>
      <div class="summary-card-label">Overall Completion</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-value">${done}/${total}</div>
      <div class="summary-card-label">Tasks Completed</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-value">${students.length}</div>
      <div class="summary-card-label">Student${students.length !== 1 ? 's' : ''}</div>
    </div>
  `;
  content.appendChild(strip);

  /* — per-student blocks — */
  const studentsWrap = document.createElement('div');
  studentsWrap.className = 'detail-students';

  students.forEach(student => {
    const bg      = PALETTE[student.colorIndex % PALETTE.length];
    const accent  = PALETTE_H[student.colorIndex % PALETTE_H.length];
    const initials= student.name.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const { done: sDone, total: sTotal, pct: sPct } = studentStats(entry, student.id);

    const block = document.createElement('div');
    block.className = 'detail-student-block';

    /* header */
    const sHdr = document.createElement('div');
    sHdr.className = 'detail-student-header';
    sHdr.style.background = bg + '55'; // tinted
    sHdr.innerHTML = `
      <div class="detail-student-avatar" style="background:${bg};color:${accent}">${initials}</div>
      <div class="detail-student-name" style="color:${accent}">${escHtml(student.name)}</div>
      <div class="detail-student-completion">${sDone}/${sTotal} — ${sPct}%</div>
    `;
    block.appendChild(sHdr);

    /* day grid */
    const dayGrid = document.createElement('div');
    dayGrid.className = 'detail-week-grid';

    DAYS.forEach(day => {
      const col = document.createElement('div');
      col.className = 'detail-day-col';

      const hiddenDay = (entry.snapshot.hidden?.[student.id] || []).includes(day);
      if (hiddenDay) col.classList.add('day-hidden');

      col.innerHTML = `<div class="detail-day-label">${day.slice(0,3)}</div>`;

      if (hiddenDay) {
        col.innerHTML += `<div class="detail-day-no-school">No school</div>`;
      } else {
        const { courses } = getCoursesForDay(entry, student.id, day);
        if (courses.length === 0) {
          col.innerHTML += `<div class="detail-day-no-school">—</div>`;
        } else {
          courses.forEach(course => {
            const isDone = !!(entry.snapshot.checks?.[student.id]?.[day]?.[course.id]);
            const row = document.createElement('div');
            row.className = 'detail-course-row' + (isDone ? ' done' : '');
            row.innerHTML = `
              <div class="detail-course-check">${isDone ? '✓' : ''}</div>
              <span>${escHtml(course.label)}</span>
            `;
            col.appendChild(row);
          });
        }
      }

      dayGrid.appendChild(col);
    });

    block.appendChild(dayGrid);
    studentsWrap.appendChild(block);
  });

  content.appendChild(studentsWrap);
}

/* ── SEARCH ──────────────────────────────────────────────── */
document.getElementById('archive-search').addEventListener('input', e => {
  renderSidebar(e.target.value);
});

/* ── INIT ────────────────────────────────────────────────── */
function init() {
  _archive = loadArchive();

  const sub = document.getElementById('archive-subtitle');
  const weekCount = _archive.length === 0
    ? 'No archived weeks yet'
    : `${_archive.length} week${_archive.length !== 1 ? 's' : ''} archived`;
  sub.textContent = `${weekCount} · ${lastExportLabel()}`;

  renderSidebar();

  // Auto-select the most recent entry
  if (_archive.length > 0) {
    _currentEntry = _archive[0];
    renderSidebar();
    renderDetail(_archive[0]);
  }

  // Manual export button
  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportAll('full-backup');
      // Refresh subtitle to show updated export time
      const updatedSub = document.getElementById('archive-subtitle');
      const wc = _archive.length === 0
        ? 'No archived weeks yet'
        : `${_archive.length} week${_archive.length !== 1 ? 's' : ''} archived`;
      updatedSub.textContent = `${wc} · ${lastExportLabel()}`;
    });
  }
}

init();
