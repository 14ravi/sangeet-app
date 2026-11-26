// Song-title normalization used for duplicate detection.
// NOT a uniqueness key: duplicates are only warnings.
// Rules: Unicode NFKC, lowercase, strip accents on Latin letters only (keeps
// Devanagari vowel signs intact), drop apostrophes, turn other punctuation
// into spaces, collapse whitespace, trim.

export function normalizeSongTitle(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  let s = raw.normalize('NFKC').toLowerCase();
  s = s.normalize('NFD').replace(/([a-z])\p{M}+/gu, '$1').normalize('NFC');
  s = s.replace(/['’‘`´]/g, '');
  s = s.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export interface SongGroupInput {
  id: string;
  song_title: string;
}

/** Map of normalized title -> ids, only for titles used more than once. */
export function findDuplicateTitles<T extends SongGroupInput>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const key = normalizeSongTitle(it.song_title);
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  for (const [k, v] of groups) if (v.length < 2) groups.delete(k);
  return groups;
}
