// Supabase Edge Function entry point (Deno). Deploy with:
//   npx supabase functions deploy api --no-verify-jwt
// All logic lives in app.ts; this file only wires up Supabase services.
// The service-role key is injected by Supabase and never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest, type AudioStorage, type Deps } from './app.ts';

const BUCKET = 'performance-audio';

const supabaseUrl = Deno.env.get('SUPABASE_URL');

// Server-only key. Prefer the new secret keys (SUPABASE_SECRET_KEYS is a JSON
// dictionary injected by Supabase); fall back to the legacy service_role key.
function serverKey(): string | undefined {
  const dict = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (dict) {
    try {
      const parsed = JSON.parse(dict) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      /* fall through */
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
}
const serviceKey = serverKey();
if (!supabaseUrl || !serviceKey) {
  throw new Error('SUPABASE_URL and a server secret key (SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY) must be available to the function.');
}

const sb = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const bucket = () => sb.storage.from(BUCKET);

const storage: AudioStorage = {
  async createUploadUrl(path) {
    const { data, error } = await bucket().createSignedUploadUrl(path);
    if (error || !data) throw new Error(`createSignedUploadUrl failed: ${error?.message}`);
    return data.signedUrl;
  },
  async signedUrl(path, expiresIn, downloadName) {
    const { data, error } = await bucket().createSignedUrl(path, expiresIn, downloadName ? { download: downloadName } : undefined);
    if (error || !data) throw new Error(`createSignedUrl failed: ${error?.message}`);
    return data.signedUrl;
  },
  async objectInfo(path) {
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash);
    const name = path.slice(slash + 1);
    const { data, error } = await bucket().list(dir, { search: name, limit: 10 });
    if (error) throw new Error(`list failed: ${error.message}`);
    const file = data?.find((f) => f.name === name);
    if (!file) return null;
    return { size: Number(file.metadata?.size ?? 0), mimeType: file.metadata?.mimetype ?? null };
  },
  async readHead(path, length) {
    const url = await storage.signedUrl(path, 60);
    const res = await fetch(url, { headers: { Range: `bytes=0-${length - 1}` } });
    if (!res.ok) throw new Error(`read failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer()).slice(0, length);
  },
  async remove(paths) {
    const { error } = await bucket().remove(paths);
    if (error) throw new Error(`remove failed: ${error.message}`);
  },
};

const deps: Deps = {
  async rpc(fn, args = {}) {
    const { data, error } = await sb.rpc(fn, { p: args });
    if (error) throw new Error(`rpc ${fn} failed: ${error.message}`);
    return data;
  },
  storage,
  fetch: (input, init) => fetch(input, init),
  env: {
    adminBootstrapUsername: Deno.env.get('ADMIN_BOOTSTRAP_USERNAME'),
    adminBootstrapPassword: Deno.env.get('ADMIN_BOOTSTRAP_PASSWORD'),
    allowedOrigins: Deno.env.get('ALLOWED_ORIGINS'),
  },
  log: (message, extra) => console.error(message, extra ?? {}),
};

Deno.serve((req) => handleRequest(req, deps));
