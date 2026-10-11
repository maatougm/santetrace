import test from "node:test";
import assert from "node:assert/strict";
import { CarePlanService } from "../src/lib/care-plan-service";
import { currentGuard } from "../src/lib/patient-access-service";
import { buildAuthorizedEvidence } from "../src/lib/medical-evidence";
import { createDemoMonitoringProfiles } from "../src/lib/monitoring-evaluation";
import type { ReusableProtocol } from "../src/contracts/monitoring";
import { fixtureStore, testOwner, testDoctor } from "./helpers/care-fixture";

const now = "2026-10-11T12:00:00.000Z";
function setup() {
  const store = fixtureStore();
  store.transaction(s => {
    s.monitoringProfiles = createDemoMonitoringProfiles(s.patients[0].rules);
    for (const [id, code, polarity] of [["hypertension", "hypertension", "affirmed"], ["diabetes", "diabetes", "negated"]] as const) {
      s.medicalFacts.push({ id, patientId: "fatma", kind: "condition", code, label: code, value: null, polarity, verification: "patient_reported", sources: [], revision: 1, createdAt: now, supersededBy: null });
    }
  });
  const evidence = buildAuthorizedEvidence(store.read(), testDoctor, "fatma");
  const sources = evidence.sources.filter(s => s.id === "hypertension" || s.kind === "reference");
  store.transaction(s => {
    for (const [id, kind, templateId] of [["home", "home_measurement", "home.blood_pressure"], ["exam", "lab_exam", "exam.clinician_review"]] as const) {
      s.careProposals.push({ id, patientId: "fatma", revision: 1, kind, state: "needs_review", action: { templateId, templateVersion: 1, parameters: {} }, sources, guard: currentGuard(s, "fatma"), decision: null, history: [] });
    }
  });
  const service = new CarePlanService(store, () => now);
  const originalProposals = store.read().careProposals;
  const decide = (id = "home", clientId = "decision-1") => { const p = originalProposals.find(p => p.id === id)!; return service.reviewProposal(testDoctor, id, { decision: "approve", expectedRevision: p.revision, expectedGuard: p.guard, reason: "Revue du dossier", clientId }); };
  return { store, service, decide };
}

test("per-item approval delivers only that item and hides pending exam detail from patient", () => {
  const { store, service, decide } = setup(); try {
    const result = decide();
    assert.equal(result.action?.action.templateId, "home.blood_pressure");
    assert.equal(store.read().careActions.length, 1);
    assert.equal(store.read().careProposals.find(p => p.id === "exam")?.state, "needs_review");
    const patient = service.listProposals(testOwner, "fatma");
    assert.deepEqual(Object.keys(patient.proposals.find(p => p.id === "exam")!).sort(), ["id", "kind", "revision", "state"]);
    assert.equal(service.getPlan(testOwner, "fatma").actions.length, 1);
    assert.equal(store.read().protocols.length, 0);
  } finally { store.close(); }
});

test("stale evidence and forged source references cannot be approved", () => {
  for (const stale of [true, false]) { const { store, decide } = setup(); try {
    store.transaction(s => { if (stale) s.patientRevisions.find(r => r.patientId === "fatma")!.evidenceRevision = 1; else s.careProposals[0].sources[0].revision = 400; });
    assert.throws(() => decide(), (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && ["STALE_CONTEXT", "INVALID_PROPOSAL"].includes(String(e.code))));
    assert.equal(store.read().careActions.length, 0);
  } finally { store.close(); } }
});

test("approval has one decision winner and same-key retry creates no second action", () => {
  const { store, service, decide } = setup(); try {
    const original = store.read().careProposals[0];
    const first = decide();
    assert.equal(decide().action?.id, first.action?.id);
    assert.throws(() => service.reviewProposal(testDoctor, "home", { decision: "reject", expectedRevision: 1, expectedGuard: original.guard, reason: "Concurrent", clientId: "second" }), (e: unknown) => Boolean(e && typeof e === "object" && "status" in e && e.status === 409));
    assert.equal(store.read().careActions.length, 1);
    store.transaction(s => { s.careGrants[0].state = "revoked"; });
    assert.throws(() => decide());
  } finally { store.close(); }
});

test("editing refreshes a stale snapshot and appends a revision before separate approval", () => {
  const { store, service } = setup(); try {
    store.transaction(s => { const r = s.patientRevisions.find(r => r.patientId === "fatma")!; r.contextRevision = 1; r.evidenceRevision = 1; });
    const sources = buildAuthorizedEvidence(store.read(), testDoctor, "fatma").sources.filter(s => s.id === "hypertension" || s.kind === "reference");
    const edit = service.reviseProposal(testDoctor, "home", { action: { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} }, sources, expectedRevision: 1, expectedGuard: currentGuard(store.read(), "fatma"), reason: "Actualisation", clientId: "edit" });
    assert.equal(edit.revision, 2); assert.equal(edit.state, "needs_review"); assert.equal(edit.decision, null);
    assert.equal(edit.guard.contextRevision, 1);
    assert.equal(store.read().careActions.length, 0);
    assert.equal(edit.history.at(-1)?.revision, 2);
    service.reviewProposal(testDoctor, "home", { decision: "approve", expectedRevision: 2, expectedGuard: edit.guard, reason: "Valider", clientId: "after-edit" });
    assert.equal(store.read().careActions.length, 1);
  } finally { store.close(); }
});

test("missing onboarding inputs remain needs_inputs and cannot be approved", () => {
  const { store, service, decide } = setup(); try {
    store.transaction(s => { s.medicalFacts = s.medicalFacts.filter(f => f.code !== "diabetes"); s.careProposals[0].state = "needs_inputs"; });
    assert.throws(() => decide());
    const p = store.read().careProposals[0];
    const edit = service.reviseProposal(testDoctor, p.id, { action: p.action, sources: p.sources, expectedRevision: p.revision, expectedGuard: p.guard, reason: "Revoir", clientId: "edit-missing" });
    assert.equal(edit.state, "needs_inputs"); assert.equal(store.read().careActions.length, 0);
  } finally { store.close(); }
});

test("primary activation binds only matching existing profile versions", () => {
  const { store, service, decide } = setup(); try {
    const plan = decide().plan!;
    const profile = store.read().monitoringProfiles.find(p => p.conditionCodes.includes("hypertension"))!;
    const body = { action: "activate" as const, profileBindings: [{ conditionFactId: "hypertension", profileId: profile.id, profileVersion: profile.version }], expectedRevision: plan.revision, clientId: "activate" };
    assert.throws(() => service.updatePlan(testDoctor, "fatma", { ...body, profileBindings: [{ ...body.profileBindings[0], profileVersion: "invented" }] }));
    const active = service.updatePlan(testDoctor, "fatma", body); assert.equal(active.plan?.state, "active"); assert.equal(active.plan?.revision, plan.revision + 1);
    assert.ok(active.evaluations.some(e => e.conditionFactId === "hypertension"));
    store.transaction(s => { s.careGrants[0].relationship = "generalist"; });
    assert.throws(() => service.updatePlan(testDoctor, "fatma", { ...body, expectedRevision: active.plan!.revision, clientId: "secondary" }));
  } finally { store.close(); }
});

test("no accepted referent yields awaiting_clinician and empty actions", () => {
  const { store, service } = setup(); try {
    store.transaction(s => { s.careGrants[0].state = "revoked"; });
    const result = service.getPlan(testOwner, "fatma");
    assert.equal(result.plan?.state, "awaiting_clinician"); assert.equal(result.plan?.clinicianId, null); assert.deepEqual(result.actions, []);
  } finally { store.close(); }
});

test("a disabled or incompletely authorized referent cannot appear as a ready care team", () => {
  for (const disabled of [true, false]) { const { store, service } = setup(); try {
    store.transaction(s => { if (disabled) s.accounts.find(a => a.id === testDoctor.id)!.enabled = false; else s.careGrants[0].scopes = ["clinical"]; });
    const result = service.getPlan(testOwner, "fatma"); assert.equal(result.plan?.state, "awaiting_clinician"); assert.equal(result.plan?.clinicianId, null);
  } finally { store.close(); } }
});

test("patient action report is attributed, idempotent, and does not mutate approved policy or resolve alert", () => {
  const { store, service, decide } = setup(); try {
    const approved = decide(); const action = approved.action!; const revision = approved.plan!.revision;
    store.transaction(s => s.alerts.push({ id: "unresolved", patientId: "fatma", status: "new", priority: "red", reason: "Seuil haut", ruleVersion: "demo-v1", rulesSnapshot: s.patients[0].rules, createdAt: now, history: [] }));
    const body = { state: "completed" as const, expectedRevision: action.revision, clientId: "reported" };
    const first = service.reportAction(testOwner, action.id, body); const retry = service.reportAction(testOwner, action.id, body);
    assert.equal(first.state, "completed"); assert.deepEqual(first, retry); assert.equal(first.reportedAt, now);
    assert.equal(store.read().carePlans[0].revision, revision);
    assert.equal(store.read().alerts[0].status, "new");
    assert.equal(store.read().dueTasks.find(t => t.resourceId === action.id)?.state, "cancelled");
    assert.throws(() => service.reportAction(testDoctor, action.id, body));
    assert.throws(() => service.reportAction(testOwner, action.id, { ...body, state: "not_completed", clientId: "conflicting" }));
  } finally { store.close(); }
});

test("proposal history retains each prior revision once across repeated edits", () => {
  const { store, service } = setup(); try {
    store.transaction(s => { const p = s.careProposals[0]; p.history.push({ revision: 1, action: structuredClone(p.action), state: p.state, at: now, author: "ai" }); });
    for (let i = 0; i < 2; i++) {
      const p = store.read().careProposals[0];
      service.reviseProposal(testDoctor, p.id, { action: p.action, sources: p.sources, expectedRevision: p.revision, expectedGuard: currentGuard(store.read(), "fatma"), reason: "Édition", clientId: `edit-${i}` });
    }
    assert.deepEqual(store.read().careProposals[0].history.map(h => h.revision), [1, 2, 3]);
  } finally { store.close(); }
});

test("plan changes suspend reusable protocols but action reports leave them intact", () => {
  const { store, service, decide } = setup(); try {
    const result = decide();
    store.transaction(s => s.protocols.push({ id: "repeat", patientId: "fatma", state: "active", revision: 1 } as ReusableProtocol));
    service.reportAction(testOwner, result.action!.id, { state: "completed", expectedRevision: 1, clientId: "done" });
    assert.equal(store.read().protocols[0].state, "active");
    service.updatePlan(testDoctor, "fatma", { action: "suspend", profileBindings: [], expectedRevision: result.plan!.revision, clientId: "stop" });
    assert.equal(store.read().protocols[0].state, "suspended");
  } finally { store.close(); }
});

test("unknown mutation fields and unregistered action parameters are rejected", () => {
  const { store, service } = setup(); try {
    const p = store.read().careProposals[0];
    const invalid = (e: unknown) => Boolean(e && typeof e === "object" && "status" in e && e.status === 400);
    assert.throws(() => service.reviewProposal(testDoctor, p.id, { decision: "approve", expectedRevision: 1, expectedGuard: p.guard, reason: "Revue", clientId: "inject", authority: "primary" } as never), invalid);
    assert.throws(() => service.reviseProposal(testDoctor, p.id, { action: { ...p.action, parameters: { medication: "unsafe" } }, sources: p.sources, expectedRevision: 1, expectedGuard: p.guard, reason: "Revue", clientId: "bad-template" }), invalid);
    assert.equal(store.read().careActions.length, 0);
  } finally { store.close(); }
});
test("an existing active plan loses ready-team state when its primary is disabled or incompletely authorized", () => {
  for (const disabled of [true, false]) { const { store, service, decide } = setup(); try {
    const plan = decide().plan!, profile = store.read().monitoringProfiles[0];
    service.updatePlan(testDoctor, "fatma", { action: "activate", profileBindings: [{ conditionFactId: "hypertension", profileId: profile.id, profileVersion: profile.version }], expectedRevision: plan.revision, clientId: "activate-existing" });
    const priorRevision = store.read().carePlans[0].revision;
    store.transaction(s => { if (disabled) s.accounts.find(a => a.id === testDoctor.id)!.enabled = false; else s.careGrants[0].scopes = ["clinical"]; });
    const result = service.getPlan(testOwner, "fatma"); assert.equal(result.plan?.state, "awaiting_clinician"); assert.equal(result.plan?.clinicianId, null); assert.ok(result.plan!.revision > priorRevision);
    store.transaction(s => { s.accounts.find(a => a.id === testDoctor.id)!.enabled = true; s.careGrants[0].scopes = ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"]; });
    assert.equal(service.getPlan(testOwner, "fatma").plan?.state, "awaiting_clinician", "restoration needs new explicit activation");
  } finally { store.close(); } }
});
