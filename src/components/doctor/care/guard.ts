/**
 * The server's exact current RevisionGuard and plan-bound requirement ids.
 * Sent to care managers on the projected record (record.guard,
 * record.requirementIds) and on PlanResponse. Never derived from older data:
 * absent means unknown, and decisions that need it are blocked.
 */
import type { RevisionGuard } from "@/contracts/monitoring";

type GuardCarrier = { guard?: RevisionGuard } | null | undefined;
type RequirementCarrier = { requirementIds?: string[] } | null | undefined;

/** The five fields the server compares (proposal/protocol revisions are not part of it). */
export function currentGuardOf(carrier: GuardCarrier): RevisionGuard | null {
  const guard = carrier?.guard;
  if (!guard) return null;
  return {
    contextRevision: guard.contextRevision,
    evidenceRevision: guard.evidenceRevision,
    authorityRevision: guard.authorityRevision,
    carePlanRevision: guard.carePlanRevision,
    profileVersions: [...guard.profileVersions],
  };
}

/** record.guard first, then PlanResponse.guard; null when neither was sent. */
export function resolveCurrentGuard(record: GuardCarrier, plan: GuardCarrier): RevisionGuard | null {
  return currentGuardOf(record) ?? currentGuardOf(plan);
}

export function resolveRequirementIds(record: RequirementCarrier, plan: RequirementCarrier): string[] | null {
  return record?.requirementIds ?? plan?.requirementIds ?? null;
}

/** Same five-field context (profile versions compared as a set, the server sorts them). */
export function sameGuard(a: RevisionGuard, b: RevisionGuard): boolean {
  const key = (g: RevisionGuard) =>
    JSON.stringify([g.contextRevision, g.evidenceRevision, g.authorityRevision, g.carePlanRevision, [...g.profileVersions].sort()]);
  return key(a) === key(b);
}
