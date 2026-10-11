/**
 * Provisional, device-only evaluation used ONLY while a measurement is queued.
 * Mirrors the server comparator in src/lib/care-service.ts (evaluateMeasurement):
 * value >= high -> red, value >= warn -> orange, otherwise green; glucose is
 * converted between mg/dL and mmol/L with factor 18 when units differ.
 * The server evaluation always prevails once the measurement is received.
 */
import type { EvaluatedStatus, Rules } from "@/lib/client/api";
import type { LocalEvaluation, MeasurementDraft } from "@/lib/client/outbox";

export const GLUCOSE_CONVERSION_FACTOR = 18;

function level(value: number, warn: number, high: number): EvaluatedStatus {
  if (value >= high) return "red";
  if (value >= warn) return "orange";
  return "green";
}

const RANK: Record<EvaluatedStatus, number> = { green: 0, orange: 1, red: 2 };

function worst(a: EvaluatedStatus, b: EvaluatedStatus): EvaluatedStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

export function evaluateLocally(draft: MeasurementDraft, rules: Rules, rulesSavedAt: string | null): LocalEvaluation {
  const usedRules: LocalEvaluation["rules"] = {
    systolicWarn: rules.systolicWarn,
    diastolicWarn: rules.diastolicWarn,
    systolicHigh: rules.systolicHigh,
    diastolicHigh: rules.diastolicHigh,
    glucoseWarn: rules.glucoseWarn,
    glucoseHigh: rules.glucoseHigh,
    glucoseUnit: rules.glucoseUnit,
  };
  const base = { ruleVersion: rules.version, rulesSavedAt, rules: usedRules };

  if (draft.kind === "blood_pressure") {
    const status = worst(
      level(draft.systolic, rules.systolicWarn, rules.systolicHigh),
      level(draft.diastolic, rules.diastolicWarn, rules.diastolicHigh),
    );
    return { ...base, status, conversion: null };
  }

  if (draft.unit === rules.glucoseUnit) {
    return { ...base, status: level(draft.value, rules.glucoseWarn, rules.glucoseHigh), conversion: null };
  }
  const converted =
    draft.unit === "mmol/L" ? draft.value * GLUCOSE_CONVERSION_FACTOR : draft.value / GLUCOSE_CONVERSION_FACTOR;
  return {
    ...base,
    status: level(converted, rules.glucoseWarn, rules.glucoseHigh),
    conversion: {
      fromValue: draft.value,
      fromUnit: draft.unit,
      toValue: converted,
      toUnit: rules.glucoseUnit,
      factor: GLUCOSE_CONVERSION_FACTOR,
    },
  };
}
