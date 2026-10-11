import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureStore, testDoctor } from "./helpers/care-fixture";
import { createDemoMonitoringProfiles } from "../src/lib/monitoring-evaluation";
import { bumpPatientRevision, currentGuard } from "../src/lib/patient-access-service";
import { buildAuthorizedEvidence } from "../src/lib/medical-evidence";
import { ingestReading } from "../src/lib/care-service";
import { ProtocolService } from "../src/lib/protocol-service";
import * as module from "../src/lib/monitoring-worker";
const now = "2026-10-11T12:00:00.000Z";
function setup(path = ":memory:") {
  assert.equal(typeof module.MonitoringWorker, "function", "independent monitoring worker must exist");
  const store = fixtureStore(path);
  store.transaction(s => {
    s.monitoringProfiles = createDemoMonitoringProfiles(s.patients[0].rules);
    s.medicalFacts.push({ id: "hypertension", patientId: "fatma", kind: "condition", code: "hypertension", label: "Hypertension", value: null, polarity: "affirmed", verification: "patient_reported", sources: [], revision: 1, createdAt: now, supersededBy: null });
    s.carePlans.push({ id: "plan", patientId: "fatma", revision: 1, state: "active", clinicianId: testDoctor.id, profileBindings: [{ conditionFactId: "hypertension", profileId: s.monitoringProfiles[0].id, profileVersion: s.monitoringProfiles[0].version }], actionIds: ["action"], reviewDeadline: null });
    ingestReading(s, "fatma", { kind: "blood_pressure", systolic: 145, diastolic: 92, unit: "mmHg", measuredAt: now, clientId: "measurement" }, "app", undefined, now);
    const action = { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} };
    s.careProposals.push({ id: "proposal", patientId: "fatma", revision: 2, kind: "home_measurement", state: "approved", action, sources: buildAuthorizedEvidence(s, testDoctor, "fatma").sources.filter(r => r.id === "hypertension" || r.kind === "reference"), guard: currentGuard(s, "fatma"), decision: { clinicianId: testDoctor.id, at: now, reason: "Revue" }, history: [] });
    s.careActions.push({ id: "action", patientId: "fatma", planId: "plan", revision: 1, proposalId: "proposal", protocolId: null, originVersion: 2, action, dueAt: now, state: "pending", reportedAt: null, clientId: "action", createdAt: now });
  });
  return { store, worker: new module.MonitoringWorker(store) };
}
test("without a browser a tick refreshes monitoring, inserts attributed reminder and publishes heartbeat", async () => {
  const f = setup(); try {
    const result = await f.worker.tick(now, "worker-a"); assert.ok(result.completed > 0); assert.equal(result.failed, 0); assert.equal(result.heartbeatAt, now);
    assert.equal(f.store.read().workerHeartbeats["worker-a"], now); assert.equal(f.store.read().reminders.length, 1);
    assert.equal(f.store.read().reminders[0].origin?.actionId, "action"); assert.equal(f.store.read().reminders[0].delivery, "sent");
    await f.worker.tick(now, "worker-a"); assert.equal(f.store.read().reminders.length, 1);
  } finally { f.store.close(); }
});
test("competing workers recover an expired lease and each phase is committed only once", async () => {
  const f = setup(); try {
    f.store.transaction(s => s.dueTasks.push({ id: "expired", patientId: "fatma", kind: "remind", phaseKey: "action:action:initial", dueAt: now, attempts: 1, state: "claimed", leaseOwner: "dead", leaseUntil: "2026-10-11T11:59:00.000Z", guard: currentGuard(s, "fatma"), resourceId: "action" }));
    await Promise.all([f.worker.tick(now, "worker-a"), new module.MonitoringWorker(f.store).tick(now, "worker-b")]);
    const task = f.store.read().dueTasks.find(t => t.id === "expired")!; assert.equal(task.state, "completed"); assert.equal(task.attempts, 2); assert.equal(task.leaseOwner, null); assert.equal(f.store.read().reminders.length, 1);
  } finally { f.store.close(); }
});
test("revocation during an async lease cancels task and prevents in-app delivery", async () => {
  const f = setup(); try {
    let changed = false;
    const worker = new module.MonitoringWorker(f.store, { beforeCommit: async () => { if (!changed) { changed = true; f.store.transaction(s => { s.patients[0].consent = false; bumpPatientRevision(s, "fatma", "authority"); }); } } });
    await worker.tick(now, "held"); assert.equal(f.store.read().reminders.length, 0); assert.equal(f.store.read().messages.length, 0); assert.ok(f.store.read().dueTasks.some(t => t.state === "cancelled"));
  } finally { f.store.close(); }
});
test("a lost lease cannot commit after a second worker recovered it", async () => {
  const f = setup(); try {
    let entered!: () => void, release!: () => void;
    const hold = new Promise<void>(r => release = r), claimed = new Promise<void>(r => entered = r); let once = true;
    const slow = new module.MonitoringWorker(f.store, { beforeCommit: async () => { if (once) { once = false; entered(); await hold; } } });
    const pending = slow.tick(now, "slow"); await claimed;
    await new module.MonitoringWorker(f.store).tick("2026-10-11T12:01:01.000Z", "fast"); release(); await pending;
    assert.equal(f.store.read().reminders.length, 1); assert.ok(f.store.read().dueTasks.every(t => t.state !== "claimed"));
  } finally { f.store.close(); }
});
test("persisted tasks survive process restart and completed phases do not duplicate", async () => {
  const folder = mkdtempSync(join(tmpdir(), "care-worker-")); const path = join(folder, "care.sqlite");
  let f = setup(path); try { await f.worker.tick(now, "first"); } finally { f.store.close(); }
  const reopened = fixtureStore(path); try { const worker = new module.MonitoringWorker(reopened); await worker.tick("2026-10-11T12:00:15.000Z", "restarted"); assert.equal(reopened.read().reminders.length, 1); assert.ok(reopened.read().workerHeartbeats.restarted); } finally { reopened.close(); rmSync(folder, { recursive: true, force: true }); }
});
test("freshness deadlines change evaluation without creating one task on every tick", async () => {
  const f = setup(); try {
    await f.worker.tick(now, "first"); const initial = f.store.read().dueTasks.length;
    await f.worker.tick("2026-10-11T12:00:15.000Z", "first"); assert.equal(f.store.read().dueTasks.length, initial);
    await f.worker.tick("2026-10-12T12:00:00.000Z", "first");
    assert.ok(f.store.read().conditionEvaluations[0].coverage.includes("stale"));
    const after = f.store.read().dueTasks.length; await f.worker.tick("2026-10-12T12:00:15.000Z", "first"); assert.equal(f.store.read().dueTasks.length, after);
  } finally { f.store.close(); }
});
test("overdue review creates a review task without approving proposals or promising doctor contact", async () => {
  const f = setup(); try {
    f.store.transaction(s => { s.carePlans[0].reviewDeadline = now; s.careProposals[0].state = "needs_review"; });
    await f.worker.tick(now, "first"); assert.equal(f.store.read().careProposals[0].state, "needs_review"); assert.ok(f.store.read().dueTasks.some(t => t.kind === "review_overdue" && t.state === "completed")); assert.equal(f.store.read().contactRequests.length, 0);
  } finally { f.store.close(); }
});
test("no referent or stale approved context cannot produce clinical reminders", async () => {
  for (const noReferent of [true, false]) { const f = setup(); try {
    f.store.transaction(s => { if (noReferent) s.careGrants[0].state = "revoked"; else bumpPatientRevision(s, "fatma", "context"); });
    await f.worker.tick(now, "first"); assert.equal(f.store.read().reminders.length, 0); assert.equal(f.store.read().messages.length, 0);
  } finally { f.store.close(); } }
});
test("worker evaluates a fresh measurement and automatically applies an explicitly approved protocol", async () => {
  const f = setup(); try {
    const protocol = new ProtocolService(f.store, () => now).authorize(testDoctor, "fatma", { sourceProposalId: "proposal", actions: [f.store.read().careProposals[0].action], predicates: [{ kind: "priority_equals", conditionFactId: "hypertension", value: "orange" }, { kind: "requirements_complete", requirementIds: ["demo_blood_pressure:reading"] }], exclusions: [], stopCriteria: [], validUntil: "2026-10-12T12:00:00.000Z", minIntervalSeconds: 60, maxApplications: 2, expectedGuard: currentGuard(f.store.read(), "fatma"), clientId: "protocol" });
    await f.worker.tick(now, "automatic");
    assert.equal(f.store.read().protocolApplications.filter(a => a.state === "delivered").length, 1);
    await f.worker.tick("2026-10-11T12:00:15.000Z", "automatic");
    assert.equal(f.store.read().carePlans[0].revision, 1); assert.equal(f.store.read().reminders.length, 2);
    const later = "2026-10-11T12:01:01.000Z";
    f.store.transaction(s => ingestReading(s, "fatma", { kind: "blood_pressure", systolic: 146, diastolic: 93, unit: "mmHg", measuredAt: later, clientId: "new-reading" }, "app", undefined, later));
    await f.worker.tick(later, "automatic"); await f.worker.tick("2026-10-11T12:01:16.000Z", "automatic"); assert.equal(f.store.read().protocolApplications.filter(a => a.protocolId === protocol.id && a.state === "delivered").length, 2); assert.equal(f.store.read().carePlans[0].revision, 1); assert.equal(f.store.read().reminders.length, 3);
    const normalAt = "2026-10-11T12:02:02.000Z";
    f.store.transaction(s => ingestReading(s, "fatma", { kind: "blood_pressure", systolic: 120, diastolic: 80, unit: "mmHg", measuredAt: normalAt, clientId: "normal-after-application-limit" }, "app", undefined, normalAt));
    await f.worker.tick(normalAt, "automatic");
    assert.equal(f.store.read().protocolApplications.length, 2, "an exhausted allowance does not make a non-trigger need review");
    assert.equal(f.store.read().dueTasks.filter(t => t.kind === "review_overdue").length, 0);
  } finally { f.store.close(); }
});
test("ordinary high-only readings do not trigger a protocol or create review noise", async () => {
  const f = setup(); try {
    new ProtocolService(f.store, () => now).authorize(testDoctor, "fatma", { sourceProposalId: "proposal", actions: [f.store.read().careProposals[0].action], predicates: [{ kind: "priority_equals", conditionFactId: "hypertension", value: "orange" }, { kind: "requirements_complete", requirementIds: ["demo_blood_pressure:reading"] }], exclusions: [], stopCriteria: [], validUntil: "2026-10-12T12:00:00.000Z", minIntervalSeconds: 60, maxApplications: 2, expectedGuard: currentGuard(f.store.read(), "fatma"), clientId: "ordinary-protocol" });
    f.store.transaction(s => { s.careActions[0].state = "completed"; });
    for (let index = 1; index <= 3; index++) {
      const at = new Date(Date.parse(now) + index * 61000).toISOString();
      f.store.transaction(s => ingestReading(s, "fatma", { kind: "blood_pressure", systolic: 120, diastolic: 80, unit: "mmHg", measuredAt: at, clientId: `ordinary-${index}` }, "app", undefined, at));
      await f.worker.tick(at, "ordinary");
    }
    const state = f.store.read();
    assert.equal(state.conditionEvaluations[0].priority, "unknown", "a non-trigger never establishes medical green");
    assert.equal(state.protocolApplications.length, 0);
    assert.equal(state.dueTasks.filter(t => t.kind === "protocol_apply" || t.kind === "review_overdue").length, 0);
    assert.equal(state.messages.length, 0);
    assert.equal(state.careActions.length, 1);
  } finally { f.store.close(); }
});
test("an unknown exclusion remains a review block even when the high-only trigger is not met", async () => {
  const f = setup(); try {
    f.store.transaction(s => s.medicalFacts.push({ id: "new-symptom", patientId: "fatma", kind: "symptom", code: "symptom", label: "Symptom", value: null, polarity: "unknown", verification: "patient_reported", sources: [], revision: 1, createdAt: now, supersededBy: null }));
    new ProtocolService(f.store, () => now).authorize(testDoctor, "fatma", { sourceProposalId: "proposal", actions: [f.store.read().careProposals[0].action], predicates: [{ kind: "priority_equals", conditionFactId: "hypertension", value: "orange" }, { kind: "requirements_complete", requirementIds: ["demo_blood_pressure:reading"] }], exclusions: [{ kind: "fact_equals", factId: "new-symptom", polarity: "affirmed" }], stopCriteria: [], validUntil: "2026-10-12T12:00:00.000Z", minIntervalSeconds: 60, maxApplications: 2, expectedGuard: currentGuard(f.store.read(), "fatma"), clientId: "unknown-exclusion-protocol" });
    f.store.transaction(s => { s.careActions[0].state = "completed"; ingestReading(s, "fatma", { kind: "blood_pressure", systolic: 120, diastolic: 80, unit: "mmHg", measuredAt: now, clientId: "non-trigger-unknown-exclusion" }, "app", undefined, now); });
    await f.worker.tick(now, "unknown-exclusion");
    await f.worker.tick("2026-10-11T12:00:15.000Z", "unknown-exclusion");
    assert.equal(f.store.read().protocolApplications[0].state, "blocked");
    assert.ok(f.store.read().protocolApplications[0].reasons.includes("unknown_exclusion"));
    assert.equal(f.store.read().messages.filter(m => m.kind === "administrative").length, 1);
    assert.equal(f.store.read().messages.filter(m => m.kind === "approved_action").length, 0);
  } finally { f.store.close(); }
});
test("temporary task failure retries after restart without losing or duplicating the reminder", async () => {
  const f = setup(); try {
    let failOnce = true;
    const worker = new module.MonitoringWorker(f.store, { beforeCommit: async task => { if (task.kind === "remind" && failOnce) { failOnce = false; throw new Error("Transient failure"); } } });
    const result = await worker.tick(now, "failed"); assert.equal(result.failed, 1); assert.equal(f.store.read().reminders.length, 0); assert.ok(f.store.read().dueTasks.some(t => t.kind === "remind" && t.state === "pending" && t.attempts === 1));
    await new module.MonitoringWorker(f.store).tick("2026-10-11T12:00:15.000Z", "restarted"); assert.equal(f.store.read().reminders.length, 1);
  } finally { f.store.close(); }
});
test("an expired lease cannot deliver even before another worker recovers it", async () => {
  const f = setup(); try {
    let at = now;
    const worker = new module.MonitoringWorker(f.store, { clock: () => at, beforeCommit: async () => { at = "2026-10-11T12:01:01.000Z"; } });
    await worker.tick(now, "expired"); assert.equal(f.store.read().reminders.length, 0); assert.ok(f.store.read().dueTasks.some(t => t.state === "claimed"));
    await new module.MonitoringWorker(f.store).tick(at, "recovered"); assert.equal(f.store.read().reminders.length, 1);
  } finally { f.store.close(); }
});
test("review deadline is rescheduled for current authority after stale phase cancellation and successful delivery stays unique", async () => {
  const f = setup(); try {
    f.store.transaction(s => { s.carePlans[0].reviewDeadline = "2026-10-11T12:01:00.000Z"; });
    await f.worker.tick(now, "deadline");
    f.store.transaction(s => bumpPatientRevision(s, "fatma", "authority"));
    await f.worker.tick("2026-10-11T12:01:01.000Z", "deadline");
    assert.equal(f.store.read().messages.filter(m => m.kind === "administrative").length, 1);
    assert.ok(f.store.read().dueTasks.some(t => t.kind === "review_overdue" && t.state === "completed" && t.guard.authorityRevision === 1));
    f.store.transaction(s => bumpPatientRevision(s, "fatma", "authority"));
    await f.worker.tick("2026-10-11T12:01:16.000Z", "deadline");
    assert.equal(f.store.read().messages.filter(m => m.kind === "administrative").length, 1, "a completed logical deadline must not send duplicate clinical review messages");
  } finally { f.store.close(); }
});
