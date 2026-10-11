"use client";

/**
 * Interval polling for clinician/patient views (contract: refresh every 2 s).
 * Keeps the last good payload on transient failure (offline, 5xx, timeout) so
 * screens can show "stale since …" instead of blanking, and never overlaps
 * requests.
 *
 * Access denial is different: on 401/403/404 (with an error envelope) the
 * payload is cleared immediately, polling stops, any response that was in
 * flight is discarded, and local mutations are refused until the key changes
 * or a new request succeeds. A held earlier response can never restore it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toApiError, type ApiError } from "./transport";
import { notifySessionInvalidated } from "./session";
import { useLiveConnection, type LiveConnectionStatus } from "./use-live";

export const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** Back-off used while an endpoint is missing, offline, or erroring. */
const DEGRADED_POLL_INTERVAL_MS = 10_000;

export interface PollingOptions {
  /** Same-origin WebSocket invalidation, with interval polling as fallback. Default true. */
  live?: boolean;
  intervalMs?: number;
  /** Set false to stop requests (e.g. missing id). */
  enabled?: boolean;
  /** Pause while the tab is hidden. Default true. */
  pauseWhenHidden?: boolean;
  /**
   * Clear data and stop on 401/403/404-with-envelope. Default true: every
   * key in this app is actor-scoped. Set false only for public resources.
   */
  clearOnDenied?: boolean;
  /** Called once per denial (e.g. to revoke an access fence). */
  onDenied?: (error: ApiError) => void;
}

export interface PollingResult<T> {
  liveStatus: LiveConnectionStatus;
  data: T | null;
  error: ApiError | null;
  /** "loading" only before the first response. */
  status: "loading" | "ready" | "error";
  isRefreshing: boolean;
  /** Epoch ms of the last successful response. */
  lastSuccessAt: number | null;
  /** True after an access denial cleared the data (until a new success). */
  denied: boolean;
  refresh: () => Promise<void>;
  /** Replace the cached payload after a successful mutation (immutable update). Ignored while denied. */
  mutate: (updater: (current: T | null) => T | null) => void;
}

export function isDenial(error: ApiError): boolean {
  return error.isAccessDenied;
}

export function usePolling<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: PollingOptions = {},
): PollingResult<T> {
  const { intervalMs = DEFAULT_POLL_INTERVAL_MS, enabled = true, pauseWhenHidden = true, clearOnDenied = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [denied, setDenied] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onDeniedRef = useRef(options.onDenied);
  onDeniedRef.current = options.onDenied;
  /** Controller of the request in flight; null when idle. Only its owner clears it. */
  const controllerRef = useRef<AbortController | null>(null);
  /** Bumped by mutate() and by a denial: responses to requests started earlier are dropped. */
  const generationRef = useRef(0);
  const deniedRef = useRef(false);
  const liveRefreshPending = useRef(false);
  const pollWakeRef = useRef<(() => void) | null>(null);

  const run = useCallback(async (): Promise<ApiError | null> => {
    if (controllerRef.current) return null;
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = generationRef.current;
    setIsRefreshing(true);
    try {
      const next = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted) return null;
      // A mutation or a denial landed while this request was in flight: its
      // payload may predate it. Drop it; the next tick fetches fresh state.
      if (generation !== generationRef.current) return null;
      deniedRef.current = false;
      setDenied(false);
      setData(next);
      setError(null);
      setLastSuccessAt(Date.now());
      return null;
    } catch (caught) {
      const apiError = toApiError(caught);
      if (apiError.isAborted || controller.signal.aborted) return null;
      if (generation !== generationRef.current && !isDenial(apiError)) return null;
      setError(apiError);
      if (clearOnDenied && isDenial(apiError)) {
        generationRef.current += 1;
        if (!deniedRef.current) onDeniedRef.current?.(apiError);
        deniedRef.current = true;
        setDenied(true);
        setData(null);
        setLastSuccessAt(null);
      }
      if (apiError.isUnauthenticated) notifySessionInvalidated();
      return apiError;
    } finally {
      // A superseded request (aborted by cleanup) must not clear its successor.
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsRefreshing(false);
        if (liveRefreshPending.current && !deniedRef.current) {
          liveRefreshPending.current = false;
          // Reconcile an event that arrived while the earlier GET was in flight.
          const queuedGeneration = generationRef.current;
          queueMicrotask(() => { if (queuedGeneration === generationRef.current && !deniedRef.current) void run(); });
        }
      }
    }
  }, [clearOnDenied]);

  const live = useLiveConnection({ enabled: !!key && enabled && !denied && options.live !== false, onInvalidate: () => {
    if (controllerRef.current) { liveRefreshPending.current = true; return; }
    void run();
  } });
  const liveStatusRef = useRef(live.status);
  liveStatusRef.current = live.status;

  useEffect(() => {
    setData(null);
    setError(null);
    setLastSuccessAt(null);
    setDenied(false);
    deniedRef.current = false;
    generationRef.current += 1;
    liveRefreshPending.current = false;
    if (!key || !enabled) return;
    // Per-effect stop flag: a tick from a previous key/mount can never reschedule.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delay: number) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, delay);
    };

    pollWakeRef.current = () => { if (!stopped) { if (timer) clearTimeout(timer); void tick(); } };

    const tick = async () => {
      if (stopped) return;
      if (pauseWhenHidden && document.visibilityState === "hidden") {
        schedule(intervalMs);
        return;
      }
      const failure = await run();
      // Authentication/authorization failures will not fix themselves: stop.
      if (failure && (failure.isUnauthenticated || failure.isForbidden || (clearOnDenied && isDenial(failure)))) {
        stopped = true;
        return;
      }
      schedule(failure ? Math.max(intervalMs, DEGRADED_POLL_INTERVAL_MS) : liveStatusRef.current === "live" ? Math.max(intervalMs, 30_000) : intervalMs);
    };

    void tick();

    const onVisible = () => {
      if (!stopped && document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      generationRef.current += 1;
      liveRefreshPending.current = false;
      pollWakeRef.current = null;
      if (timer) clearTimeout(timer);
      controllerRef.current?.abort();
      controllerRef.current = null;
      setIsRefreshing(false);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, enabled, intervalMs, pauseWhenHidden, run, clearOnDenied]);

  // A lost socket resumes the short fallback cadence immediately.
  useEffect(() => { pollWakeRef.current?.(); }, [live.status]);

  const refresh = useCallback(async () => {
    await run();
  }, [run]);

  const mutate = useCallback((updater: (current: T | null) => T | null) => {
    if (deniedRef.current) return;
    generationRef.current += 1;
    setData((current) => updater(current));
  }, []);

  const status: PollingResult<T>["status"] = data !== null ? "ready" : error ? "error" : "loading";

  return { data, error, status, isRefreshing, lastSuccessAt, denied, refresh, mutate, liveStatus: live.status };
}
