import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Polarity } from "../src/contracts/monitoring";
import { SHARING_SCOPES } from "../src/contracts/patient-platform";
import { CareStore } from "../src/lib/care-store";
import { CareError, CareService } from "../src/lib/care-service";
import { MonitoringAiService } from "../src/lib/monitoring-ai-service";
import { buildAuthorizedEvidence } from "../src/lib/medical-evidence";
import { PatientAccessService, projectPatientRecord } from "../src/lib/patient-access-service";
import { currentFacts, previousVersions } from "../src/components/patient/record/record-model";
import { savedFactsSummary } from "../src/components/patient/record/onboarding-model";
import { activeConditions, conditionCards } from "../src/components/patient/monitoring/monitoring-view";
import { fromOfflineRecord, toOfflineRecord } from "../src/lib/client/offline-record";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";

const now = "2026-10-11T12:00:00.000Z";
const hasCode = (code: string) => (error: unknown) => error instanceof CareError && error.code === code;

function correctedDeclaration(store: CareStore, polarity: Polarity = "unknown") {
  const service = new MonitoringAiService(store, undefined, () => now);
  const input = { kind: "condition" as const, code: "hypertension", label: "Synthetic correction-history declaration", value: null, polarity, expectedContextRevision: 0, clientId: "fact-history-original" };
  const original = service.recordFact(testOwner, "fatma", input);
  const corrected = service.correctFact(testOwner, original.id, { ...input, polarity: "negated", expectedContextRevision: 1, expectedRevision: 1, reason: "Synthetic correction: unknown to no", clientId: "fact-history-correction" });
  return { original, corrected };
}

test("the owner can reconstruct a corrected declaration's history after the repository is reopened", async () => {
  const folder = await mkdtemp(join(tmpdir(), "full-qa-fact-history-"));
  const path = join(folder, "care.sqlite");
  let store = fixtureStore(path);
  try {
    const { original, corrected } = correctedDeclaration(store);
    store.transaction(state => {
      state.medicalFacts.push({ ...original, id: "other-patient-original", patientId: "ahmed", supersededBy: "other-patient-correction" });
      state.medicalFacts.push({ ...corrected, id: "other-patient-correction", patientId: "ahmed", correction: { correctsFactId: "other-patient-original", reason: "Other patient's private correction" } });
    });
    store.close();
    store = new CareStore(path);
    const persisted = store.read();
    assert.equal(persisted.medicalFacts.find(fact => fact.id === original.id)?.supersededBy, corrected.id);
    assert.equal(persisted.medicalFacts.find(fact => fact.id === corrected.id)?.correction?.correctsFactId, original.id);
    assert.deepEqual(previousVersions(persisted.medicalFacts, corrected).map(fact => fact.id), [original.id], "storage and the history traversal retain the original version");

    const record = new CareService(store).patient(testOwner, "fatma");
    assert.deepEqual(currentFacts(record.medicalFacts).map(fact => [fact.id, fact.polarity, fact.revision]), [[corrected.id, "negated", 2]]);
    assert.deepEqual(previousVersions(record.medicalFacts, corrected).map(fact => [fact.id, fact.polarity, fact.revision]), [[original.id, "unknown", 1]], "the live owner projection must retain the correction chain after reload");
    assert.equal(record.medicalFacts.find(fact => fact.id === corrected.id)?.correction?.reason, "Synthetic correction: unknown to no");
    assert.ok(record.medicalFacts.every(fact => fact.patientId === "fatma"));
    assert.equal(JSON.stringify(record.medicalFacts).includes("Other patient's private correction"), false);
  } finally { store.close(); await rm(folder, { recursive: true, force: true }); }
});

test("fact history remains owner-only while current clinical projections and authority fences are retained", () => {
  const store = fixtureStore();
  try {
    const { original, corrected } = correctedDeclaration(store);
    const secondary = { ...testDoctor, id: "secondary" };
    store.transaction(state => state.careGrants.push({ ...state.careGrants[0], id: "fact-history-secondary", clinicianId: secondary.id, relationship: "specialist", scopes: [...SHARING_SCOPES] }));
    for (const actor of [testDoctor, secondary]) {
      assert.deepEqual(projectPatientRecord(store.read(), actor, "fatma").medicalFacts.map(fact => fact.id), [corrected.id]);
    }
    const access = new PatientAccessService(store);
    access.update(testOwner, "fact-history-secondary", { action: "update", scopes: ["status"], expectedRevision: 1, clientId: "fact-history-narrow" });
    assert.deepEqual(projectPatientRecord(store.read(), secondary, "fatma").medicalFacts, []);
    access.update(testOwner, "grant:fatma", { action: "revoke", expectedRevision: 1, clientId: "fact-history-revoke" });
    assert.throws(() => projectPatientRecord(store.read(), testDoctor, "fatma"), hasCode("NOT_FOUND"));
    assert.deepEqual(previousVersions(projectPatientRecord(store.read(), testOwner, "fatma").medicalFacts, corrected).map(fact => fact.id), [original.id]);
    new CareService(store).consent(testOwner, "fatma", { consent: false });
    assert.throws(() => projectPatientRecord(store.read(), secondary, "fatma"), hasCode("CONSENT_REVOKED"));
    assert.deepEqual(previousVersions(projectPatientRecord(store.read(), testOwner, "fatma").medicalFacts, corrected).map(fact => fact.id), [original.id], "the enabled owner retains their history after withdrawal");
    store.transaction(state => { state.accounts.find(account => account.id === testOwner.id)!.enabled = false; });
    assert.throws(() => projectPatientRecord(store.read(), testOwner, "fatma"), hasCode("NOT_FOUND"));
  } finally { store.close(); }
});

test("an owner's historical affirmed condition never returns to active evidence, monitoring or saved summaries", () => {
  const store = fixtureStore();
  try {
    const { original, corrected } = correctedDeclaration(store, "affirmed");
    const record = new CareService(store).patient(testOwner, "fatma");
    const evidence = buildAuthorizedEvidence(store.read(), testOwner, "fatma");
    assert.deepEqual(evidence.facts.map(fact => [fact.id, fact.polarity]), [[corrected.id, "negated"]]);
    assert.equal(evidence.sources.some(source => source.id === original.id), false);
    assert.deepEqual(record.evaluations, []);
    assert.deepEqual(activeConditions(record.medicalFacts), []);
    assert.deepEqual(conditionCards(record.medicalFacts, record.evaluations), []);
    assert.deepEqual(savedFactsSummary(record.medicalFacts, "fr").map(fact => [fact.id, fact.polarity, fact.revision]), [[corrected.id, "negated", 2]]);
  } finally { store.close(); }
});

test("owner correction history is removed by the offline record allowlist", () => {
  const store = fixtureStore();
  try {
    const { original, corrected } = correctedDeclaration(store);
    const record = projectPatientRecord(store.read(), testOwner, "fatma");
    const copy = toOfflineRecord(record);
    assert.ok(copy);
    const serialized = JSON.stringify(copy);
    for (const privateValue of [original.id, corrected.id, "Synthetic correction-history declaration", "Synthetic correction: unknown to no"]) {
      assert.equal(serialized.includes(privateValue), false);
    }
    assert.equal("medicalFacts" in copy, false);
    assert.deepEqual(fromOfflineRecord(copy).medicalFacts, []);
  } finally { store.close(); }
});
