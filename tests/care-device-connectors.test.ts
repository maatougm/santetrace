import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ConnectorEvent } from "../src/contracts/monitoring";
import { ConnectorService } from "../src/lib/connector-service";
import { CareService } from "../src/lib/care-service";
import { createCareHandler } from "../src/lib/monitoring-http";
import { PublicCredentialThrottle } from "../src/lib/care-http";
import { signSession, SESSION_COOKIE } from "../src/lib/care-session";
import { decodeGlucoseMeasurement } from "../src/lib/iot/glucose-decoder";
import { fixtureStore, testOwner, testDoctor } from "./helpers/care-fixture";

const now = Date.parse("2026-10-11T08:00:00Z");
const options = { meterIdentity: "SOFTWARE-TEST-METER", epoch: "first", clockVerified: true as const,
  utcOffsetMinutes: 60, inheritedTimeOffsetMinutes: 0 };
const decode = (hex = "02 01 00 ea 07 0a 0b 08 1e 00 78 b0 11") =>
  decodeGlucoseMeasurement(Uint8Array.from(Buffer.from(hex.replaceAll(" ", ""), "hex")), options).event;
function setup() {
  const store = fixtureStore(), service = new ConnectorService(store, () => now);
  const input = { deviceId: options.meterIdentity, kind: "device" as const, clientId: "real-device-test-pair" };
  const paired = service.pair(testOwner, "fatma", input);
  assert.ok(paired.credential);
  return { store, service, input, paired, credential: paired.credential };
}

test("physical connector pairing releases a bearer credential once and keeps its hash private", () => {
  const s = setup();
  try {
    assert.equal(s.paired.connector.kind, "device");
    assert.match(s.credential, /^[A-Za-z0-9_-]{43}$/);
    assert.equal("credentialHash" in s.paired.connector, false);
    assert.equal("credentialHash" in s.service.list(testOwner, "fatma").connectors[0], false);
    assert.equal(JSON.stringify(s.store.read()).includes(s.credential), false);
    assert.equal(s.service.pair(testOwner, "fatma", s.input).credential, null);
    assert.equal(s.store.read().connectors.length, 1);
    assert.throws(() => s.service.pair(testOwner, "fatma", { ...s.input, deviceId: "CHANGED" }), { code: "IDEMPOTENCY_CONFLICT" });
  } finally { s.store.close(); }
});

test("decoded device ingress derives owner and provenance from the binding, preserving time and units", () => {
  const s = setup();
  try {
    const event = decode(), receipt = s.service.ingest(s.credential, event);
    assert.equal(receipt.measurement.patientId, "fatma");
    assert.equal(receipt.measurement.source, "device");
    assert.equal(receipt.measurement.measuredAt, "2026-10-11T07:30:00.000Z");
    assert.equal(receipt.measurement.receivedAt, "2026-10-11T08:00:00.000Z");
    assert.equal(receipt.measurement.value, 120);
    assert.equal(receipt.measurement.unit, "mg/dL");
    assert.deepEqual(receipt.measurement.connector, { connectorId: s.paired.connector.id, deviceId: options.meterIdentity,
      externalEventId: event.externalEventId, simulated: false, quality: "accepted" });
    assert.equal(receipt.alert, null);
    assert.equal(s.store.read().patientRevisions.find(r => r.patientId === "fatma")!.evidenceRevision, 1);
    const molar = s.service.ingest(s.credential, decode("06 02 00 ea 07 0a 0b 08 1e 00 37 c0 11"));
    assert.equal(molar.measurement.value, 5.5);
    assert.equal(molar.measurement.unit, "mmol/L");
  } finally { s.store.close(); }
});

test("decoded high sensor-warning and context-required readings stay unknown without urgent alert", () => {
  const s = setup();
  try {
    const warning = s.service.ingest(s.credential, decode("0a 01 00 ea 07 0a 0b 08 1e 00 2c b1 11 01 00"));
    assert.equal(warning.measurement.value, 300);
    assert.equal(warning.measurement.status, "unknown");
    assert.equal(warning.measurement.connector!.quality, "suspect");
    assert.equal(warning.alert, null);
    const context = s.service.ingest(s.credential, decode("12 02 00 ea 07 0a 0b 08 1e 00 2c b1 11"));
    assert.equal(context.measurement.status, "unknown");
    assert.equal(context.alert, null);
    assert.equal(s.store.read().alerts.length, 0);
  } finally { s.store.close(); }
});

test("retry has one durable reading and a changed timestamp or value under the same id conflicts", () => {
  const s = setup();
  try {
    const event = decode(), first = s.service.ingest(s.credential, event);
    assert.deepEqual(s.service.ingest(s.credential, decode()), first);
    assert.equal(s.store.read().measurements.length, 1);
    for (const changed of [{ ...event, measuredAt: "2026-10-11T07:29:00.000Z" },
      { ...event, reading: { ...event.reading, value: 121 } }])
      assert.throws(() => s.service.ingest(s.credential, changed), { code: "IDEMPOTENCY_CONFLICT" });
    assert.equal(s.store.read().measurements.length, 1);
  } finally { s.store.close(); }
});

test("wrong credentials and body ownership spoofing cannot write a device reading", () => {
  const s = setup();
  try {
    assert.throws(() => s.service.ingest("A".repeat(43), decode()), { code: "CONNECTOR_UNAVAILABLE" });
    assert.throws(() => s.service.ingest("Bearer " + s.credential, decode()), { code: "CONNECTOR_UNAVAILABLE" });
    for (const extra of [{ patientId: "ahmed" }, { source: "app" }, { simulated: true }, { connectorId: "other" }])
      assert.throws(() => s.service.ingest(s.credential, { ...decode(), ...extra } as ConnectorEvent), { code: "INVALID_INPUT" });
    assert.equal(s.store.read().measurements.length, 0);
  } finally { s.store.close(); }
});

test("current revocation, account enablement and consent are checked before a duplicate receipt", () => {
  for (const action of ["revoke", "disable_account", "withdraw_consent"] as const) {
    const s = setup();
    try {
      s.service.ingest(s.credential, decode());
      if (action === "revoke") s.service.revoke(testOwner, s.paired.connector.id, { action: "revoke", expectedRevision: 1, clientId: "revoke" });
      if (action === "disable_account") s.store.transaction(state => { state.accounts.find(a => a.id === testOwner.id)!.enabled = false; });
      if (action === "withdraw_consent") new CareService(s.store).consent(testOwner, "fatma", { consent: false });
      assert.throws(() => s.service.ingest(s.credential, decode()), { code: "CONNECTOR_UNAVAILABLE" });
      assert.equal(s.store.read().measurements.length, 1);
    } finally { s.store.close(); }
  }
});

test("doctor cannot pair a patient's device and physical binding cannot use simulator ingress", () => {
  const s = setup();
  try {
    assert.throws(() => s.service.pair(testDoctor, "fatma", { ...s.input, clientId: "doctor-pair" }), { code: "FORBIDDEN" });
    assert.throws(() => s.service.pair(testOwner, "ahmed", { ...s.input, clientId: "other-patient" }), { code: "NOT_FOUND" });
    assert.throws(() => s.service.simulate(testOwner, "fatma", s.paired.connector.id, decode()), { code: "CONNECTOR_UNAVAILABLE" });
    assert.equal(s.store.read().measurements.length, 0);
  } finally { s.store.close(); }
});

test("malformed, out-of-range and wrong-unit device payloads cause no capture or evidence revision", () => {
  const s = setup();
  try {
    const event = decode();
    for (const body of [
      { ...event, reading: { ...event.reading, unit: "g/L" } },
      { ...event, reading: { ...event.reading, value: 700 } },
      { ...event, reading: { ...event.reading, value: NaN } },
      { ...event, reading: { ...event.reading, unexpected: 1 } },
      { ...event, measuredAt: "unknown" }, { ...event, measuredAt: "2026-10-11T09:00:00.000Z" },
      { ...event, quality: "confirmed" }, { ...event, externalEventId: "" },
    ]) assert.throws(() => s.service.ingest(s.credential, body as ConnectorEvent));
    assert.equal(s.store.read().measurements.length, 0);
    assert.equal(s.store.read().patientRevisions.find(r => r.patientId === "fatma")!.evidenceRevision, 0);
  } finally { s.store.close(); }
});

test("existing HTTP bearer ingress accepts a decoded device event without user cookie or browser Origin", async () => {
  const s = setup();
  try {
    const handle = createCareHandler(s.store, {
      connector: new PublicCredentialThrottle(Date.now, 60), redeem: new PublicCredentialThrottle(),
    });
    const event = decode("02 01 00 ea 07 0a 0a 08 1e 00 78 b0 11");
    const request = (authorization?: string, body: unknown = event) => new Request("https://test.invalid/api/connectors/events", {
      method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    });
    const accepted = await handle(request(`Bearer ${s.credential}`));
    assert.equal(accepted.status, 201);
    assert.equal(accepted.headers.get("Cache-Control"), "no-store");
    const receipt = await accepted.json();
    assert.equal(receipt.measurement.source, "device");
    assert.equal(receipt.measurement.connector.simulated, false);
    assert.equal(receipt.measurement.connector.externalEventId, event.externalEventId);
    assert.equal(receipt.measurement.measuredAt, "2026-10-10T07:30:00.000Z");
    assert.equal(JSON.stringify(receipt).includes(s.credential), false);
    assert.equal(JSON.stringify(receipt).includes("credentialHash"), false);
    assert.equal((await handle(request(`Bearer ${s.credential}`))).status, 201);
    for (const authorization of [undefined, `bearer ${s.credential}`, "Bearer " + "A".repeat(43)])
      assert.equal((await handle(request(authorization))).status, 404);
    assert.equal((await handle(request(`Bearer ${s.credential}`, { ...event, patientId: "ahmed" }))).status, 400);
    assert.equal(s.store.read().measurements.length, 1);
  } finally { s.store.close(); }
});

test("software ingestion rehearsal succeeds in its own disposable store without physical-device claim", () => {
  const script = fileURLToPath(new URL("../scripts/rehearse-device-ingress.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, "isolated_software_test");
  assert.equal(report.physicalDeviceVerified, false);
  assert.equal(report.networkRequests, 0);
  assert.equal(report.uniqueMeasurements, 1);
  assert.equal(report.replayDeduplicated, true);
  assert.equal(report.wrongTokenRejected, true);
  assert.equal(report.revokedTokenRejected, true);
  assert.equal(report.timestampPreserved, true);
  assert.equal(report.credentialsExposed, false);
});
