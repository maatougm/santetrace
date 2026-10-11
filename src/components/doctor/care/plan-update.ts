/**
 * Plan activation/suspension input, with the optional clinician review
 * deadline. Untouched: the key is omitted (server keeps the current value);
 * "Effacer": null; a date: exact UTC ISO, in the future and within 30 days.
 * Client checks are hints; the server validates and its message is shown.
 */
import type { CarePlan, PlanUpdate } from "@/contracts/monitoring";
import { fromDateTimeLocalValue } from "@/lib/client/format";

/** Server bound for CarePlan.reviewDeadline (care-plan-service). */
export const PLAN_DEADLINE_MAX_DAYS = 30;
const DAY_MS = 86_400_000;

export type DeadlineChoice = { kind: "keep" } | { kind: "clear" } | { kind: "set"; local: string };

type PlanUpdateBase = Omit<PlanUpdate, "reviewDeadline">;

export function buildPlanUpdate(base: PlanUpdateBase, deadline: DeadlineChoice, now: Date): { ok: true; input: PlanUpdate } | { ok: false; error: string } {
  if (deadline.kind === "keep") return { ok: true, input: { ...base } };
  if (deadline.kind === "clear") return { ok: true, input: { ...base, reviewDeadline: null } };
  const iso = fromDateTimeLocalValue(deadline.local);
  if (!iso) return { ok: false, error: "Indiquez une date et une heure valides, ou choisissez « Effacer »." };
  const at = Date.parse(iso);
  if (at <= now.getTime()) return { ok: false, error: "La date limite de revue doit être dans le futur." };
  if (at > now.getTime() + PLAN_DEADLINE_MAX_DAYS * DAY_MS) return { ok: false, error: `${PLAN_DEADLINE_MAX_DAYS} jours au maximum.` };
  return { ok: true, input: { ...base, reviewDeadline: iso } };
}

export type DeadlineEdit = Exclude<DeadlineChoice, { kind: "keep" }>;

/**
 * Deadline-only edit of an ACTIVE plan: re-sends "activate" with the plan's
 * current bindings and revision, so the state and bindings stay as they are.
 * The key is always present (a date or null); this path never suspends.
 */
export function buildDeadlineEdit(plan: CarePlan, edit: DeadlineEdit, now: Date): { ok: true; input: PlanUpdate } | { ok: false; error: string } {
  if (plan.state !== "active") return { ok: false, error: "Seule la date limite d’un plan actif se modifie ici." };
  if (edit.kind !== "set" && edit.kind !== "clear") return { ok: false, error: "Fixez une date ou effacez la date limite." };
  const base: PlanUpdateBase = {
    action: "activate",
    profileBindings: plan.profileBindings.map((binding) => ({ ...binding })),
    expectedRevision: plan.revision,
    clientId: "",
  };
  return buildPlanUpdate(base, edit, now);
}
