# Security notes

This app holds phone numbers and private audio for one family event. It is designed so that **the browser is never trusted** and every privileged action is authorised on the server.

## Trust boundaries

| Layer | Trusted? | Holds |
|---|---|---|
| Browser (Cloudflare Pages) | **No** | public Supabase URL + publishable key, the user's own session token |
| Edge Function `api` | Yes | server secret key (injected by Supabase), admin bootstrap secrets (temporary) |
| Postgres | Yes | all data, PIN/password hashes, hashed session tokens |
| Storage bucket `performance-audio` | Yes (private) | audio objects |

## What is enforced, and where

- **No direct database access from browsers.** Every table has Row Level Security enabled with **no policies**; all privileges on tables, sequences and functions are revoked from `anon`/`authenticated` (also for future objects via default privileges). The view uses `security_invoker`. A test (`tests/api/auth.test.ts`) confirms `anon` gets *permission denied* on tables, the view and the functions.
- **Every route declares its access level** (`public`, `participant`, `participant-restricted`, `admin`) in `supabase/functions/api/app.ts`; the session is resolved from the database on every request. Client-supplied flags such as `isAdmin` are ignored (tested by calling every admin route with no token, a participant token and a forged token).
- **Blocked participants** are rejected on every request (and their sessions are deleted) — not just hidden in the UI.
- **PIN reset sessions are restricted**: after logging in with the temporary 0000, only "me", "change PIN" and "log out" work until a new PIN is set.
- **Audio access**: participants get a signed URL only after the server confirms their account is linked to a participant in that performance. Pending (unconfirmed) registrations get nothing.
- **Storage**: the bucket is private with no policies. Playback URLs last 15 minutes and download URLs 2 minutes. Uploads use one-time signed upload URLs to server-generated paths (`performances/<performance-id>/<random-uuid>.<ext>`); the bucket enforces 50 MB and an audio MIME allow-list, and the server then checks the stored size and the file's magic bytes before accepting it (otherwise the object is deleted).

## Credentials

- PINs and the admin password are hashed with **PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random salt** (WebCrypto, no third-party crypto code). The iteration count is stored in each hash so it can be raised later. Comparison is constant-time.
- Nothing secret is in Git or the frontend bundle. The admin credentials start as Supabase secrets, are hashed into the database on first login, and should then be removed from secrets.
- Session tokens are 256-bit random values, sent in an `x-session-token` header (not cookies, so CSRF does not apply). Only their SHA-256 hash is stored. Expiry: admin 12 h idle / 7 days absolute; participant 7 days idle / 30 days absolute. Logout deletes the session. Changing the admin password signs out all other admin sessions; changing a PIN signs out the participant's other sessions.
- Tokens are kept in `localStorage`, so an XSS bug could steal them. Mitigations: React escaping everywhere (no `dangerouslySetInnerHTML`), YouTube links validated server-side to `https://youtube.com|youtu.be`, and a strict Content-Security-Policy in `public/_headers` (no inline or third-party scripts, no framing).

## Rate limiting and lockout

Implemented in Postgres (`login_throttle`), so it survives function restarts:

| Key | Lock after | Lock length |
|---|---|---|
| Phone number (any, even if not registered) | every 5 wrong PINs | 1 min → 5 min → 15 min → 60 min (repeats); resets after 24 h without failures or on success/PIN reset |
| Client IP (participant login) | 50 failures in 15 min | same schedule |
| Admin username tried | every 5 failures | same schedule |
| Admin client IP | every 10 failures | same schedule |
| Registration "phone already registered" per IP | every 10 | same schedule |

- Wrong PIN and unknown phone produce the **same** message, and unknown phones still run a dummy hash so timing is similar. The lockout applies to any phone string, so it does not reveal whether an account exists.
- With these limits an attacker gets roughly 120 guesses per day per phone; a random 4-digit PIN would take about a month on average. That is acceptable for this event but **not strong security** — a 4-digit PIN is inherently weak.
- IP addresses come from `cf-connecting-ip` / `x-forwarded-for` and are best-effort; the per-phone limit is the real protection.
- Someone who knows a phone number can deliberately lock that person out for up to an hour. The admin can clear it with **Reset PIN**.

## Accepted trade-offs (deliberate, for simplicity)

1. **Phone numbers are not verified.** Anyone can register any number. Mitigation: an account that matches a phone already in the master list is not linked until the admin confirms it; until then it sees only the public-to-participants tracker.
2. **Registration reveals that a phone number is already registered** (needed to prevent duplicates). Throttled per IP.
3. **PIN reset to 0000**: for up to 24 hours anyone who knows the phone number could log in first and choose a PIN. Reset only when the person is ready to log in immediately. The reset is audit-logged.
4. **Shared admin identity**: owner and event manager use the same login, so the audit log cannot tell them apart (it records a session id prefix).
5. **CORS** defaults to `*` because no cookies are used; set `ALLOWED_ORIGINS` to restrict it.
6. **Free-tier hosting**: no SLA; the Supabase project can pause after a week of inactivity.

## Logging

The function never logs request bodies, PINs, passwords, tokens or signed URLs — only the route and an error message for unexpected failures.

## Privacy note shown to users

Registration and home pages state that the phone number is self-entered, not verified, used only by the organisers, and never shown to other participants. The tracker and the WhatsApp message contain only names and counts — no songs, links, audio, order, solo/group or per-person counts (enforced by an explicit allow-list in the API and by tests).

## Reporting / responding

If credentials leak: change the admin password (signs out other devices), block any affected participant accounts, and if needed rotate the Supabase API keys in the dashboard (then update `VITE_SUPABASE_PUBLISHABLE_KEY` in Cloudflare and redeploy).
