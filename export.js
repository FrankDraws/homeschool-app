/* ─────────────────────────────────────────────────────────────
   export.js — shared JSON export utility
   Included by both index.html and archive.html
   ───────────────────────────────────────────────────────────── */

const EXPORT_KEYS = [
  'hs_students',
  'hs_overrides',
  'hs_removals',
  'hs_hidden',
  'hs_weeks',
  'hs_archive',
];

const LAST_EXPORT_KEY = 'hs_last_export';
const AUTO_EXPORT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/* ── BUILD EXPORT PAYLOAD ────────────────────────────────── */
export function buildExportPayload() {
  const payload = {
    exportedAt : new Date().toISOString(),
    version    : 1,
    data       : {},
  };
  EXPORT_KEYS.forEach(key => {
    const raw = localStorage.getItem(key);
    payload.data[key] = raw ? JSON.parse(raw) : null;
  });
  return payload;
}

/* ── TRIGGER DOWNLOAD ────────────────────────────────────── */
export function downloadJSON(payload, label = '') {
  const date  = new Date().toISOString().slice(0, 10);
  const slug  = label ? `-${label.replace(/\s+/g, '-')}` : '';
  const fname = `hs-tracker${slug}-${date}.json`;

  const blob  = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Record export time
  localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
}

/* ── MANUAL EXPORT ───────────────────────────────────────── */
export function exportAll(label = '') {
  downloadJSON(buildExportPayload(), label);
}

/* ── AUTO EXPORT ON CLOSE WEEK ───────────────────────────── */
// Call this after archiving a week. Passes the week label for
// a meaningful filename e.g. hs-tracker-Apr-13–17-2026.json
export function autoExportOnCloseWeek(weekLabel) {
  downloadJSON(buildExportPayload(), weekLabel);
  console.info('[HS Tracker] Auto-exported on week close:', weekLabel);
}

/* ── PERIODIC AUTO EXPORT (7-DAY TIMER) ──────────────────── */
// Called once on app load. If it's been more than 7 days since
// the last export, triggers a download immediately.
export function checkPeriodicExport() {
  const last = localStorage.getItem(LAST_EXPORT_KEY);
  if (!last) return; // never exported yet — don't nag on first run

  const elapsed = Date.now() - new Date(last).getTime();
  if (elapsed >= AUTO_EXPORT_INTERVAL_MS) {
    console.info('[HS Tracker] 7-day auto-export triggered.');
    downloadJSON(buildExportPayload(), 'auto');
  }
}

/* ── EXPORT STATUS HELPERS ───────────────────────────────── */
export function lastExportLabel() {
  const last = localStorage.getItem(LAST_EXPORT_KEY);
  if (!last) return 'Never exported';
  const d = new Date(last);
  const daysAgo = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  const fmt = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (daysAgo === 0) return `Exported today (${fmt})`;
  if (daysAgo === 1) return `Exported yesterday (${fmt})`;
  return `Exported ${daysAgo} days ago (${fmt})`;
}
