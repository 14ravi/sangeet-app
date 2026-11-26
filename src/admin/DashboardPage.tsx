import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { formatDuration } from '@shared/duration.ts';
import { Card, ErrorBox, Loading } from '../components/ui';
import { IconChevron, IconWarning } from '../components/icons';
import { SharePanel } from './SharePanel';
import type { Settings } from '../lib/types';

interface Dashboard {
  registered_accounts: number;
  participants_total: number;
  included: number;
  not_included: number;
  performances_total: number;
  performances_ready: number;
  performances_without_audio: number;
  over_duration: number;
  duplicate_titles: number;
  pending_links: number;
  blocked_accounts: number;
  by_side: {
    bride: { total: number; included: number; performances: number };
    groom: { total: number; included: number; performances: number };
    unassigned: number;
  };
  live: { pending: number; completed: number; skipped: number };
  max_duration_seconds: number;
  event_name: string;
}

function Counter({ label, value, to }: { label: string; value: number; to?: string }) {
  const inner = (
    <>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="text-sm text-stone-600">{label}</p>
    </>
  );
  return to ? (
    <Link to={to} className="block rounded-2xl border border-stone-200 bg-white p-3 shadow-sm active:bg-stone-50">
      {inner}
    </Link>
  ) : (
    <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">{inner}</div>
  );
}

function Alert({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-12 items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 active:bg-amber-100">
      <IconWarning className="shrink-0" />
      <span className="flex-1">{children}</span>
      <IconChevron className="shrink-0" />
    </Link>
  );
}

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const { data, error, loading, reload } = useApi<Dashboard>('admin/dashboard');
  const settings = useApi<Settings>('admin/settings/get');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold tracking-wide text-rose-800 uppercase">{data.event_name}</p>
        <h1 className="text-2xl font-bold">Overview</h1>
      </div>

      <SharePanel publicAppUrl={settings.data?.public_app_url} />

      <div className="space-y-2">
        {data.pending_links > 0 ? (
          <Alert to="/admin/people">
            {data.pending_links} registration{data.pending_links > 1 ? 's' : ''} need{data.pending_links > 1 ? '' : 's'} linking
          </Alert>
        ) : null}
        {data.duplicate_titles > 0 ? <Alert to="/admin/songs">{data.duplicate_titles} song title{data.duplicate_titles > 1 ? 's are' : ' is'} used more than once</Alert> : null}
        {data.over_duration > 0 ? (
          <Alert to="/admin/performances">
            {data.over_duration} clip{data.over_duration > 1 ? 's' : ''} longer than {formatDuration(data.max_duration_seconds)}
          </Alert>
        ) : null}
        {data.performances_without_audio > 0 ? (
          <Alert to="/admin/performances">
            {data.performances_without_audio} performance{data.performances_without_audio > 1 ? 's' : ''} without audio
          </Alert>
        ) : null}
      </div>

      <section className="grid grid-cols-2 gap-2">
        <Counter label="Registered accounts" value={data.registered_accounts} to="/admin/people" />
        <Counter label="People in master list" value={data.participants_total} to="/admin/people" />
        <Counter label="In at least one dance" value={data.included} />
        <Counter label="Not in any dance yet" value={data.not_included} />
        <Counter label="Performances" value={data.performances_total} to="/admin/performances" />
        <Counter label="Ready (with audio)" value={data.performances_ready} to="/admin/performances" />
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Card className="!p-3">
          <p className="font-semibold text-pink-800">Bride side</p>
          <p className="mt-1 text-sm text-stone-700">
            <strong className="text-lg tabular-nums">{data.by_side.bride.included}</strong> of {data.by_side.bride.total} people dancing
          </p>
          <p className="text-sm text-stone-500">{data.by_side.bride.performances} performances</p>
        </Card>
        <Card className="!p-3">
          <p className="font-semibold text-indigo-800">Groom side</p>
          <p className="mt-1 text-sm text-stone-700">
            <strong className="text-lg tabular-nums">{data.by_side.groom.included}</strong> of {data.by_side.groom.total} people dancing
          </p>
          <p className="text-sm text-stone-500">{data.by_side.groom.performances} performances</p>
        </Card>
      </section>
      {data.by_side.unassigned > 0 ? <p className="text-sm text-stone-500">{data.by_side.unassigned} people have no side set yet.</p> : null}

      <Link to="/admin/live" className="flex min-h-14 items-center justify-between rounded-2xl bg-stone-900 px-4 text-white active:bg-stone-800">
        <span className="font-semibold">Running order / Live</span>
        <span className="text-sm text-stone-300">
          {data.live.completed} done · {data.live.pending} to go{data.live.skipped ? ` · ${data.live.skipped} skipped` : ''}
        </span>
      </Link>
    </div>
  );
}
