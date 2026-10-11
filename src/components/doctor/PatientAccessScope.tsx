"use client";

/**
 * One fenced GET /api/patients/:id poll shared by every clinician subpage of
 * a patient (record tabs, document review). Not another session/runtime
 * provider: the session still comes from ClinicianShell.
 *
 * - The poll is fenced by actor+patient and the highest authorityRevision:
 *   an older, broader answer cannot overwrite a newer downgrade.
 * - On 401/403/404 the record is cleared, polling stops and the fence is
 *   revoked, so every held one-shot result (report, search, PDF, proposal
 *   generation) is discarded when it returns.
 */
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { useActorSession } from "@/components/layout";
import {
  bindToFence,
  createMutationGuard,
  fenceKey,
  fencedFetcher,
  useAccessFence,
  type AccessFence,
  type MutationGuard,
} from "@/lib/client/access-fence";
import { getPatient, type ApiError, type PatientRecord } from "@/lib/client/api";
import type { SharingScope } from "@/contracts/patient-platform";
import { useGuardedPolling } from "./shared/use-guarded-polling";

export interface PatientAccessValue {
  patientId: string;
  record: PatientRecord | null;
  error: ApiError | null;
  status: "loading" | "ready" | "error";
  isRefreshing: boolean;
  lastSuccessAt: number | null;
  /** Access ended (401/403/404): the record was cleared. */
  denied: boolean;
  fence: AccessFence;
  /**
   * Every async mutation calls `guard.begin()` before its request and commits
   * its result through the returned function: a result held across an
   * authority change (narrower scopes) or a patient switch is discarded.
   */
  guard: MutationGuard;
  refresh: () => Promise<void>;
  /** Apply a server-confirmed change to the cached record, then refetch. Use inside a guard commit. */
  apply: (updater: (current: PatientRecord | null) => PatientRecord | null) => void;
}

/** Props every clinician record section receives from the record view. */
export interface DoctorSectionProps {
  patientId: string;
  record: PatientRecord;
  fence: AccessFence;
  /** Refetch the shared record after a mutation (plan, proposal, message…). */
  refresh: () => void;
}

const PatientAccessContext = createContext<PatientAccessValue | null>(null);

export function PatientAccessScope({ patientId, children }: { patientId: string; children: ReactNode }) {
  const { actor } = useActorSession();
  const fence = useAccessFence(fenceKey(actor.id, patientId));
  const fenceRef = useRef(fence);
  fenceRef.current = fence;
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      fencedFetcher(fence, (s) => getPatient(patientId, { signal: s }), (record) => record.access?.authorityRevision)(signal),
    [fence, patientId],
  );
  const poll = useGuardedPolling<PatientRecord>(`doctor-patient:${actor.id}:${patientId}`, fetcher, {
    intervalMs: 2_000,
    onDenied: () => fence.revoke(),
  });

  // Bound to this clinician+patient: a held mutation that resolves after a
  // patient switch or a revocation cannot write into another record.
  const { apply: pollApply } = poll;
  const apply = useMemo(() => bindToFence(fence, () => fenceRef.current, pollApply), [fence, pollApply]);
  const guard = useMemo(() => createMutationGuard(fence, () => fenceRef.current), [fence]);

  const value = useMemo<PatientAccessValue>(
    () => ({
      patientId,
      record: poll.data,
      error: poll.error,
      status: poll.status,
      isRefreshing: poll.isRefreshing,
      lastSuccessAt: poll.lastSuccessAt,
      denied: poll.denied,
      fence,
      guard,
      refresh: poll.refresh,
      apply,
    }),
    [patientId, poll.data, poll.error, poll.status, poll.isRefreshing, poll.lastSuccessAt, poll.denied, fence, guard, poll.refresh, apply],
  );

  return <PatientAccessContext.Provider value={value}>{children}</PatientAccessContext.Provider>;
}

export function usePatientAccess(): PatientAccessValue {
  const value = useContext(PatientAccessContext);
  if (!value) throw new Error("usePatientAccess must be used inside PatientAccessScope (doctor/patients/[id]/layout).");
  return value;
}

/** True when the current projection grants this scope (owner views have all scopes). */
export function hasScope(record: PatientRecord, scope: SharingScope): boolean {
  return record.access.owner || record.access.scopes.includes(scope);
}
