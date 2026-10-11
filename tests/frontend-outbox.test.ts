import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  createMeasurementEntry,
  enqueue,
  listEntries,
  loadSnapshot,
  purgeActorData,
  replayOutbox,
  reviveActor,
  saveSnapshot,
  sendEntry,
  type MeasurementEntry,
  type OutboxScope,
  type PatientSnapshot,
} from "../src/lib/client/outbox";

// Unit environment only: no browser, React mounting, or network is involved.
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const values = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
  clear: () => values.clear(),
};
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: Object.assign(new EventTarget(), { localStorage }),
});
after(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function scope(label: string): OutboxScope {
  return { actorId: `actor-${label}-${crypto.randomUUID()}`, patientId: `patient-${label}` };
}

function entry(actor: OutboxScope): MeasurementEntry {
  return createMeasurementEntry(actor, {
    kind: "blood_pressure", systolic: 170, diastolic: 95,
    unit: "mmHg", measuredAt: new Date().toISOString(),
  }, null);
}

function snapshot(actor: OutboxScope): PatientSnapshot {
  const timestamp = new Date().toISOString();
  return {
    ...actor,
    savedAt: timestamp,
    record: {
      patient: {
        id: actor.patientId, displayName: "Synthetic test patient", region: "Test",
        age: 62, language: "fr", fictional: true, consent: true,
        status: "unknown", createdAt: timestamp,
        rules: {
          version: "demo-v1", demonstration: true, systolicWarn: 140, systolicHigh: 160,
          diastolicWarn: 90, diastolicHigh: 100, glucoseWarn: 180, glucoseHigh: 250,
          glucoseUnit: "mg/dL", overdueHours: 24,
        },
      },
      measurements: [], alerts: [], reminders: [], observations: [], documents: [], candidates: [], actions: [],
    },
  };
}

function success(item: MeasurementEntry): Response {
  return Response.json({
    measurement: {
      ...item.payload, id: `received-${item.clientId}`, patientId: item.patientId,
      receivedAt: new Date().toISOString(), source: "app", status: "red", ruleVersion: "demo-v1",
    },
    alert: null,
    patientMessage: { text: "Synthetic test response", status: "red", ai: false },
  });
}

async function mustFinishBeforeResponse(promise: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Actor purge waited for a held network response instead of fencing it")), 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

for (const signBackIn of [false, true]) {
  test(`late measurement response cannot restore purged data${signBackIn ? ", even after the same actor signs back in" : ""}`, async () => {
    const actor = scope(signBackIn ? "revive" : "logout");
    const item = entry(actor);
    const started = deferred<void>();
    const response = deferred<Response>();
    globalThis.fetch = async () => { started.resolve(); return response.promise; };
    await enqueue(item);
    await saveSnapshot(snapshot(actor));
    const sending = sendEntry(item);
    await started.promise;
    const purging = purgeActorData(actor.actorId);
    try {
      await mustFinishBeforeResponse(purging);
      assert.deepEqual(await listEntries(actor), [], "purge must clear the entry immediately");
      assert.equal(await loadSnapshot(actor), null);
      if (signBackIn) reviveActor(actor.actorId);
      response.resolve(success(item));
      await sending;
      assert.deepEqual(await listEntries(actor), [], "an obsolete send must never re-create private device data");
      assert.equal(await loadSnapshot(actor), null);
      if (signBackIn) {
        const current = entry(actor);
        await enqueue(current);
        assert.deepEqual((await listEntries(actor)).map((row) => row.clientId), [current.clientId], "new-session writes must remain usable");
      }
    } finally {
      response.resolve(success(item));
      await Promise.allSettled([sending, purging]);
      await purgeActorData(actor.actorId);
      globalThis.fetch = originalFetch;
    }
  });
}

test("purge removes only the departing actor's entries and snapshot, and ignores later stale snapshot writes", async () => {
  const departing = scope("departing");
  const remaining = scope("remaining");
  const own = entry(departing);
  const other = entry(remaining);
  try {
    await enqueue(own);
    await enqueue(other);
    await saveSnapshot(snapshot(departing));
    await saveSnapshot(snapshot(remaining));
    await purgeActorData(departing.actorId);
    await saveSnapshot(snapshot(departing));
    assert.deepEqual(await listEntries(departing), []);
    assert.equal(await loadSnapshot(departing), null);
    assert.deepEqual((await listEntries(remaining)).map((row) => row.clientId), [other.clientId]);
    assert.equal((await loadSnapshot(remaining))?.actorId, remaining.actorId);
  } finally {
    await purgeActorData(departing.actorId);
    await purgeActorData(remaining.actorId);
  }
});

test("duplicate concurrent sends share one request and replay keeps the original idempotency payload", async () => {
  const actor = scope("idempotency");
  const item = entry(actor);
  const started = deferred<void>();
  const response = deferred<Response>();
  const payloads: unknown[] = [];
  globalThis.fetch = async (_url, options) => {
    payloads.push(JSON.parse(String(options?.body)));
    started.resolve();
    return response.promise;
  };
  await enqueue(item);
  const first = sendEntry(item);
  const duplicate = sendEntry(item);
  try {
    assert.strictEqual(first, duplicate, "the same clientId must share its active request");
    await started.promise;
    assert.equal(payloads.length, 1);
    response.resolve(Response.json({ error: { code: "TEMPORARY", message: "Synthetic unavailable server" } }, { status: 503 }));
    assert.equal((await first).state, "queued");
    globalThis.fetch = async (_url, options) => {
      payloads.push(JSON.parse(String(options?.body)));
      return success(item);
    };
    const report = await replayOutbox(actor);
    assert.equal(report.received, 1);
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads, [item.payload, item.payload], "retry must preserve clientId, timestamps, values, and units");
    assert.equal((await listEntries(actor))[0].state, "server_received");
  } finally {
    response.resolve(success(item));
    await Promise.allSettled([first, duplicate]);
    await purgeActorData(actor.actorId);
    globalThis.fetch = originalFetch;
  }
});

test("durable cross-context fence rejects held send and stale snapshot without local tombstones", async () => {
  const actor = scope("remote-fence");
  const item = entry(actor);
  const started = deferred<void>();
  const response = deferred<Response>();
  globalThis.fetch = async () => { started.resolve(); return response.promise; };
  await enqueue(item);
  await saveSnapshot(snapshot(actor));
  const sending = sendEntry(item);
  await started.promise;
  // The other tab persists this fence before its deletion transaction. No
  // local purge/tombstone call or storage event is delivered in this context.
  values.set(`hackcure:actor-fence:${actor.actorId}`, crypto.randomUUID());
  try {
    response.resolve(success(item));
    assert.notEqual((await sending).state, "server_received");
    assert.notEqual((await listEntries(actor))[0]?.state, "server_received");
    await assert.rejects(saveSnapshot(snapshot(actor)), /Transaction aborted/);
    await assert.rejects(enqueue(entry(actor)), /Transaction aborted/);
  } finally {
    response.resolve(success(item));
    await sending;
    await purgeActorData(actor.actorId);
    globalThis.fetch = originalFetch;
  }
});
