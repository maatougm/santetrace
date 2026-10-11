/**
 * Experimental AI case attention estimate: pure view model for the record card
 * and the queue cell. Nothing here invents a number: a value is shown only
 * when the server genuinely returned a validated estimate for the record's
 * current revision. It is never a clinical probability, an urgency or a
 * treatment approval, and it never changes the queue order.
 */
import type { AiCaseScore, AiCaseScoreFailure, AiCaseScoreResponse, MedicalConsultationMeta } from "@/lib/client/doctor-api";
import type { AccessEnvelope, Measurement, PatientRecord } from "@/lib/client/api";
import type { RevisionGuard } from "@/contracts/monitoring";
import { formatMeasurement } from "@/lib/client/format";
import { measurementBadgeItems, type MeasurementBadge } from "../dashboard/queue";
import { factLabel } from "../care/fact-labels";

export const AI_SCORE_LABEL = "Estimation IA · à revoir";
export const AI_SCORE_NOT_COMPUTED = "Non calculé";
export const AI_SCORE_REQUEST = "Calculer l’estimation IA";

/**
 * Same rule as the server (manage capability): an active primary grant with
 * every scope. Owners, secondary clinicians and status-only access get no
 * display and no button.
 */
export function aiCaseScoreEligible(access: Pick<AccessEnvelope, "owner" | "relationship" | "canManageCare"> | null | undefined): boolean {
  return Boolean(access && !access.owner && access.relationship === "primary" && access.canManageCare === true);
}

/** The five revision counters the server compares (optional proposal/protocol revisions ignored). */
export function sameGuard(a: RevisionGuard, b: RevisionGuard): boolean {
  const versions = (guard: RevisionGuard) => [...guard.profileVersions].sort().join("|");
  return (
    a.contextRevision === b.contextRevision &&
    a.evidenceRevision === b.evidenceRevision &&
    a.authorityRevision === b.authorityRevision &&
    a.carePlanRevision === b.carePlanRevision &&
    versions(a) === versions(b)
  );
}

export const AI_SCORE_REASON_TEXT: Record<AiCaseScoreFailure, string> = {
  no_evidence: "Pas assez de données structurées (conditions déclarées et mesures admises) pour une estimation.",
  red_policy: "Non calculé : une alerte rouge est ouverte. L’urgence déterministe s’applique seule.",
  provider_unavailable: "Modèle IA indisponible pour le moment. Aucun chiffre de remplacement n’est affiché.",
  disabled: "Estimation IA désactivée sur ce serveur.",
  invalid_output: "Réponse du modèle rejetée (format ou sources invalides). Aucun chiffre n’est affiché.",
  abstained: "Le modèle s’est abstenu : données insuffisantes, contradictoires ou non évaluables.",
  stale_context: "Le dossier a changé pendant le calcul. Relancez sur la version à jour.",
  timeout: "Délai dépassé. Aucun chiffre n’est affiché ; vous pouvez réessayer.",
  aborted: "Calcul interrompu. Vous pouvez réessayer.",
  busy: "Le modèle est occupé. Réessayez dans un instant.",
};

/** Reasons for which another click cannot help until the situation changes. */
const BLOCKING: ReadonlySet<AiCaseScoreFailure> = new Set(["red_policy", "provider_unavailable", "disabled"]);

export function isBlockingFailure(reason: AiCaseScoreFailure | null): boolean {
  return reason !== null && BLOCKING.has(reason);
}

/** Stable key of a revision guard (null when the record carries none). */
export function guardKey(guard: RevisionGuard | null | undefined): string | null {
  if (!guard) return null;
  return [guard.contextRevision, guard.evidenceRevision, guard.authorityRevision, guard.carePlanRevision, [...guard.profileVersions].sort().join("|")].join(":");
}

export type AiScoreCardState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "busy" }
  | { kind: "score"; score: AiCaseScore; cached: boolean }
  /**
   * The record moved past the estimate's revision, or carries no revision at
   * all (fail closed): the number is withheld until the server confirms.
   */
  | { kind: "stale"; canRequest: true }
  /** `consultation` is present only when the failed/abstained response genuinely returned one. */
  | { kind: "absent"; message: string | null; outdated: boolean; canRequest: boolean; consultation?: MedicalConsultationMeta }
  | { kind: "error"; message: string; canRequest: boolean };

export interface AiScoreCardInput {
  eligible: boolean;
  /** Server denied the score read (403/404): show nothing. */
  denied: boolean;
  /** Last validated GET/POST payload kept by the shared poll (null before the first answer). */
  data: AiCaseScoreResponse | null;
  readError: string | null;
  /** Explicit POST in flight. */
  requesting: boolean;
  /** Failure reason of the last explicit POST (kept until the next click or a score). */
  requestFailure: AiCaseScoreFailure | null;
  /** Validated response-level consultation returned with that failure, if any. */
  requestConsultation?: MedicalConsultationMeta | null;
  requestError: string | null;
  /** The record's current revision guard (from the record poll). */
  recordGuard: RevisionGuard | null | undefined;
  /** An estimate was displayed earlier on this screen and no longer is. */
  hadScore: boolean;
}

type AbsentState = Extract<AiScoreCardState, { kind: "absent" }>;

/** Attaches the response-level consultation only when one was genuinely returned (no empty key). */
function withConsultation(state: Omit<AbsentState, "consultation">, consultation: MedicalConsultationMeta | null | undefined): AbsentState {
  return consultation ? { ...state, consultation } : state;
}

function absentFromRead(data: AiCaseScoreResponse, hadScore: boolean): AiScoreCardState {
  const reason = data.reason;
  // A GET without an estimate reports "no_evidence" even when nothing was ever requested: say "non calculé".
  if (reason && BLOCKING.has(reason)) {
    return withConsultation({ kind: "absent", message: AI_SCORE_REASON_TEXT[reason], outdated: false, canRequest: false }, data.consultation);
  }
  if (reason === "invalid_output") {
    return withConsultation({ kind: "absent", message: AI_SCORE_REASON_TEXT.invalid_output, outdated: false, canRequest: true }, data.consultation);
  }
  return withConsultation({ kind: "absent", message: null, outdated: hadScore, canRequest: true }, data.consultation);
}

export function aiScoreCardState(input: AiScoreCardInput): AiScoreCardState {
  if (!input.eligible || input.denied) return { kind: "hidden" };
  if (input.requesting) return { kind: "busy" };
  const score = input.data?.aiCaseScore ?? null;
  // A number is shown only when it matches the record's current revision; no revision means no number.
  const current = score !== null && input.recordGuard != null && sameGuard(score.guard, input.recordGuard);
  if (score && current) return { kind: "score", score, cached: input.data?.cached === true };
  // An explicit request's outcome is never hidden behind an older (stale) estimate.
  if (input.requestError) return { kind: "error", message: input.requestError, canRequest: true };
  if (input.requestFailure) {
    return withConsultation(
      { kind: "absent", message: AI_SCORE_REASON_TEXT[input.requestFailure], outdated: false, canRequest: !BLOCKING.has(input.requestFailure) },
      input.requestConsultation,
    );
  }
  if (score) return { kind: "stale", canRequest: true };
  if (!input.data) return input.readError ? { kind: "error", message: input.readError, canRequest: true } : { kind: "loading" };
  return absentFromRead(input.data, input.hadScore);
}

/** Known server limitation sentences, in French; anything else is shown verbatim and flagged. */
const LIMITATION_FR: Record<string, string> = {
  "Experimental AI estimation; doctor review required.": "Estimation IA expérimentale ; revue par le médecin obligatoire.",
  "Not a validated clinical risk probability, diagnosis, triage decision or treatment authorization.":
    "Ce n’est ni une probabilité de risque clinique validée, ni un diagnostic, ni une décision de tri, ni une autorisation de traitement.",
  "Uses a bounded redacted evidence subset; free-text symptoms, document prose and unverified candidates are excluded.":
    "Calculée sur un sous-ensemble limité et pseudonymisé du dossier ; symptômes en texte libre, textes de documents et valeurs non vérifiées exclus.",
  "Existing deterministic urgency and care approval rules remain authoritative.":
    "L’urgence déterministe et les règles d’approbation des soins restent seules décisionnelles.",
};

export function limitationText(text: string): { text: string; translated: boolean } {
  const fr = LIMITATION_FR[text.trim()];
  return fr ? { text: fr, translated: true } : { text, translated: false };
}

export type ScoreSourceItem =
  | { id: string; kind: "measurement"; label: string; at: string; badges: { key: MeasurementBadge; label: string }[] }
  | { id: string; kind: "fact"; label: string }
  | { id: string; kind: "unresolved" };

/**
 * Labels for the estimate's real source IDs, resolved only against records on
 * screen. An ID the visible record does not carry is shown as its raw ID,
 * never with a guessed label.
 */
export function scoreSourceItems(sourceIds: readonly string[], record: Pick<PatientRecord, "measurements" | "medicalFacts">): ScoreSourceItem[] {
  const measurements = new Map<string, Measurement>(record.measurements.map((m) => [m.id, m]));
  const facts = new Map(record.medicalFacts.map((fact) => [fact.id, fact]));
  return sourceIds.map((id): ScoreSourceItem => {
    const measurement = measurements.get(id);
    if (measurement) {
      return { id, kind: "measurement", label: formatMeasurement(measurement), at: measurement.measuredAt, badges: measurementBadgeItems(measurement) };
    }
    const fact = facts.get(id);
    return fact ? { id, kind: "fact", label: factLabel(fact) } : { id, kind: "unresolved" };
  });
}

export type QueueScoreView = { kind: "value"; value: number } | { kind: "none"; text: string };

/** Queue cell: a genuine current estimate only; otherwise an honest dash. Never used for ordering. */
export function queueScoreView(score: AiCaseScore | null, eligible: boolean): QueueScoreView {
  if (!eligible) return { kind: "none", text: "Non disponible pour votre accès" };
  return score ? { kind: "value", value: score.value } : { kind: "none", text: AI_SCORE_NOT_COMPUTED };
}
