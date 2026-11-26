import { handleRequest, type Deps } from '../supabase/functions/api/app.ts';
import { createLocalDb, makeRpc } from '../scripts/local/db.ts';
import { LocalStorage } from '../scripts/local/storage.ts';

export const ADMIN_USER = 'testadmin';
export const ADMIN_PASS = 'test-admin-password-123';

export const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64, ...new Array(200).fill(0)]);

export async function createTestApp(opts: { fetch?: typeof fetch } = {}) {
  const db = await createLocalDb();
  const base = 'http://localhost:9999';
  const storage = new LocalStorage(base);
  const deps: Deps = {
    rpc: makeRpc(db),
    storage,
    fetch: opts.fetch ?? (async () => new Response('{}', { status: 404 })),
    env: { adminBootstrapUsername: ADMIN_USER, adminBootstrapPassword: ADMIN_PASS },
    hashIterations: 1000, // fast hashing for tests only
  };

  async function call(route: string, body: unknown = {}, token?: string | null, ip = '10.0.0.1') {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': ip };
    if (token) headers['x-session-token'] = token;
    const res = await handleRequest(
      new Request(`${base}/functions/v1/api/${route}`, { method: 'POST', headers, body: JSON.stringify(body) }),
      deps,
    );
    const data = await res.json();
    return { status: res.status, data };
  }

  async function adminToken() {
    const r = await call('admin/login', { username: ADMIN_USER, password: ADMIN_PASS });
    if (r.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(r.data)}`);
    return r.data.token as string;
  }

  let phoneSeq = 0;
  async function register(over: Record<string, unknown> = {}) {
    phoneSeq += 1;
    const body = {
      first_name: 'Test',
      last_name: `User${phoneSeq}`,
      phone: `98765${String(10000 + phoneSeq).slice(-5)}`,
      pin: '4821',
      ...over,
    };
    const r = await call('participant/register', body);
    return { ...r, body };
  }

  /** Uploads the given bytes as audio for a performance through the real flow. */
  async function uploadAudio(token: string, performanceId: string, bytes = MP3_BYTES, filename = 'clip.mp3', duration = 135) {
    const u = await call('admin/audio/upload-url', { performance_id: performanceId, filename, size: bytes.length, mime: 'audio/mpeg' }, token);
    if (u.status !== 200) return u;
    const put = await storage.handle(
      new Request(u.data.upload_url, { method: 'PUT', headers: { 'content-type': u.data.content_type }, body: bytes }),
    );
    if (!put || put.status !== 200) throw new Error(`upload PUT failed ${put?.status}`);
    return call('admin/audio/finalize', { upload_id: u.data.upload_id, duration_seconds: duration }, token);
  }

  return { db, deps, storage, call, adminToken, register, uploadAudio };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
