/* ─────────────────────────────────────────────────────────────
   app.js — Admin Tracker (Supabase version)
   Reads/writes to Supabase. No localStorage.
   ───────────────────────────────────────────────────────────── */

import { supabase }                              from './supabase.js';
import { requireAdmin, logout }                  from './auth.js';
import { autoExportOnCloseWeek, checkPeriodicExport } from './export.js';

/* ── CONSTANTS ─────────────────────────────────────────────── */
const DAYS      = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const PALETTE   = ['#fde8c8','#d8edf8','#d8f0e4','#ede0f8','#fde0e0','#e0f4f8'];
const PALETTE_H = ['#e8a040','#4a90d9','#3aaa60','#8a50d0','#d06060','#30a0b8'];

/* ── STATE ─────────────────────────────────────────────────── */
let adminProfile = null;
let students     = [];   // [{id, name, color_index}]
let instances    = [];   // all week_instance rows for current week
let hiddenCards  = {};   // studentId → [day,...]
let weekKey      = '';

/* ── WEEK KEY ───────────────────────────────────────────────── */
function getWeekKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
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

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── LOAD DATA ──────────────────────────────────────────────── */
async function loadStudents() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .order('name');
  if (error) { console.error('loadStudents:', error); return; }
  students = data || [];
}

async function loadInstances() {
  if (students.length === 0) return;
  const { data, error } = await supabase
    .from('week_instances')
    .select('*')
    .eq('week_key', weekKey)
    .in('student_id', students.map(s => s.id));
  if (error) { console.error('loadInstances:', error); return; }
  instances = data || [];
}

async function loadHiddenCards() {
  if (students.length === 0) return;
  const { data, error } = await supabase
    .from('week_cards')
    .select('*')
    .eq('week_key', weekKey)
    .eq('hidden', true)
    .in('student_id', students.map(s => s.id));
  if (error) { console.error('loadHiddenCards:', error); return; }

  hiddenCards = {};
  students.forEach(s => { hiddenCards[s.id] = []; });
  (data || []).forEach(row => {
    if (hiddenCards[row.student_id]) hiddenCards[row.student_id].push(row.day);
  });
}

/* ── INSTANCE HELPERS ───────────────────────────────────────── */
function instancesForStudentDay(studentId, day) {
  return instances.filter(i =>
    i.student_id === studentId &&
    i.day === day &&
    !i.hidden
  );
}

function isCardHidden(studentId, day) {
  return (hiddenCards[studentId] || []).includes(day);
}

/* ── RENDER GRID ────────────────────────────────────────────── */
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

    students.forEach(student => {
      if (isCardHidden(student.id, day)) {
        cards.appendChild(buildHiddenPlaceholder(student, day));
      } else {
        cards.appendChild(buildCard(student, day));
      }
    });

    col.appendChild(cards);
    grid.appendChild(col);
  });

  renderSummaryStrip();
}

/* ── BUILD CARD ─────────────────────────────────────────────── */
function buildCard(student, day) {
  const dayInstances = instancesForStudentDay(student.id, day);
  const bg      = PALETTE[student.color_index % PALETTE.length];
  const accent  = PALETTE_H[student.color_index % PALETTE_H.length];
  const initials= student.name.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);

  const card = document.createElement('div');
  card.className = 'student-card';
  card.dataset.studentId = student.id;
  card.dataset.day = day;

  /* header */
  const hdr = document.createElement('div');
  hdr.className = 'card-header';
  hdr.style.background = bg;
  hdr.innerHTML = `
    <div class="card-header-left">
      <div class="card-avatar" style="color:${accent}">${initials}</div>
      <span class="card-name" style="color:${accent}">${escHtml(student.name)}</span>
    </div>
    <div class="card-actions">
      <button class="btn-icon" title="More options" data-action="more">•••</button>
    </div>
  `;

  hdr.querySelector('[data-action="more"]').addEventListener('click', e => {
    e.stopPropagation();
    openCardMenu(e.currentTarget, student, day);
  });

  card.appendChild(hdr);

  /* body */
  const body = document.createElement('div');
  body.className = 'card-body';

  if (dayInstances.length === 0) {
    body.innerHTML = `<div class="card-empty">No courses assigned.<br><small>Use <strong>📅 Plan Week</strong> to assign courses.</small></div>`;
  } else {
    dayInstances.forEach(inst => {
      body.appendChild(buildCourseItem(card, student, day, inst));
    });
  }

  card.appendChild(body);

  /* progress bar */
  if (dayInstances.length > 0) {
    card.appendChild(buildProgressBar(dayInstances));
  }

  return card;
}

/* ── COURSE ITEM ────────────────────────────────────────────── */
function buildCourseItem(card, student, day, inst) {
  const item = document.createElement('div');
  item.className = 'course-item' + (inst.completed ? ' done' : '');

  const cbId = `cb-${inst.id}`;
  item.innerHTML = `
    <label for="${cbId}">
      <input type="checkbox" id="${cbId}" ${inst.completed ? 'checked' : ''}>
      <span class="course-label">${escHtml(inst.label)}</span>
    </label>
  `;

  item.querySelector('input').addEventListener('change', async ev => {
    const val = ev.target.checked;
    item.classList.toggle('done', val);
    inst.completed = val;

    const { error } = await supabase
      .from('week_instances')
      .update({ completed: val })
      .eq('id', inst.id);

    if (error) {
      console.error('update error:', error);
      ev.target.checked = !val;
      item.classList.toggle('done', !val);
      inst.completed = !val;
      toast('Failed to save — try again');
      return;
    }

    const prog = card.querySelector('.card-progress');
    if (prog) refreshProgressBar(prog, instancesForStudentDay(student.id, day));
    updateSummaryStudent(student.id);
  });

  return item;
}

/* ── PROGRESS BAR ───────────────────────────────────────────── */
function buildProgressBar(dayInstances) {
  const total = dayInstances.length;
  const done  = dayInstances.filter(i => i.completed).length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);
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

function refreshProgressBar(progEl, dayInstances) {
  const total = dayInstances.length;
  const done  = dayInstances.filter(i => i.completed).length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);
  const fill  = progEl.querySelector('.progress-bar-fill');
  const lbl   = progEl.querySelector('.progress-label');
  if (fill) fill.style.width = pct + '%';
  if (lbl)  lbl.textContent  = `${done}/${total}`;
}

/* ── HIDDEN CARD PLACEHOLDER ────────────────────────────────── */
function buildHiddenPlaceholder(student, day) {
  const bg     = PALETTE[student.color_index % PALETTE.length];
  const accent = PALETTE_H[student.color_index % PALETTE_H.length];
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

  wrap.querySelector('.card-restore-btn').addEventListener('click', async () => {
    const { error } = await supabase
      .from('week_cards')
      .update({ hidden: false })
      .eq('week_key', weekKey)
      .eq('student_id', student.id)
      .eq('day', day);

    if (error) { toast('Failed to restore card'); return; }

    hiddenCards[student.id] = (hiddenCards[student.id] || []).filter(d => d !== day);
    const parent = wrap.parentNode;
    parent.replaceChild(buildCard(student, day), wrap);
    renderSummaryStrip();
  });

  return wrap;
}

/* ── CARD CONTEXT MENU ──────────────────────────────────────── */
function openCardMenu(btn, student, day) {
  closeAllDropdowns();

  const menu = document.createElement('div');
  menu.className = 'dropdown-menu dropdown-menu-portal';
  menu.innerHTML = `
    <button class="dropdown-item" data-action="hide-day">🚫  Hide card this day</button>
    <button class="dropdown-item" data-action="edit-name">✏️  Rename Student</button>
    <button class="dropdown-item danger" data-action="delete">🗑  Remove Student</button>
  `;

  const rect = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top  = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  document.body.appendChild(menu);

  menu.querySelector('[data-action="hide-day"]').addEventListener('click', async () => {
    closeAllDropdowns();

    // Upsert week_cards hidden row
    const { error } = await supabase
      .from('week_cards')
      .upsert({
        week_key   : weekKey,
        student_id : student.id,
        day,
        hidden     : true,
      }, { onConflict: 'week_key,student_id,day' });

    if (error) { toast('Failed to hide card'); console.error(error); return; }

    if (!hiddenCards[student.id]) hiddenCards[student.id] = [];
    if (!hiddenCards[student.id].includes(day)) hiddenCards[student.id].push(day);

    renderGrid();
    toast(`${student.name} hidden on ${day}`);
  });

  menu.querySelector('[data-action="edit-name"]').addEventListener('click', () => {
    closeAllDropdowns();
    editStudentName(student);
  });

  menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    closeAllDropdowns();
    if (!confirm(`Remove "${student.name}" from the tracker? This cannot be undone.`)) return;

    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', student.id);

    if (error) { toast('Failed to remove student'); return; }

    students = students.filter(s => s.id !== student.id);
    renderGrid();
    renderStudentList();
    toast(`${student.name} removed`);
  });

  setTimeout(() => document.addEventListener('click', closeAllDropdowns, { once: true }), 0);
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu').forEach(m => m.remove());
}

async function editStudentName(student) {
  const name = prompt('Student name:', student.name);
  if (!name || !name.trim()) return;

  const { error } = await supabase
    .from('profiles')
    .update({ name: name.trim() })
    .eq('id', student.id);

  if (error) { toast('Failed to update name'); return; }

  student.name = name.trim();
  renderGrid();
  renderStudentList();
}

/* ── SUMMARY STRIP ──────────────────────────────────────────── */
function renderSummaryStrip() {
  const strip = document.getElementById('summary-strip');
  if (!strip) return;
  strip.innerHTML = '';
  if (students.length === 0) return;

  const card = document.createElement('div');
  card.className = 'summary-card';

  students.forEach(student => {
    const studentInstances = instances.filter(i =>
      i.student_id === student.id && !i.hidden &&
      !(hiddenCards[student.id] || []).includes(i.day)
    );
    const total = studentInstances.length;
    const done  = studentInstances.filter(i => i.completed).length;
    const pct   = total === 0 ? 0 : Math.round((done / total) * 100);

    const bg      = PALETTE[student.color_index % PALETTE.length];
    const accent  = PALETTE_H[student.color_index % PALETTE_H.length];
    const initials= student.name.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const fillClass = pct >= 80 ? '' : pct >= 40 ? 'warn' : 'low';
    const pctColor  = pct >= 80 ? 'var(--success)' : pct >= 40 ? 'var(--warn)' : 'var(--danger)';

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

  const student = students.find(s => s.id === studentId);
  if (!student) return;

  const studentInstances = instances.filter(i =>
    i.student_id === studentId && !i.hidden &&
    !(hiddenCards[studentId] || []).includes(i.day)
  );
  const total = studentInstances.length;
  const done  = studentInstances.filter(i => i.completed).length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);

  const fillClass = pct >= 80 ? '' : pct >= 40 ? 'warn' : 'low';
  const pctColor  = pct >= 80 ? 'var(--success)' : pct >= 40 ? 'var(--warn)' : 'var(--danger)';

  const el = strip.querySelector(`.summary-card [data-student-id="${studentId}"]`);
  if (!el) return;

  const fill = el.querySelector('.summary-bar-fill');
  const frac = el.querySelector('.summary-fraction');
  const pctEl = el.querySelector('.summary-pct');

  if (fill)  { fill.style.width = pct + '%'; fill.className = `summary-bar-fill ${fillClass}`; }
  if (frac)  frac.textContent = `${done}/${total}`;
  if (pctEl) { pctEl.textContent = pct + '%'; pctEl.style.color = pctColor; }
}

/* ── MANAGE STUDENTS MODAL ──────────────────────────────────── */
document.getElementById('btn-manage').addEventListener('click', () => {
  renderStudentList();
  showModal('modal-students');
});

function renderStudentList() {
  const list = document.getElementById('student-list-editor');
  list.innerHTML = '';

  if (students.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:12px 0">No students yet.</p>';
    return;
  }

  students.forEach(student => {
    const color = PALETTE[student.color_index % PALETTE.length];
    const row = document.createElement('div');
    row.className = 'student-editor-row';
    row.innerHTML = `
      <div class="student-color-dot" style="background:${color}"></div>
      <input class="input-inline" value="${escHtml(student.name)}" placeholder="Student name">
      <button class="btn-icon" data-action="delete" title="Remove">🗑</button>
    `;

    const input = row.querySelector('input');
    input.addEventListener('blur', async () => {
      if (!input.value.trim() || input.value.trim() === student.name) return;
      const { error } = await supabase
        .from('profiles')
        .update({ name: input.value.trim() })
        .eq('id', student.id);
      if (error) { toast('Failed to update name'); return; }
      student.name = input.value.trim();
      renderGrid();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });

    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`Remove "${student.name}"? This cannot be undone.`)) return;
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', student.id);
      if (error) { toast('Failed to remove student'); return; }
      students = students.filter(s => s.id !== student.id);
      renderGrid();
      renderStudentList();
      toast(`${student.name} removed`);
    });

    list.appendChild(row);
  });
}

/* ── CLOSE WEEK ─────────────────────────────────────────────── */
document.getElementById('btn-close-week').addEventListener('click', async () => {
  if (!confirm(`Archive the week of ${weekLabel(weekKey)}?`)) return;

  // Insert archive_week row
  const { data: archiveWeek, error: awError } = await supabase
    .from('archive_weeks')
    .insert({
      week_key  : weekKey,
      label     : weekLabel(weekKey),
      closed_by : adminProfile.id,
    })
    .select()
    .single();

  if (awError) {
    if (awError.code === '23505') { toast('This week is already archived.'); return; }
    toast('Failed to archive week');
    console.error(awError);
    return;
  }

  // Copy instances to archive_instances
  if (instances.length > 0) {
    const archiveRows = instances.map(inst => {
      const student = students.find(s => s.id === inst.student_id);
      return {
        archive_week_id : archiveWeek.id,
        student_id      : inst.student_id,
        student_name    : student ? student.name : 'Unknown',
        label           : inst.label,
        day             : inst.day,
        completed       : inst.completed,
        hidden          : inst.hidden,
      };
    });

    const { error: aiError } = await supabase
      .from('archive_instances')
      .insert(archiveRows);

    if (aiError) { console.error('archive_instances insert:', aiError); }
  }

  // Auto-export JSON backup
  autoExportOnCloseWeek(weekLabel(weekKey));

  // Advance to next week
  const nextMon = new Date(weekKey + 'T00:00:00');
  nextMon.setDate(nextMon.getDate() + 7);
  weekKey = getWeekKey(nextMon);

  // Reload
  await loadInstances();
  await loadHiddenCards();
  updateWeekLabel();
  renderGrid();
  toast('Week archived ✓ — backup downloaded');
});

/* ── MODAL HELPERS ──────────────────────────────────────────── */
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target === bd) closeModal(bd.id); });
});

/* ── TOAST ──────────────────────────────────────────────────── */
let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
}

/* ── WEEK LABEL ─────────────────────────────────────────────── */
function updateWeekLabel() {
  document.getElementById('week-label').textContent = 'Week of ' + weekLabel(weekKey);
}

/* ── INIT ───────────────────────────────────────────────────── */
async function init() {
  adminProfile = await requireAdmin();
  if (!adminProfile) return;

  weekKey = getWeekKey();
  updateWeekLabel();

  await loadStudents();
  await loadInstances();
  await loadHiddenCards();

  renderGrid();

  document.getElementById('btn-logout').addEventListener('click', logout);
  checkPeriodicExport();
}

init();
