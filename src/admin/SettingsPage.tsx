import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage, tokens } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { appBaseUrl, formatDate } from '../lib/format';
import { appLinks } from '@shared/whatsapp.ts';
import { formatDuration, parseDuration } from '@shared/duration.ts';
import type { Settings } from '../lib/types';
import { Button, Card, cx, CopyButton, ErrorBox, Field, Loading, PageHeader, TextInput, useToast } from '../components/ui';
import { IconLogout } from '../components/icons';

const PRESETS = [90, 120, 150, 180, 240];

export function SettingsPage() {
  useDocumentTitle('Settings');
  const navigate = useNavigate();
  const { data, error, loading, reload, setData } = useApi<Settings>('admin/settings/get');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  async function logout() {
    try {
      await api('admin/logout');
    } catch {
      /* ignore */
    }
    tokens.clear('admin');
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <GeneralSettings settings={data} onSaved={setData} />
      <LinksCard settings={data} />
      <PasswordCard currentUsername={data.admin_username ?? ''} />
      <AuditCard />
      <Button variant="secondary" block size="lg" onClick={logout}>
        <IconLogout /> Log out of admin
      </Button>
    </div>
  );
}

function GeneralSettings({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const toast = useToast();
  const [eventName, setEventName] = useState(settings.event_name);
  const [publicUrl, setPublicUrl] = useState(settings.public_app_url ?? '');
  const [custom, setCustom] = useState(PRESETS.includes(settings.max_duration_seconds) ? '' : formatDuration(settings.max_duration_seconds).replace(/^0/, ''));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(key: string, body: Record<string, unknown>, ok = 'Saved') {
    setBusy(key);
    setError(null);
    try {
      onSaved(await api<Settings>('admin/settings/update', body));
      toast(ok);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card>
        <h2 className="text-lg font-bold">Registration</h2>
        <p className="mb-3 text-sm text-stone-600">
          {settings.registration_enabled ? 'Open — anyone with the link can register.' : 'Closed — existing people can still log in.'}
        </p>
        <Button
          block
          variant={settings.registration_enabled ? 'secondary' : 'primary'}
          busy={busy === 'reg'}
          onClick={() => save('reg', { registration_enabled: !settings.registration_enabled }, settings.registration_enabled ? 'Registration closed' : 'Registration opened')}
        >
          {settings.registration_enabled ? 'Close registration' : 'Open registration'}
        </Button>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Maximum clip duration</h2>
        <p className="mb-3 text-sm text-stone-600">
          Clips longer than this get a warning. It never blocks anything. Current: <strong>{formatDuration(settings.max_duration_seconds)}</strong>
        </p>
        <div className="grid grid-cols-5 gap-2">
          {PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => save('dur', { max_duration_seconds: s })}
              className={cx(
                'min-h-12 rounded-xl border text-sm font-semibold tabular-nums',
                settings.max_duration_seconds === s ? 'border-rose-700 bg-rose-700 text-white' : 'border-stone-300 bg-white',
              )}
            >
              {formatDuration(s).replace(/^0/, '')}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-semibold">Custom (m:ss)</span>
            <TextInput inputMode="numeric" placeholder="2:45" value={custom} onChange={(e) => setCustom(e.target.value)} />
          </label>
          <Button
            variant="secondary"
            busy={busy === 'dur'}
            onClick={() => {
              const s = parseDuration(custom);
              if (!s || s < 10 || s > 3600) setError('Enter a duration like 2:45');
              else void save('dur', { max_duration_seconds: s });
            }}
          >
            Set
          </Button>
        </div>
      </Card>

      <Card>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void save('general', { event_name: eventName, public_app_url: publicUrl });
          }}
        >
          <h2 className="text-lg font-bold">Event details</h2>
          <Field label="Event name" htmlFor="event_name" hint="Shown on the login pages and in the WhatsApp message.">
            <TextInput id="event_name" value={eventName} onChange={(e) => setEventName(e.target.value)} />
          </Field>
          <Field label="Public app link (optional)" htmlFor="public_url" hint={`Leave blank to use this site's address (${window.location.origin}).`}>
            <TextInput id="public_url" type="url" inputMode="url" placeholder="https://your-site.pages.dev" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />
          </Field>
          <Button type="submit" block busy={busy === 'general'}>
            Save event details
          </Button>
        </form>
      </Card>
      {error ? <ErrorBox error={new Error(error)} /> : null}
    </>
  );
}

function LinksCard({ settings }: { settings: Settings }) {
  const { registerUrl, trackerUrl } = appLinks(appBaseUrl(settings.public_app_url));
  return (
    <Card>
      <h2 className="mb-2 text-lg font-bold">Links to share</h2>
      {[
        ['Registration', registerUrl],
        ['Progress tracker', trackerUrl],
      ].map(([label, url]) => (
        <div key={label} className="mb-3">
          <p className="text-sm font-semibold text-stone-600">{label}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-stone-100 px-2 py-2 text-sm break-all">{url}</code>
            <CopyButton text={url} />
          </div>
        </div>
      ))}
      <p className="text-xs text-stone-500">The admin pages are not linked from these pages. Admin login is at /admin.</p>
    </Card>
  );
}

function PasswordCard({ currentUsername }: { currentUsername: string }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 10) return setError('New password must be at least 10 characters.');
    if (next !== next2) return setError('New passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await api('admin/change-password', { current_password: current, new_password: next, new_username: username || undefined });
      setCurrent('');
      setNext('');
      setNext2('');
      setUsername('');
      toast('Password changed. Other devices have been signed out.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <h2 className="text-lg font-bold">Admin password</h2>
        <p className="text-sm text-stone-600">
          Username: <strong>{currentUsername}</strong>. Changing the password signs out every other device (e.g. the event manager's phone) —
          share the new password with them.
        </p>
        <Field label="Current password" htmlFor="cur_pw">
          <TextInput id="cur_pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password (10+ characters)" htmlFor="new_pw">
          <TextInput id="new_pw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Repeat new password" htmlFor="new_pw2">
          <TextInput id="new_pw2" type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} />
        </Field>
        <Field label="New username (optional)" htmlFor="new_user">
          <TextInput id="new_user" autoCapitalize="none" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        {error ? <ErrorBox error={new Error(error)} /> : null}
        <Button type="submit" block busy={busy} disabled={!current || !next}>
          Change password
        </Button>
      </form>
    </Card>
  );
}

const ACTION_LABELS: Record<string, string> = {
  pin_reset: 'PIN reset to 0000',
  account_block: 'Account blocked',
  account_unblock: 'Account unblocked',
  account_link: 'Registration linked',
  admin_password_change: 'Admin password changed',
  admin_bootstrap: 'Admin account created',
  participant_delete: 'Person deleted',
  participant_archive: 'Person archived',
  participant_restore: 'Person restored',
  performance_delete: 'Performance deleted',
  audio_remove: 'Audio removed',
  settings_registration: 'Registration setting changed',
};

function AuditCard() {
  const [open, setOpen] = useState(false);
  const log = useApi<{ entries: { id: number; action: string; target_type: string | null; target_id: string | null; actor: string; created_at: string; details: Record<string, unknown> }[] }>(
    open ? 'admin/audit-log' : null,
  );
  return (
    <Card>
      <button type="button" className="flex min-h-11 w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <h2 className="text-lg font-bold">Recent admin activity</h2>
        <span className="text-sm text-rose-700">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        log.loading ? (
          <Loading />
        ) : log.error ? (
          <ErrorBox error={log.error} onRetry={log.reload} />
        ) : log.data?.entries.length ? (
          <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {log.data.entries.map((e) => (
              <li key={e.id} className="py-2">
                <p className="font-semibold">{ACTION_LABELS[e.action] ?? e.action}</p>
                <p className="text-stone-500">
                  {formatDate(e.created_at)} · {e.actor}
                  {typeof e.details?.name === 'string' ? ` · ${e.details.name}` : ''}
                  {typeof e.details?.display_name === 'string' ? ` · ${e.details.display_name}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-stone-500">No activity yet.</p>
        )
      ) : null}
    </Card>
  );
}
