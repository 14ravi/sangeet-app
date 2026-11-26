// Input validation shared by server (authoritative) and browser (UX only).

export type Side = 'bride' | 'groom';
export type PerformanceType = 'solo' | 'group';
export type LiveStatus = 'pending' | 'completed' | 'skipped';
export type PreparationStatus = 'draft' | 'ready';

export const TEMP_PIN = '0000';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const NAME = /^[\p{L}\p{M}\p{N} .'-]+$/u;

export function cleanText(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

export function validateName(v: unknown, label: string): string | null {
  const s = cleanText(v);
  if (!s) return `${label} is required.`;
  if (s.length > 60) return `${label} must be 60 characters or fewer.`;
  if (!NAME.test(s)) return `${label} can only contain letters, spaces, dots, hyphens and apostrophes.`;
  return null;
}

export function isFourDigitPin(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}$/.test(v);
}

/** For a PIN the user chooses: four digits and not the temporary 0000. */
export function validateNewPin(v: unknown): string | null {
  if (!isFourDigitPin(v)) return 'PIN must be exactly 4 digits.';
  if (v === TEMP_PIN) return 'Please choose a PIN other than 0000.';
  return null;
}

export function validateEmail(v: unknown): string | null {
  const s = cleanText(v);
  if (!s) return null;
  if (s.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s)) return 'Please enter a valid email address or leave it blank.';
  return null;
}

export function validateText(v: unknown, label: string, max: number, required: boolean): string | null {
  if (v != null && typeof v !== 'string') return `${label} is invalid.`;
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return required ? `${label} is required.` : null;
  if (s.length > max) return `${label} must be ${max} characters or fewer.`;
  if (CONTROL.test(s)) return `${label} contains invalid characters.`;
  return null;
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);

/** Returns a cleaned https YouTube URL, or null if it is not a YouTube link. */
export function normalizeYouTubeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 500) return null;
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!YOUTUBE_HOSTS.has(u.hostname.toLowerCase())) return null;
  u.protocol = 'https:';
  return u.toString();
}

export function isSide(v: unknown): v is Side {
  return v === 'bride' || v === 'groom';
}
export function isPerformanceType(v: unknown): v is PerformanceType {
  return v === 'solo' || v === 'group';
}
export function isLiveStatus(v: unknown): v is LiveStatus {
  return v === 'pending' || v === 'completed' || v === 'skipped';
}
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
