import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { AiCaseScore } from "../src/contracts/ai-case-score";
import type { MedicalConsultationMeta } from "../src/contracts/medical-consultation";
import type { RevisionGuard } from "../src/contracts/monitoring";
import { CARE_COPY } from "../src/lib/client/copy/care";
import { parseAiCaseScore, parseAiCaseScoreResponse, parseConsultationMeta, parsePipelineIdentity } from "../src/lib/client/doctor-api";
import { CONSULTATION_DISCLAIMER, consultationView } from "../src/components/doctor/care/consultation-view";
import { aiScoreCardState, type AiScoreCardInput } from "../src/components/doctor/record/ai-case-score-view";

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), "utf8");
const GUARD: RevisionGuard = { contextRevision: 2, evidenceRevision: 5, authorityRevision: 3, carePlanRevision: 1, profileVersions: ["htn:1"] };
const SPECIALIST = "org/specialist-model:Q4";
const BRAIN = "org/brain-model-v3";

function meta(overrides: Record<string, unknown> = {}): MedicalConsultationMeta {
  return {
    status: "consulted",
    specialistModel: SPECIALIST,
    brainModel: BRAIN,
    pipelineVersion: "source-bound-medical-consultation-v1",
    failureReason: null,
    durationMs: 1840,
    sourceCount: 2,
    ...overrides,
  } as MedicalConsultationMeta;
}

function score(overrides: Record<string, unknown> = {}): AiCaseScore {
  return {
    id: "s1",
    patientId: "p1",
    clinicianId: "c1",
    value: 41,
    status: "needs_review",
    sourceIds: ["m1"],
    createdAt: "2026-10-11T09:00:00.000Z",
    guard: GUARD,
    model: BRAIN,
    promptVersion: "fictional-case-attention-v1",
    limitations: [],
    evidenceFingerprint: "abc",
    ...overrides,
  } as AiCaseScore;
}

const input = (extra: Partial<AiScoreCardInput>): AiScoreCardInput => ({
  eligible: true,
  denied: false,
  data: null,
  readError: null,
  requesting: false,
  requestFailure: null,
  requestError: null,
  recordGuard: GUARD,
  hadScore: false,
  ...extra,
});

// ---------------------------------------------------------------------------
// Validator: only well-formed metadata survives; nothing is invented
// ---------------------------------------------------------------------------

test("each contract status parses into a fresh object with only the known fields", () => {
  const consulted = { ...meta(), extra: "dropped" };
  const parsed = parseConsultationMeta(consulted);
  assert.deepEqual(parsed, meta());
  assert.notEqual(parsed, consulted);
  assert.equal(parseConsultationMeta(meta({ status: "unavailable", failureReason: "timeout", sourceCount: 0 }))?.status, "unavailable");
  assert.equal(parseConsultationMeta(meta({ status: "unavailable", failureReason: null, sourceCount: 0 }))?.failureReason, null);
  assert.equal(parseConsultationMeta(meta({ status: "skipped", failureReason: "no_evidence", sourceCount: 0, durationMs: 0 }))?.status, "skipped");
});

test("malformed or missing metadata returns null instead of a guessed status", () => {
  const bad: Record<string, unknown>[] = [
    { status: undefined },
    { status: "enabled" },
    { status: "CONSULTED" },
    { status: 1 },
    { specialistModel: "" },
    { specialistModel: "   " },
    { specialistModel: 42 },
    { specialistModel: "x".repeat(201) },
    { specialistModel: "model\u0000id" },
    { specialistModel: "model‮id" },
    { brainModel: null },
    { brainModel: ["a"] },
    { pipelineVersion: "" },
    { pipelineVersion: { v: 1 } },
    { failureReason: "made_up" },
    { failureReason: 3 },
    { failureReason: undefined },
    { durationMs: -1 },
    { durationMs: 1.5 },
    { durationMs: Number.NaN },
    { durationMs: Number.POSITIVE_INFINITY },
    { durationMs: "1840" },
    { sourceCount: -1 },
    { sourceCount: 0.5 },
    { sourceCount: "2" },
    { sourceCount: null },
    // A "consulted" claim that also reports a failure is contradictory: never shown as consulted.
    { failureReason: "timeout" },
  ];
  for (const overrides of bad) {
    assert.equal(parseConsultationMeta({ ...meta(), ...overrides }), null, JSON.stringify(overrides));
  }
  const { status: _status, ...withoutStatus } = meta();
  assert.equal(parseConsultationMeta(withoutStatus), null);
  for (const value of [undefined, null, "consulted", 1, true, [], [meta()]]) {
    assert.equal(parseConsultationMeta(value), null, String(value));
  }
});

test("pipeline identity is kept only as a bounded, printable string", () => {
  assert.equal(parsePipelineIdentity(`${BRAIN}|medical=${SPECIALIST}|source-bound-medical-consultation-v1`), `${BRAIN}|medical=${SPECIALIST}|source-bound-medical-consultation-v1`);
  for (const value of [undefined, null, "", "  ", 7, {}, ["x"], "x".repeat(401), "a\nb"]) {
    assert.equal(parsePipelineIdentity(value), null, JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------
// doctor-api: optional metadata preserved when valid, dropped when not
// ---------------------------------------------------------------------------

test("a score keeps a valid consultation and pipeline identity", () => {
  const parsed = parseAiCaseScore(score({ consultation: { ...meta(), extra: 1 }, pipelineIdentity: "brain|medical=spec|v1" }));
  assert.equal(parsed?.value, 41);
  assert.deepEqual(parsed?.consultation, meta());
  assert.equal(parsed?.pipelineIdentity, "brain|medical=spec|v1");
});

test("an invalid consultation or identity is dropped without dropping the score", () => {
  const parsed = parseAiCaseScore(score({ consultation: { ...meta(), status: "enabled" }, pipelineIdentity: 12 }));
  assert.equal(parsed?.value, 41);
  assert.equal(parsed !== null && "consultation" in parsed, false);
  assert.equal(parsed !== null && "pipelineIdentity" in parsed, false);
  const plain = parseAiCaseScore(score());
  assert.equal(plain !== null && "consultation" in plain, false);
  // Existing guarantees still hold with metadata attached.
  assert.equal(parseAiCaseScore(score({ value: 101, consultation: meta() })), null);
  assert.equal(parseAiCaseScore(score({ status: "approved", consultation: meta() })), null);
});

test("a failed or abstained response keeps a valid response-level consultation", () => {
  const unavailable = meta({ status: "unavailable", failureReason: "timeout", sourceCount: 0 });
  assert.deepEqual(parseAiCaseScoreResponse({ aiCaseScore: null, reason: "abstained", cached: false, consultation: unavailable }), {
    aiCaseScore: null,
    reason: "abstained",
    cached: false,
    consultation: unavailable,
  });
  const dropped = parseAiCaseScoreResponse({ aiCaseScore: null, reason: "provider_unavailable", cached: false, consultation: { status: "consulted" } });
  assert.deepEqual(dropped, { aiCaseScore: null, reason: "provider_unavailable", cached: false });
  const withScore = parseAiCaseScoreResponse({ aiCaseScore: score({ consultation: meta() }), reason: null, cached: true });
  assert.equal(withScore.aiCaseScore?.consultation?.status, "consulted");
  assert.equal("consultation" in withScore, false);
});

// ---------------------------------------------------------------------------
// Presentation view model
// ---------------------------------------------------------------------------

test("consulted: specialist named only by the returned strings, with the source count", () => {
  assert.deepEqual(consultationView(meta()), {
    status: "consulted",
    icon: "stethoscope",
    title: "Spécialiste médical consulté",
    details: ["2 source(s) sélectionnée(s)"],
    models: { specialist: SPECIALIST, brain: BRAIN },
    disclaimer: CONSULTATION_DISCLAIMER,
  });
  assert.deepEqual(consultationView(meta({ sourceCount: 0 }))?.details, ["0 source(s) sélectionnée(s)"]);
});

test("unavailable: brain-only fallback, with the French reason when one is given", () => {
  const withReason = consultationView(meta({ status: "unavailable", failureReason: "timeout", sourceCount: 0 }));
  assert.deepEqual(withReason, {
    status: "unavailable",
    icon: "x-circle",
    title: "Spécialiste indisponible — repli sur le modèle principal seul",
    details: [`Motif : ${CARE_COPY.fr.aiFailure.timeout}`],
    models: null,
    disclaimer: CONSULTATION_DISCLAIMER,
  });
  const withoutReason = consultationView(meta({ status: "unavailable", failureReason: null, sourceCount: 0 }));
  assert.deepEqual(withoutReason?.details, []);
  assert.equal(withoutReason?.models, null);
});

test("skipped: specialist not used, no model or source claim", () => {
  assert.deepEqual(consultationView(meta({ status: "skipped", failureReason: "no_evidence", sourceCount: 0 })), {
    status: "skipped",
    icon: "minus",
    title: "Spécialiste non utilisé (aucune donnée admise adaptée)",
    details: [],
    models: null,
    disclaimer: CONSULTATION_DISCLAIMER,
  });
});

test("the honest line disclaims certification, diagnosis and treatment authority", () => {
  assert.match(CONSULTATION_DISCLAIMER, /expérimental/i);
  assert.match(CONSULTATION_DISCLAIMER, /certification/);
  assert.match(CONSULTATION_DISCLAIMER, /diagnostic/);
  assert.match(CONSULTATION_DISCLAIMER, /traitement/);
});

test("missing or invalid metadata yields no specialist claim at all", () => {
  for (const value of [undefined, null, {}, { status: "consulted" }, meta({ sourceCount: -2 }), meta({ status: "enabled" })]) {
    assert.equal(consultationView(value), null, JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------
// Score card: a response-level consultation follows the absent/failure state
// ---------------------------------------------------------------------------

test("absent state carries the response-level consultation only when one was returned", () => {
  const unavailable = meta({ status: "unavailable", failureReason: "provider_unavailable", sourceCount: 0 });
  const fromRead = aiScoreCardState(input({ data: { aiCaseScore: null, reason: "abstained", cached: false, consultation: unavailable } }));
  assert.equal(fromRead.kind === "absent" && fromRead.consultation?.status, "unavailable");
  const fromRequest = aiScoreCardState(input({ data: { aiCaseScore: null, reason: "no_evidence", cached: false }, requestFailure: "timeout", requestConsultation: unavailable }));
  assert.equal(fromRequest.kind === "absent" && fromRequest.consultation?.status, "unavailable");
  const none = aiScoreCardState(input({ data: { aiCaseScore: null, reason: "no_evidence", cached: false } }));
  assert.deepEqual(none, { kind: "absent", message: null, outdated: false, canRequest: true });
  // A withheld (stale) number never shows the provenance of the hidden estimate.
  const stale = aiScoreCardState(input({ data: { aiCaseScore: score({ consultation: meta() }), reason: null, cached: true }, recordGuard: { ...GUARD, evidenceRevision: 9 } }));
  assert.deepEqual(stale, { kind: "stale", canRequest: true });
});

// ---------------------------------------------------------------------------
// Static checks: wiring, no hardcoded model names, Plan Assistant untouched
// ---------------------------------------------------------------------------

test("the provenance is rendered in the meta line, score details and absent state", () => {
  assert.match(read("src/components/doctor/care/AiMetaLine.tsx"), /<ConsultationProvenance consultation=\{meta\.consultation\}/);
  assert.match(read("src/components/doctor/record/AiScoreDetails.tsx"), /<ConsultationProvenance consultation=\{score\.consultation\}/);
  assert.match(read("src/components/doctor/record/AiCaseScoreCard.tsx"), /<ConsultationProvenance consultation=\{consultation\}/);
  const component = read("src/components/doctor/care/ConsultationProvenance.tsx");
  assert.match(component, /consultationView\(consultation\)/);
  assert.match(component, /if \(!view\) return null;/);
  assert.match(component, /<bdi/);
});

test("no UI or client file hardcodes a specialist or brain model name", () => {
  const files = [
    "src/components/doctor/care/ConsultationProvenance.tsx",
    "src/components/doctor/care/consultation-view.ts",
    "src/components/doctor/care/AiMetaLine.tsx",
    "src/components/doctor/record/AiCaseScoreCard.tsx",
    "src/components/doctor/record/AiScoreDetails.tsx",
    "src/components/doctor/record/ai-case-score-view.ts",
    "src/lib/client/doctor-api.ts",
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /MedGemma|Nemotron|validée cliniquement|cliniquement validé/i, file);
  }
});

test("the patient Plan Assistant does not reference the consultation or the specialist", () => {
  const dir = join("src", "components", "patient", "plan");
  const files = readdirSync(join(process.cwd(), dir));
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotMatch(read(dir, file), /consultation|specialist|spécialiste|MedGemma|Nemotron|medicalAdvisory|pipelineIdentity/i, file);
  }
});
