"use client";

/**
 * Current server guard and plan-bound requirement ids for care-manager
 * decisions: record.guard / record.requirementIds, else the fenced
 * GET care-plan answer (PlanResponse.guard). Neither: null (decisions blocked).
 */
import { useCallback } from "react";
import type { RevisionGuard } from "@/contracts/monitoring";
import type { AccessFence } from "@/lib/client/access-fence";
import type { PatientRecord } from "@/lib/client/api";
import { getCarePlan } from "@/lib/client/care-api";
import { resolveCurrentGuard, resolveRequirementIds } from "./guard";
import { useFencedResource } from "./use-fenced";

export interface CurrentContext {
  guard: RevisionGuard | null;
  requirementIds: string[] | null;
}

export function useCurrentContext(patientId: string, record: PatientRecord, fence: AccessFence): CurrentContext {
  const needsPlan = record.access.canManageCare && (!record.guard || !record.requirementIds);
  const loader = useCallback(
    (signal: AbortSignal) => (needsPlan ? getCarePlan(patientId, { signal }) : Promise.resolve(null)),
    [patientId, needsPlan],
  );
  // Refetch the fallback whenever the polled record moves (new evidence, plan or authority).
  const reloadKey = needsPlan ? JSON.stringify([record.revision ?? null, record.plan?.revision ?? 0, record.access.authorityRevision]) : "";
  const { state } = useFencedResource(fence, loader, reloadKey);
  const plan = state.status === "ready" ? state.value : null;
  return { guard: resolveCurrentGuard(record, plan), requirementIds: resolveRequirementIds(record, plan) };
}
