// WhatsApp "Dance List" message.
// Lists only FINALIZED dances (audio clip uploaded), grouped Groom then Bride:
//   1. Dance name (Solo – Name) / (Group – Name, Name)
// PRIVACY: the input type carries only side, dance name, Solo/Group and
// performer names, so song titles, audio links, running order and notes
// cannot leak. Dances are sorted alphabetically (not by running order).

export interface ShareDance {
  side: 'bride' | 'groom' | string;
  display_name: string;
  performance_type: 'solo' | 'group' | string;
  names: string[];
}

export interface DanceListMessageInput {
  eventName: string;
  dances: ShareDance[];
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

export function danceLine(d: ShareDance, index: number): string {
  const type = d.performance_type === 'solo' ? 'Solo' : 'Group';
  const names = uniqueNames(d.names);
  const who = names.length ? ` – ${names.join(', ')}` : '';
  return `${index + 1}. ${d.display_name.replace(/\s+/g, ' ').trim()} (${type}${who})`;
}

const SIDES: { key: string; heading: string }[] = [
  { key: 'groom', heading: '🤵 *Groom side*' },
  { key: 'bride', heading: '👰 *Bride side*' },
];

export function buildDanceListMessage({ eventName, dances, appUrl }: DanceListMessageInput): string {
  const { registerUrl, trackerUrl } = appLinks(appUrl);
  const byName = (a: ShareDance, b: ShareDance) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' });
  const lines: string[] = [`🎉 *${eventName.trim() || 'Sangeet'} – Dance List* 💃🕺`, ''];

  if (dances.length === 0) {
    lines.push('No dances are finalised yet — music is being collected now! 🎶', '');
  } else {
    for (const { key, heading } of SIDES) {
      const list = dances.filter((d) => d.side === key).sort(byName);
      lines.push(heading);
      if (list.length === 0) lines.push('_No dances finalised yet_');
      else list.forEach((d, i) => lines.push(danceLine(d, i)));
      lines.push('');
    }
    lines.push(`✨ ${dances.length} dance${dances.length === 1 ? '' : 's'} finalised so far. Great going, everyone! ❤️`, '');
  }

  lines.push(
    '🎵 Only dances whose music is ready are listed. If yours isn’t here yet, please send your details and music soon!',
    '',
    `📝 Register: ${registerUrl}`,
    `📊 Progress tracker: ${trackerUrl}`,
  );
  return lines.join('\n');
}

export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
