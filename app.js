/* ─────────────────────────────────────────────────────────────
   app.js — Admin Tracker (Supabase version)
   Reads/writes to Supabase. No localStorage.
   ───────────────────────────────────────────────────────────── */

import { supabase }                              from './supabase.js';
import { requireAdmin, logout }                  from './auth.js';
import { autoExportOnCloseWeek, checkPeriodicExport } from './export.js';
import { addWeeks, weekLabel, isCalendarWeek, isWeekClosed,
         resolveActiveWeekKey, weekKeyFromURL } from './week.js';

/* ── CONSTANTS ─────────────────────────────────────────────── */
const DAYS      = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const PALETTE   = ['#fde8c8','#d8edf8','#d8f0e4','#ede0f8','#fde0e0','#e0f4f8'];
const PALETTE_H = ['#e8a040','#4a90d9','#3aaa60','#8a50d0','#d06060','#30a0b8'];

/* ── STATE ─────────────────────────────────────────────────── */
let adminProfile = null;
let students     = [];   // [{id, name, color_index}]
let library      = [];   // active course_definitions rows for all students
let instances    = [];   // all week_instance rows for current week
let notes        = {};   // 'studentId|day' → day_notes row
let breaks       = [];   // breaks rows overlapping the current week
let weekKey      = '';   // the week being shown
let activeKey    = '';   // the week the household is working on (first unclosed)
let readOnly     = false; // true when weekKey is already archived

/* ── WEEK KEY ───────────────────────────────────────────────── */
/* getWeekKey / addWeeks / weekLabel now live in week.js */

function isDayToday(di) {
  if (!isCalendarWeek(weekKey)) return false;   // viewing a future week
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

async function loadLibrary() {
  if (students.length === 0) { library = []; return; }
  const { data, error } = await supabase
    .from('course_definitions')
    .select('*')
    .eq('active', true)
    .in('student_id', students.map(s => s.id))
    .order('label');
  if (error) { console.error('loadLibrary:', error); return; }
  library = data || [];
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

async function loadNotes() {
  notes = {};
  if (students.length === 0) return;
  const { data, error } = await supabase
    .from('day_notes')
    .select('*')
    .eq('week_key', weekKey)
    .in('student_id', students.map(s => s.id));
  if (error) { console.error('loadNotes:', error); return; }
  (data || []).forEach(n => { notes[`${n.student_id}|${n.day}`] = n; });
}

/* Any break that touches Mon–Fri of this week */
async function loadBreaks() {
  const { data, error } = await supabase
    .from('breaks')
    .select('*')
    .lte('start_date', dateForDay('Friday'))
    .gte('end_date',   dateForDay('Monday'));
  if (error) { console.error('loadBreaks:', error); breaks = []; return; }
  breaks = data || [];
}

/* ── DATE HELPERS ───────────────────────────────────────────── */
/* 'Tuesday' in week '2026-10-05' → '2026-10-06' */
function dateForDay(day) {
  const d = new Date(weekKey + 'T00:00:00');
  d.setDate(d.getDate() + DAYS.indexOf(day));
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/* ── DAY-OFF HELPERS ────────────────────────────────────────── */
/* All-students break covering this day, or null */
function allOffBreak(day) {
  const date = dateForDay(day);
  return breaks.find(b => b.student_id === null &&
    b.start_date <= date && b.end_date >= date) || null;
}

/* The break that takes this student off this day, or null.
   An all-students break wins over a single-student one. */
function offBreakFor(studentId, day) {
  const all = allOffBreak(day);
  if (all) return all;
  const date = dateForDay(day);
  return breaks.find(b => b.student_id === studentId &&
    b.start_date <= date && b.end_date >= date) || null;
}

function isOff(studentId, day) {
  return !!offBreakFor(studentId, day);
}

/* ── INSTANCE HELPERS ───────────────────────────────────────── */
function instancesForStudentDay(studentId, day) {
  return instances.filter(i =>
    i.student_id === studentId &&
    i.day === day &&
    !i.hidden
  );
}

/* Rows that count toward totals: visible and not on a day off */
function countedInstances(studentId) {
  return instances.filter(i =>
    i.student_id === studentId && !i.hidden && !isOff(studentId, i.day)
  );
}

function noteFor(studentId, day) {
  return notes[`${studentId}|${day}`] || null;
}

/* ── COURSE LIBRARY HELPERS ─────────────────────────────────── */
/* A student's default courses = their whole course library
   (the same list the Plan Week page shows). */
function defaultsFor(studentId) {
  return library
    .filter(c => c.student_id === studentId)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function findDefByLabel(studentId, label) {
  const key = label.trim().toLowerCase();
  return library.find(c => c.student_id === studentId && c.label.toLowerCase() === key);
}

/* Reuse an existing course definition with the same name, or create one. */
async function findOrCreateDef(studentId, label) {
  const existing = findDefByLabel(studentId, label);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('course_definitions')
    .insert({
      student_id : studentId,
      label,
      days       : [],
      active     : true,
      repeating  : true,   // "temp" no longer used; kept true for consistency
    })
    .select()
    .single();

  if (error) throw error;
  library.push(data);
  return data;
}

/* Make sure `def` shows on each of `days` this week.
   - no instance yet  → insert one
   - hidden instance  → un-hide it (e.g. after the row ✕)
   - visible instance → leave it alone
   Returns how many days actually changed. */
async function ensureInstances(studentId, def, days) {
  const toInsert = [];
  const toUnhide = [];

  days.forEach(day => {
    const existing = instances.find(i =>
      i.student_id === studentId &&
      i.course_def_id === def.id &&
      i.day === day
    );
    if (!existing) {
      toInsert.push({
        week_key      : weekKey,
        student_id    : studentId,
        course_def_id : def.id,
        label         : def.label,
        day,
        completed     : false,
        hidden        : false,
      });
    } else if (existing.hidden) {
      toUnhide.push(existing);
    }
  });

  if (toInsert.length) {
    const { data, error } = await supabase
      .from('week_instances')
      .insert(toInsert)
      .select();
    if (error) throw error;
    instances.push(...(data || []));
  }

  if (toUnhide.length) {
    const { error } = await supabase
      .from('week_instances')
      .update({ hidden: false })
      .in('id', toUnhide.map(i => i.id));
    if (error) throw error;
    toUnhide.forEach(i => { i.hidden = false; });
  }

  return toInsert.length + toUnhide.length;
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

    const allOff = allOffBreak(day);
    if (allOff) col.appendChild(buildDayOffBanner(allOff));

    const cards = document.createElement('div');
    cards.className = 'day-cards';

    students.forEach(student => {
      const off = offBreakFor(student.id, day);
      cards.appendChild(off
        ? buildOffCard(student, day, off, !!allOff)
        : buildCard(student, day));
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

  /* header — only the ••• menu, no separate + button */
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
    body.innerHTML = `<div class="card-empty">No courses assigned.<br><small>Use <strong>•••</strong> → <strong>+ Add Course</strong> or <strong>📅 Plan Week</strong>.</small></div>`;
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

  /* note callout */
  const note = noteFor(student.id, day);
  if (note) {
    const n = document.createElement('div');
    n.className = 'card-note';
    n.innerHTML = `<span class="card-note-icon">📝</span><span>${escHtml(note.note)}</span>`;
    if (!readOnly) {
      n.title = 'Edit note';
      n.addEventListener('click', () => openNoteModal(student, day));
    }
    card.appendChild(n);
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
      <input type="checkbox" id="${cbId}" ${inst.completed ? 'checked' : ''} ${readOnly ? 'disabled' : ''}>
      <span class="course-label">${escHtml(inst.label)}</span>
    </label>
    <button class="btn-icon course-remove" type="button"
      title="Hide on ${day}" aria-label="Hide ${escHtml(inst.label)} on ${day}">✕</button>
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

  item.querySelector('.course-remove').addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    hideInstanceOnDay(inst, student, day, card);
  });

  return item;
}

/* Row ✕ — hides this course on this day only. The course definition
   and the other days are untouched. */
async function hideInstanceOnDay(inst, student, day, card) {
  const { error } = await supabase
    .from('week_instances')
    .update({ hidden: true })
    .eq('id', inst.id);

  if (error) { console.error('hide instance:', error); toast('Failed to hide course'); return; }

  inst.hidden = true;
  card.replaceWith(buildCard(student, day));
  updateSummaryStudent(student.id);
  toast(`"${inst.label}" hidden on ${day}`);
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

/* ── DAY OFF: BANNER (all students) ─────────────────────────── */
function buildDayOffBanner(brk) {
  const el = document.createElement('div');
  el.className = 'day-off-banner';
  el.innerHTML = `
    <div class="day-off-banner-top">
      <span class="day-off-tag">🌙 Day off · all students</span>
      <button class="btn-icon day-off-remove" title="Remove day off">↩</button>
    </div>
    ${brk.reason ? `<div class="day-off-reason">${escHtml(brk.reason)}</div>` : ''}
  `;
  el.querySelector('.day-off-remove').addEventListener('click', () => removeBreak(brk));
  return el;
}

/* ── DAY OFF: COLLAPSED CARD ────────────────────────────────── */
/* underBanner = the banner above already gives the reason,
   so the card just says "Off". */
function buildOffCard(student, day, brk, underBanner) {
  const initials = student.name.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);

  const card = document.createElement('div');
  card.className = 'student-card card-off';

  const showReason = !underBanner && brk.reason;
  card.innerHTML = `
    <div class="card-header card-header-off">
      <div class="card-header-left">
        <div class="card-avatar">${initials}</div>
        <span class="card-name">${escHtml(student.name)}</span>
      </div>
      ${underBanner ? '' : '<button class="btn-icon card-restore-btn" title="Remove day off">↩</button>'}
    </div>
    ${showReason
      ? `<div class="card-off-reason"><span class="day-off-tag">🌙 Day off</span>${escHtml(brk.reason)}</div>`
      : `<div class="card-off-msg">🌙 Off</div>`}
  `;

  const restore = card.querySelector('.card-restore-btn');
  if (restore) restore.addEventListener('click', () => removeBreak(brk));

  return card;
}

/* Undo a day off from the tracker. Only one-day breaks can be
   removed here — a multi-day planned break is managed in Plan Week,
   so one click can't wipe out all of Thanksgiving. */
async function removeBreak(brk) {
  if (readOnly) return;
  if (brk.start_date !== brk.end_date) {
    toast('This is part of a planned break — change it in Plan Week');
    return;
  }
  if (!confirm('Remove this day off? The day\'s courses will count again.')) return;

  const { error } = await supabase.from('breaks').delete().eq('id', brk.id);
  if (error) { console.error('remove break:', error); toast('Failed to remove day off'); return; }

  breaks = breaks.filter(b => b.id !== brk.id);
  renderGrid();
  toast('Day off removed');
}

/* ── CARD CONTEXT MENU ──────────────────────────────────────── */
function openCardMenu(btn, student, day) {
  closeAllDropdowns();

  const menu = document.createElement('div');
  menu.className = 'dropdown-menu dropdown-menu-portal';
  const hasNote = !!noteFor(student.id, day);
  menu.innerHTML = `
    <button class="dropdown-item" data-action="add-course">+  Add Course</button>
    <button class="dropdown-item" data-action="note">📝  ${hasNote ? 'Edit Note' : 'Add Note'}</button>
    <button class="dropdown-item" data-action="day-off">🌙  Mark Day Off</button>
    <button class="dropdown-item" data-action="edit-defaults">📚  Edit Default Courses</button>
    <button class="dropdown-item" data-action="edit-name">✏️  Edit Name</button>
    <button class="dropdown-item danger" data-action="delete">🗑  Remove Student</button>
  `;

  const rect = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top  = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  document.body.appendChild(menu);

  menu.querySelector('[data-action="add-course"]').addEventListener('click', () => {
    closeAllDropdowns();
    openAddCourseModal(student, day);
  });

  menu.querySelector('[data-action="edit-defaults"]').addEventListener('click', () => {
    closeAllDropdowns();
    openDefaultsModal(student);
  });

  menu.querySelector('[data-action="note"]').addEventListener('click', () => {
    closeAllDropdowns();
    openNoteModal(student, day);
  });

  menu.querySelector('[data-action="day-off"]').addEventListener('click', () => {
    closeAllDropdowns();
    openDayOffModal(student, day);
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

/* ── NOTE MODAL ─────────────────────────────────────────────── */
let _noteStudent = null;
let _noteDay     = null;
let _noteSaving  = false;

function openNoteModal(student, day) {
  _noteStudent = student;
  _noteDay     = day;
  const existing = noteFor(student.id, day);

  document.getElementById('note-title').textContent = `Note for ${student.name} · ${day}`;
  document.getElementById('note-text').value = existing ? existing.note : '';
  document.getElementById('note-delete').classList.toggle('hidden', !existing);

  showModal('modal-note');
  setTimeout(() => document.getElementById('note-text').focus(), 60);
}

document.getElementById('note-save').addEventListener('click', saveNote);
document.getElementById('note-delete').addEventListener('click', () => {
  document.getElementById('note-text').value = '';
  saveNote();
});
document.getElementById('note-text').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote();   // ⌘↩ saves
});

/* Empty text deletes the note; otherwise upsert one row per student/day/week */
async function saveNote() {
  if (_noteSaving) return;
  _noteSaving = true;

  const text = document.getElementById('note-text').value.trim();
  const key  = `${_noteStudent.id}|${_noteDay}`;

  try {
    if (!text) {
      if (notes[key]) {
        const { error } = await supabase.from('day_notes').delete().eq('id', notes[key].id);
        if (error) throw error;
        delete notes[key];
        toast('Note removed');
      }
    } else {
      const { data, error } = await supabase
        .from('day_notes')
        .upsert({
          week_key   : weekKey,
          student_id : _noteStudent.id,
          day        : _noteDay,
          note       : text,
          updated_at : new Date().toISOString(),
        }, { onConflict: 'week_key,student_id,day' })
        .select()
        .single();
      if (error) throw error;
      notes[key] = data;
      toast('Note saved');
    }
    closeModal('modal-note');
    renderGrid();
  } catch (err) {
    console.error('save note:', err);
    toast('Failed to save note — try again');
  } finally {
    _noteSaving = false;
  }
}

/* ── DAY OFF MODAL ──────────────────────────────────────────── */
let _offStudent = null;
let _offDay     = null;
let _offScope   = 'one';   // 'one' | 'all'
let _offSaving  = false;

function openDayOffModal(student, day) {
  _offStudent = student;
  _offDay     = day;
  _offScope   = 'one';

  document.getElementById('off-title').textContent = `Mark ${day} Off`;
  document.getElementById('off-just').textContent  = `Just ${student.name}`;
  document.getElementById('off-reason').value = '';
  syncOffScope();

  showModal('modal-day-off');
  setTimeout(() => document.getElementById('off-reason').focus(), 60);
}

function syncOffScope() {
  document.getElementById('off-just').classList.toggle('active', _offScope === 'one');
  document.getElementById('off-all').classList.toggle('active',  _offScope === 'all');
}

document.getElementById('off-just').addEventListener('click', () => { _offScope = 'one'; syncOffScope(); });
document.getElementById('off-all').addEventListener('click',  () => { _offScope = 'all'; syncOffScope(); });
document.getElementById('off-save').addEventListener('click', saveDayOff);
document.getElementById('off-reason').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveDayOff();
});

async function saveDayOff() {
  if (_offSaving) return;

  const date   = dateForDay(_offDay);
  const reason = document.getElementById('off-reason').value.trim() || null;
  const studentId = _offScope === 'all' ? null : _offStudent.id;

  // Already covered? (e.g. an all-students day off is already set)
  if (_offScope === 'all' ? allOffBreak(_offDay) : isOff(_offStudent.id, _offDay)) {
    toast('That day is already marked off');
    return;
  }

  _offSaving = true;
  const btn = document.getElementById('off-save');
  btn.disabled = true;

  try {
    const { data, error } = await supabase
      .from('breaks')
      .insert({
        start_date : date,
        end_date   : date,
        student_id : studentId,
        reason,
        created_by : adminProfile.id,
      })
      .select()
      .single();
    if (error) throw error;

    breaks.push(data);
    closeModal('modal-day-off');
    renderGrid();
    toast(_offScope === 'all'
      ? `${_offDay} marked off for all students`
      : `${_offStudent.name} marked off on ${_offDay}`);
  } catch (err) {
    console.error('day off:', err);
    toast('Failed to mark day off — try again');
  } finally {
    _offSaving = false;
    btn.disabled = false;
  }
}

/* ── ADD COURSE MODAL ───────────────────────────────────────── */
let _acStudent = null;
let _acDay     = null;
let _acSaving  = false;

function openAddCourseModal(student, day) {
  _acStudent = student;
  _acDay     = day;

  document.getElementById('ac-student-name').textContent = student.name;
  document.getElementById('ac-name').value = '';

  // Day pills — only the card's day starts selected
  const picker = document.getElementById('ac-day-picker');
  picker.innerHTML = '';
  DAYS.forEach(d => {
    const pill = document.createElement('label');
    pill.className = 'day-pill';
    pill.innerHTML = `
      <input type="checkbox" value="${d}" ${d === day ? 'checked' : ''}>
      <span>${d.slice(0,3)}</span>
    `;
    pill.querySelector('input').addEventListener('change', syncAcShortcuts);
    picker.appendChild(pill);
  });

  syncAcShortcuts();
  showModal('modal-add-course');
  setTimeout(() => document.getElementById('ac-name').focus(), 60);
}

function acSelectedDays() {
  return [...document.querySelectorAll('#ac-day-picker input:checked')].map(cb => cb.value);
}

function acSetDays(days) {
  document.querySelectorAll('#ac-day-picker input').forEach(cb => {
    cb.checked = days.includes(cb.value);
  });
  syncAcShortcuts();
}

/* Highlight a shortcut when the selection matches it exactly */
function syncAcShortcuts() {
  const sel = acSelectedDays();
  document.getElementById('ac-just-day')
    .classList.toggle('active', sel.length === 1 && sel[0] === _acDay);
  document.getElementById('ac-all-week')
    .classList.toggle('active', sel.length === DAYS.length);
}

document.getElementById('ac-just-day').addEventListener('click', () => acSetDays([_acDay]));
document.getElementById('ac-all-week').addEventListener('click', () => acSetDays(DAYS));
document.getElementById('ac-save').addEventListener('click', saveAddCourse);
document.getElementById('ac-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveAddCourse();
});

async function saveAddCourse() {
  if (_acSaving) return;

  const nameEl = document.getElementById('ac-name');
  const label  = nameEl.value.trim();
  if (!label) { nameEl.focus(); return; }

  const days = acSelectedDays();
  if (days.length === 0) { toast('Pick at least one day'); return; }

  _acSaving = true;
  const saveBtn = document.getElementById('ac-save');
  saveBtn.disabled = true;

  try {
    // Reuses an existing course with the same name (default or not);
    // otherwise creates a non-default ("temp") course in the library.
    const def     = await findOrCreateDef(_acStudent.id, label);
    const changed = await ensureInstances(_acStudent.id, def, days);

    closeModal('modal-add-course');
    renderGrid();
    toast(changed === 0
      ? `"${def.label}" is already on those days`
      : `"${def.label}" added for ${_acStudent.name}`);
  } catch (err) {
    console.error('add course:', err);
    toast('Failed to add course — try again');
  } finally {
    _acSaving = false;
    saveBtn.disabled = false;
  }
}

/* ── DEFAULT COURSES MODAL ──────────────────────────────────── */
let _defStudent = null;

function openDefaultsModal(student) {
  _defStudent = student;
  document.getElementById('def-title').textContent = `${student.name} — Default Courses`;
  renderDefaultsList();
  showModal('modal-defaults');
}

function renderDefaultsList() {
  const list = document.getElementById('def-list');
  list.innerHTML = '';

  const defs = defaultsFor(_defStudent.id);
  if (defs.length === 0) {
    list.innerHTML = '<p class="modal-empty">No courses yet.</p>';
    return;
  }
  defs.forEach(def => list.appendChild(buildDefaultRow(def)));
}

function buildDefaultRow(def) {
  const row = document.createElement('div');
  row.className = 'course-editor-row';
  row.innerHTML = `
    <input class="input-inline" value="${escHtml(def.label)}" placeholder="Course name">
    <button class="btn-icon" data-action="delete" title="Delete default course">🗑</button>
  `;

  const input = row.querySelector('input');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('blur', () => renameDefault(def, input));

  row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteDefault(def));
  return row;
}

async function renameDefault(def, input) {
  const label = input.value.trim();
  if (!label || label === def.label) { input.value = def.label; return; }

  const clash = findDefByLabel(def.student_id, label);
  if (clash && clash.id !== def.id) {
    toast(`"${clash.label}" already exists`);
    input.value = def.label;
    return;
  }

  const { error } = await supabase
    .from('course_definitions')
    .update({ label })
    .eq('id', def.id);
  if (error) { toast('Failed to rename course'); input.value = def.label; return; }

  // Keep this week's rows in step with the new name
  const { error: instErr } = await supabase
    .from('week_instances')
    .update({ label })
    .eq('week_key', weekKey)
    .eq('course_def_id', def.id);
  if (instErr) console.error('rename instances:', instErr);

  def.label = label;
  instances.forEach(i => { if (i.course_def_id === def.id) i.label = label; });
  renderGrid();
  toast('Course renamed');
}

async function deleteDefault(def) {
  if (!confirm(`Delete "${def.label}" from ${_defStudent.name}'s courses? It will also be removed from every day this week.`)) return;

  const { error: instErr } = await supabase
    .from('week_instances')
    .delete()
    .eq('week_key', weekKey)
    .eq('student_id', def.student_id)
    .eq('course_def_id', def.id);
  if (instErr) { console.error('delete instances:', instErr); toast('Failed to delete course'); return; }

  // Soft delete, same as the planner
  const { error } = await supabase
    .from('course_definitions')
    .update({ active: false })
    .eq('id', def.id);
  if (error) { toast('Failed to delete course'); return; }

  library   = library.filter(c => c.id !== def.id);
  instances = instances.filter(i => i.course_def_id !== def.id);
  renderDefaultsList();
  renderGrid();
  toast(`"${def.label}" deleted`);
}

/* "+ Add Course" in the defaults modal adds a blank row to type into */
document.getElementById('def-add').addEventListener('click', () => {
  const list  = document.getElementById('def-list');
  const empty = list.querySelector('.modal-empty');
  if (empty) empty.remove();

  const row = document.createElement('div');
  row.className = 'course-editor-row';
  row.innerHTML = `
    <input class="input-inline" placeholder="New course name">
    <button class="btn-icon" data-action="cancel" title="Cancel">🗑</button>
  `;
  list.appendChild(row);

  const input = row.querySelector('input');
  let done = false;

  const finish = async () => {
    if (done) return;
    done = true;
    const label = input.value.trim();
    if (!label) { row.remove(); if (!list.children.length) renderDefaultsList(); return; }
    input.disabled = true;
    await createDefault(_defStudent, label);
    renderDefaultsList();
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  input.blur();
    if (e.key === 'Escape') { input.value = ''; input.blur(); }
  });
  input.addEventListener('blur', finish);
  row.querySelector('[data-action="cancel"]').addEventListener('mousedown', e => {
    e.preventDefault();          // stop blur from saving first
    input.value = '';
    finish();
  });

  input.focus();
});

/* Adds the course to the student's library only. Days are assigned
   in Plan Week or with + Add Course on a card. */
async function createDefault(student, label) {
  try {
    if (findDefByLabel(student.id, label)) {
      toast(`"${label}" is already in ${student.name}'s courses`);
      return;
    }
    const def = await findOrCreateDef(student.id, label);
    toast(`"${def.label}" added to ${student.name}'s courses`);
  } catch (err) {
    console.error('create default:', err);
    toast('Failed to add course — try again');
  }
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
    const studentInstances = countedInstances(student.id);
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

  const studentInstances = countedInstances(studentId);
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
  // Only the current week can be closed — never a future or archived one
  if (weekKey !== activeKey || readOnly) return;
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

  // Snapshot days off (frozen — later edits to breaks won't change this week)
  const offRows = [];
  DAYS.forEach(day => {
    const all = allOffBreak(day);
    if (all) {
      offRows.push({ archive_week_id: archiveWeek.id, student_id: null,
                     student_name: null, day, reason: all.reason });
      return;
    }
    students.forEach(s => {
      const b = offBreakFor(s.id, day);
      if (b) offRows.push({ archive_week_id: archiveWeek.id, student_id: s.id,
                            student_name: s.name, day, reason: b.reason });
    });
  });
  if (offRows.length) {
    const { error: offErr } = await supabase.from('archive_days_off').insert(offRows);
    if (offErr) console.error('archive_days_off insert:', offErr);
  }

  // Copy instances to archive_instances — courses on a day off are
  // cancelled, so they aren't archived at all
  const toArchive = instances.filter(i => !isOff(i.student_id, i.day));
  if (toArchive.length > 0) {
    const archiveRows = toArchive.map(inst => {
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

  // Advance to next week (a reload lands here too, because
  // resolveActiveWeekKey() skips archived weeks)
  activeKey = addWeeks(weekKey, 1);
  weekKey   = activeKey;
  readOnly  = false;

  // Reload
  await loadInstances();
  await loadNotes();
  await loadBreaks();
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

  const isActive = weekKey === activeKey;

  // Plan Week opens the planner on the same week
  document.getElementById('link-planner').href =
    isActive ? 'planner.html' : `planner.html?week=${weekKey}`;

  // Close Week only makes sense on the current week
  document.getElementById('btn-close-week').classList.toggle('hidden', !isActive);

  // Closed weeks are view-only
  document.getElementById('week-grid').classList.toggle('read-only', readOnly);

  // Banner when looking at any week other than the current one
  const banner = document.getElementById('week-banner');
  if (isActive) {
    banner.classList.add('hidden');
  } else {
    const what = readOnly ? 'a closed week (view only)'
               : weekKey > activeKey ? 'an upcoming week' : 'a past week';
    banner.innerHTML = `You're viewing ${what}. <a href="index.html">Back to current week</a>`;
    banner.classList.remove('hidden');
  }
}

/* ── INIT ───────────────────────────────────────────────────── */
async function init() {
  adminProfile = await requireAdmin();
  if (!adminProfile) return;

  activeKey = await resolveActiveWeekKey();
  weekKey   = weekKeyFromURL() || activeKey;
  readOnly  = weekKey !== activeKey && await isWeekClosed(weekKey);
  updateWeekLabel();

  await loadStudents();
  await loadLibrary();
  await loadInstances();
  await Promise.all([loadNotes(), loadBreaks()]);

  renderGrid();

  document.getElementById('btn-logout').addEventListener('click', logout);
  checkPeriodicExport();
}

init();
