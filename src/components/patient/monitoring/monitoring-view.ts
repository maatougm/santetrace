/**
 * Pure display decisions for the patient "Suivi" screen (feature 006).
 *
 * The server classifies; this module only refuses to make that look more
 * reassuring than it is: no global green without a green priority, complete
 * coverage everywhere, at least one evaluation and live data. Orange/red
 * evidence always stays visible, and an open red episode is read from alerts
 * only, so a later green measurement can never hide it.
 */
import type { Alert, Measurement, Status } from "@/contracts/care";
import type { ConditionEvaluation, Coverage, MedicalFact, MonitoringState } from "@/contracts/monitoring";
import type { ProjectedRecord } from "@/contracts/patient-platform";
import { DEMO_PROFILE_FOR_CONDITION } from "@/lib/client/care-api";
import { CARE_COPY, factDisplayLabel } from "@/lib/client/copy/care";
import { displayableEvaluationTime, reasonText } from "@/lib/client/copy/reasons";
import type { Language } from "@/lib/client/transport";

/**
 * Coverage as displayed. "partial" is a profiled evaluation whose server
 * coverage says "unsupported": the demo profile deliberately leaves some
 * limits unassessed (e.g. low blood pressure). It is a gap (never complete,
 * never green) but not "no profile"; "unsupported" keeps that meaning only.
 */
export type CoverageDisplay = Coverage | "partial";

/** Worst first, so the gap is read before the reassurance. */
export const COVERAGE_ORDER: readonly CoverageDisplay[] = [
  "unsupported",
  "contradictory",
  "missing",
  "stale",
  "awaiting_verification",
  "partial",
  "complete",
];

export function orderedCoverage(entries: readonly CoverageDisplay[]): CoverageDisplay[] {
  const present = new Set(entries);
  return COVERAGE_ORDER.filter((coverage) => present.has(coverage));
}

/** A profiled evaluation's "unsupported" is partial coverage; without a profile it stays "unsupported". */
export function evaluationCoverage(evaluation: Pick<ConditionEvaluation, "profileId" | "coverage">): CoverageDisplay[] {
  if (evaluation.profileId === null) return [...evaluation.coverage];
  return evaluation.coverage.map((coverage) => (coverage === "unsupported" ? "partial" : coverage));
}

const time = (iso: string | null | undefined): number => {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
};

// ---------------------------------------------------------------------------
// Red episode
// ---------------------------------------------------------------------------

export function isOpenAlert(alert: Pick<Alert, "status">): boolean {
  return alert.status === "new" || alert.status === "acknowledged";
}

/** Most recent red alert a clinician has not resolved or rejected. Measurements play no part. */
export function openRedAlert(alerts: readonly Alert[]): Alert | null {
  return alerts
    .filter((alert) => alert.priority === "red" && isOpenAlert(alert))
    .reduce<Alert | null>((latest, alert) => (!latest || time(alert.createdAt) > time(latest.createdAt) ? alert : latest), null);
}

export interface Announcement {
  /** True only the first time this episode id is seen. */
  announce: boolean;
  /** Last episode announced; kept across polls without data. */
  announcedId: string | null;
}

export function nextAnnouncement(previousId: string | null, openRedId: string | null): Announcement {
  if (openRedId === null) return { announce: false, announcedId: previousId };
  return { announce: openRedId !== previousId, announcedId: openRedId };
}

/**
 * "No accepted referent" is only claimed on live data for the owner. A device
 * copy carries no plan section, so it proves nothing about the referent.
 */
export function needsReferent(
  record: Pick<ProjectedRecord, "plan" | "access">,
  origin: "server" | "device" | null,
): boolean {
  if (origin !== "server" || !record.access.owner) return false;
  return record.plan === null || record.plan.state === "awaiting_clinician";
}

// ---------------------------------------------------------------------------
// Condition cards
// ---------------------------------------------------------------------------

export type ConditionCard =
  | {
      kind: "evaluated";
      fact: MedicalFact | null;
      evaluation: ConditionEvaluation;
      display: Status;
      /** Displayable evaluation time; null for the "never evaluated" sentinel. */
      evaluatedAt: string | null;
      /** Coverage to show: "unsupported" from a profiled evaluation reads "partial". */
      coverage: CoverageDisplay[];
    }
  | { kind: "unsupported"; fact: MedicalFact | null; evaluation: ConditionEvaluation | null }
  | { kind: "not_evaluated"; fact: MedicalFact };

/** Current affirmed conditions; "unknown"/"negated" answers are never a monitored condition. */
export function activeConditions(facts: readonly MedicalFact[]): MedicalFact[] {
  return facts.filter((fact) => fact.kind === "condition" && fact.polarity === "affirmed" && !fact.supersededBy);
}

/** A card is green only with complete coverage; a green over a gap reads as unknown. */
export function cardDisplayStatus(evaluation: Pick<ConditionEvaluation, "priority" | "coverage">): Status {
  if (evaluation.priority !== "green") return evaluation.priority;
  const complete = evaluation.coverage.length > 0 && evaluation.coverage.every((coverage) => coverage === "complete");
  return complete ? "green" : "unknown";
}

function latestEvaluationByFact(evaluations: readonly ConditionEvaluation[]): Map<string, ConditionEvaluation> {
  const byFact = new Map<string, ConditionEvaluation>();
  for (const evaluation of evaluations) {
    const current = byFact.get(evaluation.conditionFactId);
    if (!current || time(evaluation.evaluatedAt) > time(current.evaluatedAt)) byFact.set(evaluation.conditionFactId, evaluation);
  }
  return byFact;
}

function cardFor(fact: MedicalFact | null, evaluation: ConditionEvaluation): ConditionCard {
  return evaluation.profileId === null
    ? { kind: "unsupported", fact, evaluation }
    : {
        kind: "evaluated",
        fact,
        evaluation,
        display: cardDisplayStatus(evaluation),
        evaluatedAt: displayableEvaluationTime(evaluation.evaluatedAt),
        coverage: evaluationCoverage(evaluation),
      };
}

/**
 * One card per current condition, in record order, then any evaluation whose
 * fact is not in this projection. A condition without a demo profile is
 * unsupported; one with a profile but no evaluation yet is not evaluated.
 */
export function conditionCards(facts: readonly MedicalFact[], evaluations: readonly ConditionEvaluation[]): ConditionCard[] {
  const byFact = latestEvaluationByFact(evaluations);
  const conditions = activeConditions(facts);
  const known = new Set(conditions.map((fact) => fact.id));
  const fromFacts = conditions.map<ConditionCard>((fact) => {
    const evaluation = byFact.get(fact.id);
    if (evaluation) return cardFor(fact, evaluation);
    const hasProfile = fact.code !== null && Object.hasOwn(DEMO_PROFILE_FOR_CONDITION, fact.code);
    return hasProfile ? { kind: "not_evaluated", fact } : { kind: "unsupported", fact, evaluation: null };
  });
  const orphans = [...byFact.values()].filter((evaluation) => !known.has(evaluation.conditionFactId)).map((evaluation) => cardFor(null, evaluation));
  return [...fromFacts, ...orphans];
}

/**
 * Card title: known registry codes stored as labels become FR/AR names,
 * "declared" becomes the fact kind, typed labels stay as written, unknown
 * codes are shown as they are (never guessed).
 */
export function cardTitle(card: ConditionCard, lang: Language): string {
  return card.fact ? factDisplayLabel(card.fact, lang) : CARE_COPY[lang].factKind.condition;
}

// ---------------------------------------------------------------------------
// Global display
// ---------------------------------------------------------------------------

export interface GlobalDisplayInput {
  monitoring: MonitoringState | null;
  /** Server status of the patient record (open alerts included). */
  patientStatus: Status;
  cards: readonly ConditionCard[];
  openRed: boolean;
  /** Device copy or failing poll: a green cannot be vouched for. */
  stale: boolean;
}

export interface GlobalDisplay {
  status: Status;
  evaluatedAt: string | null;
  coverage: CoverageDisplay[];
  reasons: string[];
  hasEvaluation: boolean;
  /** Show "no global green while a follow-up is incomplete". */
  notGreen: boolean;
}

function cardCoverage(card: ConditionCard): CoverageDisplay[] {
  if (card.kind === "evaluated") return card.coverage;
  if (card.kind === "unsupported") return ["unsupported"];
  return [];
}

/**
 * Global coverage list. The aggregate's "unsupported" cannot say which
 * meaning it has; when the cards explain it (a profiled partial or a condition
 * without profile), the cards' entries are shown instead. Otherwise it stays,
 * conservatively, as "unsupported".
 */
function globalCoverage(monitoring: MonitoringState | null, cards: readonly ConditionCard[]): CoverageDisplay[] {
  const fromCards = cards.flatMap(cardCoverage);
  const explained = fromCards.some((entry) => entry === "unsupported" || entry === "partial");
  const aggregate = (monitoring?.coverage ?? []).filter((entry) => entry !== "unsupported" || !explained);
  return orderedCoverage([...aggregate, ...fromCards]);
}

function cardPriority(card: ConditionCard): Status | null {
  return card.kind === "evaluated" ? card.evaluation.priority : null;
}

export function globalMonitoringDisplay({ monitoring, patientStatus, cards, openRed, stale }: GlobalDisplayInput): GlobalDisplay {
  const evaluated = cards.filter((card): card is Extract<ConditionCard, { kind: "evaluated" }> => card.kind === "evaluated");
  // "partial" is never "complete": partial coverage keeps the green cap.
  const coverage = globalCoverage(monitoring, cards);
  const priorities = [monitoring?.priority ?? null, patientStatus, ...cards.map(cardPriority)];
  // The server sends the Unix epoch for "never evaluated": no time, and never a substitute time.
  const globalTime = monitoring ? displayableEvaluationTime(monitoring.evaluatedAt) : null;
  const complete =
    globalTime !== null &&
    evaluated.length > 0 &&
    evaluated.length === cards.length &&
    coverage.length > 0 &&
    coverage.every((entry) => entry === "complete");

  const status: Status =
    openRed || priorities.includes("red")
      ? "red"
      : priorities.includes("orange")
        ? "orange"
        : monitoring?.priority === "green" && complete && !stale
          ? "green"
          : "unknown";

  const hasEvaluation = globalTime !== null || evaluated.length > 0;
  const latestCard = evaluated.reduce<string | null>(
    (latest, card) => (card.evaluatedAt !== null && (latest === null || time(card.evaluatedAt) > time(latest)) ? card.evaluatedAt : latest),
    null,
  );
  return {
    status,
    evaluatedAt: monitoring ? globalTime : latestCard,
    coverage,
    reasons: monitoring?.reasons ?? [],
    hasEvaluation,
    notGreen: status === "unknown" && (hasEvaluation || cards.length > 0),
  };
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

export interface ReasonItem {
  key: string;
  text: string;
  /** False: the server's original (English) sentence, to be marked as such. */
  translated: boolean;
}

export function reasonItems(reasons: readonly string[], lang: Language): ReasonItem[] {
  return reasons.map((reason, index) => ({ key: `${index}-${reason}`, ...reasonText(reason, lang) }));
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

export type MeasurementBadge = { kind: "unscored" } | { kind: "status"; status: Status };

/** Pulse has no monitoring profile: its value is shown, never classified. */
export function measurementBadge(measurement: Measurement): MeasurementBadge {
  return measurement.kind === "pulse" ? { kind: "unscored" } : { kind: "status", status: measurement.status };
}

export function latestOfKind(measurements: readonly Measurement[], kind: Measurement["kind"]): Measurement | null {
  return measurements
    .filter((measurement) => measurement.kind === kind)
    .reduce<Measurement | null>((latest, m) => (!latest || time(m.measuredAt) > time(latest.measuredAt) ? m : latest), null);
}
