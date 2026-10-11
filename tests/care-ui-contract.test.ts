import test from "node:test";
import assert from "node:assert/strict";
import { CarePlanService } from "../src/lib/care-plan-service";
import { buildAuthorizedEvidence } from "../src/lib/medical-evidence";
import { createDemoMonitoringProfiles } from "../src/lib/monitoring-evaluation";
import { currentGuard, projectPatientRecord } from "../src/lib/patient-access-service";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";

const now = "2026-10-11T12:00:00.000Z";

function setup() {
  const store = fixtureStore();
  store.transaction(state => {
    state.patientRevisions.find(r => r.patientId === "fatma")!.contextRevision = 2;
    state.patientRevisions.find(r => r.patientId === "fatma")!.evidenceRevision = 3;
    state.patientRevisions.find(r => r.patientId === "fatma")!.authorityRevision = 4;
    const profiles = createDemoMonitoringProfiles(state.patients.find(p => p.id === "fatma")!.rules);
    state.monitoringProfiles = profiles.map(profile => ({ ...profile, version: "current-policy", requirements: profile.requirements.map(requirement => ({ ...requirement, id: profile.id === "demo_blood_pressure" ? "bp-home-confirmed" : "glucose-current" })) }));
    state.monitoringProfiles.push({ ...state.monitoringProfiles[0], version: "obsolete-policy", requirements: [{ ...state.monitoringProfiles[0].requirements[0], id: "obsolete-requirement" }] });
    for (const [id, code, polarity] of [["hypertension", "hypertension", "affirmed"], ["diabetes", "diabetes", "negated"]] as const) {
      state.medicalFacts.push({ id, patientId: "fatma", kind: "condition", code, label: code, value: null, polarity, verification: "patient_reported", sources: [], revision: 1, createdAt: now, supersededBy: null });
    }
  });
  const service = new CarePlanService(store, () => now);
  const record = () => projectPatientRecord(store.read(), testDoctor, "fatma");
  const plan = () => service.getPlan(testDoctor, "fatma");
  return { store, service, record, plan };
}

test("primary receives a current guard before evaluation and fresh guards after approval and plan changes", () => {
  const { store, service, record, plan } = setup();
  try {
    const initial = { contextRevision: 2, evidenceRevision: 3, authorityRevision: 4, carePlanRevision: 0, profileVersions: [] };
    assert.deepEqual(record().guard, initial);
    assert.deepEqual(plan().guard, initial);
    assert.deepEqual(plan().evaluations, []);
    const evidence = buildAuthorizedEvidence(store.read(), testDoctor, "fatma");
    store.transaction(state => state.careProposals.push({ id: "home", patientId: "fatma", revision: 1, kind: "home_measurement", state: "needs_review", action: { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} }, sources: evidence.sources.filter(source => source.id === "hypertension" || source.kind === "reference"), guard: currentGuard(state, "fatma"), decision: null, history: [] }));
    const approved = service.reviewProposal(testDoctor, "home", { decision: "approve", expectedRevision: 1, expectedGuard: initial, reason: "Revue du dossier", clientId: "approved" });
    assert.deepEqual(plan().guard, { ...initial, carePlanRevision: 1 });
    const active = service.updatePlan(testDoctor, "fatma", { action: "activate", profileBindings: [{ conditionFactId: "hypertension", profileId: "demo_blood_pressure", profileVersion: "current-policy" }], expectedRevision: approved.plan!.revision, clientId: "activate" });
    const expected = { ...initial, carePlanRevision: 2, profileVersions: ["demo_blood_pressure:current-policy"] };
    assert.deepEqual(active.guard, expected);
    assert.deepEqual(record().guard, expected);
    assert.deepEqual(record().requirementIds, ["bp-home-confirmed"]);
    assert.deepEqual(active.requirementIds, ["bp-home-confirmed"]);
  } finally { store.close(); }
});

test("requirement metadata uses exact current bound versions and excludes unavailable, invalid and ambiguous bindings", () => {
  const { store, service, record, plan } = setup();
  try {
    const shell = plan().plan!;
    service.updatePlan(testDoctor, "fatma", { action: "activate", profileBindings: [{ conditionFactId: "hypertension", profileId: "demo_blood_pressure", profileVersion: "current-policy" }], expectedRevision: shell.revision, clientId: "activate" });
    assert.deepEqual(record().requirementIds, ["bp-home-confirmed"]);
    assert.deepEqual(plan().requirementIds, ["bp-home-confirmed"]);
    store.transaction(state => { state.monitoringProfiles = state.monitoringProfiles.filter(profile => profile.version !== "current-policy"); });
    assert.deepEqual(record().requirementIds, []);
    assert.deepEqual(plan().requirementIds, []);
    store.transaction(state => {
      const profile = state.monitoringProfiles[0];
      profile.version = "current-policy";
      profile.requirements = [{ ...profile.requirements[0], id: "shared-reading" }];
      state.monitoringProfiles.push({ ...profile, id: "alternate-bp" });
      state.carePlans[0].profileBindings.push({ conditionFactId: "hypertension", profileId: "alternate-bp", profileVersion: "current-policy" });
    });
    assert.deepEqual(record().requirementIds, [], "a duplicate name cannot select a requirement by coincidence");
    store.transaction(state => { state.carePlans[0].profileBindings.pop(); state.medicalFacts.find(fact => fact.id === "hypertension")!.supersededBy = "corrected"; });
    assert.deepEqual(plan().requirementIds, [], "a superseded condition does not establish a current binding");
  } finally { store.close(); }
});

test("owner and secondary readers never receive care-management guard or requirement metadata", () => {
  const { store, service, record, plan } = setup();
  try {
    const shell = plan().plan!;
    service.updatePlan(testDoctor, "fatma", { action: "activate", profileBindings: [{ conditionFactId: "hypertension", profileId: "demo_blood_pressure", profileVersion: "current-policy" }], expectedRevision: shell.revision, clientId: "activate" });
    assert.deepEqual(record().requirementIds, ["bp-home-confirmed"]);
    store.transaction(state => state.careGrants.push({ ...state.careGrants[0], id: "secondary-grant", clinicianId: "secondary", relationship: "specialist", scopes: ["clinical"] }));
    for (const [actor, fullSecondary] of [[testOwner, false], [{ ...testDoctor, id: "secondary" }, false], [{ ...testDoctor, id: "secondary" }, true]] as const) {
      if (fullSecondary) store.transaction(state => { state.careGrants.find(grant => grant.id === "secondary-grant")!.scopes = [...state.careGrants[0].scopes]; });
      const projected = projectPatientRecord(store.read(), actor, "fatma");
      const response = service.getPlan(actor, "fatma");
      assert.equal(Object.hasOwn(projected, "guard"), false);
      assert.equal(Object.hasOwn(projected, "requirementIds"), false);
      assert.equal(Object.hasOwn(response, "guard"), false);
      assert.equal(Object.hasOwn(response, "requirementIds"), false);
      assert.equal(projected.revision?.contextRevision, 2, "the existing scoped clinical revision remains available");
    }
  } finally { store.close(); }
});
