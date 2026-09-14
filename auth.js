/* ─────────────────────────────────────────────────────────────
   auth.js — authentication helpers
   Handles login, logout, session retrieval, and role-based
   routing. Imported as an ES module by pages that need auth.
   ───────────────────────────────────────────────────────────── */

import { supabase } from './supabase.js';

/* ── GET CURRENT SESSION + PROFILE ──────────────────────────
   Returns { session, profile } or { session: null, profile: null }
   if the user is not logged in.
──────────────────────────────────────────────────────────── */
export async function getSessionAndProfile() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) return { session: null, profile: null };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (profileError || !profile) return { session, profile: null };

  return { session, profile };
}

/* ── REQUIRE AUTH ────────────────────────────────────────────
   Call at the top of any protected page. Redirects to login
   if no session exists. Returns the profile if authenticated.
──────────────────────────────────────────────────────────── */
export async function requireAuth() {
  const { session, profile } = await getSessionAndProfile();
  if (!session || !profile) {
    window.location.href = '/login.html';
    return null;
  }
  return profile;
}

/* ── REQUIRE ADMIN ───────────────────────────────────────────
   Like requireAuth but also enforces admin role.
──────────────────────────────────────────────────────────── */
export async function requireAdmin() {
  const profile = await requireAuth();
  if (!profile) return null; // already redirected
  if (profile.role !== 'admin') {
    window.location.href = '/student.html';
    return null;
  }
  return profile;
}

/* ── ROUTE BY ROLE ───────────────────────────────────────────
   Used on login.html after successful sign-in. Sends each
   role to the right page.
──────────────────────────────────────────────────────────── */
export function routeByRole(profile) {
  if (profile.role === 'admin') {
    window.location.href = '/index.html';
  } else {
    window.location.href = '/student.html';
  }
}

/* ── LOGIN ───────────────────────────────────────────────────
   Returns { profile } on success or { error } on failure.
──────────────────────────────────────────────────────────── */
export async function login(email, password) {
  console.log('1. Attempting sign in for:', email);

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  console.log('2. Auth result:', error ? 'ERROR: ' + error.message : 'OK, user id: ' + data.user.id);

  if (error) return { error: error.message };

  console.log('3. Fetching profile for id:', data.user.id);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  console.log('4. Profile result:', profileError ? 'ERROR: ' + JSON.stringify(profileError) : JSON.stringify(profile));

  if (profileError || !profile) return { error: 'Account found but profile is missing. Contact your admin.' };

  return { profile };
}

/* ── LOGOUT ──────────────────────────────────────────────────
   Signs out and redirects to login page.
──────────────────────────────────────────────────────────── */
export async function logout() {
  await supabase.auth.signOut();
  window.location.href = '/login.html';
}
