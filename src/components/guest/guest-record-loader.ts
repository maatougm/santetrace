/**
 * Guest record reads, without any timer. The server counts each read as
 * activity (it moves the idle deadline), so reading on a schedule would keep
 * an unattended tab alive. Reads happen once on mount and then only on an
 * explicit user action (reload, opening a PDF, adding a note). Reads never
 * overlap; after stop() a held answer is aborted and never dispatched.
 */
import type { GuestRecord } from "@/contracts/external-visit";
import { toApiError } from "@/lib/client/transport";
import type { GuestSessionAction } from "./guest-state";

export interface GuestRecordLoader {
  /** Reads now, unless a read is already in flight or the loader is stopped. */
  load: () => void;
  /** Session over or view unmounted: abort the read in flight and ignore its answer. */
  stop: () => void;
}

export function createGuestRecordLoader(
  fetchRecord: (signal: AbortSignal) => Promise<GuestRecord>,
  dispatch: (action: GuestSessionAction) => void,
): GuestRecordLoader {
  let stopped = false;
  let inFlight: AbortController | null = null;

  const load = () => {
    if (stopped || inFlight) return;
    const controller = new AbortController();
    inFlight = controller;
    fetchRecord(controller.signal)
      .then(
        (record) => {
          if (!stopped) dispatch({ type: "loaded", record });
        },
        (caught: unknown) => {
          const error = toApiError(caught);
          if (!stopped && !error.isAborted) dispatch({ type: "load_failed", error });
        },
      )
      .finally(() => {
        if (inFlight === controller) inFlight = null;
      });
  };

  const stop = () => {
    stopped = true;
    inFlight?.abort();
    inFlight = null;
  };

  return { load, stop };
}
