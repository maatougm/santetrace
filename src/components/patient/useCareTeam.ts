"use client";

/**
 * Who can actually see this patient's alerts right now: the owner's current
 * grants (GET /patients/:id/grants) intersected with the enabled fictional
 * doctor directory (GET /doctors lists enabled accounts only). Used so patient
 * screens never imply that a care team received or viewed something when no
 * accepted, enabled doctor has the alerts scope (FR-027). Owner only; memory
 * only.
 *
 * Never optimistic: a missing or failed read of either list, a denial, or an
 * authority/epoch change since the data was fetched all give "unknown".
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { CareGrant, DoctorProfile } from "@/contracts/patient-platform";
import type { AccessFence } from "@/lib/client/access-fence";
import { fencedFetcher } from "@/lib/client/access-fence";
import { listDoctors, listGrants } from "@/lib/client/grants-api";
import { usePolling } from "@/lib/client/use-polling";

export type CareTeamStatus = "unknown" | "none" | "present";

export interface CareTeam {
  /** "unknown": not loaded, offline, refused or stale — never treated as "present". */
  status: CareTeamStatus;
  /** Accepted, enabled doctors who can see alerts (active grant with the alerts scope). */
  alertClinicianIds: string[];
  /** The accepted, enabled primary referent, if any. */
  primaryClinicianId: string | null;
}

export const UNKNOWN_CARE_TEAM: CareTeam = Object.freeze({ status: "unknown", alertClinicianIds: [], primaryClinicianId: null }) as CareTeam;

/**
 * Pure: derives the care team. Pending or revoked grants, and grants whose
 * doctor is not in the enabled directory (disabled account keeps a historical
 * "active" grant), count for nothing. Either input missing → unknown.
 */
export function careTeamFrom(grants: readonly CareGrant[] | null, enabledDoctorIds: ReadonlySet<string> | null): CareTeam {
  if (!grants || !enabledDoctorIds) return UNKNOWN_CARE_TEAM;
  const active = grants.filter((grant) => grant.state === "active" && enabledDoctorIds.has(grant.clinicianId));
  const alertClinicianIds = active.filter((grant) => grant.scopes.includes("alerts")).map((grant) => grant.clinicianId);
  const primary = active.find((grant) => grant.relationship === "primary") ?? null;
  return {
    status: alertClinicianIds.length > 0 ? "present" : "none",
    alertClinicianIds,
    primaryClinicianId: primary?.clinicianId ?? null,
  };
}

/** What one successful read captured, tagged with the fence epoch it belongs to. */
export interface CareTeamSnapshot {
  grants: CareGrant[];
  doctorIds: string[];
  epoch: number;
}

/**
 * Pure: the care team to show now. A snapshot from an earlier epoch (access
 * changed since), a failed latest read, or a denied fence gives "unknown"
 * immediately — the old team is never shown while a fresh read is pending.
 */
export function careTeamNow(
  snapshot: CareTeamSnapshot | null,
  currentEpoch: number,
  options: { latestReadFailed: boolean; denied: boolean },
): CareTeam {
  if (!snapshot || options.latestReadFailed || options.denied || snapshot.epoch !== currentEpoch) return UNKNOWN_CARE_TEAM;
  return careTeamFrom(snapshot.grants, new Set(snapshot.doctorIds));
}

const CARE_TEAM_POLL_MS = 30_000;

async function readCareTeam(patientId: string, signal: AbortSignal): Promise<{ grants: CareGrant[]; doctors: DoctorProfile[] }> {
  const [grantList, directory] = await Promise.all([listGrants(patientId, { signal }), listDoctors({ signal })]);
  return { grants: grantList.grants, doctors: directory.doctors };
}

/** Owner's care team, refreshed every 30 s and on every access change, through the patient fence. */
export function useCareTeam(patientId: string | null, actorId: string | null, fence: AccessFence, enabled: boolean): CareTeam {
  const epoch = useSyncExternalStore(fence.subscribe, fence.epoch, fence.epoch);
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<CareTeamSnapshot> => {
      const value = await fencedFetcher(fence, (s) => readCareTeam(patientId ?? "", s), () => null)(signal);
      return { grants: value.grants, doctorIds: value.doctors.map((doctor) => doctor.id), epoch: fence.epoch() };
    },
    [fence, patientId],
  );
  const poll = usePolling<CareTeamSnapshot>(
    patientId && actorId && enabled ? `care-team:${actorId}:${patientId}` : null,
    fetcher,
    { intervalMs: CARE_TEAM_POLL_MS, enabled: Boolean(patientId && enabled), clearOnDenied: true },
  );

  // Access changed (revocation, new authority revision): re-read now instead of in 30 s.
  const { refresh } = poll;
  const snapshotEpoch = poll.data?.epoch ?? null;
  useEffect(() => {
    if (snapshotEpoch !== null && snapshotEpoch !== epoch && !fence.denied()) void refresh();
  }, [epoch, snapshotEpoch, fence, refresh]);

  const snapshot = poll.data;
  const latestReadFailed = poll.error !== null;
  const denied = poll.denied || fence.denied();
  return useMemo(() => careTeamNow(snapshot, epoch, { latestReadFailed, denied }), [snapshot, epoch, latestReadFailed, denied]);
}
