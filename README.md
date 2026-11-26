# Sangeet Manager

A phone-first web app for running **one** wedding Sangeet dance programme:

- Family members **register** (name, phone, 4-digit PIN), follow a privacy-safe **progress tracker**, and download the music for **their own** dances.
- The organiser (and the event manager, using the same admin login) manages **people**, **performances** and trimmed **audio clips**, checks **duplicate song titles**, arranges the **running order**, and runs the event in **Live mode** from a phone.
- A one-tap **"Share Progress on WhatsApp"** message lists only the names of people who are dancing.

Stack: React + Vite + TypeScript + Tailwind CSS · Supabase (Postgres, one Edge Function, private Storage bucket) · Cloudflare Pages · GitHub. No paid services are required.

> Related docs: [DEPLOYMENT.md](DEPLOYMENT.md) (short checklist) · [TESTING.md](TESTING.md) · [SECURITY.md](SECURITY.md)

---

## Contents

1. [Prerequisites and accounts](#1-prerequisites-and-accounts)
2. [Create the Supabase project](#2-create-the-supabase-project)
3. [Run the database migrations](#3-run-the-database-migrations)
4. [Private audio bucket](#4-private-audio-bucket)
5. [Deploy the Edge Function](#5-deploy-the-edge-function)
6. [Server secrets and the first admin login](#6-server-secrets-and-the-first-admin-login)
7. [Run locally](#7-run-locally)
8. [Create a private GitHub repository and push](#8-create-a-private-github-repository-and-push)
9. [Connect GitHub to Cloudflare Pages](#9-connect-github-to-cloudflare-pages)
10. [Exact Cloudflare build settings](#10-exact-cloudflare-build-settings)
11. [Which variables go where](#11-which-variables-go-where)
12. [Automatic deployment after a push](#12-automatic-deployment-after-a-push)
13. [Updating or fixing the app with Claude](#13-updating-or-fixing-the-app-with-claude)
14. [Backing up the database and audio](#14-backing-up-the-database-and-audio)
15. [Restoring the project](#15-restoring-the-project)
16. [Free-tier limits and possible costs](#16-free-tier-limits-and-possible-costs)
17. [Change the admin password](#17-change-the-admin-password)
18. [Reset a participant's PIN](#18-reset-a-participants-pin)
19. [Disable registration after the wedding](#19-disable-registration-after-the-wedding)
- [How it works (architecture)](#how-it-works-architecture)
- [Data model](#data-model)
- [Known limitations](#known-limitations)

---

## 1. Prerequisites and accounts

Install on your computer:

| Tool | Why | Get it |
|---|---|---|
| **Node.js 22 LTS** (22.12 or newer) | build and run the app | https://nodejs.org |
| **Git** | version control | https://git-scm.com |

Create free accounts:

| Account | Used for |
|---|---|
| **GitHub** | stores the code (private repository) |
| **Supabase** | database, server function, audio storage |
| **Cloudflare** | hosts the website (Cloudflare Pages) |

You do **not** need Docker, a server, a domain name, or a credit card.

The Supabase CLI is run with `npx supabase …` (downloaded on demand; nothing to install globally).

## 2. Create the Supabase project

1. Go to https://supabase.com/dashboard → **New project**.
2. Pick your organisation, give it a name (e.g. `sangeet`), choose a **strong database password** and save it in your password manager, and choose the region closest to your guests (e.g. *Mumbai* for India).
3. Wait until the project is ready.
4. Open **Project Settings → API keys** and note:
   - the **Project URL** (`https://<project-ref>.supabase.co`) — the `<project-ref>` is the random part;
   - the **publishable key** (`sb_publishable_…`). If your project only shows *legacy* keys, use the **anon** key instead. This key is public by design.
   - **Never copy the secret / service_role key anywhere.** The Edge Function receives it automatically.

## 3. Run the database migrations

The SQL files in [`supabase/migrations/`](supabase/migrations) create every table, function, permission and the audio bucket. Run them **in filename order**.

**Option A — Supabase CLI (recommended).** In PowerShell, from the project folder:

```powershell
npx supabase login
```

```powershell
npx supabase link --project-ref YOUR-PROJECT-REF
```

```powershell
npx supabase db push
```

`link` asks for the database password from step 2.

**Option B — SQL Editor (no CLI).** In the Supabase dashboard open **SQL Editor → New query**, paste the full contents of each file and click **Run**, in this order:

1. `20261126000001_schema.sql`
2. `20261126000002_functions.sql`
3. `20261126000003_storage.sql`

Check: **Table Editor** shows tables such as `participants` and `performances`, each marked *RLS enabled*. Run a migration only once; to start over, create a new project.

## 4. Private audio bucket

Migration `…003_storage.sql` creates the bucket automatically. Check it in **Storage**:

| Setting | Value |
|---|---|
| Name | `performance-audio` |
| Public bucket | **OFF (private)** |
| File size limit | 50 MB |
| Allowed MIME types | `audio/mpeg, audio/mp4, audio/aac, audio/wav, audio/ogg, audio/flac, audio/webm` |

If it is missing, create it by hand with exactly those settings. **Do not add any storage policies** — with no policies, only the server function can read or write audio, and the browser only ever gets short-lived signed links.

Supported formats: MP3, M4A/MP4 (AAC), AAC (ADTS), WAV, OGG/Opus, FLAC, WEBM. Recommended: **MP3 or M4A** (a 3-minute clip is about 3–7 MB; the same clip as WAV is about 30 MB).

## 5. Deploy the Edge Function

All server logic is one function called `api` ([`supabase/functions/api`](supabase/functions/api)).

```powershell
npx supabase functions deploy api --no-verify-jwt --use-api
```

- `--no-verify-jwt` is required: the app uses its own session tokens, which the function checks on **every** request (see [SECURITY.md](SECURITY.md)). The same setting is in [`supabase/config.toml`](supabase/config.toml).
- `--use-api` bundles the function on Supabase's side, so Docker is not needed.

Check: **Edge Functions** in the dashboard lists `api`.

## 6. Server secrets and the first admin login

The admin username and password are **never** in the code or in Git. You give them to the server once as secrets:

```powershell
npx supabase secrets set ADMIN_BOOTSTRAP_USERNAME=choose-a-username ADMIN_BOOTSTRAP_PASSWORD="choose-a-long-password"
```

Rules: username 3–64 letters/numbers/`._-`; password **at least 10 characters**.

Then:

1. Open `https://your-site.pages.dev/admin/login` (after step 9) and log in with those values.
   On this **first** login the server hashes the password (PBKDF2-SHA256, 600,000 iterations) and stores only the hash in the database.
2. Go to **Settings → Admin password** and change the password to a new one.
3. Remove the bootstrap secrets — they are ignored from now on, but there is no reason to keep them:

```powershell
npx supabase secrets unset ADMIN_BOOTSTRAP_USERNAME ADMIN_BOOTSTRAP_PASSWORD
```

Share the admin login only with the event manager. You both have the same permissions.

**Forgot the admin password?** In the SQL Editor run `delete from admin_credentials;` and `delete from auth_sessions where kind = 'admin';`, set the two bootstrap secrets again, and log in — the first login re-creates the admin.

Optional secret: `ALLOWED_ORIGINS=https://your-site.pages.dev` restricts which website may call the API (comma-separated list). Leave it unset at first.

## 7. Run locally

### Local mode — no Supabase account needed

Runs the real API and real SQL against an in-process Postgres (PGlite), with audio saved under `.local-data/`. Good for trying the app and for development. **Never deploy local mode.**

```powershell
npm install
```

Create a file named `.env.local` in the project folder (it is git-ignored) containing:

```
ADMIN_BOOTSTRAP_USERNAME=localadmin
ADMIN_BOOTSTRAP_PASSWORD=pick-a-local-test-password
```

Start the local API (leave it running):

```powershell
npm run local:api
```

In a **second** terminal start the website:

```powershell
npm run local:web
```

Open http://localhost:5173 (participants) and http://localhost:5173/admin/login (admin). To start fresh, stop both and delete the `.local-data` folder.

### Against your real Supabase project

Create `.env.production.local` (git-ignored) with your `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then:

```powershell
npm run build
```

```powershell
npm run preview
```

### Checks

```powershell
npm run check
```

This runs type checking, linting and all automated tests. See [TESTING.md](TESTING.md).

## 8. Create a private GitHub repository and push

1. On GitHub: **New repository** → name `sangeet-manager` → **Private** → do **not** add a README/.gitignore → **Create**.
2. In the project folder (the repository already has local commits):

```powershell
git remote add origin https://github.com/YOUR-USERNAME/sangeet-manager.git
```

```powershell
git branch -M main
```

```powershell
git push -u origin main
```

Before every push it's worth checking that nothing secret is staged:

```powershell
git status
```

`.env`, `.env.local`, `.env.*.local`, `.local-data/` and `.claude/launch.json` are ignored by [.gitignore](.gitignore).

## 9. Connect GitHub to Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Authorise GitHub and select the `sangeet-manager` repository.
3. Enter the build settings from step 10, add the two environment variables from step 11, and click **Save and Deploy**.
4. When it finishes you get a URL like `https://sangeet-manager.pages.dev`. Open it on your phone.

## 10. Exact Cloudflare build settings

| Setting | Value |
|---|---|
| Framework preset | `None` (or `Vite`) |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(leave empty)* |
| Environment variable `NODE_VERSION` | `22` (also pinned by `.node-version`) |

`npm run build` type-checks the code and builds into `dist`. Because there is no `404.html`, Cloudflare serves the app for every path (single-page app). Security headers come from [`public/_headers`](public/_headers).

## 11. Which variables go where

| Name | Where | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | Cloudflare Pages → Settings → Variables and secrets (Production **and** Preview) | No — public |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Cloudflare Pages (same place) | No — public by design |
| `NODE_VERSION` = `22` | Cloudflare Pages | No |
| `ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD` | **Supabase secrets only** (`npx supabase secrets set`), only until first login | **Yes** |
| `ALLOWED_ORIGINS` (optional) | Supabase secrets | No |
| Secret / service_role key, database password | **Nowhere you enter** — Supabase injects the key into the function | **Yes** |

Anything starting with `VITE_` ends up in the public JavaScript. **Never** give a secret a `VITE_` name or put it in Cloudflare.

After changing a Cloudflare variable, redeploy (Deployments → ⋯ → **Retry deployment**).

## 12. Automatic deployment after a push

Every `git push` to `main` makes Cloudflare build and publish the site automatically (1–2 minutes). Pushes to other branches create **preview** deployments with their own URL.

The website and the server function deploy separately:

| You changed… | Do this |
|---|---|
| Anything in `src/`, `public/`, `index.html` | `git push` (Cloudflare redeploys) |
| `supabase/functions/**` | `npx supabase functions deploy api --no-verify-jwt --use-api` |
| A new file in `supabase/migrations/` | `npx supabase db push` (or paste it into the SQL Editor) |

## 13. Updating or fixing the app with Claude

1. Open the project folder in Claude Code and describe the change (for example: "add a Notes field to the tracker").
2. Ask Claude to run `npm run check` and to try the change in local mode (`npm run local:api` + `npm run local:web`).
3. Review the diff, then commit and push. Run the function deploy and/or `db push` from the table above if Claude changed those folders.
4. Database changes must be a **new** migration file (never edit one that's already been applied).

Useful prompt: *"Read README.md, SECURITY.md and supabase/functions/api/app.ts first. Every new admin action must be a route with `'admin'` auth in app.ts and a SQL function in a new migration."*

## 14. Backing up the database and audio

Do this before the event and after the wedding.

**Database**, using the CLI (it asks for the database password):

```powershell
npx supabase db dump --linked --data-only -f backup-data.sql
```

```powershell
npx supabase db dump --linked -f backup-schema.sql
```

The free plan does not include downloadable automatic backups — keep your own copies of these files somewhere private, because they contain phone numbers.

**Audio:** in **Storage → performance-audio** you can download files one at a time. To download everything:

```powershell
npx supabase storage cp -r ss:///performance-audio/performances ./audio-backup --experimental
```

(Storage commands are marked experimental in the CLI; if the syntax has changed, check `npx supabase storage --help`.) Also: in the admin app each performance has a **Download** button that saves the clip with its running-order filename.

## 15. Restoring the project

1. Create a new Supabase project (step 2) and run the migrations (step 3).
2. Load the data. The migrations already created the two single-row tables, so first run `delete from app_settings; delete from app_state;` in the SQL Editor, then open `backup-data.sql` in the SQL Editor and run it (or use `psql` with the connection string from **Project Settings → Database**).
3. Upload the audio back into `performance-audio`, keeping the same paths (`performances/<id>/<file>`):

```powershell
npx supabase storage cp -r ./audio-backup ss:///performance-audio/performances --experimental
```

4. Deploy the function and set secrets (steps 5–6). The admin credentials are restored with the data, so the bootstrap secrets are only needed if that table is empty.
5. Update `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Cloudflare and redeploy.

## 16. Free-tier limits and possible costs

Limits change — always check https://supabase.com/pricing and https://developers.cloudflare.com/pages/platform/limits/. At the time of writing (late 2026):

**Supabase Free plan**
- 500 MB database (this app uses a few MB).
- **1 GB file storage** — about 150–300 MP3/M4A clips. WAV files fill it ~5× faster.
- 5 GB egress per month. Each play/download of a 5 MB clip uses 5 MB, so a few hundred plays is fine.
- 500,000 Edge Function calls per month (shared by your organisation). Live mode checks for changes every 4 seconds while it is open and visible (~900 calls per hour per phone, slowing after 20 idle minutes), so a long evening on two phones uses well under 10,000.
- 50 MB maximum per file.
- **Free projects are paused after about 1 week without activity.** A paused project can be restored from the dashboard (data is kept), but the app is offline until you do. **Open the admin page every few days in the weeks before the wedding, and check it the day before.**
- Exceeding Free limits does not silently charge you; on the Free plan services are restricted instead. Upgrading to Pro (paid, monthly) removes pausing and raises limits — only needed if you choose it.

**Cloudflare Pages Free plan**
- Unlimited static requests and bandwidth for the site, 500 builds per month, `*.pages.dev` address included.

**Not used:** SMS, email, paid domains, analytics, audio processing or any paid API. Nothing here is promised to be free forever — the providers set their own terms.

## 17. Change the admin password

Admin → ⚙ **Settings** → **Admin password**: enter the current password and the new one (10+ characters). Optionally change the username. **All other admin devices are signed out** — give the event manager the new password.

## 18. Reset a participant's PIN

Admin → **People** → tap the person → **Login account** → **Reset PIN** → tap again to confirm.

- Their PIN becomes **0000** for **24 hours**, their existing sessions are signed out, and any lockout is cleared.
- Tell them to log in **straight away** with their phone number and 0000; they must choose a new PIN before they can see anything else.
- The reset (who and when) is recorded under **Settings → Recent admin activity**.

**Trade-off:** 0000 is known to everyone, so for up to 24 hours anyone who knows that person's phone number could log in first and choose a PIN. Reset only when the person is ready, and if someone reports a problem, reset again or block the account. See [SECURITY.md](SECURITY.md).

## 19. Disable registration after the wedding

Admin → ⚙ **Settings** → **Registration** → **Close registration**. Existing people can still log in. To take everything offline later: pause or delete the Supabase project (dashboard → Project Settings → General), and/or delete the Cloudflare Pages project. Make a backup first (step 14).

---

## How it works (architecture)

```
Phone browser ──HTTPS──▶ Cloudflare Pages (static React app, no secrets)
      │
      │ POST /functions/v1/api/<route>   header: x-session-token
      ▼
Supabase Edge Function "api"  ── checks session + role on EVERY request
      │  service key (server only)
      ├──▶ Postgres: SQL functions (one jsonb argument each), RLS on, no policies
      └──▶ Storage: private bucket, short-lived signed URLs for play/upload/download
```

- The browser never queries tables directly; all tables have Row Level Security enabled with **no** policies, and browser roles have no privileges.
- Logins are custom (phone + PIN, admin username + password) because Supabase Auth requires SMS for phone sign-in. Sessions are random 256-bit tokens; only their SHA-256 hash is stored, with idle and absolute expiry.
- Audio uploads go straight from the phone to Storage using a one-time signed upload URL; the server then checks the size and the file's real content (magic bytes) before accepting it.
- Live sync: the running-order screen polls every 4 seconds (the server answers "unchanged" cheaply). Order changes carry a revision number and status changes a version number, so a stale device gets a clear "changed on another device" message instead of overwriting newer changes.

Code map:

| Path | What |
|---|---|
| `supabase/migrations/` | schema, SQL functions, permissions, bucket |
| `supabase/functions/api/app.ts` | every API route and its authorization (runtime-neutral) |
| `supabase/functions/api/index.ts` | Supabase/Deno wiring (DB + Storage clients) |
| `supabase/functions/_shared/` | logic shared by server and browser: phone & title normalization, filenames, audio sniffing, WhatsApp text, hashing |
| `src/participant/`, `src/admin/` | screens |
| `src/admin/useRunningOrder.ts` | live sync, optimistic reorder/status with rollback |
| `scripts/local-api.ts`, `scripts/local/` | local mode (PGlite + disk storage) — dev only |
| `tests/` | unit, API/SQL integration and UI tests |

## Data model

| Table | Purpose |
|---|---|
| `participants` | master list of people who may dance (name, optional phone/email, side, archived flag) |
| `participant_accounts` | logins: unique normalized phone, PIN hash, must-change-PIN + expiry, blocked, last login, link status; optional link to one participant |
| `performances` | name, side, solo/group, song title + normalized title, artist, YouTube link, audio path/metadata, duration, notes, Draft/Ready, live status, sort order, version |
| `performance_participants` | many-to-many people ↔ performances (participant delete is restricted) |
| `audio_uploads` | upload slots issued by the server (finalize only accepts these) |
| `app_settings` | event name, registration on/off, max duration, public app link |
| `app_state` | `order_revision` (conflict check) and `data_version` (cheap polling) |
| `admin_credentials` | single admin username + password hash |
| `auth_sessions` | hashed session tokens with idle/absolute expiry |
| `login_throttle` | progressive lockout counters per phone / IP / admin username |
| `admin_audit_log` | PIN resets, blocks, links, deletions, password changes |
| `performance_view` | read model adding running position and performer names |

Registration and linking: if nobody unlinked in the master list has the same phone, a new participant record is created and linked. If someone does, the account waits under **People → Needs your confirmation** until the admin links it (or adds it as a new person). Phone numbers are never trusted on their own.

## Known limitations

- Phone numbers are self-reported and **not verified**.
- A 4-digit PIN is weak by nature; protection relies on server-side lockout (see SECURITY.md).
- Live sync uses 4-second polling, not push; two phones can be up to ~4 s apart.
- Duration is read from the file in the browser; some files (e.g. certain WEBM) don't report it — enter it manually on the performance page.
- YouTube title lookup uses the public oEmbed endpoint and does not work for every video (private, age-restricted, some Music links); type the title instead.
- Download filenames use Latin letters only; names written in other scripts fall back to the performance name or `PERFORMER`/`GROUP`.
- On iPhone, a first tap on Play occasionally only loads the clip ("Ready — tap play again").
