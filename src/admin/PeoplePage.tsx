import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { formatDate, fullName } from '../lib/format';
import { formatPhone } from '@shared/phone.ts';
import type { Participant, PendingAccount } from '../lib/types';
import { Badge, Button, Card, cx, EmptyState, ErrorBox, Loading, PageHeader, SideBadge, TextInput, useToast } from '../components/ui';
import { PhoneActions } from '../components/PhoneActions';
import { IconPlus, IconSearch } from '../components/icons';

type Filter = 'all' | 'registered' | 'not_dancing' | 'blocked' | 'archived';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'registered', label: 'Registered' },
  { value: 'not_dancing', label: 'Not in a dance' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'archived', label: 'Archived' },
];
const PAGE = 60;

export function PeoplePage() {
  useDocumentTitle('People');
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<{ participants: Participant[]; pending_accounts: PendingAccount[] }>('admin/participants/list');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);

  const list = useMemo(() => {
    const all = data?.participants ?? [];
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return all.filter((p) => {
      if (filter === 'archived' ? p.is_active : !p.is_active) return false;
      if (filter === 'registered' && !p.account) return false;
      if (filter === 'not_dancing' && p.performance_count > 0) return false;
      if (filter === 'blocked' && !p.account?.blocked) return false;
      if (!needle) return true;
      if (`${p.first_name} ${p.last_name}`.toLowerCase().includes(needle)) return true;
      if (p.last_name.toLowerCase().includes(needle)) return true;
      const phones = [p.phone, p.account?.phone].filter(Boolean).join(' ');
      return digits.length >= 3 && phones.replace(/\D/g, '').includes(digits);
    });
  }, [data, q, filter]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="People"
        subtitle={`${data.participants.filter((p) => p.is_active).length} in master list`}
        action={
          <Button size="sm" onClick={() => navigate('/admin/people/new')}>
            <IconPlus size={18} /> Add
          </Button>
        }
      />

      {data.pending_accounts.length > 0 ? <PendingLinks items={data.pending_accounts} onDone={reload} /> : null}

      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
        <TextInput type="search" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" aria-label="Search people" />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cx(
              'min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold',
              filter === f.value ? 'border-rose-700 bg-rose-700 text-white' : 'border-stone-300 bg-white text-stone-700',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState title={q || filter !== 'all' ? 'No matches' : 'No people yet'}>
          {q || filter !== 'all' ? 'Try a different search or filter.' : 'People appear here when they register, or tap Add to enter someone yourself.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {list.slice(0, limit).map((p) => (
            <li key={p.id}>
              <div
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/admin/people/${p.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/admin/people/${p.id}`)}
                className="cursor-pointer rounded-2xl border border-stone-200 bg-white p-3 shadow-sm active:bg-stone-50"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words">{fullName(p)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <SideBadge side={p.side} />
                      {p.account ? <Badge tone="sky">Registered</Badge> : <Badge>Not registered</Badge>}
                      {p.account?.blocked ? <Badge tone="red">Blocked</Badge> : null}
                      {p.performance_count > 0 ? (
                        <Badge tone="green">
                          In {p.performance_count} dance{p.performance_count > 1 ? 's' : ''}
                        </Badge>
                      ) : (
                        <Badge tone="amber">No dance yet</Badge>
                      )}
                    </div>
                  </div>
                  <PhoneActions phone={p.account?.phone ?? p.phone} showNumber={false} />
                </div>
                <p className="mt-1 text-sm text-stone-500 tabular-nums">
                  {formatPhone(p.account?.phone ?? p.phone) || 'No phone'}
                  {p.account ? ` · last login ${formatDate(p.account.last_login_at)}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.length > limit ? (
        <Button variant="secondary" block onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({list.length - limit} more)
        </Button>
      ) : null}
    </div>
  );
}

function PendingLinks({ items, onDone }: { items: PendingAccount[]; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function link(accountId: string, participantId: string | null) {
    setBusy(accountId + (participantId ?? 'new'));
    try {
      await api('admin/accounts/link', { account_id: accountId, participant_id: participantId });
      toast(participantId ? 'Linked to existing person' : 'Added as a new person');
      onDone();
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-amber-300 bg-amber-50">
      <h2 className="text-lg font-bold text-amber-900">Needs your confirmation</h2>
      <p className="mb-3 text-sm text-amber-900">
        These people registered with a phone number you had already entered. Phone numbers are not verified, so please confirm
        it is really the same person before linking (linking gives them access to that person's music).
      </p>
      <ul className="space-y-3">
        {items.map((a) => (
          <li key={a.id} className="rounded-xl bg-white p-3">
            <p className="font-semibold">
              {a.first_name} {a.last_name}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-1 text-sm text-stone-600">
              <span>Registered {formatDate(a.registered_at)}</span>
              <PhoneActions phone={a.phone} />
            </div>
            <div className="mt-2 grid gap-2">
              {a.candidates.map((c) => (
                <Button key={c.id} size="sm" busy={busy === a.id + c.id} onClick={() => link(a.id, c.id)}>
                  Link to {c.first_name} {c.last_name}
                </Button>
              ))}
              <Button size="sm" variant="secondary" busy={busy === a.id + 'new'} onClick={() => link(a.id, null)}>
                Different person — add as new
              </Button>
              <Link to="/admin/people" className="hidden" />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
