/**
 * Pure decisions for the simplified patient home: the greeting name, the one
 * "next step" and the compact attention rows that must stay visible.
 *
 * Nothing is invented: a next step comes only from live server data (a
 * pending, still-approved plan action, an undeclared reminder, or a record
 * with no declared information yet); otherwise there is none.
 */
import type { Measurement, Reminder } from "@/contracts/care";
import type { CareAction, MedicalFact } from "@/contracts/monitoring";
import type { ProjectedRecord } from "@/contracts/patient-platform";
import { isSuspectMeasurement } from "@/lib/client/format";
import { latestOfKind } from "../monitoring/monitoring-view";
import { patientProposalStatuses } from "../plan/plan-view";
import { upcomingReminders } from "../plan/reminder-view";
import { currentFacts } from "../record/record-model";

const time = (iso: string): number => {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
};

/** First word of the display name; "" when there is none (neutral greeting). */
export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? "").trim().split(/\s+/)[0] ?? "";
}

// ---------------------------------------------------------------------------
// Next step
// ---------------------------------------------------------------------------

export type NextStep =
  | { kind: "action"; action: CareAction; overdue: boolean }
  | { kind: "reminder"; reminder: Reminder }
  | { kind: "onboarding" };

export interface NextStepInput {
  /** Only live server data can propose a next step. */
  live: boolean;
  actions: readonly CareAction[];
  reminders: readonly Reminder[];
  facts: readonly MedicalFact[];
  now: number;
}

/** A pending action the server still considers approved (a lapsed one waits for reconfirmation). */
export function isFollowableAction(action: Pick<CareAction, "state" | "approval">): boolean {
  return action.state === "pending" && action.approval?.currentlyApproved !== false;
}

/** Soonest-due pending, still-approved action. */
export function nextPlanAction(actions: readonly CareAction[]): CareAction | null {
  return actions
    .filter(isFollowableAction)
    .reduce<CareAction | null>((soonest, action) => (!soonest || time(action.dueAt) < time(soonest.dueAt) ? action : soonest), null);
}

export function nextStep({ live, actions, reminders, facts, now }: NextStepInput): NextStep | null {
  if (!live) return null;
  const action = nextPlanAction(actions);
  if (action) return { kind: "action", action, overdue: time(action.dueAt) < now };
  const [reminder] = upcomingReminders(reminders, actions, now, 1);
  if (reminder) return { kind: "reminder", reminder };
  return currentFacts(facts).length === 0 ? { kind: "onboarding" } : null;
}

// ---------------------------------------------------------------------------
// Attention rows (always visible when they apply)
// ---------------------------------------------------------------------------

export interface HomeAttention {
  /** Latest scored reading of a kind flagged suspect by its connector (excluded from the rules). */
  suspect: Measurement[];
  /** Proposals waiting on the doctor's review (pending / needs_review; live data only). */
  awaitingDoctor: number;
  /** Proposals waiting on the PATIENT: required welcome questions unanswered (needs_inputs; live only). */
  needsInputs: number;
  /** Pending actions whose approval no longer holds (server live check). */
  toReconfirm: number;
  /** The record says consent is not recorded. */
  consentMissing: boolean;
}

const SCORED_KINDS: readonly Measurement["kind"][] = ["blood_pressure", "glucose"];

export function homeAttention(
  record: Pick<ProjectedRecord, "measurements" | "proposals" | "actions" | "patient">,
  live: boolean,
): HomeAttention {
  const suspect = SCORED_KINDS.map((kind) => latestOfKind(record.measurements, kind)).filter(
    (measurement): measurement is Measurement => measurement !== null && isSuspectMeasurement(measurement),
  );
  const open = live ? patientProposalStatuses(record.proposals) : [];
  return {
    suspect,
    awaitingDoctor: open.filter((status) => status.state !== "needs_inputs").length,
    needsInputs: open.filter((status) => status.state === "needs_inputs").length,
    toReconfirm: live ? record.actions.filter((action) => action.state === "pending" && action.approval?.currentlyApproved === false).length : 0,
    consentMissing: record.patient.consent === false,
  };
}

export function hasAttention(attention: HomeAttention): boolean {
  return (
    attention.suspect.length > 0 ||
    attention.awaitingDoctor > 0 ||
    attention.needsInputs > 0 ||
    attention.toReconfirm > 0 ||
    attention.consentMissing
  );
}
