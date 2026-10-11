/**
 * Explicit allowlist for the patient's own device copy (owner only).
 *
 * Kept: the pre-006 owner record used by offline measurement capture,
 * reminders and history (patient incl. rules, measurements, alerts, reminders,
 * documents, candidates, observations) plus previously approved plan actions,
 * shown with their offline timestamp.
 * Never kept: access envelope, medical facts, proposals (incl. pending exams
 * and hypotheses), plan policy, evaluations, monitoring state, grants, AI
 * drafts, clinician or guest data. The expanded 006 record is not an offline
 * cache payload.
 */
import type { CareAction } from "@/contracts/monitoring";
import type { AccessEnvelope, ProjectedRecord } from "@/contracts/patient-platform";

export interface OfflineRecord {
  patient: ProjectedRecord["patient"];
  measurements: ProjectedRecord["measurements"];
  alerts: ProjectedRecord["alerts"];
  reminders: ProjectedRecord["reminders"];
  documents: ProjectedRecord["documents"];
  candidates: ProjectedRecord["candidates"];
  observations: ProjectedRecord["observations"];
  /** Approved, fixed plan actions only (no proposals, no drafts). */
  actions: CareAction[];
}

const ARRAY_KEYS = ["measurements", "alerts", "reminders", "documents", "candidates", "observations"] as const;

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isApprovedFixedAction(value: unknown): value is CareAction {
  if (typeof value !== "object" || value === null) return false;
  const action = value as Partial<CareAction>;
  return (
    typeof action.id === "string" &&
    typeof action.dueAt === "string" &&
    typeof action.action === "object" &&
    action.action !== null &&
    typeof action.action.templateId === "string" &&
    (action.state === "pending" || action.state === "completed" || action.state === "not_completed")
  );
}

/**
 * Builds the device copy from a server answer (or re-sanitises an older copy).
 * Returns null unless the answer is the owner's own record: doctor/guest views
 * are never written to the device.
 */
export function toOfflineRecord(record: unknown): OfflineRecord | null {
  if (typeof record !== "object" || record === null) return null;
  const source = record as Record<string, unknown>;
  const access = source.access as Partial<AccessEnvelope> | undefined;
  // A copy made from an explicit non-owner projection is refused. Older
  // copies (saved before 006, without an access envelope) were owner-only.
  if (access !== undefined && access.owner !== true) return null;
  const patient = source.patient;
  if (typeof patient !== "object" || patient === null) return null;
  const copy = {
    patient: patient as ProjectedRecord["patient"],
    // `approval` is live server metadata: a cached "currently approved" could go stale offline.
    actions: arrayOrEmpty<unknown>(source.actions)
      .filter(isApprovedFixedAction)
      .map(({ approval: _live, ...action }) => action as CareAction),
  } as OfflineRecord;
  for (const key of ARRAY_KEYS) {
    (copy as unknown as Record<string, unknown>)[key] = arrayOrEmpty(source[key]);
  }
  return copy;
}

/** Access envelope shown for a device copy: owner, but no revision is known. */
export const OFFLINE_OWNER_ACCESS: AccessEnvelope = Object.freeze({
  owner: true,
  relationship: null,
  scopes: [],
  grantId: null,
  grantRevision: null,
  authorityRevision: -1,
  canManageCare: false,
  canReviewLabs: false,
}) as AccessEnvelope;

/**
 * Expands a device copy into the record shape the screens read. Every 006
 * section that is not allowlisted is explicitly empty: screens must check
 * `origin === "device"` and say "available online only" instead of "none".
 */
export function fromOfflineRecord(copy: OfflineRecord): ProjectedRecord {
  return {
    patient: copy.patient,
    measurements: copy.measurements,
    alerts: copy.alerts,
    reminders: copy.reminders,
    documents: copy.documents,
    candidates: copy.candidates,
    observations: copy.observations,
    actions: copy.actions,
    access: OFFLINE_OWNER_ACCESS,
    medicalFacts: [],
    plan: null,
    evaluations: [],
    monitoring: null,
    proposals: [],
  };
}
