/**
 * Coverage display rules (spec 006 story 3, FR-008/009). The server computes
 * priorities; this module only refuses to show a reassuring green that the
 * coverage does not support. Orange and red always stay visible.
 */
import type { Status } from "@/contracts/care";
import type { ConditionEvaluation, Coverage, MedicalFact, MonitoringState } from "@/contracts/monitoring";
import { CARE_COPY } from "@/lib/client/copy/care";
import { displayableEvaluationTime } from "@/lib/client/copy/reasons";

export interface DisplayedPriority {
  status: Status;
  /** Some coverage is not complete (or none was reported). */
  incomplete: boolean;
}

/** Green needs complete coverage and an evaluating profile; anything less shows as unknown. */
export function displayPriority(priority: Status, coverage: readonly Coverage[], { profiled = true }: { profiled?: boolean } = {}): DisplayedPriority {
  const incomplete = !profiled || coverage.length === 0 || coverage.some((c) => c !== "complete");
  return { status: priority === "green" && incomplete ? "unknown" : priority, incomplete };
}

/** Current affirmed condition facts (corrections replace older versions). */
export function currentConditions(facts: readonly MedicalFact[]): MedicalFact[] {
  return facts.filter((f) => f.kind === "condition" && f.polarity === "affirmed" && !f.supersededBy);
}

/**
 * Recorded conditions with no evaluating profile (no evaluation, or no
 * profile id): their coverage is unknown. A profiled condition reporting an
 * "unsupported" limit is partial coverage, not "no profile".
 */
export function uncoveredConditions(facts: readonly MedicalFact[], evaluations: readonly ConditionEvaluation[]): MedicalFact[] {
  return currentConditions(facts).filter((fact) => {
    const evaluation = evaluations.find((e) => e.conditionFactId === fact.id);
    return !evaluation || evaluation.profileId === null;
  });
}

export const PARTIAL_COVERAGE_LABEL = CARE_COPY.fr.monitoring.partialCoverage;

/** Profiled, but some limits are not assessed (e.g. the demo BP profile's low direction): still incomplete. */
export function isPartialCoverage(evaluation: Pick<ConditionEvaluation, "profileId" | "coverage">): boolean {
  return evaluation.profileId !== null && evaluation.coverage.includes("unsupported");
}

export interface GlobalMonitoringView extends DisplayedPriority {
  /** False when the server reported no aggregate evaluation yet. */
  evaluated: boolean;
  uncovered: MedicalFact[];
}

/** Global green only with complete coverage everywhere and every recorded condition evaluated. */
export function globalMonitoringView(
  monitoring: MonitoringState | null,
  evaluations: readonly ConditionEvaluation[],
  facts: readonly MedicalFact[],
): GlobalMonitoringView {
  const uncovered = uncoveredConditions(facts, evaluations);
  if (!monitoring) return { status: "unknown", incomplete: true, evaluated: false, uncovered };
  // The server's epoch "never evaluated" sentinel is not an evaluation; an open orange/red still shows.
  const evaluated = displayableEvaluationTime(monitoring.evaluatedAt) !== null;
  const coverage = [...monitoring.coverage, ...evaluations.flatMap((e) => e.coverage)];
  const shown = displayPriority(monitoring.priority, monitoring.coverage.length === 0 ? [] : coverage);
  const incomplete = shown.incomplete || uncovered.length > 0 || !evaluated;
  return {
    status: monitoring.priority === "green" && incomplete ? "unknown" : shown.status,
    incomplete,
    evaluated,
    uncovered,
  };
}
