-- ─────────────────────────────────────────────────────────────
-- Notes + Days Off — schema (step 1)
-- Run once in Supabase → SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── 0. Old day_notes table ───────────────────────────────────
-- The Sept 19 build may have left a day_notes table behind.
-- Its only data was test notes, so it's rebuilt from scratch.
-- ⚠ This deletes any rows in it. Skip this line if you want to keep them.
drop table if exists public.day_notes cascade;


-- ── 1. DAY NOTES — one per student, per day, per week ────────
create table public.day_notes (
  id          uuid primary key default gen_random_uuid(),
  week_key    text not null,                 -- 'YYYY-MM-DD' (Monday), same as week_instances
  student_id  uuid not null references public.profiles(id) on delete cascade,
  day         text not null check (day in ('Monday','Tuesday','Wednesday','Thursday','Friday')),
  note        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (week_key, student_id, day)
);


-- ── 2. BREAKS — days off, one day or a range ─────────────────
-- student_id NULL = all students.
-- Unplanned day off (tracker): start_date = end_date.
-- Planned break (planner, later step): any range.
create table if not exists public.breaks (
  id          uuid primary key default gen_random_uuid(),
  start_date  date not null,
  end_date    date not null,
  student_id  uuid references public.profiles(id) on delete cascade,
  reason      text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists breaks_dates_idx on public.breaks (start_date, end_date);


-- ── 3. ARCHIVE SNAPSHOT of days off ──────────────────────────
-- Close Week copies days off here, frozen, so editing a break
-- later never changes a past week.
create table if not exists public.archive_days_off (
  id               uuid primary key default gen_random_uuid(),
  archive_week_id  uuid not null references public.archive_weeks(id) on delete cascade,
  student_id       uuid,                     -- NULL = all students (no FK: archive outlives students)
  student_name     text,
  day              text not null check (day in ('Monday','Tuesday','Wednesday','Thursday','Friday')),
  reason           text
);


-- ── 4. ROW LEVEL SECURITY ────────────────────────────────────
alter table public.day_notes        enable row level security;
alter table public.breaks           enable row level security;
alter table public.archive_days_off enable row level security;

-- Logged-out visitors get nothing (your "no anon access" rule)
revoke all on public.day_notes, public.breaks, public.archive_days_off from anon;

-- Logged-in users may reach the tables at all (gate 1).
-- The policies below then decide which rows and actions (gate 2):
-- admin gets everything; students can only read their own.
grant select, insert, update, delete
  on public.day_notes, public.breaks, public.archive_days_off
  to authenticated;

-- day_notes: admin does everything; a student reads only their own
drop policy if exists "day_notes admin all"   on public.day_notes;
drop policy if exists "day_notes student read" on public.day_notes;
create policy "day_notes admin all" on public.day_notes
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
create policy "day_notes student read" on public.day_notes
  for select to authenticated
  using (student_id = auth.uid());

-- breaks: admin does everything; a student reads their own + all-student breaks
drop policy if exists "breaks admin all"   on public.breaks;
drop policy if exists "breaks student read" on public.breaks;
create policy "breaks admin all" on public.breaks
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
create policy "breaks student read" on public.breaks
  for select to authenticated
  using (student_id is null or student_id = auth.uid());

-- archive_days_off: admin only, like the archive page
drop policy if exists "archive_days_off admin all" on public.archive_days_off;
create policy "archive_days_off admin all" on public.archive_days_off
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');


-- ── 5. CARRY OVER "Hide card this day" ───────────────────────
-- "Mark day off" replaces "Hide card this day". Any card hidden in
-- a week that isn't closed yet becomes a one-day break, so nothing
-- you've already hidden disappears from the tracker.
-- week_cards itself is left untouched.
insert into public.breaks (start_date, end_date, student_id, reason)
select d, d, wc.student_id, null
from public.week_cards wc
cross join lateral (
  select (wc.week_key::date + (array_position(
    array['Monday','Tuesday','Wednesday','Thursday','Friday'], wc.day) - 1)) as d
) x
where wc.hidden = true
  and not exists (select 1 from public.archive_weeks aw where aw.week_key::text = wc.week_key::text)
  and not exists (select 1 from public.breaks b
                  where b.student_id = wc.student_id and b.start_date = x.d and b.end_date = x.d);
