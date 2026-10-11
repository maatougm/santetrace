"use client";

/**
 * One-shot read for a patient screen section (doctor directory, grants,
 * protocol applications, contact requests), always through the access fence.
 *
 * - A result that returns after a revocation or authority change is "stale":
 *   nothing from it is shown.
 * - Any fence epoch change reloads; a denied fence clears the value at once.
 * - An error clears the value: a failed section never keeps earlier data.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { toApiError, type ApiError } from "@/lib/client/transport";

export interface FencedResource<T> {
  value: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

interface ResourceState<T> {
  key: string | null;
  value: T | null;
  error: ApiError | null;
  loading: boolean;
}

export function useFencedResource<T>(
  fence: AccessFence,
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): FencedResource<T> {
  const [state, setState] = useState<ResourceState<T>>({ key: null, value: null, error: null, loading: false });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => fence.subscribe(() => setNonce((n) => n + 1)), [fence]);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    setState((current) => ({
      key,
      // Keep the same section's value while refreshing; never another key's or a denied one.
      value: current.key === key && !fence.denied() ? current.value : null,
      error: null,
      loading: true,
    }));
    runFenced(fence, () => loadRef.current(controller.signal))
      .then((result) => {
        if (controller.signal.aborted) return;
        setState({ key, value: result.status === "current" ? result.value : null, error: null, loading: false });
      })
      .catch((caught: unknown) => {
        const error = toApiError(caught);
        if (controller.signal.aborted || error.isAborted) return;
        setState({ key, value: null, error, loading: false });
      });
    return () => controller.abort();
  }, [fence, key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = state.key === key;
  return {
    value: current ? state.value : null,
    error: current ? state.error : null,
    loading: key !== null && (!current || state.loading),
    reload,
  };
}
