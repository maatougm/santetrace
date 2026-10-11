import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import type { Actor } from "../src/lib/client/api";
import {
  createMeasurementEntry,
  enqueue,
  listEntries,
  loadSnapshot,
  saveSnapshot,
  sendEntry,
  type MeasurementEntry,
  type OutboxScope,
  type PatientSnapshot,
} from "../src/lib/client/outbox";
import { adoptSignedInActor, checkSession, readCachedActor } from "../src/lib/client/session";
import {
  DEVICE_PURGE_FAILED,
  createDeviceBinding,
  deviceBinding,
  readDeviceOwner,
  type DevicePurger,
} from "../src/lib/client/session-cleanup";

// Unit environment only: fake IndexedDB, an in-memory localStorage and a
// scripted fetch. No browser, React rendering, router or real network.
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
afterEach(() => {
  globalThis.fetch = originalFetch;
  values.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function patient(label: string): Actor {
  const suffix = crypto.randomUUID();
  return { id: `actor-${label}-${suffix}`, role: "patient", displayName: `Synthetic patient ${label}`, patientId: `patient-${label}-${suffix}` };
}

function scopeOf(actor: Actor): OutboxScope {
  return { actorId: actor.id, patientId: actor.patientId ?? "" };
}

function entry(actor: Actor): MeasurementEntry {
  return createMeasurementEntry(scopeOf(actor), {
    kind: "blood_pressure", systolic: 172, diastolic: 96,
    unit: "mmHg", measuredAt: new Date().toISOString(),
  }, null);
}

function snapshot(actor: Actor): PatientSnapshot {
  const timestamp = new Date().toISOString();
  const scope = scopeOf(actor);
  return {
    ...scope,
    savedAt: timestamp,
    record: {
      patient: {
        id: scope.patientId, displayName: actor.displayName, region: "Test",
        age: 60, language: "fr", fictional: true, consent: true,
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

function sessionResponse(actor: Actor | null): Response {
  return Response.json({ actor, mode: "fictional_demo" });
}

function measurementReceived(item: MeasurementEntry): Response {
  return Response.json({
    measurement: {
      ...item.payload, id: `received-${item.clientId}`, patientId: item.patientId,
      receivedAt: new Date().toISOString(), source: "app", status: "red", ruleVersion: "demo-v1",
    },
    alert: null,
    patientMessage: { text: "Synthetic test response", status: "red", ai: false },
  });
}

type Route = (url: string) => Promise<Response> | Response;

/** Scripted same-origin API: GET /api/session and measurement POSTs only. */
function serve(routes: { session?: Route; measurement?: Route }): void {
  globalThis.fetch = async (input) => {
    const url = String(input);
    const route = url.endsWith("/api/session") ? routes.session : url.includes("/measurements") ? routes.measurement : undefined;
    if (!route) throw new Error(`Unexpected request in test: ${url}`);
    return route(url);
  };
}

/** Binds `actor` the way the app does on a verified GET /api/session. */
async function signIn(actor: Actor): Promise<void> {
  serve({ session: () => sessionResponse(actor) });
  const result = await checkSession({ signal: new AbortController().signal });
  assert.equal(result.kind, "settled");
  assert.equal(result.kind === "settled" && result.state.status, "authenticated");
}

/** Starts a measurement send whose server response is held by the test. */
async function holdSend(item: MeasurementEntry) {
  const started = deferred<void>();
  const response = deferred<Response>();
  serve({ measurement: () => { started.resolve(); return response.promise; } });
  const sending = sendEntry(item);
  await started.promise;
  return { sending, release: () => response.resolve(measurementReceived(item)) };
}

/** In-memory purger whose purge can be held or rejected by the test. */
function scriptedPurger(script: { purge?: () => Promise<void> } = {}) {
  const purged: string[] = [];
  const purger: DevicePurger = {
    purgeActor: async (actorId) => {
      purged.push(actorId);
      await script.purge?.();
    },
    discardSnapshot: async () => undefined,
  };
  return { purger, purged };
}

async function bindWith(binding: ReturnType<typeof createDeviceBinding>, actor: Actor) {
  serve({ session: () => sessionResponse(actor) });
  return checkSession({ signal: new AbortController().signal, binding });
}

test("generic logout (account switch) purges the departing patient with no UI callback, before the server session ends", async () => {
  const departing = patient("switch");
  await signIn(departing);
  const queued = entry(departing);
  await enqueue(queued);
  await saveSnapshot(snapshot(departing));
  const held = await holdSend(queued);

  const serverEnd = deferred<void>();
  let purgedBeforeServerCall = false;
  const outcome = deviceBinding.logout({
    actor: departing,
    endServerSession: async () => {
      purgedBeforeServerCall =
        (await listEntries(scopeOf(departing))).length === 0 &&
        (await loadSnapshot(scopeOf(departing))) === null &&
        readCachedActor() === null &&
        readDeviceOwner() === null;
      return serverEnd.promise;
    },
  });
  try {
    // The purge must not wait for the held measurement response.
    await waitUntil(() => purgedBeforeServerCall, "server sign-out was not reached with the device already purged");
    serverEnd.resolve();
    assert.deepEqual(await outcome, { status: "signed_out", serverError: null });

    held.release();
    await held.sending;
    assert.deepEqual(await listEntries(scopeOf(departing)), [], "a late response must not re-create the queue");
    assert.equal(await loadSnapshot(scopeOf(departing)), null);
    assert.equal(readCachedActor(), null);
    assert.equal(readDeviceOwner(), null);
  } finally {
    serverEnd.resolve();
    held.release();
    await Promise.allSettled([outcome, held.sending]);
  }
});

test("a UI callback that approves logout cannot skip the central purge; a cancelling callback changes nothing", async () => {
  const actor = patient("callback");
  await signIn(actor);
  const queued = entry(actor);
  await enqueue(queued);
  let serverCalls = 0;
  const endServerSession = async () => { serverCalls += 1; };

  const cancelled = await deviceBinding.logout({ actor, beforeLogout: () => false, endServerSession });
  assert.deepEqual(cancelled, { status: "cancelled" });
  assert.equal(serverCalls, 0);
  assert.deepEqual((await listEntries(scopeOf(actor))).map((row) => row.clientId), [queued.clientId]);
  assert.equal(readDeviceOwner()?.actorId, actor.id);

  // Approves but purges nothing itself (like a shell with no patient guard).
  const approved = await deviceBinding.logout({ actor: null, beforeLogout: async () => true, endServerSession });
  assert.equal(approved.status, "signed_out");
  assert.equal(serverCalls, 1);
  assert.deepEqual(await listEntries(scopeOf(actor)), [], "the device binding alone must identify and purge the actor");
  assert.equal(readCachedActor(), null);
});

test("actor A to B replacement purges A before B is cached, and hides both while the purge is held", async () => {
  const purge = deferred<void>();
  const { purger, purged } = scriptedPurger({ purge: () => purge.promise });
  const binding = createDeviceBinding(purger);
  const departing = patient("a");
  const arriving = patient("b");
  assert.equal((await bindWith(binding, departing)).kind, "settled");
  assert.deepEqual(purged, [], "binding the first actor purges nothing");

  let replacing = 0;
  serve({ session: () => sessionResponse(arriving) });
  let settled = false;
  const check = checkSession({ signal: new AbortController().signal, binding, onReplacing: () => { replacing += 1; } })
    .finally(() => { settled = true; });
  try {
    await waitUntil(() => purged.length === 1, "the departing actor was never purged");
    assert.deepEqual(purged, [departing.id]);
    assert.equal(replacing, 1, "the UI must hide the departing actor during the purge");
    assert.equal(settled, false, "B must not be published while A's purge is held");
    assert.equal(readCachedActor(), null, "neither A's offline identity nor B may be cached mid-purge");
    assert.equal(readDeviceOwner()?.actorId, departing.id, "A stays referenced until its purge succeeds");

    purge.resolve();
    const result = await check;
    assert.equal(result.kind === "settled" && result.state.status === "authenticated" && result.state.actor.id, arriving.id);
    assert.equal(readCachedActor()?.actor.id, arriving.id);
    assert.equal(readDeviceOwner()?.actorId, arriving.id);
  } finally {
    purge.resolve();
    await check.catch(() => undefined);
  }
});

for (const overtakenBy of ["logout", "newer check"] as const) {
  test(`replacement re-checks after the purge: a ${overtakenBy} during the held purge means B is never cached`, async () => {
    const purge = deferred<void>();
    const { purger } = scriptedPurger({ purge: () => purge.promise });
    const binding = createDeviceBinding(purger);
    const departing = patient("overtaken-a");
    const arriving = patient("overtaken-b");
    await bindWith(binding, departing);

    const controller = new AbortController();
    let replacing = false;
    serve({ session: () => sessionResponse(arriving) });
    const check = checkSession({ signal: controller.signal, binding, onReplacing: () => { replacing = true; } });
    await waitUntil(() => replacing, "the replacement purge never started");
    let serverCalls = 0;
    const logout = overtakenBy === "logout"
      ? binding.logout({ endServerSession: async () => { serverCalls += 1; } })
      : null;
    if (overtakenBy === "newer check") controller.abort();
    purge.resolve();

    assert.deepEqual(await check, { kind: "superseded" });
    if (logout) assert.equal((await logout).status, "signed_out");
    assert.equal(serverCalls, overtakenBy === "logout" ? 1 : 0);
    assert.equal(readCachedActor(), null, "B must not be cached by an overtaken check");
    assert.equal(readDeviceOwner()?.actorId ?? null, overtakenBy === "logout" ? null : departing.id,
      "a superseded replacement must not mutate the shared owner after its await");
  });
}

test("replacement with the real outbox removes A's queue and device copy, and A's held send cannot restore them", async () => {
  const departing = patient("real-a");
  const arriving = patient("real-b");
  await signIn(departing);
  const queued = entry(departing);
  await enqueue(queued);
  await saveSnapshot(snapshot(departing));
  const held = await holdSend(queued);
  try {
    serve({ session: () => sessionResponse(arriving) });
    const result = await checkSession({ signal: new AbortController().signal });
    assert.equal(result.kind === "settled" && result.state.status, "authenticated");
    assert.deepEqual(await listEntries(scopeOf(departing)), []);
    assert.equal(await loadSnapshot(scopeOf(departing)), null);

    held.release();
    await held.sending;
    assert.deepEqual(await listEntries(scopeOf(departing)), [], "A's late response must persist nothing");
    assert.equal(await loadSnapshot(scopeOf(departing)), null);

    const next = entry(arriving);
    await enqueue(next);
    assert.deepEqual((await listEntries(scopeOf(arriving))).map((row) => row.clientId), [next.clientId], "B's device writes work");
  } finally {
    held.release();
    await Promise.allSettled([held.sending]);
    await deviceBinding.logout({ actor: arriving, endServerSession: async () => undefined });
  }
});

test("a rejected purge never publishes B, keeps A referenced, blocks logout, and succeeds on retry", async () => {
  let failing = true;
  const { purger, purged } = scriptedPurger({
    purge: async () => { if (failing) throw new Error("Synthetic storage failure"); },
  });
  const binding = createDeviceBinding(purger);
  const departing = patient("fail-a");
  const arriving = patient("fail-b");
  await bindWith(binding, departing);

  const result = await bindWith(binding, arriving);
  assert.equal(result.kind, "settled");
  assert.equal(result.kind === "settled" && result.state.status, "error");
  assert.equal(result.kind === "settled" && result.state.status === "error" && result.state.error.code, DEVICE_PURGE_FAILED);
  assert.equal(readCachedActor(), null, "B is not cached and A is no longer offered offline");
  assert.equal(readDeviceOwner()?.actorId, departing.id, "A stays referenced so a retry can purge it");

  assert.equal(await adoptSignedInActor(arriving, binding), "purge_failed", "a sign-in form cannot bypass the purge");
  assert.equal(readCachedActor(), null);

  let serverCalls = 0;
  const logout = await binding.logout({ actor: arriving, endServerSession: async () => { serverCalls += 1; } });
  assert.equal(logout.status, "purge_failed");
  assert.equal(serverCalls, 0, "no logout-anyway: the server session is kept so the user can retry");
  assert.equal(readDeviceOwner()?.actorId, departing.id);

  failing = false;
  const retried = await bindWith(binding, arriving);
  assert.equal(retried.kind === "settled" && retried.state.status === "authenticated" && retried.state.actor.id, arriving.id);
  assert.equal(readDeviceOwner()?.actorId, arriving.id);
  assert.ok(purged.every((id) => id === departing.id || id === arriving.id));
  assert.ok(purged.includes(departing.id));
});

test("a session response for A that was in flight during logout cannot restore A's binding or device data", async () => {
  const actor = patient("stale");
  await signIn(actor);
  const queued = entry(actor);
  await enqueue(queued);
  await saveSnapshot(snapshot(actor));

  const sessionStarted = deferred<void>();
  const sessionReply = deferred<Response>();
  serve({ session: () => { sessionStarted.resolve(); return sessionReply.promise; } });
  const check = checkSession({ signal: new AbortController().signal });
  await sessionStarted.promise;
  try {
    const outcome = await deviceBinding.logout({ actor, endServerSession: async () => undefined });
    assert.equal(outcome.status, "signed_out");

    // The server answered before it processed DELETE /api/session.
    sessionReply.resolve(sessionResponse(actor));
    assert.deepEqual(await check, { kind: "superseded" });
    assert.equal(readCachedActor(), null, "the stale response must not re-cache A");
    assert.equal(readDeviceOwner(), null);
    assert.deepEqual(await listEntries(scopeOf(actor)), []);
    assert.equal(await loadSnapshot(scopeOf(actor)), null);
  } finally {
    sessionReply.resolve(sessionResponse(null));
    await check.catch(() => undefined);
  }
});

test("same-actor refresh does not purge: queue, device copy and an in-flight send survive", async () => {
  const { purger, purged } = scriptedPurger();
  const counted = createDeviceBinding(purger);
  const repeat = patient("repeat");
  for (let round = 0; round < 3; round += 1) await bindWith(counted, repeat);
  assert.deepEqual(purged, [], "re-verifying the same actor must never purge");

  const actor = patient("same");
  await signIn(actor);
  const queued = entry(actor);
  await enqueue(queued);
  await saveSnapshot(snapshot(actor));
  const held = await holdSend(queued);
  try {
    serve({ session: () => sessionResponse(actor), measurement: () => measurementReceived(queued) });
    const result = await checkSession({ signal: new AbortController().signal });
    assert.equal(result.kind === "settled" && result.state.status, "authenticated");
    assert.equal((await loadSnapshot(scopeOf(actor)))?.actorId, actor.id);

    held.release();
    const sent = await held.sending;
    assert.equal(sent.state, "server_received", "an unfenced send keeps its outcome");
    assert.equal((await listEntries(scopeOf(actor)))[0]?.state, "server_received");
  } finally {
    held.release();
    await Promise.allSettled([held.sending]);
    await deviceBinding.logout({ actor, endServerSession: async () => undefined });
  }
});

for (const nextIsSameActor of [true, false]) {
  test(`session expiry keeps the departing reference; ${nextIsSameActor ? "the same patient keeps the queue for replay" : "another account purges it first"}`, async () => {
    const actor = patient("expired");
    await signIn(actor);
    const queued = entry(actor);
    await enqueue(queued);
    await saveSnapshot(snapshot(actor));

    serve({ session: () => Response.json({ error: { code: "UNAUTHENTICATED", message: "Synthetic expiry" } }, { status: 401 }) });
    const expired = await checkSession({ signal: new AbortController().signal });
    assert.equal(expired.kind === "settled" && expired.state.status, "anonymous");
    assert.equal(readCachedActor(), null, "an expired actor is no longer offered offline");
    assert.equal(await loadSnapshot(scopeOf(actor)), null, "the device copy of the record is dropped");
    assert.equal(readDeviceOwner()?.actorId, actor.id, "the departing reference survives expiry");
    assert.deepEqual((await listEntries(scopeOf(actor))).map((row) => row.clientId), [queued.clientId]);

    const next = nextIsSameActor ? actor : patient("after-expiry");
    try {
      assert.equal(await adoptSignedInActor(next), "admitted");
      const remaining = await listEntries(scopeOf(actor));
      if (nextIsSameActor) assert.deepEqual(remaining.map((row) => row.clientId), [queued.clientId]);
      else assert.deepEqual(remaining, [], "another account must never be published over A's queue");
      assert.equal(readDeviceOwner()?.actorId, next.id);
    } finally {
      await deviceBinding.logout({ actor: next, endServerSession: async () => undefined });
      await deviceBinding.logout({ actor, endServerSession: async () => undefined });
    }
  });
}

test("a device that only holds a legacy cached actor still purges it before another account", async () => {
  const legacy = patient("legacy");
  const arriving = patient("modern");
  await enqueue(entry(legacy));
  values.set("hackcure:last-actor", JSON.stringify({ actor: legacy, verifiedAt: new Date().toISOString() }));
  try {
    assert.equal(await adoptSignedInActor(arriving), "admitted");
    assert.deepEqual(await listEntries(scopeOf(legacy)), []);
    assert.equal(readCachedActor()?.actor.id, arriving.id);
  } finally {
    await deviceBinding.logout({ actor: arriving, endServerSession: async () => undefined });
  }
});

async function waitUntil(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("another binding's logout invalidates a held session ticket without event delivery", async () => {
  const first = createDeviceBinding();
  const second = createDeviceBinding();
  const actor = patient("two-tabs");
  assert.equal((await first.admit(actor, { ticket: first.takeTicket() })).status, "admitted");
  const stale = second.takeTicket();
  await enqueue(entry(actor));
  assert.equal((await first.logout({ endServerSession: async () => undefined })).status, "signed_out");
  assert.equal((await second.admit(actor, { ticket: stale })).status, "superseded");
  assert.equal(readCachedActor(), null);
  assert.deepEqual(await listEntries(scopeOf(actor)), []);
});

test("denied identity storage blocks replacement across reload while IndexedDB still contains A", async () => {
  const actor = patient("denied-a");
  const clinician: Actor = { id: crypto.randomUUID(), role: "clinician", displayName: "Synthetic clinician", patientId: null };
  await signIn(actor);
  await enqueue(entry(actor));
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window")!;
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), {
    localStorage: { getItem() { throw new Error("Denied"); }, setItem() { throw new Error("Denied"); }, removeItem() { throw new Error("Denied"); } },
  }) });
  try {
    for (let reload = 0; reload < 2; reload++) {
      const binding = createDeviceBinding();
      assert.equal((await binding.admit(clinician, { ticket: binding.takeTicket() })).status, "purge_failed");
      assert.equal((await listEntries(scopeOf(actor))).length, 1);
      await assert.rejects(enqueue(entry(clinician)), /Denied|Transaction aborted/);
    }
  } finally {
    Object.defineProperty(globalThis, "window", saved);
    await deviceBinding.logout({ actor, endServerSession: async () => undefined });
  }
});

test("a second binding cannot admit an actor during a held replacement purge", async () => {
  const held = deferred<void>();
  const { purger } = scriptedPurger({ purge: () => held.promise });
  const first = createDeviceBinding(purger);
  const second = createDeviceBinding(purger);
  const a = patient("interleave-a");
  const b = patient("interleave-b");
  await first.admit(a, { ticket: first.takeTicket() });
  let replacing = false;
  const replacement = first.admit(b, { ticket: first.takeTicket(), onReplacing: () => { replacing = true; } });
  await waitUntil(() => replacing, "replacement never started");
  try {
    assert.equal((await second.admit(a, { ticket: second.takeTicket() })).status, "superseded");
    assert.equal(readCachedActor(), null);
    held.resolve();
    assert.equal((await replacement).status, "admitted");
    assert.equal(readCachedActor()?.actor.id, b.id);
  } finally { held.resolve(); await replacement; }
});

for (const denied of ["setItem", "removeItem"] as const) {
  test(`identity storage ${denied} failure blocks another actor and server logout`, async () => {
    const binding = createDeviceBinding();
    const a = patient(`storage-${denied}`);
    await binding.admit(a, { ticket: binding.takeTicket() });
    const original = localStorage[denied];
    localStorage[denied] = () => { throw new Error("Denied"); };
    try {
      assert.equal((await binding.admit(patient("blocked"), { ticket: binding.takeTicket() })).status, "purge_failed");
      let serverCalls = 0;
      assert.equal((await binding.logout({ endServerSession: async () => { serverCalls++; } })).status, "purge_failed");
      assert.equal(serverCalls, 0);
    } finally { Object.defineProperty(localStorage, denied, { configurable: true, writable: true, value: original }); }
  });
}

test("superseded held A-to-B replacement preserves newer C ownership and later C-to-D purge", async () => {
  const held = deferred<void>();
  const oldPurger = scriptedPurger({ purge: () => held.promise });
  const old = createDeviceBinding(oldPurger.purger);
  const newer = createDeviceBinding();
  const a = patient("old-a");
  const b = patient("old-b");
  const c = patient("new-c");
  const d = patient("next-d");
  await old.admit(a, { ticket: old.takeTicket() });
  let replacing = false;
  const replacement = old.admit(b, { ticket: old.takeTicket(), onReplacing: () => { replacing = true; } });
  await waitUntil(() => replacing, "old replacement never reached its held purge");
  try {
    assert.equal((await newer.logout({ actor: a, endServerSession: async () => undefined })).status, "signed_out");
    assert.equal((await newer.admit(c, { ticket: newer.takeTicket() })).status, "admitted");
    const currentEntry = entry(c);
    await enqueue(currentEntry);
    await saveSnapshot(snapshot(c));
    held.resolve();
    assert.equal((await replacement).status, "superseded");
    assert.equal(readCachedActor()?.actor.id, c.id);
    assert.equal(readDeviceOwner()?.actorId, c.id);
    assert.equal((await listEntries(scopeOf(c)))[0]?.clientId, currentEntry.clientId);
    assert.equal((await loadSnapshot(scopeOf(c)))?.actorId, c.id);
    assert.equal((await newer.admit(d, { ticket: newer.takeTicket() })).status, "admitted");
    assert.deepEqual(await listEntries(scopeOf(c)), []);
    assert.equal(await loadSnapshot(scopeOf(c)), null);
    assert.equal(readDeviceOwner()?.actorId, d.id);
  } finally {
    held.resolve(); await replacement;
    await newer.logout({ endServerSession: async () => undefined });
  }
});

test("held expiry returns superseded rather than anonymous after another binding admits C", async () => {
  const held = deferred<void>();
  const old = createDeviceBinding({ purgeActor: async () => undefined, discardSnapshot: () => held.promise });
  const newer = createDeviceBinding();
  const a = patient("expiry-a");
  const c = patient("expiry-c");
  await old.admit(a, { ticket: old.takeTicket() });
  const expiry = old.expire(old.takeTicket());
  await waitUntil(() => readCachedActor() === null, "expiry never dropped its cached identity");
  try {
    assert.equal((await newer.admit(c, { ticket: newer.takeTicket() })).status, "admitted");
    held.resolve();
    assert.equal(await expiry, "superseded");
    assert.equal(readCachedActor()?.actor.id, c.id);
    assert.equal(readDeviceOwner()?.actorId, c.id);
  } finally { held.resolve(); await expiry; await newer.logout({ endServerSession: async () => undefined }); }
});
