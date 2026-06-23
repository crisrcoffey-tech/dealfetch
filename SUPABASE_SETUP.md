# Supabase setup for the Publix BOGO dashboard

Sign-in (email magic link) and per-user filter preferences are powered by a
dedicated Supabase project. This document is the one-time setup walkthrough
for that project, plus the SQL it needs.

## The 5 things Cris needs to do

1. **Create a new Supabase project**
   - Go to <https://supabase.com/dashboard> and click **New project**.
   - Pick a region near Tampa (e.g. `US East — N. Virginia`).
   - Save the database password somewhere safe (1Password etc.). You won't
     need it for the dashboard but you'll need it if you ever connect from
     a SQL client.

2. **Enable Email (magic link) auth**
   - Authentication → **Providers** → confirm **Email** is enabled
     (it is by default).
   - Authentication → **Email Templates** → the default "Magic Link" template
     is fine; no edits required for v1.

3. **Allow the live site as a redirect target**
   - Authentication → **URL Configuration**.
   - **Site URL**: `https://publix-bogos-dashboard.vercel.app`
   - **Redirect URLs** (Add URL): `https://publix-bogos-dashboard.vercel.app`
     and `https://publix-bogos-dashboard.vercel.app/*`
   - (Optional, for local testing: add `http://localhost:5500` or whatever
     you use locally.)

4. **Create the preferences table and RLS policies**
   - SQL Editor → New query → paste the snippet from
     ["SQL to run"](#sql-to-run) below → **Run**.

5. **Paste the API keys into `config.js`**
   - Settings → **API**.
   - Copy **Project URL** → paste into `window.SUPABASE_URL` in `config.js`.
   - Copy the **`anon public`** key → paste into `window.SUPABASE_ANON_KEY`
     in `config.js`. (Do NOT copy the `service_role` key — that bypasses RLS
     and must never end up in client code.)
   - Commit and push `config.js` (see "Why we commit `config.js`" below).

After step 5 lands on `main`, Vercel redeploys and the live site has a
working Sign In button within ~30 seconds.

---

## SQL to run

```sql
-- Per-user preferences for the Publix BOGO dashboard.
create table publix_user_preferences (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  categories  jsonb       default '[]'::jsonb,
  watchlist   jsonb       default '[]'::jsonb,
  sale_types  jsonb       default '[]'::jsonb,
  updated_at  timestamptz default now()
);

alter table publix_user_preferences enable row level security;

create policy "Users can read own preferences"
  on publix_user_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert own preferences"
  on publix_user_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own preferences"
  on publix_user_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

That's the full schema. There are no deny policies — RLS itself denies by
default; the three policies above are the only ways anyone can touch the
table, and each is scoped to the calling user's own row.

---

## Why we commit `config.js`

The anon key is **designed** to be exposed in client-side code. The only
thing it lets a caller do is talk to your Supabase project as an
unauthenticated user — and that caller is then subject to the RLS policies
you set up in step 4. With those policies in place, the only operations the
anon key permits are:

- Sign in with magic link (via the `auth` API).
- Read / insert / update **their own** `publix_user_preferences` row,
  once signed in.

So committing `config.js` with real values is fine for this project. The
real secret — the GitHub PAT — stays in `.credentials.json`, which **is**
gitignored.

If you ever want to move the keys out of source, the alternative is to wire
Vercel env vars + a tiny build step that writes `config.js` at deploy time.
That's overkill for a static HTML site, so we skip it.

---

## What was wired up

- `index.html` — added header auth area (Sign In / user email / Sign out /
  ⚙ Preferences), Sign In modal, Preferences modal, and a "Filtering by:"
  pill near the top. Existing category chips still work as a second-level
  filter on top of preferences. Loads `config.js`, `auth.js`, and
  `preferences.js`.
- `config.js` — paste your Supabase URL + anon key here.
- `config.example.js` — placeholder reference; safe to commit.
- `auth.js` — ES module. Initializes the Supabase client, handles magic-link
  sign-in, sign-out, and the magic-link callback URL fragment. Dispatches
  `publix-auth-change` events that the rest of the page listens for.
- `preferences.js` — ES module. Fetches the current user's row from
  `publix_user_preferences` on sign-in (or returns empty defaults if no row
  yet), powers the Preferences modal, and upserts on Save. Exposes
  `window.publixPrefs.currentFilters()` and `window.publixPrefs.isActive()`
  for the renderer.

## How filtering works (signed in)

The renderer builds the deals list each time auth or prefs change:

1. If signed **out**, or signed-in user has no filters set → show every deal
   in the JSON (existing behavior).
2. If `categories` is non-empty, drop deals whose `category` isn't in the list.
3. If `watchlist` is non-empty, drop deals whose `name` doesn't contain any
   of the watchlist strings (case-insensitive substring).
4. If `sale_types` is non-empty, drop deals whose type (`BOGO` or `SALE`)
   isn't in the list.

The existing category chips at the top run as a second filter on top of
that result, so chip counts always reflect the prefs-filtered set. A small
green "Filtering by: N categories, M watchlist items, K sale types" pill
appears near the top whenever any filter is active.
