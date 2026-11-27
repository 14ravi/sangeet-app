// "Share Progress on WhatsApp": builds the Dance List message from the LATEST
// database state (finalised dances only: name, Solo/Group, performers) and
// opens WhatsApp, the system share sheet, or copies it.
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { appBaseUrl, copyText } from '../lib/format';
import { buildDanceListMessage, whatsappShareUrl, type ShareDance } from '@shared/whatsapp.ts';
import { Button, ErrorBox, useToast } from '../components/ui';
import { IconCopy, IconShare, IconX } from '../components/icons';

export function SharePanel({ publicAppUrl }: { publicAppUrl?: string | null }) {
  const toast = useToast();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ event_name: string; dances: ShareDance[] }>('admin/whatsapp-dances');
      setMessage(buildDanceListMessage({ eventName: r.event_name, dances: r.dances, appUrl: appBaseUrl(publicAppUrl) }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div>
      <Button size="lg" block busy={busy} onClick={prepare} className="!bg-emerald-600 active:!bg-emerald-700">
        <IconShare /> Share Progress on WhatsApp
      </Button>
      {error ? (
        <div className="mt-2">
          <ErrorBox error={error} onRetry={prepare} />
        </div>
      ) : null}
      {message ? (
        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold text-emerald-900">Message preview (finalised dances only)</p>
            <button type="button" aria-label="Close preview" onClick={() => setMessage(null)} className="flex h-11 w-11 items-center justify-center rounded-full">
              <IconX />
            </button>
          </div>
          <pre className="max-h-64 overflow-auto rounded-xl bg-white p-3 text-sm break-words whitespace-pre-wrap">{message}</pre>
          <div className="mt-3 grid gap-2">
            <a
              href={whatsappShareUrl(message)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-600 font-semibold text-white active:bg-emerald-700"
            >
              Open WhatsApp
            </a>
            <div className="grid grid-cols-2 gap-2">
              {canShare ? (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.share({ text: message });
                    } catch (e) {
                      if ((e as Error).name !== 'AbortError') toast(errorMessage(e), { tone: 'error' });
                    }
                  }}
                >
                  <IconShare size={18} /> Share…
                </Button>
              ) : null}
              <Button
                variant="secondary"
                className={canShare ? '' : 'col-span-2'}
                onClick={async () => toast((await copyText(message)) ? 'Message copied — paste it into WhatsApp' : 'Could not copy')}
              >
                <IconCopy size={18} /> Copy text
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
