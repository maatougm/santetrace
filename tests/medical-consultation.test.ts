import test from "node:test";
import assert from "node:assert/strict";
import type { GroundedPrompt } from "../src/contracts/monitoring";
import { MedicalConsultationModel, unwrapMedicalConsultation } from "../src/lib/medical-consultation";
import { LocalModelError, OllamaLocalModel, type LocalModel } from "../src/lib/local-model";
import { MonitoringAiService } from "../src/lib/monitoring-ai-service";
import { AiCaseScoreService, currentAiCaseScore } from "../src/lib/ai-case-score";
import { configuredGenerationModel, configuredEmbeddingModel } from "../src/lib/monitoring-http";
import { modelCacheIdentity, configuredGenerationIdentity } from "../src/lib/generation-identity";
import { buildAuthorizedEvidence, redactEvidenceForModel } from "../src/lib/medical-evidence";
import { CLAIM_CODES, AI_SCHEMA_VERSION } from "../src/lib/monitoring-content";
import { CareService } from "../src/lib/care-service";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";

const MEDICAL_ID = "hf.co/unsloth/medgemma-1.5-4b-it-GGUF:Q4_K_M";
const BRAIN_ID = "nvidia/nemotron-3-super-120b-a12b";
const empty = () => ({ claims: [], questionIds: [], proposals: [] });
function models() {
  const brain: LocalModel = { model: BRAIN_ID, generationMode: "cloud_model", generate: async () => empty(), generateCaseScore: async prompt => ({ value: 33, sourceIds: [prompt.snapshot.sources.find(source => source.kind === "measurement")!.id] }), embed: async () => [] };
  const specialist: LocalModel = { model: MEDICAL_ID, generate: async prompt => ({ claims: [{ category: "patient_statement", code: "measurement_value", parameters: {}, sourceIds: [prompt.snapshot.sources.find(source => source.kind === "measurement")!.id] }], questionIds: [], proposals: [] }), embed: async () => [] };
  return { brain, specialist };
}
function setup() {
  const store = fixtureStore();
  new CareService(store).measurement(testOwner, "fatma", { kind: "glucose", value: 100, unit: "mg/dL", measuredAt: new Date().toISOString(), clientId: "medical-consultation-test" });
  const snapshot = redactEvidenceForModel(buildAuthorizedEvidence(store.read(), testDoctor, "fatma")).snapshot;
  const prompt: GroundedPrompt = { purpose: "report", schemaVersion: AI_SCHEMA_VERSION, promptVersion: "test", snapshot, allowedCodes: [...CLAIM_CODES] };
  return { store, prompt };
}

test("local medical selection precedes brain synthesis and never becomes new evidence", async () => {
  const f = setup();
  try {
    const { brain, specialist } = models();
    const order: string[] = [];
    const originalMedical = specialist.generate;
    specialist.generate = async (prompt, options) => { order.push("medical"); return originalMedical(prompt, options); };
    brain.generate = async prompt => {
      order.push("brain");
      assert.deepEqual(prompt.snapshot, f.prompt.snapshot);
      assert.equal(prompt.medicalAdvisory?.advisoryOnly, true);
      assert.equal(prompt.medicalAdvisory?.output.claims[0].sourceIds[0], "source_2");
      assert.equal(prompt.snapshot.sources.length, 2);
      return empty();
    };
    const result = unwrapMedicalConsultation(await new MedicalConsultationModel(brain, specialist).generate(f.prompt));
    assert.deepEqual(order, ["medical", "brain"]);
    assert.deepEqual(result.output, empty());
    assert.equal(result.consultation?.status, "consulted");
    assert.equal(result.consultation?.specialistModel, MEDICAL_ID);
    assert.equal(result.consultation?.brainModel, BRAIN_ID);
    assert.equal(result.consultation?.sourceCount, 1);
    // Arbitrary provider JSON cannot forge the private metadata envelope.
    assert.equal(unwrapMedicalConsultation({ output: empty(), consultation: result.consultation }).consultation, undefined);
  } finally { f.store.close(); }
});

test("unsupported medical claims, raw diagnoses, forged aliases and advisory bounds produce honest brain-only fallback", async () => {
  const claim = { category: "patient_statement", code: "measurement_value", parameters: {}, sourceIds: ["source_2"] };
  for (const raw of [{ ...empty(), diagnosis: "unsupported disease" }, { claims: [{ category: "confirmed_fact", code: "measurement_value", parameters: {}, sourceIds: ["other-patient"] }], questionIds: [], proposals: [] }, { claims: [claim,claim,claim,claim], questionIds: [], proposals: [] }]) {
    const f = setup();
    try {
      const { brain, specialist } = models();
      specialist.generate = async () => raw;
      brain.generate = async prompt => { assert.equal(prompt.medicalAdvisory, undefined); return empty(); };
      const result = unwrapMedicalConsultation(await new MedicalConsultationModel(brain, specialist).generate(f.prompt));
      assert.equal(result.consultation?.status, "unavailable");
      assert.equal(result.consultation?.failureReason, "invalid_output");
      assert.equal(result.consultation?.sourceCount, 0);
    } finally { f.store.close(); }
  }
});

test("medical timeout reserves the remaining budget for the brain; total deadline and external abort stop synthesis", async () => {
  const f = setup();
  try {
    const { brain, specialist } = models();
    specialist.generate = async () => new Promise(() => {});
    let brainBudget = 0;
    brain.generate = async (_, options) => { brainBudget = options.timeoutMs!; return empty(); };
    const wrapper = new MedicalConsultationModel(brain, specialist, { specialistTimeoutMs: 5, totalTimeoutMs: 100 });
    const result = unwrapMedicalConsultation(await wrapper.generate(f.prompt));
    assert.equal(result.consultation?.status, "unavailable");
    assert.equal(result.consultation?.failureReason, "timeout");
    assert.ok(brainBudget > 0 && brainBudget < 100);
    let synthesisCalls = 0;
    brain.generate = async () => { synthesisCalls++; return new Promise(() => {}); };
    await assert.rejects(new MedicalConsultationModel(brain, specialist, { specialistTimeoutMs: 100, totalTimeoutMs: 5 }).generate(f.prompt), error => error instanceof LocalModelError && error.reason === "timeout");
    synthesisCalls = 0;
    const controller = new AbortController();
    const pending = wrapper.generate(f.prompt, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error instanceof LocalModelError && error.reason === "aborted");
    assert.equal(synthesisCalls, 0);
  } finally { f.store.close(); }
});

test("a structurally valid proposal is forbidden as medical advisory and cannot leak to the brain", async () => {
  const f = setup();
  try {
    const { brain, specialist } = models();
    specialist.generate = async prompt => ({ ...empty(), proposals: [{ kind: "information", action: { templateId: "information.review", templateVersion: 1, parameters: {} }, sources: [prompt.snapshot.sources.find(source => source.kind === "measurement")!], missingQuestionIds: [] }] });
    brain.generate = async prompt => { assert.equal(prompt.medicalAdvisory, undefined); return empty(); };
    const result = unwrapMedicalConsultation(await new MedicalConsultationModel(brain, specialist).generate(f.prompt));
    assert.equal(result.consultation?.status, "unavailable");
    assert.equal(result.consultation?.failureReason, "invalid_output");
  } finally { f.store.close(); }
});

test("medical advisory cannot select missing-context questions or duplicate question IDs", async () => {
  for (const questionIds of [["condition.hypertension"], ["condition.diabetes", "condition.diabetes"]]) {
    const f = setup();
    try {
      const { brain, specialist } = models();
      const original = specialist.generate;
      specialist.generate = async (prompt, options) => ({ ...(await original(prompt, options) as Record<string, unknown>), questionIds });
      brain.generate = async prompt => { assert.equal(prompt.medicalAdvisory, undefined); return empty(); };
      const result = unwrapMedicalConsultation(await new MedicalConsultationModel(brain, specialist).generate(f.prompt));
      assert.equal(result.consultation?.status, "unavailable");
      assert.equal(result.consultation?.failureReason, "invalid_output");
    } finally { f.store.close(); }
  }
});

test("consultation queue is bounded and waiting consumes the same total deadline", async () => {
  const f = setup();
  try {
    const { brain, specialist } = models();
    let began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    specialist.generate = async () => { began(); return new Promise(() => {}); };
    const wrapper = new MedicalConsultationModel(brain, specialist);
    const controller = new AbortController();
    const active = wrapper.generate(f.prompt, { signal: controller.signal, timeoutMs: 1000 });
    const activeResult = assert.rejects(active, error => error instanceof LocalModelError && error.reason === "aborted");
    await started;
    const waiting = wrapper.generate(f.prompt, { timeoutMs: 5 });
    const waitingResult = assert.rejects(waiting, error => error instanceof LocalModelError && error.reason === "timeout");
    const secondController = new AbortController();
    const second = wrapper.generate(f.prompt, { signal: secondController.signal, timeoutMs: 1000 });
    const secondResult = assert.rejects(second, error => error instanceof LocalModelError && error.reason === "aborted");
    await assert.rejects(wrapper.generate(f.prompt), error => error instanceof LocalModelError && error.reason === "busy");
    await waitingResult;
    secondController.abort();
    controller.abort();
    await Promise.all([activeResult, secondResult]);
  } finally { f.store.close(); }
});

test("Ollama medical transport uses bounded context/output, empty proposals and keep_alive zero", async () => {
  const f = setup();
  try {
    let url = "", body: Record<string, unknown> | undefined;
    const model = new OllamaLocalModel({ enabled: true, model: MEDICAL_ID, contextTokens: 4096, numPredict: 512, keepAlive: 0, advisorySelection: true, fetch: async (target, options) => {
      url = String(target); body = JSON.parse(String(options?.body)); return Response.json({ response: JSON.stringify(empty()) });
    } });
    await model.generate(f.prompt, { timeoutMs: 100 });
    assert.equal(url, "http://127.0.0.1:11434/api/generate");
    assert.deepEqual(body?.options, { temperature: 0, num_predict: 512, num_ctx: 4096 });
    assert.equal(body?.keep_alive, 0);
    const schema = body?.format as { properties: { claims: { maxItems: number }; questionIds: { maxItems: number }; proposals: { maxItems: number } } };
    assert.equal(schema.properties.claims.maxItems, 3);
    assert.equal(schema.properties.questionIds.maxItems, 0);
    assert.equal(schema.properties.proposals.maxItems, 0);
    assert.match(String(body?.system), /Both questionIds and proposals MUST be empty arrays/);
    const hung = new OllamaLocalModel({ enabled: true, model: MEDICAL_ID, fetch: async () => new Promise(() => {}) });
    await assert.rejects(hung.generate(f.prompt, { timeoutMs: 5 }), error => error instanceof LocalModelError && error.reason === "timeout");
    const hungBody = new OllamaLocalModel({ enabled: true, model: MEDICAL_ID, fetch: async () => new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }) });
    await assert.rejects(hungBody.generate(f.prompt, { timeoutMs: 5 }), error => error instanceof LocalModelError && error.reason === "timeout");
  } finally { f.store.close(); }
});

test("consultation metadata is per-call, persisted on scores, and pipeline identity invalidates brain-only cache", async () => {
  const f = setup();
  try {
    const { brain, specialist } = models();
    const direct = await new AiCaseScoreService(f.store, brain).generate(testDoctor, "fatma");
    assert.equal(direct.aiCaseScore?.consultation, undefined);
    const consultedModel = new MedicalConsultationModel(brain, specialist);
    const consulted = await new AiCaseScoreService(f.store, consultedModel).generate(testDoctor, "fatma");
    assert.equal(consulted.cached, false);
    assert.equal(consulted.aiCaseScore?.consultation?.status, "consulted");
    assert.equal(consulted.aiCaseScore?.model, BRAIN_ID);
    assert.equal(consulted.aiCaseScore?.pipelineIdentity, modelCacheIdentity(consultedModel));
    assert.match(consultedModel.cacheIdentity, /source-bound-medical-consultation-v2$/);
    assert.equal(f.store.read().aiCaseScores?.length, 2);
    assert.equal(currentAiCaseScore(f.store.read(), testDoctor, "fatma", BRAIN_ID, consultedModel.cacheIdentity)?.id, consulted.aiCaseScore?.id);
    assert.equal((await new AiCaseScoreService(f.store, consultedModel).generate(testDoctor, "fatma")).cached, true);
    specialist.generate = async () => { throw new LocalModelError("provider_unavailable"); };
    const independent = unwrapMedicalConsultation(await consultedModel.generate(f.prompt));
    assert.equal(independent.consultation?.status, "unavailable");
    assert.equal(consulted.aiCaseScore?.consultation?.status, "consulted");
  } finally { f.store.close(); }
});

test("service fences retain red bypass, score authority and revocation during consultation", async () => {
  const f = setup();
  try {
    const { brain, specialist } = models();
    const wrapper = new MedicalConsultationModel(brain, specialist);
    let medicalCalls = 0;
    const original = specialist.generate;
    specialist.generate = async (prompt, options) => { medicalCalls++; return original(prompt, options); };
    const report = await new MonitoringAiService(f.store, wrapper).report(testDoctor, "fatma");
    assert.equal(report.meta.consultation?.status, "consulted");
    await assert.rejects(new AiCaseScoreService(f.store, wrapper).generate(testOwner, "fatma"));
    f.store.transaction(state => state.alerts.push({ id: "medical-red", patientId: "fatma", priority: "red", reason: "Fictional red", status: "new", ruleVersion: "demo", rulesSnapshot: state.patients[0].rules, createdAt: new Date().toISOString(), history: [] }));
    const red = await new MonitoringAiService(f.store, wrapper).report(testDoctor, "fatma");
    assert.equal(red.meta.mode, "deterministic");
    assert.equal(red.meta.consultation, undefined);
    assert.equal((await new AiCaseScoreService(f.store, wrapper).generate(testDoctor, "fatma")).reason, "red_policy");
    assert.equal(medicalCalls, 1);
    f.store.transaction(state => { state.alerts = []; });
    let release!: () => void, began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    specialist.generate = async prompt => { began(); await held; return original(prompt, {}); };
    const pending = new MonitoringAiService(f.store, wrapper).report(testDoctor, "fatma");
    await started;
    f.store.transaction(state => { state.careGrants.find(grant => grant.id === "grant:fatma")!.state = "revoked"; });
    release();
    await assert.rejects(pending);
    assert.equal(f.store.read().clinicianReports.length, 2);
  } finally { f.store.close(); }
});

test("score abstention and invalid brain JSON retain honest per-call consultation provenance", async () => {
  for (const [output, reason] of [[{ value: null, sourceIds: [] }, "abstained"], [{ value: 101, sourceIds: ["source_2"] }, "invalid_output"]] as const) {
    const f = setup();
    try {
      const { brain, specialist } = models();
      brain.generateCaseScore = async () => output;
      const result = await new AiCaseScoreService(f.store, new MedicalConsultationModel(brain, specialist)).generate(testDoctor, "fatma");
      assert.equal(result.aiCaseScore, null);
      assert.equal(result.reason, reason);
      assert.equal(result.consultation?.status, "consulted");
      assert.equal(f.store.read().aiCaseScores?.length ?? 0, 0);
    } finally { f.store.close(); }
  }
});

test("configuration is opt-in, uses explicit medical ID, keeps cloud embeddings disabled and fails closed", () => {
  const keys = ["HACKCURE_AI_PROVIDER", "HACKCURE_NVIDIA_MODEL", "HACKCURE_MEDICAL_SPECIALIST_ENABLED", "HACKCURE_MEDICAL_SPECIALIST_MODEL", "HACKCURE_OLLAMA_BASE_URL"];
  const before = keys.map(key => process.env[key]);
  try {
    process.env.HACKCURE_AI_PROVIDER = "nvidia";
    process.env.HACKCURE_NVIDIA_MODEL = BRAIN_ID;
    delete process.env.HACKCURE_MEDICAL_SPECIALIST_ENABLED;
    assert.equal(configuredGenerationModel().cacheIdentity, undefined);
    process.env.HACKCURE_MEDICAL_SPECIALIST_ENABLED = "true";
    process.env.HACKCURE_MEDICAL_SPECIALIST_MODEL = MEDICAL_ID;
    assert.equal(configuredGenerationModel() instanceof MedicalConsultationModel, true);
    assert.equal(configuredGenerationIdentity()?.cacheIdentity, configuredGenerationModel().cacheIdentity);
    assert.equal(configuredEmbeddingModel(), undefined);
    delete process.env.HACKCURE_MEDICAL_SPECIALIST_MODEL;
    assert.equal(configuredGenerationModel().model, undefined);
    assert.equal(configuredGenerationIdentity(), null);
    process.env.HACKCURE_MEDICAL_SPECIALIST_MODEL = MEDICAL_ID;
    process.env.HACKCURE_OLLAMA_BASE_URL = "https://attacker.example/";
    assert.equal(configuredGenerationModel().model, undefined);
  } finally { keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; }); }
});
