// Download filename: ORDER_SIDE_PERFORMER_NAMES_TYPE_DURATION.ext
// e.g. 001_GROOM_RAHUL_SOLO_02-15.mp3. Built at download time from the CURRENT
// running order and metadata; the stored object is never renamed.
import { formatDuration } from './duration.ts';
import { extensionForMime } from './audio.ts';

export interface FilenameInput {
  position: number;
  side: string;
  performance_type: string;
  duration_seconds: number | null;
  display_name: string;
  first_names: string[];
  path?: string | null;
  original_filename?: string | null;
  mime_type?: string | null;
}

const MAX_NAMES = 3;
const MAX_NAMES_LEN = 30;

export function sanitizeToken(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function fileExtension(input: FilenameInput): string {
  for (const candidate of [input.path, input.original_filename]) {
    const m = candidate ? /\.([A-Za-z0-9]{1,5})$/.exec(candidate) : null;
    if (m) return m[1].toLowerCase();
  }
  return extensionForMime(input.mime_type) ?? 'audio';
}

export function performerLabel(input: Pick<FilenameInput, 'first_names' | 'display_name' | 'performance_type'>): string {
  const names = input.first_names.map(sanitizeToken).filter(Boolean);
  const joined = names.join('_');
  if (names.length > 0 && names.length <= MAX_NAMES && joined.length <= MAX_NAMES_LEN) return joined;
  let label = sanitizeToken(input.display_name).replace(/_(SOLO|GROUP)$/, '');
  if (label === 'SOLO' || label === 'GROUP') label = '';
  label = label.slice(0, MAX_NAMES_LEN).replace(/_+$/, '');
  if (label) return label;
  if (names.length > 0) return names[0].slice(0, MAX_NAMES_LEN);
  return input.performance_type === 'solo' ? 'PERFORMER' : 'GROUP';
}

export function buildAudioFilename(input: FilenameInput): string {
  const order = String(Math.max(0, Math.trunc(input.position))).padStart(3, '0');
  const side = input.side === 'bride' ? 'BRIDE' : 'GROOM';
  const type = input.performance_type === 'solo' ? 'SOLO' : 'GROUP';
  const dur = input.duration_seconds ? formatDuration(input.duration_seconds, '-') : '00-00';
  return `${order}_${side}_${performerLabel(input)}_${type}_${dur}.${fileExtension(input)}`;
}
