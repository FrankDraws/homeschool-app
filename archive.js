/* ─────────────────────────────────────────────────────────────
   archive.js — reads from Supabase archive tables
   ───────────────────────────────────────────────────────────── */

import { supabase }            from './supabase.js';
import { requireAdmin, logout } from './auth.js';
import {
  exportWeekAsJSON,
  exportWeekAsCSV,
  exportWeekAsMarkdown,
  exportAllAsJSON,
  lastExportLabel,
} from './export.js';

const DAYS      = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const PALETTE   = ['#fde8c8','#d8edf8','#d8f0e4','#ede0f8','#fde0e0','#e0f4f8'];
const PALETTE_H = ['#e8a040','#4a90d9','#3aaa60','#8a50d0','#d06060','#30a0b8'];

/* ── STATE ── */
let _archive    = [];   // archive_weeks rows
let _students   = [];   // profiles rows (students)
let _instances  = {};   // archiveWeekId → [archive_instances rows]
let _current    = null; // currently selected archive_week

/* ── LOAD ── */
async function loadArchive() {
  const { data, error } = await supabase
    .from('archive_weeks')
    .select('*')
    .order('closed_at', { ascending: false });
  if (error) { console.error('loadArchive:', error); return; }
  _archive = data || [];
}

async function loadStudents() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .order('name');
  if (error) { console.error('loadStudents:', error); return; }
  _students = data || [];
}

async function loadInstancesForWeek(archiveWeekId) {
  if (_instances[archiveWeekId]) return; // cached

  const { data, error } = await supabase
    .from('archive_instances')
    .select('*')
    .eq('archive_week_id', archiveWeekId);
  if (error) { console.error('loadInstances:', error); return; }
  _instances[archiveWeekId] = data || [];
}

/* ── UTILS ── */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function completionStats(archiveWeekId) {
  const insts = _instances[archiveWeekId] || [];
  const visible = insts.filter(i => !i.hidden);
  const total = visible.length;
  const done  = visible.filter(i => i.completed).length;
  return { total, done, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

function studentStats(archiveWeekId, studentId) {
  const insts   = (_instances[archiveWeekId] || []).filter(i => i.student_id === studentId && !i.hidden);
  const total   = insts.length;
  const done    = insts.filter(i => i.completed).length;
  return { total, done, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/* ── RENDER SIDEBAR ── */
function renderSidebar(filter = '') {
  const list = document.getElementById('week-list');
  list.innerHTML = '';

  const filtered = filter
    ? _archive.filter(e =>
        e.label.toLowerCase().includes(filter.toLowerCase()) ||
        _students.some(s => s.name.toLowerCase().includes(filter.toLowerCase()))
      )
    : _archive;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="sidebar-empty">${
      filter ? 'No results.' : 'No archived weeks yet.<br>Close a week from the tracker to see it here.'
    }</div>`;
    return;
  }

  filtered.forEach(entry => {
    const insts   = _instances[entry.id] || [];
    const total   = insts.filter(i => !i.hidden).length;
    const done    = insts.filter(i => i.completed && !i.hidden).length;
    const pct     = total === 0 ? 0 : Math.round((done / total) * 100);
    const pillCls = pct === 100 ? '' : pct > 0 ? 'partial' : 'empty';
    const closed  = new Date(entry.closed_at).toLocaleDateString('en-US',{month:'short',day:'numeric'});

    const item = document.createElement('div');
    item.className = 'week-list-item' + (_current?.id === entry.id ? ' active' : '');
    item.innerHTML = `
      <div class="week-list-label">${escHtml(entry.label)}</div>
      <div class="week-list-meta">Closed ${closed}</div>
      <div class="week-list-stats">
        <span class="stat-pill ${pillCls}">${pct}% complete</span>
      </div>
    `;
    item.addEventListener('click', async () => {
      _current = entry;
      await loadInstancesForWeek(entry.id);
      renderSidebar(document.getElementById('archive-search').value);
      renderDetail(entry);
    });
    list.appendChild(item);
  });
}

/* ── RENDER DETAIL ── */
function renderDetail(entry) {
  document.getElementById('detail-empty').classList.add('hidden');
  const content = document.getElementById('detail-content');
  content.classList.remove('hidden');
  content.innerHTML = '';

  const insts   = _instances[entry.id] || [];
  const closed  = new Date(entry.closed_at).toLocaleDateString('en-US',{
    weekday:'long', month:'long', day:'numeric', year:'numeric'
  });

  /* heading */
  const heading = document.createElement('div');
  heading.className = 'detail-heading';
  heading.innerHTML = `
    <div class="detail-title">${escHtml(entry.label)}</div>
    <div class="detail-closed">Archived on ${closed}</div>
  `;
  content.appendChild(heading);

  /* summary strip */
  const visible = insts.filter(i => !i.hidden);
  const total   = visible.length;
  const done    = visible.filter(i => i.completed).length;
  const pct     = total === 0 ? 0 : Math.round((done / total) * 100);

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
      <div class="summary-card-value">${_students.length}</div>
      <div class="summary-card-label">Student${_students.length !== 1 ? 's' : ''}</div>
    </div>
  `;
  content.appendChild(strip);

  /* export buttons */
  const exportRow = document.createElement('div');
  exportRow.className = 'detail-export-row';
  exportRow.innerHTML = `
    <span class="detail-export-label">Export this week:</span>
    <button class="btn btn-ghost btn-sm" id="exp-json">⬇ JSON</button>
    <button class="btn btn-ghost btn-sm" id="exp-csv">⬇ CSV</button>
    <button class="btn btn-ghost btn-sm" id="exp-md">⬇ Markdown</button>
  `;
  exportRow.querySelector('#exp-json').addEventListener('click', () =>
    exportWeekAsJSON(entry, _students, insts));
  exportRow.querySelector('#exp-csv').addEventListener('click', () =>
    exportWeekAsCSV(entry, _students, insts));
  exportRow.querySelector('#exp-md').addEventListener('click', () =>
    exportWeekAsMarkdown(entry, _students, insts));
  content.appendChild(exportRow);

  /* per-student blocks */
  const studentsWrap = document.createElement('div');
  studentsWrap.className = 'detail-students';

  _students.forEach(student => {
    const bg      = PALETTE[student.color_index % PALETTE.length];
    const accent  = PALETTE_H[student.color_index % PALETTE_H.length];
    const initials= student.name.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const { done: sDone, total: sTotal, pct: sPct } = studentStats(entry.id, student.id);

    const block = document.createElement('div');
    block.className = 'detail-student-block';

    const sHdr = document.createElement('div');
    sHdr.className = 'detail-student-header';
    sHdr.style.background = bg + '55';
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
      col.innerHTML = `<div class="detail-day-label">${day.slice(0,3)}</div>`;

      const dayInsts = insts.filter(
        i => i.student_id === student.id && i.day === day && !i.hidden
      );

      if (dayInsts.length === 0) {
        col.innerHTML += `<div class="detail-day-no-school">—</div>`;
      } else {
        dayInsts.forEach(inst => {
          const row = document.createElement('div');
          row.className = 'detail-course-row' + (inst.completed ? ' done' : '');
          row.innerHTML = `
            <div class="detail-course-check">${inst.completed ? '✓' : ''}</div>
            <span>${escHtml(inst.label)}</span>
          `;
          col.appendChild(row);
        });
      }

      dayGrid.appendChild(col);
    });

    block.appendChild(dayGrid);
    studentsWrap.appendChild(block);
  });

  content.appendChild(studentsWrap);
}

/* ── SEARCH ── */
document.getElementById('archive-search').addEventListener('input', e => {
  renderSidebar(e.target.value);
});

/* ── FULL BACKUP EXPORT ── */
document.getElementById('btn-export').addEventListener('click', async () => {
  // Load all instances for all weeks
  await Promise.all(_archive.map(w => loadInstancesForWeek(w.id)));
  const allInstances = Object.values(_instances).flat();
  exportAllAsJSON(_archive, _students, allInstances);
});

/* ── INIT ── */
async function init() {
  const profile = await requireAdmin();
  if (!profile) return;

  await Promise.all([loadArchive(), loadStudents()]);

  // Pre-load instances for all weeks (they're small)
  await Promise.all(_archive.map(w => loadInstancesForWeek(w.id)));

  const sub = document.getElementById('archive-subtitle');
  sub.textContent = _archive.length === 0
    ? 'No archived weeks yet'
    : `${_archive.length} week${_archive.length !== 1 ? 's' : ''} archived · ${lastExportLabel()}`;

  renderSidebar();

  // Auto-select most recent
  if (_archive.length > 0) {
    _current = _archive[0];
    renderSidebar();
    renderDetail(_archive[0]);
  }

  document.getElementById('btn-logout').addEventListener('click', logout);
}

init();
