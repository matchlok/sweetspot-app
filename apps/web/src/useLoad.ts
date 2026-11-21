import { useCallback, useEffect, useRef, useState } from "react";

export interface Loaded<T> {
  data: T | null;
  /** A sentence for the person, never a raw exception. */
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs `fn` on mount and whenever `deps` change. The previous data stays while
 * a reload runs, so a screen doesn't blink. A response that arrives after a
 * newer request started is dropped.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: readonly unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    fnRef.current().then(
      (v) => {
        if (id !== latest.current) return;
        setData(v);
        setLoading(false);
      },
      (e: unknown) => {
        if (id !== latest.current) return;
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
