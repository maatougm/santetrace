import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureStore, testDoctor } from "./helpers/care-fixture";
import { currentGuard } from "../src/lib/patient-access-service";
import { createDemoMonitoringProfiles } from "../src/lib/monitoring-evaluation";
import { buildAuthorizedEvidence } from "../src/lib/medical-evidence";

test("standalone worker reconciles removed clinician configuration before any delivery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "care-worker-startup-"));
  const database = join(directory, "care.sqlite");
  const store = fixtureStore(database);
  try {
    const at = new Date().toISOString();
    store.transaction(state => {
      state.monitoringProfiles = createDemoMonitoringProfiles(state.patients[0].rules);
      state.medicalFacts.push({ id: "hypertension", patientId: "fatma", kind: "condition", code: "hypertension", label: "Hypertension", value: null, polarity: "affirmed", verification: "patient_reported", sources: [], revision: 1, createdAt: at, supersededBy: null });
      const profile = state.monitoringProfiles.find(profile => profile.conditionCodes.includes("hypertension"))!;
      const action = { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} };
      state.carePlans.push({ id: "plan", patientId: "fatma", revision: 1, state: "active", clinicianId: testDoctor.id, profileBindings: [{ conditionFactId: "hypertension", profileId: profile.id, profileVersion: profile.version }], actionIds: ["action"], reviewDeadline: null });
      state.careProposals.push({ id: "proposal", patientId: "fatma", revision: 2, kind: "home_measurement", state: "approved", action, sources: buildAuthorizedEvidence(state, testDoctor, "fatma").sources.filter(source => source.id === "hypertension" || source.kind === "reference"), guard: currentGuard(state, "fatma"), decision: { clinicianId: testDoctor.id, at, reason: "Synthetic startup regression" }, history: [] });
      state.careActions.push({ id: "action", patientId: "fatma", planId: "plan", revision: 1, proposalId: "proposal", protocolId: null, originVersion: 2, action, dueAt: at, state: "pending", reportedAt: null, clientId: "startup-action", createdAt: at });
    });
    const environment: NodeJS.ProcessEnv = { ...process.env, HACKCURE_CARE_DATABASE_PATH: database, HACKCURE_WORKER_ID: "startup-regression" };
    delete environment.DEMO_CLINICIAN_PASSWORD;
    delete environment.DEMO_GENERALIST_PASSWORD;
    delete environment.DEMO_SPECIALIST_PASSWORD;
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/monitoring-worker.ts"], { cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", part => { stdout += String(part); if (stdout.includes('"kind":"monitoring_tick"')) child.kill("SIGTERM"); });
    child.stderr.on("data", part => { stderr += String(part); });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      assert.equal(code, 0, "Worker stops gracefully after its actual first tick");
      assert.match(stdout, /"kind":"monitoring_tick"/);
      assert.equal(stderr, "");
    } finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
    const state = store.read();
    assert.equal(state.accounts.find(account => account.id === testDoctor.id)?.enabled, false);
    assert.equal(state.carePlans[0].state, "awaiting_clinician");
    assert.equal(state.carePlans[0].clinicianId, null);
    assert.equal(currentGuard(state, "fatma").authorityRevision, 1);
    assert.equal(state.reminders.length, 0);
    assert.equal(state.messages.filter(message => message.kind === "approved_action").length, 0);
    assert.doesNotMatch(stdout, /Fatma|password|credential/i);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
