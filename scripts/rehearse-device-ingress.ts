import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Actor } from "../src/contracts/care";
import { CareStore } from "../src/lib/care-store";
import { createCareHandler } from "../src/lib/monitoring-http";
import { PublicCredentialThrottle } from "../src/lib/care-http";
import { signSession, SESSION_COOKIE } from "../src/lib/care-session";
import { decodeGlucoseMeasurement } from "../src/lib/iot/glucose-decoder";

/**
 * Run: node --import tsx scripts/rehearse-device-ingress.ts
 * This is a software-only golden-vector test. It never connects to a meter, opens a
 * network socket, reads .env, or touches the application database. "device" source
 * below tests the real-device binding path only inside a disposable in-memory store.
 */
async function main() {
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  process.env.APP_ORIGIN = "https://isolated-iot-test.invalid";
  for (const key of ["DEMO_CLINICIAN_PASSWORD", "DEMO_GENERALIST_PASSWORD", "DEMO_SPECIALIST_PASSWORD"])
    delete process.env[key];
  const store = new CareStore(":memory:");
  try {
    const actor: Actor = { id: "isolated-device-test-owner", role: "patient", patientId: "fatma", displayName: "Software test only" };
    store.transaction(state => {
      state.accounts.push({ ...actor, login: "isolated.device.test", passwordHash: "test-only", enabled: true,
        sessionVersion: 1, createdAt: new Date().toISOString() });
    });
    const handle = createCareHandler(store, {
      connector: new PublicCredentialThrottle(Date.now, 60), redeem: new PublicCredentialThrottle(),
    });
    const cookie = `${SESSION_COOKIE}=${signSession(actor, Date.now(), store)}`;
    const request = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
      handle(new Request(`${process.env.APP_ORIGIN}/api/${path}`, {
        method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
      }));
    const meterIdentity = "SOFTWARE-GOLDEN-VECTOR-METER";
    const pairInput = { deviceId: meterIdentity, kind: "device", clientId: "software-only-pair" };
    const patientHeaders = { cookie, origin: process.env.APP_ORIGIN! };
    const pairing = await request("patients/fatma/connectors", "POST", pairInput, patientHeaders);
    assert.equal(pairing.status, 201);
    const pair = await pairing.json();
    assert.equal(pair.connector.kind, "device");
    assert.equal("credentialHash" in pair.connector, false);
    assert.match(pair.credential, /^[A-Za-z0-9_-]{43}$/);
    const repeatPair = await request("patients/fatma/connectors", "POST", pairInput, patientHeaders);
    assert.equal(repeatPair.status, 201);
    assert.equal((await repeatPair.json()).credential, null);

    // Historical hand-written vector: this is not a newly captured physical reading.
    const packet = Uint8Array.from(Buffer.from("030100e9070102081e00000078b011", "hex"));
    const decoded = decodeGlucoseMeasurement(packet, {
      meterIdentity, epoch: "test", clockVerified: true, utcOffsetMinutes: 60,
    });
    assert.equal(decoded.event.measuredAt, "2025-01-02T07:30:00.000Z");
    const bearer = { authorization: `Bearer ${pair.credential}` };
    const capture = await request("connectors/events", "POST", decoded.event, bearer);
    assert.equal(capture.status, 201);
    assert.equal(capture.headers.get("Cache-Control"), "no-store");
    const first = await capture.json();
    assert.equal(first.measurement.source, "device");
    assert.equal(first.measurement.connector.deviceId, meterIdentity);
    assert.equal(first.measurement.connector.simulated, false);
    assert.equal(first.measurement.value, 120);
    assert.equal(first.measurement.unit, "mg/dL");
    assert.equal(first.measurement.measuredAt, decoded.event.measuredAt);
    const replay = await request("connectors/events", "POST", decoded.event, bearer);
    assert.equal(replay.status, 201);
    assert.deepEqual(await replay.json(), first);
    const wrongToken = await request("connectors/events", "POST", decoded.event, { authorization: "Bearer " + "A".repeat(43) });
    assert.equal(wrongToken.status, 404);
    const revoke = await request(`connectors/${pair.connector.id}`, "PATCH", {
      action: "revoke", expectedRevision: pair.connector.revision, clientId: "software-only-revoke",
    }, patientHeaders);
    assert.equal(revoke.status, 200);
    const revokedReplay = await request("connectors/events", "POST", decoded.event, bearer);
    assert.equal(revokedReplay.status, 404);
    assert.equal(store.read().measurements.length, 1);
    assert.equal(JSON.stringify(store.read()).includes(pair.credential), false);
    assert.equal(JSON.stringify(first).includes(pair.credential), false);
    assert.equal(JSON.stringify(first).includes("credentialHash"), false);
    process.stdout.write(JSON.stringify({
      mode: "isolated_software_test", physicalDeviceVerified: false,
      transport: "existing_request_handler_in_process", networkRequests: 0, database: "disposable_memory",
      decoder: "SIG_0x2A18_reference", oneTimePairCredential: true,
      uniqueMeasurements: store.read().measurements.length, replayDeduplicated: true,
      wrongTokenRejected: true, revokedTokenRejected: true, timestampPreserved: true,
      credentialsExposed: false,
    }, null, 2) + "\n");
  } finally { store.close(); }
}

void main().catch(() => {
  // A fixed failure message cannot accidentally print a bearer credential in an assertion.
  process.stderr.write("Isolated IoT software rehearsal failed. No live application data was used.\n");
  process.exitCode = 1;
});
