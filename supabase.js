/* ─────────────────────────────────────────────────────────────
   supabase.js — shared Supabase client
   Imported by every page that needs database or auth access.
   ───────────────────────────────────────────────────────────── */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL  = 'https://tonnkkdgleaxpqdvusbg.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvbm5ra2RnbGVheHBxZHZ1c2JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwODExMjYsImV4cCI6MjEwNDY1NzEyNn0.D71o2N7X9HEA2AEtxuVIo8fn1raU9zdNAPRgiHuCj40';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
