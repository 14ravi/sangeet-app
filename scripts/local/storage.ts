// LOCAL MODE / TESTS ONLY. A stand-in for the private Supabase Storage bucket:
// objects are kept in memory (and optionally on disk) and are only reachable
// through HMAC-signed, expiring URLs — the same model as Supabase signed URLs.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AudioStorage } from '../../supabase/functions/api/app.ts';
import { AUDIO_FORMATS, MAX_AUDIO_BYTES } from '../../supabase/functions/_shared/audio.ts';

interface StoredObject {
  bytes: Uint8Array;
  mimeType: string;
}

const ALLOWED_MIME = new Set(AUDIO_FORMATS.map((f) => f.mime));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-upsert, apikey, authorization, cache-control, range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition',
};

export class LocalStorage implements AudioStorage {
  private objects = new Map<string, StoredObject>();
  private secret = randomBytes(32);
  private baseUrl: string;
  private dir?: string;

  constructor(baseUrl: string, dir?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.dir = dir;
  }

  private sign(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('hex');
  }
  private verify(data: string, sig: string | null): boolean {
    if (!sig) return false;
    const a = Buffer.from(this.sign(data), 'hex');
    const b = Buffer.from(sig, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
  private file(path: string) {
    return this.dir ? join(this.dir, ...path.split('/')) : null;
  }

  get(path: string): StoredObject | null {
    const mem = this.objects.get(path);
    if (mem) return mem;
    const f = this.file(path);
    if (f && existsSync(f) && existsSync(`${f}.mime`)) {
      return { bytes: new Uint8Array(readFileSync(f)), mimeType: readFileSync(`${f}.mime`, 'utf8') };
    }
    return null;
  }
  put(path: string, obj: StoredObject) {
    const f = this.file(path);
    if (f) {
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, obj.bytes);
      writeFileSync(`${f}.mime`, obj.mimeType);
    } else {
      this.objects.set(path, obj);
    }
  }

  async createUploadUrl(path: string): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + 7200;
    return `${this.baseUrl}/local-storage/upload/${path}?exp=${exp}&sig=${this.sign(`put:${path}:${exp}`)}`;
  }
  async signedUrl(path: string, expiresIn: number, downloadName?: string): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const dl = downloadName ?? '';
    const q = new URLSearchParams({ exp: String(exp), sig: this.sign(`get:${path}:${exp}:${dl}`) });
    if (dl) q.set('download', dl);
    return `${this.baseUrl}/local-storage/object/${path}?${q}`;
  }
  async objectInfo(path: string) {
    const o = this.get(path);
    return o ? { size: o.bytes.length, mimeType: o.mimeType } : null;
  }
  async readHead(path: string, length: number) {
    const o = this.get(path);
    if (!o) throw new Error('not found');
    return o.bytes.slice(0, length);
  }
  async remove(paths: string[]) {
    for (const p of paths) {
      this.objects.delete(p);
      const f = this.file(p);
      if (f) {
        rmSync(f, { force: true });
        rmSync(`${f}.mime`, { force: true });
      }
    }
  }

  /** Handles /local-storage/* requests (signed upload + signed download). */
  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const m = /^\/local-storage\/(upload|object)\/(.+)$/.exec(url.pathname);
    if (!m) return null;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = decodeURIComponent(m[2]);
    const exp = Number(url.searchParams.get('exp'));
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return this.err(403, 'URL expired');

    if (m[1] === 'upload') {
      if (req.method !== 'PUT') return this.err(405, 'Use PUT');
      if (!this.verify(`put:${path}:${exp}`, url.searchParams.get('sig'))) return this.err(403, 'Bad signature');
      if (this.get(path)) return this.err(409, 'Already exists');
      const mime = (req.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!ALLOWED_MIME.has(mime)) return this.err(415, `mime type ${mime} is not supported`);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length > MAX_AUDIO_BYTES) return this.err(413, 'The object exceeded the maximum allowed size');
      this.put(path, { bytes, mimeType: mime });
      return new Response(JSON.stringify({ Key: path }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return this.err(405, 'Use GET');
    const dl = url.searchParams.get('download') ?? '';
    if (!this.verify(`get:${path}:${exp}:${dl}`, url.searchParams.get('sig'))) return this.err(403, 'Bad signature');
    const o = this.get(path);
    if (!o) return this.err(404, 'Object not found');
    const headers: Record<string, string> = {
      ...CORS,
      'Content-Type': o.mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=60',
    };
    if (dl) headers['Content-Disposition'] = `attachment; filename="${dl.replace(/"/g, '')}"`;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      const size = o.bytes.length;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) return this.err(416, 'Range not satisfiable');
      const chunk = o.bytes.slice(start, end + 1);
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      headers['Content-Length'] = String(chunk.length);
      return new Response(req.method === "HEAD" ? null : (chunk as Uint8Array<ArrayBuffer>), { status: 206, headers });
    }
    headers['Content-Length'] = String(o.bytes.length);
    return new Response(req.method === "HEAD" ? null : (o.bytes as Uint8Array<ArrayBuffer>), { status: 200, headers });
  }

  private err(status: number, message: string) {
    return new Response(JSON.stringify({ statusCode: String(status), error: message, message }), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}
