"use client";

/**
 * GET /api/patients/:id every 2 s (usePolling), fenced by actor+patient and
 * the highest authority revision, plus an allowlisted device copy so an
 * installed app opened offline can still show reminders, cached rules and
 * previously approved actions — always labelled as a dated device copy, never
 * as live data. The copy is not used after 401/403/404 (session or consent),
 * and the expanded 006 record (facts, proposals, plan policy, evaluations,
 * access) is never written to the device.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPatient, type ApiError, type PatientRecord } from "@/lib/client/api";
import { bindToFence, fenceKey, fencedFetcher, useAccessFence, type AccessFence } from "@/lib/client/access-fence";
import { fromOfflineRecord, toOfflineRecord } from "@/lib/client/offline-record";
import { loadSnapshot, saveSnapshot, type OutboxScope, type PatientSnapshot } from "@/lib/client/outbox";
import { usePolling } from "@/lib/client/use-polling";

export interface PatientData {
  record: PatientRecord | null;
  /** "server": fetched during this visit. "device": dated allowlisted copy stored on this device. */
  origin: "server" | "device" | null;
  /** When the device copy was saved (origin "device"). */
  deviceSavedAt: string | null;
  /** When the rules in `record` were last confirmed by the server. */
  rulesConfirmedAt: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error: ApiError | null;
  lastSuccessAt: number | null;
  isRefreshing: boolean;
  /** Access ended (401/403/404): live data was cleared. */
  denied: boolean;
  /** Fence for one-shot work on this patient (AI, reports, uploads, actions). */
  fence: AccessFence;
  refresh: () => Promise<void>;
  mutate: (updater: (current: PatientRecord) => PatientRecord) => void;
}

function deviceCopyAllowed(error: ApiError | null): boolean {
  if (!error) return true;
  return !(error.isUnauthenticated || error.isForbidden || error.status === 404);
}

export function usePatientRecord(scope: OutboxScope | null): PatientData {
  const patientId = scope?.patientId ?? null;
  const actorId = scope?.actorId ?? null;
  const fence = useAccessFence(fenceKey(actorId, patientId));
  /** The fence of the actor/patient on screen now; stale callbacks compare against it. */
  const fenceRef = useRef(fence);
  fenceRef.current = fence;
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      fencedFetcher(fence, (s) => getPatient(patientId ?? "", { signal: s }), (record) => record.access?.authorityRevision)(signal),
    [fence, patientId],
  );
  const poll = usePolling<PatientRecord>(patientId ? `patient:${actorId}:${patientId}` : null, fetcher, {
    enabled: Boolean(patientId),
    onDenied: () => fence.revoke(),
  });
  const [snapshot, setSnapshot] = useState<PatientSnapshot | null>(null);
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    setSnapshot(null);
    lastSavedRef.current = "";
    if (!actorId || !patientId) return;
    let cancelled = false;
    loadSnapshot({ actorId, patientId })
      .then((loaded) => {
        if (!cancelled) setSnapshot(loaded);
      })
      .catch(() => {
        // No device copy available (storage blocked): screens show the honest empty state.
        if (!cancelled) setSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [actorId, patientId]);

  const { data, lastSuccessAt } = poll;
  useEffect(() => {
    if (!data || !actorId || !patientId || lastSuccessAt === null) return;
    const allowed = toOfflineRecord(data);
    if (!allowed) return;
    const serialised = JSON.stringify(allowed);
    if (serialised === lastSavedRef.current) return;
    lastSavedRef.current = serialised;
    const next: PatientSnapshot = { actorId, patientId, savedAt: new Date(lastSuccessAt).toISOString(), record: allowed };
    setSnapshot(next);
    saveSnapshot(next).catch(() => {
      // Offline copy unavailable on this device; live data is unaffected.
      lastSavedRef.current = "";
    });
  }, [data, lastSuccessAt, actorId, patientId]);

  const { mutate: pollMutate, refresh } = poll;
  // Bound to this actor/patient: a held save that resolves after an account
  // switch calls a stale `mutate` and changes nothing in the new record.
  const mutate = useMemo(
    () =>
      bindToFence(fence, () => fenceRef.current, (updater: (current: PatientRecord) => PatientRecord) => {
        pollMutate((current) => (current ? updater(current) : current));
      }),
    [fence, pollMutate],
  );

  const useDevice = !poll.data && !poll.denied && snapshot !== null && deviceCopyAllowed(poll.error);
  const record = poll.data ?? (useDevice ? fromOfflineRecord(snapshot.record) : null);
  const origin = poll.data ? "server" : useDevice ? "device" : null;
  const rulesConfirmedAt =
    origin === "server" && lastSuccessAt !== null
      ? new Date(lastSuccessAt).toISOString()
      : origin === "device"
        ? (snapshot?.savedAt ?? null)
        : null;

  const status: PatientData["status"] = !patientId
    ? "idle"
    : record
      ? "ready"
      : poll.error
        ? "error"
        : "loading";

  return {
    record,
    origin,
    deviceSavedAt: useDevice ? snapshot.savedAt : null,
    rulesConfirmedAt,
    status,
    error: poll.error,
    lastSuccessAt,
    isRefreshing: poll.isRefreshing,
    denied: poll.denied,
    fence,
    refresh,
    mutate,
  };
}
