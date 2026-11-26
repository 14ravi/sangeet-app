// LOCAL MODE ONLY — never deploy this. Serves the same API as the Supabase
// Edge Function, backed by PGlite and on-disk audio storage, on
// http://localhost:54321 so the whole app can be tried without any account.
//
//   npm run local:api   (in one terminal)
//   npm run local:web   (in another)
//
// Reads ADMIN_BOOTSTRAP_USERNAME / ADMIN_BOOTSTRAP_PASSWORD from the
// environment or from .env.local (git-ignored).
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { handleRequest, type Deps } from '../supabase/functions/api/app.ts';
import { createLocalDb, makeRpc } from './local/db.ts';
import { LocalStorage } from './local/storage.ts';

const root = join(import.meta.dirname, '..');
const envFile = join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const port = Number(process.env.LOCAL_API_PORT ?? 54321);
const dataDir = join(root, process.env.LOCAL_DATA_DIR ?? '.local-data');
const baseUrl = `http://localhost:${port}`;

const db = await createLocalDb(join(dataDir, 'pgdata'));
const storage = new LocalStorage(baseUrl, join(dataDir, 'storage'));
const deps: Deps = {
  rpc: makeRpc(db),
  storage,
  fetch: (input, init) => fetch(input, init),
  env: {
    adminBootstrapUsername: process.env.ADMIN_BOOTSTRAP_USERNAME,
    adminBootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD,
  },
  log: (message, extra) => console.error('[api]', message, extra ?? {}),
};

const server = createServer(async (nodeReq, nodeRes) => {
  try {
    const url = `${baseUrl}${nodeReq.url ?? '/'}`;
    const hasBody = nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD' && nodeReq.method !== 'OPTIONS';
    const req = new Request(url, {
      method: nodeReq.method,
      headers: nodeReq.headers as Record<string, string>,
      body: hasBody ? (Readable.toWeb(nodeReq) as ReadableStream) : undefined,
      // @ts-expect-error Node needs duplex for streamed request bodies
      duplex: 'half',
    });
    const path = new URL(url).pathname;
    let res: Response | null = null;
    if (path.startsWith('/functions/v1/api/')) res = await handleRequest(req, deps);
    else res = await storage.handle(req);
    res ??= new Response('Not found', { status: 404 });
    nodeRes.writeHead(res.status, Object.fromEntries(res.headers.entries()));
    nodeRes.end(Buffer.from(await res.arrayBuffer()));
    if (path.startsWith('/functions/')) console.log(`${res.status} ${path.replace('/functions/v1/api/', '')}`);
  } catch (e) {
    console.error('[local-api] error', e);
    nodeRes.writeHead(500).end('Local server error');
  }
});

server.listen(port, () => {
  console.log(`\n  Local Sangeet API running at ${baseUrl}`);
  console.log(`  Data folder: ${dataDir}`);
  if (!process.env.ADMIN_BOOTSTRAP_USERNAME || !process.env.ADMIN_BOOTSTRAP_PASSWORD) {
    console.log('  ⚠ ADMIN_BOOTSTRAP_USERNAME / ADMIN_BOOTSTRAP_PASSWORD not set — add them to .env.local to log in as admin.');
  }
  console.log('  Start the web app with: npm run local:web\n');
});
