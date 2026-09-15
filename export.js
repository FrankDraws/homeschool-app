/* ─────────────────────────────────────────────────────────────
   export.js — export utilities (ES module)
   Handles JSON, CSV, and Markdown exports from archive data.
   Also handles auto-export on close week.
   ───────────────────────────────────────────────────────────── */

const LAST_EXPORT_KEY      = 'hs_last_export';
const AUTO_EXPORT_INTERVAL = 7 * 24 * 60 * 60 * 1000;
const DAYS                 = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

/* ── DOWNLOAD HELPER ─────────────────────────────────────── */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
}

function datestamp() {
  return new Date().toISOString().slice(0, 10);
}

function slugify(str) {
  return str.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
}

/* ── JSON EXPORT ─────────────────────────────────────────── */
export function exportWeekAsJSON(archiveWeek, students, archiveInstances) {
  const payload = {
    exportedAt : new Date().toISOString(),
    version    : 2,
    week       : {
      weekKey   : archiveWeek.week_key,
      label     : archiveWeek.label,
      closedAt  : archiveWeek.closed_at,
    },
    students: students.map(s => ({
      id   : s.id,
      name : s.name,
    })),
    instances: archiveInstances,
  };

  const filename = `hs-${slugify(archiveWeek.label)}-${datestamp()}.json`;
  downloadFile(JSON.stringify(payload, null, 2), filename, 'application/json');
}

/* ── CSV EXPORT ──────────────────────────────────────────── */
export function exportWeekAsCSV(archiveWeek, students, archiveInstances) {
  const rows = [['Student', 'Course', 'Day', 'Completed']];

  students.forEach(student => {
    DAYS.forEach(day => {
      const dayInstances = archiveInstances.filter(
        i => i.student_id === student.id && i.day === day && !i.hidden
      );
      dayInstances.forEach(inst => {
        rows.push([
          student.name,
          inst.label,
          day,
          inst.completed ? 'Yes' : 'No',
        ]);
      });
    });
  });

  const csv      = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const filename = `hs-${slugify(archiveWeek.label)}-${datestamp()}.csv`;
  downloadFile(csv, filename, 'text/csv');
}

/* ── MARKDOWN EXPORT ─────────────────────────────────────── */
export function exportWeekAsMarkdown(archiveWeek, students, archiveInstances) {
  const lines = [];
  const closed = new Date(archiveWeek.closed_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });

  lines.push(`# ${archiveWeek.label}`);
  lines.push(`_Archived on ${closed}_`);
  lines.push('');

  students.forEach(student => {
    // Student totals
    const studentInsts = archiveInstances.filter(
      i => i.student_id === student.id && !i.hidden
    );
    const total = studentInsts.length;
    const done  = studentInsts.filter(i => i.completed).length;
    const pct   = total === 0 ? 0 : Math.round((done / total) * 100);

    lines.push(`## ${student.name} — ${done}/${total} (${pct}%)`);
    lines.push('');

    // Get all unique courses for this student
    const courseLabels = [...new Set(
      studentInsts.map(i => i.label)
    )].sort();

    if (courseLabels.length === 0) {
      lines.push('_No courses assigned this week._');
      lines.push('');
      return;
    }

    // Table header
    const header = `| Course | ${DAYS.map(d => d.slice(0,3)).join(' | ')} | Total |`;
    const divider = `|--------|${DAYS.map(() => '-----|').join('')}-------|`;
    lines.push(header);
    lines.push(divider);

    // One row per course
    courseLabels.forEach(label => {
      let rowDone = 0;
      const cells = DAYS.map(day => {
        const inst = archiveInstances.find(
          i => i.student_id === student.id &&
               i.day === day &&
               i.label === label &&
               !i.hidden
        );
        if (!inst) return '—';
        if (inst.completed) { rowDone++; return '✓'; }
        return '✗';
      });
      const assigned = cells.filter(c => c !== '—').length;
      lines.push(`| ${label} | ${cells.join(' | ')} | ${rowDone}/${assigned} |`);
    });

    lines.push('');
  });

  const filename = `hs-${slugify(archiveWeek.label)}-${datestamp()}.md`;
  downloadFile(lines.join('\n'), filename, 'text/markdown');
}

/* ── FULL BACKUP JSON (all weeks) ────────────────────────── */
export function exportAllAsJSON(allWeeks, students, allInstances) {
  const payload = {
    exportedAt : new Date().toISOString(),
    version    : 2,
    students   : students.map(s => ({ id: s.id, name: s.name })),
    weeks      : allWeeks,
    instances  : allInstances,
  };
  const filename = `hs-full-backup-${datestamp()}.json`;
  downloadFile(JSON.stringify(payload, null, 2), filename, 'application/json');
}

/* ── AUTO EXPORT ON CLOSE WEEK ───────────────────────────── */
export function autoExportOnCloseWeek(weekLabelStr) {
  // Minimal JSON with just the label — full data is in Supabase
  const payload = {
    exportedAt : new Date().toISOString(),
    version    : 2,
    note       : `Auto-export triggered on close week: ${weekLabelStr}. Full data in Supabase.`,
  };
  const filename = `hs-autoexport-${slugify(weekLabelStr)}-${datestamp()}.json`;
  downloadFile(JSON.stringify(payload, null, 2), filename, 'application/json');
}

/* ── PERIODIC AUTO EXPORT CHECK ──────────────────────────── */
export function checkPeriodicExport() {
  const last = localStorage.getItem(LAST_EXPORT_KEY);
  if (!last) return;
  const elapsed = Date.now() - new Date(last).getTime();
  if (elapsed >= AUTO_EXPORT_INTERVAL) {
    console.info('[HS Tracker] 7-day periodic export triggered.');
    const payload = {
      exportedAt : new Date().toISOString(),
      version    : 2,
      note       : 'Periodic auto-export. Full data lives in Supabase.',
    };
    downloadFile(JSON.stringify(payload, null, 2), `hs-periodic-${datestamp()}.json`, 'application/json');
  }
}

/* ── LAST EXPORT LABEL ───────────────────────────────────── */
export function lastExportLabel() {
  const last = localStorage.getItem(LAST_EXPORT_KEY);
  if (!last) return 'Never exported';
  const d       = new Date(last);
  const daysAgo = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  const fmt     = d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  if (daysAgo === 0) return `Exported today (${fmt})`;
  if (daysAgo === 1) return `Exported yesterday (${fmt})`;
  return `Exported ${daysAgo} days ago (${fmt})`;
}
