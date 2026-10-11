"use client";

/**
 * One fenced read with explicit loading / error / ready states. An answer
 * discarded because the authority moved while it was in flight is never shown:
 * the read is asked again under the current authority (it may now be narrower
 * or denied). After a few discarded answers in a row it stops and shows a
 * neutral error with a retry, instead of spinning forever.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccessFence } from "@/lib/client/access-fence";
import { staleResponseError, type ApiError } from "@/lib/client/transport";
import { fencedCall } from "./fenced-call";

export type ReadState<T> = { status: "loading" } | { status: "error"; error: ApiError } | { status: "ready"; value: T };

const MAX_REISSUES = 2;

export interface FencedRead<T> {
  state: ReadState<T>;
  /** Re-read and keep showing the current value meanwhile. */
  reload: () => void;
  /** Re-read from a loading state (after an error). */
  retry: () => void;
  /** Local echo of a confirmed server answer (e.g. an updated grant). */
  update: (updater: (current: T) => T) => void;
}

/**
 * `read` and `revisionOf` must be stable (module functions or useCallback);
 * pass `read = null` to skip reading.
 */
export function useFencedRead<T>(
  fence: AccessFence,
  read: ((signal: AbortSignal) => Promise<T>) | null,
  revisionOf?: (value: T) => number | null | undefined,
): FencedRead<T> {
  const [state, setState] = useState<ReadState<T>>({ status: "loading" });
  const [key, setKey] = useState(0);
  const reissues = useRef(0);

  useEffect(() => {
    if (!read) return;
    const controller = new AbortController();
    void fencedCall(fence, () => read(controller.signal), revisionOf).then((result) => {
      if (controller.signal.aborted) return;
      if (result.status !== "stale") reissues.current = 0;
      if (result.status === "current") setState({ status: "ready", value: result.value });
      else if (result.status === "error") setState({ status: "error", error: result.error });
      else if (fence.denied()) return;
      else if (reissues.current < MAX_REISSUES) {
        reissues.current += 1;
        setKey((value) => value + 1);
      } else {
        reissues.current = 0;
        setState({ status: "error", error: staleResponseError() });
      }
    });
    return () => controller.abort();
  }, [fence, read, revisionOf, key]);

  const reload = useCallback(() => setKey((value) => value + 1), []);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setKey((value) => value + 1);
  }, []);
  const update = useCallback(
    (updater: (current: T) => T) =>
      setState((current) => (current.status === "ready" ? { status: "ready", value: updater(current.value) } : current)),
    [],
  );

  return { state, reload, retry, update };
}
