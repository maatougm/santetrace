import test from "node:test";
import assert from "node:assert/strict";
import type { PlanUpdate } from "../src/contracts/monitoring";
import { CarePlanService } from "../src/lib/care-plan-service";
import { createDemoMonitoringProfiles } from "../src/lib/monitoring-evaluation";
import { MonitoringWorker } from "../src/lib/monitoring-worker";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";

const now = "2026-10-11T12:00:00.000Z";
const deadline = "2026-10-11T12:01:00.000Z";
function setup() {
  const store = fixtureStore();
  store.transaction(state => {
    state.monitoringProfiles = createDemoMonitoringProfiles(state.patients.find(patient => patient.id === "fatma")!.rules);
    state.medicalFacts.push({ id: "hypertension", patientId: "fatma", kind: "condition", code: "hypertension", label: "Hypertension", value: null, polarity: "affirmed", verification: "patient_reported", sources: [], revision: 1, createdAt: now, supersededBy: null });
  });
  let clock = now;
  const service = new CarePlanService(store, () => clock);
  const shell = service.getPlan(testDoctor, "fatma").plan!;
  const profile = store.read().monitoringProfiles[0];
  const body: PlanUpdate = { action: "activate", profileBindings: [{ conditionFactId: "hypertension", profileId: profile.id, profileVersion: profile.version }], expectedRevision: shell.revision, clientId: "deadline", reviewDeadline: deadline };
  return { store, service, body, setClock: (value: string) => { clock = value; } };
}
const errorCode = (code: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);

test("primary sets a review deadline through PlanUpdate and the real worker emits one overdue review message", async () => {
  const { store, service, body } = setup();
  try {
    const result = service.updatePlan(testDoctor, "fatma", body);
    assert.equal(result.plan?.reviewDeadline, deadline);
    assert.equal(result.plan?.revision, 1);
    assert.ok(store.read().accessJournal.some(entry => entry.actorId === testDoctor.id && entry.action === "plan_activate" && entry.outcome === "allowed"));
    const worker = new MonitoringWorker(store);
    await worker.tick(now, "review-worker");
    assert.equal(store.read().messages.filter(message => message.kind === "administrative").length, 0);
    assert.ok(store.read().dueTasks.some(task => task.kind === "review_overdue" && task.state === "pending" && task.dueAt === deadline));
    await worker.tick("2026-10-11T12:01:01.000Z", "review-worker");
    await worker.tick("2026-10-11T12:01:16.000Z", "review-worker");
    const messages = store.read().messages.filter(message => message.kind === "administrative");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].authorCategory, "system");
    assert.equal(messages[0].clinicianId, testDoctor.id);
    assert.equal(store.read().dueTasks.filter(task => task.kind === "review_overdue" && task.state === "completed").length, 1);
    assert.equal(store.read().careActions.length, 0, "a review deadline authorizes no medical action");
    assert.equal(store.read().contactRequests.length, 0);
  } finally { store.close(); }
});

test("omitting the optional deadline preserves it and explicit null clears scheduled overdue review", async () => {
  const { store, service, body } = setup();
  try {
    const active = service.updatePlan(testDoctor, "fatma", body).plan!;
    const { reviewDeadline: _, ...legacy } = body;
    const retained = service.updatePlan(testDoctor, "fatma", { ...legacy, expectedRevision: active.revision, clientId: "legacy" }).plan!;
    assert.equal(retained.reviewDeadline, deadline);
    const worker = new MonitoringWorker(store);
    await worker.tick(now, "review-worker");
    const cleared = service.updatePlan(testDoctor, "fatma", { ...body, action: "suspend", reviewDeadline: null, expectedRevision: retained.revision, clientId: "clear" }).plan!;
    assert.equal(cleared.reviewDeadline, null);
    assert.equal(cleared.revision, retained.revision + 1);
    await worker.tick("2026-10-11T12:01:01.000Z", "review-worker");
    assert.equal(store.read().messages.filter(message => message.kind === "administrative").length, 0);
    assert.equal(store.read().dueTasks.filter(task => task.kind === "review_overdue" && task.state === "completed").length, 0);
  } finally { store.close(); }
});

test("review deadlines reject past, non-canonical, invalid and excessive dates without changing policy", () => {
  const { store, service, body } = setup();
  try {
    for (const value of [now, "2026-10-11T11:59:59.999Z", "2026-11-10T12:00:00.001Z", "2026-10-11T13:00:00Z", "2026-10-11T13:00:00.000+00:00", "2026-10-11T24:00:00.000Z", "2026-13-01T12:00:00.000Z", "tomorrow"]) {
      assert.throws(() => service.updatePlan(testDoctor, "fatma", { ...body, reviewDeadline: value }), errorCode("INVALID_REVIEW_DEADLINE"));
      assert.equal(store.read().carePlans[0].reviewDeadline, null);
      assert.equal(store.read().carePlans[0].revision, 0);
    }
    const maximum = service.updatePlan(testDoctor, "fatma", { ...body, reviewDeadline: "2026-11-10T12:00:00.000Z" });
    assert.equal(maximum.plan?.reviewDeadline, "2026-11-10T12:00:00.000Z", "exactly 30 days is allowed");
  } finally { store.close(); }
});

test("deadline updates preserve managing-primary authorization, stale revision rejection and replay conflicts", () => {
  const { store, service, body, setClock } = setup();
  try {
    assert.throws(() => service.updatePlan(testOwner, "fatma", body), errorCode("FORBIDDEN"));
    store.transaction(state => state.careGrants.push({ ...state.careGrants[0], id: "secondary-grant", clinicianId: "secondary", relationship: "specialist" }));
    assert.throws(() => service.updatePlan({ ...testDoctor, id: "secondary" }, "fatma", body), errorCode("FORBIDDEN"));
    const first = service.updatePlan(testDoctor, "fatma", body);
    setClock("2026-10-11T12:02:00.000Z");
    assert.deepEqual(service.updatePlan(testDoctor, "fatma", body), first, "a delayed same-payload retry retains its original result");
    assert.throws(() => service.updatePlan(testDoctor, "fatma", { ...body, reviewDeadline: null }), errorCode("IDEMPOTENCY_CONFLICT"));
    assert.throws(() => service.updatePlan(testDoctor, "fatma", { ...body, reviewDeadline: null, clientId: "stale" }), errorCode("STALE_REVISION"));
    store.transaction(state => { state.accounts.find(account => account.id === testDoctor.id)!.enabled = false; });
    assert.throws(() => service.updatePlan(testDoctor, "fatma", body), errorCode("NOT_FOUND"));
    assert.equal(store.read().carePlans[0].revision, first.plan!.revision);
    assert.equal(store.read().carePlans[0].reviewDeadline, deadline);
  } finally { store.close(); }
});
