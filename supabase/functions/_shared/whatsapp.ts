// WhatsApp progress message. PRIVACY: the input type only carries names and
// links, so song titles, order, audio or solo/group details cannot leak.

export interface ProgressMessageInput {
  eventName: string;
  names: string[];
  appUrl: string;
}

export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.replace(/\s+/g, ' ').trim();
    const key = n.toLowerCase();
    if (!n || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export function appLinks(appUrl: string): { registerUrl: string; trackerUrl: string } {
  const base = appUrl.replace(/\/+$/, '');
  return { registerUrl: `${base}/register`, trackerUrl: `${base}/tracker` };
}

export function buildProgressMessage({ eventName, names, appUrl }: ProgressMessageInput): string {
  const list = uniqueNames(names);
  const { registerUrl, trackerUrl } = appLinks(appUrl);
  const lines: string[] = [`🎉 ${eventName.trim() || 'Sangeet'} – Dance Updates 💃`, ''];
  if (list.length > 0) {
    lines.push('These people have already submitted their dance performances:', '');
    list.forEach((n, i) => lines.push(`${i + 1}. ${n}`));
    lines.push('', 'Great to see everyone participating! ❤️', '');
  } else {
    lines.push('Dance performances are being collected now!', '');
  }
  lines.push(
    'If you haven’t registered your dance details yet, please do so soon.',
    '',
    `Register: ${registerUrl}`,
    `Progress tracker: ${trackerUrl}`,
  );
  return lines.join('\n');
}

export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
