"use client";

/**
 * Message thread with one clinician, polled every 5 s (paused while the tab is
 * hidden) and always through the patient's access fence:
 * - an answer that was in flight across a revocation is dropped;
 * - once the fence is denied the poll stops and the thread is cleared;
 * - a denial of the thread itself (403/404) clears and stops it (usePolling).
 */
import { useCallback, useState, useSyncExternalStore } from "react";
import type { AccessFence } from "@/lib/client/access-fence";
import { listMessages } from "@/lib/client/care-api";
import { staleResponseError } from "@/lib/client/transport";
import { usePolling, type PollingResult } from "@/lib/client/use-polling";
import { fetchAllMessages, type MessageThread } from "./contact-view";

const MESSAGE_POLL_MS = 5_000;
/** 50 messages per page server-side: enough for a demo thread. */
const MAX_PAGES = 20;

export interface ThreadState extends PollingResult<MessageThread> {
  /** Restart a stopped poll (after a denial or a retry request). */
  restart: () => void;
}

export function useMessageThread(fence: AccessFence, patientId: string, clinicianId: string | null): ThreadState {
  const denied = useSyncExternalStore(
    fence.subscribe,
    () => fence.denied(),
    () => false,
  );
  const [attempt, setAttempt] = useState(0);

  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<MessageThread> => {
      const started = fence.epoch();
      if (fence.denied()) throw staleResponseError("Access denied");
      const thread = await fetchAllMessages(
        (after) => listMessages(patientId, { after, clinicianId }, { signal }),
        MAX_PAGES,
      );
      // Never lifts a denial (unlike the record poll): only drops late answers.
      if (!fence.isCurrent(started)) throw staleResponseError("Access changed while the request was in flight");
      return thread;
    },
    [fence, patientId, clinicianId],
  );

  const key = !denied && clinicianId ? `messages:${fence.key}:${clinicianId}:${attempt}` : null;
  const poll = usePolling<MessageThread>(key, fetcher, { intervalMs: MESSAGE_POLL_MS, enabled: key !== null });
  return { ...poll, restart: () => setAttempt((n) => n + 1) };
}
