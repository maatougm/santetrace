import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { Measurement } from "../src/lib/client/api";
import type { AccessEnvelope } from "../src/contracts/patient-platform";
import type { MedicalFact, RevisionGuard } from "../src/contracts/monitoring";
import type { AiCaseScore, AiCaseScoreResponse } from "../src/contracts/ai-case-score";
import { dashboardAiCaseScore, parseAiCaseScore, parseAiCaseScoreResponse } from "../src/lib/client/doctor-api";
import {
  AI_SCORE_REASON_TEXT,
  aiCaseScoreEligible,
  aiScoreCardState,
  guardKey,
  isBlockingFailure,
  limitationText,
  queueScoreView,
  sameGuard,
  scoreSourceItems,
  type AiScoreCardInput,
} from "../src/components/doctor/record/ai-case-score-view";
import { buildPatientQueue } from "../src/components/doctor/dashboard/queue";
import { readingProvenance } from "../src/components/patient/home/reading-provenance";

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), "utf8");
const at = (hour: number) => new Date(Date.UTC(2026, 9, 11, hour)).toISOString();
const GUARD: RevisionGuard = { contextRevision: 2, evidenceRevision: 5, authorityRevision: 3, carePlanRevision: 1, profileVersions: ["htn:1"] };

const PRIMARY: AccessEnvelope = {
  owner: false,
  relationship: "primary",
  scopes: ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"],
  grantId: "g1",
  grantRevision: 1,
  authorityRevision: 3,
  canManageCare: true,
  canReviewLabs: true,
};

function score(overrides: Partial<AiCaseScore> = {}): AiCaseScore {
  return {
    id: "s1",
    patientId: "p1",
    clinicianId: "c1",
    value: 62,
    status: "needs_review",
    sourceIds: ["m1", "f1"],
    createdAt: at(9),
    guard: GUARD,
    model: "google/gemma-4-31b-it",
    promptVersion: "fictional-case-attention-v1",
    limitations: ["Experimental AI estimation; doctor review required."],
    evidenceFingerprint: "abc",
    ...overrides,
  };
}

const bp = (id: string, extra: Partial<Measurement> = {}): Measurement =>
  ({
    id,
    patientId: "p1",
    kind: "blood_pressure",
    systolic: 150,
    diastolic: 95,
    unit: "mmHg",
    status: "orange",
    measuredAt: at(8),
    receivedAt: at(8),
    clientId: id,
    source: "app",
    ruleVersion: "demo-1",
    ...extra,
  }) as Measurement;

const pulse = (id: string, extra: Partial<Measurement> = {}): Measurement =>
  ({ ...bp(id), kind: "pulse", value: 72, unit: "bpm", status: "unknown", systolic: undefined, diastolic: undefined, ...extra }) as Measurement;

const fact: MedicalFact = {
  id: "f1",
  patientId: "p1",
  kind: "condition",
  code: "hypertension",
  label: "hypertension",
  value: null,
  polarity: "affirmed",
  verification: "confirmed",
  sources: [],
  revision: 1,
  createdAt: at(1),
  supersededBy: null,
};

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
// Client parsing: never display a number the server did not genuinely return
// ---------------------------------------------------------------------------

test("a genuine estimate parses; malformed values are refused", () => {
  assert.equal(parseAiCaseScore(score())?.value, 62);
  for (const bad of [
    { value: 62.5 },
    { value: -1 },
    { value: 101 },
    { value: "62" },
    { status: "approved" },
    { sourceIds: [] },
    { sourceIds: ["m1", "m1"] },
    { createdAt: "not a date" },
    { model: "" },
    { guard: { contextRevision: 1 } },
    { limitations: "text" },
  ]) {
    assert.equal(parseAiCaseScore({ ...score(), ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(parseAiCaseScore(null), null);
});

test("responses: malformed estimate becomes invalid_output, unknown reasons are not invented", () => {
  assert.deepEqual(parseAiCaseScoreResponse({ aiCaseScore: null, reason: "abstained", cached: false }), {
    aiCaseScore: null,
    reason: "abstained",
    cached: false,
  });
  const malformed = parseAiCaseScoreResponse({ aiCaseScore: { ...score(), value: 140 }, reason: null, cached: true });
  assert.equal(malformed.aiCaseScore, null);
  assert.equal(malformed.reason, "invalid_output");
  assert.equal(malformed.cached, false);
  assert.equal(parseAiCaseScoreResponse({ aiCaseScore: null, reason: "made_up", cached: false }).reason, null);
  assert.equal(parseAiCaseScoreResponse({ aiCaseScore: score(), reason: null, cached: true }).cached, true);
});

test("dashboard field: absent or null means no estimate; invalid is dropped", () => {
  assert.equal(dashboardAiCaseScore({}), null);
  assert.equal(dashboardAiCaseScore({ aiCaseScore: null }), null);
  assert.equal(dashboardAiCaseScore({ aiCaseScore: { ...score(), value: 3.2 } }), null);
  assert.equal(dashboardAiCaseScore({ aiCaseScore: score() })?.value, 62);
});

// ---------------------------------------------------------------------------
// Eligibility: managing primary clinician only
// ---------------------------------------------------------------------------

test("only a managing primary clinician is eligible", () => {
  assert.equal(aiCaseScoreEligible(PRIMARY), true);
  assert.equal(aiCaseScoreEligible({ ...PRIMARY, canManageCare: false }), false);
  assert.equal(aiCaseScoreEligible({ ...PRIMARY, relationship: "specialist", canManageCare: false }), false);
  assert.equal(aiCaseScoreEligible({ ...PRIMARY, relationship: "generalist" }), false);
  assert.equal(aiCaseScoreEligible({ ...PRIMARY, owner: true, relationship: null, canManageCare: false }), false);
  assert.equal(aiCaseScoreEligible(null), false);
});

// ---------------------------------------------------------------------------
// Queue cell: genuine value only, never used for ordering
// ---------------------------------------------------------------------------

test("queue cell shows only a genuine value, never for a non-eligible clinician", () => {
  assert.deepEqual(queueScoreView(score(), true), { kind: "value", value: 62 });
  assert.deepEqual(queueScoreView(null, true), { kind: "none", text: "Non calculé" });
  assert.equal(queueScoreView(score(), false).kind, "none");
});

test("queue order ignores the AI estimate", () => {
  const base = { region: "Tunis", age: 50, language: "fr", access: PRIMARY, queue: null, rules: null } as const;
  const patients = [
    { ...base, id: "a", displayName: "Amel", monitoring: null, aiCaseScore: score({ value: 99 }) },
    { ...base, id: "b", displayName: "Badr", monitoring: null, aiCaseScore: null },
  ];
  const withScores = buildPatientQueue(patients as never, []).map((row) => row.patient.id);
  const swapped = buildPatientQueue(
    patients.map((p) => ({ ...p, aiCaseScore: p.id === "a" ? null : score({ value: 99 }) })) as never,
    [],
  ).map((row) => row.patient.id);
  assert.deepEqual(withScores, swapped);
});

// ---------------------------------------------------------------------------
// Record card states
// ---------------------------------------------------------------------------

test("hidden for non-eligible access or a server denial", () => {
  assert.equal(aiScoreCardState(input({ eligible: false, data: { aiCaseScore: score(), reason: null, cached: true } })).kind, "hidden");
  assert.equal(aiScoreCardState(input({ denied: true })).kind, "hidden");
});

test("current estimate is shown; a record revision past it withholds the number", () => {
  const data: AiCaseScoreResponse = { aiCaseScore: score(), reason: null, cached: true };
  assert.equal(aiScoreCardState(input({ data })).kind, "score");
  const moved = aiScoreCardState(input({ data, recordGuard: { ...GUARD, evidenceRevision: 6 } }));
  assert.deepEqual(moved, { kind: "stale", canRequest: true });
  assert.equal(aiScoreCardState(input({ data, recordGuard: { ...GUARD, profileVersions: ["htn:2"] } })).kind, "stale");
  assert.equal(sameGuard(GUARD, { ...GUARD, profileVersions: [...GUARD.profileVersions], proposalRevision: 9 }), true);
});

test("fails closed: no record revision means the number is withheld", () => {
  const data: AiCaseScoreResponse = { aiCaseScore: score(), reason: null, cached: true };
  assert.deepEqual(aiScoreCardState(input({ data, recordGuard: undefined })), { kind: "stale", canRequest: true });
  assert.deepEqual(aiScoreCardState(input({ data, recordGuard: null })), { kind: "stale", canRequest: true });
});

test("an explicit request's failure is not hidden behind an older stale estimate", () => {
  const data: AiCaseScoreResponse = { aiCaseScore: score(), reason: null, cached: true };
  const moved = { ...GUARD, evidenceRevision: 9 };
  assert.deepEqual(aiScoreCardState(input({ data, recordGuard: moved, requestFailure: "timeout" })), {
    kind: "absent",
    message: AI_SCORE_REASON_TEXT.timeout,
    outdated: false,
    canRequest: true,
  });
  assert.equal(aiScoreCardState(input({ data, recordGuard: moved, requestError: "Serveur injoignable" })).kind, "error");
  // A current estimate still wins: no button exists in that state, so no failure can be pending for it.
  assert.equal(aiScoreCardState(input({ data, requestFailure: "timeout" })).kind, "score");
});

test("blocking reasons and revision keys used to clear outdated request outcomes", () => {
  assert.equal(isBlockingFailure("red_policy"), true);
  assert.equal(isBlockingFailure("provider_unavailable"), true);
  assert.equal(isBlockingFailure("abstained"), false);
  assert.equal(isBlockingFailure(null), false);
  assert.equal(guardKey(undefined), null);
  assert.equal(guardKey(GUARD), guardKey({ ...GUARD, profileVersions: [...GUARD.profileVersions], proposalRevision: 4 }));
  assert.notEqual(guardKey(GUARD), guardKey({ ...GUARD, carePlanRevision: 2 }));
});

test("the record mounts one score card per patient (no state leaks between patients)", () => {
  assert.match(read("src/components/doctor/record/PatientRecordView.tsx"), /<AiCaseScoreCard key=\{patientId\} patientId=\{patientId\}/);
});

test("no estimate yet: 'non calculé' with the explicit request button, not a no-evidence claim", () => {
  const state = aiScoreCardState(input({ data: { aiCaseScore: null, reason: "no_evidence", cached: false } }));
  assert.deepEqual(state, { kind: "absent", message: null, outdated: false, canRequest: true });
  const outdated = aiScoreCardState(input({ data: { aiCaseScore: null, reason: "no_evidence", cached: false }, hadScore: true }));
  assert.equal(outdated.kind === "absent" && outdated.outdated, true);
});

test("blocking reasons disable the request; explicit failures keep their own message", () => {
  for (const reason of ["red_policy", "provider_unavailable", "disabled"] as const) {
    const state = aiScoreCardState(input({ data: { aiCaseScore: null, reason, cached: false } }));
    assert.deepEqual(state, { kind: "absent", message: AI_SCORE_REASON_TEXT[reason], outdated: false, canRequest: false });
  }
  const abstained = aiScoreCardState(input({ data: { aiCaseScore: null, reason: "no_evidence", cached: false }, requestFailure: "abstained" }));
  assert.deepEqual(abstained, { kind: "absent", message: AI_SCORE_REASON_TEXT.abstained, outdated: false, canRequest: true });
});

test("busy while the explicit request runs; loading and read errors before any answer", () => {
  assert.equal(aiScoreCardState(input({ requesting: true })).kind, "busy");
  assert.equal(aiScoreCardState(input({})).kind, "loading");
  assert.deepEqual(aiScoreCardState(input({ readError: "Serveur injoignable" })), { kind: "error", message: "Serveur injoignable", canRequest: true });
  assert.equal(aiScoreCardState(input({ requestError: "Délai dépassé" })).kind, "error");
});

test("every failure reason has French copy without a number", () => {
  for (const [reason, text] of Object.entries(AI_SCORE_REASON_TEXT)) {
    assert.ok(text.length > 10, reason);
    assert.doesNotMatch(text, /\d/, reason);
  }
});

// ---------------------------------------------------------------------------
// Sources and limitations: real data only
// ---------------------------------------------------------------------------

test("sources resolve only against the visible record; unknown IDs stay raw", () => {
  const simulated = bp("m1", { source: "simulated" });
  const items = scoreSourceItems(["m1", "f1", "zz-9"], { measurements: [simulated], medicalFacts: [fact] });
  assert.equal(items[0].kind, "measurement");
  assert.ok(items[0].kind === "measurement" && items[0].badges.some((badge) => badge.key === "simulated"));
  assert.equal(items[1].kind, "fact");
  assert.deepEqual(items[2], { id: "zz-9", kind: "unresolved" });
});

test("known limitations are translated; unknown ones are shown verbatim and flagged", () => {
  assert.equal(limitationText("Experimental AI estimation; doctor review required.").translated, true);
  assert.deepEqual(limitationText("New server caveat."), { text: "New server caveat.", translated: false });
});

// ---------------------------------------------------------------------------
// Explicit generation only; no model claims
// ---------------------------------------------------------------------------

test("the model is only requested from the explicit click handler, never on render or polling", () => {
  const card = read("src/components/doctor/record/AiCaseScoreCard.tsx");
  assert.equal(card.match(/requestAiCaseScore\(/g)?.length, 1);
  const handler = card.slice(card.indexOf("const request = async () => {"));
  assert.ok(handler.indexOf("requestAiCaseScore(") > 0 && handler.indexOf("requestAiCaseScore(") < handler.indexOf("return { request"));
  assert.match(card, /onClick=\{onRequest\}/);
  assert.doesNotMatch(read("src/lib/client/doctor-api.ts").split("export async function getAiCaseScore")[1].split("export async function requestAiCaseScore")[0], /POST/);
});

test("the UI names no specific model and claims no validation beyond the returned model string", () => {
  for (const file of ["AiCaseScoreCard.tsx", "AiScoreDetails.tsx", "ai-case-score-view.ts"]) {
    const source = read("src/components/doctor/record", file);
    assert.doesNotMatch(source, /MedGemma|Nemotron|validée cliniquement|cliniquement validé/i, file);
  }
});

// ---------------------------------------------------------------------------
// Patient home: a visible number keeps its provenance (independent review P2)
// ---------------------------------------------------------------------------

test("reading provenance flags simulated, suspect and unscored readings", () => {
  assert.deepEqual(readingProvenance(bp("m1")), []);
  assert.deepEqual(readingProvenance(bp("m2", { source: "simulated" })), ["simulated"]);
  assert.deepEqual(
    readingProvenance(pulse("m3", { source: "device", connector: { connectorId: "c", deviceId: "d", externalEventId: "e", simulated: true, quality: "suspect" } } as Partial<Measurement>)),
    ["unscored", "simulated", "suspect"],
  );
  assert.deepEqual(readingProvenance(pulse("m4")), ["unscored"]);
});

test("the collapsed latest-reading summary renders provenance next to the number", () => {
  const source = read("src/components/patient/home/LatestReading.tsx");
  assert.match(source, /value=\{latest \? <SummaryReading measurement=\{latest\}/);
  const summary = source.slice(source.indexOf("function SummaryReading"));
  assert.match(summary.slice(0, summary.indexOf("export function")), /<ProvenanceBadges measurement=\{measurement\}/);
});
