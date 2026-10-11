import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { ExternalNote } from "../src/contracts/external-visit";
import type { AiMeta, CarePlan, MedicalFact, OnboardingQuestion } from "../src/contracts/monitoring";
import type { AccessJournalEntry, CareGrant, DoctorProfile, GrantIssueResult } from "../src/contracts/patient-platform";
import { bindToFence, createAccessFence } from "../src/lib/client/access-fence";
import { ApiError } from "../src/lib/client/transport";
import {
  DISCARDED_REVEAL,
  HIDDEN_REVEAL,
  canEditScopes,
  doctorChoices,
  hasOpenPrimary,
  mergeJournal,
  revealReducer,
  sortGrants,
  toGrantIssue,
  upsertGrant,
  validateInvite,
  validateScopeSelection,
} from "../src/components/patient/access/access-model";
import { captureAction, fencedCall, runAction } from "../src/components/patient/record/fenced-call";
import {
  answeredCount,
  buildAnswer,
  buildOnboardingInput,
  factNeedsEmergencyLine,
  onboardingDoneBody,
  onboardingModeLine,
  onboardingModeNotice,
  polarityLabel,
  questionNeedsEmergencyLine,
  savedFactsSummary,
} from "../src/components/patient/record/onboarding-model";
import { CARE_COPY } from "../src/lib/client/copy/care";
import {
  applySavedFact,
  contextRevisionSource,
  currentFacts,
  factLines,
  previousVersions,
  referentStatus,
  sortExternalNotes,
  toFactCorrection,
  toFactInput,
  validateFactDraft,
  type FactDraft,
} from "../src/components/patient/record/record-model";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const at = (minute: number) => new Date(Date.UTC(2026, 9, 11, 8, minute)).toISOString();

const question = (id: string, answerKind: OnboardingQuestion["answerKind"], required = false, allowedValues: string[] = []): OnboardingQuestion => ({
  id,
  labelKey: `onboarding.${id}`,
  answerKind,
  allowedValues,
  required,
});

const fact = (id: string, minute: number, extra: Partial<MedicalFact> = {}): MedicalFact => ({
  id,
  patientId: "p1",
  kind: "condition",
  code: "hypertension",
  label: `Fact ${id}`,
  value: null,
  polarity: "affirmed",
  verification: "patient_reported",
  sources: [],
  revision: 1,
  createdAt: at(minute),
  supersededBy: null,
  ...extra,
});

const grant = (id: string, extra: Partial<CareGrant> = {}): CareGrant => ({
  id,
  patientId: "p1",
  clinicianId: `doc-${id}`,
  relationship: "generalist",
  scopes: ["status"],
  state: "active",
  issuedAt: at(1),
  acceptedAt: at(2),
  revokedAt: null,
  revision: 1,
  ...extra,
});

const doctor = (id: string): DoctorProfile => ({ id, displayName: `Dr ${id}`, specialty: "Cardiologie", fictional: true });

const plan = (state: CarePlan["state"]): CarePlan => ({
  id: "plan-1",
  patientId: "p1",
  revision: 1,
  state,
  clinicianId: null,
  profileBindings: [],
  actionIds: [],
  reviewDeadline: null,
});

const meta = (mode: AiMeta["mode"], failureReason: AiMeta["failureReason"]): AiMeta => ({
  mode,
  model: null,
  schemaVersion: "1",
  promptVersion: "1",
  guard: { contextRevision: 4, evidenceRevision: 1, authorityRevision: 2, carePlanRevision: 0, profileVersions: [] },
  generatedAt: at(0),
  stale: false,
  failureReason,
});

// ---------------------------------------------------------------------------
// Onboarding answers: "je ne sais pas" is unknown, never "non"
// ---------------------------------------------------------------------------

test("a boolean 'je ne sais pas' is sent as polarity unknown with a null value, never negated", () => {
  const result = buildAnswer(question("diabetes", "boolean"), { kind: "unknown" });
  assert.deepEqual(result, { status: "answer", answer: { questionId: "diabetes", value: null, polarity: "unknown" } });
});

test("boolean Oui/Non map to affirmed true and negated false", () => {
  assert.deepEqual(buildAnswer(question("hta", "boolean"), { kind: "yes" }), {
    status: "answer",
    answer: { questionId: "hta", value: true, polarity: "affirmed" },
  });
  assert.deepEqual(buildAnswer(question("hta", "boolean"), { kind: "no" }), {
    status: "answer",
    answer: { questionId: "hta", value: false, polarity: "negated" },
  });
});

test("text answers: trimmed text is affirmed, unknown stays unknown, an empty optional answer is omitted", () => {
  const treatment = question("treatment", "text");
  assert.deepEqual(buildAnswer(treatment, { kind: "value", value: "  Amlodipine 5 mg  " }), {
    status: "answer",
    answer: { questionId: "treatment", value: "Amlodipine 5 mg", polarity: "affirmed" },
  });
  assert.deepEqual(buildAnswer(treatment, { kind: "unknown" }), {
    status: "answer",
    answer: { questionId: "treatment", value: null, polarity: "unknown" },
  });
  assert.deepEqual(buildAnswer(treatment, { kind: "value", value: "   " }), { status: "omitted" });
  assert.deepEqual(buildAnswer(treatment, { kind: "skip" }), { status: "omitted" });
  assert.deepEqual(buildAnswer(treatment, undefined), { status: "omitted" });
});

test("a yes/no choice on a non-boolean question and an unlisted choice are invalid, not guessed", () => {
  assert.deepEqual(buildAnswer(question("treatment", "text"), { kind: "no" }), { status: "invalid" });
  assert.deepEqual(buildAnswer(question("kind", "choice", false, ["a", "b"]), { kind: "value", value: "c" }), { status: "invalid" });
  assert.deepEqual(buildAnswer(question("weight", "number"), { kind: "value", value: "abc" }), { status: "invalid" });
  assert.deepEqual(buildAnswer(question("weight", "number"), { kind: "value", value: "72,5" }), {
    status: "answer",
    answer: { questionId: "weight", value: 72.5, polarity: "affirmed" },
  });
});

test("numbers typed with an Arabic keyboard (Arabic-Indic digits, ٫ separator) are read, not rejected", () => {
  assert.deepEqual(buildAnswer(question("weight", "number"), { kind: "value", value: "٧٢٫٥" }), {
    status: "answer",
    answer: { questionId: "weight", value: 72.5, polarity: "affirmed" },
  });
  assert.deepEqual(buildAnswer(question("weight", "number"), { kind: "value", value: "۸۰" }), {
    status: "answer",
    answer: { questionId: "weight", value: 80, polarity: "affirmed" },
  });
});

test("submission input carries the context revision and clientId; a required question needs an answer (unknown counts)", () => {
  const questions = [question("hta", "boolean", true), question("symptom", "text")];
  const missing = buildOnboardingInput(questions, { symptom: { kind: "skip" } }, 4, "cid-1");
  assert.equal(missing.input, null);
  assert.deepEqual(missing.missing, ["hta"]);

  const built = buildOnboardingInput(questions, { hta: { kind: "unknown" }, stale: { kind: "yes" } }, 4, "cid-1");
  assert.deepEqual(built.missing, []);
  assert.deepEqual(built.input, {
    answers: [{ questionId: "hta", value: null, polarity: "unknown" }],
    expectedContextRevision: 4,
    clientId: "cid-1",
  });
  assert.ok(!built.input?.answers.some((answer) => answer.polarity === "negated"));
});

test("answered count includes explicit skips and unknowns, ignores answers to questions no longer asked", () => {
  const questions = [question("hta", "boolean"), question("diabetes", "boolean"), question("treatment", "text")];
  assert.equal(answeredCount(questions, { hta: { kind: "unknown" }, treatment: { kind: "skip" }, gone: { kind: "yes" } }), 2);
  assert.equal(answeredCount(questions, { treatment: { kind: "value", value: " " } }), 0);
});

test("polarity labels: unknown reads 'Je ne sais pas' / 'لا أعرف', never the negated label", () => {
  assert.equal(polarityLabel("unknown", "fr"), "Je ne sais pas");
  assert.equal(polarityLabel("unknown", "ar"), "لا أعرف");
  assert.notEqual(polarityLabel("unknown", "fr"), polarityLabel("negated", "fr"));
  assert.notEqual(polarityLabel("unknown", "ar"), polarityLabel("negated", "ar"));
});

test("done text claims a doctor review only when a care team is present; unknown never claims it", () => {
  assert.equal(onboardingDoneBody("present", "fr"), CARE_COPY.fr.onboarding.doneBody);
  assert.equal(onboardingDoneBody("none", "fr"), CARE_COPY.fr.onboarding.doneBodyNoDoctor);
  assert.equal(onboardingDoneBody("unknown", "fr"), CARE_COPY.fr.onboarding.doneBodyNoDoctor);
  assert.equal(onboardingDoneBody("unknown", "ar"), CARE_COPY.ar.onboarding.doneBodyNoDoctor);
});

test("the 190 emergency line goes with the symptom question and symptom facts only", () => {
  assert.equal(questionNeedsEmergencyLine({ ...question("symptom", "text"), labelKey: "onboarding.symptom" }), true);
  assert.equal(questionNeedsEmergencyLine({ ...question("hta", "boolean"), labelKey: "onboarding.hypertension" }), false);
  assert.equal(factNeedsEmergencyLine("symptom"), true);
  assert.equal(factNeedsEmergencyLine("condition"), false);
  assert.equal(factNeedsEmergencyLine("allergy"), false);
});

test("AI mode notice: a failure reason always shows the fallback, deterministic is labelled, model is plain", () => {
  assert.deepEqual(onboardingModeNotice(meta("deterministic", "timeout")), { kind: "fallback", reason: "timeout" });
  assert.deepEqual(onboardingModeNotice(meta("local_model", "invalid_output")), { kind: "fallback", reason: "invalid_output" });
  assert.deepEqual(onboardingModeNotice(meta("deterministic", null)), { kind: "deterministic" });
  assert.deepEqual(onboardingModeNotice(meta("local_model", null)), { kind: "model", mode: "local_model" });
  assert.deepEqual(onboardingModeNotice(meta("cloud_model", "timeout")), { kind: "fallback", reason: "timeout" });
});

const UNKNOWN_MODES = ["mystery", "__proto__", "constructor", "toString"];

test("unknown AI modes claim no provenance (no local, cloud or fixed-rule label) and render nothing, in FR and AR", () => {
  for (const mode of UNKNOWN_MODES) {
    const unknown = { ...meta("local_model", null), mode: mode as AiMeta["mode"] };
    assert.deepEqual(onboardingModeNotice(unknown), { kind: "unknown" }, mode);
    for (const lang of ["fr", "ar"] as const) assert.equal(onboardingModeLine(unknown, lang), null, `${mode} ${lang}`);
  }
});

test("mode lines are plain text for every real case, in FR and AR: cloud, local, fixed rules and fallback", () => {
  for (const lang of ["fr", "ar"] as const) {
    const copy = CARE_COPY[lang];
    assert.deepEqual(onboardingModeLine(meta("cloud_model", null), lang), { style: "meta", text: copy.aiMode.cloud_model });
    assert.deepEqual(onboardingModeLine(meta("local_model", null), lang), { style: "meta", text: copy.aiMode.local_model });
    assert.deepEqual(onboardingModeLine(meta("deterministic", null), lang), { style: "note", text: copy.onboarding.deterministic });
    assert.deepEqual(onboardingModeLine(meta("cloud_model", "provider_unavailable"), lang), {
      style: "note",
      text: copy.onboarding.modelFallback(copy.aiFailure.provider_unavailable),
    });
    assert.notEqual(onboardingModeLine(meta("cloud_model", null), lang)?.text, copy.aiMode.local_model);
  }
});

test("an unrecognised failure reason still shows the fixed-question note, never an inherited property", () => {
  for (const reason of ["mystery", ...UNKNOWN_MODES.slice(1)]) {
    const failed = meta("cloud_model", reason as AiMeta["failureReason"]);
    assert.deepEqual(onboardingModeNotice(failed), { kind: "fallback", reason: null }, reason);
    for (const lang of ["fr", "ar"] as const) {
      const line = onboardingModeLine(failed, lang);
      assert.deepEqual(line, { style: "note", text: CARE_COPY[lang].onboarding.deterministic });
      assert.equal(typeof line?.text, "string");
    }
  }
});

test("AI mode notice: a cloud model answer is labelled remote, never 'Modèle local'; local stays local", () => {
  const cloud = onboardingModeNotice(meta("cloud_model", null));
  assert.deepEqual(cloud, { kind: "model", mode: "cloud_model" });
  for (const lang of ["fr", "ar"] as const) {
    const label: string = cloud.kind === "model" ? CARE_COPY[lang].aiMode[cloud.mode] : "";
    assert.equal(label, CARE_COPY[lang].aiMode.cloud_model);
    assert.notEqual(label, CARE_COPY[lang].aiMode.local_model);
  }
  const local = onboardingModeNotice(meta("local_model", null));
  assert.equal(local.kind === "model" ? CARE_COPY.fr.aiMode[local.mode] : "", CARE_COPY.fr.aiMode.local_model);
});

// ---------------------------------------------------------------------------
// Facts: current versions shown, history kept
// ---------------------------------------------------------------------------

test("current facts hide superseded versions, newest first, without mutating the input", () => {
  const facts = Object.freeze([
    fact("v1", 1, { supersededBy: "v2" }),
    fact("v2", 5, { revision: 2, correction: { correctsFactId: "v1", reason: "typo" } }),
    fact("allergy", 3, { kind: "allergy", code: null }),
  ]);
  assert.deepEqual(
    currentFacts(facts).map((f) => f.id),
    ["v2", "allergy"],
  );
  assert.equal(facts.length, 3);
});

test("fact lines show display names, never raw registry codes: known codes named, 'declared' as its kind, typed labels as written", () => {
  const facts = [
    fact("hta", 1, { code: "hypertension", label: "hypertension" }),
    fact("dia", 2, { code: "diabetes", label: "diabetes", polarity: "unknown" }),
    fact("sym", 3, { kind: "symptom", code: null, label: "declared" }),
    fact("typed", 4, { kind: "allergy", code: null, label: "Pénicilline" }),
    fact("odd", 5, { code: "asthma", label: "asthma" }),
  ];
  assert.deepEqual(
    factLines(facts, "fr").map((line) => line.label),
    ["Hypertension artérielle", "Diabète", "Symptôme", "Pénicilline", "asthma"],
  );
  assert.deepEqual(
    factLines(facts, "ar").map((line) => line.label),
    ["ارتفاع ضغط الدم", "السكري", "عَرَض", "Pénicilline", "asthma"],
  );
  const raw = /^(hypertension|diabetes|declared)$/;
  assert.ok(factLines(facts, "fr").every((line) => !raw.test(line.label)));
  assert.equal(factLines(facts, "fr")[1].polarity, "unknown", "the answer is carried unchanged");
});

test("onboarding saved summary lists current facts only, newest first, with display labels", () => {
  const facts = [
    fact("old", 1, { code: "hypertension", label: "hypertension", supersededBy: "new" }),
    fact("new", 3, { code: "hypertension", label: "hypertension", revision: 2, correction: { correctsFactId: "old", reason: "x" } }),
    fact("sym", 2, { kind: "symptom", code: null, label: "declared" }),
  ];
  assert.deepEqual(
    savedFactsSummary(facts, "fr").map((line) => [line.id, line.label]),
    [
      ["new", "Hypertension artérielle"],
      ["sym", "Symptôme"],
    ],
  );
});

test("previous versions follow the correction chain (history kept) and survive a cycle", () => {
  const facts = [
    fact("v1", 1, { supersededBy: "v2" }),
    fact("v2", 2, { supersededBy: "v3", correction: { correctsFactId: "v1", reason: "a" } }),
    fact("v3", 3, { correction: { correctsFactId: "v2", reason: "b" } }),
    fact("loop-a", 4, { supersededBy: "loop-b", correction: { correctsFactId: "loop-b", reason: "x" } }),
    fact("loop-b", 5, { supersededBy: "loop-a", correction: { correctsFactId: "loop-a", reason: "y" } }),
  ];
  assert.deepEqual(
    previousVersions(facts, facts[2]).map((f) => f.id),
    ["v2", "v1"],
  );
  assert.deepEqual(
    previousVersions(facts, facts[3]).map((f) => f.id),
    ["loop-b"],
  );
});

test("a saved correction marks the corrected fact superseded and adds the new version, immutably", () => {
  const original = fact("v1", 1);
  const facts = Object.freeze([original]);
  const saved = fact("v2", 2, { revision: 2, correction: { correctsFactId: "v1", reason: "typo" } });
  const next = applySavedFact(facts, saved);
  assert.equal(original.supersededBy, null);
  assert.equal(next.find((f) => f.id === "v1")?.supersededBy, "v2");
  assert.deepEqual(
    currentFacts(next).map((f) => f.id),
    ["v2"],
  );
  assert.equal(applySavedFact(next, saved).length, 2, "saving the same fact twice does not duplicate it");
});

test("external notes are listed newest received first, corrections kept as separate entries, input untouched", () => {
  const note = (id: string, minute: number, correctsNoteId: string | null = null): ExternalNote => ({
    id,
    patientId: "p1",
    grantId: "visit-1",
    sessionId: "s1",
    declaredName: "Dr Externe",
    organization: "Clinique fictive",
    verification: "external_unverified",
    text: `Note ${id}`,
    consultationDate: null,
    receivedAt: at(minute),
    correctsNoteId,
  });
  const notes = Object.freeze([note("first", 1), note("fix", 9, "first"), note("other", 5)]);
  assert.deepEqual(
    sortExternalNotes(notes).map((n) => n.id),
    ["fix", "other", "first"],
  );
  assert.deepEqual(
    notes.map((n) => n.id),
    ["first", "fix", "other"],
  );
});

test("referent status prefers grants: only an ACTIVE primary counts; plan state is the fallback", () => {
  assert.equal(referentStatus([grant("a", { relationship: "primary" })], null), "active");
  assert.equal(referentStatus([grant("a", { relationship: "primary", state: "pending", acceptedAt: null })], plan("active")), "none");
  assert.equal(referentStatus([grant("a")], null), "none");
  assert.equal(referentStatus(null, null), "none");
  assert.equal(referentStatus(null, plan("awaiting_clinician")), "none");
  assert.equal(referentStatus(null, plan("active")), "active");
  assert.equal(referentStatus(null, plan("suspended")), "unknown");
});

test("fact context revision: the live server record's revision is preferred, GET onboarding is the fallback", () => {
  const revision = { patientId: "p1", contextRevision: 12, evidenceRevision: 3, authorityRevision: 2 };
  const live = { patient: { id: "p1" }, revision };
  assert.deepEqual(contextRevisionSource(live, "server"), { kind: "record", contextRevision: 12 });
  assert.deepEqual(contextRevisionSource({ patient: { id: "p1" } }, "server"), { kind: "fetch" }, "absent revision");
  assert.deepEqual(contextRevisionSource(live, "device"), { kind: "fetch" }, "device copy is never live");
  assert.deepEqual(contextRevisionSource(null, null), { kind: "fetch" });
  assert.deepEqual(contextRevisionSource({ patient: { id: "p2" }, revision }, "server"), { kind: "fetch" }, "other patient's revision");
  assert.deepEqual(
    contextRevisionSource({ patient: { id: "p1" }, revision: { ...revision, contextRevision: Number.NaN } }, "server"),
    { kind: "fetch" },
    "unreadable revision",
  );
});

test("fact drafts: label and an explicit answer are required; a correction also needs a reason", () => {
  const draft: FactDraft = { kind: "symptom", label: "  ", value: "", polarity: null, reason: "" };
  assert.deepEqual(validateFactDraft(draft, "add"), { label: "required", polarity: "required" });
  assert.deepEqual(validateFactDraft({ ...draft, label: "Toux", polarity: "unknown" }, "add"), {});
  assert.deepEqual(validateFactDraft({ ...draft, label: "Toux", polarity: "unknown" }, "correct"), { reason: "required" });
});

test("fact inputs are trimmed, keep 'unknown', and a correction keeps the fact's kind/code and revision", () => {
  const draft: FactDraft = { kind: "symptom", label: " Toux ", value: "  ", polarity: "unknown", reason: " erreur " };
  assert.deepEqual(toFactInput(draft, 7, "cid-2"), {
    kind: "symptom",
    code: null,
    label: "Toux",
    value: null,
    polarity: "unknown",
    expectedContextRevision: 7,
    clientId: "cid-2",
  });
  const corrected = fact("v3", 3, { revision: 3, code: "hypertension", kind: "condition" });
  assert.deepEqual(toFactCorrection({ ...draft, kind: "allergy", value: " depuis 2020 " }, corrected, 7, "cid-3"), {
    kind: "condition",
    code: "hypertension",
    label: "Toux",
    value: "depuis 2020",
    polarity: "unknown",
    expectedContextRevision: 7,
    clientId: "cid-3",
    expectedRevision: 3,
    reason: "erreur",
  });
});

// ---------------------------------------------------------------------------
// Doctor invitations
// ---------------------------------------------------------------------------

test("a primary referent always receives every scope, whatever was ticked", () => {
  const validation = validateInvite({ doctorId: "d1", relationship: "primary", scopes: ["status"] }, []);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.scopes, ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"]);
  assert.deepEqual(toGrantIssue({ doctorId: "d1", relationship: "primary", scopes: [] }, "cid-4"), {
    targetClinicianId: "d1",
    relationship: "primary",
    scopes: ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"],
    clientId: "cid-4",
  });
});

test("secondary composite scopes list their missing dependencies and block submission", () => {
  const blocked = validateInvite({ doctorId: "d1", relationship: "specialist", scopes: ["summary"] }, []);
  assert.equal(blocked.valid, false);
  assert.equal(blocked.errors.scopes, "missing");
  assert.deepEqual(blocked.missing, ["status", "measurements", "clinical", "documents"]);

  const ok = validateInvite(
    { doctorId: "d1", relationship: "specialist", scopes: ["summary", "status", "measurements", "clinical", "documents"] },
    [],
  );
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.missing, []);

  const empty = validateInvite({ doctorId: "d1", relationship: "generalist", scopes: [] }, []);
  assert.equal(empty.errors.scopes, "empty");
});

test("a second primary is blocked while one is pending or active, allowed once it is revoked", () => {
  const draft = { doctorId: "d2", relationship: "primary" as const, scopes: [] };
  const pending = [grant("p", { relationship: "primary", state: "pending", acceptedAt: null })];
  assert.equal(hasOpenPrimary(pending), true);
  assert.equal(validateInvite(draft, pending).errors.relationship, "primaryExists");
  assert.equal(validateInvite(draft, [grant("p", { relationship: "primary" })]).valid, false);
  assert.equal(validateInvite(draft, [grant("p", { relationship: "primary", state: "revoked", revokedAt: at(9) })]).valid, true);
});

test("a doctor is required, and a doctor who already has a pending/active grant cannot be invited again", () => {
  assert.equal(validateInvite({ doctorId: "", relationship: "generalist", scopes: ["status"] }, []).errors.doctor, "required");
  const grants = [grant("x", { clinicianId: "d1" }), grant("y", { clinicianId: "d2", state: "revoked", revokedAt: at(3) })];
  assert.equal(validateInvite({ doctorId: "d1", relationship: "generalist", scopes: ["status"] }, grants).errors.doctor, "taken");
  assert.deepEqual(
    doctorChoices([doctor("d1"), doctor("d2")], grants).map((c) => [c.doctor.id, c.openState]),
    [
      ["d1", "active"],
      ["d2", null],
    ],
  );
});

test("scope edits: primaries and revoked grants are not editable; selections are validated like invitations", () => {
  assert.equal(canEditScopes(grant("a", { relationship: "primary" })), false);
  assert.equal(canEditScopes(grant("b", { state: "revoked", revokedAt: at(4) })), false);
  assert.equal(canEditScopes(grant("c", { state: "pending", acceptedAt: null })), true);
  assert.deepEqual(validateScopeSelection([]), { missing: [], error: "empty" });
  assert.deepEqual(validateScopeSelection(["alerts", "status"]), { missing: ["measurements", "clinical", "documents"], error: "missing" });
  assert.deepEqual(validateScopeSelection(["messages"]), { missing: [], error: null });
});

test("grants are upserted immutably and ordered active, pending, revoked (newest first)", () => {
  const list = Object.freeze([grant("old", { issuedAt: at(1) }), grant("rev", { state: "revoked", revokedAt: at(8) })]);
  const updated = upsertGrant(list, grant("old", { revision: 2, scopes: ["messages"] }));
  assert.equal(list[0].revision, 1);
  assert.equal(updated.find((g) => g.id === "old")?.revision, 2);
  const sorted = sortGrants([
    ...updated,
    grant("pend", { state: "pending", acceptedAt: null, issuedAt: at(9) }),
    grant("new", { issuedAt: at(7) }),
  ]);
  assert.deepEqual(
    sorted.map((g) => g.id),
    ["new", "old", "pend", "rev"],
  );
});

// ---------------------------------------------------------------------------
// One-time invitation token: only in the reveal state, cleared on hide
// ---------------------------------------------------------------------------

test("the invitation token lives only in the reveal state and disappears when hidden", () => {
  const secret = "tok_SECRET_123";
  const result: GrantIssueResult = { grant: grant("g1", { state: "pending", acceptedAt: null }), invitationToken: secret };
  const grants = upsertGrant([], result.grant);
  const shown = revealReducer(HIDDEN_REVEAL, { type: "issued", result });
  assert.deepEqual(shown, { kind: "token", grantId: "g1", token: secret });
  assert.ok(!JSON.stringify(grants).includes(secret), "grant list never carries the token");
  const hidden = revealReducer(shown, { type: "hide" });
  assert.deepEqual(hidden, { kind: "hidden" });
  assert.ok(!JSON.stringify(hidden).includes(secret));
  assert.deepEqual(shown, { kind: "token", grantId: "g1", token: secret }, "previous state untouched");
});

test("a replayed issuance (null or empty token) shows the replay notice, never an empty code", () => {
  assert.deepEqual(revealReducer(HIDDEN_REVEAL, { type: "issued", result: { grant: grant("g1"), invitationToken: null } }), {
    kind: "replay",
    grantId: "g1",
  });
  assert.deepEqual(revealReducer(HIDDEN_REVEAL, { type: "issued", result: { grant: grant("g1"), invitationToken: "" } }), {
    kind: "replay",
    grantId: "g1",
  });
});

test("an issuance answer discarded by the access fence replaces any shown code with the no-code guidance", () => {
  const shown = revealReducer(HIDDEN_REVEAL, { type: "issued", result: { grant: grant("g9"), invitationToken: "abc" } });
  const discarded = revealReducer(shown, { type: "discarded" });
  assert.deepEqual(discarded, { kind: "replay", grantId: null });
  assert.deepEqual(discarded, DISCARDED_REVEAL);
  assert.ok(!JSON.stringify(discarded).includes("abc"));
});

test("journal pages append in order without duplicates", () => {
  const entry = (id: string): AccessJournalEntry => ({
    id,
    patientId: "p1",
    actorId: "a",
    actorCategory: "clinician",
    actorDisplayName: "Dr A",
    action: "record.read",
    resourceType: "patient",
    resourceId: "p1",
    grantId: null,
    grantRevision: null,
    outcome: "allowed",
    at: at(1),
  });
  const first = Object.freeze([entry("1"), entry("2")]);
  const merged = mergeJournal(first, { entries: [entry("2"), entry("3")], nextCursor: null });
  assert.deepEqual(
    merged.map((e) => e.id),
    ["1", "2", "3"],
  );
  assert.equal(first.length, 2);
});

// ---------------------------------------------------------------------------
// Access fence: nothing returned across a revocation
// ---------------------------------------------------------------------------

test("fenced calls: current results pass, results or errors across a revocation are stale", async () => {
  const fence = createAccessFence("actor::p1");
  assert.deepEqual(await fencedCall(fence, async () => 1), { status: "current", value: 1 });

  const failure = new ApiError({ status: 503, code: "BUSY", kind: "http", message: "busy" });
  const failed = await fencedCall(fence, async () => {
    throw failure;
  });
  assert.equal(failed.status, "error");

  const revokedDuringWork = await fencedCall(fence, async () => {
    fence.revoke();
    return "late";
  });
  assert.deepEqual(revokedDuringWork, { status: "stale", answered: true }, "the server answered, the answer is withheld");

  const fresh = createAccessFence("actor::p1");
  const errorAfterRevoke = await fencedCall(fresh, async () => {
    fresh.revoke();
    throw failure;
  });
  assert.deepEqual(errorAfterRevoke, { status: "stale", answered: false });

  const aborted = await fencedCall(createAccessFence("k"), async () => {
    throw new ApiError({ status: 0, code: "REQUEST_ABORTED", kind: "aborted", message: "aborted" });
  });
  assert.deepEqual(aborted, { status: "stale", answered: false });
});

test("fenced calls drop a response older than the highest authority revision", async () => {
  const fence = createAccessFence("actor::p1");
  fence.admitRevision(5);
  const older = await fencedCall(fence, async () => ({ authority: 4 }), (value) => value.authority);
  assert.deepEqual(older, { status: "stale", answered: true });
});

// ---------------------------------------------------------------------------
// Actor switch: a save or upload held for actor A never lands in actor B's view
// ---------------------------------------------------------------------------

type View = { owner: string; medicalFacts: MedicalFact[]; documents: string[] };

/** Mirrors usePatientRecord: one visible record, fences retired on switch, mutate bound to its fence. */
function patientRuntime(owner: string) {
  let visible: View = { owner, medicalFacts: [], documents: [] };
  let current = createAccessFence(`${owner}::p-${owner}`);
  const refreshed: string[] = [];
  const scopeFor = (fence: ReturnType<typeof createAccessFence>, who: string) => ({
    fence,
    mutate: bindToFence(fence, () => current, (updater: (view: View) => View) => {
      visible = updater(visible);
    }),
    refresh: async () => {
      refreshed.push(who);
    },
  });
  let data = scopeFor(current, owner);
  return {
    data: () => data,
    visible: () => visible,
    refreshed,
    switchTo(next: string) {
      current.retire();
      current = createAccessFence(`${next}::p-${next}`);
      visible = { owner: next, medicalFacts: [], documents: [] };
      data = scopeFor(current, next);
    },
  };
}

const addFact = (saved: MedicalFact) => (view: View): View => ({ ...view, medicalFacts: applySavedFact(view.medicalFacts, saved) });

test("a fact save held for actor A that resolves after a switch to actor B applies nothing to B", async () => {
  const runtime = patientRuntime("A");
  const action = captureAction(runtime.data()); // captured once, at submit start
  const result = await runAction(
    action,
    async () => {
      runtime.switchTo("B"); // account switch while the request is in flight
      return { fact: fact("a-secret", 1) };
    },
    (value) => addFact(value.fact),
  );
  assert.deepEqual(result, { status: "stale", answered: true });
  assert.equal(runtime.visible().owner, "B");
  assert.deepEqual(runtime.visible().medicalFacts, [], "A's fact never reaches B's record");
  assert.deepEqual(runtime.refreshed, [], "no refresh is triggered for the departed actor");

  action.mutate(addFact(fact("late", 2)));
  assert.deepEqual(runtime.visible().medicalFacts, [], "even a direct late call to A's mutate is a no-op");
});

test("a document upload held for actor A is discarded after a switch; the same upload without a switch applies", async () => {
  const runtime = patientRuntime("A");
  const held = await runAction(
    captureAction(runtime.data()),
    async () => {
      runtime.switchTo("B");
      return { document: "a-report.pdf" };
    },
    (value) => (view: View) => ({ ...view, documents: [...view.documents, value.document] }),
  );
  assert.equal(held.status, "stale");
  assert.deepEqual(runtime.visible().documents, []);

  const applied = await runAction(
    captureAction(runtime.data()),
    async () => ({ document: "b-report.pdf" }),
    (value) => (view: View) => ({ ...view, documents: [...view.documents, value.document] }),
  );
  assert.equal(applied.status, "current");
  assert.deepEqual(runtime.visible().documents, ["b-report.pdf"]);
  assert.deepEqual(runtime.refreshed, ["B"]);
});

// ---------------------------------------------------------------------------
// Privacy: no browser storage or console output in these screens
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("record and access screens never touch browser storage or the console (tokens stay in memory)", () => {
  const root = join(process.cwd(), "src", "components", "patient");
  const files = [...sourceFiles(join(root, "access")), ...sourceFiles(join(root, "record"))];
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|console\./, file);
  }
});
