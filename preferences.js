// preferences.js — Per-user filter preferences synced to Supabase.
// Loaded as an ES module from index.html.

import { supabase, getCurrentUser } from './auth.js';

const TABLE = 'user_preferences';
const DEFAULTS = Object.freeze({
  categories: [],
  watchlist: [],
  sale_types: [],
  keyword: '',
  bogo_only: false,
});

let current = { ...DEFAULTS };
let signedIn = false;
// Mirror of the auth state, kept in sync via publix-auth-change. Lets us decide
// "are we signed in?" synchronously when the user taps Preferences — no race
// against Supabase's async getSession() / localStorage write.
let currentUser = null;
// Some deployments haven't yet migrated to include the keyword / bogo_only
// columns. We detect this on first load and fall back to in-memory only so
// the UI stays functional either way.
let hasKeywordCol = true;
let hasBogoCol = true;

export function currentFilters() {
  return current;
}

export function isActive() {
  return signedIn && (
    (current.categories?.length || 0) > 0 ||
    (current.watchlist?.length || 0) > 0 ||
    (current.sale_types?.length || 0) > 0 ||
    !!current.keyword ||
    !!current.bogo_only
  );
}

async function loadFor(userId) {
  if (!supabase) return { ...DEFAULTS };
  // Try the full column set first; if the migration hasn't been applied,
  // fall back to the legacy columns.
  let { data, error } = await supabase
    .from(TABLE)
    .select('categories, watchlist, sale_types, keyword, bogo_only')
    .eq('user_id', userId)
    .maybeSingle();
  if (error && /column .* does not exist|keyword|bogo_only/i.test(error.message || '')) {
    console.warn('[prefs] keyword/bogo_only columns missing — run the migration in SUPABASE_SETUP.md.');
    hasKeywordCol = false;
    hasBogoCol = false;
    const legacy = await supabase
      .from(TABLE)
      .select('categories, watchlist, sale_types')
      .eq('user_id', userId)
      .maybeSingle();
    data = legacy.data;
    error = legacy.error;
  }
  if (error) {
    console.warn('[prefs] load error:', error.message);
    return { ...DEFAULTS };
  }
  if (!data) return { ...DEFAULTS };
  return {
    categories: Array.isArray(data.categories) ? data.categories : [],
    watchlist: Array.isArray(data.watchlist) ? data.watchlist : [],
    sale_types: Array.isArray(data.sale_types) ? data.sale_types : [],
    keyword: typeof data.keyword === 'string' ? data.keyword : '',
    bogo_only: !!data.bogo_only,
  };
}

async function saveFor(userId, prefs) {
  if (!supabase) throw new Error('Supabase not configured');
  const row = {
    user_id: userId,
    categories: prefs.categories,
    watchlist: prefs.watchlist,
    sale_types: prefs.sale_types,
    updated_at: new Date().toISOString(),
  };
  if (hasKeywordCol) row.keyword = prefs.keyword || '';
  if (hasBogoCol) row.bogo_only = !!prefs.bogo_only;
  const { error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'user_id' });
  if (error) {
    // If the extra columns are missing, retry once without them.
    if (/column .* does not exist|keyword|bogo_only/i.test(error.message || '')) {
      hasKeywordCol = false;
      hasBogoCol = false;
      const { error: e2 } = await supabase.from(TABLE).upsert({
        user_id: userId,
        categories: prefs.categories,
        watchlist: prefs.watchlist,
        sale_types: prefs.sale_types,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (e2) throw e2;
      return;
    }
    throw error;
  }
}

// ---------- Setters used by the render script ----------
// These update `current` optimistically and debounce persistence.
let _saveTimer = null;
function scheduleSave() {
  clearTimeout(_saveTimer);
  const user = currentUser || (typeof getCurrentUser === 'function' ? getCurrentUser() : null);
  if (!user?.id) return; // signed out — no persistence
  const userId = user.id;
  const snapshot = { ...current };
  _saveTimer = setTimeout(() => {
    saveFor(userId, snapshot).catch(err => {
      console.warn('[prefs] save failed:', err.message);
    });
  }, 250);
}

export function setCategories(arr) {
  current = { ...current, categories: Array.isArray(arr) ? [...arr] : [] };
  scheduleSave();
}
export function setKeyword(kw) {
  current = { ...current, keyword: String(kw || '') };
  scheduleSave();
}
export function setBogo(on) {
  current = { ...current, bogo_only: !!on };
  scheduleSave();
}

// ---------- Helpers for modal population ----------
function dealsData() { return (window.PUBLIX_DATA?.deals) || []; }
function uniqueCategories(deals) {
  return [...new Set(deals.map(d => d.category).filter(Boolean))].sort();
}
function uniqueNames(deals) {
  return [...new Set(deals.map(d => d.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function detectSaleTypes(deals) {
  const types = new Set();
  deals.forEach(d => {
    if (/buy\s*1\s*get\s*1\s*free/i.test(d.deal || '')) types.add('BOGO');
    else types.add('SALE');
  });
  if (types.size === 0) { types.add('BOGO'); types.add('SALE'); }
  return [...types];
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function $(id) { return document.getElementById(id); }

function watchlistChipHtml(w) {
  return `<span class="wl-chip" data-w="${esc(w)}">${esc(w)} <button type="button" class="wl-remove" aria-label="Remove">×</button></span>`;
}

async function openPrefsModal() {
  // Resolve the live user from (in order of confidence):
  //   1. our local `currentUser` mirror (updated by publix-auth-change)
  //   2. auth.js getCurrentUser() (same source, double-check)
  //   3. a fresh supabase.auth.getSession() as a last resort
  // This avoids the race where iOS Safari hasn't finished persisting the
  // session to localStorage yet but the in-memory user is already known.
  let user = currentUser || (typeof getCurrentUser === 'function' ? getCurrentUser() : null);
  if (!user && supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      user = data?.session?.user || null;
    } catch (err) {
      console.warn('[prefs] getSession failed:', err.message);
    }
  }
  console.log('preferences click, user:', user?.email || null);
  if (!user?.id) {
    $('signInModal').hidden = false;
    return;
  }
  // We have a live user — make sure our cached state is fresh.
  if (!signedIn || current === DEFAULTS) {
    signedIn = true;
    try { current = await loadFor(user.id); } catch (_) { /* fall through */ }
  }
  const deals = dealsData();
  const names = uniqueNames(deals);

  const wlEl = $('prefWatchlist');
  wlEl.innerHTML = `
    <p class="pref-help">Add product name keywords (case-insensitive substring). Press Enter or comma to add.</p>
    <div id="watchlistChips" class="watchlist-chips">
      ${current.watchlist.map(w => watchlistChipHtml(w)).join('')}
    </div>
    <input id="watchlistInput" type="text" class="pref-input" placeholder="e.g. cabernet, pork loin" autocomplete="off" />
    ${names.length ? `
      <details class="pref-details">
        <summary>Suggestions from this week's deals (${names.length})</summary>
        <div class="watchlist-suggestions">
          ${names.slice(0, 80).map(n => `<button type="button" class="suggestion" data-name="${esc(n)}">${esc(n)}</button>`).join('')}
        </div>
      </details>` : ''}
  `;
  wireWatchlistInputs();
  $('prefStatus').textContent = '';
  $('prefsModal').hidden = false;
}

function wireWatchlistInputs() {
  const chips = $('watchlistChips');
  const input = $('watchlistInput');

  chips.addEventListener('click', (e) => {
    if (e.target.classList.contains('wl-remove')) {
      e.target.parentElement.remove();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = input.value.trim().replace(/,$/, '').trim();
      if (v && !alreadyInChips(v)) {
        chips.insertAdjacentHTML('beforeend', watchlistChipHtml(v));
      }
      input.value = '';
    }
  });

  document.querySelectorAll('.watchlist-suggestions .suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.dataset.name;
      if (n && !alreadyInChips(n)) {
        chips.insertAdjacentHTML('beforeend', watchlistChipHtml(n));
      }
    });
  });
}

function alreadyInChips(value) {
  const v = value.toLowerCase();
  return [...document.querySelectorAll('#watchlistChips .wl-chip')]
    .some(c => (c.dataset.w || '').toLowerCase() === v);
}

function readPrefsFromModal() {
  const watchlist = [...document.querySelectorAll('#watchlistChips .wl-chip')].map(c => c.dataset.w);
  // Keep whatever is currently in `current` for the fields not exposed in the
  // modal — they're managed by the toolbar controls directly.
  return {
    categories: current.categories || [],
    sale_types: current.sale_types || [],
    keyword: current.keyword || '',
    bogo_only: !!current.bogo_only,
    watchlist,
  };
}

async function savePrefs() {
  if (!supabase) {
    $('prefStatus').textContent = 'Supabase not configured.';
    return;
  }
  const { data } = await supabase.auth.getSession();
  const userId = data?.session?.user?.id;
  if (!userId) {
    $('prefStatus').textContent = 'Sign in to save preferences.';
    return;
  }
  const prefs = readPrefsFromModal();
  try {
    $('prefStatus').textContent = 'Saving…';
    await saveFor(userId, prefs);
    current = prefs;
    $('prefStatus').textContent = 'Saved.';
    window.dispatchEvent(new CustomEvent('publix-prefs-change'));
    setTimeout(() => { $('prefsModal').hidden = true; }, 500);
  } catch (err) {
    $('prefStatus').textContent = `Error: ${err.message}`;
  }
}

function clearPrefs() {
  const chips = $('watchlistChips');
  if (chips) chips.innerHTML = '';
}

// React to auth changes
window.addEventListener('publix-auth-change', async (e) => {
  const session = e.detail.session;
  if (session?.user?.id) {
    signedIn = true;
    currentUser = session.user;
    current = await loadFor(session.user.id);
  } else {
    signedIn = false;
    currentUser = null;
    current = { ...DEFAULTS };
  }
  window.dispatchEvent(new CustomEvent('publix-prefs-change'));
});

// Expose to inline render script
window.publixPrefs = {
  currentFilters,
  isActive,
  setCategories,
  setKeyword,
  setBogo,
};

// Wire modal buttons
function initPrefsUI() {
  $('btnPrefs')?.addEventListener('click', openPrefsModal);
  $('btnClosePrefs')?.addEventListener('click', () => { $('prefsModal').hidden = true; });
  $('prefsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'prefsModal') $('prefsModal').hidden = true;
  });
  $('btnSavePrefs')?.addEventListener('click', savePrefs);
  $('btnClearPrefs')?.addEventListener('click', clearPrefs);
  $('btnClearActiveFilters')?.addEventListener('click', async () => {
    console.log('[prefs] clear active filters clicked');
    // Optimistically clear local state so the UI updates immediately, even
    // if the user is signed out or the network is slow.
    current = { ...DEFAULTS };
    // Also reset the category chip selection on the inline render side so
    // the "All" chip becomes active again.
    if (typeof window.publixResetActiveCategory === 'function') {
      window.publixResetActiveCategory();
    }
    window.dispatchEvent(new CustomEvent('publix-prefs-change'));
    // Persist to Supabase if signed in. We pull the user from the cached
    // mirror first (avoids the localStorage race on iOS), then fall back.
    const user = currentUser
      || (typeof getCurrentUser === 'function' ? getCurrentUser() : null);
    let userId = user?.id;
    if (!userId && supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        userId = data?.session?.user?.id;
      } catch (_) { /* ignore */ }
    }
    if (!userId) return;
    try {
      await saveFor(userId, { categories: [], watchlist: [], sale_types: [], keyword: '', bogo_only: false });
    } catch (err) {
      console.warn('[prefs] clear save failed:', err.message);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPrefsUI);
} else {
  initPrefsUI();
}
