/* ─────────────────────────────────────────────────────────────
   week.js — shared week logic (ES module)
   One source of truth for "which week are we looking at?"
   Imported by the tracker (app.js) and the planner.
   ───────────────────────────────────────────────────────────── */

import { supabase } from './supabase.js';

/* Monday of the week containing `date`, as 'YYYY-MM-DD'.
   Sunday belongs to the week that started the Monday before. */
export function getWeekKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/* Move a week key forward (+n) or back (-n) by whole weeks. */
export function addWeeks(key, n) {
  const d = new Date(key + 'T00:00:00');
  d.setDate(d.getDate() + n * 7);
  return getWeekKey(d);
}

/* 'Sep 28 – Oct 2, 2026' */
export function weekLabel(key) {
  const mon = new Date(key + 'T00:00:00');
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  const fmt = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  return `${fmt(mon)} – ${fmt(fri)}, ${fri.getFullYear()}`;
}

/* True when `key` is the calendar week we're actually living in. */
export function isCalendarWeek(key) {
  return key === getWeekKey();
}

/* Is this week already in the archive? */
export async function isWeekClosed(key) {
  const { data, error } = await supabase
    .from('archive_weeks')
    .select('id')
    .eq('week_key', key)
    .maybeSingle();
  if (error) { console.error('isWeekClosed:', error); return false; }
  return !!data;
}

/* The week the admin should be working on:
   start at the calendar week; while that week is closed,
   step forward. Capped so a data mistake can't loop forever. */
export async function resolveActiveWeekKey() {
  let key = getWeekKey();
  for (let i = 0; i < 8; i++) {
    if (!(await isWeekClosed(key))) return key;
    key = addWeeks(key, 1);
  }
  return key;
}

/* ?week=YYYY-MM-DD in the URL, if present and valid. */
export function weekKeyFromURL() {
  const raw = new URLSearchParams(location.search).get('week');
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return getWeekKey(new Date(raw + 'T00:00:00')); // snap to Monday
}
