/**
 * Immutable updates of the cached patient record after successful mutations.
 *
 * Second line of defence behind the mutation guard: an updater never puts
 * back data the CURRENT projection does not show. Updates replace existing
 * items only; creations (new reminder, uploaded document, confirmed
 * observation) apply only while the matching scope/authority is visible in
 * the current record. Hidden rules are never restored.
 */
import type {
  Alert,
  Candidate,
  CareDocument,
  Observation,
  Patient,
  PatientRecord,
  Reminder,
} from "@/lib/client/api";
import type { SharingScope } from "@/contracts/patient-platform";

type Updater = (current: PatientRecord | null) => PatientRecord | null;

function replaceExisting<T extends { id: string }>(list: readonly T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list];
}

function upsert<T extends { id: string }>(list: readonly T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}

function visible(record: PatientRecord, scope: SharingScope): boolean {
  return record.access.owner || record.access.scopes.includes(scope);
}

function manages(record: PatientRecord): boolean {
  return record.access.owner || record.access.canManageCare;
}

/** A clinician action updates an existing alert; it never adds one the projection hides. */
export const withAlert =
  (alert: Alert): Updater =>
  (current) =>
    current ? { ...current, alerts: replaceExisting(current.alerts, alert) } : current;

/** New rules version: applied only while this record still shows rules (care authority). */
export const withPatient =
  (patient: Patient): Updater =>
  (current) =>
    current && current.patient.id === patient.id && current.patient.rules !== null ? { ...current, patient } : current;

export const withReminder =
  (reminder: Reminder): Updater =>
  (current) =>
    current
      ? { ...current, reminders: manages(current) ? upsert(current.reminders, reminder) : replaceExisting(current.reminders, reminder) }
      : current;

export const withDocument =
  (document: CareDocument, candidates: readonly Candidate[]): Updater =>
  (current) => {
    if (!current || !visible(current, "documents")) return current;
    return {
      ...current,
      documents: upsert(current.documents, document),
      candidates: candidates.reduce<Candidate[]>((list, c) => upsert(list, c), [...current.candidates]),
    };
  };

export const withReview =
  (candidate: Candidate, observation: Observation | null): Updater =>
  (current) => {
    if (!current || !visible(current, "documents")) return current;
    return {
      ...current,
      candidates: replaceExisting(current.candidates, candidate),
      observations: observation ? upsert(current.observations, observation) : current.observations,
    };
  };

export const withObservation =
  (observation: Observation): Updater =>
  (current) =>
    current ? { ...current, observations: replaceExisting(current.observations, observation) } : current;
