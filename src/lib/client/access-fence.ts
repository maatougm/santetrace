"use client";

/**
 * Access fence shared by a record poll and every one-shot/AI/PDF operation of
 * the same actor+patient.
 *
 * - `epoch` moves on revocation (401/403/404 from the record) and on every
 *   increase of `AccessEnvelope.authorityRevision`. Work started under an older
 *   epoch is discarded when it returns, so a held report, search or proposal
 *   can never restore a view the current authority no longer allows.
 * - `admitRevision` rejects responses older than the highest authority
 *   revision already seen, so a slow, broader response cannot overwrite a newer
 *   downgrade.
 *
 * No timing promise: the client clears on its next server check, and
 * discards held responses. The server remains the authority.
 */
import { useEffect, useMemo } from "react";
import { staleResponseError } from "./transport";

export interface AccessFence {
  /** Actor+patient key this fence belongs to (null: nothing to fence). */
  readonly key: string | null;
  /** Current epoch; capture it before starting work. */
  epoch(): number;
  /** True while no revocation, retirement or authority change happened since `epoch`. */
  isCurrent(epoch: number): boolean;
  /** Access ended: every held result becomes stale and the fence stays denied. */
  revoke(): void;
  /** Access was granted again by a fresh server answer. */
  restore(): void;
  /** True after revocation OR retirement: no new work may start, no held result may apply. */
  denied(): boolean;
  /**
   * The actor/patient this fence belongs to is no longer on screen (key
   * change or unmount). Unlike a denial, a later server answer never lifts it.
   */
  retire(): void;
  /** Undo a retirement caused by a development double-mount (same key, same fence). */
  activate(): void;
  /**
   * Records an authority revision from a server answer. Returns false for an
   * answer older than the highest seen (drop it). A higher revision moves the
   * epoch so earlier one-shot work is discarded.
   */
  admitRevision(revision: number | null | undefined): boolean;
  highestRevision(): number | null;
  /** Subscribe to epoch changes (revocation, authority change). */
  subscribe(listener: () => void): () => void;
}

export function createAccessFence(key: string | null): AccessFence {
  let epoch = 0;
  let denied = false;
  let retired = false;
  let highest: number | null = null;
  const listeners = new Set<() => void>();
  const bump = () => {
    epoch += 1;
    listeners.forEach((listener) => listener());
  };

  return {
    key,
    epoch: () => epoch,
    isCurrent: (captured) => captured === epoch && !denied && !retired,
    revoke: () => {
      denied = true;
      bump();
    },
    restore: () => {
      if (!denied) return;
      denied = false;
      bump();
    },
    denied: () => denied || retired,
    retire: () => {
      if (retired) return;
      retired = true;
      bump();
    },
    activate: () => {
      retired = false;
    },
    admitRevision: (revision) => {
      if (typeof revision !== "number" || !Number.isFinite(revision)) return true;
      if (highest !== null && revision < highest) return false;
      if (highest !== null && revision > highest) {
        highest = revision;
        bump();
        return true;
      }
      highest = revision;
      return true;
    },
    highestRevision: () => highest,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * One fence per actor+patient key. When the key changes or the owner unmounts,
 * the departing fence is retired, so every result still held for the previous
 * actor/patient (fact save, upload, report, search…) is discarded on arrival.
 */
export function useAccessFence(key: string | null): AccessFence {
  const fence = useMemo(() => createAccessFence(key), [key]);
  useEffect(() => {
    fence.activate();
    return () => fence.retire();
  }, [fence]);
  return fence;
}

/**
 * Guard for every asynchronous mutation whose result is written into a fenced
 * view. Call `begin()` BEFORE sending the request; it returns a `commit`
 * function bound to the fence AND the epoch at that moment. When the result
 * arrives, `commit(apply)` runs `apply` only if the same actor/patient is still
 * on screen, access was not denied/retired, and no authority change (e.g. the
 * owner narrowed the scopes: higher authorityRevision, new epoch) happened in
 * between. It returns false when the held result was discarded.
 */
export interface MutationGuard {
  begin(): (apply: () => void) => boolean;
}

export function createMutationGuard(fence: AccessFence, currentFence: () => AccessFence): MutationGuard {
  return {
    begin() {
      const started = fence.epoch();
      return (apply) => {
        if (currentFence() !== fence || !fence.isCurrent(started)) return false;
        apply();
        return true;
      };
    },
  };
}

/** For views without a per-patient fence (none in the record views). Applies unconditionally. */
export const UNGUARDED_MUTATIONS: MutationGuard = Object.freeze({
  begin: () => (apply: () => void) => {
    apply();
    return true;
  },
});

/**
 * Binds a cache-mutation callback (mutate/apply) to the fence that was current
 * when it was created. Called later through a stale closure — after an actor or
 * patient switch, a retirement or a denial — it does nothing, so a held
 * operation can never write the previous patient's data into the new view.
 */
export function bindToFence<A extends unknown[]>(
  fence: AccessFence,
  currentFence: () => AccessFence,
  callback: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    if (currentFence() !== fence || fence.denied()) return;
    callback(...args);
  };
}

export function fenceKey(actorId: string | null | undefined, patientId: string | null | undefined): string | null {
  return actorId && patientId ? `${actorId}::${patientId}` : null;
}

export type FencedResult<T> = { status: "current"; value: T } | { status: "stale" };

/**
 * Runs one-shot work under the fence. The result is "stale" when access was
 * revoked or the authority changed while it was in flight, or when the result
 * carries an authority revision older than the highest seen.
 */
export async function runFenced<T>(
  fence: AccessFence,
  work: () => Promise<T>,
  revisionOf?: (value: T) => number | null | undefined,
): Promise<FencedResult<T>> {
  const started = fence.epoch();
  if (fence.denied()) return { status: "stale" };
  const value = await work();
  if (!fence.isCurrent(started)) return { status: "stale" };
  if (revisionOf && !fence.admitRevision(revisionOf(value))) return { status: "stale" };
  if (!fence.isCurrent(started)) return { status: "stale" };
  return { status: "current", value };
}

/**
 * Wraps a poll fetcher: an answer that was in flight across a revocation, or
 * that is older than the highest authority revision, is dropped as aborted
 * (usePolling ignores it without touching data). Only an answer to a request
 * started after the denial can lift it.
 */
export function fencedFetcher<T>(
  fence: AccessFence,
  fetcher: (signal: AbortSignal) => Promise<T>,
  revisionOf: (value: T) => number | null | undefined,
): (signal: AbortSignal) => Promise<T> {
  return async (signal) => {
    const started = fence.epoch();
    const value = await fetcher(signal);
    if (started !== fence.epoch()) throw staleResponseError("Access changed while the request was in flight");
    if (!fence.admitRevision(revisionOf(value))) throw staleResponseError("Older authority revision");
    fence.restore();
    return value;
  };
}
