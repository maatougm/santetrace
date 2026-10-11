import test from "node:test";
import assert from "node:assert/strict";
import type { CareMessage, CareProposal, ContactRequest, ProtocolApplication, ReusableProtocol } from "../src/contracts/monitoring";
import type { SharingScope } from "../src/contracts/patient-platform";
import { CareService } from "../src/lib/care-service";
import { projectDoctorQueueSummary } from "../src/lib/doctor-queue-summary";
import { currentGuard } from "../src/lib/patient-access-service";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";

const now = "2026-10-11T12:00:00.000Z";
const early = "2026-10-11T08:00:00.000Z";
const later = "2026-10-11T10:00:00.000Z";

function message(id: string, patch: Partial<CareMessage> = {}): CareMessage {
  return { id, revision: 1, patientId: "fatma", clinicianId: testDoctor.id,
    threadId: JSON.stringify(["fatma", testDoctor.id]), authorId: testOwner.id,
    authorCategory: "patient", text: `PRIVATE MESSAGE ${id}`, kind: "clinical",
    actionId: null, createdAt: early, readAt: null, review: null, ...patch };
}
function contact(id: string, patch: Partial<ContactRequest> = {}): ContactRequest {
  return { id, revision: 1, patientId: "fatma", clinicianId: testDoctor.id,
    state: "requested", messageId: null, createdAt: later, history: [], ...patch };
}
function proposal(id: string, patch: Partial<CareProposal> = {}): CareProposal {
  const action = { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} };
  return { id, patientId: "fatma", revision: 1, kind: "home_measurement", state: "pending",
    action, sources: [], guard: { contextRevision: 99, evidenceRevision: 42, authorityRevision: 1, carePlanRevision: 1, profileVersions: [] },
    decision: null, history: [{ revision: 1, action, state: "pending", at: later, author: "PRIVATE AUTHOR" }], ...patch };
}
function protocol(id: string, patch: Partial<ReusableProtocol> = {}): ReusableProtocol {
  return { id, patientId: "fatma", revision: 2, state: "active", clinicianId: testDoctor.id,
    sourceProposalId: "PRIVATE PROPOSAL ID", authorityRevision: 1, requiredContextRevision: 0,
    carePlanRevision: 1, profileVersions: [], actions: [], predicates: [], exclusions: [],
    stopCriteria: [], validUntil: "2026-10-12T12:00:00.000Z", minIntervalSeconds: 60,
    maxApplications: 2, createdAt: early, history: [], ...patch };
}
function application(id: string, protocolId: string, patch: Partial<ProtocolApplication> = {}): ProtocolApplication {
  return { id, patientId: "fatma", protocolId, protocolVersion: 2, triggerId: "PRIVATE TRIGGER ID",
    guard: { contextRevision: 99, evidenceRevision: 42, authorityRevision: 1, carePlanRevision: 1, profileVersions: [] },
    state: "blocked", reasons: ["PRIVATE REASON"], sources: [], actionId: null,
    createdAt: early, deliveredAt: null, ...patch };
}
function setScopes(store: ReturnType<typeof fixtureStore>, scopes: SharingScope[]) {
  store.transaction(state => { state.careGrants.find(g => g.patientId === "fatma" && g.clinicianId === testDoctor.id)!.scopes = scopes; });
}

test("queue distinguishes unshared sections from inspected empty sections", () => {
  const store = fixtureStore();
  try {
    setScopes(store, ["status"]);
    assert.deepEqual(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now), {
      clinicalMessages: null, contactRequests: null, proposals: null, planReview: null,
      blockedProtocols: null, oldestPendingAt: null,
    });
    setScopes(store, ["messages"]);
    const messagesOnly = projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now);
    assert.deepEqual(messagesOnly.clinicalMessages, { count: 0, oldestAt: null });
    assert.deepEqual(messagesOnly.contactRequests, { count: 0, oldestAt: null });
    assert.equal(messagesOnly.proposals, null);
    assert.equal(messagesOnly.blockedProtocols, null);
    setScopes(store, ["clinical", "summary"]); // Incomplete composite scope must not expose protocol information.
    assert.deepEqual(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).proposals,
      { awaitingReview: 0, needsInputs: 0, oldestAt: null });
    assert.equal(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).blockedProtocols, null);
  } finally { store.close(); }
});

test("only this clinician's unreviewed patient clinical messages count; reading is not review", () => {
  const store = fixtureStore();
  try {
    store.transaction(state => { state.messages.push(
      message("own-read", { readAt: later }),
      message("other-thread", { clinicianId: "secondary", createdAt: "2026-10-10T01:00:00.000Z" }),
      message("other-patient", { patientId: "ahmed" }),
      message("administrative", { kind: "administrative" }),
      message("doctor-message", { authorCategory: "clinician", authorId: testDoctor.id }),
      message("reviewed", { review: { clinicianId: testDoctor.id, at: later, reason: "Reviewed", guard: currentGuard(state, "fatma") } }),
    ); });
    setScopes(store, ["messages"]);
    const queue = projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now);
    assert.deepEqual(queue.clinicalMessages, { count: 1, oldestAt: early });
    assert.equal(queue.oldestPendingAt, early);
    assert.equal(queue.proposals, null);
    store.transaction(state => { state.messages[0].review = { clinicianId: testDoctor.id, at: now, reason: "Explicit review", guard: currentGuard(state, "fatma") }; });
    assert.deepEqual(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).clinicalMessages, { count: 0, oldestAt: null });
  } finally { store.close(); }
});

test("acknowledged contact stays open until reported or cancelled and other threads stay private", () => {
  const store = fixtureStore();
  try {
    store.transaction(state => { state.contactRequests.push(
      contact("requested"), contact("acknowledged", { state: "acknowledged", createdAt: early }),
      contact("reported", { state: "contact_reported" }), contact("cancelled", { state: "cancelled" }),
      contact("other-thread", { clinicianId: "secondary", createdAt: "2026-10-10T01:00:00.000Z" }),
      contact("other-patient", { patientId: "ahmed" }),
    ); });
    assert.deepEqual(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).contactRequests, { count: 2, oldestAt: early });
    store.transaction(state => { state.contactRequests[0].state = "cancelled"; state.contactRequests[1].state = "contact_reported"; });
    assert.deepEqual(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).contactRequests, { count: 0, oldestAt: null });
  } finally { store.close(); }
});

test("open proposal metadata counts use the earliest valid history timestamp, without exposing drafts", () => {
  const store = fixtureStore();
  try {
    const pending = proposal("pending");
    pending.history.push({ ...pending.history[0], at: early }, { ...pending.history[0], at: "invalid" });
    store.transaction(state => { state.careProposals.push(pending,
      proposal("needs-review", { state: "needs_review" }), proposal("needs-inputs", { state: "needs_inputs" }),
      proposal("approved", { state: "approved" }), proposal("rejected", { state: "rejected" }),
      proposal("expired", { state: "expired" }), proposal("other-patient", { patientId: "ahmed" })); });
    setScopes(store, ["clinical"]);
    const queue = projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now);
    assert.deepEqual(queue.proposals, { awaitingReview: 2, needsInputs: 1, oldestAt: early });
    assert.equal(queue.oldestPendingAt, early);
    const serialized = JSON.stringify(queue);
    for (const hidden of ["PRIVATE", "contextRevision", "templateId", "needs-review", "pending"]) assert.equal(serialized.includes(hidden), false, hidden);
  } finally { store.close(); }
});

test("an overdue current plan remains waiting after its notification task completed", () => {
  const store = fixtureStore();
  try {
    store.transaction(state => {
      state.carePlans.push({ id: "plan", patientId: "fatma", revision: 2, state: "active", clinicianId: testDoctor.id, profileBindings: [], actionIds: [], reviewDeadline: early });
      state.dueTasks.push({ id: "notification", patientId: "fatma", kind: "review_overdue", phaseKey: "review:plan:2", dueAt: early,
        attempts: 1, state: "completed", leaseOwner: null, leaseUntil: null, guard: currentGuard(state, "fatma"), resourceId: "plan" });
    });
    const queue = projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now);
    assert.deepEqual(queue.planReview, { overdue: true, dueAt: early });
    assert.equal(queue.oldestPendingAt, early);
    store.transaction(state => { state.carePlans[0].reviewDeadline = "2026-10-12T12:00:00.000Z"; });
    assert.equal(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).planReview?.overdue, false);
    assert.equal(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).oldestPendingAt, null);
    store.transaction(state => { state.carePlans[0].reviewDeadline = now; });
    assert.equal(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).planReview?.overdue, true);
    store.transaction(state => { state.carePlans[0].reviewDeadline = null; });
    assert.deepEqual(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).planReview, { overdue: false, dueAt: null });
  } finally { store.close(); }
});

test("blocked protocol count represents only the latest attempt of each current non-revoked policy", () => {
  const store = fixtureStore();
  try {
    store.transaction(state => {
      state.protocols.push(protocol("blocked"), protocol("delivered"), protocol("ordinary"), protocol("new-version"), protocol("revoked", { state: "revoked" }));
      state.protocolApplications.push(
        application("older-block", "blocked", { protocolVersion: 1 }), application("current-block", "blocked"),
        application("stale-block", "delivered"), application("success", "delivered", { state: "delivered", createdAt: later, deliveredAt: later }),
        application("noise", "ordinary"), application("non-trigger", "ordinary", { state: "not_triggered", createdAt: later }),
        application("old-version", "new-version", { protocolVersion: 1 }), application("revoked-block", "revoked"),
        application("other-patient", "blocked", { patientId: "ahmed", createdAt: now }),
      );
    });
    const queue = projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now);
    assert.deepEqual(queue.blockedProtocols, { count: 1, oldestAt: early });
    assert.equal(JSON.stringify(queue).includes("PRIVATE"), false);
    store.transaction(state => { state.protocolApplications.push(application("latest-authorized", "blocked", { state: "authorized", createdAt: later })); });
    assert.deepEqual(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).blockedProtocols, { count: 0, oldestAt: null });
  } finally { store.close(); }
});

test("oldest waiting age includes only currently permitted categories and ignores invalid timestamps", () => {
  const store = fixtureStore();
  try {
    store.transaction(state => {
      state.messages.push(message("hidden-oldest", { createdAt: "2026-10-09T00:00:00.000Z" }));
      state.contactRequests.push(contact("invalid-date", { createdAt: "not-a-date" }));
      state.careProposals.push(proposal("visible"));
    });
    setScopes(store, ["clinical"]);
    assert.equal(projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now).oldestPendingAt, later);
    setScopes(store, ["messages"]);
    const queue = projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now);
    assert.deepEqual(queue.contactRequests, { count: 1, oldestAt: null });
    assert.equal(queue.oldestPendingAt, "2026-10-09T00:00:00.000Z");
  } finally { store.close(); }
});

test("dashboard includes a messages-only specialist without disclosing medical status and follows scope reduction", () => {
  const store = fixtureStore();
  try {
    store.transaction(state => {
      state.careGrants.push({ ...state.careGrants[0], id: "secondary-messages", patientId: "fatma", clinicianId: "secondary", relationship: "specialist", scopes: ["messages"] });
      state.messages.push(message("specialist", { clinicianId: "secondary" }), message("primary"));
      state.careProposals.push(proposal("private-proposal"));
    });
    const specialist = { ...testDoctor, id: "secondary" };
    const service = new CareService(store);
    const patient = service.dashboard(specialist).patients.find(p => p.id === "fatma");
    assert.ok(patient, "An accepted messages-only recipient must see their waiting work");
    assert.equal(patient.status, "unknown");
    assert.equal(patient.monitoring, null);
    assert.equal(patient.rules, null);
    assert.equal(patient.access.canManageCare, false);
    assert.deepEqual(patient.queue.clinicalMessages, { count: 1, oldestAt: early });
    assert.equal(patient.queue.proposals, null);
    assert.deepEqual(service.dashboard(specialist).alerts, []);
    setScopes(store, ["status"]);
    const narrowed = service.dashboard(testDoctor).patients.find(p => p.id === "fatma")!;
    assert.equal(narrowed.queue.clinicalMessages, null);
    assert.equal(narrowed.queue.proposals, null);
    store.transaction(state => { state.careGrants.find(g => g.id === "secondary-messages")!.state = "revoked"; });
    assert.equal(service.dashboard(specialist).patients.length, 0);
    store.transaction(state => { state.patients.find(p => p.id === "fatma")!.consent = false; });
    assert.equal(service.dashboard(testDoctor).patients.some(p => p.id === "fatma"), false);
    assert.throws(() => projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now));
  } finally { store.close(); }
});

test("queue denies patients, revoked grants and disabled clinician accounts", () => {
  const store = fixtureStore();
  try {
    assert.throws(() => projectDoctorQueueSummary(store.read(), testOwner, "fatma", now));
    store.transaction(state => { state.careGrants[0].state = "revoked"; });
    assert.throws(() => projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now));
    store.transaction(state => { state.careGrants[0].state = "active"; state.accounts.find(a => a.id === testDoctor.id)!.enabled = false; });
    assert.throws(() => projectDoctorQueueSummary(store.read(), testDoctor, "fatma", now));
  } finally { store.close(); }
});
