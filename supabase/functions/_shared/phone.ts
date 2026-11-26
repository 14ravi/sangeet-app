// Phone number normalization. Numbers are SELF-REPORTED and NOT verified.
// Output is E.164 ("+919876543210"). Indian mobile numbers may be typed with
// or without +91 / 91 / 0 prefixes; other countries must start with + or 00.

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export function normalizePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 25) return null;
  if (/[^0-9+\-\s().]/.test(s)) return null;
  let d = s.replace(/[\s\-().]/g, '');
  if (d.lastIndexOf('+') > 0) return null;
  let international = false;
  if (d.startsWith('+')) {
    international = true;
    d = d.slice(1);
  } else if (d.startsWith('00')) {
    international = true;
    d = d.slice(2);
  }
  if (!/^\d+$/.test(d)) return null;

  if (international) {
    if (d.startsWith('91')) {
      const rest = d.slice(2);
      return INDIAN_MOBILE.test(rest) ? `+91${rest}` : null;
    }
    return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
  }
  if (INDIAN_MOBILE.test(d)) return `+91${d}`;
  if (d.length === 11 && d.startsWith('0') && INDIAN_MOBILE.test(d.slice(1))) return `+91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith('91') && INDIAN_MOBILE.test(d.slice(2))) return `+91${d.slice(2)}`;
  return null;
}

/** "+919876543210" -> "+91 98765 43210" (other countries returned unchanged). */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}
