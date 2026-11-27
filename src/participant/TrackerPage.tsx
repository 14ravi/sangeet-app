// Privacy-safe progress tracker. Each person sees ONLY their own side
// (Bride or Groom, set by the organiser), and only FINALISED dances (music
// uploaded): counts, names and the dance list (name, Solo/Group, performers).
// No songs, order, audio or notes are ever sent by the server.
import type { ShareDance } from '@shared/whatsapp.ts';
import { uniqueNames } from '@shared/whatsapp.ts';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { Badge, EmptyState, ErrorBox, Loading, Notice } from '../components/ui';

interface Tracker {
  viewer_side: 'bride' | 'groom' | null;
  total: number;
  included: number;
  not_included: number;
  names: string[];
  dances: ShareDance[];
}

const SIDE_LABEL = {
  groom: { title: '🤵 Groom side', tone: 'text-indigo-800' },
  bride: { title: '👰 Bride side', tone: 'text-pink-800' },
};

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-2xl p-3 text-center ${tone}`}>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="text-xs font-semibold">{label}</p>
    </div>
  );
}

export function TrackerPage() {
  useDocumentTitle('Progress');
  const { data, error, loading, reload } = useApi<Tracker>('participant/tracker');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  if (!data.viewer_side) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Dance progress</h1>
        <Notice tone="warning">
          The organiser hasn’t set your side (Bride or Groom) yet. Once they do, you’ll see your side’s dances here.
        </Notice>
      </div>
    );
  }

  const side = SIDE_LABEL[data.viewer_side];
  const pct = data.total ? Math.round((data.included / data.total) * 100) : 0;
  const dances = [...(data.dances ?? [])].sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' }));

  return (
    <div className="space-y-5">
      <div>
        <p className={`text-sm font-bold ${side.tone}`}>{side.title}</p>
        <h1 className="text-2xl font-bold">Dance progress</h1>
        <p className="text-sm text-stone-500">Only dances whose music is ready are counted here.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="People" value={data.total} tone="bg-white border border-stone-200" />
        <Stat label="Dancing" value={data.included} tone="bg-emerald-50 text-emerald-900" />
        <Stat label="Not yet" value={data.not_included} tone="bg-amber-50 text-amber-900" />
      </div>
      <div>
        <div className="h-3 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-sm text-stone-600">{pct}% of your side is in at least one finalised dance</p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold">
          💃 Finalised dances <span className="font-normal text-stone-500">({dances.length})</span>
        </h2>
        {dances.length === 0 ? (
          <EmptyState title="No dances finalised yet">Dances appear here once their music is ready.</EmptyState>
        ) : (
          <ol className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
            {dances.map((d, i) => (
              <li key={`${d.display_name}-${i}`} className="flex gap-3 px-4 py-3">
                <span className="w-6 shrink-0 pt-0.5 text-right font-bold text-stone-400 tabular-nums">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold break-words">{d.display_name}</span>
                    <Badge>{d.performance_type === 'solo' ? 'Solo' : 'Group'}</Badge>
                  </div>
                  <p className="mt-0.5 text-sm break-words text-stone-600">{uniqueNames(d.names).join(', ')}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">Who's dancing</h2>
        {data.names.length === 0 ? (
          <EmptyState title="No one yet">Names appear here once a dance's music is ready.</EmptyState>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
            {data.names.map((n, i) => (
              <li key={`${n}-${i}`} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-800">✓</span>
                <span className="min-w-0 break-words">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
