import { formatPhone } from '@shared/phone.ts';
import { copyText } from '../lib/format';
import { IconCopy, IconPhone } from './icons';
import { useToast } from './ui';

/** Big tap targets: call (tel:) and copy for a phone number. */
export function PhoneActions({ phone, showNumber = true }: { phone: string | null; showNumber?: boolean }) {
  const toast = useToast();
  if (!phone) return <span className="text-sm text-stone-400">No phone</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {showNumber ? <span className="mr-1 text-sm whitespace-nowrap text-stone-700 tabular-nums">{formatPhone(phone)}</span> : null}
      <a
        href={`tel:${phone}`}
        aria-label={`Call ${formatPhone(phone)}`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 active:bg-emerald-100"
      >
        <IconPhone size={20} />
      </a>
      <button
        type="button"
        aria-label={`Copy ${formatPhone(phone)}`}
        onClick={async (e) => {
          e.stopPropagation();
          e.preventDefault();
          toast((await copyText(phone)) ? `Copied ${formatPhone(phone)}` : 'Could not copy');
        }}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-100 text-stone-700 active:bg-stone-200"
      >
        <IconCopy size={20} />
      </button>
    </span>
  );
}
