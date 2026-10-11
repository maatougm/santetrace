/**
 * Pure decisions behind "Mon dossier": which fact versions are current, the
 * correction history, the referent state and the fact form inputs. Corrections
 * append a new version; earlier versions stay reachable, never overwritten.
 */
import type { ExternalNote } from "@/contracts/external-visit";
import type { CarePlan, FactCorrection, FactInput, MedicalFact, PatientRevision, Polarity, Verification } from "@/contracts/monitoring";
import type { CareGrant } from "@/contracts/patient-platform";
import { factDisplayLabel } from "@/lib/client/copy/care";
import type { Language } from "@/lib/client/transport";

export const FACT_KINDS: readonly MedicalFact["kind"][] = ["condition", "symptom", "treatment", "allergy"];
export const POLARITIES: readonly Polarity[] = ["affirmed", "negated", "uncertain", "unknown"];

/** Server bounds (contracts/api.md: label <= 200, value <= 2000). Reason bound is a client cap. */
export const FACT_LIMITS = { label: 200, value: 2000, reason: 500 } as const;

const time = (iso: string) => {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
};

/** Current versions only (supersededBy === null), newest first. */
export function currentFacts(facts: readonly MedicalFact[]): MedicalFact[] {
  return facts.filter((fact) => fact.supersededBy === null).sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

export interface FactLine {
  id: string;
  /** Display label: never a raw registry code (factDisplayLabel). */
  label: string;
  polarity: Polarity;
  verification: Verification;
  revision: number;
  createdAt: string;
}

/** What the fact list, its history and the onboarding summary display, in the given order. */
export function factLines(facts: readonly MedicalFact[], lang: Language): FactLine[] {
  return facts.map((fact) => ({
    id: fact.id,
    label: factDisplayLabel(fact, lang),
    polarity: fact.polarity,
    verification: fact.verification,
    revision: fact.revision,
    createdAt: fact.createdAt,
  }));
}

/** Earlier versions this fact corrects, newest first (cycle-safe). */
export function previousVersions(facts: readonly MedicalFact[], fact: MedicalFact): MedicalFact[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const seen = new Set([fact.id]);
  const chain: MedicalFact[] = [];
  let previousId = fact.correction?.correctsFactId;
  while (previousId && !seen.has(previousId)) {
    const previous = byId.get(previousId);
    if (!previous) break;
    seen.add(previousId);
    chain.push(previous);
    previousId = previous.correction?.correctsFactId;
  }
  return chain;
}

/** Local echo of a saved fact until the next poll: upsert it and supersede what it corrects. */
export function applySavedFact(facts: readonly MedicalFact[], saved: MedicalFact): MedicalFact[] {
  const correctedId = saved.correction?.correctsFactId ?? null;
  const updated = facts
    .filter((fact) => fact.id !== saved.id)
    .map((fact) => (fact.id === correctedId && fact.supersededBy === null ? { ...fact, supersededBy: saved.id } : fact));
  return [...updated, saved];
}

/** External practitioners' notes, newest received first. Append-only: a correction is its own entry. */
export function sortExternalNotes(notes: readonly ExternalNote[]): ExternalNote[] {
  return [...notes].sort((a, b) => time(b.receivedAt) - time(a.receivedAt));
}

export type ReferentStatus = "active" | "none" | "unknown";

/**
 * Whether a referent doctor has ACCEPTED access. Grants are authoritative; the
 * plan state is only a fallback when grants could not be read.
 */
export function referentStatus(grants: readonly CareGrant[] | null, plan: CarePlan | null): ReferentStatus {
  if (grants) return grants.some((g) => g.relationship === "primary" && g.state === "active") ? "active" : "none";
  if (!plan || plan.state === "awaiting_clinician") return "none";
  return plan.state === "active" ? "active" : "unknown";
}

// ---------------------------------------------------------------------------
// Fact form
// ---------------------------------------------------------------------------

export interface FactDraft {
  kind: MedicalFact["kind"];
  label: string;
  value: string;
  /** Null until the patient picks an answer: none is pre-selected. */
  polarity: Polarity | null;
  reason: string;
}

export type FactDraftErrors = { label?: "required"; polarity?: "required"; reason?: "required" };

export function emptyFactDraft(): FactDraft {
  return { kind: "condition", label: "", value: "", polarity: null, reason: "" };
}

export function draftFromFact(fact: MedicalFact): FactDraft {
  return { kind: fact.kind, label: fact.label, value: fact.value ?? "", polarity: fact.polarity, reason: "" };
}

export function validateFactDraft(draft: FactDraft, mode: "add" | "correct"): FactDraftErrors {
  return {
    ...(draft.label.trim() ? {} : { label: "required" as const }),
    ...(draft.polarity ? {} : { polarity: "required" as const }),
    ...(mode === "correct" && !draft.reason.trim() ? { reason: "required" as const } : {}),
  };
}

export type ContextRevisionSource = { kind: "record"; contextRevision: number } | { kind: "fetch" };

/**
 * Where a fact save takes `expectedContextRevision` from: the live server
 * record's `revision` when it is present, readable and for this patient;
 * otherwise a fresh read (GET onboarding). The poll can lag: a 409 still reloads.
 */
export function contextRevisionSource(
  record: { patient: { id: string }; revision?: PatientRevision } | null,
  origin: "server" | "device" | null,
): ContextRevisionSource {
  const revision = record?.revision;
  if (origin !== "server" || !record || !revision || revision.patientId !== record.patient.id) return { kind: "fetch" };
  return Number.isFinite(revision.contextRevision) ? { kind: "record", contextRevision: revision.contextRevision } : { kind: "fetch" };
}

const orNull = (text: string) => (text.trim() ? text.trim() : null);

export function toFactInput(draft: FactDraft, expectedContextRevision: number, clientId: string): FactInput {
  return {
    kind: draft.kind,
    code: null,
    label: draft.label.trim(),
    value: orNull(draft.value),
    polarity: draft.polarity ?? "unknown",
    expectedContextRevision,
    clientId,
  };
}

/** A correction keeps the fact's kind and registry code; only the declaration changes. */
export function toFactCorrection(draft: FactDraft, fact: MedicalFact, expectedContextRevision: number, clientId: string): FactCorrection {
  return {
    ...toFactInput({ ...draft, kind: fact.kind }, expectedContextRevision, clientId),
    code: fact.code,
    expectedRevision: fact.revision,
    reason: draft.reason.trim(),
  };
}
