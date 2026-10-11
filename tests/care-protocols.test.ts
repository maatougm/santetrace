import test from "node:test";
import assert from "node:assert/strict";
import type { EligibilityInput, ProtocolAuthorization } from "../src/contracts/monitoring";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";
import { buildAuthorizedEvidence } from "../src/lib/medical-evidence";
import { createDemoMonitoringProfiles } from "../src/lib/monitoring-evaluation";
import { bumpPatientRevision, currentGuard, PatientAccessService } from "../src/lib/patient-access-service";
import { SHARING_SCOPES } from "../src/contracts/patient-platform";
import { ingestReading } from "../src/lib/care-service";
import { CarePlanService } from "../src/lib/care-plan-service";
import { InterventionService } from "../src/lib/intervention-service";
import { MonitoringAiService } from "../src/lib/monitoring-ai-service";
import * as module from "../src/lib/protocol-service";
const now = "2026-10-11T12:00:00.000Z";
function setup() {
  assert.equal(typeof module.ProtocolService, "function", "reusable authorization service must exist");
  const store = fixtureStore(); let at = now;
  store.transaction(s => {
    s.monitoringProfiles = createDemoMonitoringProfiles(s.patients[0].rules);
    for (const [id, polarity] of [["hypertension", "affirmed"], ["diabetes", "negated"], ["symptom", "negated"]] as const) s.medicalFacts.push({ id, patientId: "fatma", kind: id === "symptom" ? "symptom" : "condition", code: id, label: id, value: null, polarity, verification: "patient_reported", sources: [], revision: 1, createdAt: now, supersededBy: null });
    const profile = s.monitoringProfiles[0];
    s.carePlans.push({ id: "plan", patientId: "fatma", revision: 2, state: "active", clinicianId: testDoctor.id, profileBindings: [{ conditionFactId: "hypertension", profileId: profile.id, profileVersion: profile.version }], actionIds: ["original"], reviewDeadline: null });
    const action = { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} };
    s.careProposals.push({ id: "home", patientId: "fatma", revision: 2, kind: "home_measurement", state: "approved", action, sources: buildAuthorizedEvidence(s, testDoctor, "fatma").sources.filter(r => r.id === "hypertension" || r.kind === "reference"), guard: currentGuard(s, "fatma"), decision: { clinicianId: testDoctor.id, at: now, reason: "Revue" }, history: [] });
    s.careActions.push({ id: "original", patientId: "fatma", planId: "plan", revision: 1, proposalId: "home", protocolId: null, originVersion: 2, action, dueAt: now, state: "completed", reportedAt: now, clientId: "original", createdAt: now });
    ingestReading(s, "fatma", { kind: "blood_pressure", systolic: 145, diastolic: 92, unit: "mmHg", measuredAt: now, clientId: "reading1" }, "app", undefined, at);
  });
  const service = new module.ProtocolService(store, () => at);
  const body = (): ProtocolAuthorization => ({ sourceProposalId: "home", actions: [store.read().careProposals[0].action], predicates: [{ kind: "priority_equals", conditionFactId: "hypertension", value: "orange" }, { kind: "requirements_complete", requirementIds: ["demo_blood_pressure:reading"] }], exclusions: [{ kind: "fact_equals", factId: "symptom", polarity: "affirmed" }], stopCriteria: [], validUntil: "2026-10-12T12:00:00.000Z", minIntervalSeconds: 60, maxApplications: 2, expectedGuard: currentGuard(store.read(), "fatma"), clientId: "authorize" });
  const authorize = () => service.authorize(testDoctor, "fatma", body());
  const reading = (id: string, offset = 61000, systolic = 145) => { at = new Date(Date.parse(at) + offset).toISOString(); return store.transaction(s => ingestReading(s, "fatma", { kind: "blood_pressure", systolic, diastolic: 92, unit: "mmHg", measuredAt: at, clientId: id }, "app", undefined, at)).measurement; };
  const eligibility = (id: string): EligibilityInput => { const s = store.read(); return { protocol: s.protocols.find(p => p.id === id)!, plan: s.carePlans[0], guard: currentGuard(s, "fatma"), profiles: s.monitoringProfiles, hasCurrentAuthority: true, hasUnassessedContext: false, consent: true, evidence: buildAuthorizedEvidence(s, testDoctor, "fatma"), evaluations: s.conditionEvaluations.filter(e => e.patientId === "fatma"), applications: s.protocolApplications, unresolved: s.alerts.filter(a => a.patientId === "fatma") }; };
  const apply = (id: string, trigger: string, options?: Parameters<typeof service.apply>[4]) => service.apply(id, trigger, currentGuard(store.read(), "fatma"), at, options);
  return { store, service, body, authorize, reading, eligibility, apply, at: () => at, advanceTo: (value: string) => { at = value; } };
}
test("approval once creates no recurring authority; explicit primary authorization creates unchanged home protocol", () => {
  const f = setup(); try { assert.equal(f.store.read().protocols.length, 0); const p = f.authorize(); assert.equal(p.state, "active"); assert.equal(p.requiredContextRevision, 0); assert.equal(p.carePlanRevision, 2); assert.equal(f.authorize().id, p.id); assert.equal(f.store.read().protocols.length, 1); } finally { f.store.close(); }
});
test("patient, secondary doctor, wrong-patient proposal and new medication/exam templates cannot authorize reuse", () => {
  const f = setup(); try {
    for (const actor of [testOwner, { ...testDoctor, id: "secondary" }]) assert.throws(() => f.service.authorize(actor, "fatma", f.body()));
    assert.throws(() => f.service.authorize(testDoctor, "ahmed", f.body()));
    for (const templateId of ["exam.clinician_review", "dose.change", "home.glucose"]) assert.throws(() => f.service.authorize(testDoctor, "fatma", { ...f.body(), actions: [{ templateId, templateVersion: 1, parameters: {} }] }));
    assert.equal(f.store.read().protocols.length, 0);
  } finally { f.store.close(); }
});
test("fresh recurring evidence creates one attributed action without rewriting approved policy", async () => {
  const f = setup(); try {
    const p = f.authorize(), first = f.store.read().measurements[0];
    const [a, b] = await Promise.all([f.apply(p.id, first.id), f.apply(p.id, first.id)]);
    assert.equal(a.state, "delivered"); assert.equal(a.id, b.id); assert.equal(f.store.read().careActions.length, 2);
    assert.equal(a.protocolVersion, 1); assert.ok(a.sources.some(s => s.id === first.id));
    new CarePlanService(f.store, f.at).reportAction(testOwner, a.actionId!, { state: "completed", expectedRevision: 1, clientId: "done" });
    const second = f.reading("second"), result = await f.apply(p.id, second.id);
    assert.equal(result.state, "delivered"); assert.equal(result.guard.evidenceRevision, 2); assert.equal(f.store.read().carePlans[0].revision, 2); assert.deepEqual(f.store.read().carePlans[0].actionIds, ["original"]);
    assert.equal(f.store.read().messages.filter(m => m.kind === "approved_action").length, 2);
  } finally { f.store.close(); }
});
test("a direct non-trigger records a neutral outcome without requesting review or clinical delivery", async () => {
  const f = setup(); try {
    const p = f.authorize(), at = "2026-10-11T12:01:01.000Z";
    f.advanceTo(at);
    const reading = f.store.transaction(s => ingestReading(s, "fatma", { kind: "blood_pressure", systolic: 120, diastolic: 80, unit: "mmHg", measuredAt: at, clientId: "direct-ordinary" }, "app", undefined, at)).measurement;
    const result = await f.apply(p.id, reading.id);
    assert.equal(result.state, "not_triggered");
    assert.equal(result.actionId, null);
    assert.equal(result.deliveredAt, null);
    assert.equal(f.store.read().conditionEvaluations[0].priority, "unknown");
    assert.equal(f.store.read().dueTasks.filter(t => t.kind === "review_overdue").length, 0);
    assert.equal(f.store.read().messages.length, 0);
    assert.equal((await f.apply(p.id, reading.id)).id, result.id, "the non-trigger attempt is idempotent");
  } finally { f.store.close(); }
});
test("below-trigger readings do not conceal safety-relevant expiry, red episodes, or changed context", async () => {
  for (const change of ["expired", "red", "context", "unknown_reading"] as const) {
    const f = setup(); try {
      const p = f.authorize(), at = "2026-10-11T12:01:01.000Z";
      f.advanceTo(at);
      const reading = f.store.transaction(s => {
        const result = ingestReading(s, "fatma", { kind: "blood_pressure", systolic: 120, diastolic: 80, unit: "mmHg", measuredAt: at, clientId: `safety-${change}` }, "app", undefined, at).measurement;
        if (change === "red") s.alerts.push({ id: "open-red", patientId: "fatma", priority: "red", status: "new", reason: "Fictional unresolved red", ruleVersion: s.patients[0].rules.version, rulesSnapshot: s.patients[0].rules, createdAt: at, history: [] });
        if (change === "context") bumpPatientRevision(s, "fatma", "context");
        if (change === "unknown_reading") s.measurements.find(m => m.id === result.id)!.status = "unknown";
        return result;
      });
      if (change === "expired") f.advanceTo("2026-10-12T12:00:01.000Z");
      const application = await f.apply(p.id, reading.id);
      assert.equal(application.state, "blocked", change);
      assert.ok(application.reasons.includes(change === "expired" ? "protocol_expired" : change === "red" ? "unresolved_red" : change === "context" ? "changed_approved_context" : "unknown_predicate"), change);
      assert.equal(f.store.read().dueTasks.filter(t => t.kind === "review_overdue").length, 1, change);
      assert.equal(f.store.read().messages.filter(m => m.kind === "approved_action").length, 0, change);
    } finally { f.store.close(); }
  }
});
test("protocol action projections distinguish current approval, expiry and suspension from progress", async () => {
  for (const change of ["expiry", "suspension", "completion"] as const) {
    const f = setup(); try {
      const p = f.authorize(), application = await f.apply(p.id, f.store.read().measurements[0].id);
      const plans = new CarePlanService(f.store, f.at);
      assert.equal(plans.getPlan(testOwner, "fatma").actions.find(a => a.id === application.actionId)?.approval?.currentlyApproved, true);
      if (change === "expiry") f.advanceTo("2026-10-12T12:00:01.000Z");
      if (change === "suspension") f.service.setState(testDoctor, p.id, { action: "suspend", expectedRevision: 1, reason: "Explicit stop", clientId: "project-suspend" });
      if (change === "completion") plans.reportAction(testOwner, application.actionId!, { state: "completed", expectedRevision: 1, clientId: "project-completion" });
      const action = plans.getPlan(testOwner, "fatma").actions.find(a => a.id === application.actionId)!;
      assert.equal(action.approval?.currentlyApproved, false);
      assert.ok(action.approval?.reasons.includes(change === "expiry" ? "protocol_expired" : change === "suspension" ? "protocol_inactive" : "action_not_pending"));
      assert.equal(action.state, change === "completion" ? "completed" : "pending");
      assert.equal(Object.hasOwn(f.store.read().careActions.find(a => a.id === action.id)!, "approval"), false);
    } finally { f.store.close(); }
  }
});
test("arbitrary or old trigger IDs cannot create actions", async () => {
  const f = setup(); try { const p = f.authorize(), old = f.store.read().measurements[0]; const latest = f.reading("new"); await assert.rejects(() => f.apply(p.id, "random")); const blocked = await f.apply(p.id, old.id); assert.equal(blocked.state, "blocked"); assert.equal((await f.apply(p.id, latest.id)).state, "delivered"); assert.equal(f.store.read().careActions.length, 2); } finally { f.store.close(); }
});
test("cooldown and total count survive clinician protocol revisions", async () => {
  const f = setup(); try {
    const p = f.authorize(); await f.apply(p.id, f.store.read().measurements[0].id);
    const early = f.reading("early", 1000); assert.equal((await f.apply(p.id, early.id)).state, "blocked");
    const revised = f.service.revise(testDoctor, p.id, { ...f.body(), expectedRevision: 1, reason: "Nouvelle revue", clientId: "revise" }); assert.equal(revised.revision, 2);
    const second = f.reading("second", 60000); assert.equal((await f.apply(p.id, second.id)).state, "delivered");
    const third = f.reading("third", 60000); const blocked = await f.apply(p.id, third.id); assert.equal(blocked.state, "blocked"); assert.ok(blocked.reasons.includes("application_limit"));
  } finally { f.store.close(); }
});
test("missing or uncertain exclusions fail closed; high-only pack coverage limit does not prevent scoped follow-up", () => {
  const f = setup(); try {
    const p = f.authorize(); assert.equal(module.evaluateEligibility(f.eligibility(p.id), f.at()).eligible, true);
    f.store.transaction(s => { s.medicalFacts.find(x => x.id === "symptom")!.polarity = "unknown"; });
    const unknown = module.evaluateEligibility(f.eligibility(p.id), f.at()); assert.equal(unknown.eligible, false); assert.ok(unknown.reasons.includes("unknown_exclusion"));
    f.store.transaction(s => { s.medicalFacts = s.medicalFacts.filter(x => x.id !== "symptom"); }); assert.equal(module.evaluateEligibility(f.eligibility(p.id), f.at()).eligible, false);
  } finally { f.store.close(); }
});
test("red episode, stale measurement, profile change, expired or incomplete authority blocks recurrence", async () => {
  for (const change of ["red", "stale", "profile", "expired", "authority"] as const) {
    const f = setup(); try { const p = f.authorize(); let input = f.eligibility(p.id), at = f.at();
      if (change === "red") f.store.transaction(s => s.alerts.push({ id: "red", patientId: "fatma", priority: "red", status: "acknowledged", reason: "Unresolved", ruleVersion: "demo-v1", rulesSnapshot: s.patients[0].rules, createdAt: now, history: [] }));
      if (change === "profile") input.guard.profileVersions = ["changed"];
      if (change === "authority") input.hasCurrentAuthority = false;
      if (change === "expired") at = "2026-10-13T12:00:00.000Z";
      if (change === "stale") at = "2026-10-12T12:00:00.000Z";
      if (change === "red") input = f.eligibility(p.id);
      assert.equal(module.evaluateEligibility(input, at).eligible, false, change);
    } finally { f.store.close(); }
  }
});
test("changed context suspends reuse and message review alone never restores it", async () => {
  const f = setup(); try {
    const p = f.authorize(), messaging = new InterventionService(f.store, f.at);
    const message = messaging.sendMessage(testOwner, "fatma", { text: "Nouveau symptôme", kind: "clinical", clinicianId: testDoctor.id, clientId: "symptom" });
    assert.equal(f.store.read().protocols[0].state, "suspended");
    messaging.reviewMessage(testDoctor, message.id, { expectedRevision: 1, expectedGuard: currentGuard(f.store.read(), "fatma"), reason: "Revue", clientId: "review" });
    assert.equal(f.store.read().protocols[0].state, "suspended");
    assert.equal((await f.apply(p.id, f.store.read().measurements[0].id)).state, "blocked");
    const revised = f.service.revise(testDoctor, p.id, { ...f.body(), expectedRevision: f.store.read().protocols[0].revision, reason: "Réautoriser après revue", clientId: "new-version" }); assert.equal(revised.state, "active"); assert.equal(revised.requiredContextRevision, 1);
  } finally { f.store.close(); }
});
test("revocation during held delivery prevents commit and previous replay cannot release after authority loss", async () => {
  const f = setup(); try {
    const p = f.authorize(), trigger = f.store.read().measurements[0].id;
    const result = await f.apply(p.id, trigger, { beforeCommit: async () => { f.store.transaction(s => { s.careGrants[0].state = "revoked"; bumpPatientRevision(s, "fatma", "authority"); }); } });
    assert.equal(result.state, "blocked"); assert.equal(f.store.read().careActions.length, 1); assert.equal(f.store.read().messages.length, 0);
    await assert.rejects(() => f.apply(p.id, trigger));
  } finally { f.store.close(); }
});
test("protocol edits validate current guards and bounded closed predicates", () => {
  const f = setup(); try {
    for (const predicates of [[], [{ kind: "similarity", threshold: 0.99 }], [{ kind: "priority_equals", conditionFactId: "ahmed-fact", value: "orange" }]]) assert.throws(() => f.service.authorize(testDoctor, "fatma", { ...f.body(), predicates } as never));
    const p = f.authorize(); f.store.transaction(s => bumpPatientRevision(s, "fatma", "evidence"));
    assert.throws(() => f.service.revise(testDoctor, p.id, { ...f.body(), expectedGuard: p ? { ...f.body().expectedGuard, evidenceRevision: 1 } : f.body().expectedGuard, expectedRevision: 1, reason: "Revoir", clientId: "stale" }));
  } finally { f.store.close(); }
});
test("authorization replay returns current suspended state after clinical context changes", () => {
  const f = setup(); try {
    const body = f.body(); const p = f.service.authorize(testDoctor, "fatma", body);
    f.store.transaction(s => bumpPatientRevision(s, "fatma", "context"));
    const replay = f.service.authorize(testDoctor, "fatma", body);
    assert.equal(replay.id, p.id); assert.equal(replay.state, "suspended"); assert.equal(replay.revision, 2);
  } finally { f.store.close(); }
});
test("delivered application replay cannot release an expired or revoked protocol", async () => {
  for (const revoke of [true, false]) { const f = setup(); try {
    const p = f.authorize(), trigger = f.store.read().measurements[0].id;
    await f.apply(p.id, trigger);
    if (revoke) f.service.setState(testDoctor, p.id, { action: "revoke", expectedRevision: 1, reason: "Arrêt", clientId: "revoke" });
    await assert.rejects(() => f.service.apply(p.id, trigger, currentGuard(f.store.read(), "fatma"), revoke ? now : "2026-10-13T12:00:00.000Z"));
    assert.equal(f.store.read().careActions.length, 2);
  } finally { f.store.close(); } }
});
test("held delivery rejects a clinician protocol change even when patient evidence stayed identical", async () => {
  const f = setup(); try {
    const p = f.authorize(); const result = await f.apply(p.id, f.store.read().measurements[0].id, { beforeCommit: async () => { f.service.setState(testDoctor, p.id, { action: "suspend", expectedRevision: 1, reason: "Arrêt", clientId: "hold" }); } });
    assert.equal(result.state, "blocked"); assert.ok(result.reasons.includes("changed_delivery_guard")); assert.equal(f.store.read().careActions.length, 1);
  } finally { f.store.close(); }
});
test("absence of the exact immutable requirement policy fails closed", () => {
  const f = setup(); try { const p = f.authorize(), input = f.eligibility(p.id); delete input.profiles; assert.equal(module.evaluateEligibility(input, now).eligible, false); } finally { f.store.close(); }
});
test("delivered version resolves its immutable complete approved policy after revision and suspension", async () => {
  const f = setup(); try {
    const p = f.authorize(), application = await f.apply(p.id, f.store.read().measurements[0].id);
    const original = f.store.read().protocols[0].history.find(h => h.revision === application.protocolVersion)?.snapshot;
    assert.ok(original, "each applied version needs a full approved snapshot");
    assert.equal(original.policy.minIntervalSeconds, 60); assert.equal(original.policy.maxApplications, 2);
    assert.equal(original.sourceProposal.revision, 2); assert.deepEqual(original.sourceProposal.guard, f.store.read().careProposals[0].guard);
    const revised = f.service.revise(testDoctor, p.id, { ...f.body(), expectedRevision: 1, reason: "Nouveau périmètre approuvé", minIntervalSeconds: 120, maxApplications: 5, clientId: "policy-revision" });
    const suspended = f.service.setState(testDoctor, p.id, { action: "suspend", expectedRevision: revised.revision, reason: "Revue clinique requise", clientId: "policy-suspension" });
    assert.deepEqual(suspended.history.find(h => h.revision === 1)?.snapshot, original);
    assert.equal(suspended.history.find(h => h.revision === 2)?.snapshot?.policy.minIntervalSeconds, 120);
    assert.equal(suspended.history.find(h => h.revision === 3)?.snapshot?.policy.state, "suspended");
    assert.equal(suspended.history.find(h => h.revision === 3)?.reason, "Revue clinique requise");
  } finally { f.store.close(); }
});
test("context suspension retains the old approval and records the suspension version", () => {
  const f = setup(); try { const p = f.authorize(); f.store.transaction(s => bumpPatientRevision(s, "fatma", "context")); const suspended = f.store.read().protocols.find(x => x.id === p.id)!; assert.ok(suspended.history.find(h => h.revision === 1)?.snapshot); assert.equal(suspended.history.find(h => h.revision === 2)?.snapshot?.policy.state, "suspended"); } finally { f.store.close(); }
});
test("held operation reevaluates protocol expiry and evidence freshness at current commit time", async () => {
  for (const expiry of [true, false]) { const f = setup(); try {
    const body = f.body(); if (expiry) body.validUntil = "2026-10-11T12:00:00.005Z"; else body.predicates.push({ kind: "evidence_fresh", requirementId: "demo_blood_pressure:reading", maxAgeSeconds: 1 });
    const p = f.service.authorize(testDoctor, "fatma", body);
    const r = await f.apply(p.id, f.store.read().measurements[0].id, { beforeCommit: async () => { f.advanceTo(expiry ? "2026-10-11T12:00:00.030Z" : "2026-10-11T12:00:01.000Z"); } });
    assert.equal(r.state, "blocked"); assert.ok(r.reasons.includes(expiry ? "protocol_expired" : "unknown_predicate")); assert.equal(r.deliveredAt, null); assert.equal(f.store.read().careActions.length, 1);
  } finally { f.store.close(); } }
});
test("a frozen injected clock cannot hide real elapsed delivery time", async () => {
  const f = setup(); try {
    const p = f.service.authorize(testDoctor, "fatma", { ...f.body(), validUntil: "2026-10-11T12:00:00.005Z" });
    const r = await f.apply(p.id, f.store.read().measurements[0].id, { beforeCommit: () => new Promise<void>(resolve => setTimeout(resolve, 30)) });
    assert.equal(r.state, "blocked"); assert.ok(r.reasons.includes("protocol_expired"));
  } finally { f.store.close(); }
});
test("replay release checks current time rather than a supplied original timestamp", async () => {
  const f = setup(); try {
    const p = f.authorize(), trigger = f.store.read().measurements[0].id; await f.apply(p.id, trigger);
    f.advanceTo("2026-10-13T12:00:00.000Z");
    await assert.rejects(() => f.service.apply(p.id, trigger, currentGuard(f.store.read(), "fatma"), now));
  } finally { f.store.close(); }
});
test("held delivery cannot outlive the approved plan review deadline", async () => {
  const f = setup(); try { f.store.transaction(s => { s.carePlans[0].reviewDeadline = "2026-10-11T12:00:01.000Z"; }); const p = f.authorize(); const result = await f.apply(p.id, f.store.read().measurements[0].id, { beforeCommit: async () => { f.advanceTo("2026-10-11T12:00:01.010Z"); } }); assert.equal(result.state, "blocked"); assert.ok(result.reasons.includes("plan_review_overdue")); } finally { f.store.close(); }
});
test("delivered replay fails once current evidence no longer satisfies its approved freshness predicate", async () => {
  const f = setup(); try { const body = f.body(); body.predicates.push({ kind: "evidence_fresh", requirementId: "demo_blood_pressure:reading", maxAgeSeconds: 1 }); const p = f.service.authorize(testDoctor, "fatma", body), trigger = f.store.read().measurements[0].id; await f.apply(p.id, trigger); f.advanceTo("2026-10-11T12:00:01.100Z"); await assert.rejects(() => f.service.apply(p.id, trigger, currentGuard(f.store.read(), "fatma"), now)); } finally { f.store.close(); }
});
test("current cooldown is evaluated after held delivery and delivery attribution records that current time", async () => {
  const f = setup(); try {
    const p = f.authorize(); await f.apply(p.id, f.store.read().measurements[0].id);
    const next = f.reading("next-before-cooldown", 59000);
    const result = await f.apply(p.id, next.id, { beforeCommit: async () => { f.advanceTo("2026-10-11T12:01:01.000Z"); } });
    assert.equal(result.state, "delivered"); assert.ok(Date.parse(result.deliveredAt!) >= Date.parse("2026-10-11T12:01:01.000Z"));
  } finally { f.store.close(); }
});
test("immutable protocol audit sources require composite rights and never leak private PDF text to clinical-only secondary", () => {
  const f = setup(); try {
    const quote = "Private synthetic lab excerpt HbA1c 8.4 %";
    f.store.transaction(s => {
      s.documents.push({ id: "private-document", patientId: "fatma", filename: "private.pdf", contentHash: "a".repeat(64), uploadedAt: now, status: "review" });
      s.candidates.push({ id: "private-candidate", documentId: "private-document", patientId: "fatma", exam: "HbA1c", value: 8.4, unit: "%", examDate: now, page: 1, sourceText: quote, confidence: "medium", confidenceReason: "Synthetic fixture", identityMatch: "matched", status: "proposed" });
      const evidence = buildAuthorizedEvidence(s, testDoctor, "fatma"); s.careProposals[0].sources.push(evidence.sources.find(source => source.id === "private-candidate")!);
      s.careGrants.push({ ...s.careGrants[0], id: "clinical-only", clinicianId: "secondary", relationship: "specialist", scopes: ["clinical"] });
    });
    const p = f.authorize();
    assert.equal(f.service.list(testDoctor, "fatma").protocols[0].history[0].snapshot?.sourceProposal.sources.find(s => s.kind === "candidate")?.quote, quote);
    assert.throws(() => f.service.list({ ...testDoctor, id: "secondary" }, "fatma"), (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === "FORBIDDEN"));
    f.store.transaction(s => { s.patients[0].consent = false; });
    assert.equal(f.service.list(testOwner, "fatma").protocols.find(x => x.id === p.id)?.history[0].snapshot?.sourceProposal.sources.find(s => s.kind === "candidate")?.quote, quote, "owner retains existing audit history after processing withdrawal");
  } finally { f.store.close(); }
});
test("replacement primary can explicitly approve new reuse after reviewing the exact forwarded source without inheriting former approval", async () => {
  const f = setup(); try {
    const formerProtocol = f.authorize(), next = { ...testDoctor, id: "next-primary" }, messaging = new InterventionService(f.store, f.at), access = new PatientAccessService(f.store, () => Date.parse(f.at())), plans = new CarePlanService(f.store, f.at);
    f.store.transaction(s => {
      s.accounts.push({ ...next, login: "next.primary", passwordHash: "test-only", enabled: true, sessionVersion: 1, createdAt: now });
      s.careGrants.push({ ...s.careGrants[0], id: "secondary-messages", clinicianId: "secondary", relationship: "specialist", scopes: ["messages"] });
    });
    const original = messaging.sendMessage(testOwner, "fatma", { clinicianId: "secondary", text: "Contexte patient transmis explicitement", kind: "clinical", clientId: "source" });
    const orphan = messaging.forwardMessage(testOwner, original.id, { clinicianId: testDoctor.id, clientId: "former-copy" });
    access.update(testOwner, "grant:fatma", { action: "revoke", expectedRevision: 1, clientId: "revoke" });
    const issued = access.issue(testOwner, "fatma", { targetClinicianId: next.id, relationship: "primary", scopes: [...SHARING_SCOPES], clientId: "new-grant" });
    access.accept(next, { token: issued.invitationToken!, clientId: "accept" });
    const copy = messaging.forwardMessage(testOwner, original.id, { clinicianId: next.id, clientId: "current-copy" });
    messaging.reviewMessage(next, copy.id, { expectedRevision: copy.revision, expectedGuard: currentGuard(f.store.read(), "fatma"), reason: "Revue exacte de la source transmise", clientId: "review" });
    assert.equal(f.store.read().protocols.find(p => p.id === formerProtocol.id)?.state, "suspended");
    const plan = plans.getPlan(next, "fatma").plan!;
    plans.updatePlan(next, "fatma", { action: "activate", profileBindings: plan.profileBindings, expectedRevision: plan.revision, clientId: "activate" });
    assert.throws(() => f.service.authorize(next, "fatma", { ...f.body(), clientId: "old-source" }), (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === "APPROVED_HOME_ACTION_REQUIRED"));
    const generated = await new MonitoringAiService(f.store, undefined, f.at).generateProposals(next, "fatma", { clientId: "new-draft" });
    const draft = generated.proposals.find(p => p.kind === "home_measurement");
    assert.ok(draft && "guard" in draft, "current primary receives the actual full proposal to review");
    const approved = plans.reviewProposal(next, draft.id, { decision: "approve", expectedRevision: draft.revision, expectedGuard: draft.guard, reason: "Nouvelle approbation du médecin actuel", clientId: "new-approval" });
    const protocol = f.service.authorize(next, "fatma", { ...f.body(), sourceProposalId: approved.proposal.id, actions: [approved.proposal.action], clientId: "new-protocol" });
    assert.equal(protocol.state, "active"); assert.equal(protocol.clinicianId, next.id);
    assert.equal(f.store.read().messages.find(m => m.id === orphan.id)?.review, null);
    assert.equal((await f.apply(protocol.id, f.store.read().measurements[0].id)).state, "delivered");
    assert.throws(() => messaging.listMessages(next, "fatma", "secondary"), "new primary receives no secondary thread read access");
  } finally { f.store.close(); }
});
