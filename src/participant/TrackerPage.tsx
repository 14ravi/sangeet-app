// Privacy-safe progress tracker: counts and names only. The server sends
// nothing else (no songs, order, type, audio or per-person counts).
import { useApi, useDocumentTitle } from '../lib/hooks';
import { Card, EmptyState, ErrorBox, Loading } from '../components/ui';

interface Tracker {
  total: number;
  included: number;
  not_included: number;
  by_side: { bride: { total: number; included: number }; groom: { total: number; included: number } };
  names: string[];
}

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
  const pct = data.total ? Math.round((data.included / data.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Dance progress</h1>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Total people" value={data.total} tone="bg-white border border-stone-200" />
        <Stat label="Dancing" value={data.included} tone="bg-emerald-50 text-emerald-900" />
        <Stat label="Not yet" value={data.not_included} tone="bg-amber-50 text-amber-900" />
      </div>
      <div>
        <div className="h-3 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-sm text-stone-600">{pct}% of people are in at least one dance</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Card className="!p-3">
          <p className="text-sm font-semibold text-pink-800">Bride side</p>
          <p className="text-xl font-bold tabular-nums">
            {data.by_side.bride.included} <span className="text-base font-normal text-stone-500">/ {data.by_side.bride.total}</span>
          </p>
        </Card>
        <Card className="!p-3">
          <p className="text-sm font-semibold text-indigo-800">Groom side</p>
          <p className="text-xl font-bold tabular-nums">
            {data.by_side.groom.included} <span className="text-base font-normal text-stone-500">/ {data.by_side.groom.total}</span>
          </p>
        </Card>
      </div>
      <section>
        <h2 className="mb-2 text-lg font-bold">Who's dancing</h2>
        {data.names.length === 0 ? (
          <EmptyState title="No dances yet">Names appear here once the organiser adds performances.</EmptyState>
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
