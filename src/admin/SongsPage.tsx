import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { normalizeSongTitle } from '@shared/songs.ts';
import { Badge, cx, EmptyState, ErrorBox, Loading, PageHeader, TextInput } from '../components/ui';
import { IconChevron, IconSearch, IconWarning } from '../components/icons';

interface Song {
  key: string;
  title: string;
  count: number;
  artists: string[];
  sides: string[];
}

export function SongsPage() {
  useDocumentTitle('Songs');
  const { data, error, loading, reload } = useApi<{ songs: Song[] }>('admin/songs/list');
  const [q, setQ] = useState('');
  const [dupsOnly, setDupsOnly] = useState(false);

  const songs = useMemo(() => {
    const needle = normalizeSongTitle(q);
    return (data?.songs ?? [])
      .filter((s) => (!dupsOnly || s.count > 1) && (!needle || s.key.includes(needle) || s.artists.some((a) => normalizeSongTitle(a).includes(needle))))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }, [data, q, dupsOnly]);
  const dupTotal = (data?.songs ?? []).filter((s) => s.count > 1).length;

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  // Group A–Z by first character for quick scanning.
  let lastLetter = '';

  return (
    <div className="space-y-4">
      <PageHeader title="Songs A–Z" subtitle={`${data.songs.length} distinct titles`} />
      {dupTotal > 0 ? (
        <button
          type="button"
          onClick={() => setDupsOnly((v) => !v)}
          className={cx(
            'flex min-h-12 w-full items-center gap-2 rounded-xl border px-3 text-left font-semibold',
            dupsOnly ? 'border-amber-500 bg-amber-100 text-amber-900' : 'border-amber-300 bg-amber-50 text-amber-900',
          )}
        >
          <IconWarning className="shrink-0" />
          <span className="flex-1">
            {dupTotal} title{dupTotal > 1 ? 's' : ''} used more than once
          </span>
          <span className="text-sm">{dupsOnly ? 'Show all' : 'Show only these'}</span>
        </button>
      ) : null}
      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
        <TextInput type="search" placeholder="Search songs or artists" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" aria-label="Search songs" />
      </div>
      {songs.length === 0 ? (
        <EmptyState title={data.songs.length ? 'No matches' : 'No songs yet'}>
          {data.songs.length ? 'Try another search.' : 'Songs appear here when you add performances.'}
        </EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          {songs.map((s) => {
            const letter = s.title.charAt(0).toUpperCase();
            const header = letter !== lastLetter;
            lastLetter = letter;
            return (
              <li key={s.key}>
                {header ? <div className="sticky top-14 bg-stone-100 px-4 py-1 text-xs font-bold text-stone-500">{letter}</div> : null}
                <Link to={`/admin/songs/${encodeURIComponent(s.key)}`} className="flex min-h-14 items-center gap-3 border-t border-stone-100 px-4 py-2 active:bg-stone-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold break-words">{s.title}</span>
                    {s.artists.length ? <span className="block text-sm break-words text-stone-500">{s.artists.join(', ')}</span> : null}
                  </span>
                  {s.count > 1 ? (
                    <Badge tone="amber">
                      <IconWarning size={12} /> {s.count} performances
                    </Badge>
                  ) : (
                    <Badge>1</Badge>
                  )}
                  <IconChevron className="shrink-0 text-stone-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
