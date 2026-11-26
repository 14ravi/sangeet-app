// Running order (Arrange) and Live mode — built for one-handed phone use.
import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDocumentTitle } from '../lib/hooks';
import { formatDuration, isOverLimit } from '@shared/duration.ts';
import type { LiveStatus, Performance } from '../lib/types';
import { AudioPlayer } from '../components/AudioPlayer';
import { Button, ConfirmButton, cx, EmptyState, ErrorBox, Loading, TextInput, useToast } from '../components/ui';
import { IconCheck, IconDown, IconGrip, IconSkip, IconToEnd, IconToTop, IconUndo, IconUp, IconWarning, IconX } from '../components/icons';
import { useRunningOrder, type SyncState } from './useRunningOrder';

type Mode = 'live' | 'arrange';
const MODE_KEY = 'sangeet.runningOrder.mode';

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function names(p: Performance) {
  return p.participants.map((x) => x.first_name).join(', ') || 'No participants';
}

export function RunningOrderPage() {
  useDocumentTitle('Running order');
  const ro = useRunningOrder();
  const toast = useToast();
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return (localStorage.getItem(MODE_KEY) as Mode) || 'live';
    } catch {
      return 'live';
    }
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const setMode = (m: Mode) => {
    setModeState(m);
    setExpanded(null);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  if (!ro.loaded) return ro.loadError ? <ErrorBox error={ro.loadError} onRetry={ro.refresh} /> : <Loading />;

  const next = ro.order.find((p) => p.live_status === 'pending');
  const done = ro.order.filter((p) => p.live_status === 'completed').length;
  const skipped = ro.order.filter((p) => p.live_status === 'skipped').length;

  async function mark(p: Performance, status: LiveStatus, undoTo?: LiveStatus) {
    const ok = await ro.setStatus(p.id, status);
    if (ok && undoTo) {
      const label = status === 'completed' ? 'done' : status === 'skipped' ? 'skipped' : 'pending';
      toast(`#${p.position} ${p.display_name} marked ${label}`, {
        actionLabel: 'Undo',
        onAction: () => void ro.setStatus(p.id, undoTo),
      });
    }
  }

  return (
    <div className={cx(mode === 'live' && next ? 'pb-44' : 'pb-4')}>
      <div className="sticky top-14 z-20 -mx-4 space-y-2 border-b border-stone-200 bg-stone-50/95 px-4 pt-2 pb-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Mode" className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-stone-200 p-1">
            {(['live', 'arrange'] as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cx('min-h-11 rounded-lg font-semibold', mode === m ? 'bg-white text-rose-800 shadow-sm' : 'text-stone-600')}
              >
                {m === 'live' ? 'Live' : 'Arrange'}
              </button>
            ))}
          </div>
          <SyncDot state={ro.sync} saving={ro.saving} lastSync={ro.lastSync} onRetry={ro.refresh} />
        </div>
        <p className="text-sm text-stone-600">
          <strong className="text-emerald-700">{done}</strong> done · <strong>{ro.order.length - done - skipped}</strong> to go
          {skipped ? (
            <>
              {' '}
              · <strong className="text-amber-700">{skipped}</strong> skipped
            </>
          ) : null}
        </p>
        {ro.banner ? (
          <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-700 p-3 text-white">
            <IconWarning className="mt-0.5 shrink-0" />
            <p className="flex-1 text-sm font-medium">{ro.banner}</p>
            <button type="button" onClick={ro.dismissBanner} aria-label="Dismiss" className="-m-2 flex h-11 w-11 items-center justify-center">
              <IconX />
            </button>
          </div>
        ) : null}
      </div>

      {ro.order.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No performances yet">
            <Link to="/admin/performances/new" className="font-semibold text-rose-700 underline">
              Add the first performance
            </Link>
          </EmptyState>
        </div>
      ) : mode === 'arrange' ? (
        <ArrangeList ro={ro} expanded={expanded} setExpanded={setExpanded} />
      ) : (
        <ul className="mt-3 space-y-2">
          {ro.order.map((p, i) => (
            <LiveRow
              key={p.id}
              p={p}
              index={i}
              total={ro.order.length}
              isNext={p.id === next?.id}
              max={ro.max}
              expanded={expanded === p.id}
              onToggle={() => setExpanded((e) => (e === p.id ? null : p.id))}
              onMark={mark}
              onMove={(to) => ro.moveTo(p.id, to)}
            />
          ))}
        </ul>
      )}

      {mode === 'live' ? <UpNextBar next={next} onMark={mark} allDone={!next && ro.order.length > 0} /> : null}
    </div>
  );
}

function SyncDot({ state, saving, lastSync, onRetry }: { state: SyncState; saving: boolean; lastSync: number | null; onRetry: () => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const stale = lastSync != null && Date.now() - lastSync > 20000;
  const label = saving || state === 'saving' ? 'Saving…' : state === 'offline' || stale ? 'Offline' : 'Live';
  const color = saving || state === 'saving' ? 'bg-amber-400' : state === 'offline' || stale ? 'bg-red-500' : 'bg-emerald-500';
  return (
    <button type="button" onClick={onRetry} className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-stone-600" aria-label={`Sync status: ${label}. Tap to refresh.`}>
      <span className={cx('h-2.5 w-2.5 rounded-full', color)} />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------
const STATUS_STYLE: Record<LiveStatus, string> = {
  pending: 'border-stone-200 bg-white',
  completed: 'border-emerald-200 bg-emerald-50/60 opacity-70',
  skipped: 'border-amber-300 bg-amber-50',
};

function LiveRow({
  p,
  index,
  total,
  isNext,
  max,
  expanded,
  onToggle,
  onMark,
  onMove,
}: {
  p: Performance;
  index: number;
  total: number;
  isNext: boolean;
  max: number;
  expanded: boolean;
  onToggle: () => void;
  onMark: (p: Performance, s: LiveStatus, undoTo?: LiveStatus) => void;
  onMove: (toIndex: number) => void;
}) {
  return (
    <li className={cx('rounded-2xl border shadow-sm', STATUS_STYLE[p.live_status], isNext && 'border-rose-500 ring-2 ring-rose-400')}>
      <div className="flex items-center gap-2 p-2">
        <span
          className={cx(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold tabular-nums',
            p.live_status === 'completed' ? 'bg-emerald-600 text-white' : p.live_status === 'skipped' ? 'bg-amber-400 text-stone-900' : isNext ? 'bg-rose-700 text-white' : 'bg-stone-100 text-stone-700',
          )}
          aria-label={`Number ${p.position}, ${p.live_status}`}
        >
          {p.live_status === 'completed' ? <IconCheck size={22} /> : p.position}
        </span>
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="min-h-11 min-w-0 flex-1 text-left">
          {isNext ? <span className="block text-xs font-bold tracking-wide text-rose-700 uppercase">Up next</span> : null}
          {p.live_status === 'skipped' ? <span className="block text-xs font-bold tracking-wide text-amber-800 uppercase">Skipped / not available</span> : null}
          <span className={cx('block font-semibold break-words', p.live_status === 'completed' && 'line-through decoration-2')}>{p.display_name}</span>
          <span className="block truncate text-sm text-stone-600">{names(p)}</span>
        </button>
        {p.live_status === 'pending' ? (
          <button
            type="button"
            onClick={() => onMark(p, 'completed', 'pending')}
            className="flex h-12 min-w-16 shrink-0 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 font-bold text-white active:bg-emerald-700"
            aria-label={`Mark ${p.display_name} done`}
          >
            <IconCheck size={20} /> Done
          </button>
        ) : p.live_status === 'skipped' ? (
          <button
            type="button"
            onClick={() => onMark(p, 'pending')}
            className="flex h-12 shrink-0 items-center justify-center gap-1 rounded-xl border border-amber-500 bg-white px-3 font-semibold text-amber-900"
          >
            <IconUndo size={18} /> Restore
          </button>
        ) : (
          <ConfirmButton size="sm" variant="secondary" confirmLabel="Reopen?" onConfirm={() => onMark(p, 'pending')} className="shrink-0">
            <IconUndo size={18} /> Reopen
          </ConfirmButton>
        )}
      </div>
      {expanded ? (
        <div className="space-y-3 border-t border-stone-200/70 p-3">
          <p className="text-sm text-stone-600">
            ♪ {p.song_title} · {p.side === 'bride' ? 'Bride' : 'Groom'} · {p.performance_type === 'solo' ? 'Solo' : 'Group'}
            {p.duration_seconds ? ` · ${formatDuration(p.duration_seconds)}` : ''}
            {isOverLimit(p.duration_seconds, max) ? ' ⚠' : ''}
          </p>
          {p.has_audio ? <AudioPlayer performanceId={p.id} knownDuration={p.duration_seconds} label={p.display_name} /> : <p className="text-sm text-red-700">No audio uploaded.</p>}
          <div className="grid grid-cols-3 gap-2">
            {p.live_status !== 'completed' ? (
              <Button variant="success" size="sm" onClick={() => onMark(p, 'completed', p.live_status)}>
                <IconCheck size={18} /> Done
              </Button>
            ) : null}
            {p.live_status !== 'skipped' ? (
              <Button variant="warning" size="sm" onClick={() => onMark(p, 'skipped', p.live_status)}>
                <IconSkip size={18} /> Skip
              </Button>
            ) : null}
            {p.live_status !== 'pending' ? (
              <Button variant="secondary" size="sm" onClick={() => onMark(p, 'pending')}>
                <IconUndo size={18} /> Pending
              </Button>
            ) : null}
          </div>
          <MoveControls index={index} total={total} onMove={onMove} />
        </div>
      ) : null}
    </li>
  );
}

function MoveControls({ index, total, onMove }: { index: number; total: number; onMove: (to: number) => void }) {
  const [pos, setPos] = useState('');
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Move</p>
      <div className="grid grid-cols-5 gap-1.5">
        <Button variant="secondary" size="sm" disabled={index === 0} onClick={() => onMove(0)} aria-label="Move to top">
          <IconToTop size={18} />
        </Button>
        <Button variant="secondary" size="sm" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label="Move up one">
          <IconUp size={18} />
        </Button>
        <Button variant="secondary" size="sm" disabled={index === total - 1} onClick={() => onMove(index + 1)} aria-label="Move down one">
          <IconDown size={18} />
        </Button>
        <Button variant="secondary" size="sm" disabled={index >= total - 1} onClick={() => onMove(index + 3)} aria-label="Move down three">
          +3
        </Button>
        <Button variant="secondary" size="sm" disabled={index === total - 1} onClick={() => onMove(total - 1)} aria-label="Move to end">
          <IconToEnd size={18} />
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(pos);
          if (Number.isInteger(n) && n >= 1) {
            onMove(Math.min(n, total) - 1);
            setPos('');
          }
        }}
      >
        <TextInput inputMode="numeric" placeholder={`Move to # (1–${total})`} value={pos} onChange={(e) => setPos(e.target.value.replace(/\D/g, ''))} aria-label="Move to position number" />
        <Button type="submit" variant="secondary" size="sm" disabled={!pos}>
          Go
        </Button>
      </form>
    </div>
  );
}

function UpNextBar({ next, onMark, allDone }: { next?: Performance; onMark: (p: Performance, s: LiveStatus, undoTo?: LiveStatus) => void; allDone: boolean }) {
  if (!next && !allDone) return null;
  return (
    <div className="safe-bottom fixed inset-x-0 bottom-16 z-30 border-t border-rose-200 bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur">
      <div className="mx-auto max-w-3xl px-4 py-3">
        {next ? (
          <>
            <p className="text-xs font-bold tracking-wide text-rose-700 uppercase">Up next · #{next.position}</p>
            <p className="truncate text-lg leading-tight font-bold">{next.display_name}</p>
            <p className="mb-2 truncate text-sm text-stone-600">{names(next)}</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onMark(next, 'completed', 'pending')}
                className="col-span-2 flex min-h-14 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-lg font-bold text-white active:bg-emerald-700"
              >
                <IconCheck size={24} /> Done
              </button>
              <button
                type="button"
                onClick={() => onMark(next, 'skipped', 'pending')}
                className="flex min-h-14 items-center justify-center gap-1 rounded-xl bg-amber-400 font-bold text-stone-900 active:bg-amber-500"
              >
                <IconSkip size={20} /> Skip
              </button>
            </div>
          </>
        ) : (
          <p className="py-3 text-center text-lg font-bold text-emerald-700">All performances done or skipped 🎉</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arrange mode (drag handles + buttons)
// ---------------------------------------------------------------------------
function ArrangeList({ ro, expanded, setExpanded }: { ro: ReturnType<typeof useRunningOrder>; expanded: string | null; setExpanded: (id: string | null) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = ro.order.map((p) => p.id);

  function onDragEnd(e: DragEndEvent) {
    ro.pausePolling(false);
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    ro.setOrder(arrayMove(ids, from, to));
  }

  return (
    <>
      <p className="mt-3 mb-2 text-sm text-stone-500">Drag the ≡ handle, or use the arrows. Tap a row for more moves. Changes save automatically.</p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[verticalOnly]}
        onDragStart={() => ro.pausePolling(true)}
        onDragCancel={() => ro.pausePolling(false)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {ro.order.map((p, i) => (
              <SortableRow
                key={p.id}
                p={p}
                index={i}
                total={ro.order.length}
                max={ro.max}
                expanded={expanded === p.id}
                onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
                onMove={(to) => ro.moveTo(p.id, to)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </>
  );
}

function SortableRow({ p, index, total, max, expanded, onToggle, onMove }: { p: Performance; index: number; total: number; max: number; expanded: boolean; onToggle: () => void; onMove: (to: number) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined, position: 'relative' };
  return (
    <li ref={setNodeRef} style={style} className={cx('rounded-2xl border bg-white shadow-sm', isDragging ? 'border-rose-400 shadow-xl' : 'border-stone-200', p.live_status === 'completed' && 'bg-emerald-50/60')}>
      <div className="flex items-center gap-1 p-1.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${p.display_name}`}
          className="flex h-14 w-12 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl bg-stone-100 text-stone-500 active:cursor-grabbing active:bg-rose-100 active:text-rose-700"
        >
          <IconGrip size={26} />
        </button>
        <span className="w-8 shrink-0 text-center text-lg font-bold text-stone-500 tabular-nums">{p.position}</span>
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="min-h-12 min-w-0 flex-1 text-left">
          <span className={cx('block font-semibold break-words', p.live_status === 'completed' && 'line-through')}>{p.display_name}</span>
          <span className="block truncate text-sm text-stone-500">
            {names(p)}
            {p.duration_seconds ? ` · ${formatDuration(p.duration_seconds)}` : ''}
            {isOverLimit(p.duration_seconds, max) ? ' ⚠' : ''}
            {!p.has_audio ? ' · no audio' : ''}
          </span>
        </button>
        <div className="flex shrink-0">
          <button type="button" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${p.display_name} up`} className="flex h-12 w-11 items-center justify-center rounded-xl text-stone-700 active:bg-stone-200 disabled:opacity-25">
            <IconUp size={24} />
          </button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${p.display_name} down`} className="flex h-12 w-11 items-center justify-center rounded-xl text-stone-700 active:bg-stone-200 disabled:opacity-25">
            <IconDown size={24} />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="border-t border-stone-100 p-3">
          <MoveControls index={index} total={total} onMove={onMove} />
          <Link to={`/admin/performances/${p.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-rose-700 underline">
            Open performance details
          </Link>
        </div>
      ) : null}
    </li>
  );
}
