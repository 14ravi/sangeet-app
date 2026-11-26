// Thin client for the "api" Edge Function. The browser never talks to the
// database directly; it only sends a session token that the server checks.

const BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '') ?? '';
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '';

export const isConfigured = Boolean(BASE && KEY);

export type Kind = 'admin' | 'participant' | 'public';

const TOKEN_KEYS: Record<Exclude<Kind, 'public'>, string> = {
  admin: 'sangeet.admin.session',
  participant: 'sangeet.participant.session',
};

export const tokens = {
  get(kind: Exclude<Kind, 'public'>): string | null {
    try {
      return localStorage.getItem(TOKEN_KEYS[kind]);
    } catch {
      return null;
    }
  },
  set(kind: Exclude<Kind, 'public'>, token: string) {
    try {
      localStorage.setItem(TOKEN_KEYS[kind], token);
    } catch {
      /* private mode: session lasts for this page only */
    }
  },
  clear(kind: Exclude<Kind, 'public'>) {
    try {
      localStorage.removeItem(TOKEN_KEYS[kind]);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;
  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function kindForRoute(route: string): Kind {
  if (route === 'admin/login') return 'public';
  if (route === 'participant/login' || route === 'participant/register') return 'public';
  if (route.startsWith('admin/')) return 'admin';
  if (route.startsWith('participant/')) return 'participant';
  return 'public';
}

export const AUTH_EVENT = 'sangeet:auth-expired';
export const PIN_CHANGE_EVENT = 'sangeet:pin-change-required';

export async function api<T = unknown>(route: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const kind = kindForRoute(route);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: KEY };
  if (kind !== 'public') {
    const t = tokens.get(kind);
    if (t) headers['x-session-token'] = t;
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/functions/v1/api/${route}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'No connection. Check your internet and try again.');
  }
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const err = new ApiError(
      res.status,
      String(data.error ?? 'error'),
      String(data.message ?? `Request failed (${res.status}). Please try again.`),
      data,
    );
    if (kind !== 'public' && (res.status === 401 || err.code === 'blocked')) {
      tokens.clear(kind);
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { kind, message: err.message } }));
    }
    if (err.code === 'pin_change_required') window.dispatchEvent(new CustomEvent(PIN_CHANGE_EVENT));
    throw err;
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Please try again.';
}
