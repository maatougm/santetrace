import test from "node:test";
import assert from "node:assert/strict";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";
import { buildAuthorizedEvidence } from "../src/lib/medical-evidence";
import { currentGuard, bumpPatientRevision } from "../src/lib/patient-access-service";
import * as module from "../src/lib/assistant-service";
const now = "2026-10-11T12:00:00.000Z";
function setup() {
  assert.equal(typeof module.AssistantService, "function", "approved assistant service must exist");
  const store = fixtureStore();
  store.transaction(s => {
    s.patients[0].language = "fr";
    s.carePlans.push({ id: "plan", patientId: "fatma", revision: 1, state: "active", clinicianId: testDoctor.id, profileBindings: [], actionIds: ["action"], reviewDeadline: null });
    const action = { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} };
    s.careProposals.push({ id: "approved", patientId: "fatma", revision: 2, kind: "home_measurement", state: "approved", action, sources: buildAuthorizedEvidence(s, testDoctor, "fatma").sources, guard: currentGuard(s, "fatma"), decision: { clinicianId: testDoctor.id, at: now, reason: "Revue" }, history: [] });
    s.careActions.push({ id: "action", patientId: "fatma", planId: "plan", revision: 1, proposalId: "approved", protocolId: null, originVersion: 2, action, dueAt: now, state: "pending", reportedAt: null, clientId: "a", createdAt: now });
  });
  return { store, assistant: new module.AssistantService(store, () => now) };
}
test("closed query returns only current exact approved instruction and deterministic metadata", () => {
  const f = setup(); try { const r = f.assistant.respond(testOwner, "fatma", { kind: "record_query", topic: "next_action", clientId: "next" }); assert.equal(r.replyKind, "approved_action"); assert.equal(r.answer, "Mesurer la tension selon le plan approuvé."); assert.equal(r.approvedActions[0].id, "action"); assert.equal(r.meta.mode, "deterministic"); assert.equal(r.meta.model, null); } finally { f.store.close(); }
});
test("medical question creates one actual unassessed message, no invented treatment answer", () => {
  const f = setup(); try { const body = { kind: "question" as const, question: "Puis-je doubler ma dose ?", clientId: "question" }; const r = f.assistant.respond(testOwner, "fatma", body), replay = f.assistant.respond(testOwner, "fatma", body); assert.equal(r.replyKind, "needs_clinician"); assert.ok(r.messageId); assert.equal(replay.messageId, r.messageId); assert.equal(f.store.read().messages.length, 1); assert.equal(f.store.read().messages[0].text, body.question); assert.equal(f.store.read().patientRevisions[0].contextRevision, 1); assert.deepEqual(r.approvedActions, []); assert.doesNotMatch(r.answer, /doubler/); } finally { f.store.close(); }
});
test("no accepted referent yields unavailable without a fictional recipient or sent promise", () => {
  const f = setup(); try { f.store.transaction(s => { s.careGrants[0].state = "revoked"; }); const r = f.assistant.respond(testOwner, "fatma", { kind: "health_update", question: "Mal à la tête", clientId: "message" }); assert.equal(r.replyKind, "unavailable"); assert.equal(r.messageId, null); assert.equal(f.store.read().messages.length, 0); assert.deepEqual(r.approvedActions, []); } finally { f.store.close(); }
});
test("unresolved red always returns fixed emergency guidance and never inserts an AI message", () => {
  const f = setup(); try { f.store.transaction(s => s.alerts.push({ id: "red", patientId: "fatma", status: "acknowledged", priority: "red", reason: "Unresolved", ruleVersion: "demo-v1", rulesSnapshot: s.patients[0].rules, createdAt: now, history: [] })); const r = f.assistant.respond(testOwner, "fatma", { kind: "question", question: "Comment changer ma dose ?", clientId: "red" }); assert.equal(r.replyKind, "needs_clinician"); assert.match(r.answer, /urgences locales/); assert.deepEqual(r.approvedActions, []); assert.equal(r.messageId, null); assert.equal(f.store.read().messages.length, 0); } finally { f.store.close(); }
});
test("changed clinical context prevents assistant reuse of a once-approved instruction", () => {
  const f = setup(); try { f.store.transaction(s => bumpPatientRevision(s, "fatma", "context")); const r = f.assistant.respond(testOwner, "fatma", { kind: "record_query", topic: "next_action", clientId: "next" }); assert.deepEqual(r.approvedActions, []); assert.equal(r.replyKind, "needs_clinician"); } finally { f.store.close(); }
});
test("fixed Arabic text works and patient query never leaks pending examination proposals", () => {
  const f = setup(); try { f.store.transaction(s => { s.patients[0].language = "ar"; s.careProposals.push({ ...s.careProposals[0], id: "hidden-exam-proposal", kind: "lab_exam", state: "needs_review", action: { templateId: "exam.clinician_review", templateVersion: 1, parameters: {} } }); }); const r = f.assistant.respond(testOwner, "fatma", { kind: "record_query", topic: "next_action", clientId: "next" }); assert.equal(r.answer, "قياس ضغط الدم حسب الخطة المعتمدة."); assert.doesNotMatch(JSON.stringify(r), /hidden-exam-proposal|exam.clinician_review/); } finally { f.store.close(); }
});
test("withdrawn processing consent denies new assistant messages and unauthorized actor cannot query", () => {
  const f = setup(); try { assert.throws(() => f.assistant.respond({ ...testDoctor, id: "secondary" }, "fatma", { kind: "record_query", topic: "plan_status", clientId: "x" })); f.store.transaction(s => { s.patients[0].consent = false; }); assert.throws(() => f.assistant.respond(testOwner, "fatma", { kind: "question", question: "Que faire ?", clientId: "question" })); assert.equal(f.store.read().messages.length, 0); } finally { f.store.close(); }
});
