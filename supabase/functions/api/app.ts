// Sangeet Manager API — request handling for the "api" Edge Function.
// This file is runtime-neutral (no Deno globals) so the same code runs on
// Supabase Edge Functions, in the local dev server and in tests. Every
// privileged action is authorized HERE, server-side, from the session token.
import { normalizePhone } from '../_shared/phone.ts';
import { normalizeSongTitle } from '../_shared/songs.ts';
import { buildAudioFilename, type FilenameInput } from '../_shared/filename.ts';
import { contentMatchesFormat, formatByMime, MAX_AUDIO_BYTES, resolveAudioFormat } from '../_shared/audio.ts';
import { DEFAULT_ITERATIONS, hashSecret, randomToken, sha256Hex, verifySecret } from '../_shared/crypto.ts';
import {
  cleanText,
  isFourDigitPin,
  isLiveStatus,
  isPerformanceType,
  isSide,
  isUuid,
  normalizeYouTubeUrl,
  TEMP_PIN,
  validateEmail,
  validateName,
  validateNewPin,
  validateText,
} from '../_shared/validation.ts';

// ---------------------------------------------------------------------------
// Dependencies (injected so tests/local mode can swap the database & storage)
// ---------------------------------------------------------------------------
export interface AudioStorage {
  /** Full URL the browser can PUT the file to (short-lived). */
  createUploadUrl(path: string): Promise<string>;
  /** Short-lived signed GET URL; with downloadName the response is an attachment. */
  signedUrl(path: string, expiresInSeconds: number, downloadName?: string): Promise<string>;
  objectInfo(path: string): Promise<{ size: number; mimeType: string | null } | null>;
  readHead(path: string, length: number): Promise<Uint8Array>;
  remove(paths: string[]): Promise<void>;
}

// deno-lint-ignore no-explicit-any
export type Json = any;

export interface Deps {
  rpc(fn: string, args?: Record<string, unknown>): Promise<Json>;
  storage: AudioStorage;
  fetch: typeof fetch;
  env: {
    adminBootstrapUsername?: string;
    adminBootstrapPassword?: string;
    allowedOrigins?: string;
  };
  hashIterations?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------
const HOUR = 3600;
const DAY = 24 * HOUR;
export const POLICY = {
  adminIdleSeconds: 12 * HOUR,
  adminAbsoluteSeconds: 7 * DAY,
  participantIdleSeconds: 7 * DAY,
  participantAbsoluteSeconds: 30 * DAY,
  tempPinTtlSeconds: 24 * HOUR,
  playUrlSeconds: 15 * 60,
  downloadUrlSeconds: 120,
  phoneThrottleStep: 5, // lock after every 5 wrong PINs for a phone (1m, 5m, 15m, 60m…)
  ipThrottleStep: 50, // lock an IP after 50 failures within 15 minutes (shared venue Wi-Fi friendly)
  adminUserThrottleStep: 5,
  adminIpThrottleStep: 10,
  registerIpThrottleStep: 10, // duplicate-phone registration attempts per IP (enumeration guard)
  maxBodyBytes: 64 * 1024,
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const bad = (message: string, code = 'invalid_input') => new HttpError(400, code, message);

function corsHeaders(req: Request, deps: Deps): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (deps.env.allowedOrigins ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const allowOrigin = allowed.length === 0 ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-session-token, apikey, authorization, x-client-info',
    'Access-Control-Max-Age': '7200',
    Vary: 'Origin',
  };
}

function json(req: Request, deps: Deps, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req, deps),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  ).slice(0, 64);
}

function minutesText(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? '1 minute' : `${m} minutes`;
}

// ---------------------------------------------------------------------------
// Routing types
// ---------------------------------------------------------------------------
interface Session {
  session_id: string;
  kind: 'admin' | 'participant';
  account_id?: string;
  participant_id?: string | null;
  must_change_pin?: boolean;
  link_status?: string;
}

interface Ctx {
  req: Request;
  deps: Deps;
  body: Record<string, unknown>;
  token: string | null;
  session: Session | null;
  ip: string;
}

type Auth = 'public' | 'participant' | 'participant-restricted' | 'admin';
type Handler = (ctx: Ctx) => Promise<unknown>;

const routes: Record<string, { auth: Auth; handler: Handler }> = {};
function route(path: string, auth: Auth, handler: Handler) {
  routes[path] = { auth, handler };
}

async function rpcOk(deps: Deps, fn: string, args: Record<string, unknown> = {}): Promise<Json> {
  const r = await deps.rpc(fn, args);
  if (r && typeof r === 'object' && 'error' in r && r.error) {
    const code = String(r.error);
    const map: Record<string, [number, string]> = {
      not_found: [404, 'Not found. It may have been deleted on another device.'],
      conflict: [409, 'This was changed on another device. The latest version has been loaded — please try again.'],
      forbidden: [403, 'You do not have access to this.'],
    };
    const [status, message] = map[code] ?? [422, code];
    throw new HttpError(status, code, message, r);
  }
  return r;
}

const actorOf = (ctx: Ctx) => `admin (session ${ctx.session?.session_id.slice(0, 8) ?? '?'})`;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
async function createSession(ctx: Ctx, kind: 'admin' | 'participant', accountId?: string): Promise<string> {
  const token = randomToken();
  await ctx.deps.rpc('auth_session_create', {
    token_hash: await sha256Hex(token),
    kind,
    account_id: accountId ?? null,
    idle_seconds: kind === 'admin' ? POLICY.adminIdleSeconds : POLICY.participantIdleSeconds,
    absolute_seconds: kind === 'admin' ? POLICY.adminAbsoluteSeconds : POLICY.participantAbsoluteSeconds,
    user_agent: ctx.req.headers.get('user-agent') ?? null,
  });
  return token;
}

async function resolveSession(ctx: Ctx, kind: 'admin' | 'participant'): Promise<Session> {
  if (!ctx.token || ctx.token.length < 20 || ctx.token.length > 200) {
    throw new HttpError(401, 'unauthenticated', 'Please log in.');
  }
  const r = await ctx.deps.rpc('auth_session_resolve', {
    token_hash: await sha256Hex(ctx.token),
    kind,
    idle_seconds: kind === 'admin' ? POLICY.adminIdleSeconds : POLICY.participantIdleSeconds,
  });
  if (!r?.found) throw new HttpError(401, 'unauthenticated', 'Your session has expired. Please log in again.');
  if (r.blocked) throw new HttpError(403, 'blocked', 'Your account has been blocked. Please contact the organiser.');
  return r as Session;
}

let dummyHashPromise: Promise<string> | null = null;
function dummyHash(iterations: number): Promise<string> {
  // Used to keep timing similar when a phone/username does not exist.
  dummyHashPromise ??= hashSecret('not-a-real-secret', iterations);
  return dummyHashPromise;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
route('public/config', 'public', (ctx) => ctx.deps.rpc('public_config'));

// ---------------------------------------------------------------------------
// Participant auth
// ---------------------------------------------------------------------------
route('participant/register', 'public', async (ctx) => {
  const b = ctx.body;
  const err =
    validateName(b.first_name, 'First name') ??
    validateName(b.last_name, 'Last name') ??
    validateEmail(b.email) ??
    validateNewPin(b.pin);
  if (err) throw bad(err);
  const phone = normalizePhone(b.phone as string);
  if (!phone) throw bad('Please enter a valid mobile number (for example 98765 43210 or +91 98765 43210).');

  const ipKey = `register-ip:${ctx.ip}`;
  const lock = await ctx.deps.rpc('throttle_check', { keys: [ipKey] });
  if (lock.locked) {
    throw new HttpError(429, 'locked', `Too many attempts. Please try again in ${minutesText(lock.retry_after_seconds)}.`);
  }
  const pinHash = await hashSecret(b.pin as string, ctx.deps.hashIterations ?? DEFAULT_ITERATIONS);
  const r = await ctx.deps.rpc('participant_register', {
    phone,
    first_name: cleanText(b.first_name),
    last_name: cleanText(b.last_name),
    email: cleanText(b.email) || null,
    pin_hash: pinHash,
  });
  if (r.error === 'registration_closed') {
    throw new HttpError(403, 'registration_closed', 'Registration is currently closed.');
  }
  if (r.error === 'phone_taken') {
    await ctx.deps.rpc('throttle_fail', {
      items: [{ key: ipKey, step: POLICY.registerIpThrottleStep, window_seconds: HOUR }],
    });
    throw new HttpError(
      409,
      'phone_taken',
      'An account with this phone number already exists. Please log in, or ask the organiser to reset your PIN.',
    );
  }
  const token = await createSession(ctx, 'participant', r.account_id);
  return { token, link_status: r.link_status, must_change_pin: false };
});

route('participant/login', 'public', async (ctx) => {
  const phone = normalizePhone(ctx.body.phone as string);
  const pin = ctx.body.pin;
  if (!phone || !isFourDigitPin(pin)) throw bad('Please enter your mobile number and 4-digit PIN.');

  const keys = [`phone:${phone}`, `ip:${ctx.ip}`];
  const lock = await ctx.deps.rpc('throttle_check', { keys });
  if (lock.locked) {
    throw new HttpError(429, 'locked', `Too many incorrect attempts. Please try again in ${minutesText(lock.retry_after_seconds)}.`);
  }
  const iterations = ctx.deps.hashIterations ?? DEFAULT_ITERATIONS;
  const acc = await ctx.deps.rpc('participant_get_for_login', { phone });
  const ok = acc.found ? await verifySecret(pin, acc.pin_hash) : (await verifySecret(pin, await dummyHash(iterations)), false);
  if (!ok) {
    const after = await ctx.deps.rpc('throttle_fail', {
      items: [
        { key: keys[0], step: POLICY.phoneThrottleStep, window_seconds: DAY },
        { key: keys[1], step: POLICY.ipThrottleStep, window_seconds: 15 * 60 },
      ],
    });
    const suffix = after.locked ? ` Too many attempts — try again in ${minutesText(after.retry_after_seconds)}.` : '';
    throw new HttpError(401, 'invalid_credentials', `Incorrect phone number or PIN.${suffix}`);
  }
  if (acc.blocked) throw new HttpError(403, 'blocked', 'Your account has been blocked. Please contact the organiser.');
  if (acc.must_change_pin && acc.temp_pin_expired) {
    throw new HttpError(401, 'temp_pin_expired', 'Your temporary PIN has expired. Please ask the organiser to reset it again.');
  }
  await ctx.deps.rpc('throttle_clear', { keys: [keys[0]] });
  await ctx.deps.rpc('participant_login_success', { account_id: acc.account_id });
  const token = await createSession(ctx, 'participant', acc.account_id);
  return { token, must_change_pin: acc.must_change_pin };
});

route('participant/me', 'participant-restricted', (ctx) =>
  ctx.deps.rpc('participant_me', { account_id: ctx.session!.account_id }),
);

route('participant/logout', 'participant-restricted', async (ctx) => {
  await ctx.deps.rpc('auth_session_delete', { token_hash: await sha256Hex(ctx.token!) });
  return { ok: true };
});

route('participant/change-pin', 'participant-restricted', async (ctx) => {
  const s = ctx.session!;
  const err = validateNewPin(ctx.body.new_pin);
  if (err) throw bad(err);
  if (!s.must_change_pin) {
    const key = `account:${s.account_id}`;
    const lock = await ctx.deps.rpc('throttle_check', { keys: [key] });
    if (lock.locked) throw new HttpError(429, 'locked', `Too many attempts. Try again in ${minutesText(lock.retry_after_seconds)}.`);
    const acc = await ctx.deps.rpc('participant_get_for_login', { account_id: s.account_id });
    if (!isFourDigitPin(ctx.body.current_pin) || !acc.found || !(await verifySecret(ctx.body.current_pin, acc.pin_hash))) {
      await ctx.deps.rpc('throttle_fail', { items: [{ key, step: POLICY.phoneThrottleStep }] });
      throw new HttpError(401, 'invalid_credentials', 'Your current PIN is incorrect.');
    }
  }
  const pinHash = await hashSecret(ctx.body.new_pin as string, ctx.deps.hashIterations ?? DEFAULT_ITERATIONS);
  await ctx.deps.rpc('participant_change_pin', { account_id: s.account_id, pin_hash: pinHash, keep_session_id: s.session_id });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Participant features (full, unrestricted, non-blocked sessions only)
// ---------------------------------------------------------------------------
route('participant/tracker', 'participant', async (ctx) => {
  const r = await ctx.deps.rpc('tracker_stats');
  // Explicit allow-list: counts, names and FINALISED dances (side, dance
  // name, Solo/Group, performers) only — never songs, audio, order or notes.
  return {
    total: r.total,
    included: r.included,
    not_included: r.not_included,
    by_side: r.by_side,
    names: r.names,
    dances: ((r.dances ?? []) as Record<string, unknown>[]).map((d) => ({
      side: d.side,
      display_name: d.display_name,
      performance_type: d.performance_type,
      names: d.names,
    })),
  };
});

route('participant/my-performances', 'participant', async (ctx) => {
  const items = await ctx.deps.rpc('participant_my_performances', { account_id: ctx.session!.account_id });
  return { items, linked: !!ctx.session!.participant_id, link_status: ctx.session!.link_status };
});

route('participant/audio-download', 'participant', async (ctx) => {
  if (!isUuid(ctx.body.performance_id)) throw bad('Invalid performance.');
  const info = await ctx.deps.rpc('performance_file_info', {
    performance_id: ctx.body.performance_id,
    account_id: ctx.session!.account_id,
  });
  if (info.error === 'forbidden' || info.error === 'not_found') {
    throw new HttpError(403, 'forbidden', 'You can only download audio for your own performances.');
  }
  if (info.error === 'no_audio') throw new HttpError(404, 'no_audio', 'Audio has not been uploaded yet.');
  // Same ownership check for listening in the browser and for downloading.
  return signAudio(ctx, info, ctx.body.purpose === 'play' ? 'play' : 'download');
});

async function signAudio(ctx: Ctx, info: FilenameInput & { path: string }, purpose: 'play' | 'download') {
  const filename = buildAudioFilename(info);
  const url =
    purpose === 'download'
      ? await ctx.deps.storage.signedUrl(info.path, POLICY.downloadUrlSeconds, filename)
      : await ctx.deps.storage.signedUrl(info.path, POLICY.playUrlSeconds);
  return {
    url,
    filename,
    expires_in: purpose === 'download' ? POLICY.downloadUrlSeconds : POLICY.playUrlSeconds,
  };
}

// ---------------------------------------------------------------------------
// Admin auth
// ---------------------------------------------------------------------------
const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;

route('admin/login', 'public', async (ctx) => {
  const username = typeof ctx.body.username === 'string' ? ctx.body.username.trim() : '';
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (!username || !password || username.length > 64 || password.length > 200) {
    throw bad('Please enter the admin username and password.');
  }
  const keys = [`admin-user:${username.toLowerCase()}`, `admin-ip:${ctx.ip}`];
  const lock = await ctx.deps.rpc('throttle_check', { keys });
  if (lock.locked) {
    throw new HttpError(429, 'locked', `Too many incorrect attempts. Please try again in ${minutesText(lock.retry_after_seconds)}.`);
  }
  const iterations = ctx.deps.hashIterations ?? DEFAULT_ITERATIONS;
  let creds = await ctx.deps.rpc('admin_get_credentials');
  if (!creds.found) {
    const bu = ctx.deps.env.adminBootstrapUsername?.trim();
    const bp = ctx.deps.env.adminBootstrapPassword;
    if (!bu || !bp) {
      throw new HttpError(503, 'admin_not_configured',
        'Admin login is not set up yet. Set ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD as Supabase secrets (see README).');
    }
    if (!USERNAME_RE.test(bu) || bp.length < 10) {
      throw new HttpError(503, 'admin_not_configured',
        'ADMIN_BOOTSTRAP_USERNAME must be 3–64 letters/numbers/._- and ADMIN_BOOTSTRAP_PASSWORD at least 10 characters.');
    }
    creds = await ctx.deps.rpc('admin_bootstrap', { username: bu, password_hash: await hashSecret(bp, iterations) });
  }
  const userOk = creds.username.toLowerCase() === username.toLowerCase();
  const passOk = await verifySecret(password, creds.password_hash);
  if (!userOk || !passOk) {
    const after = await ctx.deps.rpc('throttle_fail', {
      items: [
        { key: keys[0], step: POLICY.adminUserThrottleStep, window_seconds: DAY },
        { key: keys[1], step: POLICY.adminIpThrottleStep, window_seconds: HOUR },
      ],
    });
    const suffix = after.locked ? ` Too many attempts — try again in ${minutesText(after.retry_after_seconds)}.` : '';
    throw new HttpError(401, 'invalid_credentials', `Incorrect username or password.${suffix}`);
  }
  await ctx.deps.rpc('throttle_clear', { keys: [keys[0]] });
  return { token: await createSession(ctx, 'admin') };
});

route('admin/me', 'admin', async () => ({ ok: true }));

route('admin/logout', 'admin', async (ctx) => {
  await ctx.deps.rpc('auth_session_delete', { token_hash: await sha256Hex(ctx.token!) });
  return { ok: true };
});

route('admin/change-password', 'admin', async (ctx) => {
  const current = typeof ctx.body.current_password === 'string' ? ctx.body.current_password : '';
  const next = typeof ctx.body.new_password === 'string' ? ctx.body.new_password : '';
  const newUsername = typeof ctx.body.new_username === 'string' ? ctx.body.new_username.trim() : '';
  if (next.length < 10 || next.length > 200) throw bad('New password must be 10–200 characters.');
  if (newUsername && !USERNAME_RE.test(newUsername)) throw bad('Username must be 3–64 letters, numbers, dots, hyphens or underscores.');
  const key = `admin-change:${ctx.session!.session_id}`;
  const lock = await ctx.deps.rpc('throttle_check', { keys: [key] });
  if (lock.locked) throw new HttpError(429, 'locked', `Too many attempts. Try again in ${minutesText(lock.retry_after_seconds)}.`);
  const creds = await ctx.deps.rpc('admin_get_credentials');
  if (!creds.found || !(await verifySecret(current, creds.password_hash))) {
    await ctx.deps.rpc('throttle_fail', { items: [{ key, step: 5 }] });
    throw new HttpError(401, 'invalid_credentials', 'Current password is incorrect.');
  }
  await ctx.deps.rpc('admin_set_credentials', {
    username: newUsername || creds.username,
    username_changed: !!newUsername && newUsername !== creds.username,
    password_hash: await hashSecret(next, ctx.deps.hashIterations ?? DEFAULT_ITERATIONS),
    keep_session_id: ctx.session!.session_id,
    actor: actorOf(ctx),
  });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Admin: dashboard, settings, audit, sharing
// ---------------------------------------------------------------------------
route('admin/dashboard', 'admin', (ctx) => ctx.deps.rpc('admin_dashboard'));
// WhatsApp "Dance List": finalized dances only (audio uploaded). Explicit
// allow-list of fields so song titles, audio, order and notes never leave.
route('admin/whatsapp-dances', 'admin', async (ctx) => {
  const r = await ctx.deps.rpc('admin_whatsapp_dances');
  return {
    event_name: r.event_name,
    dances: (r.dances as Record<string, unknown>[]).map((d) => ({
      side: d.side,
      display_name: d.display_name,
      performance_type: d.performance_type,
      names: d.names,
    })),
  };
});
route('admin/audit-log', 'admin', (ctx) => ctx.deps.rpc('admin_audit_list'));
route('admin/settings/get', 'admin', (ctx) => ctx.deps.rpc('admin_settings_get'));

route('admin/settings/update', 'admin', (ctx) => {
  const b = ctx.body;
  const args: Record<string, unknown> = { actor: actorOf(ctx) };
  if (b.event_name !== undefined) {
    const e = validateText(b.event_name, 'Event name', 80, true);
    if (e) throw bad(e);
    args.event_name = cleanText(b.event_name);
  }
  if (b.registration_enabled !== undefined) {
    if (typeof b.registration_enabled !== 'boolean') throw bad('Invalid registration setting.');
    args.registration_enabled = b.registration_enabled;
  }
  if (b.max_duration_seconds !== undefined) {
    const n = Number(b.max_duration_seconds);
    if (!Number.isInteger(n) || n < 10 || n > 3600) throw bad('Maximum duration must be between 0:10 and 60:00.');
    args.max_duration_seconds = n;
  }
  if (b.public_app_url !== undefined) {
    const u = typeof b.public_app_url === 'string' ? b.public_app_url.trim().replace(/\/+$/, '') : '';
    if (u && (!/^https?:\/\/[^\s<>"']+$/.test(u) || u.length > 200)) throw bad('App link must start with https://');
    args.public_app_url = u;
  }
  return ctx.deps.rpc('admin_settings_update', args);
});

// ---------------------------------------------------------------------------
// Admin: participants & accounts
// ---------------------------------------------------------------------------
function requireUuid(v: unknown, label = 'id'): string {
  if (!isUuid(v)) throw bad(`Invalid ${label}.`);
  return v;
}

route('admin/participants/list', 'admin', (ctx) => ctx.deps.rpc('admin_participants_list'));
route('admin/participants/get', 'admin', (ctx) => rpcOk(ctx.deps, 'admin_participant_get', { id: requireUuid(ctx.body.id) }));

route('admin/participants/save', 'admin', (ctx) => {
  const b = ctx.body;
  const err =
    validateName(b.first_name, 'First name') ?? validateName(b.last_name, 'Last name') ?? validateEmail(b.email);
  if (err) throw bad(err);
  let phone: string | null = null;
  if (typeof b.phone === 'string' && b.phone.trim()) {
    phone = normalizePhone(b.phone);
    if (!phone) throw bad('Please enter a valid phone number, or leave it blank.');
  }
  if (b.side != null && b.side !== '' && !isSide(b.side)) throw bad('Invalid side.');
  return rpcOk(ctx.deps, 'admin_participant_save', {
    id: b.id ? requireUuid(b.id) : null,
    first_name: cleanText(b.first_name),
    last_name: cleanText(b.last_name),
    phone,
    email: cleanText(b.email) || null,
    side: b.side || null,
  });
});

route('admin/participants/set-active', 'admin', (ctx) => {
  if (typeof ctx.body.active !== 'boolean') throw bad('Invalid value.');
  return rpcOk(ctx.deps, 'admin_participant_set_active', {
    id: requireUuid(ctx.body.id),
    active: ctx.body.active,
    actor: actorOf(ctx),
  });
});

route('admin/participants/delete', 'admin', async (ctx) => {
  const r = await ctx.deps.rpc('admin_participant_delete', { id: requireUuid(ctx.body.id), actor: actorOf(ctx) });
  if (r.error === 'has_performances') {
    throw new HttpError(409, 'has_performances', 'This person is in one or more performances. Remove them from those performances first, or archive them instead.');
  }
  if (r.error === 'has_account') {
    throw new HttpError(409, 'has_account', 'This person has a registered login. Block or archive them instead of deleting.');
  }
  if (r.error) throw new HttpError(404, r.error, 'Not found.');
  return r;
});

route('admin/accounts/block', 'admin', (ctx) => {
  if (typeof ctx.body.blocked !== 'boolean') throw bad('Invalid value.');
  return rpcOk(ctx.deps, 'admin_account_block', {
    account_id: requireUuid(ctx.body.account_id),
    blocked: ctx.body.blocked,
    actor: actorOf(ctx),
  });
});

route('admin/accounts/reset-pin', 'admin', async (ctx) => {
  const expires = new Date(Date.now() + POLICY.tempPinTtlSeconds * 1000).toISOString();
  return rpcOk(ctx.deps, 'admin_account_reset_pin', {
    account_id: requireUuid(ctx.body.account_id),
    pin_hash: await hashSecret(TEMP_PIN, ctx.deps.hashIterations ?? DEFAULT_ITERATIONS),
    expires_at: expires,
    actor: actorOf(ctx),
  });
});

route('admin/accounts/link', 'admin', async (ctx) => {
  const r = await ctx.deps.rpc('admin_account_link', {
    account_id: requireUuid(ctx.body.account_id),
    participant_id: ctx.body.participant_id ? requireUuid(ctx.body.participant_id) : null,
    actor: actorOf(ctx),
  });
  if (r.error === 'participant_has_account') {
    throw new HttpError(409, r.error, 'That participant is already linked to another login.');
  }
  if (r.error) throw new HttpError(404, r.error, 'Not found.');
  return r;
});

// ---------------------------------------------------------------------------
// Admin: performances
// ---------------------------------------------------------------------------
route('admin/performances/list', 'admin', (ctx) => ctx.deps.rpc('admin_performances_list'));
route('admin/performances/get', 'admin', (ctx) => rpcOk(ctx.deps, 'admin_performance_get', { id: requireUuid(ctx.body.id) }));

route('admin/performances/save', 'admin', async (ctx) => {
  const b = ctx.body;
  const err =
    validateText(b.display_name, 'Performance name', 120, true) ??
    validateText(b.song_title, 'Song title', 200, true) ??
    validateText(b.artist, 'Artist', 200, false) ??
    validateText(b.admin_notes, 'Notes', 2000, false);
  if (err) throw bad(err);
  if (!isSide(b.side)) throw bad('Please choose Bride or Groom side.');
  if (!isPerformanceType(b.performance_type)) throw bad('Please choose Solo or Group.');
  if (b.preparation_status !== 'draft' && b.preparation_status !== 'ready') throw bad('Invalid status.');
  let youtube: string | null = null;
  if (typeof b.youtube_url === 'string' && b.youtube_url.trim()) {
    youtube = normalizeYouTubeUrl(b.youtube_url);
    if (!youtube) throw bad('YouTube link must be a youtube.com or youtu.be URL.');
  }
  const ids = Array.isArray(b.participant_ids) ? b.participant_ids : [];
  if (ids.length > 60 || !ids.every(isUuid)) throw bad('Invalid participants.');
  const song = cleanText(b.song_title);
  const args: Record<string, unknown> = {
    id: b.id ? requireUuid(b.id) : null,
    display_name: cleanText(b.display_name),
    side: b.side,
    performance_type: b.performance_type,
    song_title: song,
    normalized_song_title: normalizeSongTitle(song) || song.toLowerCase(),
    artist: cleanText(b.artist) || null,
    youtube_url: youtube,
    admin_notes: typeof b.admin_notes === 'string' ? b.admin_notes.trim() || null : null,
    preparation_status: b.preparation_status,
    participant_ids: ids,
  };
  if (Number.isInteger(b.expected_version)) args.expected_version = b.expected_version;
  const r = await ctx.deps.rpc('admin_performance_save', args);
  if (r.error === 'not_ready') {
    const what = (r.missing as string[]).map((m) => (m === 'audio' ? 'an uploaded audio clip' : 'at least one participant'));
    throw new HttpError(422, 'not_ready', `To mark this Ready it needs ${what.join(' and ')}. You can save it as Draft.`);
  }
  if (r.error === 'solo_one_participant') {
    throw new HttpError(422, r.error, 'A Solo performance can have only one participant. Choose Group for more people.');
  }
  if (r.error === 'invalid_participants') throw new HttpError(422, r.error, 'One of the selected participants no longer exists.');
  if (r.error === 'conflict') throw new HttpError(409, 'conflict', 'This performance was changed on another device. Reload and try again.');
  if (r.error) throw new HttpError(404, r.error, 'Not found.');
  return r;
});

route('admin/performances/delete', 'admin', async (ctx) => {
  const r = await rpcOk(ctx.deps, 'admin_performance_delete', { id: requireUuid(ctx.body.id), actor: actorOf(ctx) });
  if (r.remove_paths?.length) await safeRemove(ctx, r.remove_paths);
  return { ok: true };
});

route('admin/performances/set-duration', 'admin', (ctx) => {
  const n = Number(ctx.body.duration_seconds);
  if (!Number.isInteger(n) || n < 1 || n > 3600) throw bad('Duration must be between 0:01 and 60:00.');
  return rpcOk(ctx.deps, 'admin_performance_set_duration', { id: requireUuid(ctx.body.id), duration_seconds: n });
});

// ---------------------------------------------------------------------------
// Admin: songs
// ---------------------------------------------------------------------------
route('admin/songs/list', 'admin', (ctx) => ctx.deps.rpc('admin_songs_list'));
route('admin/songs/get', 'admin', (ctx) => {
  if (typeof ctx.body.key !== 'string' || ctx.body.key.length > 400) throw bad('Invalid song.');
  return ctx.deps.rpc('admin_song_get', { key: ctx.body.key });
});

route('admin/youtube-lookup', 'admin', async (ctx) => {
  const url = normalizeYouTubeUrl(ctx.body.url);
  if (!url) throw bad('That does not look like a YouTube link.');
  try {
    const res = await ctx.deps.fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return { ok: false, message: 'Could not read the title for this video. Please type the song title yourself.' };
    const data = await res.json();
    const title = typeof data.title === 'string' ? data.title.slice(0, 200) : '';
    const author = typeof data.author_name === 'string' ? data.author_name.slice(0, 200) : '';
    if (!title) return { ok: false, message: 'No title found. Please type the song title yourself.' };
    return { ok: true, title, author };
  } catch {
    return { ok: false, message: 'YouTube did not respond. Please type the song title yourself.' };
  }
});

// ---------------------------------------------------------------------------
// Admin: running order & live mode
// ---------------------------------------------------------------------------
route('admin/running-order', 'admin', (ctx) => {
  const args: Record<string, unknown> = {};
  if (typeof ctx.body.known_version === 'number') args.known_version = ctx.body.known_version;
  return ctx.deps.rpc('admin_running_order', args);
});

route('admin/running-order/reorder', 'admin', async (ctx) => {
  const ids = ctx.body.ids;
  if (!Array.isArray(ids) || ids.length > 500 || !ids.every(isUuid)) throw bad('Invalid order.');
  if (typeof ctx.body.expected_revision !== 'number') throw bad('Missing revision.');
  const r = await ctx.deps.rpc('admin_reorder', { ids, expected_revision: ctx.body.expected_revision });
  if (r.error === 'conflict') {
    const { error: _e, ...latest } = r;
    throw new HttpError(409, 'conflict', 'The order was changed on another device. The latest order is now shown — please make your change again.', { latest });
  }
  return r;
});

route('admin/running-order/set-status', 'admin', async (ctx) => {
  if (!isLiveStatus(ctx.body.status)) throw bad('Invalid status.');
  if (!Number.isInteger(ctx.body.expected_version)) throw bad('Missing version.');
  const r = await ctx.deps.rpc('admin_set_live_status', {
    id: requireUuid(ctx.body.id),
    status: ctx.body.status,
    expected_version: ctx.body.expected_version,
  });
  if (r.error === 'conflict') {
    throw new HttpError(409, 'conflict', 'This performance was just updated on another device. Showing the latest status.', { performance: r.performance });
  }
  if (r.error) throw new HttpError(404, r.error, 'Not found. It may have been deleted on another device.');
  return r;
});

// ---------------------------------------------------------------------------
// Admin: audio
// ---------------------------------------------------------------------------
async function safeRemove(ctx: Ctx, paths: string[]) {
  const clean = paths.filter((p) => typeof p === 'string' && p.startsWith('performances/'));
  if (!clean.length) return;
  try {
    await ctx.deps.storage.remove(clean);
  } catch (e) {
    ctx.deps.log?.('storage remove failed', { error: String(e) });
  }
}

route('admin/audio/upload-url', 'admin', async (ctx) => {
  const performanceId = requireUuid(ctx.body.performance_id, 'performance');
  const filename = typeof ctx.body.filename === 'string' ? ctx.body.filename.slice(0, 200) : '';
  const size = Number(ctx.body.size);
  const format = resolveAudioFormat(filename, typeof ctx.body.mime === 'string' ? ctx.body.mime : null);
  if (!format) {
    throw new HttpError(415, 'unsupported_type', 'Unsupported file type. Please upload MP3, M4A, AAC, WAV, OGG, FLAC or WEBM audio.');
  }
  if (!Number.isFinite(size) || size <= 0) throw bad('The file is empty.');
  if (size > MAX_AUDIO_BYTES) {
    throw new HttpError(413, 'too_large', `File is too large. The limit is ${MAX_AUDIO_BYTES / 1024 / 1024} MB — MP3 or M4A clips are much smaller than WAV.`);
  }
  const path = `performances/${performanceId}/${crypto.randomUUID()}.${format.extensions[0]}`;
  const r = await rpcOk(ctx.deps, 'admin_audio_upload_begin', {
    performance_id: performanceId,
    storage_path: path,
    original_filename: cleanText(filename) || `audio.${format.extensions[0]}`,
    mime_type: format.mime,
    size_bytes: size,
  });
  if (r.stale_paths?.length) await safeRemove(ctx, r.stale_paths);
  const uploadUrl = await ctx.deps.storage.createUploadUrl(path);
  return { upload_id: r.upload_id, upload_url: uploadUrl, content_type: format.mime, max_bytes: MAX_AUDIO_BYTES };
});

route('admin/audio/finalize', 'admin', async (ctx) => {
  const uploadId = requireUuid(ctx.body.upload_id, 'upload');
  let duration: number | null = null;
  if (ctx.body.duration_seconds != null) {
    const d = Math.round(Number(ctx.body.duration_seconds));
    if (Number.isFinite(d) && d >= 1 && d <= 3600) duration = d;
  }
  const u = await rpcOk(ctx.deps, 'admin_audio_upload_get', { upload_id: uploadId });
  const reject = async (status: number, code: string, message: string) => {
    await safeRemove(ctx, [u.storage_path]);
    await ctx.deps.rpc('admin_audio_upload_discard', { upload_id: uploadId });
    return new HttpError(status, code, message);
  };
  const info = await ctx.deps.storage.objectInfo(u.storage_path);
  if (!info) throw await reject(400, 'upload_missing', 'The upload did not complete. Please try again.');
  if (info.size > MAX_AUDIO_BYTES) throw await reject(413, 'too_large', 'File is too large.');
  const format = formatByMime(u.mime_type);
  const head = await ctx.deps.storage.readHead(u.storage_path, 64);
  if (!format || !contentMatchesFormat(head, format)) {
    throw await reject(415, 'invalid_audio', 'This file does not look like a valid audio file of its type. Please export it again as MP3 or M4A.');
  }
  const r = await rpcOk(ctx.deps, 'admin_audio_finalize', { upload_id: uploadId, duration_seconds: duration, size_bytes: info.size });
  if (r.old_path && r.old_path !== u.storage_path) await safeRemove(ctx, [r.old_path]);
  return { performance: r.performance };
});

route('admin/audio/url', 'admin', async (ctx) => {
  const purpose = ctx.body.purpose === 'download' ? 'download' : 'play';
  const info = await rpcOk(ctx.deps, 'performance_file_info', { performance_id: requireUuid(ctx.body.performance_id, 'performance') });
  return signAudio(ctx, info, purpose);
});

route('admin/audio/remove', 'admin', async (ctx) => {
  const r = await rpcOk(ctx.deps, 'admin_audio_remove', {
    performance_id: requireUuid(ctx.body.performance_id, 'performance'),
    actor: actorOf(ctx),
  });
  if (r.old_path) await safeRemove(ctx, [r.old_path]);
  return { performance: r.performance };
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function listRoutes(): Record<string, Auth> {
  return Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, v.auth]));
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, deps) });
  if (req.method !== 'POST') return json(req, deps, 405, { error: 'method_not_allowed', message: 'Use POST.' });

  const pathname = new URL(req.url).pathname;
  const idx = pathname.indexOf('/api/');
  const path = idx >= 0 ? pathname.slice(idx + 5).replace(/\/+$/, '') : '';
  const r = routes[path];
  if (!r) return json(req, deps, 404, { error: 'not_found', message: 'Unknown endpoint.' });

  try {
    const len = Number(req.headers.get('content-length') ?? '0');
    if (len > POLICY.maxBodyBytes) throw new HttpError(413, 'too_large', 'Request too large.');
    const text = await req.text();
    if (text.length > POLICY.maxBodyBytes) throw new HttpError(413, 'too_large', 'Request too large.');
    let body: Record<string, unknown> = {};
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
        else throw new Error();
      } catch {
        throw bad('Invalid request body.');
      }
    }
    const ctx: Ctx = { req, deps, body, token: req.headers.get('x-session-token'), session: null, ip: clientIp(req) };
    if (r.auth === 'admin') {
      ctx.session = await resolveSession(ctx, 'admin');
    } else if (r.auth === 'participant' || r.auth === 'participant-restricted') {
      ctx.session = await resolveSession(ctx, 'participant');
      if (r.auth === 'participant' && ctx.session.must_change_pin) {
        throw new HttpError(403, 'pin_change_required', 'Please choose a new PIN first.');
      }
    }
    const result = await r.handler(ctx);
    return json(req, deps, 200, result ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) {
      return json(req, deps, e.status, { error: e.code, message: e.message, ...(e.extra ?? {}) });
    }
    // Never log request bodies, tokens, PINs, passwords or signed URLs.
    deps.log?.('unhandled error', { route: path, error: e instanceof Error ? e.message : String(e) });
    return json(req, deps, 500, { error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
}
