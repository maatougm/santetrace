import assert from "node:assert/strict";
import test from "node:test";
import type { Alert, Measurement, Rules } from "../src/contracts/care";
import type { ConditionEvaluation, ConditionEvaluationInput, MedicalFact, MonitoringProfile, RevisionGuard, SourceRef } from "../src/contracts/monitoring";

import * as monitoring from "../src/lib/monitoring-evaluation";
import { refreshMonitoring } from "../src/lib/care-service";
import { fixtureStore } from "./helpers/care-fixture";
const now = "2026-10-11T12:00:00.000Z";
const rules: Rules = { version: "demo-v1", demonstration: true, systolicWarn: 140, diastolicWarn: 90, systolicHigh: 160, diastolicHigh: 100, glucoseWarn: 180, glucoseHigh: 250, glucoseUnit: "mg/dL", overdueHours: 24 };
const guard: RevisionGuard = { contextRevision: 1, evidenceRevision: 2, authorityRevision: 3, carePlanRevision: 1, profileVersions: ["bp:v1"] };
function fact(overrides: Partial<MedicalFact> = {}): MedicalFact { return { id: "condition-bp", patientId: "p", kind: "condition", code: "hypertension", label: "Hypertension", value: null, polarity: "affirmed", verification: "patient_reported", sources: [], revision: 1, createdAt: now, supersededBy: null, ...overrides }; }
function reading(overrides: Partial<Measurement> = {}): Measurement { return { id: "bp-reading", patientId: "p", kind: "blood_pressure", systolic: 120, diastolic: 80, unit: "mmHg", measuredAt: now, capturedAt: now, receivedAt: now, clientId: "one", source: "app", status: "green", ruleVersion: rules.version, ...overrides } as Measurement; }
function source(measurement: Measurement, overrides: Partial<SourceRef> = {}): SourceRef { return { kind: "measurement", id: measurement.id, revision: 1, contentHash: null, date: measurement.measuredAt, verification: "patient_reported", polarity: "affirmed", ...overrides }; }
function profile(overrides: Partial<MonitoringProfile> = {}): MonitoringProfile { return { id: "bp", version: "v1", demonstration: true, conditionCodes: ["hypertension"], scopeLabel: "High BP only", rulePack: "demo_blood_pressure", rules: { ...rules }, requirements: [{ id: "bp-reading", kind: "measurement", measurementKind: "blood_pressure", maxAgeSeconds: 3600, admittedVerification: ["confirmed", "patient_reported", "simulated"] }], coverageLimits: ["Low blood pressure direction is not assessed."], ...overrides }; }
function input(measurements = [reading()], overrides: Partial<ConditionEvaluationInput> = {}): ConditionEvaluationInput { const condition = fact(); return { condition, profile: profile(), guard: structuredClone(guard), plan: { id: "plan", patientId: "p", revision: 1, state: "active", clinicianId: "doctor", profileBindings: [{ conditionFactId: condition.id, profileId: "bp", profileVersion: "v1" }], actionIds: [], reviewDeadline: null }, evidence: { patientId: "p", guard: structuredClone(guard), sources: measurements.map(m => source(m)), chunks: [], facts: [condition], measurements, coverage: [] }, ...overrides }; }
function evaluate(i = input(), at = now) { return monitoring.evaluateCondition(i, at); }
function redAlert(status: Alert["status"] = "new"): Alert { return { id: "episode", patientId: "p", measurementId: "old-red", priority: "red", status, reason: "Original red", ruleVersion: rules.version, rulesSnapshot: { ...rules }, createdAt: "2026-10-10T11:00:00.000Z", history: [] }; }

test("high-only BP keeps the low direction visible and cannot classify global green", () => {
  const result = evaluate(); assert.equal(result.priority, "unknown"); assert.ok(result.coverage.includes("complete")); assert.ok(result.coverage.includes("unsupported")); assert.match(result.reasons.join(" "), /low blood pressure/i); assert.equal(monitoring.aggregateMonitoring([result], []).priority, "unknown");
});
test("individual threshold crossings dominate without averages and survive partial coverage", () => {
  const i = input([reading({ systolic: 120, diastolic: 100 })]); i.profile!.requirements.push({ id: "labs", kind: "observation", maxAgeSeconds: 3600, admittedVerification: ["confirmed"] });
  const result = evaluate(i); assert.equal(result.priority, "red"); assert.ok(result.coverage.includes("missing")); assert.match(result.reasons.join(" "), /100.*100/);
});
test("exact orange and red thresholds use the frozen profile rather than stored status", () => {
  assert.equal(evaluate(input([reading({ systolic: 140, status: "green" })])).priority, "orange");
  assert.equal(evaluate(input([reading({ systolic: 160, status: "green" })])).priority, "red");
});
test("fresh BP cannot hide stale glucose or a condition without an admitted profile", () => {
  const bp = evaluate(); const g = reading({ id: "glucose", kind: "glucose", value: 100, unit: "mg/dL", measuredAt: "2026-10-11T10:00:00.000Z" });
  const i = input([g]); i.condition = fact({ id: "diabetes", code: "diabetes" }); i.profile = profile({ id: "g", rulePack: "demo_glucose", conditionCodes: ["diabetes"], requirements: [{ id: "glucose", kind: "measurement", measurementKind: "glucose", maxAgeSeconds: 3600, admittedVerification: ["patient_reported"] }] }); i.guard.profileVersions = ["g:v1"]; i.evidence.guard = structuredClone(i.guard); i.plan!.profileBindings = [{ conditionFactId: "diabetes", profileId: "g", profileVersion: "v1" }];
  const glucose = evaluate(i); assert.ok(glucose.coverage.includes("stale"));
  const unsupported = evaluate(input([], { condition: fact({ id: "asthma", code: "asthma" }), profile: null })); assert.ok(unsupported.coverage.includes("unsupported"));
  assert.equal(monitoring.aggregateMonitoring([bp, glucose, unsupported], []).priority, "unknown");
});
test("negated, uncertain, unknown, superseded or free-label conditions select no rule pack", () => {
  for (const condition of [fact({ polarity: "negated" }), fact({ polarity: "uncertain" }), fact({ polarity: "unknown" }), fact({ supersededBy: "new" }), fact({ code: null }), fact({ code: "asthma" }), fact({ kind: "symptom" })]) {
    const result = evaluate(input([reading({ systolic: 180 })], { condition })); assert.equal(result.priority, "unknown"); assert.ok(result.coverage.some(c => c !== "complete")); assert.deepEqual(result.sources, []);
  }
});
test("candidate and external unverified results never satisfy admitted laboratory coverage", () => {
  const i = input(); i.profile!.requirements.push({ id: "lab", kind: "observation", maxAgeSeconds: 3600, admittedVerification: ["confirmed"] });
  i.evidence.sources.push(source(reading({ id: "lab" }), { kind: "observation", verification: "candidate" }));
  const result = evaluate(i); assert.ok(result.coverage.includes("awaiting_verification")); assert.equal(result.sources.some(s => s.id === "lab"), false);
  i.evidence.sources.at(-1)!.verification = "external_unverified"; assert.ok(evaluate(i).coverage.includes("awaiting_verification"));
});
test("latest suspect measurement does not fall back to an earlier healthy reading", () => {
  const i = input([reading({ id: "older", measuredAt: "2026-10-11T11:59:00.000Z" }), reading({ id: "suspect", connector: { connectorId: "c", deviceId: "d", externalEventId: "e", simulated: false, quality: "suspect" }, systolic: 180 })]);
  const result = evaluate(i); assert.equal(result.priority, "unknown"); assert.ok(result.coverage.includes("awaiting_verification")); assert.deepEqual(result.sources, []);
});
test("source polarity, foreign patient, date mismatch and future time fail closed", () => {
  for (const mutate of [
    (i: ConditionEvaluationInput) => { i.evidence.sources[0].polarity = "negated"; },
    (i: ConditionEvaluationInput) => { i.evidence.measurements[0].patientId = "other"; },
    (i: ConditionEvaluationInput) => { i.evidence.sources[0].date = "2026-10-11T11:00:00.000Z"; },
    (i: ConditionEvaluationInput) => { i.evidence.measurements[0].measuredAt = "2026-10-12T12:00:00.000Z"; i.evidence.sources[0].date = i.evidence.measurements[0].measuredAt; },
  ]) { const i = input([reading({ systolic: 180 })]); mutate(i); const result = evaluate(i); assert.equal(result.priority, "unknown"); assert.ok(result.coverage.some(c => c !== "complete")); }
});
test("duplicate source references are deduplicated and conflicting revisions are contradictory", () => {
  const i = input([reading({ systolic: 180 })]); const one = evaluate(i); i.evidence.sources.push(structuredClone(i.evidence.sources[0])); assert.deepEqual(evaluate(i), one);
  i.evidence.sources.push({ ...i.evidence.sources[0], revision: 2 }); assert.equal(evaluate(i).priority, "unknown"); assert.ok(evaluate(i).coverage.includes("contradictory"));
});
test("changed snapshot guards and mismatched approved profile versions block evaluation", () => {
  for (const mutate of [
    (i: ConditionEvaluationInput) => { i.evidence.guard.evidenceRevision++; },
    (i: ConditionEvaluationInput) => { i.guard.carePlanRevision++; i.evidence.guard.carePlanRevision++; },
    (i: ConditionEvaluationInput) => { i.guard.profileVersions = ["bp:v0"]; i.evidence.guard.profileVersions = ["bp:v0"]; },
    (i: ConditionEvaluationInput) => { i.plan!.profileBindings[0].profileVersion = "v0"; },
  ]) { const i = input([reading({ systolic: 180 })]); mutate(i); assert.equal(evaluate(i).priority, "unknown"); }
});
test("freshness expires at the exact deadline and the deadline is recorded", () => {
  const i = input([reading({ measuredAt: "2026-10-11T11:00:00.000Z", systolic: 180 })]);
  assert.equal(evaluate(i, "2026-10-11T11:59:59.999Z").nextDueAt, now); assert.equal(evaluate(i).priority, "unknown"); assert.ok(evaluate(i).coverage.includes("stale"));
});
test("evaluation identity is stable within a freshness phase and snapshots cannot mutate history", () => {
  const i = input([reading({ systolic: 180 })]); const original = evaluate(i); const frozen = structuredClone(original);
  assert.equal(evaluate(i, "2026-10-11T12:00:01.000Z").id, original.id); assert.equal(evaluate(i).id, original.id);
  i.profile!.rules.systolicHigh = 200; i.guard.profileVersions.push("changed"); i.evidence.sources[0].revision = 9;
  assert.deepEqual(original, frozen);
  const corrected = input([reading({ id: "corrected", systolic: 180 })]); assert.notEqual(evaluate(corrected).id, original.id);
});
test("unresolved red episodes survive healthy readings while resolved/rejected episodes do not dominate", () => {
  const result = evaluate(); const old = redAlert(); const oldSnapshot = structuredClone(old);
  assert.equal(monitoring.aggregateMonitoring([result], [old]).priority, "red"); assert.equal(monitoring.aggregateMonitoring([result], [redAlert("acknowledged")]).priority, "red");
  assert.equal(monitoring.aggregateMonitoring([result], [redAlert("resolved"), redAlert("rejected")]).priority, "unknown"); assert.deepEqual(old, oldSnapshot);
});
test("red dominates orange and missing coverage while empty evaluations are unknown", () => {
  assert.equal(monitoring.aggregateMonitoring([evaluate(input([reading({ systolic: 180 })])), evaluate(input([reading({ systolic: 140 })]))], []).priority, "red");
  const uncovered = evaluate(input([], { profile: null })); assert.equal(monitoring.aggregateMonitoring([uncovered], [{ ...redAlert(), priority: "orange" }]).priority, "orange"); assert.equal(monitoring.aggregateMonitoring([], []).priority, "unknown");
});
test("only nonempty all-green evaluations with complete coverage produce global green", () => {
  const bounded: ConditionEvaluation = { ...evaluate(), priority: "green", coverage: ["complete"], reasons: [] };
  assert.equal(monitoring.aggregateMonitoring([bounded], []).priority, "green"); assert.equal(monitoring.aggregateMonitoring([{ ...bounded, coverage: [] }], []).priority, "unknown"); assert.equal(monitoring.aggregateMonitoring([bounded, { ...bounded, coverage: ["stale"] }], []).priority, "unknown");
});
test("immutable demo profile wrappers copy thresholds and declare limited scope", () => {
  const copy = { ...rules }; const profiles = monitoring.createDemoMonitoringProfiles(copy); assert.equal(profiles.length, 2);
  for (const p of profiles) { assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(p.rules)); assert.ok(Object.isFrozen(p.requirements)); assert.match(p.coverageLimits.join(" "), /low/i); assert.equal(p.requirements[0].maxAgeSeconds, 86400); }
  copy.systolicHigh = 220; assert.equal(profiles[0].rules.systolicHigh, 160);
});

test("a newer healthy reading supersedes the evaluation evidence while the red episode stays open", () => {
  const old = reading({ id: "red-reading", systolic: 180, measuredAt: "2026-10-11T11:59:00.000Z" });
  const recent = reading({ id: "recent", systolic: 120 });
  const result = evaluate(input([recent, old]));
  assert.equal(result.priority, "unknown"); assert.deepEqual(result.sources.map(s => s.id), ["recent"]);
  assert.equal(monitoring.aggregateMonitoring([result], [{ ...redAlert(), measurementId: old.id }]).priority, "red");
});

test("missing or suspended plans expose a coverage gap without creating approved monitoring", () => {
  for (const state of ["suspended", "revoked", "awaiting_clinician"] as const) {
    const i = input([reading({ systolic: 180 })]); i.plan!.state = state;
    assert.equal(evaluate(i).priority, "unknown"); assert.ok(evaluate(i).coverage.includes("missing"));
  }
  assert.ok(evaluate(input([], { plan: null })).coverage.includes("missing"));
});

test("a declared absent condition stays in the dossier without becoming a contradictory monitoring condition", () => {
  const store = fixtureStore();
  try {
    store.transaction(state => {
      state.medicalFacts.push(
        fact({ patientId: "fatma" }),
        fact({ id: "absent-diabetes", patientId: "fatma", code: "diabetes", polarity: "negated" }),
        fact({ id: "unknown-condition", patientId: "fatma", code: null, label: "Unknown declaration", polarity: "unknown" }),
        fact({ id: "uncertain-condition", patientId: "fatma", code: null, label: "Uncertain declaration", polarity: "uncertain" }),
      );
      const outcome = refreshMonitoring(state, "fatma", now);
      assert.equal(outcome.priority, "unknown");
    });
    const state = store.read();
    assert.deepEqual(state.conditionEvaluations.map(evaluation => evaluation.conditionFactId).sort(), ["condition-bp", "uncertain-condition", "unknown-condition"]);
    assert.equal(state.medicalFacts.find(item => item.id === "absent-diabetes")?.polarity, "negated");
    assert.equal(state.medicalFacts.length, 4);
    assert.ok(state.conditionEvaluations.filter(item => item.conditionFactId !== "condition-bp").every(item => item.priority === "unknown" && item.coverage.includes("contradictory")));
  } finally { store.close(); }
});

test("an unvalidated device reading cannot satisfy a clinician-confirmed measurement requirement", () => {
  const store = fixtureStore();
  try {
    store.transaction(state => {
      const condition = fact({ patientId: "fatma" });
      state.medicalFacts.push(condition);
      const selected = structuredClone(monitoring.createDemoMonitoringProfiles(state.patients.find(p => p.id === "fatma")!.rules)[0]);
      selected.id = "confirmed-only-bp";
      selected.requirements[0].admittedVerification = ["confirmed"];
      state.monitoringProfiles.push(selected);
      state.carePlans.push({ id: "device-test-plan", patientId: "fatma", revision: 1, state: "active", clinicianId: "demo-clinician", profileBindings: [{ conditionFactId: condition.id, profileId: selected.id, profileVersion: selected.version }], actionIds: [], reviewDeadline: null });
      state.measurements.push(reading({ patientId: "fatma", source: "device", systolic: 180, connector: { connectorId: "unvalidated", deviceId: "paired", externalEventId: "capture", simulated: false, quality: "accepted" } }));
      refreshMonitoring(state, "fatma", now);
    });
    const state = store.read(), result = state.conditionEvaluations[0];
    assert.equal(result.priority, "unknown");
    assert.ok(result.coverage.includes("awaiting_verification"));
    assert.deepEqual(result.sources, []);
    assert.equal(state.measurements[0].source, "device");
  } finally { store.close(); }
});
