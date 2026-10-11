/**
 * Pure display decisions for the patient plan (feature 006, stories 2, 4, 5).
 *
 * Patients read pending proposals ONLY through `toPatientProposalStatus`
 * (kind + state, never names, parameters, sources or hypotheses). A passed
 * review deadline is shown as overdue, never as tacit approval. Self-reports
 * are online-only and never a clinical resolution.
 */
import type { CareAction, CarePlan, CareProposal, ProposalStatus, ProtocolApplication } from "@/contracts/monitoring";
import type { DoctorProfile } from "@/contracts/patient-platform";
import { toPatientProposalStatus } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { reasonText, type ReasonText } from "@/lib/client/copy/reasons";
import type { Language } from "@/lib/client/transport";

const time = (iso: string | null | undefined): number => {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
};

// ---------------------------------------------------------------------------
// Proposals in review
// ---------------------------------------------------------------------------

const IN_REVIEW: ReadonlySet<CareProposal["state"]> = new Set(["pending", "needs_inputs", "needs_review"]);

/** Projected statuses of the proposals still awaiting a clinician decision. */
export function patientProposalStatuses(proposals: readonly (CareProposal | ProposalStatus)[]): ProposalStatus[] {
  return proposals.map(toPatientProposalStatus).filter((status) => IN_REVIEW.has(status.state));
}

export interface ProposalGroup {
  kind: CareProposal["kind"];
  state: CareProposal["state"];
  count: number;
}

export function groupProposals(statuses: readonly ProposalStatus[]): ProposalGroup[] {
  return statuses.reduce<ProposalGroup[]>((groups, status) => {
    const index = groups.findIndex((group) => group.kind === status.kind && group.state === status.state);
    if (index < 0) return [...groups, { kind: status.kind, state: status.state, count: 1 }];
    return groups.map((group, i) => (i === index ? { ...group, count: group.count + 1 } : group));
  }, []);
}

export interface ProposalRow {
  key: string;
  kindLabel: string;
  stateLabel: string;
  count: number;
}

/**
 * Patient rows for proposals in review. Kind labels come from the neutral
 * `patientProposalKind` (a pending lab exam is "a proposal in review", never
 * an exam); `proposalKind` stays clinician vocabulary.
 */
export function patientProposalRows(proposals: readonly (CareProposal | ProposalStatus)[], lang: Language): ProposalRow[] {
  const copy = CARE_COPY[lang];
  return groupProposals(patientProposalStatuses(proposals)).map((group) => ({
    key: `${group.kind}-${group.state}`,
    kindLabel: copy.patientProposalKind[group.kind],
    stateLabel: copy.proposalState[group.state],
    count: group.count,
  }));
}

// ---------------------------------------------------------------------------
// Plan and actions
// ---------------------------------------------------------------------------

export interface ReviewDeadlineView {
  deadline: string | null;
  overdue: boolean;
}

export function reviewDeadlineView(plan: Pick<CarePlan, "reviewDeadline"> | null, now: number): ReviewDeadlineView {
  const deadline = plan?.reviewDeadline ?? null;
  return { deadline, overdue: deadline !== null && time(deadline) < now };
}

export type ActionOrigin = { kind: "approved_once"; version: number } | { kind: "protocol"; version: number };

export function actionOrigin(action: Pick<CareAction, "protocolId" | "originVersion">): ActionOrigin {
  return action.protocolId !== null
    ? { kind: "protocol", version: action.originVersion }
    : { kind: "approved_once", version: action.originVersion };
}

export interface ActionApproval {
  /** The server's live check says the original approval no longer holds. */
  lapsed: boolean;
  /** The server's live check says it still holds (false when lapsed or unchecked). */
  current: boolean;
  /** The action is finished (completed / not completed / cancelled): nothing left to follow. */
  closed: boolean;
  /**
   * Original approval line (approved once / protocol). Null only for a pending
   * lapsed action, so no "Validé…" is shown; a finished action keeps it as history.
   */
  origin: ActionOrigin | null;
  /**
   * Pending lapsed action: wait for reconfirmation before following it, and a
   * self-report beside it only records something already done.
   */
  awaitReconfirmation: boolean;
  checkedAt: string | null;
  reasons: ReasonText[];
}

/**
 * Live approval state of an approved action. `approval` is response metadata
 * that never replaces the original decision; when it is absent (older server,
 * device copy) the original line stays but nothing claims it is current. A
 * finished action is never told to wait before following it (root click
 * testing); self-report permission is decided elsewhere and unchanged.
 */
export function actionApproval(
  action: Pick<CareAction, "protocolId" | "originVersion" | "approval" | "state">,
  lang: Language,
): ActionApproval {
  const live = action.approval;
  const closed = action.state !== "pending";
  const lapsed = live?.currentlyApproved === false;
  return {
    lapsed,
    current: live?.currentlyApproved === true,
    closed,
    origin: lapsed && !closed ? null : actionOrigin(action),
    awaitReconfirmation: lapsed && !closed,
    checkedAt: live?.checkedAt ?? null,
    reasons: lapsed && live ? live.reasons.map((reason) => reasonText(reason, lang)) : [],
  };
}

/**
 * Shown beside the report controls of a pending lapsed action: reporting
 * records something already done and grants no permission to do it now. The
 * report itself stays allowed (canSelfReport is unchanged).
 */
export function selfReportNote(action: Pick<CareAction, "protocolId" | "originVersion" | "approval" | "state">, lang: Language): string | null {
  return actionApproval(action, lang).awaitReconfirmation ? CARE_COPY[lang].plan.reportLapsedNote : null;
}

export function isActionOverdue(action: Pick<CareAction, "state" | "dueAt">, now: number): boolean {
  return action.state === "pending" && time(action.dueAt) < now;
}

export type SelfReportAvailability = "allowed" | "offline" | "device_copy" | "not_pending";

export function canSelfReport(
  action: Pick<CareAction, "state">,
  context: { online: boolean; origin: "server" | "device" | null },
): SelfReportAvailability {
  if (action.state !== "pending") return "not_pending";
  if (context.origin !== "server") return "device_copy";
  return context.online ? "allowed" : "offline";
}

const STATE_RANK: Record<CareAction["state"], number> = { pending: 0, completed: 1, not_completed: 1, cancelled: 2 };

/** Pending first (soonest due), then reported (most recent first), cancelled last. */
export function sortActions(actions: readonly CareAction[]): CareAction[] {
  return [...actions].sort((a, b) => {
    const rank = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (rank !== 0) return rank;
    if (a.state === "pending") return time(a.dueAt) - time(b.dueAt);
    return time(b.reportedAt ?? b.createdAt) - time(a.reportedAt ?? a.createdAt);
  });
}

export function doctorName(clinicianId: string | null, doctors: readonly DoctorProfile[]): string | null {
  if (!clinicianId) return null;
  return doctors.find((doctor) => doctor.id === clinicianId)?.displayName ?? null;
}

// ---------------------------------------------------------------------------
// Approved advice
// ---------------------------------------------------------------------------

export type AdviceView =
  | { kind: "approved_once" | "protocol_applied"; templateId: string; version: number; action: CareAction }
  | { kind: "lapsed"; templateId: string; action: CareAction }
  | { kind: "blocked"; protocolVersion: number; at: string };

export function adviceFromAction(action: CareAction): AdviceView {
  // The live check says the approval no longer holds: a pending action is never shown as
  // validated; a finished one keeps its historical origin and gets no reconfirmation directive.
  if (action.approval?.currentlyApproved === false && action.state === "pending") {
    return { kind: "lapsed", templateId: action.action.templateId, action };
  }
  const origin = actionOrigin(action);
  return {
    kind: origin.kind === "protocol" ? "protocol_applied" : "approved_once",
    templateId: action.action.templateId,
    version: origin.version,
    action,
  };
}

export function adviceFromBlocked(application: Pick<ProtocolApplication, "protocolVersion" | "createdAt">): AdviceView {
  return { kind: "blocked", protocolVersion: application.protocolVersion, at: application.createdAt };
}

/** Protocol reuse that was refused: a review is required before any new advice. */
export function blockedApplications(applications: readonly ProtocolApplication[]): ProtocolApplication[] {
  return applications
    .filter((application) => application.state === "blocked")
    .sort((a, b) => time(b.createdAt) - time(a.createdAt));
}
