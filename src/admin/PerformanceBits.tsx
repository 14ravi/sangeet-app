import { Link } from 'react-router';
import { formatDuration, isOverLimit } from '@shared/duration.ts';
import type { Performance } from '../lib/types';
import { Badge, SideBadge } from '../components/ui';
import { IconWarning } from '../components/icons';

export function performerNames(p: Pick<Performance, 'participants'>): string {
  return p.participants.map((x) => `${x.first_name} ${x.last_name}`).join(', ');
}

export function DurationBadge({ seconds, max }: { seconds: number | null; max?: number | null }) {
  if (seconds == null) return <Badge tone="stone">No duration</Badge>;
  if (isOverLimit(seconds, max)) {
    return (
      <Badge tone="amber" className="!text-amber-900">
        <IconWarning size={12} /> {formatDuration(seconds)} &gt; {formatDuration(max)}
      </Badge>
    );
  }
  return <Badge tone="stone">{formatDuration(seconds)}</Badge>;
}

export function PerformanceBadges({ p, max, duplicateCount }: { p: Performance; max?: number | null; duplicateCount?: number }) {
  return (
    <div className="flex flex-wrap gap-1">
      <SideBadge side={p.side} />
      <Badge>{p.performance_type === 'solo' ? 'Solo' : 'Group'}</Badge>
      {p.preparation_status === 'ready' ? <Badge tone="green">Ready</Badge> : <Badge tone="stone">Draft</Badge>}
      {p.has_audio ? <DurationBadge seconds={p.duration_seconds} max={max} /> : <Badge tone="red">No audio</Badge>}
      {duplicateCount && duplicateCount > 1 ? (
        <Badge tone="amber">
          <IconWarning size={12} /> Title used {duplicateCount}×
        </Badge>
      ) : null}
    </div>
  );
}

export function PerformerLinks({ p }: { p: Pick<Performance, 'participants'> }) {
  if (p.participants.length === 0) return <span className="text-stone-500">No participants yet</span>;
  return (
    <span>
      {p.participants.map((x, i) => (
        <span key={x.id}>
          {i > 0 ? ', ' : ''}
          <Link to={`/admin/people/${x.id}`} className="font-medium text-rose-800 underline decoration-rose-300 underline-offset-2" onClick={(e) => e.stopPropagation()}>
            {x.first_name} {x.last_name}
          </Link>
          {x.is_active ? '' : ' (archived)'}
        </span>
      ))}
    </span>
  );
}
