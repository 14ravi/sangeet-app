// Duration helpers. Durations are only used to flag clips that exceed the
// configured maximum; they are never used for timetable calculations.

export function formatDuration(seconds: number | null | undefined, sep = ':'): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return `--${sep}--`;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}${sep}${String(s).padStart(2, '0')}`;
}

/** Parses "2:15", "02:15", "135" (seconds) -> 135. Returns null if invalid. */
export function parseDuration(input: string): number | null {
  const s = input.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):([0-5]\d)$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d{1,4}$/.test(s)) return Number(s);
  return null;
}

export function isOverLimit(durationSeconds: number | null | undefined, maxSeconds: number | null | undefined): boolean {
  return durationSeconds != null && maxSeconds != null && durationSeconds > maxSeconds;
}
