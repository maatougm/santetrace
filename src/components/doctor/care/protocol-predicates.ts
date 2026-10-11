/**
 * Protocol predicates: raw form drafts and their validation into the closed
 * contract union. Facts must be this patient's current facts; a priority
 * condition must be bound to a profile of the active plan (server rule).
 */
import type { CarePlan, MedicalFact, Polarity, ProtocolPredicate } from "@/contracts/monitoring";

const HOUR_SECONDS = 3_600;
const REQUIREMENT_ID = /^[A-Za-z0-9_.:-]{1,150}$/;

/** Answers a fact predicate can check; "uncertain"/"unknown" are not checkable states. */
export const CHECKABLE_POLARITIES: readonly Polarity[] = ["affirmed", "negated"];

/** Server bound for evidence_fresh.maxAgeSeconds (not in PROTOCOL_FORM_LIMITS, which covers the protocol bounds). */
const SERVER_MAX_AGE_SECONDS = 604_800;

/** Input bounds for predicate fields; not clinical values. */
export const PREDICATE_LIMITS = {
  perListMax: 10,
  requirementIdsMax: 10,
  maxAgeHoursMin: 1,
  maxAgeHoursMax: SERVER_MAX_AGE_SECONDS / HOUR_SECONDS,
} as const;

export type PredicateKind = ProtocolPredicate["kind"];
export const PREDICATE_KINDS: readonly PredicateKind[] = ["priority_equals", "requirements_complete", "evidence_fresh", "fact_equals"];
export type PredicateListKey = "predicates" | "exclusions" | "stopCriteria";

/** Raw form values for one predicate (strings straight from the inputs). */
export type PredicateDraft =
  | { kind: "priority_equals"; conditionFactId: string }
  | { kind: "evidence_fresh"; requirementId: string; maxAgeHours: string }
  | { kind: "fact_equals"; factId: string; polarity: Polarity | "" }
  | { kind: "requirements_complete"; requirementIds: string };

export interface PredicateScope {
  patientId: string;
  facts: readonly MedicalFact[];
  plan: CarePlan | null;
  /** Requirement ids bound in the active plan; null when the server did not send them. */
  requirementIds: readonly string[] | null;
}

function unboundRequirement(scope: PredicateScope, ids: readonly string[]): string | null {
  if (!scope.requirementIds) return null;
  const unknown = ids.find((id) => !scope.requirementIds?.includes(id));
  return unknown ? `exigence « ${unknown} » inconnue du plan actif.` : null;
}

export function emptyPredicate(kind: PredicateKind): PredicateDraft {
  switch (kind) {
    case "priority_equals":
      return { kind, conditionFactId: "" };
    case "evidence_fresh":
      return { kind, requirementId: "", maxAgeHours: "" };
    case "fact_equals":
      return { kind, factId: "", polarity: "" };
    case "requirements_complete":
      return { kind, requirementIds: "" };
  }
}

export function parseBoundedInt(raw: string, min: number, max: number): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function parseRequirementIds(raw: string): string[] | null {
  const ids = [...new Set(raw.split(/[\s,;]+/).filter(Boolean))];
  if (ids.length === 0 || ids.length > PREDICATE_LIMITS.requirementIdsMax) return null;
  return ids.every((id) => REQUIREMENT_ID.test(id)) ? ids : null;
}

function currentFact(scope: PredicateScope, id: string): MedicalFact | undefined {
  return scope.facts.find((f) => f.id === id && f.patientId === scope.patientId && !f.supersededBy);
}

type PredicateCheck = { ok: true; value: ProtocolPredicate } | { ok: false; error: string };

function checkPredicate(draft: PredicateDraft, scope: PredicateScope): PredicateCheck {
  switch (draft.kind) {
    case "priority_equals": {
      const fact = currentFact(scope, draft.conditionFactId);
      if (!fact || fact.kind !== "condition" || fact.polarity !== "affirmed") return { ok: false, error: "choisissez une maladie enregistrée de ce patient." };
      if (!scope.plan?.profileBindings.some((b) => b.conditionFactId === fact.id)) {
        return { ok: false, error: "cette maladie n’est liée à aucun profil du plan actif." };
      }
      return { ok: true, value: { kind: draft.kind, conditionFactId: fact.id, value: "orange" } };
    }
    case "evidence_fresh": {
      if (!REQUIREMENT_ID.test(draft.requirementId.trim())) return { ok: false, error: "indiquez l’identifiant de l’exigence de suivi." };
      const unbound = unboundRequirement(scope, [draft.requirementId.trim()]);
      if (unbound) return { ok: false, error: unbound };
      const hours = parseBoundedInt(draft.maxAgeHours, PREDICATE_LIMITS.maxAgeHoursMin, PREDICATE_LIMITS.maxAgeHoursMax);
      if (hours === null) {
        return { ok: false, error: `âge maximal entre ${PREDICATE_LIMITS.maxAgeHoursMin} et ${PREDICATE_LIMITS.maxAgeHoursMax} heures (nombre entier).` };
      }
      return { ok: true, value: { kind: draft.kind, requirementId: draft.requirementId.trim(), maxAgeSeconds: hours * HOUR_SECONDS } };
    }
    case "fact_equals": {
      const fact = currentFact(scope, draft.factId);
      if (!fact) return { ok: false, error: "choisissez une information actuelle du dossier de ce patient." };
      if (!CHECKABLE_POLARITIES.includes(draft.polarity as Polarity)) return { ok: false, error: "choisissez « Oui » ou « Non »." };
      return { ok: true, value: { kind: draft.kind, factId: fact.id, polarity: draft.polarity as Polarity } };
    }
    case "requirements_complete": {
      const ids = parseRequirementIds(draft.requirementIds);
      if (!ids) return { ok: false, error: `indiquez 1 à ${PREDICATE_LIMITS.requirementIdsMax} identifiants d’exigence valides.` };
      const unbound = unboundRequirement(scope, ids);
      if (unbound) return { ok: false, error: unbound };
      return { ok: true, value: { kind: draft.kind, requirementIds: ids } };
    }
    default:
      return { ok: false, error: "type de condition inconnu (liste fermée)." };
  }
}

export function checkPredicateList(drafts: readonly PredicateDraft[], scope: PredicateScope): { value: ProtocolPredicate[]; error: string | null } {
  if (drafts.length > PREDICATE_LIMITS.perListMax) return { value: [], error: `${PREDICATE_LIMITS.perListMax} éléments au maximum.` };
  const checks = drafts.map((draft) => checkPredicate(draft, scope));
  const failure = checks.findIndex((check) => !check.ok);
  if (failure >= 0) {
    const check = checks[failure];
    return { value: [], error: `Élément ${failure + 1} : ${check.ok ? "" : check.error}` };
  }
  return { value: checks.flatMap((check) => (check.ok ? [check.value] : [])), error: null };
}

/** Required predicates (server rule): an orange priority and complete evidence requirements. */
export function missingRequiredPredicate(predicates: readonly ProtocolPredicate[]): string | null {
  const priority = predicates.some((p) => p.kind === "priority_equals");
  const requirements = predicates.some((p) => p.kind === "requirements_complete");
  if (priority && requirements) return null;
  return "Ajoutez au moins une condition « Priorité orange d’une maladie » et une condition « Exigences de suivi complètes » (fraîcheur des données).";
}

export function predicateToDraft(predicate: ProtocolPredicate): PredicateDraft {
  switch (predicate.kind) {
    case "priority_equals":
      return { kind: predicate.kind, conditionFactId: predicate.conditionFactId };
    case "evidence_fresh":
      // Hour inputs only: a non-hour value is left blank to be re-entered, never silently widened.
      return {
        kind: predicate.kind,
        requirementId: predicate.requirementId,
        maxAgeHours: predicate.maxAgeSeconds % HOUR_SECONDS === 0 ? String(predicate.maxAgeSeconds / HOUR_SECONDS) : "",
      };
    case "fact_equals":
      return { kind: predicate.kind, factId: predicate.factId, polarity: predicate.polarity };
    case "requirements_complete":
      return { kind: predicate.kind, requirementIds: predicate.requirementIds.join(", ") };
  }
}
