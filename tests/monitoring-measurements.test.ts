import assert from "node:assert/strict";
import test from "node:test";
import type { Measurement, Rules } from "../src/contracts/care";
import type { ConditionEvaluationInput } from "../src/contracts/monitoring";
import * as monitoring from "../src/lib/monitoring-evaluation";
const now = "2026-10-11T12:00:00.000Z";
const rules: Rules = { version: "demo-v1", demonstration: true, systolicWarn: 140, diastolicWarn: 90, systolicHigh: 160, diastolicHigh: 100, glucoseWarn: 180, glucoseHigh: 250, glucoseUnit: "mg/dL", overdueHours: 24 };
function evaluate(measurement: Measurement) {
  const profile = monitoring.createDemoMonitoringProfiles(rules).find(p => p.rulePack === "demo_glucose")!;
  const guard = { contextRevision: 1, evidenceRevision: 1, authorityRevision: 1, carePlanRevision: 1, profileVersions: [`${profile.id}:${profile.version}`] };
  const condition = { id: "diabetes", patientId: "p", kind: "condition" as const, code: "diabetes", label: "Diabetes", value: null, polarity: "affirmed" as const, verification: "patient_reported" as const, sources: [], revision: 1, createdAt: now, supersededBy: null };
  const input: ConditionEvaluationInput = { condition, profile, guard, plan: { id: "plan", patientId: "p", revision: 1, state: "active", clinicianId: "d", profileBindings: [{ conditionFactId: condition.id, profileId: profile.id, profileVersion: profile.version }], actionIds: [], reviewDeadline: null }, evidence: { patientId: "p", guard, sources: [{ kind: "measurement", id: measurement.id, revision: 1, contentHash: null, date: measurement.measuredAt, verification: "simulated", polarity: "affirmed" }], chunks: [], facts: [condition], measurements: [measurement], coverage: [] } }; return monitoring.evaluateCondition(input, now);
}
const common = { id: "reading", patientId: "p", measuredAt: now, capturedAt: now, receivedAt: now, clientId: "one", source: "device" as const, ruleVersion: "demo-v1", connector: { connectorId: "connector", deviceId: "device", externalEventId: "event", simulated: true, quality: "accepted" as const } };
test("unknown pulse stays bpm and never enters the glucose rule pack", () => {
  const pulse: Measurement = { ...common, kind: "pulse", value: 300, unit: "bpm", status: "unknown" };
  const frozen = structuredClone(pulse); const result = evaluate(pulse); assert.equal(result.priority, "unknown"); assert.ok(result.coverage.includes("missing")); assert.deepEqual(result.sources, []); assert.deepEqual(pulse, frozen);
});
test("glucose conversion uses admitted mg/dL or mmol/L units and explicit thresholds", () => {
  assert.equal(evaluate({ ...common, kind: "glucose", value: 10, unit: "mmol/L", status: "green" }).priority, "orange");
  assert.equal(evaluate({ ...common, kind: "glucose", value: 250, unit: "mg/dL", status: "green" }).priority, "red");
  assert.equal(evaluate({ ...common, kind: "glucose", value: 2, unit: "mmol/L", status: "green" }).priority, "unknown");
});
test("invalid units, nonfinite values and unknown scored readings do not produce safe glucose", () => {
  for (const invalid of [ { unit: "bpm", value: 300 }, { unit: "mg/dL", value: Number.NaN }, { unit: "mg/dL", value: 300, status: "unknown" } ]) {
    const reading = { ...common, kind: "glucose", status: "green", ...invalid } as unknown as Measurement;
    assert.equal(evaluate(reading).priority, "unknown");
  }
});
