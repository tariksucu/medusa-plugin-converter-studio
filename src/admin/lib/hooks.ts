import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

/**
 * The dashboard's query client, to refresh its product data after a conversion, or `null`.
 * An app can end up with two copies of React Query (say, after a Medusa upgrade); this plugin's
 * import then sees no client. The plugin works without it and only loses the automatic refresh.
 */
export function useDashboardQueryClient(): QueryClient | null {
  try {
    return useQueryClient();
  } catch {
    return null;
  }
}

/**
 * Loads `load()` when `key` changes and again after `poll(data)` milliseconds while it says so.
 * Plain React state, so it needs no query client of its own.
 */
export function usePolled<T>(
  key: string,
  load: () => Promise<T>,
  poll: (data: T | undefined) => number | false,
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    load().then(
      (value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      },
      (failure: unknown) => {
        if (alive) setError(failure instanceof Error ? failure : new Error(String(failure)));
      },
    );
    return () => {
      alive = false;
    };
    // `load` is a new function each render; `key` and `tick` say when to load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const wait = poll(data);
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(refresh, wait);
    return () => clearTimeout(timer);
  }, [wait, data, refresh]);

  return { data, error, refresh };
}

/** Runs an action, with a busy flag for its button. */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const run = async (...args: A): Promise<R> => {
    setBusy(true);
    try {
      return await action(...args);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
