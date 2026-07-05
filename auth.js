// auth.js — Supabase auth wiring for the DealFetch dashboard.
// Loaded as an ES module from index.html.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const url = window.SUPABASE_URL;
const key = window.SUPABASE_ANON_KEY;

const configured =
  typeof url === 'string' && typeof key === 'string' &&
  url && key && !url.includes('PASTE_') && !key.includes('PASTE_');

export const supabase = configured
  ? createClient(url, key, { auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } })
  : null;

// Expose for other modules and for the inline render script
window.supabaseClient = supabase;
window.supabaseConfigured = configured;

// Long-lived auth state, updated by onAuthStateChange and the initial getSession().
// Other modules read this synchronously instead of awaiting getSession() on every
// click — that avoids race conditions where iOS Safari hasn't persisted the
// localStorage session yet but the in-memory user is already known.
let _currentUser = null;
export function getCurrentUser() { return _currentUser; }
window.dealfetchAuth = { getCurrentUser };

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signInWithEmail(email) {
  if (!supabase) throw new Error('Supabase not configured. Edit config.js with your project URL + anon key.');
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

// Broadcast auth changes so preferences.js and the render code can react.
if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    _currentUser = session?.user || null;
    console.log('[auth] state change:', event, 'user:', _currentUser?.email || null);
    window.dispatchEvent(new CustomEvent('publix-auth-change', { detail: { session } }));
  });
}

// ---------- Header + modal UI ----------
function $(id) { return document.getElementById(id); }

function updateHeaderUI(session) {
  const toggleBtn = $('btnAuthToggle');
  const toggleLabel = $('authToggleLabel');
  const toggleIcon = $('authToggleIcon');
  const userEmail = $('authUserEmail');
  const prefsBtn = $('btnPrefs');
  if (!toggleBtn) return;
  if (session && session.user) {
    toggleBtn.dataset.state = 'signed-in';
    toggleBtn.classList.remove('primary');
    toggleBtn.setAttribute('aria-label', 'Sign out');
    if (toggleLabel) toggleLabel.textContent = 'Sign out';
    if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'log-out');
    if (userEmail) {
      userEmail.textContent = session.user.email || '';
      userEmail.title = session.user.email || '';
      userEmail.hidden = false;
    }
    if (prefsBtn) prefsBtn.hidden = false;
  } else {
    toggleBtn.dataset.state = 'signed-out';
    toggleBtn.classList.add('primary');
    toggleBtn.setAttribute('aria-label', 'Sign in');
    if (toggleLabel) toggleLabel.textContent = 'Sign in';
    if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'log-in');
    if (userEmail) {
      userEmail.textContent = '';
      userEmail.hidden = true;
    }
    if (prefsBtn) prefsBtn.hidden = true;
  }
  if (window.lucide) lucide.createIcons();
}

async function initAuthUI() {
  // Show config warning instead of a broken Sign In button.
  if (!configured) {
    const warn = $('configWarning');
    if (warn) warn.hidden = false;
  }

  const session = await getSession();
  _currentUser = session?.user || null;
  updateHeaderUI(session);
  // Explicitly broadcast the initial session so preferences.js (and any other
  // listeners that may have registered after onAuthStateChange's INITIAL_SESSION
  // already fired) get a chance to react.
  window.dispatchEvent(new CustomEvent('publix-auth-change', { detail: { session } }));

  // Single toggle button — routes to sign-in modal or sign-out based on state.
  $('btnAuthToggle')?.addEventListener('click', async () => {
    const btn = $('btnAuthToggle');
    if (btn?.dataset.state === 'signed-in') {
      await signOut();
    } else {
      const m = $('signInModal');
      if (m) { m.hidden = false; $('signInEmail')?.focus(); }
    }
  });
  $('btnCloseSignIn')?.addEventListener('click', () => { $('signInModal').hidden = true; });
  $('signInModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'signInModal') $('signInModal').hidden = true;
  });

  // Magic link form
  $('signInForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = ($('signInEmail')?.value || '').trim();
    const status = $('signInStatus');
    if (!email) {
      if (status) status.textContent = 'Enter an email address.';
      return;
    }
    if (!configured) {
      if (status) status.textContent = 'Supabase not configured yet. See SUPABASE_SETUP.md.';
      return;
    }
    try {
      if (status) status.textContent = 'Sending…';
      const { error } = await signInWithEmail(email);
      if (error) throw error;
      if (status) status.textContent = `Magic link sent to ${email}. Check your inbox, then click the link to sign in.`;
    } catch (err) {
      if (status) status.textContent = `Error: ${err.message}`;
    }
  });
}

window.addEventListener('publix-auth-change', (e) => {
  updateHeaderUI(e.detail.session);
  // If the user just signed in via magic link, close any open modal.
  if (e.detail.session) {
    const m = $('signInModal');
    if (m) m.hidden = true;
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthUI);
} else {
  initAuthUI();
}
