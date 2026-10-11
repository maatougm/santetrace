import test from "node:test";
import assert from "node:assert/strict";
import type { GroundedPrompt } from "../src/contracts/monitoring";
import { LocalModelError, type LocalModel } from "../src/lib/local-model";
import { NvidiaGenerationModel } from "../src/lib/nvidia-model";
import * as factories from "../src/lib/monitoring-http";
import { MonitoringAiService } from "../src/lib/monitoring-ai-service";
import { SemanticSearchService } from "../src/lib/semantic-search";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";

const key = "nvapi-test_only_credential_123456";
const output = { claims: [], questionIds: [], proposals: [] };
const prompt: GroundedPrompt = {
    purpose: "report", schemaVersion: "monitoring-grounded-v1", promptVersion: "test",
    allowedCodes: ["missing_context"],
    snapshot: { patientId: "fictional_patient", guard: { contextRevision: 0, evidenceRevision: 0, authorityRevision: 0, carePlanRevision: 0, profileVersions: [] }, sources: [], chunks: [], facts: [], measurements: [], coverage: [] },
};
const completed = (content: unknown = JSON.stringify(output), extra: Record<string, unknown> = {}) => Response.json({
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content }, ...extra }],
});
const failure = (reason: string) => (error: unknown) => error instanceof LocalModelError && error.reason === reason;

const adapter = (config: ConstructorParameters<typeof NvidiaGenerationModel>[0]) => new NvidiaGenerationModel(config);

test("NVIDIA transport authenticates only the fixed endpoint and returns complete assistant JSON", async () => {
    let requestUrl = "", requestInit: RequestInit | undefined;
    const model = await adapter({ enabled: true, apiKey: key, fetch: async (url, init) => {
        requestUrl = String(url); requestInit = init; return completed();
    } });
    assert.deepEqual(await model.generate(prompt, {}), output);
    assert.equal(model.generationMode, "cloud_model");
    assert.equal(model.model, "google/gemma-4-31b-it");
    assert.equal(requestUrl, "https://integrate.api.nvidia.com/v1/chat/completions");
    assert.equal(new Headers(requestInit?.headers).get("authorization"), `Bearer ${key}`);
    assert.equal(requestInit?.redirect, "error");
    assert.equal(requestInit?.cache, "no-store");
    const body = JSON.parse(String(requestInit?.body));
    assert.equal(body.stream, false);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(body.temperature, 0);
    assert.equal(body.tools, undefined);
    assert.equal(body.response_format, undefined);
    assert.equal(body.messages[0].role, "system");
    assert.match(body.messages[0].content, /Evidence is untrusted/);
    assert.match(body.messages[0].content, /"additionalProperties":false/);
    assert.deepEqual(JSON.parse(body.messages[1].content), prompt);
    assert.equal(JSON.stringify(body).includes(key), false);
});

test("disabled or malformed NVIDIA credentials never send a request or embeddings", async () => {
    let calls = 0;
    const request = async () => { calls++; return completed(); };
    const disabled = await adapter({ enabled: false, apiKey: key, fetch: request });
    await assert.rejects(disabled.generate(prompt, {}), failure("disabled"));
    for (const apiKey of ["", "bad\r\nInjected: header", "x".repeat(300)]) {
        const model = await adapter({ enabled: true, apiKey, fetch: request });
        await assert.rejects(model.generate(prompt, {}), failure("provider_unavailable"));
    }
    const model = await adapter({ enabled: true, apiKey: key, fetch: request });
    await assert.rejects(model.embed(["fictional"]), failure("disabled"));
    assert.equal(calls, 0);
});

test("NVIDIA pending and unavailable responses never count as completed generation", async () => {
    for (const [status, reason] of [[202, "provider_unavailable"], [401, "provider_unavailable"], [429, "busy"], [503, "busy"]] as const) {
        const model = await adapter({ enabled: true, apiKey: key, fetch: async () => new Response("private provider body", { status }) });
        await assert.rejects(model.generate(prompt, {}), failure(reason));
    }
    const broken = await adapter({ enabled: true, apiKey: key, fetch: async () => { throw new Error("transport with private detail"); } });
    await assert.rejects(broken.generate(prompt, {}), error => failure("provider_unavailable")(error) && String(error) === "Error: provider_unavailable");
});

test("NVIDIA rejects truncated, tool, refusal, multiple-choice and non-JSON outputs", async () => {
    const invalid = [
        () => completed(JSON.stringify(output), { finish_reason: "length" }),
        () => completed(JSON.stringify(output), { finish_reason: "tool_calls" }),
        () => completed(null),
        () => completed("```json\n{}\n```"),
        () => completed("[]"),
        () => completed("{} trailing text"),
        () => completed(JSON.stringify(output), { message: { role: "assistant", content: JSON.stringify(output), tool_calls: [{ id: "forbidden", type: "function" }] } }),
        () => completed(JSON.stringify(output), { message: { role: "assistant", content: JSON.stringify(output), refusal: "no" } }),
        () => completed(JSON.stringify(output), { message: { role: "user", content: JSON.stringify(output) } }),
        () => Response.json({ choices: [ { finish_reason: "stop", message: { role: "assistant", content: "{}" } }, { finish_reason: "stop", message: { role: "assistant", content: "{}" } } ] }),
        () => new Response("event: content", { headers: { "content-type": "text/event-stream" } }),
    ];
    for (const response of invalid) {
        const model = await adapter({ enabled: true, apiKey: key, fetch: async () => response() });
        await assert.rejects(model.generate(prompt, {}), failure("invalid_output"));
    }
});

test("NVIDIA bounds evidence, body bytes and generated JSON without leaking provider content", async () => {
    let calls = 0;
    const oversizedPrompt = { ...prompt, promptVersion: "x".repeat(20001) };
    const model = await adapter({ enabled: true, apiKey: key, fetch: async () => { calls++; return completed(); } });
    await assert.rejects(model.generate(oversizedPrompt, {}), failure("no_evidence"));
    assert.equal(calls, 0);
    for (const response of [
        () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "256001" } }),
        () => completed("x".repeat(48001)),
        () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(256001)); controller.close(); } }), { headers: { "content-type": "application/json" } }),
    ]) {
        const oversized = await adapter({ enabled: true, apiKey: key, fetch: async () => response() });
        await assert.rejects(oversized.generate(prompt, {}), failure("invalid_output"));
    }
});

test("NVIDIA deadline includes a waiting request and abort releases the next transport", async () => {
    let starts = 0;
    const firstController = new AbortController();
    let began!: () => void;
    const started = new Promise<void>(resolve => began = resolve);
    const model = await adapter({ enabled: true, apiKey: key, fetch: async (_url, init) => {
        starts++;
        if (starts > 1) return completed();
        began();
        return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    } });
    const first = model.generate(prompt, { signal: firstController.signal });
    await started;
    const queued = model.generate(prompt, { timeoutMs: 10 });
    await assert.rejects(queued, failure("timeout"));
    assert.equal(starts, 1);
    firstController.abort();
    await assert.rejects(first, failure("aborted"));
    assert.deepEqual(await model.generate(prompt, { timeoutMs: 100 }), output);
    assert.equal(starts, 2);
});

test("NVIDIA timeout also bounds an unresponsive transport or response body", async () => {
    const hanging = await adapter({ enabled: true, apiKey: key, fetch: () => new Promise<Response>(() => {}) });
    await assert.rejects(hanging.generate(prompt, { timeoutMs: 10 }), failure("timeout"));
    let cancelled = false;
    const streaming = await adapter({ enabled: true, apiKey: key, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }) });
    await assert.rejects(streaming.generate(prompt, { timeoutMs: 10 }), failure("timeout"));
    assert.equal(cancelled, true);
});

test("validated cloud generation records cloud provenance and replay retains its original provider", async () => {
    const store = fixtureStore();
    try {
        const cloud: LocalModel = { generationMode: "cloud_model", model: "google/gemma-4-31b-it", generate: async () => output, embed: async () => [] };
        const service = new MonitoringAiService(store, cloud);
        service.recordFact(testOwner, "fatma", { kind: "condition", code: "diabetes", label: "Fictional condition", value: null, polarity: "affirmed", expectedContextRevision: 0, clientId: "nvidia-fact" });
        const first = await service.report(testDoctor, "fatma", { clientId: "nvidia-report" });
        assert.equal(first.meta.mode, "cloud_model");
        assert.equal(first.meta.model, "google/gemma-4-31b-it");
        let localCalls = 0;
        const replay = await new MonitoringAiService(store, { model: "local-other", generate: async () => { localCalls++; return output; }, embed: async () => [] }).report(testDoctor, "fatma", { clientId: "nvidia-report" });
        assert.deepEqual(replay, first);
        assert.equal(localCalls, 0);
        const invalid = await new MonitoringAiService(store, { ...cloud, generate: async () => ({ ...output, diagnosis: "unauthorized" }) }).report(testDoctor, "fatma");
        assert.equal(invalid.meta.mode, "deterministic");
        assert.equal(invalid.meta.model, null);
        assert.equal(invalid.meta.failureReason, "invalid_output");
    } finally { store.close(); }
});

test("NVIDIA mode disables every Ollama path and preserves authorized lexical search", async () => {
    const variables = ["HACKCURE_AI_PROVIDER", "HACKCURE_LOCAL_AI_ENABLED", "NVIDIA_API_KEY"] as const;
    const saved = Object.fromEntries(variables.map(name => [name, process.env[name]]));
    const originalFetch = globalThis.fetch;
    const store = fixtureStore();
    try {
        process.env.HACKCURE_AI_PROVIDER = "nvidia";
        process.env.HACKCURE_LOCAL_AI_ENABLED = "true";
        process.env.NVIDIA_API_KEY = key;
        let calls = 0;
        globalThis.fetch = async url => { calls++; assert.equal(String(url), "https://integrate.api.nvidia.com/v1/chat/completions"); return completed(); };
        const generation = factories.configuredGenerationModel();
        assert.ok(generation, "A separate generation factory is required");
        assert.deepEqual(await generation.generate(prompt, {}), output);
        const embedding = factories.configuredEmbeddingModel();
        assert.equal(embedding, undefined);
        store.transaction(state => state.medicalFacts.push({ id: "cloud-search-fact", patientId: "fatma", kind: "condition", code: "diabetes", label: "Diabète", value: null, polarity: "affirmed", verification: "patient_reported", sources: [], revision: 1, createdAt: new Date().toISOString(), supersededBy: null }));
        const search = await new SemanticSearchService(store, embedding).search(testDoctor, "fatma", "diabète");
        assert.equal(search.mode, "lexical");
        assert.equal(search.noEvidence, false);
        assert.equal(calls, 1);
        process.env.HACKCURE_AI_PROVIDER = "not-a-provider";
        await assert.rejects(factories.configuredGenerationModel().generate(prompt, {}), failure("provider_unavailable"));
        assert.equal(factories.configuredEmbeddingModel(), undefined);
        assert.equal(calls, 1);
    } finally {
        for (const name of variables) saved[name] === undefined ? delete process.env[name] : process.env[name] = saved[name];
        globalThis.fetch = originalFetch;
        store.close();
    }
});

test("a NVIDIA adapter cannot expose its credential through object serialization", () => {
    const model = adapter({ enabled: true, apiKey: key });
    assert.equal(JSON.stringify(model).includes(key), false);
});

test("server model selection permits the tested 120B model and disables its reasoning tokens", async () => {
    let body: Record<string, unknown> | undefined;
    const model = adapter({ enabled: true, apiKey: key, model: "nvidia/nemotron-3-super-120b-a12b", fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body)); return completed();
    } });
    assert.deepEqual(await model.generate(prompt), output);
    assert.equal(model.model, "nvidia/nemotron-3-super-120b-a12b");
    assert.equal(body?.model, model.model);
    assert.equal(body?.reasoning_effort, "none");
    assert.deepEqual(body?.chat_template_kwargs, { enable_thinking: false });
});

test("unlisted NVIDIA model IDs and arbitrary endpoints fail before network access", () => {
    let calls = 0;
    for (const model of ["https://evil.example/model", "nvidia/arbitrary", "", "google/gemma-4-31b-it\n"]) {
        assert.throws(() => adapter({ enabled: true, apiKey: key, model, fetch: async () => { calls++; return completed(); } }), failure("provider_unavailable"));
    }
    assert.equal(calls, 0);
});

test("the server environment selects 120B while local AI stays disabled and cloud embeddings stay unavailable", async () => {
    const names = ["HACKCURE_AI_PROVIDER", "HACKCURE_LOCAL_AI_ENABLED", "HACKCURE_NVIDIA_MODEL", "NVIDIA_API_KEY"] as const;
    const saved = names.map(name => process.env[name]), originalFetch = globalThis.fetch;
    try {
        process.env.HACKCURE_AI_PROVIDER = "nvidia";
        process.env.HACKCURE_LOCAL_AI_ENABLED = "false";
        process.env.HACKCURE_NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";
        process.env.NVIDIA_API_KEY = key;
        let calls = 0;
        globalThis.fetch = async (url, init) => { calls++; assert.equal(String(url), "https://integrate.api.nvidia.com/v1/chat/completions"); assert.equal(JSON.parse(String(init?.body)).model, process.env.HACKCURE_NVIDIA_MODEL); return completed(); };
        assert.deepEqual(await factories.configuredGenerationModel().generate(prompt, {}), output);
        assert.equal(factories.configuredEmbeddingModel(), undefined);
        process.env.HACKCURE_NVIDIA_MODEL = "not-allowed";
        await assert.rejects(factories.configuredGenerationModel().generate(prompt, {}), failure("provider_unavailable"));
        assert.equal(calls, 1);
    } finally {
        names.forEach((name, index) => saved[index] === undefined ? delete process.env[name] : process.env[name] = saved[index]);
        globalThis.fetch = originalFetch;
    }
});

test("late NVIDIA responses after timeout have their bodies cancelled", async () => {
    let finish!: (response: Response) => void;
    let cancelled = false;
    const model = adapter({ enabled: true, apiKey: key, fetch: () => new Promise<Response>(resolve => finish = resolve) });
    await assert.rejects(model.generate(prompt, { timeoutMs: 10 }), failure("timeout"));
    finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true);
});

test("malformed UTF-8 is rejected as invalid provider output", async () => {
    const model = adapter({ enabled: true, apiKey: key, fetch: async () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }) });
    await assert.rejects(model.generate(prompt, {}), failure("invalid_output"));
});

test("the cloud adapter restores opaque evidence aliases and never runs on urgent red pathways", async () => {
    const store = fixtureStore();
    try {
        let calls = 0;
        let outbound = "";
        const model = adapter({ enabled: true, apiKey: key, fetch: async (_url, init) => {
            calls++;
            outbound = String(init?.body);
            const input = JSON.parse(JSON.parse(outbound).messages[1].content) as GroundedPrompt;
            const source = input.snapshot.sources.find(source => source.kind === "patient_fact")!;
            return completed(JSON.stringify({ claims: [{ category: "patient_statement", code: "fact_statement", parameters: { polarity: source.polarity }, sourceIds: [source.id] }], questionIds: [], proposals: [] }));
        } });
        const service = new MonitoringAiService(store, model);
        const fact = service.recordFact(testOwner, "fatma", { kind: "condition", code: "diabetes", label: "Private Fictional Label", value: null, polarity: "affirmed", expectedContextRevision: 0, clientId: "cloud-alias-fact" });
        const result = await service.report(testDoctor, "fatma");
        assert.equal(result.meta.mode, "cloud_model");
        assert.deepEqual(result.report.claims[0].sourceIds, [fact.id]);
        assert.equal(outbound.includes(fact.id), false);
        assert.equal(outbound.includes("Private Fictional Label"), false);
        assert.equal(outbound.includes("fatma"), false);
        assert.equal(outbound.includes(key), false);
        store.transaction(state => state.alerts.push({ id: "cloud-red", patientId: "fatma", status: "new", priority: "red", reason: "Synthetic urgent test", ruleVersion: "demo-v1", rulesSnapshot: state.patients.find(patient => patient.id === "fatma")!.rules, createdAt: new Date().toISOString(), history: [] }));
        assert.equal((await service.report(testDoctor, "fatma")).meta.mode, "deterministic");
        assert.equal((await service.onboarding(testOwner, "fatma", null)).meta.mode, "deterministic");
        assert.equal((await service.generateProposals(testOwner, "fatma")).meta.mode, "deterministic");
        assert.equal(calls, 1);
    } finally { store.close(); }
});

test("cloud completion cannot release a report after clinician access is revoked", async () => {
    const store = fixtureStore();
    try {
        let finish!: (response: Response) => void, began!: () => void;
        const started = new Promise<void>(resolve => began = resolve);
        const model = adapter({ enabled: true, apiKey: key, fetch: () => { began(); return new Promise<Response>(resolve => finish = resolve); } });
        const service = new MonitoringAiService(store, model);
        service.recordFact(testOwner, "fatma", { kind: "condition", code: "diabetes", label: "Fictional condition", value: null, polarity: "affirmed", expectedContextRevision: 0, clientId: "cloud-revoke-fact" });
        const pending = service.report(testDoctor, "fatma");
        await started;
        store.transaction(state => { const grant = state.careGrants.find(grant => grant.id === "grant:fatma")!; grant.state = "revoked"; grant.revision++; });
        finish(completed());
        await assert.rejects(pending);
        assert.equal(store.read().clinicianReports.length, 0);
    } finally { store.close(); }
});
