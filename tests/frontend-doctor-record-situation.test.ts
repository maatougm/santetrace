import assert from "node:assert/strict";
import test from "node:test";
import type { Alert } from "../src/lib/client/api";
import type { AccessEnvelope } from "../src/contracts/patient-platform";
import type { ConditionEvaluation, MedicalFact, MonitoringState } from "../src/contracts/monitoring";
import { priorityDisplay } from "../src/components/doctor/dashboard/queue";
import { recordSituationRow, type SituationSource } from "../src/components/doctor/record/situation";

const at = (hour: number) => new Date(Date.UTC(2026, 9, 11, hour)).toISOString();

const FULL_ACCESS: AccessEnvelope = {
  owner: false,
  relationship: "primary",
  scopes: ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"],
  grantId: "grant-1",
  grantRevision: 1,
  authorityRevision: 3,
  canManageCare: true,
  canReviewLabs: true,
};

const GUARD = { contextRevision: 1, evidenceRevision: 1, authorityRevision: 3, carePlanRevision: 1, profileVersions: [] };

const monitoring = (priority: MonitoringState["priority"], coverage: MonitoringState["coverage"] = ["complete"]): MonitoringState => ({
  priority,
  coverage,
  reasons: [],
  evaluatedAt: at(8),
});

function condition(id: string): MedicalFact {
  return {
    id,
    patientId: "p1",
    kind: "condition",
    code: id,
    label: id,
    value: null,
    polarity: "affirmed",
    verification: "confirmed",
    sources: [],
    revision: 1,
    createdAt: at(1),
    supersededBy: null,
  };
}

function evaluation(conditionFactId: string): ConditionEvaluation {
  return {
    id: `eval-${conditionFactId}`,
    patientId: "p1",
    conditionFactId,
    profileId: "demo-bp",
    profileVersion: "1",
    evaluatedAt: at(8),
    priority: "green",
    coverage: ["complete"],
    sources: [],
    reasons: [],
    nextDueAt: null,
    guard: GUARD,
  };
}

function alert(id: string, priority: Alert["priority"], status: Alert["status"]): Alert {
  return {
    id,
    patientId: "p1",
    status,
    priority,
    reason: "demo",
    ruleVersion: "demo-v1",
    rulesSnapshot: {
      version: "demo-v1",
      demonstration: true,
      systolicWarn: 140,
      diastolicWarn: 90,
      systolicHigh: 180,
      diastolicHigh: 110,
      glucoseWarn: 180,
      glucoseHigh: 300,
      glucoseUnit: "mg/dL",
      overdueHours: 48,
    },
    createdAt: at(6),
    history: [],
  };
}

function record(overrides: Partial<SituationSource> = {}): SituationSource {
  return {
    patient: {
      id: "p1",
      displayName: "Fatma Ben Ali",
      region: "Sfax",
      age: 54,
      language: "fr",
      fictional: true,
      consent: true,
      rules: null,
      status: "green",
      createdAt: at(1),
    },
    access: FULL_ACCESS,
    monitoring: monitoring("green"),
    alerts: [],
    evaluations: [evaluation("hta")],
    medicalFacts: [condition("hta")],
    ...overrides,
  };
}

test("the record shows a supported green as green", () => {
  const row = recordSituationRow(record());
  assert.equal(row.priority, "green");
  assert.equal(row.greenCap, null);
});

test("the record never shows a reassuring green without complete coverage or a dated evaluation", () => {
  const stale = recordSituationRow(record({ monitoring: monitoring("green", ["complete", "stale"]) }));
  assert.equal(stale.priority, "unknown");
  assert.equal(stale.greenCap, "coverage");
  const undated = recordSituationRow(record({ monitoring: { ...monitoring("green"), evaluatedAt: "1970-01-01T00:00:00.000Z" } }));
  assert.equal(undated.priority, "unknown");
  assert.equal(undated.greenCap, "not_evaluated");
  assert.equal(recordSituationRow(record({ monitoring: null })).priority, "unknown");
});

test("a recorded condition without an evaluating profile also blocks green in the record", () => {
  const row = recordSituationRow(record({ medicalFacts: [condition("hta"), condition("asthma")] }));
  assert.equal(row.priority, "unknown");
  assert.equal(row.greenCap, "coverage");
});

test("open alerts raise the record's displayed priority; closed ones do not", () => {
  assert.equal(recordSituationRow(record({ monitoring: monitoring("orange"), alerts: [alert("a", "red", "acknowledged")] })).priority, "red");
  assert.equal(recordSituationRow(record({ alerts: [alert("b", "orange", "new")] })).priority, "orange");
  assert.equal(recordSituationRow(record({ alerts: [alert("c", "red", "resolved")] })).priority, "green");
  assert.equal(recordSituationRow(record({ monitoring: monitoring("red"), medicalFacts: [] })).priority, "red", "never lowered");
});

test("a status the patient did not share is labelled as such, never as an evaluated state", () => {
  const row = recordSituationRow(record({ access: { ...FULL_ACCESS, scopes: ["measurements"] }, monitoring: null }));
  const display = priorityDisplay(row);
  assert.equal(display.monitoringShared, false);
  assert.equal(display.label, "Statut non partagé");
  assert.notEqual(display.status, "green");
});

test("recordSituationRow leaves the record untouched", () => {
  const source = Object.freeze(record({ medicalFacts: Object.freeze([condition("hta"), condition("asthma")]) as MedicalFact[] }));
  const before = JSON.stringify(source);
  recordSituationRow(source);
  assert.equal(JSON.stringify(source), before);
});
