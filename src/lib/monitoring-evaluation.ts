import { createHash } from "node:crypto";
import type { Alert, Measurement, Rules, Status } from "../contracts/care";
import type {
  ConditionEvaluation, ConditionEvaluationInput, Coverage, MonitoringProfile,
  MonitoringRequirement, MonitoringState, SourceRef,
} from "../contracts/monitoring";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Copies the existing demonstration policy; it never supplies new clinical thresholds. */
export function createDemoMonitoringProfiles(rules: Rules): MonitoringProfile[] {
  return ([
    { id: "demo_blood_pressure", conditionCodes: ["hypertension"], kind: "blood_pressure", label: "High blood pressure demonstration thresholds" },
    { id: "demo_glucose", conditionCodes: ["diabetes"], kind: "glucose", label: "High glucose demonstration thresholds" },
  ] as const).map(item => freeze<MonitoringProfile>({
    id: item.id, version: rules.version, demonstration: true,
    conditionCodes: [...item.conditionCodes], scopeLabel: item.label, rulePack: item.id,
    rules: { ...rules },
    requirements: [{ id: `${item.id}:reading`, kind: "measurement", measurementKind: item.kind,
      maxAgeSeconds: rules.overdueHours * 3600, admittedVerification: ["confirmed", "patient_reported", "simulated"] }],
    coverageLimits: [
      `Low ${item.kind === "blood_pressure" ? "blood pressure" : "glucose"} direction is not assessed.`,
      "The demonstration profile does not cover the whole condition or establish a diagnosis.",
    ],
  }));
}

function validRules(profile: MonitoringProfile): boolean {
  const r = profile.rules;
  const pairs = profile.rulePack === "demo_blood_pressure"
    ? [[r.systolicWarn, r.systolicHigh], [r.diastolicWarn, r.diastolicHigh]]
    : [[r.glucoseWarn, r.glucoseHigh]];
  return r.demonstration === true && pairs.every(([warn, high]) => Number.isFinite(warn) && Number.isFinite(high) && warn > 0 && high > warn)
    && (profile.rulePack !== "demo_glucose" || r.glucoseUnit === "mg/dL" || r.glucoseUnit === "mmol/L");
}

function classify(measurement: Measurement, profile: MonitoringProfile): { priority: Status; reasons: string[] } | null {
  const r = profile.rules;
  if (measurement.connector?.quality === "suspect") return null;
  let values: [string, number, number, number, string][];
  const reasons: string[] = [];
  switch (measurement.kind) {
    case "blood_pressure":
      if (profile.rulePack !== "demo_blood_pressure" || measurement.unit !== "mmHg"
        || !Number.isFinite(measurement.systolic) || !Number.isFinite(measurement.diastolic)
        || measurement.systolic <= measurement.diastolic || measurement.diastolic <= 0) return null;
      values = [["Systolic", measurement.systolic, r.systolicWarn, r.systolicHigh, "mmHg"], ["Diastolic", measurement.diastolic, r.diastolicWarn, r.diastolicHigh, "mmHg"]];
      break;
    case "glucose": {
      if (profile.rulePack !== "demo_glucose" || !["mg/dL", "mmol/L"].includes(measurement.unit)
        || !Number.isFinite(measurement.value) || measurement.value <= 0) return null;
      const value = measurement.unit === r.glucoseUnit ? measurement.value : measurement.unit === "mmol/L" ? measurement.value * 18 : measurement.value / 18;
      if (measurement.unit !== r.glucoseUnit) reasons.push(`Conversion: ${measurement.value} ${measurement.unit} = ${value} ${r.glucoseUnit} (factor 18).`);
      values = [["Glucose", value, r.glucoseWarn, r.glucoseHigh, r.glucoseUnit]];
      break;
    }
    case "pulse": return null;
    default: return null;
  }
  if (measurement.status === "unknown") return null;
  let priority: Status = "green";
  for (const [label, value, warn, high, unit] of values) {
    if (value >= high) { priority = "red"; reasons.push(`${label} ${value} ${unit} >= ${high} ${unit} (red; demo rule ${r.version}).`); }
    else if (value >= warn) { if (priority !== "red") priority = "orange"; reasons.push(`${label} ${value} ${unit} >= ${warn} ${unit} (orange; demo rule ${r.version}).`); }
  }
  if (priority === "green") reasons.push(`No high demonstration threshold crossed (demo rule ${r.version}); lower directions remain unassessed.`);
  return { priority, reasons };
}

/** Pure evaluation of one sourced condition against its exact approved demonstration policy. */
export function evaluateCondition(input: ConditionEvaluationInput, now: string): ConditionEvaluation {
  const { condition, profile, plan, evidence, guard } = input;
  const at = Date.parse(now);
  if (!Number.isFinite(at)) throw new Error("A valid evaluation timestamp is required.");
  const coverage: Coverage[] = [];
  const reasons: string[] = [];
  const sources: SourceRef[] = [];
  const usedMeasurements: Measurement[] = [];
  const deadlines: number[] = [];
  const outcome = { priority: "unknown" as Status };
  const finish = (): ConditionEvaluation => {
    const snapshot = {
      patientId: condition.patientId, conditionFactId: condition.id,
      profileId: profile?.id ?? null, profileVersion: profile?.version ?? null,
      priority: outcome.priority, coverage: unique(coverage), sources, reasons: unique(reasons),
      nextDueAt: deadlines.length ? new Date(Math.min(...deadlines)).toISOString() : null,
      guard: structuredClone(guard),
    };
    // Identity follows meaningful policy/evidence/coverage changes, never wall-clock polling alone.
    const fingerprint = canonical({ snapshot, condition, rules: profile?.rules ?? null, usedMeasurements });
    return structuredClone({ id: `evaluation-${createHash("sha256").update(fingerprint).digest("hex")}`, evaluatedAt: new Date(at).toISOString(), ...snapshot });
  };
  const block = (state: Coverage, reason: string) => { coverage.push(state); reasons.push(reason); return finish(); };
  if (condition.kind !== "condition" || condition.supersededBy !== null || condition.polarity !== "affirmed") {
    return block("contradictory", "The condition is absent, uncertain, negated, or superseded; no condition rule is selected.");
  }
  if (!["confirmed", "patient_reported", "simulated"].includes(condition.verification)) {
    return block("awaiting_verification", "The condition declaration is not admitted for demonstration monitoring.");
  }
  if (!profile || !condition.code || !profile.conditionCodes.includes(condition.code)) {
    return block("unsupported", "No admitted monitoring profile covers the recorded condition code.");
  }
  if (evidence.patientId !== condition.patientId || canonical(guard) !== canonical(evidence.guard)) {
    return block("contradictory", "The evidence snapshot belongs to another patient or has a changed revision guard.");
  }
  if (profile.demonstration !== true || !["demo_blood_pressure", "demo_glucose"].includes(profile.rulePack) || !validRules(profile)) {
    return block("unsupported", "The demonstration rule pack or its copied thresholds are invalid.");
  }
  const expectedKind = profile.rulePack === "demo_blood_pressure" ? "blood_pressure" : "glucose";
  if (!guard.profileVersions.includes(`${profile.id}:${profile.version}`)) {
    return block("contradictory", "The profile version differs from the guarded snapshot.");
  }
  if (!plan || plan.state !== "active" || !plan.clinicianId) {
    return block("missing", "No active clinician-approved monitoring plan is available.");
  }
  if (plan.patientId !== condition.patientId || plan.revision !== guard.carePlanRevision
    || !plan.profileBindings.some(binding => binding.conditionFactId === condition.id && binding.profileId === profile.id && binding.profileVersion === profile.version)) {
    return block("contradictory", "The plan revision or approved condition profile binding does not match the snapshot.");
  }
  // Both supported packs are high-only even if a caller omitted their coverage labels.
  coverage.push("unsupported");
  reasons.push(...profile.coverageLimits, `Low ${expectedKind === "blood_pressure" ? "blood pressure" : "glucose"} direction is not assessed by this high-only demonstration profile.`);
  if (plan.reviewDeadline) {
    const reviewAt = Date.parse(plan.reviewDeadline);
    if (!Number.isFinite(reviewAt)) { coverage.push("contradictory"); reasons.push("The plan review deadline is invalid."); }
    else if (reviewAt <= at) { coverage.push("stale"); reasons.push("The clinician plan review deadline has passed."); }
    else deadlines.push(reviewAt);
  }
  if (!profile.requirements.some(req => req.kind === "measurement" && req.measurementKind === expectedKind)) {
    coverage.push("missing"); reasons.push("The rule pack has no compatible measurement requirement.");
  }

  for (const requirement of profile.requirements) {
    evaluateRequirement(requirement);
  }
  if (outcome.priority === "green" && coverage.some(c => c !== "complete")) outcome.priority = "unknown";
  return finish();

  function evaluateRequirement(requirement: MonitoringRequirement): void {
    const label = `Requirement ${requirement.id}`;
    const gap = (state: Coverage, reason: string) => { coverage.push(state); reasons.push(`${label}: ${reason}`); };
    if (!Number.isFinite(requirement.maxAgeSeconds) || requirement.maxAgeSeconds <= 0 || requirement.admittedVerification.length === 0) {
      gap("unsupported", "freshness or admitted verification policy is invalid."); return;
    }
    const candidates = evidence.sources.filter(ref => ref.kind === requirement.kind && (
      requirement.kind !== "measurement" || evidence.measurements.some(m => m.id === ref.id && (!requirement.measurementKind || m.kind === requirement.measurementKind))
    ));
    const distinct = [...new Map(candidates.map(ref => [canonical(ref), ref])).values()];
    distinct.sort((a, b) => (Date.parse(b.date) - Date.parse(a.date)) || canonical(a).localeCompare(canonical(b)));
    const selected = distinct[0];
    if (!selected) { gap("missing", "no sourced evidence is available."); return; }
    if (distinct.some(ref => ref.kind === selected.kind && ref.id === selected.id && canonical(ref) !== canonical(selected))) {
      gap("contradictory", "conflicting source revisions or metadata refer to the same evidence."); return;
    }
    if (selected.polarity !== "affirmed") { gap("contradictory", "the evidence polarity is not affirmed."); return; }
    if (!requirement.admittedVerification.includes(selected.verification)) { gap("awaiting_verification", "the latest source has not reached the required verification."); return; }
    const date = Date.parse(selected.date);
    if (!Number.isFinite(date) || date > at) { gap("contradictory", "the source time is invalid or in the future."); return; }
    let measurement: Measurement | undefined;
    if (requirement.kind === "measurement") {
      const matches = evidence.measurements.filter(m => m.id === selected.id);
      measurement = matches[0];
      if (!measurement || matches.some(m => canonical(m) !== canonical(measurement)) || measurement.patientId !== condition.patientId
        || selected.revision !== 1 || Date.parse(measurement.measuredAt) !== date) {
        gap("contradictory", "the immutable reading and its source snapshot do not match."); return;
      }
      if (measurement.connector?.quality === "suspect" || measurement.status === "unknown") { gap("awaiting_verification", "the latest reading is suspect or unscored."); return; }
    }
    const deadline = date + requirement.maxAgeSeconds * 1000;
    if (!Number.isFinite(deadline) || deadline > 8.64e15) { gap("unsupported", "the freshness deadline is invalid."); return; }
    if (deadline <= at) { gap("stale", "the latest admitted evidence has expired."); return; }
    if (measurement) {
      const result = classify(measurement, profile!);
      if (!result) { gap("unsupported", "the measurement kind, unit, or numeric values are outside the rule pack."); return; }
      if (result.priority === "red" || (result.priority === "orange" && outcome.priority !== "red") || outcome.priority === "unknown") outcome.priority = result.priority;
      reasons.push(...result.reasons); usedMeasurements.push(measurement);
    }
    coverage.push("complete"); sources.push(structuredClone(selected)); deadlines.push(deadline);
  }
}

/** Coverage gates global green; an unresolved episode is never resolved by a later reading. */
export function aggregateMonitoring(evaluations: ConditionEvaluation[], unresolved: Alert[]): MonitoringState {
  const activeAlerts = unresolved.filter(alert => alert.status === "new" || alert.status === "acknowledged");
  const coverage = unique(evaluations.flatMap(evaluation => evaluation.coverage));
  const reasons = unique(evaluations.flatMap(evaluation => evaluation.reasons));
  let priority: Status = "unknown";
  if (evaluations.some(e => e.priority === "red") || activeAlerts.some(alert => alert.priority === "red")) priority = "red";
  else if (evaluations.some(e => e.priority === "orange") || activeAlerts.some(alert => alert.priority === "orange")) priority = "orange";
  else if (evaluations.length > 0 && evaluations.every(e => e.priority === "green" && e.coverage.length > 0 && e.coverage.every(c => c === "complete"))) priority = "green";
  if (!evaluations.length) { coverage.push("missing"); reasons.push("No current condition evaluations are available."); }
  if (activeAlerts.length) reasons.push("Unresolved alert episodes remain open until an explicit clinician decision.");
  if (priority === "unknown") reasons.push("Current complete coverage is required across every recorded condition before global green.");
  const timestamps = evaluations.map(e => Date.parse(e.evaluatedAt)).filter(Number.isFinite);
  return { priority, coverage: unique(coverage), reasons: unique(reasons), evaluatedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : "1970-01-01T00:00:00.000Z" };
}
