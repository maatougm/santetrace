"use client";

/**
 * usePolling + safe local mutations. A poll that started before a successful
 * PATCH/POST could resolve after it and briefly restore the old state (an
 * acknowledged alert showing "new" again, a confirmed candidate reopening).
 * Each mutation bumps an epoch; a response fetched under an older epoch is
 * discarded by throwing an "aborted" ApiError, which usePolling ignores
 * without touching data or error. The next tick fetches fresh state.
 */
import { useCallback, useRef } from "react";
import { ApiError, CLIENT_ERROR_CODES } from "@/lib/client/api";
import { usePolling, type PollingOptions, type PollingResult } from "@/lib/client/use-polling";

export interface GuardedPollingResult<T> extends PollingResult<T> {
  /** Apply a server-confirmed change to the cached data and refetch. */
  apply: (updater: (current: T | null) => T | null) => void;
}

function supersededError(): ApiError {
  return new ApiError({
    status: 0,
    code: CLIENT_ERROR_CODES.aborted,
    kind: "aborted",
    message: "Poll response superseded by a local mutation",
  });
}

export function useGuardedPolling<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options?: PollingOptions,
): GuardedPollingResult<T> {
  const epochRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const guarded = useCallback(async (signal: AbortSignal): Promise<T> => {
    const epoch = epochRef.current;
    const result = await fetcherRef.current(signal);
    if (epoch !== epochRef.current) throw supersededError();
    return result;
  }, []);

  const polling = usePolling(key, guarded, options);
  const { mutate, refresh } = polling;

  const apply = useCallback(
    (updater: (current: T | null) => T | null) => {
      epochRef.current += 1;
      mutate(updater);
      void refresh();
    },
    [mutate, refresh],
  );

  return { ...polling, apply };
}
