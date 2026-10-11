"use client";

/**
 * React view of this actor's outbox (src/lib/client/outbox.ts): entries for the
 * current patient, counts by state, manual replay and discard. With
 * `autoReplay` it replays on app start, on the `online` event and every 30 s
 * (paused after 401 / consent withdrawal until sign-in or a manual retry).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  discardEntry,
  listEntries,
  pruneReceivedEntries,
  replayOutbox,
  subscribeOutbox,
  type OutboxEntry,
  type OutboxErrorKind,
  type OutboxScope,
  type OutboxState,
  type ReplayReport,
} from "@/lib/client/outbox";

export type OutboxCounts = Record<OutboxState, number>;

const EMPTY_COUNTS: OutboxCounts = { queued: 0, sending: 0, server_received: 0, failed: 0 };
const AUTO_REPLAY_INTERVAL_MS = 30_000;

export interface UseOutboxOptions {
  /** Replay on mount (app start), on the `online` event and periodically. */
  autoReplay?: boolean;
  onReplayed?: (report: ReplayReport) => void;
}

export interface UseOutboxResult {
  status: "idle" | "loading" | "ready" | "unavailable";
  /** This actor's entries for this patient, newest first. */
  entries: OutboxEntry[];
  counts: OutboxCounts;
  /** queued + sending + failed: everything the server has not received. */
  unsent: number;
  storageError: string | null;
  replaying: boolean;
  lastReport: ReplayReport | null;
  replay: () => Promise<ReplayReport | null>;
  discard: (clientId: string) => Promise<void>;
}

export function useOutbox(scope: OutboxScope | null, options: UseOutboxOptions = {}): UseOutboxResult {
  const { autoReplay = false, onReplayed } = options;
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [status, setStatus] = useState<UseOutboxResult["status"]>("idle");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [lastReport, setLastReport] = useState<ReplayReport | null>(null);
  const onReplayedRef = useRef(onReplayed);
  onReplayedRef.current = onReplayed;
  const actorId = scope?.actorId ?? null;
  const patientId = scope?.patientId ?? null;

  const load = useCallback(async () => {
    if (!actorId || !patientId) return;
    try {
      const listed = await listEntries({ actorId, patientId });
      setEntries(await pruneReceivedEntries(listed));
      setStatus("ready");
      setStorageError(null);
    } catch (error) {
      setStatus("unavailable");
      setStorageError(error instanceof Error ? error.message : "Local storage unavailable.");
    }
  }, [actorId, patientId]);

  const replay = useCallback(async (): Promise<ReplayReport | null> => {
    if (!actorId || !patientId) return null;
    setReplaying(true);
    try {
      const report = await replayOutbox({ actorId, patientId });
      setLastReport(report);
      onReplayedRef.current?.(report);
      return report;
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Local storage unavailable.");
      return null;
    } finally {
      setReplaying(false);
      await load();
    }
  }, [actorId, patientId, load]);

  useEffect(() => {
    setEntries([]);
    setLastReport(null);
    if (!actorId || !patientId) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    void load();
    return subscribeOutbox(() => void load());
  }, [actorId, patientId, load]);

  const lastStopRef = useRef<OutboxErrorKind | null>(null);
  lastStopRef.current = lastReport?.stoppedBy ?? null;
  useEffect(() => {
    if (!autoReplay || !actorId || !patientId) return;
    void replay();
    const onOnline = () => void replay();
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => {
      // Do not hammer the server with an expired session or revoked consent;
      // wait for sign-in, reconnection or a manual retry.
      const stop = lastStopRef.current;
      if (navigator.onLine && stop !== "unauthenticated" && stop !== "consent_revoked") void replay();
    }, AUTO_REPLAY_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [autoReplay, actorId, patientId, replay]);

  const discard = useCallback(
    async (clientId: string) => {
      if (!actorId || !patientId) return;
      await discardEntry({ actorId, patientId }, clientId);
    },
    [actorId, patientId],
  );

  const counts = useMemo<OutboxCounts>(
    () => entries.reduce<OutboxCounts>((acc, entry) => ({ ...acc, [entry.state]: acc[entry.state] + 1 }), EMPTY_COUNTS),
    [entries],
  );

  return {
    status,
    entries,
    counts,
    unsent: counts.queued + counts.sending + counts.failed,
    storageError,
    replaying,
    lastReport,
    replay,
    discard,
  };
}
