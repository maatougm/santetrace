"use client";

/**
 * The owner's doctor grants, read through the access fence, to tell whether a
 * referent has ACCEPTED access. Re-read when the authority revision moves (an
 * acceptance or a revocation); the previous answer stays while re-reading.
 * "unavailable" when not readable (device copy, not the owner, read failed).
 */
import { useCallback } from "react";
import type { CareGrant } from "@/contracts/patient-platform";
import type { AccessFence } from "@/lib/client/access-fence";
import type { PatientRecord } from "@/lib/client/api";
import { listGrants } from "@/lib/client/grants-api";
import { useFencedRead } from "./use-fenced-read";

export type GrantsRead = { status: "loading" } | { status: "ready"; grants: CareGrant[] } | { status: "unavailable" };

export function useOwnerGrants(record: PatientRecord, origin: "server" | "device" | null, fence: AccessFence): GrantsRead {
  const patientId = record.patient.id;
  const enabled = origin === "server" && record.access.owner;
  const authorityRevision = record.access.authorityRevision;
  const read = useCallback(
    (signal: AbortSignal) => listGrants(patientId, { signal }).then((response) => response.grants),
    // authorityRevision makes a new reader, so grants are read again after an access change.
    [patientId, authorityRevision],
  );
  const { state } = useFencedRead(fence, enabled ? read : null);

  if (!enabled || state.status === "error") return { status: "unavailable" };
  return state.status === "ready" ? { status: "ready", grants: state.value } : state;
}
