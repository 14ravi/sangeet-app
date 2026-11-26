import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { formatDate } from '../lib/format';
import type { Performance } from '../lib/types';
import { Badge, Button, Card, ConfirmButton, ErrorBox, Loading, Notice, PageHeader, useToast } from '../components/ui';
import { IconChevron, IconEdit, IconExternal, IconWarning } from '../components/icons';
import { PerformanceBadges, PerformerLinks } from './PerformanceBits';
import { AudioUploadCard } from './AudioUploadCard';

interface Detail {
  performance: Performance;
  same_song: { id: string; display_name: string; side: string }[];
  max_duration_seconds: number;
}

const LIVE_LABEL = { pending: 'Pending', completed: 'Completed', skipped: 'Skipped' } as const;

export function PerformancePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<Detail>('admin/performances/get', { id });
  const [deleting, setDeleting] = useState(false);
  useDocumentTitle(data?.performance.display_name ?? 'Performance');
  const justSaved = (location.state as { justSaved?: boolean } | null)?.justSaved;

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const p = data.performance;

  return (
    <div className="space-y-4">
      <PageHeader
        title={p.display_name}
        back="/admin/performances"
        subtitle={`#${p.position} in running order · ${LIVE_LABEL[p.live_status]}`}
        action={
          <Button size="sm" variant="secondary" onClick={() => navigate(`/admin/performances/${p.id}/edit`)}>
            <IconEdit size={18} /> Edit
          </Button>
        }
      />
      {justSaved && !p.has_audio ? <Notice tone="success">Saved. Now upload the trimmed audio clip below.</Notice> : null}
      <PerformanceBadges p={p} max={data.max_duration_seconds} duplicateCount={data.same_song.length + 1} />

      <AudioUploadCard
        performance={p}
        maxDuration={data.max_duration_seconds}
        onChange={(np) => setData((d) => ({ ...d!, performance: np }))}
      />

      <Card>
        <dl className="space-y-3">
          <div>
            <dt className="text-sm text-stone-500">Song</dt>
            <dd>
              <Link to={`/admin/songs/${encodeURIComponent(p.normalized_song_title)}`} className="flex min-h-11 items-center gap-2 font-semibold text-rose-800">
                <span className="min-w-0 flex-1 break-words">
                  ♪ {p.song_title}
                  {p.artist ? <span className="font-normal text-stone-600"> — {p.artist}</span> : null}
                </span>
                <IconChevron className="shrink-0" />
              </Link>
            </dd>
          </div>
          {data.same_song.length > 0 ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="flex items-center gap-2 font-semibold">
                <IconWarning size={16} /> Same title also used by:
              </p>
              <ul className="mt-1">
                {data.same_song.map((s) => (
                  <li key={s.id}>
                    <Link to={`/admin/performances/${s.id}`} className="inline-flex min-h-10 items-center underline">
                      {s.display_name} ({s.side === 'bride' ? 'Bride' : 'Groom'})
                    </Link>
                  </li>
                ))}
              </ul>
              <Link to={`/admin/songs/${encodeURIComponent(p.normalized_song_title)}`} className="mt-1 inline-flex min-h-10 items-center font-semibold underline">
                Listen and compare clips →
              </Link>
            </div>
          ) : null}
          <div>
            <dt className="text-sm text-stone-500">Participants ({p.participants.length})</dt>
            <dd className="leading-8">
              <PerformerLinks p={p} />
            </dd>
          </div>
          <div>
            <dt className="text-sm text-stone-500">YouTube reference</dt>
            <dd>
              {p.youtube_url ? (
                <a href={p.youtube_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 break-all text-rose-800 underline">
                  {p.youtube_url} <IconExternal size={16} className="shrink-0" />
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
          {p.admin_notes ? (
            <div>
              <dt className="text-sm text-stone-500">Notes</dt>
              <dd className="break-words whitespace-pre-wrap">{p.admin_notes}</dd>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 text-sm text-stone-500">
            <Badge>Updated {formatDate(p.updated_at)}</Badge>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">Delete performance</h2>
        <p className="mb-3 text-sm text-stone-600">Removes the performance and its audio. People stay in the master list.</p>
        <ConfirmButton
          variant="danger"
          block
          busy={deleting}
          confirmLabel="Tap again to delete permanently"
          onConfirm={async () => {
            setDeleting(true);
            try {
              await api('admin/performances/delete', { id: p.id });
              toast('Performance deleted');
              navigate('/admin/performances', { replace: true });
            } catch (e) {
              toast(errorMessage(e), { tone: 'error' });
              setDeleting(false);
            }
          }}
        >
          Delete performance
        </ConfirmButton>
      </Card>
    </div>
  );
}
