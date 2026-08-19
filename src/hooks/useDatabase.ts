/**
 * Database access for screens.
 *
 * `useDatabase` resolves once the connection is open, migrated and seeded; `useQuery` runs
 * a read and re-runs it when the screen regains focus, which is how edits made on a detail
 * screen show up on the list behind it without a manual refresh mechanism.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type * as SQLite from 'expo-sqlite';

import { getDatabaseIfOpen, openDatabase } from '../db';

export interface DatabaseState {
  db: SQLite.SQLiteDatabase | null;
  error: Error | null;
  ready: boolean;
}

export function useDatabase(): DatabaseState {
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(getDatabaseIfOpen());
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (db) return;
    let cancelled = false;
    openDatabase()
      .then((connection) => {
        if (!cancelled) setDb(connection);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error(String(cause)));
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  return { db, error, ready: db !== null };
}

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Re-run the query. */
  refresh: () => void;
}

/**
 * Run a read against the database.
 *
 * Re-runs on focus so returning from an edit screen shows fresh data. A stale-result guard
 * discards the response of a superseded run, which matters for the search boxes where
 * keystrokes fire overlapping queries and an out-of-order reply would show the wrong list.
 */
export function useQuery<T>(
  run: (db: SQLite.SQLiteDatabase) => Promise<T>,
  dependencies: readonly unknown[] = [],
): QueryState<T> {
  const { db, error: dbError } = useDatabase();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const runIdRef = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller declares its deps
  const callback = useCallback(run, dependencies);

  const execute = useCallback(() => {
    if (!db) return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setLoading(true);
    callback(db)
      .then((result) => {
        if (runIdRef.current !== runId) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (runIdRef.current !== runId) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (runIdRef.current === runId) setLoading(false);
      });
  }, [callback, db]);

  useEffect(execute, [execute, nonce]);

  useFocusEffect(
    useCallback(() => {
      setNonce((value) => value + 1);
    }, []),
  );

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return useMemo(
    () => ({ data, loading: loading && data === null, error: error ?? dbError, refresh }),
    [data, loading, error, dbError, refresh],
  );
}

/**
 * Run a write, tracking its in-flight and error state.
 *
 * Returns a stable `run` so it can be passed straight to a button without re-rendering it.
 */
export function useMutation<TArgs extends unknown[], TResult>(
  action: (db: SQLite.SQLiteDatabase, ...args: TArgs) => Promise<TResult>,
): {
  run: (...args: TArgs) => Promise<TResult | null>;
  busy: boolean;
  error: Error | null;
  clearError: () => void;
} {
  const { db } = useDatabase();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      if (!db) return null;
      setBusy(true);
      setError(null);
      try {
        return await actionRef.current(db, ...args);
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [db],
  );

  return { run, busy, error, clearError: useCallback(() => setError(null), []) };
}
