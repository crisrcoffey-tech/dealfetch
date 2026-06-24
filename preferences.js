// preferences.js — Per-user filter preferences synced to Supabase.
// Loaded as an ES module from index.html.

import { supabase } from './auth.js';

const TABLE = 'user_preferences';
const DEFAULTS = Object.freeze({ categories: [], watchlist: [], sale_types: [] });

let current = { ...DEFAULTS };
let signedIn = false;

export function currentFilters() {
  return current;
}

export function isActive() {
  return signedIn && (
    (current.categories?.length || 0) > 0 ||
    (current.watchlist?.length || 0) > 0 ||
    (current.sale_types?.length || 0) > 0
  );
}

async function loadFor(userId) {
  if (!supabase) return { ...DEFAULTS };
  const { data, error } = await supabase
    .from(TABLE)
    .select('categories, watchlist, sale_types')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[prefs] load error:', error.message);
    return { ...DEFAULTS };
  }
  if (!data) return { ...DEFAULTS };
  return {
    categories: Array.isArray(data.categories) ? data.categories : [],
    watchlist: Array.isArray(data.watchlist) ? data.watchlist : [],
    sale_types: Array.isArray(data.sale_types) ? data.sale_types : [],
  };
}

async function saveFor(userId, prefs) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from(TABLE)
    .upsert({
      user_id: userId,
      categories: prefs.categories,
      watchlist: prefs.watchlist,
      sale_types: prefs.sale_types,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) throw error;
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

function openPrefsModal() {
  if (!signedIn) {
    $('signInModal').hidden = false;
    return;
  }
  const deals = dealsData();
  const cats = uniqueCategories(deals);
  const names = uniqueNames(deals);
  const types = detectSaleTypes(deals);

  const catsEl = $('prefCategories');
  catsEl.innerHTML = cats.length
    ? cats.map(c => `
        <label class="pref-check">
          <input type="checkbox" value="${esc(c)}" ${current.categories.includes(c) ? 'checked' : ''}/>
          <span>${esc(c)}</span>
        </label>`).join('')
    : '<em class="pref-help">No categories available yet — try again after the next refresh.</em>';

  const typesEl = $('prefSaleTypes');
  typesEl.innerHTML = types.map(t => `
    <label class="pref-check">
      <input type="checkbox" value="${esc(t)}" ${current.sale_types.includes(t) ? 'checked' : ''}/>
      <span>${esc(t)}</span>
    </label>`).join('');

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
  const categories = [...document.querySelectorAll('#prefCategories input:checked')].map(i => i.value);
  const sale_types = [...document.querySelectorAll('#prefSaleTypes input:checked')].map(i => i.value);
  const watchlist = [...document.querySelectorAll('#watchlistChips .wl-chip')].map(c => c.dataset.w);
  return { categories, watchlist, sale_types };
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
  document.querySelectorAll('#prefCategories input').forEach(i => { i.checked = false; });
  document.querySelectorAll('#prefSaleTypes input').forEach(i => { i.checked = false; });
  const chips = $('watchlistChips');
  if (chips) chips.innerHTML = '';
}

// React to auth changes
window.addEventListener('publix-auth-change', async (e) => {
  const session = e.detail.session;
  if (session?.user?.id) {
    signedIn = true;
    current = await loadFor(session.user.id);
  } else {
    signedIn = false;
    current = { ...DEFAULTS };
  }
  window.dispatchEvent(new CustomEvent('publix-prefs-change'));
});

// Expose to inline render script
window.publixPrefs = { currentFilters, isActive };

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
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (!userId) return;
    try {
      await saveFor(userId, { categories: [], watchlist: [], sale_types: [] });
      current = { ...DEFAULTS };
      window.dispatchEvent(new CustomEvent('publix-prefs-change'));
    } catch (err) {
      console.warn('[prefs] clear failed:', err.message);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPrefsUI);
} else {
  initPrefsUI();
}
