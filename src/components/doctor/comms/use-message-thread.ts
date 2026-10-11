"use client";

/**
 * Poll of the (patient, signed-in clinician) thread every 5 s, paused while
 * the tab is hidden. Answers that were in flight across an access change are
 * dropped; a 401/403/404 clears the thread and stops the poll (usePolling).
 * Displayed patient messages get a read receipt, which is never a review.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { listMessages, markMessageRead, type CareMessage } from "@/lib/client/care-api";
import { createClientId } from "@/lib/client/ids";
import { staleResponseError, toApiError, type ApiError } from "@/lib/client/transport";
import { usePolling, type PollingResult } from "@/lib/client/use-polling";
import { fetchThreadTail, mergeMessages, needsReadReceipt, type ThreadState } from "./message-state";

export const THREAD_POLL_MS = 5_000;

/** Wraps a poll fetcher so an answer started before an access change is discarded. */
export function fenceFetcher<T>(fence: AccessFence, fetcher: (signal: AbortSignal) => Promise<T>) {
  return async (signal: AbortSignal): Promise<T> => {
    const started = fence.epoch();
    if (fence.denied()) throw staleResponseError("Access denied for this record");
    const value = await fetcher(signal);
    if (!fence.isCurrent(started)) throw staleResponseError("Access changed while the request was in flight");
    return value;
  };
}

/** Thread tagged with the actor+patient context it was loaded for. */
type KeyedThread = ThreadState & { contextKey: string };

interface ThreadOptions {
  patientId: string;
  actorId: string;
  fence: AccessFence;
  enabled: boolean;
  onDenied: () => void;
}

export interface MessageThreadResult extends Omit<PollingResult<ThreadState>, "data" | "mutate"> {
  /** Current context's thread only (null while loading, denied or disabled). */
  data: ThreadState | null;
  /** Merge a server-confirmed message into the thread, then refetch. */
  applyMessage: (message: CareMessage) => void;
  /** Last read-receipt failure (receipts are retried on the next poll). */
  receiptError: ApiError | null;
}

function useReadReceipts(
  thread: ThreadState | null,
  contextKey: string | null,
  actorId: string,
  fence: AccessFence,
  applyMessage: (message: CareMessage) => void,
): ApiError | null {
  const inFlight = useRef(new Set<string>());
  const blocked = useRef(new Set<string>());
  const clientIds = useRef(new Map<string, string>());
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    inFlight.current = new Set();
    blocked.current = new Set();
    clientIds.current = new Map();
    setError(null);
  }, [contextKey]);

  useEffect(() => {
    if (!thread || document.visibilityState !== "visible") return;
    const pending = inFlight.current;
    for (const message of thread.messages) {
      if (!needsReadReceipt(message, actorId) || pending.has(message.id) || blocked.current.has(message.id)) continue;
      const clientId = clientIds.current.get(message.id) ?? createClientId("message-read");
      clientIds.current.set(message.id, clientId);
      pending.add(message.id);
      void runFenced(fence, () => markMessageRead(message.id, { clientId }))
        .then((result) => {
          if (result.status === "current") applyMessage(result.value.message);
          setError(null);
        })
        .catch((caught: unknown) => {
          const apiError = toApiError(caught);
          if (apiError.isAborted) return;
          // A refusal will not fix itself on retry; transient failures retry on the next poll.
          if (apiError.kind === "http" && apiError.status >= 400 && apiError.status < 500) blocked.current.add(message.id);
          setError(apiError);
        })
        .finally(() => pending.delete(message.id));
    }
  }, [thread, actorId, fence, applyMessage]);

  return error;
}

export function useMessageThread({ patientId, actorId, fence, enabled, onDenied }: ThreadOptions): MessageThreadResult {
  const pollKey = enabled ? `doctor-messages:${actorId}:${patientId}` : null;
  /** Thread the next poll resumes from; only ever the current context's server answer. */
  const stateRef = useRef<KeyedThread | null>(null);
  // Declared before usePolling so it runs first: a new or re-enabled context
  // never resumes from cursors or messages loaded under a previous one.
  useEffect(() => {
    stateRef.current = null;
  }, [pollKey]);

  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<KeyedThread> => {
      const contextKey = `doctor-messages:${actorId}:${patientId}`;
      const base = stateRef.current?.contextKey === contextKey ? stateRef.current : null;
      const next = await fenceFetcher(fence, (s) =>
        fetchThreadTail((after) => listMessages(patientId, { after, clinicianId: actorId }, { signal: s }), base),
      )(signal);
      return { ...next, contextKey };
    },
    [fence, patientId, actorId],
  );
  const poll = usePolling<KeyedThread>(pollKey, fetcher, { intervalMs: THREAD_POLL_MS, onDenied });
  const { mutate, refresh } = poll;
  // usePolling keeps the previous key's payload for one render: never show or act on it.
  const data = poll.data && poll.data.contextKey === pollKey ? poll.data : null;

  useEffect(() => {
    stateRef.current = data;
  }, [data]);

  // Authority changed (downgrade, new grant revision): ask the server again.
  useEffect(() => fence.subscribe(() => void refresh()), [fence, refresh]);

  const applyMessage = useCallback(
    (message: CareMessage) => {
      mutate((current) => (current ? { ...current, messages: mergeMessages(current.messages, [message]) } : current));
      void refresh();
    },
    [mutate, refresh],
  );

  const receiptError = useReadReceipts(data, pollKey, actorId, fence, applyMessage);
  return { ...poll, data, applyMessage, receiptError };
}
