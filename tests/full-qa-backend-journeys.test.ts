import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Actor } from "../src/contracts/care";
import type { ProtocolAuthorization } from "../src/contracts/monitoring";
import { SHARING_SCOPES } from "../src/contracts/patient-platform";
import { CareStore } from "../src/lib/care-store";
import { CareError, CareService, ingestReading } from "../src/lib/care-service";
import { CarePlanService } from "../src/lib/care-plan-service";
import { EndoRecordService } from "../src/lib/endorecord-service";
import { InterventionService } from "../src/lib/intervention-service";
import { buildAuthorizedEvidence } from "../src/lib/medical-evidence";
import { createCareHandler } from "../src/lib/monitoring-http";
import { createDemoMonitoringProfiles } from "../src/lib/monitoring-evaluation";
import { MonitoringWorker } from "../src/lib/monitoring-worker";
import { PatientAccessService, currentGuard } from "../src/lib/patient-access-service";
import { ProtocolService } from "../src/lib/protocol-service";
import { signSession } from "../src/lib/care-session";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";

const now = "2026-10-11T12:00:00.000Z";
const hasCode = (code: string) => (error: unknown) => error instanceof CareError && error.code === code;

function recordHypertension(store: CareStore) {
  store.transaction(state => {
    const patient = state.patients.find(patient => patient.id === "fatma")!;
    state.monitoringProfiles = createDemoMonitoringProfiles(patient.rules);
    state.medicalFacts.push({ id: "full-qa-hypertension", patientId: "fatma", kind: "condition", code: "hypertension", label: "Synthetic hypertension declaration", value: null, polarity: "affirmed", verification: "patient_reported", sources: [], revision: 1, createdAt: now, supersededBy: null });
  });
}

test("a future approved review deadline survives restart and the independent worker delivers its logical phase once", async () => {
  const folder = await mkdtemp(join(tmpdir(), "full-qa-deadline-"));
  const path = join(folder, "care.sqlite");
  let store = fixtureStore(path);
  try {
    recordHypertension(store);
    const plans = new CarePlanService(store, () => now);
    const shell = plans.getPlan(testDoctor, "fatma").plan!;
    const profile = store.read().monitoringProfiles[0];
    const deadline = "2026-10-11T12:01:00.000Z";
    const approved = plans.updatePlan(testDoctor, "fatma", { action: "activate", profileBindings: [{ conditionFactId: "full-qa-hypertension", profileId: profile.id, profileVersion: profile.version }], expectedRevision: shell.revision, reviewDeadline: deadline, clientId: "full-qa-deadline" }).plan!;
    await new MonitoringWorker(store).tick(now, "before-restart");
    const scheduled = store.read().dueTasks.find(task => task.kind === "review_overdue")!;
    assert.equal(scheduled.state, "pending");
    assert.equal(scheduled.dueAt, deadline);
    assert.equal(store.read().messages.length, 0);

    store.close();
    store = new CareStore(path);
    assert.deepEqual(store.read().carePlans.find(plan => plan.id === approved.id), approved);
    assert.equal(store.read().dueTasks.find(task => task.id === scheduled.id)?.state, "pending");
    await new MonitoringWorker(store).tick("2026-10-11T12:00:59.000Z", "after-restart");
    assert.equal(store.read().messages.length, 0, "restart must not make a future deadline overdue");
    await new MonitoringWorker(store).tick("2026-10-11T12:01:01.000Z", "after-restart");

    store.close();
    store = new CareStore(path);
    await new MonitoringWorker(store).tick("2026-10-11T12:01:16.000Z", "second-restart");
    const messages = store.read().messages.filter(message => message.kind === "administrative");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].authorCategory, "system");
    assert.equal(messages[0].clinicianId, testDoctor.id);
    assert.equal(store.read().dueTasks.filter(task => task.kind === "review_overdue" && task.state === "completed").length, 1);
    assert.equal(store.read().carePlans[0].revision, approved.revision);
    assert.equal(store.read().careActions.length, 0);
    assert.equal(store.read().contactRequests.length, 0);
  } finally { store.close(); await rm(folder, { recursive: true, force: true }); }
});

test("reusable authority preserves successful applications, cooldown, total limit and context suspension across repository restarts", async () => {
  const folder = await mkdtemp(join(tmpdir(), "full-qa-protocol-"));
  const path = join(folder, "care.sqlite");
  let store = fixtureStore(path), at = now;
  try {
    recordHypertension(store);
    store.transaction(state => {
      const profile = state.monitoringProfiles[0], action = { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} };
      state.carePlans.push({ id: "full-qa-plan", patientId: "fatma", revision: 1, state: "active", clinicianId: testDoctor.id, profileBindings: [{ conditionFactId: "full-qa-hypertension", profileId: profile.id, profileVersion: profile.version }], actionIds: ["full-qa-original"], reviewDeadline: null });
      state.careProposals.push({ id: "full-qa-proposal", patientId: "fatma", revision: 2, kind: "home_measurement", state: "approved", action, sources: buildAuthorizedEvidence(state, testDoctor, "fatma").sources.filter(source => source.id === "full-qa-hypertension" || source.kind === "reference"), guard: currentGuard(state, "fatma"), decision: { clinicianId: testDoctor.id, at, reason: "Synthetic primary review" }, history: [] });
      state.careActions.push({ id: "full-qa-original", patientId: "fatma", planId: "full-qa-plan", revision: 1, proposalId: "full-qa-proposal", protocolId: null, originVersion: 2, action, dueAt: at, state: "completed", reportedAt: at, clientId: "full-qa-original", createdAt: at });
    });
    const reading = (clientId: string) => store.transaction(state => ingestReading(state, "fatma", { kind: "blood_pressure", systolic: 145, diastolic: 92, unit: "mmHg", measuredAt: at, clientId }, "app", undefined, at)).measurement;
    const firstReading = reading("full-qa-first");
    const body: ProtocolAuthorization = { sourceProposalId: "full-qa-proposal", actions: [store.read().careProposals[0].action], predicates: [{ kind: "priority_equals", conditionFactId: "full-qa-hypertension", value: "orange" }, { kind: "requirements_complete", requirementIds: ["demo_blood_pressure:reading"] }], exclusions: [], stopCriteria: [], validUntil: "2026-10-12T12:00:00.000Z", minIntervalSeconds: 60, maxApplications: 2, expectedGuard: currentGuard(store.read(), "fatma"), clientId: "full-qa-authorize" };
    const protocols = new ProtocolService(store, () => at);
    const protocol = protocols.authorize(testDoctor, "fatma", body);
    const first = await protocols.apply(protocol.id, firstReading.id, currentGuard(store.read(), "fatma"), at);
    assert.equal(first.state, "delivered");
    new CarePlanService(store, () => at).reportAction(testOwner, first.actionId!, { state: "completed", expectedRevision: 1, clientId: "full-qa-first-complete" });

    store.close();
    store = new CareStore(path);
    const reopened = new ProtocolService(store, () => at);
    assert.equal((await reopened.apply(protocol.id, firstReading.id, currentGuard(store.read(), "fatma"), at)).id, first.id);
    assert.equal(store.read().protocolApplications.filter(application => application.state === "delivered").length, 1);
    at = "2026-10-11T12:00:01.000Z";
    const early = reading("full-qa-early");
    const heldByCooldown = await reopened.apply(protocol.id, early.id, currentGuard(store.read(), "fatma"), at);
    assert.equal(heldByCooldown.state, "blocked");
    assert.ok(heldByCooldown.reasons.includes("cooldown"));
    at = "2026-10-11T12:01:01.000Z";
    const secondReading = reading("full-qa-second");
    const second = await reopened.apply(protocol.id, secondReading.id, currentGuard(store.read(), "fatma"), at);
    assert.equal(second.state, "delivered");
    new CarePlanService(store, () => at).reportAction(testOwner, second.actionId!, { state: "completed", expectedRevision: 1, clientId: "full-qa-second-complete" });

    store.close();
    store = new CareStore(path);
    at = "2026-10-11T12:02:02.000Z";
    const thirdReading = reading("full-qa-third");
    const exhausted = await new ProtocolService(store, () => at).apply(protocol.id, thirdReading.id, currentGuard(store.read(), "fatma"), at);
    assert.equal(exhausted.state, "blocked");
    assert.ok(exhausted.reasons.includes("application_limit"));
    new InterventionService(store, () => at).sendMessage(testOwner, "fatma", { clinicianId: testDoctor.id, text: "Synthetic changed patient context", kind: "clinical", clientId: "full-qa-context" });
    store.close();
    store = new CareStore(path);
    assert.equal(store.read().protocols.find(item => item.id === protocol.id)?.state, "suspended");
    assert.equal(store.read().protocolApplications.filter(application => application.state === "delivered").length, 2);
    assert.equal(store.read().careActions.filter(action => action.protocolId === protocol.id).length, 2);
    assert.equal(store.read().messages.filter(message => message.kind === "approved_action").length, 2);
    assert.equal(store.read().carePlans[0].revision, 1, "execution progress and context suspension retain the approved policy revision");
  } finally { store.close(); await rm(folder, { recursive: true, force: true }); }
});

test("corrected confirmed lab evidence survives restart with original PDF provenance, then narrowed and revoked sharing deny the clinician", async () => {
  const folder = await mkdtemp(join(tmpdir(), "full-qa-lab-"));
  const path = join(folder, "care.sqlite"), documents = join(folder, "documents");
  const bytes = new TextEncoder().encode("%PDF-1.4 synthetic full QA fixture");
  let store = fixtureStore(path);
  try {
    const labs = new EndoRecordService(store, documents, async () => [{ page: 1, text: "Patient: Fatma Ben Salah\nDate examen: 03/10/2026\nHbA1c: 8,4 %" }]);
    const uploaded = await labs.upload(testOwner, "fatma", "synthetic-lab.pdf", bytes), candidate = uploaded.candidates[0];
    const draftEvidence = buildAuthorizedEvidence(store.read(), testDoctor, "fatma");
    assert.equal(draftEvidence.sources.find(source => source.id === candidate.id)?.verification, "candidate");
    assert.equal(draftEvidence.sources.some(source => source.kind === "observation"), false);
    const confirmed = labs.review(testDoctor, candidate.id, { action: "confirm", identityConfirmed: true, value: 8.5, reason: "Synthetic PDF correction" }).observation!;
    labs.revise(testDoctor, confirmed.id, { value: 8.6, unit: "%", examDate: "2026-10-03", reason: "Synthetic second review" });
    store.close();
    store = new CareStore(path);

    const evidence = buildAuthorizedEvidence(store.read(), testDoctor, "fatma"), source = evidence.sources.find(source => source.id === confirmed.id)!;
    assert.equal(source.verification, "confirmed");
    assert.equal(source.revision, 2);
    assert.equal(source.documentId, uploaded.document.id);
    assert.equal(source.contentHash, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(JSON.parse(evidence.chunks.find(chunk => chunk.source.id === confirmed.id)!.text).value, 8.6);
    assert.equal(evidence.sources.some(item => item.id === candidate.id), false, "reviewed extraction is not an unreviewed candidate in AI evidence");
    const persisted = new CareService(store).patient(testOwner, "fatma");
    assert.equal(persisted.candidates[0].value, 8.4);
    assert.equal(persisted.observations[0].value, 8.6);
    assert.equal(persisted.observations[0].revisions[0].value, 8.5);
    assert.equal(persisted.observations[0].revisions[0].author, testDoctor.id);
    assert.deepEqual(await new EndoRecordService(store, documents).source(testOwner, uploaded.document.id), Buffer.from(bytes));

    const access = new PatientAccessService(store);
    access.update(testOwner, "grant:fatma", { action: "update", scopes: ["status"], expectedRevision: 1, clientId: "full-qa-lab-narrow" });
    const narrowed = new CareService(store).patient(testDoctor, "fatma");
    assert.deepEqual(narrowed.documents, []);
    assert.deepEqual(narrowed.candidates, []);
    assert.deepEqual(narrowed.observations, []);
    assert.throws(() => buildAuthorizedEvidence(store.read(), testDoctor, "fatma"), hasCode("FORBIDDEN"));
    await assert.rejects(() => new EndoRecordService(store, documents).source(testDoctor, uploaded.document.id), hasCode("FORBIDDEN"));
    access.update(testOwner, "grant:fatma", { action: "revoke", expectedRevision: 2, clientId: "full-qa-lab-revoke" });
    assert.throws(() => new CareService(store).patient(testDoctor, "fatma"), hasCode("NOT_FOUND"));
    assert.equal(new CareService(store).patient(testOwner, "fatma").observations[0].value, 8.6);
  } finally { store.close(); await rm(folder, { recursive: true, force: true }); }
});

test("HTTP red-alert closure requires current managing-primary rights and a later ordinary reading cannot close the episode", async () => {
  const previous = process.env.DEMO_CLINICIAN_PASSWORD;
  process.env.DEMO_CLINICIAN_PASSWORD = "Synthetic full QA primary password!";
  const store = fixtureStore();
  try {
    const secondary: Actor = { ...testDoctor, id: "secondary" };
    store.transaction(state => state.careGrants.push({ ...state.careGrants[0], id: "full-qa-secondary", clinicianId: secondary.id, relationship: "specialist", scopes: [...SHARING_SCOPES] }));
    const handle = createCareHandler(store);
    const request = (actor: Actor | null, path: string, method = "GET", body?: unknown) => handle(new Request(`http://localhost/api/${path}`, { method, headers: { ...(actor ? { cookie: `hackcure_session=${signSession(actor, Date.now(), store)}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    const submitted = await request(testOwner, "patients/fatma/measurements", "POST", { kind: "glucose", value: 260, unit: "mg/dL", measuredAt: new Date().toISOString(), clientId: "full-qa-red" });
    assert.equal(submitted.status, 201);
    const alert = (await submitted.json()).alert;
    for (const [actor, expected] of [[null, 401], [testOwner, 403], [secondary, 403]] as const) {
      assert.equal((await request(actor, `alerts/${alert.id}`, "PATCH", { action: "resolve", note: "Synthetic unauthorized attempt" })).status, expected);
      assert.equal(store.read().alerts.find(item => item.id === alert.id)?.status, "new");
    }
    assert.equal((await request(testDoctor, `alerts/${alert.id}`, "PATCH", { action: "acknowledge" })).status, 200);
    assert.equal((await request(testOwner, "patients/fatma/measurements", "POST", { kind: "glucose", value: 100, unit: "mg/dL", measuredAt: new Date().toISOString(), clientId: "full-qa-ordinary" })).status, 201);
    assert.equal((await (await request(testOwner, "patients/fatma")).json()).patient.status, "red");
    assert.equal((await request(testOwner, "grants/grant:fatma", "PATCH", { action: "update", scopes: ["status"], expectedRevision: 1, clientId: "full-qa-red-narrow" })).status, 200);
    assert.equal((await request(testDoctor, `alerts/${alert.id}`, "PATCH", { action: "resolve", note: "Synthetic narrowed attempt" })).status, 403);
    assert.equal(store.read().alerts.find(item => item.id === alert.id)?.status, "acknowledged");
    assert.equal((await request(testOwner, "grants/grant:fatma", "PATCH", { action: "update", scopes: [...SHARING_SCOPES], expectedRevision: 2, clientId: "full-qa-red-restore" })).status, 200);
    const closed = await request(testDoctor, `alerts/${alert.id}`, "PATCH", { action: "resolve", note: "Synthetic explicit clinician follow-up" });
    assert.equal(closed.status, 200);
    const result = await closed.json();
    assert.equal(result.alert.status, "resolved");
    assert.deepEqual(result.alert.history.map((entry: { action: string; author: string }) => [entry.action, entry.author]), [["acknowledge", testDoctor.id], ["resolve", testDoctor.id]]);
    assert.equal((await (await request(testOwner, "patients/fatma")).json()).patient.status, "unknown");
    assert.equal((await request(testOwner, "grants/grant:fatma", "PATCH", { action: "revoke", expectedRevision: 3, clientId: "full-qa-red-revoke" })).status, 200);
    assert.equal((await request(testDoctor, `alerts/${alert.id}`, "PATCH", { action: "resolve", note: "Synthetic replay after revocation" })).status, 404);
    assert.equal(store.read().alerts.find(item => item.id === alert.id)?.history.length, 2);
    assert.equal(closed.headers.get("cache-control"), "no-store");
  } finally { store.close(); if (previous === undefined) delete process.env.DEMO_CLINICIAN_PASSWORD; else process.env.DEMO_CLINICIAN_PASSWORD = previous; }
});
