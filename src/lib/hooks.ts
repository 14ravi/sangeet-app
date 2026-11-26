import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | Error | undefined;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/** Loads `route` on mount (and when body changes). Ignores stale responses. */
export function useApi<T>(route: string | null, body: Record<string, unknown> = {}): ApiState<T> {
  const [data, setDataState] = useState<T>();
  const [error, setError] = useState<ApiError | Error>();
  const [loading, setLoading] = useState(route !== null);
  const seq = useRef(0);
  const bodyKey = JSON.stringify(body);

  const reload = useCallback(async () => {
    if (!route) return;
    const id = ++seq.current;
    setLoading(true);
    setError(undefined);
    try {
      const r = await api<T>(route, JSON.parse(bodyKey));
      if (id === seq.current) setDataState(r);
    } catch (e) {
      if (id === seq.current) setError(e as Error);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [route, bodyKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (p: T | undefined) => T)(prev) : updater));
  }, []);

  return { data, error, loading, reload, setData };
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Sangeet` : 'Sangeet';
  }, [title]);
}
