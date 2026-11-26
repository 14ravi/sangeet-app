import { useApi, useDocumentTitle } from '../lib/hooks';
import { formatDuration } from '@shared/duration.ts';
import { DownloadAudioButton } from '../components/AudioPlayer';
import { Card, EmptyState, ErrorBox, Loading, Notice, SideBadge } from '../components/ui';

interface MyPerf {
  id: string;
  display_name: string;
  song_title: string;
  side: string;
  performance_type: string;
  duration_seconds: number | null;
  has_audio: boolean;
  participants: string[] | null;
}

export function MyPerformancesPage() {
  useDocumentTitle('My dances');
  const { data, error, loading, reload } = useApi<{ items: MyPerf[]; linked: boolean; link_status: string }>('participant/my-performances');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My dances</h1>
      {!data.linked ? (
        <Notice tone="warning">
          Your registration is waiting for the organiser to confirm it. Once confirmed, your dances and music will appear here.
        </Notice>
      ) : data.items.length === 0 ? (
        <EmptyState title="No dances yet">When the organiser adds you to a performance, its music will appear here for download.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {data.items.map((p) => (
            <li key={p.id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-lg font-bold break-words">{p.display_name}</p>
                    <p className="break-words text-stone-600">♪ {p.song_title}</p>
                  </div>
                  <SideBadge side={p.side} />
                </div>
                {p.participants && p.participants.length > 1 ? (
                  <p className="mt-2 text-sm text-stone-500">With: {p.participants.join(', ')}</p>
                ) : null}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-sm text-stone-500 tabular-nums">{p.duration_seconds ? formatDuration(p.duration_seconds) : ''}</span>
                  {p.has_audio ? (
                    <DownloadAudioButton performanceId={p.id} asParticipant />
                  ) : (
                    <span className="text-sm text-stone-500">Music not uploaded yet</span>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
