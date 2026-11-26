# Deployment checklist

Short version of the [README](README.md) (section numbers in brackets). Commands are for PowerShell in the project folder.

## One-time setup

- [ ] Node.js 22, Git, and free GitHub / Supabase / Cloudflare accounts (§1)
- [ ] Supabase project created; Project URL and **publishable** (or anon) key noted; DB password saved privately (§2)
- [ ] Migrations applied (§3)
  ```powershell
  npx supabase login
  ```
  ```powershell
  npx supabase link --project-ref YOUR-PROJECT-REF
  ```
  ```powershell
  npx supabase db push
  ```
- [ ] Storage → `performance-audio` exists and is **Private**, 50 MB, audio MIME types; **no** storage policies (§4)
- [ ] Edge Function deployed (§5)
  ```powershell
  npx supabase functions deploy api --no-verify-jwt --use-api
  ```
- [ ] Admin bootstrap secrets set (§6)
  ```powershell
  npx supabase secrets set ADMIN_BOOTSTRAP_USERNAME=choose-a-username ADMIN_BOOTSTRAP_PASSWORD="choose-a-long-password"
  ```
- [ ] Private GitHub repo created and code pushed (§8)
- [ ] Cloudflare Pages connected to the repo: build `npm run build`, output `dist`, `NODE_VERSION=22` (§9–10)
- [ ] Cloudflare variables (Production + Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (§11)
- [ ] Site opens on a phone; `/admin/login` works with the bootstrap credentials
- [ ] Admin password changed in **Settings**; bootstrap secrets removed (§6)
  ```powershell
  npx supabase secrets unset ADMIN_BOOTSTRAP_USERNAME ADMIN_BOOTSTRAP_PASSWORD
  ```
- [ ] Settings: event name, max duration, registration open; registration and tracker links copied
- [ ] Optional: `npx supabase secrets set ALLOWED_ORIGINS=https://your-site.pages.dev`

## Smoke test after deploying (about 10 minutes, on a phone)

- [ ] Register a test person → tracker shows them
- [ ] Admin: create a performance with that person, upload an MP3, play it, download it (filename starts `001_`)
- [ ] Participant: **My dances** shows the performance; Download works
- [ ] Admin: Reset PIN → log in as the person with 0000 → forced to choose a new PIN
- [ ] Live mode on two phones: mark Done on one, the other updates within ~5 s
- [ ] Share Progress on WhatsApp → message has names only
- [ ] Delete the test data (performance, then archive/delete the person)

## Before the event

- [ ] Open the admin page at least every few days (free projects pause after ~1 week idle) and **the day before**
- [ ] Back up the database and audio (§14)
- [ ] Event manager has the admin login and has tried Live mode on their phone
- [ ] Phone browsers: keep the Live page open; it keeps itself in sync and saves every tap immediately

## Routine updates

| Changed | Command |
|---|---|
| Website (`src/`, `public/`) | `git push` |
| Server (`supabase/functions/`) | `npx supabase functions deploy api --no-verify-jwt --use-api` |
| Database (new migration file) | `npx supabase db push` |

Run `npm run check` before pushing.

## After the wedding

- [ ] Settings → **Close registration**
- [ ] Back up (§14), then pause/delete the Supabase project and Cloudflare project when no longer needed
