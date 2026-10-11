"use client";

/**
 * PatientShell `onBeforeLogout`: warns when this device still holds actions
 * the server has not received, then purges this actor's outbox and device
 * copy before the shell signs out. Nothing is purged without confirmation
 * when unsent items exist. A failed purge never lets the logout proceed: the
 * dialog offers only "stay signed in" (cancels, device writes resume) or
 * "retry the purge". `useLogout` then runs the mandatory central purge anyway.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, Dialog } from "@/components/ui";
import type { Messages } from "@/lib/client/i18n";
import { listEntries, purgeActorData, reviveActor, type OutboxScope } from "@/lib/client/outbox";
import styles from "./patient.module.css";

interface Prompt {
  actorId: string;
  unsent: number;
  purgeFailed: boolean;
  busy: boolean;
  resolve: (proceed: boolean) => void;
}

async function countUnsent(scope: OutboxScope): Promise<number> {
  try {
    const entries = await listEntries(scope);
    return entries.filter((entry) => entry.state !== "server_received").length;
  } catch {
    // Storage unreadable: nothing can be counted (and nothing could have been queued).
    return 0;
  }
}

export function useLogoutGuard(
  scope: OutboxScope | null,
  t: Messages,
  /** Called right after a successful purge: stop polling so no device copy is re-written. */
  onPurged: () => void,
): { onBeforeLogout: () => Promise<boolean>; dialog: ReactNode } {
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const onPurgedRef = useRef(onPurged);
  onPurgedRef.current = onPurged;
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const promptRef = useRef<Prompt | null>(null);
  promptRef.current = prompt;

  const ask = useCallback((init: Omit<Prompt, "resolve" | "busy">) => {
    promptRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => setPrompt({ ...init, busy: false, resolve }));
  }, []);

  const onBeforeLogout = useCallback(async (): Promise<boolean> => {
    const current = scopeRef.current;
    if (!current) return true;
    const unsent = await countUnsent(current);
    if (unsent > 0) return ask({ actorId: current.actorId, unsent, purgeFailed: false });
    try {
      await purgeActorData(current.actorId);
      onPurgedRef.current();
      return true;
    } catch {
      return ask({ actorId: current.actorId, unsent: 0, purgeFailed: true });
    }
  }, [ask]);

  const close = useCallback((proceed: boolean) => {
    const current = promptRef.current;
    if (proceed) {
      // Leaving: stop polling first so nothing is written back to this device.
      onPurgedRef.current();
    } else if (current) {
      // Staying signed in (e.g. after a failed purge): device writes resume.
      reviveActor(current.actorId);
    }
    current?.resolve(proceed);
    setPrompt(null);
  }, []);

  const purgeAndLeave = useCallback(async () => {
    const current = promptRef.current;
    if (!current) return;
    setPrompt({ ...current, busy: true });
    try {
      await purgeActorData(current.actorId);
      close(true);
    } catch {
      setPrompt({ ...current, busy: false, purgeFailed: true });
    }
  }, [close]);

  const dialog = prompt ? (
    <Dialog
      open
      size="sm"
      // Esc/backdrop must not cancel the logout while the purge is running.
      onClose={() => {
        if (!prompt.busy) close(false);
      }}
      closeOnBackdrop={!prompt.busy}
      closeLabel={t.common.close}
      title={prompt.purgeFailed ? t.logout.purgeFailed : t.logout.unsentTitle}
      description={
        prompt.purgeFailed
          ? t.logout.purgeFailedBody
          : prompt.unsent > 0
            ? t.logout.unsentBody(prompt.unsent)
            : undefined
      }
      footer={
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => close(false)} disabled={prompt.busy}>
            {t.logout.stay}
          </Button>
          {prompt.purgeFailed ? (
            // Retry only: leaving without a successful purge would keep private data here.
            <Button variant="danger" iconStart="refresh" loading={prompt.busy} onClick={() => void purgeAndLeave()}>
              {t.logout.retryPurge}
            </Button>
          ) : (
            <Button variant="danger" iconStart="log-out" loading={prompt.busy} onClick={() => void purgeAndLeave()}>
              {t.logout.purge}
            </Button>
          )}
        </div>
      }
    />
  ) : null;

  return { onBeforeLogout, dialog };
}
