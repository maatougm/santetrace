import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { attachLiveWebSocket, liveCookieToken, liveFingerprint, liveOriginAllowed } from "../src/lib/live-websocket";
import { signSession, SESSION_COOKIE } from "../src/lib/care-session";
import { InterventionService } from "../src/lib/intervention-service";
import { fixtureStore, testOwner, testDoctor } from "./helpers/care-fixture";
import { liveReconnectDelay } from "../src/lib/client/use-live";
import { currentGuard } from "../src/lib/patient-access-service";

async function fixture() {
  const store = fixtureStore();
  const server = createServer((_, response) => response.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const hub = attachLiveWebSocket(server, { origin, store, heartbeatMs: 50 });
  return { store, server, origin, hub, url: `ws://127.0.0.1:${port}/api/live`, async close() { hub.close(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); } };
}
async function connect(url: string, origin: string, token: string) {
  const socket = new WebSocket(url, { origin, headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  const events: string[] = [];
  socket.on("message", bytes => events.push(bytes.toString()));
  socket.on("error", () => {});
  await once(socket, "open");
  await until(() => events.includes('{"type":"ready"}'));
  return { socket, events };
}
async function until(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Live event timeout"); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function rejection(url: string, origin?: string, cookie?: string): Promise<number> {
  return new Promise(resolve => {
    const socket = new WebSocket(url, { ...(origin ? { origin } : {}), ...(cookie ? { headers: { cookie } } : {}) });
    socket.on("error", () => {});
    socket.on("unexpected-response", (_, response) => { response.resume(); resolve(response.statusCode!); socket.terminate(); });
  });
}

test("WebSocket upgrade requires configured Origin, one current signed cookie and no URL credential", async () => {
  const f = await fixture();
  try {
    const cookie = `${SESSION_COOKIE}=${signSession(testOwner, Date.now(), f.store)}`;
    assert.equal(await rejection(f.url, f.origin), 401);
    assert.equal(await rejection(f.url, "https://attacker.example", cookie), 403);
    assert.equal(await rejection(f.url, undefined, cookie), 403);
    assert.equal(await rejection(`${f.url}?token=private`, f.origin, cookie), 403);
    assert.equal(await rejection(f.url, f.origin, `${cookie}; ${cookie}`), 401);
    const expired = signSession(testOwner, Date.now() - 9 * 3_600_000, f.store);
    assert.equal(await rejection(f.url, f.origin, `${SESSION_COOKIE}=${expired}`), 401);
    assert.equal(f.hub.connectionCount, 0);
  } finally { await f.close(); }
});

test("saved doctor messages push patient/doctor invalidation with no text or identifiers; unrelated threads stay silent", async () => {
  const f = await fixture();
  try {
    const secondary = { ...testDoctor, id: "secondary" };
    f.store.transaction(state => state.careGrants.push({ ...state.careGrants[0], id: "secondary-messages", clinicianId: secondary.id, relationship: "specialist", scopes: ["messages"] }));
    const owner = await connect(f.url, f.origin, signSession(testOwner, Date.now(), f.store));
    const doctor = await connect(f.url, f.origin, signSession(testDoctor, Date.now(), f.store));
    const other = await connect(f.url, f.origin, signSession(secondary, Date.now(), f.store));
    const before = liveFingerprint(f.store.read(), secondary);
    new InterventionService(f.store).sendMessage(testDoctor, "fatma", { text: "Private persisted message", kind: "administrative", clinicianId: testDoctor.id, clientId: "live-msg" });
    f.hub.notifyPersisted();
    await until(() => owner.events.includes('{"type":"invalidate"}') && doctor.events.includes('{"type":"invalidate"}'));
    assert.equal(f.store.read().messages.length, 1);
    assert.equal(liveFingerprint(f.store.read(), secondary), before);
    assert.deepEqual(other.events, ['{"type":"ready"}']);
    for (const event of [...owner.events, ...doctor.events]) {
      assert.ok(!event.includes("fatma") && !event.includes("Private") && !event.includes("demo-clinician"));
      assert.ok(["ready", "invalidate"].includes(JSON.parse(event).type));
    }
    // A reconnect reconciles through an authenticated ready event; retained content is fetched via HTTP.
    doctor.socket.terminate();
    const replacement = await connect(f.url, f.origin, signSession(testDoctor, Date.now(), f.store));
    assert.deepEqual(replacement.events, ['{"type":"ready"}']);
  } finally { await f.close(); }
});

test("grant narrowing and consent revocation remove clinical changes from future live notifications", async () => {
  const f = await fixture();
  try {
    const doctor = await connect(f.url, f.origin, signSession(testDoctor, Date.now(), f.store));
    f.store.transaction(state => { state.careGrants.find(grant => grant.id === "grant:fatma")!.state = "revoked"; });
    f.hub.refresh();
    await until(() => doctor.events.includes('{"type":"invalidate"}'));
    const afterRevoke = liveFingerprint(f.store.read(), testDoctor);
    f.store.transaction(state => { state.messages.push({ id: "hidden", revision: 1, patientId: "fatma", clinicianId: testDoctor.id, threadId: "hidden", authorId: testOwner.id, authorCategory: "patient", text: "Hidden after revoke", kind: "clinical", actionId: null, createdAt: new Date().toISOString(), readAt: null, review: null }); });
    assert.equal(liveFingerprint(f.store.read(), testDoctor), afterRevoke);
    const owner = await connect(f.url, f.origin, signSession(testOwner, Date.now(), f.store));
    f.store.transaction(state => { state.patients.find(patient => patient.id === "fatma")!.consent = false; });
    f.hub.refresh();
    await until(() => owner.events.includes('{"type":"invalidate"}'));
    const afterConsent = liveFingerprint(f.store.read(), testOwner);
    f.store.transaction(state => { state.messages[0].text = "Still hidden"; });
    assert.equal(liveFingerprint(f.store.read(), testOwner), afterConsent);
  } finally { await f.close(); }
});

test("live principal session-version revocation and explicit logout close established sockets", async () => {
  const f = await fixture();
  try {
    const token = signSession(testOwner, Date.now(), f.store);
    const owner = await connect(f.url, f.origin, token);
    const closed = once(owner.socket, "close");
    f.store.transaction(state => { state.accounts.find(account => account.id === testOwner.id)!.sessionVersion++; });
    f.hub.refresh();
    assert.equal((await closed)[0], 4401);
    assert.equal(await rejection(f.url, f.origin, `${SESSION_COOKIE}=${token}`), 401);
    const nextToken = signSession(testOwner, Date.now(), f.store);
    const next = await connect(f.url, f.origin, nextToken);
    const loggedOut = once(next.socket, "close");
    f.hub.revokeSession(nextToken);
    assert.equal((await loggedOut)[0], 4401);
  } finally { await f.close(); }
});

test("no inbound live commands are accepted, and per-actor connection count is bounded", async () => {
  const f = await fixture();
  try {
    const token = signSession(testOwner, Date.now(), f.store);
    const owner = await connect(f.url, f.origin, token);
    const closed = once(owner.socket, "close");
    owner.socket.send(JSON.stringify({ patientId: "ahmed", type: "subscribe" }));
    assert.equal((await closed)[0], 1008);
    for (let index = 0; index < 6; index++) await connect(f.url, f.origin, token);
    assert.equal(await rejection(f.url, f.origin, `${SESSION_COOKIE}=${token}`), 429);
    assert.equal(f.hub.connectionCount, 6);
  } finally { await f.close(); }
});

test("reconnect delay uses bounded exponential jitter; origin parsing and duplicate cookies fail closed", () => {
  assert.equal(liveReconnectDelay(0, () => 0.5), 1_000);
  assert.equal(liveReconnectDelay(3, () => 0.5), 8_000);
  assert.equal(liveReconnectDelay(500, () => 0.5), 30_000);
  assert.equal(liveReconnectDelay(500, () => 1), 30_000);
  assert.equal(liveOriginAllowed("https://app.example/", "https://app.example"), false);
  assert.equal(liveOriginAllowed("https://app.example", "https://app.example"), true);
  assert.equal(liveCookieToken(`${SESSION_COOKIE}=a; ${SESSION_COOKIE}=b`), undefined);
});

test("read-time evaluation/approval stamps do not cause notification loops; semantic deadlines still invalidate", () => {
  const store = fixtureStore();
  try {
    const start = "2026-10-11T12:00:00.000Z", later = "2026-10-11T12:00:01.000Z";
    store.transaction(state => {
      const action = { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} };
      state.carePlans.push({ id: "live-plan", patientId: "fatma", revision: 1, state: "active", clinicianId: testDoctor.id, profileBindings: [], actionIds: ["live-action"], reviewDeadline: "2026-10-11T12:01:00.000Z" });
      state.careProposals.push({ id: "live-proposal", patientId: "fatma", revision: 2, kind: "home_measurement", state: "approved", action, sources: [], guard: currentGuard(state, "fatma"), decision: { clinicianId: testDoctor.id, at: start, reason: "Fictional approval" }, history: [] });
      state.careActions.push({ id: "live-action", patientId: "fatma", planId: "live-plan", revision: 1, proposalId: "live-proposal", protocolId: null, originVersion: 2, action, dueAt: start, state: "pending", reportedAt: null, clientId: "live-action", createdAt: start });
      state.conditionEvaluations.push({ id: "live-evaluation", patientId: "fatma", conditionFactId: "condition", profileId: null, profileVersion: null, evaluatedAt: start, priority: "unknown", coverage: ["missing"], sources: [], reasons: [], nextDueAt: null, guard: currentGuard(state, "fatma") });
    });
    const before = liveFingerprint(store.read(), testOwner, start);
    store.transaction(state => { state.conditionEvaluations[0].evaluatedAt = later; });
    assert.equal(liveFingerprint(store.read(), testOwner, later), before);
    assert.notEqual(liveFingerprint(store.read(), testOwner, "2026-10-11T12:02:00.000Z"), before);
    store.transaction(state => { state.conditionEvaluations[0].priority = "orange"; });
    assert.notEqual(liveFingerprint(store.read(), testOwner, later), before);
  } finally { store.close(); }
});
