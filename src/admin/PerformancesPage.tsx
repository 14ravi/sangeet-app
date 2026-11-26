import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { isOverLimit } from '@shared/duration.ts';
import type { Performance } from '../lib/types';
import { Button, cx, EmptyState, ErrorBox, Loading, PageHeader, TextInput } from '../components/ui';
import { IconPlus, IconSearch } from '../components/icons';
import { PerformanceBadges, performerNames } from './PerformanceBits';

type Filter = 'all' | 'bride' | 'groom' | 'draft' | 'no_audio' | 'over';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bride', label: 'Bride' },
  { value: 'groom', label: 'Groom' },
  { value: 'draft', label: 'Draft' },
  { value: 'no_audio', label: 'No audio' },
  { value: 'over', label: 'Too long' },
];

export function PerformancesPage() {
  useDocumentTitle('Performances');
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<{ items: Performance[]; max_duration_seconds: number }>('admin/performances/list');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const dupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.items ?? []) m.set(p.normalized_song_title, (m.get(p.normalized_song_title) ?? 0) + 1);
    return m;
  }, [data]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? []).filter((p) => {
      if (filter === 'bride' && p.side !== 'bride') return false;
      if (filter === 'groom' && p.side !== 'groom') return false;
      if (filter === 'draft' && p.preparation_status !== 'draft') return false;
      if (filter === 'no_audio' && p.has_audio) return false;
      if (filter === 'over' && !isOverLimit(p.duration_seconds, data?.max_duration_seconds)) return false;
      if (!needle) return true;
      return `${p.display_name} ${p.song_title} ${p.artist ?? ''} ${performerNames(p)}`.toLowerCase().includes(needle);
    });
  }, [data, q, filter]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Performances"
        subtitle={`${data.items.length} total · listed in running order`}
        action={
          <Button size="sm" onClick={() => navigate('/admin/performances/new')}>
            <IconPlus size={18} /> New
          </Button>
        }
      />
      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
        <TextInput type="search" placeholder="Search name, song or person" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" aria-label="Search performances" />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cx('min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold', filter === f.value ? 'border-rose-700 bg-rose-700 text-white' : 'border-stone-300 bg-white text-stone-700')}
          >
            {f.label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <EmptyState title={data.items.length ? 'No matches' : 'No performances yet'}>
          {data.items.length ? 'Try another search or filter.' : 'Tap New to add the first dance.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => navigate(`/admin/performances/${p.id}`)}
                className="block w-full rounded-2xl border border-stone-200 bg-white p-3 text-left shadow-sm active:bg-stone-50"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 w-9 shrink-0 text-right text-lg font-bold text-stone-400 tabular-nums">{p.position}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words">{p.display_name}</p>
                    <p className="text-sm break-words text-stone-600">♪ {p.song_title}</p>
                    <p className="text-sm break-words text-stone-500">{performerNames(p) || 'No participants yet'}</p>
                    <div className="mt-2">
                      <PerformanceBadges p={p} max={data.max_duration_seconds} duplicateCount={dupCounts.get(p.normalized_song_title)} />
                    </div>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
