/**
 * Readable French for protocol bounds and predicates (clinician UI). Facts are
 * named from the visible record; an id the record does not carry is said to be
 * absent, never guessed.
 */
import type { MedicalFact, ProtocolPredicate } from "@/contracts/monitoring";
import { CARE_COPY } from "@/lib/client/copy/care";
import { factLabelById } from "./fact-labels";
import type { PredicateKind, PredicateListKey } from "./protocol-authorization";

export const PREDICATE_KIND_LABEL: Readonly<Record<PredicateKind, string>> = {
  priority_equals: "Priorité orange d’une maladie",
  evidence_fresh: "Fraîcheur d’une donnée de suivi",
  fact_equals: "Information du dossier",
  requirements_complete: "Exigences de suivi complètes",
};

export const PREDICATE_LIST_LABEL: Readonly<Record<PredicateListKey, { title: string; hint: string }>> = {
  predicates: {
    title: "Conditions requises",
    hint: "Toutes doivent être remplies au moment de l’application. Au moins une condition de fraîcheur des données.",
  },
  exclusions: {
    title: "Exclusions",
    hint: "Une seule exclusion vérifiée ou inconnue bloque la réutilisation et demande une revue.",
  },
  stopCriteria: {
    title: "Critères d’arrêt",
    hint: "Arrêtent le protocole lorsqu’ils sont remplis, en plus de la date de fin et du nombre maximal.",
  },
};

export function formatSeconds(seconds: number): string {
  if (seconds % 60 !== 0) return `${seconds} s`;
  if (seconds % 3_600 !== 0) return `${seconds / 60} min`;
  const hours = seconds / 3_600;
  return hours >= 24 && hours % 24 === 0 ? `${hours / 24} j (${hours} h)` : `${hours} h`;
}

function factName(facts: readonly MedicalFact[], id: string): string {
  return factLabelById(facts, id) ?? `information ${id} (absente du dossier visible)`;
}

export function describePredicate(predicate: ProtocolPredicate, facts: readonly MedicalFact[]): string {
  switch (predicate.kind) {
    case "priority_equals":
      return `Priorité « Suivi requis » (orange) pour : ${factName(facts, predicate.conditionFactId)}`;
    case "evidence_fresh":
      return `Donnée « ${predicate.requirementId} » datant de moins de ${formatSeconds(predicate.maxAgeSeconds)}`;
    case "fact_equals":
      return `« ${factName(facts, predicate.factId)} » : ${CARE_COPY.fr.polarity[predicate.polarity]}`;
    case "requirements_complete":
      return `Exigences de suivi complètes : ${predicate.requirementIds.join(", ")}`;
  }
}

/** Eligibility, delivery and live action-approval reason codes of the protocol service (protocol-service.ts). */
const PROTOCOL_REASON: Readonly<Record<string, string>> = {
  action_not_pending: "Action déjà déclarée ou annulée",
  invalid_action: "Action hors du registre approuvé",
  invalid_time: "Horodatage de vérification invalide",
  source_approval_unavailable: "La validation d’origine n’est plus disponible ou ne correspond plus à cette action",
  protocol_inactive: "Protocole non actif",
  consent_withdrawn: "Consentement du patient retiré",
  authority_unavailable: "Le médecin autorisant n’a plus les droits actuels",
  unassessed_context: "Un message clinique du patient attend une revue",
  plan_inactive: "Plan de suivi non actif ou géré par un autre médecin",
  plan_review_overdue: "Date de revue du plan dépassée",
  changed_approved_context: "Dossier, droits, plan ou profils modifiés depuis l’autorisation",
  changed_evidence: "Données modifiées pendant la vérification",
  changed_delivery_guard: "Dossier modifié avant la transmission",
  trigger_not_current: "La mesure déclenchante n’est plus la donnée actuelle",
  protocol_expired: "Protocole expiré",
  unresolved_red: "Épisode de priorité haute non résolu",
  missing_required_predicates: "Conditions obligatoires absentes du protocole",
  unknown_predicate: "Condition requise impossible à vérifier (donnée inconnue)",
  predicate_not_matched: "Condition requise non remplie",
  unknown_exclusion: "Exclusion impossible à vérifier (donnée inconnue)",
  exclusion_matched: "Exclusion présente",
  unknown_stop_criterion: "Critère d’arrêt impossible à vérifier (donnée inconnue)",
  stop_criterion_matched: "Critère d’arrêt atteint",
  application_limit: "Nombre maximal d’applications atteint",
  cooldown: "Intervalle minimal entre deux applications non écoulé",
};

/** French label of a reason code; an unknown code is shown as recorded and flagged untranslated. */
export function protocolReasonText(code: string): { text: string; translated: boolean } {
  return Object.hasOwn(PROTOCOL_REASON, code) ? { text: PROTOCOL_REASON[code], translated: true } : { text: code, translated: false };
}
