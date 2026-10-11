"use client";

/**
 * Fence-aware state for the care sections. Everything shown is tagged with the
 * fence epoch it was obtained under and hidden as soon as the epoch moves
 * (revocation or authority change): nothing from an earlier context stays on
 * screen. Loads go through runFenced; stale answers are dropped.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { toApiError } from "@/lib/client/transport";

export function useFenceEpoch(fence: AccessFence): number {
  return useSyncExternalStore(fence.subscribe, fence.epoch, fence.epoch);
}

export type ResourceState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T; refreshing: boolean }
  | { status: "error"; error: unknown };

/**
 * One fenced GET for a section. `loader` must be stable (useCallback);
 * `reloadKey` changes (e.g. a record signature) trigger a background reload.
 * A failure replaces earlier data: a denied section never keeps old content.
 */
export function useFencedResource<T>(
  fence: AccessFence,
  loader: (signal: AbortSignal) => Promise<T>,
  reloadKey = "",
): { state: ResourceState<T>; reload: () => void } {
  const epoch = useFenceEpoch(fence);
  const [tick, setTick] = useState(0);
  const [held, setHeld] = useState<{ epoch: number; state: ResourceState<T> }>({ epoch, state: { status: "loading" } });

  useEffect(() => {
    const controller = new AbortController();
    setHeld((current) =>
      current.epoch === epoch && current.state.status === "ready"
        ? { epoch, state: { ...current.state, refreshing: true } }
        : { epoch, state: { status: "loading" } },
    );
    runFenced(fence, () => loader(controller.signal)).then(
      (result) => {
        if (controller.signal.aborted || result.status === "stale") return;
        setHeld({ epoch, state: { status: "ready", value: result.value, refreshing: false } });
      },
      (error: unknown) => {
        if (controller.signal.aborted || toApiError(error).isAborted) return;
        setHeld({ epoch, state: { status: "error", error } });
      },
    );
    return () => controller.abort();
  }, [fence, loader, epoch, tick, reloadKey]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { state: held.epoch === epoch ? held.state : { status: "loading" }, reload };
}

/** A one-shot result (report, notice, AI meta) visible only under the epoch that produced it. */
export function useEpochScoped<T>(fence: AccessFence): [T | null, (value: T | null) => void] {
  const epoch = useFenceEpoch(fence);
  const [held, setHeld] = useState<{ epoch: number; value: T } | null>(null);
  const set = useCallback((value: T | null) => setHeld(value === null ? null : { epoch: fence.epoch(), value }), [fence]);
  return [held && held.epoch === epoch ? held.value : null, set];
}
