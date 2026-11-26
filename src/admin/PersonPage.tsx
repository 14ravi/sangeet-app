import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { formatDate, fullName } from '../lib/format';
import { normalizePhone } from '@shared/phone.ts';
import { validateEmail, validateName, type Side } from '@shared/validation.ts';
import type { Participant } from '../lib/types';
import { Badge, Button, Card, ConfirmButton, ErrorBox, Field, Loading, Notice, PageHeader, Segmented, SideBadge, TextInput, useToast } from '../components/ui';
import { PhoneActions } from '../components/PhoneActions';
import { IconChevron, IconEdit } from '../components/icons';

interface PersonDetail {
  participant: Participant;
  performances: { id: string; display_name: string; song_title: string; side: string; position: number; live_status: string }[];
  same_phone: { id: string; first_name: string; last_name: string }[];
}

export function PersonPage({ isNew }: { isNew?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const detail = useApi<PersonDetail>(isNew ? null : 'admin/participants/get', { id });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useDocumentTitle(isNew ? 'Add person' : detail.data ? fullName(detail.data.participant) : 'Person');

  if (isNew) {
    return (
      <div>
        <PageHeader title="Add person" back="/admin/people" />
        <PersonForm
          onSaved={(p, samePhone) => {
            if (samePhone > 0) toast('Saved — note: another person has the same phone number');
            navigate(`/admin/people/${p.id}`, { replace: true });
          }}
        />
      </div>
    );
  }
  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error) return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return null;
  const { participant: p, performances, same_phone } = detail.data;
  const acc = p.account;

  async function run(key: string, route: string, body: Record<string, unknown>, ok: string) {
    setBusy(key);
    try {
      await api(route, body);
      toast(ok);
      await detail.reload();
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const canDelete = performances.length === 0 && !acc;

  return (
    <div className="space-y-4">
      <PageHeader
        title={fullName(p)}
        back="/admin/people"
        subtitle={
          <span className="flex flex-wrap gap-1">
            <SideBadge side={p.side} />
            {p.is_active ? null : <Badge tone="amber">Archived</Badge>}
            {acc?.blocked ? <Badge tone="red">Blocked</Badge> : null}
          </span>
        }
        action={
          !editing ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <IconEdit size={18} /> Edit
            </Button>
          ) : null
        }
      />

      {editing ? (
        <Card>
          <PersonForm
            initial={p}
            onCancel={() => setEditing(false)}
            onSaved={async (_p, samePhone) => {
              setEditing(false);
              toast(samePhone > 0 ? 'Saved — another person has the same phone number' : 'Saved');
              await detail.reload();
            }}
          />
        </Card>
      ) : (
        <Card>
          <dl className="space-y-3">
            <div>
              <dt className="text-sm text-stone-500">Phone (contact)</dt>
              <dd>
                <PhoneActions phone={p.phone} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-stone-500">Email</dt>
              <dd className="break-all">{p.email || '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-stone-500">Added</dt>
              <dd>
                {formatDate(p.created_at)} {p.created_via === 'registration' ? '(self-registered)' : '(added by admin)'}
              </dd>
            </div>
          </dl>
          {same_phone.length > 0 ? (
            <div className="mt-3">
              <Notice tone="warning">
                Same phone number as:{' '}
                {same_phone.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 ? ', ' : ''}
                    <Link className="font-semibold underline" to={`/admin/people/${s.id}`}>
                      {s.first_name} {s.last_name}
                    </Link>
                  </span>
                ))}
                . Check this isn't a duplicate.
              </Notice>
            </div>
          ) : null}
        </Card>
      )}

      <Card>
        <h2 className="mb-2 text-lg font-bold">Login account</h2>
        {acc ? (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="col-span-2">
                <dt className="text-stone-500">Login phone</dt>
                <dd>
                  <PhoneActions phone={acc.phone} />
                </dd>
              </div>
              <div>
                <dt className="text-stone-500">Registered</dt>
                <dd>{formatDate(acc.registered_at)}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Last login</dt>
                <dd>{formatDate(acc.last_login_at)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-stone-500">Status</dt>
                <dd>
                  {acc.blocked ? (
                    <Badge tone="red">Blocked</Badge>
                  ) : acc.must_change_pin ? (
                    <Badge tone="amber">PIN reset — temporary 0000 until {formatDate(acc.temp_pin_expires_at)}</Badge>
                  ) : (
                    <Badge tone="green">Active</Badge>
                  )}
                </dd>
              </div>
            </dl>
            {acc.first_name !== p.first_name || acc.last_name !== p.last_name ? (
              <p className="text-sm text-stone-500">
                Registered as “{acc.first_name} {acc.last_name}”.
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <ConfirmButton
                variant="secondary"
                busy={busy === 'reset'}
                confirmLabel="Confirm reset to 0000"
                onConfirm={() => run('reset', 'admin/accounts/reset-pin', { account_id: acc.id }, 'PIN reset to 0000 for 24 hours')}
              >
                Reset PIN
              </ConfirmButton>
              {acc.blocked ? (
                <Button variant="secondary" busy={busy === 'block'} onClick={() => run('block', 'admin/accounts/block', { account_id: acc.id, blocked: false }, 'Unblocked')}>
                  Unblock
                </Button>
              ) : (
                <ConfirmButton
                  variant="danger"
                  busy={busy === 'block'}
                  confirmLabel="Confirm block"
                  onConfirm={() => run('block', 'admin/accounts/block', { account_id: acc.id, blocked: true }, 'Blocked')}
                >
                  Block
                </ConfirmButton>
              )}
            </div>
            <p className="text-xs text-stone-500">
              Reset PIN sets a temporary PIN of 0000 (valid 24 hours). Tell the person to log in with 0000 straight away — they will
              be asked to choose a new PIN.
            </p>
          </div>
        ) : (
          <p className="text-stone-600">Not registered. They can register themselves; if they use this phone number you will be asked to confirm the link.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Performances ({performances.length})</h2>
        {performances.length === 0 ? (
          <p className="text-stone-600">Not in any performance yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {performances.map((x) => (
              <li key={x.id}>
                <Link to={`/admin/performances/${x.id}`} className="flex min-h-12 items-center gap-3 py-2 active:bg-stone-50">
                  <span className="w-8 text-right font-bold text-stone-400 tabular-nums">#{x.position}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold break-words">{x.display_name}</span>
                    <span className="block text-sm break-words text-stone-500">♪ {x.song_title}</span>
                  </span>
                  <IconChevron className="shrink-0 text-stone-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Remove</h2>
        <div className="grid gap-2">
          <Button
            variant="secondary"
            busy={busy === 'archive'}
            onClick={() =>
              run('archive', 'admin/participants/set-active', { id: p.id, active: !p.is_active }, p.is_active ? 'Archived' : 'Restored')
            }
          >
            {p.is_active ? 'Archive (hide from lists & tracker)' : 'Restore from archive'}
          </Button>
          {canDelete ? (
            <ConfirmButton
              variant="danger"
              busy={busy === 'delete'}
              confirmLabel="Tap again to delete permanently"
              onConfirm={async () => {
                setBusy('delete');
                try {
                  await api('admin/participants/delete', { id: p.id });
                  toast('Deleted');
                  navigate('/admin/people', { replace: true });
                } catch (e) {
                  toast(errorMessage(e), { tone: 'error' });
                  setBusy(null);
                }
              }}
            >
              Delete person
            </ConfirmButton>
          ) : (
            <p className="text-sm text-stone-500">
              {acc ? 'Registered people cannot be deleted — block or archive instead.' : 'People in a performance cannot be deleted — archive instead, or remove them from their performances first.'}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function PersonForm({ initial, onSaved, onCancel }: { initial?: Participant; onSaved: (p: Participant, samePhone: number) => void; onCancel?: () => void }) {
  const [form, setForm] = useState({
    first_name: initial?.first_name ?? '',
    last_name: initial?.last_name ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    side: (initial?.side ?? '') as Side | '',
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs = {
      first_name: validateName(form.first_name, 'First name'),
      last_name: validateName(form.last_name, 'Last name'),
      phone: form.phone.trim() && !normalizePhone(form.phone) ? 'Enter a valid phone number or leave blank.' : null,
      email: validateEmail(form.email),
    };
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ participant: Participant; same_phone_count: number }>('admin/participants/save', { id: initial?.id, ...form });
      onSaved(r.participant, r.same_phone_count);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="First name" htmlFor="pf_first" error={errors.first_name}>
        <TextInput id="pf_first" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
      </Field>
      <Field label="Last name" htmlFor="pf_last" error={errors.last_name}>
        <TextInput id="pf_last" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
      </Field>
      <Field label="Side">
        <Segmented
          name="Side"
          value={form.side}
          onChange={(v) => setForm({ ...form, side: v })}
          options={[
            { value: 'bride', label: 'Bride', className: 'border-pink-500 bg-pink-50 text-pink-800' },
            { value: 'groom', label: 'Groom', className: 'border-indigo-500 bg-indigo-50 text-indigo-800' },
          ]}
        />
      </Field>
      <Field label="Phone (optional)" htmlFor="pf_phone" error={errors.phone} hint="Contact number. Not verified.">
        <TextInput id="pf_phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </Field>
      <Field label="Email (optional)" htmlFor="pf_email" error={errors.email}>
        <TextInput id="pf_email" type="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      {error ? <ErrorBox error={new Error(error)} /> : null}
      <div className="grid grid-cols-2 gap-2">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" busy={busy} className={onCancel ? '' : 'col-span-2'}>
          Save
        </Button>
      </div>
    </form>
  );
}
