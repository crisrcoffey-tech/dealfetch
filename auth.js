// auth.js — Supabase auth wiring for the Publix BOGO dashboard.
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
  supabase.auth.onAuthStateChange((_event, session) => {
    window.dispatchEvent(new CustomEvent('publix-auth-change', { detail: { session } }));
  });
}

// ---------- Header + modal UI ----------
function $(id) { return document.getElementById(id); }

function updateHeaderUI(session) {
  const signedOut = $('authSignedOut');
  const signedIn = $('authSignedIn');
  const userEmail = $('authUserEmail');
  if (!signedOut || !signedIn) return;
  if (session && session.user) {
    signedOut.hidden = true;
    signedIn.hidden = false;
    if (userEmail) userEmail.textContent = session.user.email || '';
  } else {
    signedOut.hidden = false;
    signedIn.hidden = true;
  }
}

async function initAuthUI() {
  // Show config warning instead of a broken Sign In button.
  if (!configured) {
    const warn = $('configWarning');
    if (warn) warn.hidden = false;
  }

  const session = await getSession();
  updateHeaderUI(session);

  // Header buttons
  $('btnSignIn')?.addEventListener('click', () => {
    const m = $('signInModal');
    if (m) { m.hidden = false; $('signInEmail')?.focus(); }
  });
  $('btnCloseSignIn')?.addEventListener('click', () => { $('signInModal').hidden = true; });
  $('signInModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'signInModal') $('signInModal').hidden = true;
  });
  $('btnSignOut')?.addEventListener('click', async () => {
    await signOut();
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
