/* ─────────────────────────────────────────────────────────────
   Homeschool Weekly Tracker — v2
   Storage keys:
     hs_students  → [{id, name, colorIndex, courses:[{id,label}]}]
                    courses = "default" courses (shown every day)
     hs_overrides → {[weekKey]: {[studentId]: {[day]: [{id,label}]}}}
                    day-specific extra courses
     hs_removals  → {[weekKey]: {[studentId]: {[day]: [courseId,...]}}}
                    default courses hidden on specific days
     hs_weeks     → {[weekKey]: {[studentId]: {[day]: {[courseId]: bool}}}}
                    checkbox state (works for both default & override courses)
     hs_archive   → [{weekKey, label, snapshot, closedAt}]
   ───────────────────────────────────────────────────────────── */

const DAYS     = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const PALETTE  = ['#fde8c8','#d8edf8','#d8f0e4','#ede0f8','#fde0e0','#e0f4f8'];
const PALETTE_H= ['#e8a040','#4a90d9','#3aaa60','#8a50d0','#d06060','#30a0b8'];
const STORAGE  = {
  STUDENTS : 'hs_students',
  OVERRIDES: 'hs_overrides',
  REMOVALS : 'hs_removals',
  WEEKS    : 'hs_weeks',
  ARCHIVE  : 'hs_archive',
  HIDDEN   : 'hs_hidden',   // {weekKey: {studentId: [day,...]}}
};

let state = {
  students : [],
  overrides: {},
  removals : {},
  hidden   : {},
  weeks    : {},
  archive  : [],
  currentWeekKey: '',
  editingStudentId: null,
};

/* ── STORAGE ─────────────────────────────────────────────── */
function save() {
  localStorage.setItem(STORAGE.STUDENTS,  JSON.stringify(state.students));
  localStorage.setItem(STORAGE.OVERRIDES, JSON.stringify(state.overrides));
  localStorage.setItem(STORAGE.REMOVALS,  JSON.stringify(state.removals));
  localStorage.setItem(STORAGE.HIDDEN,    JSON.stringify(state.hidden));
  localStorage.setItem(STORAGE.WEEKS,     JSON.stringify(state.weeks));
  localStorage.setItem(STORAGE.ARCHIVE,   JSON.stringify(state.archive));
}

function load() {
  state.students  = JSON.parse(localStorage.getItem(STORAGE.STUDENTS)  || '[]');
  state.overrides = JSON.parse(localStorage.getItem(STORAGE.OVERRIDES) || '{}');
  state.removals  = JSON.parse(localStorage.getItem(STORAGE.REMOVALS)  || '{}');
  state.hidden    = JSON.parse(localStorage.getItem(STORAGE.HIDDEN)    || '{}');
  state.weeks     = JSON.parse(localStorage.getItem(STORAGE.WEEKS)     || '{}');
  state.archive   = JSON.parse(localStorage.getItem(STORAGE.ARCHIVE)   || '[]');
}

/* ── WEEK KEY ────────────────────────────────────────────── */
function getWeekKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // roll back to Monday
  d.setDate(diff);
  // Use local year/month/date — never toISOString() which shifts to UTC
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function weekLabel(key) {
  const mon = new Date(key + 'T00:00:00');
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  const fmt = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  return `${fmt(mon)} – ${fmt(fri)}, ${fri.getFullYear()}`;
}

function isDayToday(di) {
  const js = new Date().getDay();
  return js >= 1 && js <= 5 && (js - 1) === di;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}

/* ── COURSE RESOLUTION ───────────────────────────────────── */
function getCoursesForDay(wk, studentId, day) {
  const student = state.students.find(s => s.id === studentId);
  if (!student) return [];
  const removed  = state.removals?.[wk]?.[studentId]?.[day] || [];
  const defaults = (student.courses || [])
    .filter(c => !removed.includes(c.id))
    .map(c => ({ ...c, isOverride: false }));
  const extras = (state.overrides?.[wk]?.[studentId]?.[day] || [])
    .map(c => ({ ...c, isOverride: true }));
  return [...defaults, ...extras];
}

/* ── CHECK STATE ─────────────────────────────────────────── */
function getCourseCheck(wk, studentId, day, courseId) {
  return !!(state.weeks?.[wk]?.[studentId]?.[day]?.[courseId]);
}

function setCourseCheck(wk, studentId, day, courseId, val) {
  if (!state.weeks[wk]) state.weeks[wk] = {};
  if (!state.weeks[wk][studentId]) state.weeks[wk][studentId] = {};
  if (!state.weeks[wk][studentId][day]) state.weeks[wk][studentId][day] = {};
  state.weeks[wk][studentId][day][courseId] = val;
  save();
}

/* ── SUMMARY STRIP ───────────────────────────────────────── */
function renderSummaryStrip() {
  const strip = document.getElementById('summary-strip');
  if (!strip) return;
  strip.innerHTML = '';
  if (state.students.length === 0) return;

  const wk   = state.currentWeekKey;
  const card = document.createElement('div');
  card.className = 'summary-card';

  state.students.forEach(student => {
    let total = 0, done = 0;
    DAYS.forEach(day => {
      const isHidden = (state.hidden?.[wk]?.[student.id] || []).includes(day);
      if (isHidden) return;
      const courses = getCoursesForDay(wk, student.id, day);
      courses.forEach(course => {
        total++;
        if (getCourseCheck(wk, student.id, day, course.id)) done++;
      });
    });

    const pct      = total === 0 ? 0 : Math.round((done / total) * 100);
    const bg       = PALETTE[student.colorIndex % PALETTE.length];
    const accent   = PALETTE_H[student.colorIndex % PALETTE_H.length];
    const initials = student.name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const fillClass= pct >= 80 ? '' : pct >= 40 ? 'warn' : 'low';
    const pctColor = pct >= 80 ? 'var(--success)' : pct >= 40 ? 'var(--warn)' : 'var(--danger)';

    const el = document.createElement('div');
    el.className = 'summary-student';
    el.dataset.studentId = student.id;
    el.innerHTML = `
      <div class="summary-avatar" style="background:${bg};color:${accent}">${initials}</div>
      <span class="summary-name" style="color:${accent}">${escHtml(student.name)}</span>
      <div class="summary-bar-bg">
        <div class="summary-bar-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
      <span class="summary-fraction">${done}/${total}</span>
      <span class="summary-pct" style="color:${pctColor}">${pct}%</span>
    `;
    card.appendChild(el);
  });

  strip.appendChild(card);
}

function updateSummaryStudent(studentId) {
  const strip = document.getElementById('summary-strip');
  if (!strip) return;
  const wk      = state.currentWeekKey;
  const student = state.students.find(s => s.id === studentId);
  if (!student) return;

  let total = 0, done = 0;
  DAYS.forEach(day => {
    const isHidden = (state.hidden?.[wk]?.[student.id] || []).includes(day);
    if (isHidden) return;
    const courses = getCoursesForDay(wk, student.id, day);
    courses.forEach(course => {
      total++;
      if (getCourseCheck(wk, student.id, day, course.id)) done++;
    });
  });

  const pct      = total === 0 ? 0 : Math.round((done / total) * 100);
  const fillClass= pct >= 80 ? '' : pct >= 40 ? 'warn' : 'low';
  const pctColor = pct >= 80 ? 'var(--success)' : pct >= 40 ? 'var(--warn)' : 'var(--danger)';

  const el = strip.querySelector(`.summary-card [data-student-id="${studentId}"]`);
  if (!el) return;
  const fill     = el.querySelector('.summary-bar-fill');
  const fraction = el.querySelector('.summary-fraction');
  const pctEl    = el.querySelector('.summary-pct');

  if (fill)     { fill.style.width = pct + '%'; fill.className = `summary-bar-fill ${fillClass}`; }
  if (fraction) fraction.textContent = `${done}/${total}`;
  if (pctEl)    { pctEl.textContent = pct + '%'; pctEl.style.color = pctColor; }
}

/* ── RENDER GRID ─────────────────────────────────────────── */
function renderGrid() {
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  DAYS.forEach((day, di) => {
    const col = document.createElement('div');
    col.className = 'day-column';

    const hdr = document.createElement('div');
    hdr.className = 'day-header' + (isDayToday(di) ? ' today' : '');
    hdr.textContent = day;
    col.appendChild(hdr);

    const cards = document.createElement('div');
    cards.className = 'day-cards';

    state.students.forEach(student => {
      const isHidden = (state.hidden?.[state.currentWeekKey]?.[student.id] || []).includes(day);
      if (isHidden) {
        cards.appendChild(buildHiddenPlaceholder(student, day));
      } else {
        cards.appendChild(buildCard(student, day));
      }
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add-card';
    addBtn.innerHTML = `<span>+</span> Add Student`;
    addBtn.addEventListener('click', () => openManageStudents());
    cards.appendChild(addBtn);

    col.appendChild(cards);
    grid.appendChild(col);
  });

  renderSummaryStrip();
}

/* ── BUILD CARD ──────────────────────────────────────────── */
function buildCard(student, day) {
  const wk      = state.currentWeekKey;
  const courses = getCoursesForDay(wk, student.id, day);
  const bg      = PALETTE[student.colorIndex % PALETTE.length];
  const accent  = PALETTE_H[student.colorIndex % PALETTE_H.length];
  const initials= student.name.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);

  const card = document.createElement('div');
  card.className = 'student-card';
  card.dataset.studentId = student.id;
  card.dataset.day = day;

  /* — header — */
  const hdr = document.createElement('div');
  hdr.className = 'card-header';
  hdr.style.background = bg;
  hdr.innerHTML = `
    <div class="card-header-left">
      <div class="card-avatar" style="color:${accent}">${initials}</div>
      <span class="card-name" style="color:${accent}">${escHtml(student.name)}</span>
    </div>
    <div class="card-actions">
      <button class="btn-icon" title="Add course to specific days" data-action="add-day-course">＋</button>
      <button class="btn-icon" title="More options" data-action="more">•••</button>
    </div>
  `;

  hdr.querySelector('[data-action="add-day-course"]').addEventListener('click', e => {
    e.stopPropagation();
    openAddDayCourseModal(student.id, day);
  });

  hdr.querySelector('[data-action="more"]').addEventListener('click', e => {
    e.stopPropagation();
    openCardMenu(e.currentTarget, student, day);
  });

  card.appendChild(hdr);

  /* — body — */
  const body = document.createElement('div');
  body.className = 'card-body';

  if (courses.length === 0) {
    body.innerHTML = `<div class="card-empty">No courses for this day.<br><small>Tap <strong>＋</strong> to add, or use <strong>•••</strong> to edit defaults.</small></div>`;
  } else {
    courses.forEach(course => {
      body.appendChild(buildCourseItem(card, student, day, course));
    });
  }

  card.appendChild(body);

  /* — progress bar — */
  if (courses.length > 0) {
    card.appendChild(buildProgressBar(student, day, courses));
  }

  return card;
}


/* ── HIDDEN CARD PLACEHOLDER ─────────────────────────────── */
function buildHiddenPlaceholder(student, day) {
  const bg     = PALETTE[student.colorIndex % PALETTE.length];
  const accent = PALETTE_H[student.colorIndex % PALETTE_H.length];
  const initials = student.name.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);

  const wrap = document.createElement('div');
  wrap.className = 'student-card card-hidden-day';

  wrap.innerHTML = `
    <div class="card-header card-header-muted" style="background:${bg}88">
      <div class="card-header-left">
        <div class="card-avatar" style="color:${accent}88">${initials}</div>
        <span class="card-name" style="color:${accent}88">${escHtml(student.name)}</span>
      </div>
      <button class="btn-icon card-restore-btn" title="Restore card for this day">↩</button>
    </div>
    <div class="card-body card-hidden-msg">No school this day</div>
  `;

  wrap.querySelector('.card-restore-btn').addEventListener('click', () => {
    const wk = state.currentWeekKey;
    if (state.hidden?.[wk]?.[student.id]) {
      state.hidden[wk][student.id] = state.hidden[wk][student.id].filter(d => d !== day);
    }
    save();
    const parent = wrap.parentNode;
    parent.replaceChild(buildCard(student, day), wrap);
  });

  return wrap;
}

function buildCourseItem(card, student, day, course) {
  const wk      = state.currentWeekKey;
  const checked = getCourseCheck(wk, student.id, day, course.id);
  const item    = document.createElement('div');
  item.className = 'course-item' + (checked ? ' done' : '') + (course.isOverride ? ' override' : '');

  const cbId = `cb-${student.id}-${day}-${course.id}`;
  item.innerHTML = `
    <label for="${cbId}">
      <input type="checkbox" id="${cbId}" ${checked ? 'checked' : ''}>
      <span class="course-label">${escHtml(course.label)}</span>
    </label>
    <button class="btn-icon course-remove" title="${course.isOverride ? 'Remove from this day' : 'Hide on this day'}" data-action="remove-course">✕</button>
  `;

  item.querySelector('input').addEventListener('change', ev => {
    setCourseCheck(wk, student.id, day, course.id, ev.target.checked);
    item.classList.toggle('done', ev.target.checked);
    const prog = card.querySelector('.card-progress');
    if (prog) refreshProgressBar(prog, student, day, getCoursesForDay(wk, student.id, day));
    updateSummaryStudent(student.id);
  });

  item.querySelector('[data-action="remove-course"]').addEventListener('click', () => {
    if (course.isOverride) {
      const arr = state.overrides?.[wk]?.[student.id]?.[day];
      if (arr) state.overrides[wk][student.id][day] = arr.filter(c => c.id !== course.id);
    } else {
      if (!state.removals[wk]) state.removals[wk] = {};
      if (!state.removals[wk][student.id]) state.removals[wk][student.id] = {};
      if (!state.removals[wk][student.id][day]) state.removals[wk][student.id][day] = [];
      if (!state.removals[wk][student.id][day].includes(course.id)) {
        state.removals[wk][student.id][day].push(course.id);
      }
    }
    save();
    const parent = card.parentNode;
    parent.replaceChild(buildCard(student, day), card);
  });

  return item;
}

function buildProgressBar(student, day, courses) {
  const wk    = state.currentWeekKey;
  const total = courses.length;
  const done  = courses.filter(c => getCourseCheck(wk, student.id, day, c.id)).length;
  const pct   = Math.round((done / total) * 100);
  const prog  = document.createElement('div');
  prog.className = 'card-progress';
  prog.innerHTML = `
    <div class="progress-bar-bg">
      <div class="progress-bar-fill" style="width:${pct}%"></div>
    </div>
    <span class="progress-label">${done}/${total}</span>
  `;
  return prog;
}

function refreshProgressBar(progEl, student, day, courses) {
  const wk    = state.currentWeekKey;
  const total = courses.length;
  const done  = courses.filter(c => getCourseCheck(wk, student.id, day, c.id)).length;
  const pct   = Math.round((done / total) * 100);
  const fill  = progEl.querySelector('.progress-bar-fill');
  const lbl   = progEl.querySelector('.progress-label');
  if (fill) fill.style.width = pct + '%';
  if (lbl)  lbl.textContent  = `${done}/${total}`;
}

/* ── ADD DAY-COURSE MODAL ────────────────────────────────── */
let _dayCourseCtx = { studentId: null, originDay: null };

function openAddDayCourseModal(studentId, originDay) {
  _dayCourseCtx = { studentId, originDay };
  const student  = state.students.find(s => s.id === studentId);
  const originDi = DAYS.indexOf(originDay);

  document.getElementById('day-course-student-name').textContent = student.name;
  document.getElementById('day-course-input').value = '';

  // Pre-check origin day + days after
  DAYS.forEach((_, i) => {
    const cb = document.getElementById(`dc-day-${i}`);
    if (cb) cb.checked = (i >= originDi);
  });

  showModal('modal-day-course');
  setTimeout(() => document.getElementById('day-course-input').focus(), 60);
}

document.getElementById('btn-save-day-course').addEventListener('click', saveDayCourse);
document.getElementById('day-course-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveDayCourse();
});

document.getElementById('dc-just-this').addEventListener('click', () => {
  const originDi = DAYS.indexOf(_dayCourseCtx.originDay);
  DAYS.forEach((_, i) => {
    const cb = document.getElementById(`dc-day-${i}`);
    if (cb) cb.checked = (i === originDi);
  });
});

document.getElementById('dc-all').addEventListener('click', () => {
  DAYS.forEach((_, i) => {
    const cb = document.getElementById(`dc-day-${i}`);
    if (cb) cb.checked = true;
  });
});


function saveDayCourse() {
  const label = document.getElementById('day-course-input').value.trim();
  if (!label) { document.getElementById('day-course-input').focus(); return; }

  const selectedDays = DAYS.filter((_, i) => {
    const cb = document.getElementById(`dc-day-${i}`);
    return cb && cb.checked;
  });

  if (selectedDays.length === 0) { toast('Pick at least one day.'); return; }

  const wk        = state.currentWeekKey;
  const studentId = _dayCourseCtx.studentId;
  const baseId    = uid();

  if (!state.overrides[wk]) state.overrides[wk] = {};
  if (!state.overrides[wk][studentId]) state.overrides[wk][studentId] = {};

  selectedDays.forEach(day => {
    if (!state.overrides[wk][studentId][day]) state.overrides[wk][studentId][day] = [];
    const already = state.overrides[wk][studentId][day].some(
      c => c.label.toLowerCase() === label.toLowerCase()
    );
    if (!already) {
      state.overrides[wk][studentId][day].push({ id: `${baseId}_${day}`, label });
    }
  });

  save();
  closeModal('modal-day-course');
  renderGrid();
  toast(`"${label}" added to ${selectedDays.length} day${selectedDays.length > 1 ? 's' : ''}`);
}

/* ── CARD CONTEXT MENU ───────────────────────────────────── */
function openCardMenu(btn, student, day) {
  closeAllDropdowns();

  const menu = document.createElement('div');
  menu.className = 'dropdown-menu dropdown-menu-portal';
  menu.innerHTML = `
    <button class="dropdown-item" data-action="add-day">＋  Add Course (this day)</button>
    <button class="dropdown-item" data-action="edit-defaults">📚  Edit Default Courses</button>
    <button class="dropdown-item" data-action="edit-name">✏️  Edit Name</button>
    <button class="dropdown-item" data-action="hide-day">🚫  Hide card this day</button>
    <button class="dropdown-item danger" data-action="delete">🗑  Remove Student</button>
  `;

  // Position relative to button
  const rect = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top  = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  document.body.appendChild(menu);

  menu.querySelector('[data-action="add-day"]').addEventListener('click', () => {
    closeAllDropdowns(); openAddDayCourseModal(student.id, day);
  });
  menu.querySelector('[data-action="edit-defaults"]').addEventListener('click', () => {
    closeAllDropdowns(); openCoursesModal(student.id);
  });
  menu.querySelector('[data-action="edit-name"]').addEventListener('click', () => {
    closeAllDropdowns(); editStudentName(student.id);
  });
  menu.querySelector('[data-action="hide-day"]').addEventListener('click', () => {
    closeAllDropdowns();
    const wk = state.currentWeekKey;
    if (!state.hidden[wk]) state.hidden[wk] = {};
    if (!state.hidden[wk][student.id]) state.hidden[wk][student.id] = [];
    if (!state.hidden[wk][student.id].includes(day)) {
      state.hidden[wk][student.id].push(day);
    }
    save(); renderGrid();
    toast(`${student.name} hidden on ${day}`);
  });
  menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
    closeAllDropdowns();
    if (confirm(`Remove "${student.name}" from the tracker?`)) {
      state.students = state.students.filter(s => s.id !== student.id);
      save(); renderGrid(); toast(`${student.name} removed`);
    }
  });

  setTimeout(() => document.addEventListener('click', closeAllDropdowns, { once: true }), 0);
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu').forEach(m => m.remove());
}

function editStudentName(id) {
  const student = state.students.find(s => s.id === id);
  if (!student) return;
  const name = prompt('Student name:', student.name);
  if (name && name.trim()) { student.name = name.trim(); save(); renderGrid(); }
}

/* ── MANAGE STUDENTS MODAL ───────────────────────────────── */
document.getElementById('btn-manage').addEventListener('click', () => openManageStudents());

function openManageStudents() {
  renderStudentList();
  showModal('modal-students');
}

function renderStudentList() {
  const list = document.getElementById('student-list-editor');
  list.innerHTML = '';

  if (state.students.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:12px 0">No students yet. Add one below.</p>';
    return;
  }

  state.students.forEach(student => {
    const row = document.createElement('div');
    row.className = 'student-editor-row';
    const color = PALETTE[student.colorIndex % PALETTE.length];
    row.innerHTML = `
      <div class="student-color-dot" style="background:${color}"></div>
      <input class="input-inline" value="${escHtml(student.name)}" placeholder="Student name">
      <button class="btn btn-sm btn-ghost" data-action="courses">Default Courses</button>
      <button class="btn-icon" data-action="delete" title="Remove">🗑</button>
    `;
    const input = row.querySelector('input');
    input.addEventListener('blur', () => {
      if (input.value.trim()) { student.name = input.value.trim(); save(); renderGrid(); }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    row.querySelector('[data-action="courses"]').addEventListener('click', () => {
      closeModal('modal-students'); openCoursesModal(student.id);
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', () => {
      if (confirm(`Remove "${student.name}"?`)) {
        state.students = state.students.filter(s => s.id !== student.id);
        save(); renderGrid(); renderStudentList();
        toast(`${student.name} removed`);
      }
    });
    list.appendChild(row);
  });
}

document.getElementById('btn-add-student').addEventListener('click', () => {
  const name = prompt('New student name:');
  if (!name || !name.trim()) return;
  const usedColors = state.students.map(s => s.colorIndex);
  let colorIndex = 0;
  for (let i = 0; i < PALETTE.length; i++) {
    if (!usedColors.includes(i)) { colorIndex = i; break; }
  }
  state.students.push({ id: uid(), name: name.trim(), colorIndex, courses: [] });
  save(); renderGrid(); renderStudentList();
  toast(`${name.trim()} added`);
});

/* ── DEFAULT COURSES MODAL ───────────────────────────────── */
function openCoursesModal(studentId) {
  state.editingStudentId = studentId;
  const student = state.students.find(s => s.id === studentId);
  document.getElementById('courses-modal-title').textContent = `${student.name} — Default Courses`;
  renderCourseList(student);
  showModal('modal-courses');
}

function renderCourseList(student) {
  const list = document.getElementById('course-list-editor');
  list.innerHTML = '';

  const note = document.createElement('p');
  note.style.cssText = 'font-size:0.78rem;color:var(--text-muted);margin-bottom:12px;line-height:1.5';
  note.textContent = 'Default courses appear on every day of the week. To hide or add a course on a specific day, use the ＋ button on any card.';
  list.appendChild(note);

  if (!student.courses || student.courses.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--text-muted);font-size:0.85rem;text-align:center;padding:12px 0';
    empty.textContent = 'No default courses yet.';
    list.appendChild(empty);
    return;
  }

  student.courses.forEach(course => {
    const row = document.createElement('div');
    row.className = 'course-editor-row';
    row.innerHTML = `
      <input class="input-inline" value="${escHtml(course.label)}" placeholder="Course name">
      <button class="btn-icon" data-action="delete" title="Remove">🗑</button>
    `;
    const input = row.querySelector('input');
    input.addEventListener('blur', () => {
      if (input.value.trim()) { course.label = input.value.trim(); save(); renderGrid(); }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    row.querySelector('[data-action="delete"]').addEventListener('click', () => {
      student.courses = student.courses.filter(c => c.id !== course.id);
      save(); renderGrid(); renderCourseList(student);
    });
    list.appendChild(row);
  });
}

document.getElementById('btn-add-course').addEventListener('click', () => {
  const student = state.students.find(s => s.id === state.editingStudentId);
  if (!student) return;
  const label = prompt('New default course name:');
  if (!label || !label.trim()) return;
  if (!student.courses) student.courses = [];
  student.courses.push({ id: uid(), label: label.trim() });
  save(); renderGrid(); renderCourseList(student);
});

/* ── CLOSE WEEK / ARCHIVE ────────────────────────────────── */
document.getElementById('btn-close-week').addEventListener('click', () => {
  const wk = state.currentWeekKey;
  if (state.archive.find(a => a.weekKey === wk)) { toast('This week is already archived.'); return; }
  if (!confirm(`Archive the week of ${weekLabel(wk)}?`)) return;

  const snapshot = {
    students : JSON.parse(JSON.stringify(state.students)),
    checks   : JSON.parse(JSON.stringify(state.weeks[wk]     || {})),
    overrides: JSON.parse(JSON.stringify(state.overrides[wk] || {})),
    removals : JSON.parse(JSON.stringify(state.removals[wk]  || {})),
    hidden   : JSON.parse(JSON.stringify(state.hidden[wk]    || {})),
  };

  state.archive.unshift({
    weekKey: wk, label: weekLabel(wk), snapshot, closedAt: new Date().toISOString(),
  });

  state.weeks[wk]     = {};
  state.overrides[wk] = {};
  state.removals[wk]  = {};
  state.hidden[wk]    = {};

  const nextMon = new Date(wk + 'T00:00:00');
  nextMon.setDate(nextMon.getDate() + 7);
  state.currentWeekKey = getWeekKey(nextMon);

  save(); updateWeekLabel(); renderGrid();
  autoExportOnCloseWeek(weekLabel(wk));
  toast('Week archived ✓ — backup downloaded');
});

/* ── ARCHIVE VIEW — see archive.html + archive.js ── */

/* ── MODAL HELPERS ───────────────────────────────────────── */
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target === bd) closeModal(bd.id); });
});

/* ── TOAST ───────────────────────────────────────────────── */
let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
}

/* ── UTILS ───────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updateWeekLabel() {
  document.getElementById('week-label').textContent = 'Week of ' + weekLabel(state.currentWeekKey);
}

/* ── INIT ────────────────────────────────────────────────── */
function init() {
  load();
  state.currentWeekKey = getWeekKey();
  updateWeekLabel();
  renderGrid();
  checkPeriodicExport();
}

init();
