// Supported audio formats, canonical MIME types and magic-byte sniffing.
// The bucket only accepts the canonical MIME types listed here.

export type AudioKind = 'mp3' | 'mp4' | 'aac' | 'wav' | 'ogg' | 'flac' | 'webm';

export interface AudioFormat {
  kind: AudioKind;
  mime: string;
  extensions: string[];
  aliases: string[];
}

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB (Supabase free-tier per-file limit)

export const AUDIO_FORMATS: AudioFormat[] = [
  { kind: 'mp3', mime: 'audio/mpeg', extensions: ['mp3'], aliases: ['audio/mp3', 'audio/mpeg3', 'audio/x-mpeg', 'audio/x-mp3', 'audio/mpg'] },
  { kind: 'mp4', mime: 'audio/mp4', extensions: ['m4a', 'mp4', 'm4b'], aliases: ['audio/x-m4a', 'audio/m4a', 'video/mp4', 'audio/mp4a-latm'] },
  { kind: 'aac', mime: 'audio/aac', extensions: ['aac'], aliases: ['audio/x-aac', 'audio/aacp', 'audio/x-hx-aac-adts'] },
  { kind: 'wav', mime: 'audio/wav', extensions: ['wav'], aliases: ['audio/x-wav', 'audio/wave', 'audio/vnd.wave'] },
  { kind: 'ogg', mime: 'audio/ogg', extensions: ['ogg', 'oga', 'opus'], aliases: ['audio/opus', 'application/ogg', 'audio/x-ogg'] },
  { kind: 'flac', mime: 'audio/flac', extensions: ['flac'], aliases: ['audio/x-flac'] },
  { kind: 'webm', mime: 'audio/webm', extensions: ['webm', 'weba'], aliases: ['video/webm'] },
];

export const ACCEPT_ATTRIBUTE = [...AUDIO_FORMATS.flatMap((f) => f.extensions.map((e) => '.' + e)), 'audio/*'].join(',');

export function extensionOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(filename.trim());
  return m ? m[1].toLowerCase() : '';
}

/** Resolve by file extension first, then by declared MIME type. */
export function resolveAudioFormat(filename: string, declaredMime?: string | null): AudioFormat | null {
  const ext = extensionOf(filename);
  const byExt = AUDIO_FORMATS.find((f) => f.extensions.includes(ext));
  if (byExt) return byExt;
  const mime = (declaredMime ?? '').toLowerCase().split(';')[0].trim();
  return AUDIO_FORMATS.find((f) => f.mime === mime || f.aliases.includes(mime)) ?? null;
}

export function formatByMime(mime: string | null | undefined): AudioFormat | null {
  return AUDIO_FORMATS.find((f) => f.mime === mime) ?? null;
}

export function extensionForMime(mime: string | null | undefined): string | null {
  return formatByMime(mime)?.extensions[0] ?? null;
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...bytes.slice(start, start + len));
}

/** Identify an audio container from its first bytes (needs >= 12 bytes). */
export function sniffAudio(bytes: Uint8Array): AudioKind | 'id3' | null {
  if (bytes.length < 4) return null;
  if (ascii(bytes, 0, 3) === 'ID3') return 'id3';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav';
  if (bytes.length >= 8 && ascii(bytes, 4, 4) === 'ftyp') return 'mp4';
  if (ascii(bytes, 0, 4) === 'OggS') return 'ogg';
  if (ascii(bytes, 0, 4) === 'fLaC') return 'flac';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return 'aac'; // ADTS (layer bits 00)
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3'; // MPEG audio frame sync
  return null;
}

/** True when the sniffed content is consistent with the declared format. */
export function contentMatchesFormat(bytes: Uint8Array, format: AudioFormat): boolean {
  const sniffed = sniffAudio(bytes);
  if (!sniffed) return false;
  if (sniffed === 'id3') return format.kind === 'mp3' || format.kind === 'aac';
  return sniffed === format.kind;
}
