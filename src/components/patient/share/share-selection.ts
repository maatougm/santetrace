/**
 * Pure selection logic for the owner's one-use external share. Only elements
 * already in the current record are offered, each with the revision the
 * server will freeze: measurements and documents are immutable (1), a
 * confirmed observation is 1 + its corrections, facts and actions carry their
 * own revision. Selections are immutable sets of "kind:id" keys.
 */
import type { Document, Measurement, Observation } from "@/contracts/care";
import type { ExternalVisitGrant, VisitSelectionRef } from "@/contracts/external-visit";
import type { CareAction, MedicalFact } from "@/contracts/monitoring";
import { CARE_COPY, factDisplayLabel } from "@/lib/client/copy/care";
import type { Language } from "@/lib/client/transport";

export type ShareKind = VisitSelectionRef["kind"];

export interface ShareSource {
  measurements: Measurement[];
  observations: Observation[];
  medicalFacts: MedicalFact[];
  documents: Document[];
  actions: CareAction[];
}

export type ShareEntry =
  | { kind: "measurement"; key: string; ref: VisitSelectionRef; item: Measurement }
  | { kind: "observation"; key: string; ref: VisitSelectionRef; item: Observation }
  | { kind: "patient_fact"; key: string; ref: VisitSelectionRef; item: MedicalFact }
  | { kind: "document"; key: string; ref: VisitSelectionRef; item: Document }
  | { kind: "approved_action"; key: string; ref: VisitSelectionRef; item: CareAction };

export interface ShareGroup {
  kind: ShareKind;
  entries: ShareEntry[];
}

export function selectionKey(ref: Pick<VisitSelectionRef, "kind" | "id">): string {
  return `${ref.kind}:${ref.id}`;
}

function ref(kind: ShareKind, id: string, revision: number): { key: string; ref: VisitSelectionRef } {
  const value = { kind, id, revision };
  return { key: selectionKey(value), ref: value };
}

const newestFirst = <T>(at: (item: T) => string) => (a: T, b: T) => Date.parse(at(b)) - Date.parse(at(a));

/** Groups in a fixed order; empty groups are kept so the screen can skip them explicitly. */
export function buildShareGroups(source: ShareSource): ShareGroup[] {
  const measurements = [...source.measurements]
    .sort(newestFirst((m) => m.measuredAt))
    .map((item): ShareEntry => ({ kind: "measurement", item, ...ref("measurement", item.id, 1) }));
  const observations = [...source.observations]
    .sort(newestFirst((o) => o.examDate))
    .map((item): ShareEntry => ({ kind: "observation", item, ...ref("observation", item.id, 1 + item.revisions.length) }));
  const facts = source.medicalFacts
    .filter((f) => f.supersededBy === null)
    .sort(newestFirst((f) => f.createdAt))
    .map((item): ShareEntry => ({ kind: "patient_fact", item, ...ref("patient_fact", item.id, item.revision) }));
  const documents = source.documents
    .filter((d) => d.status !== "failed")
    .sort(newestFirst((d) => d.uploadedAt))
    .map((item): ShareEntry => ({ kind: "document", item, ...ref("document", item.id, 1) }));
  const actions = source.actions
    .filter((a) => a.state !== "cancelled")
    .sort(newestFirst((a) => a.dueAt))
    .map((item): ShareEntry => ({ kind: "approved_action", item, ...ref("approved_action", item.id, item.revision) }));

  return [
    { kind: "measurement", entries: measurements },
    { kind: "observation", entries: observations },
    { kind: "patient_fact", entries: facts },
    { kind: "document", entries: documents },
    { kind: "approved_action", entries: actions },
  ];
}

export function toggleSelection(selected: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  const next = new Set(selected);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

export function selectAll(groups: ShareGroup[]): ReadonlySet<string> {
  return new Set(groups.flatMap((group) => group.entries.map((entry) => entry.key)));
}

function selectedEntries(groups: ShareGroup[], selected: ReadonlySet<string>): ShareEntry[] {
  return groups.flatMap((group) => group.entries.filter((entry) => selected.has(entry.key)));
}

/** Refs for the selected elements still present in the record, in group order. */
export function selectionRefs(groups: ShareGroup[], selected: ReadonlySet<string>): VisitSelectionRef[] {
  return selectedEntries(groups, selected).map((entry) => entry.ref);
}

export function countSelected(groups: ShareGroup[], selected: ReadonlySet<string>): number {
  return selectedEntries(groups, selected).length;
}

/** A shared PDF is disclosed whole: the screen stresses it when one is selected. */
export function selectionHasDocument(groups: ShareGroup[], selected: ReadonlySet<string>): boolean {
  return selectedEntries(groups, selected).some((entry) => entry.kind === "document");
}

export interface IssueAttempt {
  clientId: string;
  payload: string;
  /** True once the server answered (success or definitive refusal): the next issue is a new link. */
  settled: boolean;
}

/** One clientId per issue action, reused while retrying the same selection. */
export function issueClientId(previous: IssueAttempt | null, refs: VisitSelectionRef[], makeId: () => string): IssueAttempt {
  const payload = JSON.stringify(refs);
  if (previous && !previous.settled && previous.payload === payload) return previous;
  return { clientId: makeId(), payload, settled: false };
}

export interface FactTitle {
  /** Fact kind in the UI language ("Allergie"). */
  kind: string;
  /** Display label, or null when it would only repeat the kind ("declared"). Patient-typed text is kept as written. */
  label: string | null;
}

/**
 * Display title of a medical fact for the owner's selection and the guest
 * view. Registry codes stored as labels become FR/AR names through
 * factDisplayLabel; unknown codes are shown, never guessed. Display only: the
 * stored fact and its selection ref are untouched.
 */
export function factTitle(fact: Pick<MedicalFact, "kind" | "code" | "label">, lang: Language): FactTitle {
  const kind = CARE_COPY[lang].factKind[fact.kind];
  const label = factDisplayLabel(fact, lang);
  return { kind, label: label === kind ? null : label };
}

export function canRevokeGrant(grant: Pick<ExternalVisitGrant, "state">): boolean {
  return grant.state === "pending" || grant.state === "active";
}
