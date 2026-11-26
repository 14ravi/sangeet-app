// All performances that share one normalized song title, each with its own
// player so the admin can compare the exact trimmed clips. Warning only.
import { Link, useParams } from 'react-router';
import { useApi, useDocumentTitle } from '../lib/hooks';
import type { Performance } from '../lib/types';
import { AudioPlayer } from '../components/AudioPlayer';
import { Card, EmptyState, ErrorBox, Loading, Notice, PageHeader } from '../components/ui';
import { IconChevron, IconExternal } from '../components/icons';
import { PerformanceBadges, PerformerLinks } from './PerformanceBits';

export function SongPage() {
  const { key = '' } = useParams();
  const { data, error, loading, reload } = useApi<{ items: Performance[]; max_duration_seconds: number }>('admin/songs/get', { key });
  const title = data?.items[0]?.song_title ?? key;
  useDocumentTitle(title);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <PageHeader title={`♪ ${title}`} back="/admin/songs" subtitle={`${data.items.length} performance${data.items.length === 1 ? '' : 's'} with this title`} />
      {data.items.length > 1 ? (
        <Notice tone="warning">
          <strong>Possible duplicate.</strong> {data.items.length} performances use this song title (YouTube links may differ). Play each
          clip to check whether they use the same part of the song. Keeping both is fine — nothing is changed automatically.
        </Notice>
      ) : null}
      {data.items.length === 0 ? (
        <EmptyState title="No performances use this title any more">
          <Link to="/admin/songs" className="font-semibold text-rose-700 underline">
            Back to songs
          </Link>
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {data.items.map((p) => (
            <li key={p.id}>
              <Card>
                <Link to={`/admin/performances/${p.id}`} className="-m-1 flex min-h-12 items-start gap-2 rounded-xl p-1 active:bg-stone-50">
                  <span className="mt-0.5 w-8 shrink-0 text-right font-bold text-stone-400 tabular-nums">#{p.position}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-semibold break-words">{p.display_name}</span>
                    <span className="block text-sm break-words text-stone-500">
                      {p.song_title}
                      {p.artist ? ` — ${p.artist}` : ''}
                    </span>
                  </span>
                  <IconChevron className="mt-1 shrink-0 text-stone-400" />
                </Link>
                <div className="mt-2">
                  <PerformanceBadges p={p} max={data.max_duration_seconds} />
                </div>
                <p className="mt-2 text-sm">
                  <PerformerLinks p={p} />
                </p>
                <div className="mt-3">
                  {p.has_audio ? (
                    <AudioPlayer performanceId={p.id} knownDuration={p.duration_seconds} label={p.display_name} />
                  ) : (
                    <p className="text-sm text-stone-500">No audio uploaded yet.</p>
                  )}
                </div>
                {p.youtube_url ? (
                  <a href={p.youtube_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm text-rose-800 underline">
                    YouTube reference <IconExternal size={14} />
                  </a>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
