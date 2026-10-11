import assert from "node:assert/strict";
import test from "node:test";
import { fromOfflineRecord, toOfflineRecord } from "../src/lib/client/offline-record";

const patient = {
  id: "p1",
  displayName: "Amina (fictive)",
  region: "Sfax",
  age: 54,
  language: "fr",
  fictional: true,
  consent: true,
  status: "unknown",
  createdAt: "2026-10-11T08:00:00.000Z",
  rules: { version: "demo-1" },
};

const action = {
  id: "a1",
  patientId: "p1",
  planId: "plan1",
  revision: 1,
  proposalId: "prop1",
  protocolId: null,
  originVersion: 1,
  action: { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} },
  dueAt: "2026-10-12T08:00:00.000Z",
  state: "pending",
  reportedAt: null,
  clientId: "c1",
  createdAt: "2026-10-11T08:00:00.000Z",
};

function ownerRecord(overrides: Record<string, unknown> = {}) {
  return {
    patient,
    measurements: [{ id: "m1" }],
    alerts: [],
    reminders: [{ id: "r1" }],
    documents: [],
    candidates: [],
    observations: [],
    access: { owner: true, relationship: null, scopes: [], grantId: null, grantRevision: null, authorityRevision: 3, canManageCare: false, canReviewLabs: false },
    medicalFacts: [{ id: "f1", label: "Hypertension déclarée" }],
    plan: { id: "plan1", state: "active" },
    actions: [action, { ...action, id: "a2", state: "cancelled" }],
    evaluations: [{ id: "e1" }],
    monitoring: { priority: "orange", coverage: ["stale"], reasons: [], evaluatedAt: "x" },
    proposals: [{ id: "prop2", revision: 1, kind: "lab_exam", state: "pending" }],
    ...overrides,
  };
}

test("the device copy keeps only the owner allowlist: no facts, proposals, plan policy, evaluations, monitoring or access", () => {
  const copy = toOfflineRecord(ownerRecord());
  assert.ok(copy);
  assert.deepEqual(Object.keys(copy).sort(), ["actions", "alerts", "candidates", "documents", "measurements", "observations", "patient", "reminders"]);
  const serialised = JSON.stringify(copy);
  for (const forbidden of ["medicalFacts", "Hypertension déclarée", "lab_exam", "prop2", "evaluations", "monitoring", "authorityRevision"]) {
    assert.equal(serialised.includes(forbidden), false, `${forbidden} must not reach the device`);
  }
});

test("external practitioner notes never reach the device copy", () => {
  const note = { id: "n1", declaredName: "Dr Externe (déclaré)", text: "Note de consultation fictive", verification: "external_unverified" };
  const copy = toOfflineRecord(ownerRecord({ externalNotes: [note] }));
  assert.ok(copy);
  const serialised = JSON.stringify(copy);
  assert.equal(serialised.includes("externalNotes"), false);
  assert.equal(serialised.includes("Note de consultation fictive"), false);
  assert.equal(fromOfflineRecord(copy).externalNotes, undefined);
});

test("only approved fixed actions are kept offline (cancelled or malformed actions are dropped)", () => {
  const copy = toOfflineRecord(ownerRecord({ actions: [action, { ...action, id: "a2", state: "cancelled" }, { id: "bad" }] }));
  assert.deepEqual(copy?.actions.map((a) => a.id), ["a1"]);
});

test("live approval metadata is never cached: an offline action cannot claim it is still approved", () => {
  const live = { ...action, approval: { currentlyApproved: true, reasons: [], checkedAt: "2026-10-11T08:00:00.000Z" } };
  const copy = toOfflineRecord(ownerRecord({ actions: [live] }));
  assert.ok(copy);
  assert.equal(copy.actions.length, 1);
  assert.equal("approval" in copy.actions[0], false);
});

test("a clinician (non-owner) projection is never written to the device", () => {
  const doctorView = ownerRecord({ access: { ...ownerRecord().access, owner: false, relationship: "primary" } });
  assert.equal(toOfflineRecord(doctorView), null);
});

test("an older full copy (pre-006, no access envelope) is re-sanitised on read", () => {
  const legacy = { ...ownerRecord(), access: undefined, medicalFacts: [{ id: "leak" }], proposals: [{ id: "leak2" }] };
  const copy = toOfflineRecord(legacy);
  assert.ok(copy);
  assert.equal(JSON.stringify(copy).includes("leak"), false);
});

test("expanding a device copy marks 006 sections empty, not 'none', and carries no known authority revision", () => {
  const copy = toOfflineRecord(ownerRecord());
  assert.ok(copy);
  const view = fromOfflineRecord(copy);
  assert.deepEqual(view.medicalFacts, []);
  assert.deepEqual(view.proposals, []);
  assert.equal(view.plan, null);
  assert.equal(view.monitoring, null);
  assert.equal(view.access.owner, true);
  assert.equal(view.access.authorityRevision, -1);
  assert.deepEqual(view.access.scopes, []);
  assert.equal(view.actions.length, 1);
});

test("the input record is not mutated", () => {
  const record = Object.freeze(ownerRecord());
  toOfflineRecord(record);
  assert.equal(record.medicalFacts.length, 1);
});
