import test from "node:test";
import assert from "node:assert/strict";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";
import { bumpPatientRevision, currentGuard, projectPatientRecord } from "../src/lib/patient-access-service";
import { CarePlanService } from "../src/lib/care-plan-service";
import { InterventionService } from "../src/lib/intervention-service";
import { AssistantService } from "../src/lib/assistant-service";
import { isActionCurrentlyApproved } from "../src/lib/protocol-service";
import { createDemoMonitoringProfiles } from "../src/lib/monitoring-evaluation";

const now = "2026-10-11T12:00:00.000Z";
function setup() {
  const store = fixtureStore();
  let at = now;
  store.transaction(s => {
    const action = { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} };
    s.carePlans.push({ id: "approval-plan", patientId: "fatma", revision: 1, state: "active", clinicianId: testDoctor.id, profileBindings: [], actionIds: ["approval-action"], reviewDeadline: null });
    s.careProposals.push({ id: "approval-proposal", patientId: "fatma", revision: 2, kind: "home_measurement", state: "approved", action, sources: [], guard: currentGuard(s, "fatma"), decision: { clinicianId: testDoctor.id, at: now, reason: "Explicit fictional approval" }, history: [] });
    s.careActions.push({ id: "approval-action", patientId: "fatma", planId: "approval-plan", revision: 1, proposalId: "approval-proposal", protocolId: null, originVersion: 2, action, dueAt: now, state: "pending", reportedAt: null, clientId: "approval-action", createdAt: now });
  });
  return { store, plans: new CarePlanService(store, () => at), advanceTo: (value: string) => { at = value; } };
}
test("live owner and clinician projections expose current approval without persisting read metadata", () => {
  const f = setup(); try {
    for (const actor of [testOwner, testDoctor]) {
      const action = f.plans.getPlan(actor, "fatma").actions[0];
      assert.equal(action.approval?.currentlyApproved, true);
      assert.deepEqual(action.approval?.reasons, []);
      assert.equal(action.approval?.checkedAt, now);
      assert.equal(projectPatientRecord(f.store.read(), actor, "fatma", now).actions[0].approval?.currentlyApproved, true);
    }
    assert.equal(Object.hasOwn(f.store.read().careActions[0], "approval"), false, "live approval is not an immutable stored decision");
    assert.equal(new AssistantService(f.store, () => now).respond(testOwner, "fatma", { kind: "record_query", topic: "next_action", clientId: "current" }).approvedActions[0].approval?.currentlyApproved, true);
  } finally { f.store.close(); }
});
test("an idempotent plan update recomputes approval at read time instead of replaying an expired approval", () => {
  const f = setup(); try {
    f.store.transaction(s => {
      s.monitoringProfiles = createDemoMonitoringProfiles(s.patients[0].rules);
      s.medicalFacts.push({ id: "hypertension", patientId: "fatma", kind: "condition", code: "hypertension", label: "Hypertension", value: null, polarity: "affirmed", verification: "patient_reported", sources: [], revision: 1, createdAt: now, supersededBy: null });
    });
    const profile = f.store.read().monitoringProfiles[0], deadline = "2026-10-11T12:01:00.000Z";
    const body = { action: "activate" as const, profileBindings: [{ conditionFactId: "hypertension", profileId: profile.id, profileVersion: profile.version }], expectedRevision: 1, clientId: "plan-replay", reviewDeadline: deadline };
    assert.equal(f.plans.updatePlan(testDoctor, "fatma", body).actions[0].approval?.currentlyApproved, true);
    f.advanceTo(deadline);
    const retried = f.plans.updatePlan(testDoctor, "fatma", body);
    assert.equal(retried.actions[0].approval?.currentlyApproved, false);
    assert.ok(retried.actions[0].approval?.reasons.includes("plan_review_overdue"));
    assert.equal(retried.actions[0].approval?.checkedAt, deadline);
    assert.equal(retried.plan?.revision, 2, "the original policy change remains idempotent");
  } finally { f.store.close(); }
});
test("a clinical message exposes reconfirmation even after review while the original decision remains intact", () => {
  const f = setup(); try {
    const before = f.store.read().careProposals[0].decision;
    const messages = new InterventionService(f.store, () => now);
    const message = messages.sendMessage(testOwner, "fatma", { text: "Fictional new clinical context", kind: "clinical", clinicianId: testDoctor.id, clientId: "new-context" });
    let projected = f.plans.getPlan(testOwner, "fatma").actions[0];
    assert.equal(projected.state, "pending");
    assert.equal(projected.approval?.currentlyApproved, false);
    assert.ok(projected.approval?.reasons.includes("unassessed_context"));
    assert.ok(projected.approval?.reasons.includes("changed_approved_context"));
    messages.reviewMessage(testDoctor, message.id, { expectedRevision: 1, expectedGuard: currentGuard(f.store.read(), "fatma"), reason: "Explicit review only", clientId: "review-context" });
    projected = f.plans.getPlan(testDoctor, "fatma").actions[0];
    assert.equal(projected.approval?.currentlyApproved, false);
    assert.ok(projected.approval?.reasons.includes("changed_approved_context"));
    assert.equal(projected.approval?.reasons.includes("unassessed_context"), false);
    assert.deepEqual(f.store.read().careProposals[0].decision, before);
    assert.equal(isActionCurrentlyApproved(f.store.read(), f.store.read().careActions[0], now), false);
  } finally { f.store.close(); }
});
test("unavailable authority and overdue plans are visible in owner action projections", () => {
  for (const change of ["authority", "deadline", "context"] as const) {
    const f = setup(); try {
      f.store.transaction(s => {
        if (change === "authority") s.careGrants[0].state = "revoked";
        if (change === "deadline") s.carePlans[0].reviewDeadline = now;
        if (change === "context") bumpPatientRevision(s, "fatma", "context");
      });
      const projected = projectPatientRecord(f.store.read(), testOwner, "fatma", now).actions[0];
      assert.equal(projected.approval?.currentlyApproved, false);
      assert.ok(projected.approval?.reasons.includes(change === "authority" ? "authority_unavailable" : change === "deadline" ? "plan_review_overdue" : "changed_approved_context"));
      assert.equal(projected.state, "pending");
    } finally { f.store.close(); }
  }
});
