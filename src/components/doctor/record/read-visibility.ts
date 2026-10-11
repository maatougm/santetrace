/**
 * What this clinician may READ in the projected record, from the record's
 * CURRENT access envelope on every call (no cached eligibility, no request).
 *
 * The server projects a denied section as [] / null, so an array's shape cannot
 * tell "not shared" from "inspected and empty". Counts are therefore
 * `number | null`: `null` = not shared with this account (unknown), `0` =
 * authorized, inspected and empty. Guards mirror `projectPatientRecord`.
 * `canManageCare` / `canReviewLabs` are mutation rights and never grant a read
 * (owners have them false; a clinical+documents secondary reads labs without them).
 * Pure: no React, no CSS.
 */
import type { AccessEnvelope, SharingScope } from "@/contracts/patient-platform";
import type { Candidate, Observation, PatientRecord } from "@/lib/client/api";
import { isOpenAlert } from "../shared/alerts";

export type ReadAccess = Pick<AccessEnvelope, "owner" | "scopes">;

export interface AccessSource {
  readonly access: ReadAccess;
}

/** `null` = not shared with this account; a number (0 included) = authorized and inspected. */
export type VisibleCount = number | null;

export interface Readability {
  readonly measurements: boolean;
  /** Document list and PDF source. */
  readonly documents: boolean;
  /** Candidates, observations, pending/confirmed lab counts and lab series. */
  readonly labs: boolean;
  /** Alert list and open-alert count. */
  readonly alerts: boolean;
  readonly reminders: boolean;
  /** Proposals, external notes, medical facts, plan and plan actions. */
  readonly clinical: boolean;
}

const LAB_SCOPES: readonly SharingScope[] = ["clinical", "documents"];
/** The backend's alerts composite, mirrored explicitly: an "alerts" scope alone proves nothing. */
const ALERT_SCOPES: readonly SharingScope[] = ["alerts", "status", "clinical", "measurements", "documents"];

function hasAll(access: ReadAccess, scopes: readonly SharingScope[]): boolean {
  return access.owner || scopes.every((scope) => access.scopes.includes(scope));
}

export function readability(access: ReadAccess): Readability {
  const clinical = hasAll(access, ["clinical"]);
  return {
    measurements: hasAll(access, ["measurements"]),
    documents: hasAll(access, ["documents"]),
    labs: hasAll(access, LAB_SCOPES),
    alerts: hasAll(access, ALERT_SCOPES),
    reminders: clinical,
    clinical,
  };
}

/** Matching items when the section is readable and present; never coerces "unknown" to 0. */
function countWhen<T>(readable: boolean, items: readonly T[] | undefined, keep: (item: T) => boolean = () => true): VisibleCount {
  if (!readable || items === undefined) return null;
  return items.filter(keep).length;
}

const isPendingCandidate = (candidate: Pick<Candidate, "status">): boolean => candidate.status === "proposed";
const isReviewableProposal = (proposal: Pick<PatientRecord["proposals"][number], "state">): boolean =>
  proposal.state === "pending" || proposal.state === "needs_review";

/** Open (new + acknowledged) alerts, or null when the alert composite is not shared. */
export function visibleOpenAlertCount(record: AccessSource & Pick<PatientRecord, "alerts">): VisibleCount {
  return countWhen(readability(record.access).alerts, record.alerts, isOpenAlert);
}

export type RecordCountSource = AccessSource &
  Pick<PatientRecord, "alerts" | "candidates" | "proposals" | "measurements" | "externalNotes" | "reminders">;

export interface RecordCounts {
  readonly openAlerts: VisibleCount;
  readonly measurements: VisibleCount;
  /** Proposed (unconfirmed) lab values, across all documents. */
  readonly pendingLabs: VisibleCount;
  /** Proposals awaiting a decision (pending or needs_review). */
  readonly reviewableProposals: VisibleCount;
  /** An absent (historical) property stays unknown. */
  readonly externalNotes: VisibleCount;
  readonly reminders: VisibleCount;
}

export function recordCounts(record: RecordCountSource): RecordCounts {
  const read = readability(record.access);
  return {
    openAlerts: visibleOpenAlertCount(record),
    measurements: countWhen(read.measurements, record.measurements),
    pendingLabs: countWhen(read.labs, record.candidates, isPendingCandidate),
    reviewableProposals: countWhen(read.clinical, record.proposals, isReviewableProposal),
    externalNotes: countWhen(read.clinical, record.externalNotes),
    reminders: countWhen(read.reminders, record.reminders),
  };
}

export interface DocumentLabSource extends AccessSource {
  readonly candidates: readonly Pick<Candidate, "documentId" | "status">[];
  readonly observations: readonly Pick<Observation, "documentId">[];
}

export interface DocumentLabCounts {
  /** Proposed values awaiting review. */
  readonly pending: VisibleCount;
  /** Clinician-confirmed results. */
  readonly confirmed: VisibleCount;
  /** Every extracted value (any status). */
  readonly total: VisibleCount;
}

/** Structured values of one document; all null unless owner or clinical + documents. */
export function documentLabCounts(source: DocumentLabSource, documentId: string): DocumentLabCounts {
  const { labs } = readability(source.access);
  const ofDocument = (item: { readonly documentId: string }) => item.documentId === documentId;
  return {
    pending: countWhen(labs, source.candidates, (c) => ofDocument(c) && isPendingCandidate(c)),
    confirmed: countWhen(labs, source.observations, ofDocument),
    total: countWhen(labs, source.candidates, ofDocument),
  };
}

/** How a null plan reads: "none" only when the plan is shared (status alone cannot establish absence). */
export type PlanAbsence = "none" | "notShared";

export function planAbsence(record: AccessSource): PlanAbsence {
  return readability(record.access).clinical ? "none" : "notShared";
}
