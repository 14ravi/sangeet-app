# Testing

## Run the automated tests

```powershell
npm run check
```

This runs `tsc` (type check), ESLint and Vitest. Tests only:

```powershell
npm test
```

**How the backend is tested:** API tests call the real request handlers in `supabase/functions/api/app.ts`, which run the real SQL migrations inside PGlite (Postgres compiled to WebAssembly) — no mocks of business logic, no Docker, no Supabase account. Storage is a local stand-in with HMAC-signed, expiring URLs. Hashing uses 1,000 PBKDF2 iterations in tests (600,000 in production) only for speed.

## Last recorded run

On 2026-11-26 (Windows 11, Node 24.19): **4 test files, 80 tests, all passing**; `tsc` and ESLint clean; `vite build` succeeds.

## Requirement → test map

| Requirement | Where |
|---|---|
| Registration validation, optional email, duplicate phone prevention (normalized formats) | `tests/api/auth.test.ts` › participant registration |
| PIN never stored in plain text | auth › *never stores the PIN in plain text* |
| Registration enabled/disabled | auth › *respects the registration enabled setting* |
| Phone-matched registration needs admin confirmation | auth › *requires admin confirmation…*; performances › *pending account cannot access audio* |
| Phone + PIN login, same error for unknown phone vs wrong PIN | auth › participant login |
| Rate limiting / progressive lockout | auth › *locks out after repeated wrong PINs*, *lock escalates progressively*, admin *rate-limits* |
| Forced PIN change after reset to 0000; temp PIN expiry; audit log entry | auth › forced PIN change after admin reset |
| Blocked user denied server-side (incl. existing sessions) | auth › blocked participants |
| Admin-only permissions (every admin route × no/participant/forged token) | auth › *every admin route rejects…* |
| Browser roles cannot read tables/view/functions (RLS + grants) | auth › database is locked down |
| Admin password change signs out other devices; session expiry | auth › admin authentication |
| Upload validation: type, size, real content (magic bytes) | `tests/api/performances.test.ts` › *validates type, size and real content* |
| Private audio, signed URLs, tampered URL rejected | performances › *stores audio privately…* |
| Participant may download only own performance audio | performances › *participants can download only their own…* |
| Playing the correct performance audio | performances › *plays the correct clip*; `tests/ui/song-and-player.test.tsx` |
| Song normalization & duplicate warnings (YouTube URL ignored) | `tests/unit/shared.test.ts` › song title…; performances › song library |
| Clicking a song shows all matching performances | performances › song library; UI test |
| Filename format & renumbering after reorder | unit › download filename; performances › *download filename follows the current order* |
| Duration threshold warning (never blocks) | unit › duration; performances › duration threshold |
| Reordering, persistence after refresh | performances › *reorders, renumbers and persists* |
| Concurrent edits: stale reorder / status rejected, idempotent same status | performances › *rejects a stale reorder…*, *marks Completed / Skipped / Pending…* |
| Cheap polling ("unchanged") | performances › *cheap polling…* |
| Tracker privacy (only counts + names, deduped) | performances › progress tracker & WhatsApp names |
| WhatsApp message privacy and URL encoding | unit › WhatsApp message privacy |
| Phone normalization (+91, 0, 91, spaces, other countries) | unit › phone normalization |

## Manual checks already performed (local mode, in a browser at phone size)

Done on 2026-11-26 with `npm run local:api` + `npm run local:web`:

- Register → tracker; admin login; seeded 9 people and 6 performances with real WAV clips uploaded through the signed-upload flow.
- Song library A–Z with duplicate badges; song detail lists both "Kala Chashma" variants; each Play button streams its own file, starting one pauses the other; no audio is fetched until Play is tapped.
- Live mode: Done / Skip from the bottom bar, Undo toast, Reopen, Restore, move skipped item to the end, reload → order and statuses persisted and renumbered.
- Second "device" (separate admin session) marked a performance Done → this screen updated within one 4 s poll.
- Second device reordered, then this screen tried a stale move → refused with "changed on another device", latest order shown.
- Arrange mode: drag with the grip handle and arrow buttons; numbers update instantly.
- Download filenames for every clip followed the current order (e.g. `001_GROOM_FAMILY_FINALE_GROUP_04-05.wav`) and were served as attachments.
- Pending registration linked via **Needs your confirmation**; Reset PIN → login with 0000 → `/tracker` redirected to forced PIN change → new PIN → tracker.
- WhatsApp preview contained names + register/tracker links only.
- **No horizontal scrolling** on all 19 screens at 320, 360, 375, 390 and 414 px wide (measured `scrollWidth` vs viewport for every screen).

## Still to test manually (needs real services / devices)

Do these after deploying (see the smoke test in [DEPLOYMENT.md](DEPLOYMENT.md)):

- [ ] Real Supabase: `db push`, function deploy, signed upload/download against the real Storage API, bucket MIME/size limits.
- [ ] YouTube title lookup on the deployed function (real oEmbed; depends on YouTube).
- [ ] Real phones: iPhone Safari and Android Chrome — file picker upload from Files/WhatsApp downloads, audio playback with the screen locked/unlocked, Download saving the file, `tel:` links, WhatsApp opening via wa.me, one-handed Live mode use, drag handle on touch.
- [ ] Slow connection: Chrome DevTools "Slow 4G" — Live taps still save, sync dot shows Offline/Saving correctly, failed saves roll back with a message.
- [ ] Two real phones logged in as admin during a rehearsal.
- [ ] Free-tier behaviour: project pause after inactivity and restore.
