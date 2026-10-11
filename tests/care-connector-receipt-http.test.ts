import test from "node:test";
import assert from "node:assert/strict";
import type { ConnectorEvent } from "../src/contracts/monitoring";
import { ConnectorService } from "../src/lib/connector-service";
import { CareService } from "../src/lib/care-service";
import { MonitoringAiService } from "../src/lib/monitoring-ai-service";
import { createDemoMonitoringProfiles } from "../src/lib/monitoring-evaluation";
import { createCareHandler } from "../src/lib/monitoring-http";
import { PublicCredentialThrottle } from "../src/lib/care-http";
import { SESSION_COOKIE, signSession } from "../src/lib/care-session";
import { fixtureStore, testDoctor, testOwner } from "./helpers/care-fixture";

function setup(kind: "device" | "simulator" = "device") {
  const store = fixtureStore();
  const measuredAt = new Date().toISOString();
  const fact = new MonitoringAiService(store).recordFact(testOwner, "fatma", {
    kind: "condition", code: "hypertension", label: "Synthetic BP condition", value: null,
    polarity: "affirmed", expectedContextRevision: 0, clientId: "receipt-privacy-bp-fact",
  });
  store.transaction(state => {
    const profile = createDemoMonitoringProfiles(state.patients[0].rules).find(profile => profile.rulePack === "demo_blood_pressure")!;
    state.monitoringProfiles.push(profile);
    state.carePlans.push({ id: "receipt-privacy-bp-plan", patientId: "fatma", revision: 1, state: "active", clinicianId: testDoctor.id,
      profileBindings: [{ conditionFactId: fact.id, profileId: profile.id, profileVersion: profile.version }], actionIds: [], reviewDeadline: null });
  });
  new CareService(store).measurement(testOwner, "fatma", { kind: "blood_pressure", systolic: 171, diastolic: 97,
    unit: "mmHg", measuredAt, clientId: "receipt-private-unrelated-bp" });
  const service = new ConnectorService(store);
  const pair = service.pair(testOwner, "fatma", { kind, deviceId: `receipt-privacy-${kind}`, clientId: `receipt-pair-${kind}` });
  const handle = createCareHandler(store, { connector: new PublicCredentialThrottle(Date.now, 60), redeem: new PublicCredentialThrottle() });
  const event: ConnectorEvent = { externalEventId: "receipt-glucose-event", measuredAt,
    reading: { kind: "glucose", value: 120, unit: "mg/dL" }, quality: "accepted" };
  const post = (body: ConnectorEvent = event) => handle(new Request("https://test.invalid/api/connectors/events", {
    method: "POST", headers: { "Content-Type": "application/json", authorization: `Bearer ${pair.credential}` }, body: JSON.stringify(body),
  }));
  return { store, measuredAt, service, pair, handle, event, post };
}

test("device bearer first and replay receipts expose only the submitted measurement, excluding unrelated dossier data", async () => {
  const f = setup();
  try {
    const first = await f.post();
    assert.equal(first.status, 201);
    assert.equal(first.headers.get("Cache-Control"), "no-store");
    const body = await first.json();
    const internal = f.service.ingest(f.pair.credential!, f.event);
    assert.ok(internal.monitoring.reasons.some(reason => reason.includes("171")), "fixture must contain unrelated BP reasoning");
    assert.deepEqual(Object.keys(body), ["measurement"]);
    assert.deepEqual(body.measurement, internal.measurement);
    assert.equal(body.measurement.kind, "glucose");
    assert.equal(body.measurement.value, 120);
    for (const key of ["monitoring", "alert", "scopes", "carePlan", "facts", "rulesSnapshot", "credential", "credentialHash"])
      assert.equal(Object.hasOwn(body, key), false);
    assert.equal(JSON.stringify(body).includes("systolic"), false);
    assert.equal(JSON.stringify(body).includes("rulesSnapshot"), false);
    assert.equal(JSON.stringify(body).includes(f.pair.credential!), false);
    const replay = await f.post();
    assert.equal(replay.status, 201);
    assert.deepEqual(await replay.json(), body);
    assert.equal(f.store.read().measurements.length, 2);
    assert.equal(f.store.read().measurements.filter(measurement => measurement.clientId === f.event.externalEventId).length, 1);
    assert.equal((await f.post({ ...f.event, reading: { kind: "glucose", value: 121, unit: "mg/dL" } })).status, 409);
    f.service.revoke(testOwner, f.pair.connector.id, { action: "revoke", expectedRevision: 1, clientId: "receipt-revoke" });
    const denied = await f.post();
    assert.equal(denied.status, 404);
    assert.deepEqual(Object.keys(await denied.json()), ["error"]);
    assert.equal(f.store.read().measurements.length, 2);
  } finally { f.store.close(); }
});

test("an alert-producing bearer event retains internal alerts but never returns their all-condition rule snapshot", async () => {
  const f = setup();
  try {
    const event: ConnectorEvent = { ...f.event, reading: { kind: "glucose", value: 300, unit: "mg/dL" } };
    const first = await f.post(event);
    assert.equal(first.status, 201);
    const body = await first.json();
    const internal = f.service.ingest(f.pair.credential!, event);
    assert.ok(internal.alert);
    assert.equal(internal.alert.rulesSnapshot.systolicHigh, 160);
    assert.equal(internal.alert.rulesSnapshot.glucoseHigh, 250);
    assert.deepEqual(body, { measurement: internal.measurement });
    assert.equal(body.measurement.status, "red");
    const replay = await f.post(event);
    assert.equal(replay.status, 201);
    assert.deepEqual(await replay.json(), body);
    assert.equal(f.store.read().alerts.length, 2);
    assert.equal(f.store.read().measurements.length, 2);
  } finally { f.store.close(); }
});

test("authenticated owner simulator HTTP retains its full receipt and current replay", async () => {
  const f = setup("simulator");
  try {
    const cookie = `${SESSION_COOKIE}=${signSession(testOwner, Date.now(), f.store)}`;
    const request = () => new Request(`https://test.invalid/api/patients/fatma/connectors/${f.pair.connector.id}/simulate`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie, origin: "https://test.invalid" }, body: JSON.stringify(f.event),
    });
    const first = await f.handle(request());
    assert.equal(first.status, 201);
    const body = await first.json();
    assert.deepEqual(Object.keys(body).sort(), ["alert", "measurement", "monitoring"]);
    assert.equal(body.measurement.source, "simulated");
    assert.ok(Array.isArray(body.monitoring.reasons));
    assert.deepEqual(body, f.service.simulate(testOwner, "fatma", f.pair.connector.id, f.event));
    const replay = await f.handle(request());
    assert.equal(replay.status, 201);
    assert.deepEqual(await replay.json(), body);
    assert.equal(f.store.read().measurements.length, 2);
  } finally { f.store.close(); }
});
