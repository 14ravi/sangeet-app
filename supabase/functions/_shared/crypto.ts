// Password/PIN hashing with PBKDF2-HMAC-SHA256 (WebCrypto; works in Deno,
// Node and browsers without extra dependencies). Format:
//   pbkdf2_sha256$<iterations>$<salt b64>$<hash b64>
// The iteration count is stored with each hash so it can be raised later.

export const DEFAULT_ITERATIONS = 600_000;
const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashSecret(secret: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(secret, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${b64(salt)}$${b64(hash)}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return false;
  let expected: Uint8Array;
  let salt: Uint8Array;
  try {
    expected = unb64(parts[3]);
    salt = unb64(parts[2]);
  } catch {
    return false;
  }
  const actual = await derive(secret, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** 256-bit random session token, base64url. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
