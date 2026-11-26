// State + sync for the running order / live mode.
// - Polls cheaply (server answers "unchanged" unless data_version moved).
// - Order changes are optimistic, debounced, and sent with the revision they
//   were based on; a conflict rolls back to the server's latest order.
// - Status changes are optimistic per row with a version check; the server
//   treats "same status already set" as success (two devices tapping Done).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import type { LiveStatus, Performance, RunningOrder } from '../lib/types';

interface ServerState {
  items: Performance[];
  revision: number;
  dataVersion: number;
  max: number;
}

export type SyncState = 'loading' | 'ok' | 'saving' | 'offline';

const POLL_MS = 4000;
const IDLE_POLL_MS = 30000;
const IDLE_AFTER_MS = 20 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 450;

export function useRunningOrder() {
  const [server, setServer] = useState<ServerState | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, LiveStatus>>({});
  const [sync, setSync] = useState<SyncState>('loading');
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const serverRef = useRef(server);
  const localRef = useRef<string[] | null>(null);
  const baseRevision = useRef<number | null>(null);
  const inFlight = useRef(false);
  const pending = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastInteraction = useRef(Date.now());
  const pausePolling = useRef(false);

  const applyServer = useCallback((r: RunningOrder) => {
    setLastSync(Date.now());
    if (r.unchanged || !r.items) return;
    const next = { items: r.items, revision: r.order_revision, dataVersion: r.data_version, max: r.max_duration_seconds ?? 180 };
    serverRef.current = next;
    setServer(next);
  }, []);

  const mergeItem = useCallback((p: Performance) => {
    const cur = serverRef.current;
    if (!cur) return;
    const next = { ...cur, items: cur.items.map((x) => (x.id === p.id ? p : x)) };
    serverRef.current = next;
    setServer(next);
  }, []);

  const poll = useCallback(
    async (force = false) => {
      if (!force && (inFlight.current || pending.current > 0 || pausePolling.current)) return;
      try {
        const known = force ? undefined : serverRef.current?.dataVersion;
        const r = await api<RunningOrder>('admin/running-order', known != null ? { known_version: known } : {});
        applyServer(r);
        setLoadError(null);
        setSync((s) => (s === 'saving' ? s : 'ok'));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'network') setSync('offline');
        if (!serverRef.current) setLoadError(e as Error);
      }
    },
    [applyServer],
  );

  // Polling loop: only while the tab is visible; slows down when idle.
  useEffect(() => {
    void poll(true);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const idle = Date.now() - lastInteraction.current > IDLE_AFTER_MS;
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await poll();
        tick();
      }, idle ? IDLE_POLL_MS : POLL_MS);
    };
    tick();
    const wake = () => {
      lastInteraction.current = Date.now();
      if (document.visibilityState === 'visible') void poll();
    };
    const touch = () => {
      lastInteraction.current = Date.now();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('pointerdown', touch, { passive: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pointerdown', touch);
    };
  }, [poll]);

  // ---------------------------------------------------------------- ordering
  const flushOrder = useCallback(async () => {
    if (inFlight.current) return; // will re-run after the current save
    const ids = localRef.current;
    if (!ids || baseRevision.current == null) return;
    inFlight.current = true;
    setSync('saving');
    try {
      const r = await api<RunningOrder>('admin/running-order/reorder', { ids, expected_revision: baseRevision.current });
      applyServer(r);
      if (localRef.current !== ids) {
        baseRevision.current = r.order_revision; // newer local edits build on what we just saved
        inFlight.current = false;
        void flushOrder();
        return;
      }
      localRef.current = null;
      baseRevision.current = null;
      setLocalOrder(null);
      setSync('ok');
    } catch (e) {
      localRef.current = null;
      baseRevision.current = null;
      setLocalOrder(null);
      if (e instanceof ApiError && e.code === 'conflict' && e.data.latest) {
        applyServer(e.data.latest as RunningOrder);
        setBanner(e.message);
        setSync('ok');
      } else {
        setBanner(`New order NOT saved: ${errorMessage(e)} The list has been put back.`);
        setSync(e instanceof ApiError && e.code === 'network' ? 'offline' : 'ok');
        void poll(true);
      }
    } finally {
      inFlight.current = false;
    }
  }, [applyServer, poll]);

  const order = useMemo<Performance[]>(() => {
    if (!server) return [];
    // Sequence numbers always follow the list as shown (instant renumbering).
    const withStatus = (p: Performance, i: number) => ({ ...p, position: i + 1, live_status: overrides[p.id] ?? p.live_status });
    if (!localOrder) return server.items.map(withStatus);
    const byId = new Map(server.items.map((p) => [p.id, p]));
    return localOrder
      .map((id) => byId.get(id))
      .filter((p): p is Performance => !!p)
      .map(withStatus);
  }, [server, localOrder, overrides]);

  const setOrder = useCallback(
    (ids: string[]) => {
      if (!serverRef.current) return;
      lastInteraction.current = Date.now();
      if (baseRevision.current == null) baseRevision.current = serverRef.current.revision;
      localRef.current = ids;
      setLocalOrder(ids);
      setBanner(null);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushOrder(), SAVE_DEBOUNCE_MS);
    },
    [flushOrder],
  );

  /** Move one performance to a 0-based index in the current list. */
  const moveTo = useCallback(
    (id: string, toIndex: number) => {
      const ids = order.map((p) => p.id);
      const from = ids.indexOf(id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(ids.length - 1, toIndex));
      if (from === to) return;
      ids.splice(from, 1);
      ids.splice(to, 0, id);
      setOrder(ids);
    },
    [order, setOrder],
  );

  // ---------------------------------------------------------------- status
  const setStatus = useCallback(
    async (id: string, status: LiveStatus): Promise<boolean> => {
      const cur = serverRef.current?.items.find((p) => p.id === id);
      if (!cur) return false;
      lastInteraction.current = Date.now();
      pending.current += 1;
      setOverrides((o) => ({ ...o, [id]: status }));
      setBanner(null);
      try {
        const r = await api<{ performance: Performance }>('admin/running-order/set-status', { id, status, expected_version: cur.version });
        mergeItem(r.performance);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'conflict' && e.data.performance) {
          mergeItem(e.data.performance as Performance);
          setBanner(e.message);
        } else {
          setBanner(`Not saved: ${errorMessage(e)}`);
          if (e instanceof ApiError && e.code === 'network') setSync('offline');
        }
        return false;
      } finally {
        pending.current -= 1;
        setOverrides((o) => {
          const n = { ...o };
          delete n[id];
          return n;
        });
      }
    },
    [mergeItem],
  );

  return {
    loaded: !!server,
    loadError,
    order,
    max: server?.max ?? 180,
    sync,
    lastSync,
    banner,
    dismissBanner: () => setBanner(null),
    setOrder,
    moveTo,
    setStatus,
    refresh: () => poll(true),
    pausePolling: (v: boolean) => {
      pausePolling.current = v;
    },
    saving: localOrder !== null,
  };
}
