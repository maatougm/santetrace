import test from "node:test";
import assert from "node:assert/strict";
import type { Actor } from "../src/contracts/care";
import type { GroundedPrompt } from "../src/contracts/monitoring";
import { CareStore, type CareStoreAdapter } from "../src/lib/care-store";
import { MonitoringAiService } from "../src/lib/monitoring-ai-service";
import { LocalModelError, OllamaLocalModel, type LocalModel } from "../src/lib/local-model";
import { buildAuthorizedEvidence, validateGroundedOutput } from "../src/lib/medical-evidence";
import { deterministicOutput, questionsFor } from "../src/lib/monitoring-content";
import { bumpPatientRevision, currentGuard } from "../src/lib/patient-access-service";
import { CarePlanService } from "../src/lib/care-plan-service";
import { ProtocolService } from "../src/lib/protocol-service";
const at = "2026-10-11T12:00:00.000Z";
const owner: Actor = { id: "owner", role: "patient", patientId: "fatma", displayName: "Owner" };
const doctor: Actor = { id: "doctor", role: "clinician", patientId: null, displayName: "Doctor" };
function fixture() { const store = new CareStore(":memory:"); store.transaction(s => { for (const a of [owner, doctor])
    s.accounts.push({ ...a, login: a.id, passwordHash: "unused", enabled: true, sessionVersion: 1, createdAt: at }); s.measurements.push({ id: "measurement", patientId: "fatma", kind: "glucose", value: 100, unit: "mg/dL", measuredAt: at, capturedAt: at, receivedAt: at, source: "app", clientId: "seed", status: "green", ruleVersion: "demo-v1" }); s.careGrants.push({ id: "grant", patientId: "fatma", clinicianId: "doctor", relationship: "primary", scopes: ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"], state: "active", issuedAt: at, acceptedAt: at, revokedAt: null, revision: 1 }); }); return store; }
const fact = (context = 0, clientId = "fact") => ({ kind: "condition" as const, code: "hypertension", label: "Hypertension", value: null, polarity: "negated" as const, expectedContextRevision: context, clientId });
const goodModel: LocalModel = { model: "fake", generate: async () => ({ claims: [], questionIds: [], proposals: [] }), embed: async () => [] };
test("declarations and corrected polarity remain patient-reported with immutable history and replay", () => { const s = fixture(); try {
    const svc = new MonitoringAiService(s, goodModel, () => at);
    const f = svc.recordFact(owner, "fatma", fact());
    assert.equal(f.verification, "patient_reported");
    assert.deepEqual(svc.recordFact(owner, "fatma", fact()), f);
    const n = svc.correctFact(owner, f.id, { ...fact(1, "correction"), polarity: "unknown", expectedRevision: 1, reason: "Correction" });
    assert.equal(n.polarity, "unknown");
    assert.equal(n.revision, 2);
    assert.deepEqual(n.correction, { correctsFactId: f.id, reason: "Correction" });
    assert.equal(s.read().medicalFacts.find(x => x.id === f.id)?.supersededBy, n.id);
    assert.throws(() => svc.recordFact(doctor, "fatma", fact(2, "doctor")));
}
finally {
    s.close();
} });
test("null onboarding performs no mutations and disabled model produces registry questions", async () => { const s = fixture(); try {
    const before = s.read();
    const r = await new MonitoringAiService(s, undefined, () => at).onboarding(owner, "fatma", null);
    assert.deepEqual(s.read(), before);
    assert.equal(r.meta.mode, "deterministic");
    assert.ok(r.questions.length);
    assert.equal(r.meta.failureReason, "disabled");
}
finally {
    s.close();
} });
test("unknown output fields trigger deterministic fallback without trusted facts", async () => { const s = fixture(); try {
    const model = { ...goodModel, generate: async () => ({ claims: [], questionIds: [], proposals: [], diagnosis: "confirmed" }) };
    const r = await new MonitoringAiService(s, model, () => at).report(doctor, "fatma");
    assert.equal(r.meta.failureReason, "invalid_output");
    assert.equal(s.read().medicalFacts.length, 0);
}
finally {
    s.close();
} });
test("held generation revocation releases no report or persisted output", async () => { const s = fixture(); try {
    let release!: (v: unknown) => void;
    let began!: () => void;
    const started = new Promise<void>(r => began = r);
    const model = { ...goodModel, generate: async () => { began(); return new Promise(r => release = r); } };
    const task = new MonitoringAiService(s, model, () => at).report(doctor, "fatma");
    await started;
    s.transaction(state => { state.careGrants[0].state = "revoked"; state.careGrants[0].revision++; });
    release({ claims: [], questionIds: [], proposals: [] });
    await assert.rejects(task);
    assert.equal(s.read().clinicianReports.length, 0);
}
finally {
    s.close();
} });
test("changed context during model work is rejected, red pathway never calls model", async () => { const s = fixture(); try {
    let called = 0;
    const svc = new MonitoringAiService(s, { ...goodModel, generate: async () => { called++; svc.recordFact(owner, "fatma", fact()); return { claims: [], questionIds: [], proposals: [] }; } }, () => at);
    await assert.rejects(svc.report(doctor, "fatma"));
    assert.equal(s.read().clinicianReports.length, 0);
    s.transaction(x => x.alerts.push({ id: "red", patientId: "fatma", status: "new", priority: "red", reason: "Synthetic", ruleVersion: "demo-v1", rulesSnapshot: x.patients[0].rules, createdAt: at, history: [] }));
    called = 0;
    const r = await svc.report(doctor, "fatma");
    assert.equal(called, 0);
    assert.equal(r.meta.mode, "deterministic");
}
finally {
    s.close();
} });
test("model timeout/abort is bounded and uses explicit fallback failure", async () => { const s = fixture(); try {
    const never = { ...goodModel, generate: async () => new Promise<unknown>(() => { }) };
    const r = await new MonitoringAiService(s, never, () => at).report(doctor, "fatma", { timeoutMs: 10 });
    assert.equal(r.meta.failureReason, "timeout");
    const c = new AbortController();
    c.abort();
    const a = await new MonitoringAiService(s, never, () => at).report(doctor, "fatma", { signal: c.signal });
    assert.equal(a.meta.failureReason, "aborted");
}
finally {
    s.close();
} });
test("local adapter rejects non-loopback URL and malformed embedding response", async () => { assert.throws(() => new OllamaLocalModel({ baseUrl: "https://example.com", enabled: true })); const local = new OllamaLocalModel({ enabled: true, fetch: async () => new Response(JSON.stringify({ embeddings: [[NaN]] }), { headers: { "content-type": "application/json" } }) }); await assert.rejects(local.embed(["fictional"], {}), LocalModelError); });
test("onboarding rejects affirmative false answers, unknown question IDs and stale context atomically", async () => { const s = fixture(); try {
    const svc = new MonitoringAiService(s, undefined, () => at);
    for (const answers of [[{ questionId: "condition.diabetes", value: false, polarity: "affirmed" as const }], [{ questionId: "diagnose.free", value: true, polarity: "affirmed" as const }]])
        await assert.rejects(svc.onboarding(owner, "fatma", { answers, clientId: "bad", expectedContextRevision: 0 }));
    assert.equal(s.read().medicalFacts.length, 0);
    const r = await svc.onboarding(owner, "fatma", { answers: [{ questionId: "condition.diabetes", value: null, polarity: "unknown" }], clientId: "unknown", expectedContextRevision: 0 });
    assert.equal(r.facts[0].polarity, "unknown");
    assert.equal(r.questions.some(q => q.id === "condition.diabetes"), false);
    assert.ok(r.questions.some(q => q.id === "condition.hypertension"));
    await assert.rejects(svc.onboarding(owner, "fatma", { answers: [{ questionId: "condition.hypertension", value: true, polarity: "affirmed" }], clientId: "stale", expectedContextRevision: 0 }));
    assert.equal(s.read().medicalFacts.length, 1);
}
finally {
    s.close();
} });
test("patient proposal generation exposes statuses and never examination content", async () => { const s = fixture(); try {
    const svc = new MonitoringAiService(s, undefined, () => at);
    svc.recordFact(owner, "fatma", { ...fact(), polarity: "affirmed" });
    const r = await svc.generateProposals(owner, "fatma");
    assert.ok(r.proposals.length);
    for (const p of r.proposals)
        assert.deepEqual(Object.keys(p).sort(), ["id", "kind", "revision", "state"]);
    assert.equal(s.read().careActions.length, 0);
    assert.equal(s.read().carePlans.length, 0);
    assert.equal(s.read().medicalFacts[0].verification, "patient_reported");
}
finally {
    s.close();
} });
test("unknown condition codes cannot select a clinical rule pack", () => { const s = fixture(); try {
    assert.throws(() => new MonitoringAiService(s).recordFact(owner, "fatma", { ...fact(), code: "invented_diagnosis" }));
    assert.equal(s.read().medicalFacts.length, 0);
}
finally {
    s.close();
} });
test("no patient evidence returns explicit no-evidence fallback without model invocation", async () => { const s = fixture(); try {
    s.transaction(x => x.measurements = []);
    let called = 0;
    const r = await new MonitoringAiService(s, { ...goodModel, generate: async () => { called++; return { claims: [], questionIds: [], proposals: [] }; } }, () => at).report(doctor, "fatma");
    assert.equal(called, 0);
    assert.equal(r.meta.failureReason, "no_evidence");
}
finally {
    s.close();
} });
test("operation gate permits one active plus two waiting and rejects overflow", async () => { const { ModelOperationGate } = await import("../src/lib/local-model"); const gate = new ModelOperationGate(); const a = new AbortController(), b = new AbortController(), c = new AbortController(); const release = await gate.acquire(a.signal); let secondStarted = false; const second = gate.acquire(b.signal).then(r => { secondStarted = true; return r; }); const third = gate.acquire(c.signal); await assert.rejects(gate.acquire(new AbortController().signal), (e: unknown) => e instanceof LocalModelError && e.reason === "busy"); assert.equal(secondStarted, false); c.abort(); await assert.rejects(third); release(); const releaseSecond = await second; assert.equal(secondStarted, true); releaseSecond(); });
test("server renders measurement values from evidence and accepts opaque aliases", async () => { const s = fixture(); try {
    let seen: GroundedPrompt | null = null;
    const model = { ...goodModel, generate: async (prompt: GroundedPrompt) => { seen = prompt; const ref = prompt.snapshot.sources.find(s => s.kind === "measurement")!; return { claims: [{ category: "patient_statement", code: "measurement_value", parameters: {}, sourceIds: [ref.id] }], questionIds: [], proposals: [] }; } };
    const r = await new MonitoringAiService(s, model, () => at).report(doctor, "fatma");
    assert.equal(r.meta.mode, "local_model");
    assert.equal(r.report.claims[0].parameters.value, 100);
    assert.deepEqual(r.report.claims[0].sourceIds, ["measurement"]);
    assert.equal(JSON.stringify(seen).includes("fatma"), false);
    assert.equal(JSON.stringify(seen).includes('"measurement"'), true);
}
finally {
    s.close();
} });
test("Ollama transport sends supported-only schema and excludes tools, streaming and thinking",async()=>{let body:Record<string,any>|undefined;const local=new OllamaLocalModel({enabled:true,fetch:async(_url,init)=>{body=JSON.parse(String(init?.body));return new Response(JSON.stringify({response:JSON.stringify({claims:[],questionIds:[],proposals:[]})}));}});await local.generate({purpose:"report",schemaVersion:"monitoring-grounded-v1",promptVersion:"test",allowedCodes:["missing_context","hypothesis_review"],snapshot:{patientId:"fictional_patient",guard:{contextRevision:0,evidenceRevision:0,authorityRevision:0,carePlanRevision:0,profileVersions:[]},sources:[],chunks:[],facts:[],measurements:[],coverage:[]}},{timeoutMs:50});assert.equal(body?.stream,false);assert.equal(body?.think,false);assert.equal(body?.tools,undefined);assert.deepEqual(body?.format.properties.claims.items.oneOf.map((choice:any)=>choice.properties.code.const),["missing_context"]);assert.equal(body?.format.properties.proposals.maxItems,0);await assert.rejects(local.embed(["x".repeat(1001)],{}),(e:unknown)=>e instanceof LocalModelError&&e.reason==="no_evidence");});
test("native fetch abort yields bounded timeout metadata",async()=>{const local=new OllamaLocalModel({enabled:true,fetch:async(_url,init)=>new Promise((_resolve,reject)=>{init!.signal!.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});})});await assert.rejects(local.embed(["fictional"],{timeoutMs:10}),(e:unknown)=>e instanceof LocalModelError&&e.reason==="timeout");});

async function requiredAnswers(service: MonitoringAiService) {
    return service.onboarding(owner, "fatma", {
        answers: [
            { questionId: "condition.hypertension", value: false, polarity: "negated" },
            { questionId: "condition.diabetes", value: true, polarity: "affirmed" },
        ],
        clientId: "required-answers",
        expectedContextRevision: 0,
    });
}

test("required-only onboarding leaves optional facts unknown and proposals reviewable", async () => {
    const store = fixture();
    try {
        const service = new MonitoringAiService(store, undefined, () => at);
        const onboarding = await requiredAnswers(service);
        assert.ok(onboarding.questions.length > 0);
        assert.ok(onboarding.questions.every(question => !question.required));
        const generated = await service.generateProposals(doctor, "fatma");
        assert.equal(generated.proposals.length, 2);
        assert.ok(generated.proposals.every(proposal => proposal.state === "needs_review"));
        assert.deepEqual(generated.proposals.map(proposal => proposal.kind).sort(), ["home_measurement", "lab_exam"]);
        assert.deepEqual(store.read().medicalFacts.map(fact => fact.kind), ["condition", "condition"]);
        const proposal = store.read().careProposals[0];
        assert.deepEqual(proposal.history[0].sources, proposal.sources);
        assert.deepEqual(proposal.history[0].guard, proposal.guard);
        assert.equal(proposal.history[0].reason, "generated_draft");
    } finally {
        store.close();
    }
});

test("server derives required prerequisites even when model omits them", async () => {
    const store = fixture();
    try {
        const model: LocalModel = {
            ...goodModel,
            generate: async prompt => {
                const condition = prompt.snapshot.sources.find(source => source.kind === "patient_fact")!;
                const reference = prompt.snapshot.sources.find(source => source.kind === "reference")!;
                return { claims: [], questionIds: [], proposals: [{ kind: "home_measurement", action: { templateId: "home.glucose", templateVersion: 1, parameters: {} }, sources: [condition, reference], missingQuestionIds: [] }] };
            },
        };
        const service = new MonitoringAiService(store, model, () => at);
        service.recordFact(owner, "fatma", { ...fact(), code: "diabetes", polarity: "affirmed" });
        const generated = await service.generateProposals(doctor, "fatma");
        assert.equal(generated.meta.mode, "local_model");
        assert.equal(generated.proposals[0].state, "needs_inputs");
    } finally {
        store.close();
    }
});

test("optional model-selected questions cannot block a fully answered proposal", async () => {
    const store = fixture();
    try {
        const model: LocalModel = {
            ...goodModel,
            generate: async prompt => {
                const condition = prompt.snapshot.sources.find(source => source.id === prompt.snapshot.facts.find(fact => fact.code === "diabetes")!.id)!;
                const reference = prompt.snapshot.sources.find(source => source.kind === "reference")!;
                return { claims: [], questionIds: ["allergy.declared"], proposals: [{ kind: "home_measurement", action: { templateId: "home.glucose", templateVersion: 1, parameters: {} }, sources: [condition, reference], missingQuestionIds: ["allergy.declared"] }] };
            },
        };
        const service = new MonitoringAiService(store, model, () => at);
        await requiredAnswers(service);
        const generated = await service.generateProposals(doctor, "fatma");
        assert.equal(generated.meta.mode, "local_model");
        assert.equal(generated.proposals[0].state, "needs_review");
    } finally {
        store.close();
    }
});

test("deterministic reports preserve accepted, manual, simulated and suspect provenance", async () => {
    for (const [source, quality, expected] of [
        ["app", "accepted", "patient_statement"],
        ["device", "accepted", "patient_statement"],
        ["simulated", "accepted", "patient_statement"],
        ["device", "suspect", "candidate"],
    ] as const) {
        const store = fixture();
        try {
            store.transaction(state => {
                state.measurements[0].source = source;
                if (source !== "app") {
                    state.measurements[0].connector = { connectorId: "connector", deviceId: "demo-device", externalEventId: "event", simulated: source === "simulated", quality };
                }
            });
            const snapshot = buildAuthorizedEvidence(store.read(), doctor, "fatma");
            assert.doesNotThrow(() => validateGroundedOutput(deterministicOutput(snapshot), snapshot));
            const result = await new MonitoringAiService(store, undefined, () => at).report(doctor, "fatma");
            assert.equal(result.report.claims.find(claim => claim.code === "measurement_value")?.category, expected);
            if (source === "simulated") assert.equal(result.report.sources[0].verification, "simulated");
        } finally {
            store.close();
        }
    }
});

test("explicit unknown and uncertain answers permit reasoned individual review without completing clinical coverage", async () => {
    for (const polarity of ["unknown", "uncertain"] as const) {
        const store = fixture();
        try {
            store.transaction(state => { state.measurements = [{ id: "measurement", patientId: "fatma", kind: "blood_pressure", systolic: 145, diastolic: 92, unit: "mmHg", measuredAt: at, capturedAt: at, receivedAt: at, source: "app", clientId: "seed", status: "orange", ruleVersion: "demo-v1" }]; });
            const ai = new MonitoringAiService(store, undefined, () => at);
            const onboarding = await ai.onboarding(owner, "fatma", {
                answers: [
                    { questionId: "condition.hypertension", value: true, polarity: "affirmed" },
                    { questionId: "condition.diabetes", value: null, polarity },
                ], expectedContextRevision: 0, clientId: `answers-${polarity}`,
            });
            assert.ok(onboarding.questions.every(question => !question.required));
            const diabetes = onboarding.facts.find(fact => fact.code === "diabetes")!;
            const hypertension = onboarding.facts.find(fact => fact.code === "hypertension")!;
            assert.equal(diabetes.polarity, polarity);
            assert.equal(diabetes.verification, "patient_reported");
            const report = await ai.report(doctor, "fatma");
            const claim = report.report.claims.find(claim => claim.sourceIds.includes(diabetes.id))!;
            assert.equal(claim.category, "patient_statement");
            assert.equal(claim.parameters.polarity, polarity);
            assert.equal(report.report.sources.find(source => source.id === diabetes.id)?.polarity, polarity);

            const generated = await ai.generateProposals(doctor, "fatma");
            assert.equal(generated.proposals.length, 2);
            assert.ok(generated.proposals.every(proposal => proposal.state === "needs_review"));
            assert.equal(store.read().careProposals.some(proposal => proposal.action.templateId === "home.glucose"), false);
            const home = store.read().careProposals.find(proposal => proposal.kind === "home_measurement")!;
            const plans = new CarePlanService(store, () => at);
            assert.throws(() => plans.reviewProposal(doctor, home.id, { decision: "approve", expectedRevision: home.revision, expectedGuard: home.guard, reason: " ", clientId: "without-reason" }));
            const reason = "Individual BP follow-up reviewed; diabetes status remains unknown and needs assessment.";
            const reviewed = plans.reviewProposal(doctor, home.id, { decision: "approve", expectedRevision: home.revision, expectedGuard: home.guard, reason, clientId: `review-${polarity}` });
            assert.equal(reviewed.proposal.decision?.reason, reason);
            assert.equal(store.read().careActions.length, 1);
            assert.equal(store.read().protocols.length, 0);
            assert.equal(store.read().medicalFacts.find(fact => fact.id === diabetes.id)?.polarity, polarity);
            assert.equal(store.read().conditionEvaluations.find(evaluation => evaluation.conditionFactId === diabetes.id)?.priority, "unknown");
            assert.notEqual(store.read().patients.find(patient => patient.id === "fatma")?.status, "green");
            const profile = store.read().monitoringProfiles.find(profile => profile.conditionCodes.includes("hypertension"))!;
            assert.throws(() => plans.updatePlan(doctor, "fatma", { action: "activate", expectedRevision: reviewed.plan!.revision, profileBindings: [{ conditionFactId: diabetes.id, profileId: profile.id, profileVersion: profile.version }], clientId: "bind-unknown" }), (error: unknown) => (error as { code: string }).code === "INVALID_PROFILES");
            const active = plans.updatePlan(doctor, "fatma", { action: "activate", expectedRevision: reviewed.plan!.revision, profileBindings: [{ conditionFactId: hypertension.id, profileId: profile.id, profileVersion: profile.version }], clientId: "bind-known" });
            const protocol = new ProtocolService(store, () => at).authorize(doctor, "fatma", {
                sourceProposalId: home.id, actions: [home.action],
                predicates: [{ kind: "priority_equals", conditionFactId: hypertension.id, value: "orange" }, { kind: "requirements_complete", requirementIds: profile.requirements.map(requirement => requirement.id) }],
                exclusions: [{ kind: "fact_equals", factId: diabetes.id, polarity: "affirmed" }], stopCriteria: [],
                validUntil: "2026-10-12T12:00:00.000Z", minIntervalSeconds: 60, maxApplications: 1,
                expectedGuard: active.guard ?? currentGuard(store.read(), "fatma"), clientId: `protocol-${polarity}`,
            });
            const applied = await new ProtocolService(store, () => at).apply(protocol.id, "measurement", currentGuard(store.read(), "fatma"), at);
            assert.equal(applied.state, "blocked");
            assert.ok(applied.reasons.includes("unknown_exclusion"));
            assert.equal(store.read().careActions.length, 1);
        } finally {
            store.close();
        }
    }
});

test("a superseded required answer cannot satisfy current proposal prerequisites", async () => {
    const store = fixture();
    try {
        const ai = new MonitoringAiService(store, undefined, () => at);
        await requiredAnswers(ai);
        store.transaction(state => { state.medicalFacts.find(fact => fact.code === "hypertension")!.supersededBy = "unavailable-replacement"; });
        assert.ok(questionsFor(store.read().medicalFacts).some(question => question.id === "condition.hypertension"));
        const generated = await ai.generateProposals(doctor, "fatma");
        assert.ok(generated.proposals.every(proposal => proposal.state === "needs_inputs"));
        const proposal = store.read().careProposals[0];
        assert.throws(() => new CarePlanService(store, () => at).reviewProposal(doctor, proposal.id, { decision: "approve", expectedRevision: proposal.revision, expectedGuard: proposal.guard, reason: "Cannot assume a missing answer", clientId: "missing-answer-review" }), (error: unknown) => (error as { code: string }).code === "NEEDS_INPUTS");
        assert.equal(store.read().careActions.length, 0);
    } finally {
        store.close();
    }
});

test("suspect device evidence remains candidate in timeout and invalid-output fallbacks", async () => {
    for (const failure of ["timeout", "invalid_output"] as const) {
        const store = fixture();
        try {
            store.transaction(state => {
                state.measurements[0].source = "device";
                state.measurements[0].connector = { connectorId: "connector", deviceId: "demo-device", externalEventId: "event", simulated: false, quality: "suspect" };
            });
            const model: LocalModel = { ...goodModel, generate: async () => {
                if (failure === "timeout") throw new LocalModelError("timeout");
                return { unsafe: true };
            } };
            const result = await new MonitoringAiService(store, model, () => at).report(doctor, "fatma");
            assert.equal(result.meta.failureReason, failure);
            assert.equal(result.report.claims.find(claim => claim.code === "measurement_value")?.category, "candidate");
        } finally {
            store.close();
        }
    }
});

test("deterministic output stays inside the shared schema budget for a long dossier", async () => {
    const store = fixture();
    try {
        store.transaction(state => {
            const original = state.measurements[0];
            for (let index = 0; index < 15; index++) state.measurements.push({ ...original, id: `reading-${index}`, clientId: `seed-${index}` });
        });
        const snapshot = buildAuthorizedEvidence(store.read(), doctor, "fatma");
        assert.doesNotThrow(() => validateGroundedOutput(deterministicOutput(snapshot), snapshot));
        const result = await new MonitoringAiService(store, undefined, () => at).report(doctor, "fatma");
        assert.ok(result.report.claims.length <= 10);
        assert.ok(result.report.claims.some(claim => claim.category === "missing"));
    } finally {
        store.close();
    }
});

test("sequential keyed report retry reuses durable output across service instances", async () => {
    const store = fixture();
    try {
        let calls = 0;
        const model: LocalModel = { ...goodModel, generate: async () => { calls++; return { claims: [], questionIds: [], proposals: [] }; } };
        const first = await new MonitoringAiService(store, model, () => at).report(doctor, "fatma", { clientId: "report-operation" });
        const second = await new MonitoringAiService(store, model, () => at).report(doctor, "fatma", { clientId: "report-operation" });
        assert.deepEqual(second, first);
        assert.equal(calls, 1);
        assert.equal(store.read().clinicianReports.length, 1);
        assert.equal(store.read().accessJournal.filter(entry => entry.action === "generate_report").length, 1);
    } finally {
        store.close();
    }
});

test("concurrent keyed report retry shares one model operation and one atomic commit", async () => {
    const store = fixture();
    try {
        let calls = 0;
        let release!: (value: unknown) => void;
        let began!: () => void;
        const started = new Promise<void>(resolve => began = resolve);
        const model: LocalModel = { ...goodModel, generate: async () => {
            calls++;
            if (calls > 1) return { claims: [], questionIds: [], proposals: [] };
            began();
            return new Promise(resolve => release = resolve);
        } };
        const first = new MonitoringAiService(store, model, () => at).report(doctor, "fatma", { clientId: "concurrent-report" });
        await started;
        const second = new MonitoringAiService(store, model, () => at).report(doctor, "fatma", { clientId: "concurrent-report" });
        release({ claims: [], questionIds: [], proposals: [] });
        const [left, right] = await Promise.all([first, second]);
        assert.deepEqual(left, right);
        assert.equal(calls, 1);
        assert.equal(store.read().clinicianReports.length, 1);
    } finally {
        store.close();
    }
});

test("generation mutation keys are bounded and cannot contain controls", async () => {
    const store = fixture();
    try {
        const service = new MonitoringAiService(store, undefined, () => at);
        for (const clientId of ["", "x".repeat(121), "invalid\u0000key", "invalid\nkey", "invalid\u007fkey"]) {
            await assert.rejects(service.report(doctor, "fatma", { clientId }), (error: unknown) => (error as { code: string }).code === "INVALID_INPUT");
        }
        assert.equal(store.read().clinicianReports.length, 0);
    } finally {
        store.close();
    }
});

test("saved report replay rejects changed context and revoked or narrowed authority", async () => {
    for (const change of ["context", "evidence", "authority", "care_plan", "revoke", "narrow"] as const) {
        const store = fixture();
        try {
            const service = new MonitoringAiService(store, undefined, () => at);
            await service.report(doctor, "fatma", { clientId: "saved-report" });
            store.transaction(state => {
                if (["context", "evidence", "authority"].includes(change)) bumpPatientRevision(state, "fatma", change as "context" | "evidence" | "authority");
                if (change === "revoke") state.careGrants[0].state = "revoked";
                if (change === "narrow") state.careGrants[0].scopes = ["status"];
                if (change === "care_plan") state.carePlans.push({ id: "new-plan", patientId: "fatma", revision: 1, state: "suspended", clinicianId: "doctor", profileBindings: [], actionIds: [], reviewDeadline: null });
            });
            await assert.rejects(service.report(doctor, "fatma", { clientId: "saved-report" }), (error: unknown) => ["context", "evidence", "authority", "care_plan"].includes(change) ? (error as { code: string }).code === "STALE_CONTEXT" : ["NOT_FOUND", "FORBIDDEN"].includes((error as { code: string }).code));
            assert.equal(store.read().clinicianReports.length, 1);
        } finally {
            store.close();
        }
    }
});

test("keyed proposal retry preserves status-only projection and immutable initial history", async () => {
    const store = fixture();
    try {
        const service = new MonitoringAiService(store, undefined, () => at);
        await requiredAnswers(service);
        const first = await service.generateProposals(owner, "fatma", { clientId: "owner-proposals" });
        const second = await service.generateProposals(owner, "fatma", { clientId: "owner-proposals" });
        assert.deepEqual(second, first);
        assert.equal(store.read().careProposals.length, 2);
        assert.deepEqual(second.proposals.map(proposal => proposal.kind).sort(), ["home_measurement", "lab_exam"]);
        for (const proposal of second.proposals) assert.deepEqual(Object.keys(proposal).sort(), ["id", "kind", "revision", "state"]);
        assert.deepEqual(store.read().careProposals[0].history[0].sources, store.read().careProposals[0].sources);
        store.transaction(state => bumpPatientRevision(state, "fatma", "context"));
        await assert.rejects(service.generateProposals(owner, "fatma", { clientId: "owner-proposals" }), (error: unknown) => (error as { code: string }).code === "STALE_CONTEXT");
    } finally {
        store.close();
    }
});

test("candidate facts and external notes are unverified in deterministic reports", async () => {
    const store = fixture();
    try {
        const service = new MonitoringAiService(store, undefined, () => at);
        const captured = service.recordFact(owner, "fatma", { ...fact(), polarity: "affirmed" });
        store.transaction(state => {
            state.medicalFacts.find(fact => fact.id === captured.id)!.verification = "candidate";
            state.externalNotes.push({ id: "external-note", patientId: "fatma", grantId: "guest-grant", sessionId: "guest-session", declaredName: "Declared guest", organization: "Declared office", verification: "external_unverified", text: "Synthetic unverified consultation note", consultationDate: null, receivedAt: at, correctsNoteId: null });
        });
        const snapshot = buildAuthorizedEvidence(store.read(), doctor, "fatma");
        assert.doesNotThrow(() => validateGroundedOutput(deterministicOutput(snapshot), snapshot));
        const result = await service.report(doctor, "fatma");
        assert.equal(result.report.claims.find(claim => claim.code === "fact_statement")?.category, "candidate");
        assert.equal(result.report.claims.find(claim => claim.code === "external_note")?.category, "candidate");
        assert.equal((await service.generateProposals(doctor, "fatma")).proposals.length, 0);
        assert.equal(store.read().medicalFacts[0].verification, "candidate");
    } finally {
        store.close();
    }
});

test("a changed generation fingerprint conflicts before model work or persistence", async () => {
    const store = fixture();
    try {
        let calls = 0;
        const model: LocalModel = { ...goodModel, generate: async () => { calls++; return { claims: [], questionIds: [], proposals: [] }; } };
        const service = new MonitoringAiService(store, model, () => at);
        await service.report(doctor, "fatma", { clientId: "fingerprint-operation" });
        store.transaction(state => {
            state.idempotency[JSON.stringify([doctor.id, "fatma", "report", "fingerprint-operation"])].hash = "previous-semantic-request-version";
        });
        await assert.rejects(service.report(doctor, "fatma", { clientId: "fingerprint-operation" }), (error: unknown) => (error as { code: string }).code === "IDEMPOTENCY_CONFLICT");
        assert.equal(calls, 1);
        assert.equal(store.read().clinicianReports.length, 1);
    } finally {
        store.close();
    }
});

test("concurrent keyed retry rejects revoked authority for both waiters without durable output", async () => {
    const store = fixture();
    try {
        let calls = 0;
        let release!: (value: unknown) => void;
        let began!: () => void;
        const started = new Promise<void>(resolve => began = resolve);
        const model: LocalModel = { ...goodModel, generate: async () => { calls++; began(); return new Promise(resolve => release = resolve); } };
        const first = new MonitoringAiService(store, model, () => at).report(doctor, "fatma", { clientId: "revoked-concurrent" });
        await started;
        const second = new MonitoringAiService(store, model, () => at).report(doctor, "fatma", { clientId: "revoked-concurrent" });
        store.transaction(state => state.careGrants[0].state = "revoked");
        release({ claims: [], questionIds: [], proposals: [] });
        const results = await Promise.allSettled([first, second]);
        assert.ok(results.every(result => result.status === "rejected"));
        assert.equal(calls, 1);
        assert.equal(store.read().clinicianReports.length, 0);
        assert.equal(Object.keys(store.read().idempotency).length, 0);
    } finally {
        store.close();
    }
});

test("a patient cannot retrieve a clinician's keyed report and keys never cross patient records", async () => {
    const store = fixture();
    try {
        const service = new MonitoringAiService(store, undefined, () => at);
        await service.report(doctor, "fatma", { clientId: "shared-name" });
        await assert.rejects(service.report(owner, "fatma", { clientId: "shared-name" }), (error: unknown) => (error as { code: string }).code === "FORBIDDEN");
        await assert.rejects(service.report(doctor, "ahmed", { clientId: "shared-name" }), (error: unknown) => (error as { code: string }).code === "NOT_FOUND");
        assert.equal(store.read().clinicianReports.length, 1);
    } finally {
        store.close();
    }
});

test("generation mutation key is kept out of adapter options and replay stores no raw prompt", async () => {
    const store = fixture();
    try {
        const operation = "opaque-operation-for-fictional-only";
        let adapterOptions: unknown;
        const model: LocalModel = { ...goodModel, generate: async (_prompt, options) => { adapterOptions = options; return { claims: [], questionIds: [], proposals: [] }; } };
        await new MonitoringAiService(store, model, () => at).report(doctor, "fatma", { clientId: operation });
        assert.equal((adapterOptions as { clientId?: string }).clientId, undefined);
        const replay = Object.values(store.read().idempotency)[0];
        assert.deepEqual(Object.keys(replay).sort(), ["hash", "result"]);
        assert.equal(Object.hasOwn(replay.result as object, "prompt"), false);
        assert.equal(Object.hasOwn(replay.result as object, "snapshot"), false);
    } finally {
        store.close();
    }
});

test("disabled and unavailable models generate separate home and clinician-exam drafts for diabetes and hypertension", async () => {
    for (const failure of ["disabled", "provider_unavailable"] as const) {
        const store = fixture();
        try {
            const unavailable: LocalModel = { ...goodModel, generate: async () => { throw new LocalModelError("provider_unavailable"); } };
            const service = new MonitoringAiService(store, failure === "disabled" ? undefined : unavailable, () => at);
            await service.onboarding(owner, "fatma", { answers: [
                { questionId: "condition.hypertension", value: true, polarity: "affirmed" },
                { questionId: "condition.diabetes", value: true, polarity: "affirmed" },
            ], expectedContextRevision: 0, clientId: "two-conditions" });
            const generated = await service.generateProposals(doctor, "fatma", { clientId: "separate-drafts" });
            assert.equal(generated.meta.failureReason, failure);
            assert.equal(generated.proposals.length, 4);
            assert.ok(generated.proposals.every(proposal => proposal.state === "needs_review"));
            const proposals = store.read().careProposals;
            assert.deepEqual(proposals.map(proposal => proposal.kind).sort(), ["home_measurement", "home_measurement", "lab_exam", "lab_exam"]);
            for (const condition of store.read().medicalFacts) {
                const related = proposals.filter(proposal => proposal.sources.some(source => source.id === condition.id));
                assert.equal(related.length, 2);
                assert.deepEqual(related.map(proposal => proposal.kind).sort(), ["home_measurement", "lab_exam"]);
                assert.deepEqual(related[0].sources, related[1].sources);
                assert.deepEqual(related[0].guard, related[1].guard);
            }
            for (const proposal of proposals.filter(proposal => proposal.kind === "lab_exam")) {
                assert.deepEqual(proposal.action, { templateId: "exam.clinician_review", templateVersion: 1, parameters: {} });
                assert.deepEqual(proposal.history[0].sources, proposal.sources);
                assert.deepEqual(proposal.history[0].guard, proposal.guard);
            }
            assert.equal(store.read().careActions.length, 0);
        } finally {
            store.close();
        }
    }
});

test("fallback draft approval acts on one item and keeps the other draft private", async () => {
    for (const approvedKind of ["home_measurement", "lab_exam"] as const) {
        const store = fixture();
        try {
            const ai = new MonitoringAiService(store, undefined, () => at);
            await requiredAnswers(ai);
            await ai.generateProposals(doctor, "fatma");
            const plans = new CarePlanService(store, () => at);
            const selected = store.read().careProposals.find(proposal => proposal.kind === approvedKind)!;
            assert.ok(selected, "fallback must provide both independently reviewable items");
            const result = plans.reviewProposal(doctor, selected.id, { decision: "approve", expectedRevision: selected.revision, expectedGuard: selected.guard, reason: "Validation individuelle du brouillon", clientId: `approve-${approvedKind}` });
            assert.equal(result.proposal.kind, approvedKind);
            assert.equal(store.read().careActions.length, 1);
            assert.equal(store.read().careActions[0].proposalId, selected.id);
            const untouched = store.read().careProposals.find(proposal => proposal.id !== selected.id)!;
            assert.equal(untouched.state, "needs_review");
            assert.equal(untouched.decision, null);
            const patient = plans.listProposals(owner, "fatma");
            for (const proposal of patient.proposals) assert.deepEqual(Object.keys(proposal).sort(), ["id", "kind", "revision", "state"]);
            assert.equal(plans.getPlan(owner, "fatma").actions.length, 1);
            if (approvedKind === "home_measurement") {
                assert.equal(JSON.stringify(patient.proposals).includes("exam.clinician_review"), false);
                assert.equal(JSON.stringify(plans.getPlan(owner, "fatma").actions).includes("exam.clinician_review"), false);
            }
        } finally {
            store.close();
        }
    }
});

test("an unsupported condition produces only an information draft", async () => {
    const store = fixture();
    try {
        const service = new MonitoringAiService(store, undefined, () => at);
        await requiredAnswers(service);
        const unknown = service.recordFact(owner, "fatma", { ...fact(1, "unsupported-condition"), code: null, label: "Condition non couverte", polarity: "affirmed" });
        await service.generateProposals(doctor, "fatma");
        const related = store.read().careProposals.filter(proposal => proposal.sources.some(source => source.id === unknown.id));
        assert.equal(related.length, 1);
        assert.equal(related[0].kind, "information");
        assert.equal(related[0].action.templateId, "information.review");
    } finally {
        store.close();
    }
});

test("paired fallback drafts retain the closed ten-proposal budget", () => {
    const store = fixture();
    try {
        const service = new MonitoringAiService(store, undefined, () => at);
        for (let index = 0; index < 8; index++) service.recordFact(owner, "fatma", { ...fact(index, `bounded-condition-${index}`), code: index % 2 ? "diabetes" : "hypertension", polarity: "affirmed" });
        const snapshot = buildAuthorizedEvidence(store.read(), doctor, "fatma");
        const output = deterministicOutput(snapshot);
        assert.equal(output.proposals.length, 10);
        assert.equal(output.proposals.filter(proposal => proposal.kind === "home_measurement").length, 5);
        assert.equal(output.proposals.filter(proposal => proposal.kind === "lab_exam").length, 5);
        assert.doesNotThrow(() => validateGroundedOutput(output, snapshot));
    } finally {
        store.close();
    }
});
