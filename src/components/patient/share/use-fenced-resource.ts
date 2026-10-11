"use client";

/**
 * One owner-only list (connectors, share links) loaded under the patient's
 * access fence. A result that returns after the fence moved is dropped and
 * the list reloads for the new epoch; any failure, stale answer or change of
 * fence/fetcher replaces the list, so data from an earlier access context is
 * never kept beside a refusal.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { toApiError, type ApiError } from "@/lib/client/transport";

export type ResourceState<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: ApiError };

export interface FencedResource<T> {
  state: ResourceState<T>;
  reload: () => void;
  /** Immutable update after a confirmed mutation; ignored unless loaded. */
  update: (updater: (value: T) => T) => void;
}

const LOADING = { status: "loading" } as const;

/**
 * A mutation refused because the list no longer matches the server (409) or
 * access ended (401/403/404): reload, so a refusal replaces the list instead
 * of sitting next to it.
 */
export function invalidatesList(error: ApiError): boolean {
  return error.isConflict || error.isAccessDenied;
}

/** `fetcher` must be stable (useCallback); `enabled` false (offline) sends nothing. */
export function useFencedResource<T>(
  fence: AccessFence,
  enabled: boolean,
  fetcher: (signal: AbortSignal) => Promise<T>,
): FencedResource<T> {
  const epoch = useSyncExternalStore(fence.subscribe, fence.epoch, fence.epoch);
  const [state, setState] = useState<ResourceState<T>>(LOADING);
  const [attempt, setAttempt] = useState(0);
  const [owner, setOwner] = useState({ fence, fetcher });

  // Another actor/patient (new fence) or another source (new fetcher): drop the old list during render.
  if (owner.fence !== fence || owner.fetcher !== fetcher) {
    setOwner({ fence, fetcher });
    setState(LOADING);
  }

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    // A retry after a failure shows loading; a loaded list stays while it refreshes.
    setState((current) => (current.status === "error" ? LOADING : current));
    runFenced(fence, () => fetcher(controller.signal)).then(
      (result) => {
        if (controller.signal.aborted) return;
        // Stale: access changed in flight. Show nothing from it; the new epoch reloads.
        setState(result.status === "current" ? { status: "ready", value: result.value } : LOADING);
      },
      (caught: unknown) => {
        const error = toApiError(caught);
        if (!error.isAborted && !controller.signal.aborted) setState({ status: "error", error });
      },
    );
    return () => controller.abort();
  }, [fence, fetcher, enabled, epoch, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const update = useCallback(
    (updater: (value: T) => T) => setState((current) => (current.status === "ready" ? { status: "ready", value: updater(current.value) } : current)),
    [],
  );
  return { state, reload, update };
}
