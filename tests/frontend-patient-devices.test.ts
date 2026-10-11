import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createAccessFence, runFenced, type FencedResult } from "../src/lib/client/access-fence";
import { SHARE_COPY } from "../src/lib/client/copy/share";
import { pairDevice, pairSimulator, type ConnectorView, type PairResult } from "../src/lib/client/devices-api";
import {
  NO_CREDENTIAL,
  credentialReducer,
  pairedAction,
  visibleCredential,
  type CredentialAction,
  type CredentialScope,
  type CredentialState,
} from "../src/components/patient/devices/credential-state";
import {
  CREDENTIAL_HEADER,
  CREDENTIAL_HEADER_LINE,
  CREDENTIAL_PLACEHOLDER,
  CREDENTIAL_SCHEME,
  EXAMPLE_EVENT,
  INGEST_METHOD,
  INGEST_PATH,
} from "../src/components/patient/devices/device-setup";
import { PAIR_REQUEST, pairAttempt } from "../src/components/patient/devices/pairing-logic";
import { selectableSimulators } from "../src/components/patient/devices/simulator-logic";

// ---------------------------------------------------------------------------
// Fixtures (fictional)
// ---------------------------------------------------------------------------

/** Shape of a server credential: 32 random bytes, base64url (43 chars). */
const SECRET = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 53 + 7) % 256)).toString("base64url");
/** A second fictional secret: the newer binding of the same device name. */
const SECRET_2 = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 97 + 11) % 256)).toString("base64url");
const FENCE_KEY = "u-000::p-000";

const connector = (id: string, kind: ConnectorView["kind"], enabled = true): ConnectorView => ({
  id,
  patientId: "p-000",
  deviceId: `${kind === "device" ? "esp32" : "sim"}-${id}`,
  kind,
  enabled,
  revision: 1,
  createdAt: "2026-10-11T08:00:00.000Z",
});

const scope = (extra: Partial<CredentialScope> = {}): CredentialScope => ({ patientId: "p-000", fenceKey: FENCE_KEY, epoch: 0, ...extra });

/** A pairing as the server answered it: the secret is bound to the server's connector ID. */
const paired = (credential: string | null, extra: Partial<CredentialScope> = {}, connectorId = "c-1"): CredentialAction => ({
  type: "paired",
  connectorId,
  kind: "device",
  deviceId: "esp32-salon",
  credential,
  scope: scope(extra),
});

const reduce = (actions: CredentialAction[], from: CredentialState = NO_CREDENTIAL) => actions.reduce(credentialReducer, from);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Request kind: exactly {deviceId, kind, clientId}
// ---------------------------------------------------------------------------

interface Captured {
  url: string;
  method: string | undefined;
  body: Record<string, unknown>;
}

function stubFetch(t: { after: (fn: () => void) => void }, payload: unknown): Captured[] {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return Response.json(payload, { status: 201 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

test("pairDevice posts exactly {deviceId, kind: 'device', clientId} to the owner's connectors", async (t) => {
  const calls = stubFetch(t, { connector: connector("c-1", "device"), credential: SECRET });
  const result = await pairDevice("p-000", { deviceId: "esp32-salon", clientId: "pair-device-1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/patients/p-000/connectors");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["clientId", "deviceId", "kind"]);
  assert.deepEqual(calls[0].body, { deviceId: "esp32-salon", kind: "device", clientId: "pair-device-1" });
  assert.equal(result.credential, SECRET);
});

test("pairSimulator still posts kind 'simulator' with the same three keys", async (t) => {
  const calls = stubFetch(t, { connector: connector("c-2", "simulator"), credential: null });
  const result = await pairSimulator("p-000", { deviceId: "sim-demo-1", clientId: "pair-1" });
  assert.deepEqual(calls[0].body, { deviceId: "sim-demo-1", kind: "simulator", clientId: "pair-1" });
  assert.equal(result.credential, null, "replay: no secret");
});

test("pairDevice requires both connector and credential in the answer", async (t) => {
  stubFetch(t, { connector: connector("c-3", "device") });
  await assert.rejects(pairDevice("p-000", { deviceId: "esp32-salon", clientId: "pair-device-2" }), { kind: "invalid_response" });
});

test("each kind has its own explicit pairing call", () => {
  assert.equal(PAIR_REQUEST.device, pairDevice);
  assert.equal(PAIR_REQUEST.simulator, pairSimulator);
});

test("pair attempt: same kind and name keep the idempotency key; another kind or name gets a new one", () => {
  let ids = 0;
  const makeId = () => `pair-${++ids}`;
  const first = pairAttempt(null, "device", "esp32-salon", makeId);
  assert.deepEqual(first, { kind: "device", deviceId: "esp32-salon", clientId: "pair-1" });
  assert.equal(pairAttempt(first, "device", "esp32-salon", makeId), first);
  assert.equal(pairAttempt(first, "simulator", "esp32-salon", makeId).clientId, "pair-2");
  assert.equal(pairAttempt(first, "device", "esp32-cuisine", makeId).clientId, "pair-3");
});

// ---------------------------------------------------------------------------
// Credential: masked, explicit reveal, explicit wipe, fenced
// ---------------------------------------------------------------------------

test("credential: shown masked, revealed only by the explicit toggle, wiped by the acknowledgement", () => {
  const shown = reduce([paired(SECRET)]);
  assert.ok(shown.status === "shown" && shown.revealed === false && shown.credential === SECRET);
  const revealed = credentialReducer(shown, { type: "toggle_reveal" });
  assert.ok(revealed.status === "shown" && revealed.revealed === true);
  assert.ok(shown.status === "shown" && shown.revealed === false, "the previous state is not mutated");
  const hidden = credentialReducer(revealed, { type: "toggle_reveal" });
  assert.ok(hidden.status === "shown" && hidden.revealed === false);
  assert.deepEqual(credentialReducer(revealed, { type: "acknowledge" }), NO_CREDENTIAL);
});

test("credential: a fence epoch move, an access denial or a patient/fence-key change wipes it", () => {
  const shown = reduce([paired(SECRET), { type: "toggle_reveal" }]);
  assert.deepEqual(credentialReducer(shown, { type: "fence_moved" }), NO_CREDENTIAL);
  assert.deepEqual(credentialReducer(shown, { type: "access_denied" }), NO_CREDENTIAL);
  assert.deepEqual(credentialReducer(shown, { type: "scope_changed", scope: scope({ patientId: "p-001" }) }), NO_CREDENTIAL);
  assert.deepEqual(credentialReducer(shown, { type: "scope_changed", scope: scope({ fenceKey: "u-001::p-000" }) }), NO_CREDENTIAL);
  assert.deepEqual(credentialReducer(shown, { type: "scope_changed", scope: scope({ epoch: 1 }) }), NO_CREDENTIAL);
  assert.equal(credentialReducer(shown, { type: "scope_changed", scope: scope() }), shown, "same scope: kept");
});

test("credential: the render guard never draws a secret issued under another scope", () => {
  const shown = reduce([paired(SECRET)]);
  assert.ok(visibleCredential(shown, scope()));
  assert.equal(visibleCredential(shown, scope({ epoch: 3 })), null);
  assert.equal(visibleCredential(shown, scope({ patientId: "p-001" })), null);
  assert.equal(visibleCredential(shown, scope({ fenceKey: null })), null);
  assert.equal(visibleCredential(NO_CREDENTIAL, scope()), null);
});

test("credential: the fence subscription wipes it on revocation and on an authority change", () => {
  for (const move of [(f: ReturnType<typeof createAccessFence>) => f.revoke(), (f: ReturnType<typeof createAccessFence>) => f.admitRevision(2), (f: ReturnType<typeof createAccessFence>) => f.retire()]) {
    const fence = createAccessFence(FENCE_KEY);
    fence.admitRevision(1);
    let state = reduce([paired(SECRET, { epoch: fence.epoch() })]);
    const unsubscribe = fence.subscribe(() => {
      state = credentialReducer(state, { type: "fence_moved" });
    });
    move(fence);
    unsubscribe();
    assert.deepEqual(state, NO_CREDENTIAL);
  }
});

test("credential: replay (null) carries no secret and cannot be revealed", () => {
  const replay = reduce([paired(null), { type: "toggle_reveal" }]);
  assert.ok(replay.status === "shown" && replay.credential === null && replay.revealed === false);
  assert.deepEqual(credentialReducer(replay, { type: "acknowledge" }), NO_CREDENTIAL);
});

test("credential: a current fenced pairing yields a masked secret bound to its scope; kind comes from the server", async () => {
  const fence = createAccessFence(FENCE_KEY);
  const result = await runFenced(fence, async (): Promise<PairResult> => ({ connector: connector("c-1", "device"), credential: SECRET }));
  const action = pairedAction(result, scope({ epoch: fence.epoch() }));
  assert.ok(action);
  assert.equal(action.kind, "device");
  assert.equal(action.deviceId, "esp32-c-1");
  assert.equal(action.connectorId, "c-1", "bound to the server's connector ID, not the device name");
  const state = credentialReducer(NO_CREDENTIAL, action);
  assert.ok(state.status === "shown" && state.credential === SECRET && state.revealed === false);
  const replayResult = await runFenced(fence, async (): Promise<PairResult> => ({ connector: connector("c-1", "device"), credential: null }));
  assert.equal(pairedAction(replayResult, scope())?.credential, null);
});

test("credential: a stale fenced pairing never yields a credential", async () => {
  const moves: [string, (f: ReturnType<typeof createAccessFence>) => void][] = [
    ["revocation", (f) => f.revoke()],
    ["authority change", (f) => f.admitRevision(5)],
    ["patient switch (retired fence)", (f) => f.retire()],
  ];
  for (const [label, move] of moves) {
    const fence = createAccessFence(FENCE_KEY);
    fence.admitRevision(1);
    const held = deferred<PairResult>();
    const pending = runFenced(fence, () => held.promise);
    move(fence);
    held.resolve({ connector: connector("c-1", "device"), credential: SECRET });
    const result = await pending;
    assert.equal(result.status, "stale", label);
    assert.equal(pairedAction(result, scope({ epoch: fence.epoch() })), null, label);
  }
  const denied = createAccessFence(FENCE_KEY);
  denied.revoke();
  let sent = false;
  const refused = await runFenced(denied, async (): Promise<PairResult> => {
    sent = true;
    return { connector: connector("c-1", "device"), credential: SECRET };
  });
  assert.equal(sent, false, "nothing is sent under a denied fence");
  assert.equal(pairedAction(refused, scope()), null);
});

// ---------------------------------------------------------------------------
// Simulated readings: enabled simulators only
// ---------------------------------------------------------------------------

test("simulator send offers only enabled simulator bindings, never devices or revoked ones", () => {
  const list = [connector("s-on", "simulator"), connector("s-off", "simulator", false), connector("d-on", "device"), connector("d-off", "device", false)];
  assert.deepEqual(
    selectableSimulators(list).map((c) => c.id),
    ["s-on"],
  );
  assert.deepEqual(selectableSimulators([connector("d-on", "device")]), [], "only a device: nothing to send through");
});

// ---------------------------------------------------------------------------
// Setup instructions match the server's ingest route
// ---------------------------------------------------------------------------

const source = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("setup guide: method, path and credential header are the ones the server reads", () => {
  const http = source("src", "lib", "monitoring-http.ts");
  assert.match(http, /path\[0\] === "connectors" && path\[1\] === "events" && method === "POST"/);
  assert.match(http, /request\.headers\.get\("authorization"\)/);
  assert.match(http, /\^Bearer \(\[A-Za-z0-9_-\]\{43\}\)\$/);
  assert.equal(INGEST_METHOD, "POST");
  assert.equal(INGEST_PATH, "/api/connectors/events");
  assert.equal(CREDENTIAL_HEADER.toLowerCase(), "authorization");
  assert.equal(CREDENTIAL_SCHEME, "Bearer");
  assert.equal(CREDENTIAL_HEADER_LINE, `Authorization: Bearer ${CREDENTIAL_PLACEHOLDER}`);
  assert.equal(new RegExp("^Bearer ([A-Za-z0-9_-]{43})$").test(`Bearer ${SECRET}`), true, "a server-shaped secret fits the header");
});

test("setup guide: the example event has exactly the keys the server accepts", () => {
  const service = source("src", "lib", "connector-service.ts");
  assert.match(service, /onlyKeys\(input, \["externalEventId", "measuredAt", "reading", "quality"\]\)/);
  assert.deepEqual(Object.keys(EXAMPLE_EVENT).sort(), ["externalEventId", "measuredAt", "quality", "reading"]);
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const ARABIC = /[؀-ۿ]/;

test("devices copy: every key exists in FR and AR, non-empty, Arabic actually Arabic", () => {
  const fr = SHARE_COPY.fr.devices;
  const ar = SHARE_COPY.ar.devices;
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(fr).sort());
  for (const key of Object.keys(fr) as (keyof typeof fr)[]) {
    assert.equal(typeof fr[key], "string", key);
    assert.ok(fr[key].trim().length > 0, `fr.${key}`);
    assert.ok(ARABIC.test(ar[key]), `ar.${key} is not Arabic`);
  }
});

test("copy: page title and links read 'Appareils et simulateur' / 'الأجهزة والمحاكي'", () => {
  assert.equal(SHARE_COPY.fr.simulator.title, "Appareils et simulateur");
  assert.equal(SHARE_COPY.ar.simulator.title, "الأجهزة والمحاكي");
  assert.match(source("src", "app", "patient", "measure", "devices", "page.tsx"), /title: "Appareils et simulateur"/);
  const measure = source("src", "components", "patient", "MeasureScreen.tsx");
  assert.match(measure, /href="\/patient\/measure\/devices"[\s\S]{0,200}SHARE_COPY\[lang\]\.simulator\.title/);
});

test("copy: a real-device binding is said to be a binding, not a Bluetooth or physical connection", () => {
  assert.match(SHARE_COPY.fr.devices.bindingNotice, /pas une connexion Bluetooth ni physique/);
  assert.match(SHARE_COPY.ar.devices.bindingNotice, /ليس اتصالًا عبر البلوتوث/);
  assert.match(SHARE_COPY.fr.devices.rowBadge, /^Appareil réel · connexion physique non vérifiée$/);
  assert.match(SHARE_COPY.fr.devices.setupStatus, /Non vérifié/);
  assert.match(SHARE_COPY.fr.devices.setupStatus, /Contour/);
  assert.match(SHARE_COPY.ar.devices.setupStatus, /غير متحقَّق منه/);
  assert.match(SHARE_COPY.fr.devices.acknowledge, /J’ai noté le secret — fermer/);
});

test("copy: nothing claims a device is connected", () => {
  const all = JSON.stringify([SHARE_COPY.fr.devices, SHARE_COPY.fr.simulator]);
  assert.doesNotMatch(all, /appareil connecté|connexion (établie|réussie|active)|\bconnected\b/i);
  assert.doesNotMatch(JSON.stringify(SHARE_COPY.ar.devices), /تم الاتصال|متصل الآن/);
});

// ---------------------------------------------------------------------------
// Static: the credential never reaches storage, console, URLs or the runtime context
// ---------------------------------------------------------------------------

const DEVICE_FILES = [
  ...readdirSync(join(process.cwd(), "src", "components", "patient", "devices"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .map((name) => join("src", "components", "patient", "devices", name)),
  join("src", "lib", "client", "devices-api.ts"),
  join("src", "app", "patient", "measure", "devices", "page.tsx"),
];

test("static: device files never log, store, route or link anything", () => {
  assert.ok(DEVICE_FILES.length >= 10, DEVICE_FILES.join(", "));
  for (const file of DEVICE_FILES) {
    const text = source(file);
    assert.doesNotMatch(text, /console\./, `${file}: console`);
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open/, `${file}: storage`);
    assert.doesNotMatch(text, /history\.(push|replace)State|location\.(href|hash|search|assign|replace)|router\.(push|replace)/, `${file}: URL`);
    assert.doesNotMatch(text, /navigator\.clipboard|dangerouslySetInnerHTML|postMessage/, `${file}: leak path`);
  }
});

test("static: no line that handles the credential touches an href, a URL, the outbox or the runtime context", () => {
  for (const file of DEVICE_FILES) {
    const lines = source(file).split("\n");
    lines.forEach((line, index) => {
      if (!/credential/i.test(line)) return;
      assert.doesNotMatch(
        line,
        /href|new URL|searchParams|encodeURIComponent|seg\(|setLastResult|usePatientRuntime|mutate\(|enqueue|outbox|JSON\.stringify/,
        `${file}:${index + 1}`,
      );
    });
  }
});

test("static: the credential is rendered only in CredentialNotice, and only when revealed", () => {
  const renders = DEVICE_FILES.filter((file) => /\{shown\.credential\}|\{secret\.credential\}|\{credential\}/.test(source(file)));
  assert.deepEqual(renders, [join("src", "components", "patient", "devices", "CredentialNotice.tsx")]);
  const notice = source("src", "components", "patient", "devices", "CredentialNotice.tsx");
  assert.match(notice, /shown\.revealed \? \(\s*<code[^>]*translate="no"[^>]*>\s*\{shown\.credential\}/);
});

// ---------------------------------------------------------------------------
// Revoke lifecycle (security review): a revoked binding's secret never stays on screen
// ---------------------------------------------------------------------------

type RevokeResult = { connector: ConnectorView };
const DEVICE_NAME = "esp32-salon";
/** The server's answer to a revoke: same binding ID, disabled, next revision. */
const revokedConnector = (id: string, deviceId = `esp32-${id}`): ConnectorView => ({ ...connector(id, "device"), deviceId, enabled: false, revision: 2 });
const pairedConnector = (id: string, deviceId: string): ConnectorView => ({ ...connector(id, "device"), deviceId });

/** RevokeDialog → ConnectorsCard: only a CURRENT fenced revoke dispatches, with the server's connector ID. */
async function settleRevoke(state: CredentialState, pending: Promise<FencedResult<RevokeResult>>): Promise<CredentialState> {
  const result = await pending;
  return result.status === "current" ? credentialReducer(state, { type: "connector_revoked", connectorId: result.value.connector.id }) : state;
}

test("revoke: a current, confirmed revoke of the SAME server connector wipes its revealed secret immediately", async () => {
  const fence = createAccessFence(FENCE_KEY);
  fence.admitRevision(1);
  const shown = reduce([paired(SECRET, { epoch: fence.epoch() }, "c-1"), { type: "toggle_reveal" }]);
  assert.ok(shown.status === "shown" && shown.revealed && shown.credential === SECRET && shown.connectorId === "c-1");
  const after = await settleRevoke(shown, runFenced(fence, async () => ({ connector: revokedConnector("c-1") })));
  // Assertions in this section never compare secret-bearing objects, so a failure prints no secret.
  assert.equal(after.status, "none");
  // Same scope, fence unchanged: only the revoke cleared it, and nothing can be drawn any more.
  assert.equal(fence.epoch(), shown.scope.epoch);
  assert.ok(visibleCredential(after, scope({ epoch: fence.epoch() })) === null);
});

test("revoke: a confirmed revoke of a DIFFERENT connector leaves the shown secret untouched", async () => {
  const fence = createAccessFence(FENCE_KEY);
  const shown = reduce([paired(SECRET, { epoch: fence.epoch() }, "c-2"), { type: "toggle_reveal" }]);
  const after = await settleRevoke(shown, runFenced(fence, async () => ({ connector: revokedConnector("c-1") })));
  assert.ok(after === shown, "same state object: nothing was cleared");
  assert.ok(after.status === "shown" && after.revealed && after.credential === SECRET);
  assert.ok(visibleCredential(after, scope({ epoch: fence.epoch() })) === after);
});

test("revoke: an old binding's late revoke never erases a NEW pairing of the same device name (different server ID)", async () => {
  const fence = createAccessFence(FENCE_KEY);
  fence.admitRevision(1);
  const here = () => scope({ epoch: fence.epoch() });
  // 1. First pairing of DEVICE_NAME → server binding c-1.
  const first = pairedAction(await runFenced(fence, async (): Promise<PairResult> => ({ connector: pairedConnector("c-1", DEVICE_NAME), credential: SECRET })), here());
  assert.ok(first);
  let state = credentialReducer(NO_CREDENTIAL, first);
  // 2. The patient revokes c-1; the answer is still in flight.
  const heldRevoke = deferred<RevokeResult>();
  const pendingRevoke = runFenced(fence, () => heldRevoke.promise);
  // 3. Meanwhile the same device NAME is paired again → a NEW server binding c-2 with its own secret.
  const second = pairedAction(await runFenced(fence, async (): Promise<PairResult> => ({ connector: pairedConnector("c-2", DEVICE_NAME), credential: SECRET_2 })), here());
  assert.ok(second);
  assert.equal(second.deviceId, first.deviceId, "same reusable name");
  assert.notEqual(second.connectorId, first.connectorId, "different server binding");
  state = credentialReducer(state, second);
  // 4. The old revoke of c-1 completes (current, same fence): the new secret must survive.
  heldRevoke.resolve({ connector: revokedConnector("c-1", DEVICE_NAME) });
  state = await settleRevoke(state, pendingRevoke);
  assert.ok(state.status === "shown" && state.connectorId === "c-2" && state.credential === SECRET_2 && state.deviceId === DEVICE_NAME);
  assert.equal(credentialReducer(state, { type: "toggle_reveal" }).status, "shown", "still revealable");
  // 5. Revoking c-2 itself does clear it.
  state = await settleRevoke(state, runFenced(fence, async () => ({ connector: revokedConnector("c-2", DEVICE_NAME) })));
  assert.equal(state.status, "none");
});

test("revoke: a null replay has no revealable secret; only its own connector's revoke clears it", () => {
  const replay = reduce([paired(null, {}, "c-3"), { type: "toggle_reveal" }]);
  assert.ok(replay.status === "shown" && replay.credential === null && replay.revealed === false);
  assert.ok(credentialReducer(replay, { type: "connector_revoked", connectorId: "c-1" }) === replay, "another binding's revoke keeps it");
  assert.equal(credentialReducer(replay, { type: "connector_revoked", connectorId: "c-3" }).status, "none");
  assert.ok(credentialReducer(NO_CREDENTIAL, { type: "connector_revoked", connectorId: "c-3" }) === NO_CREDENTIAL);
});

test("pairing: an answer without a server connector ID shows no secret (it could never be matched to a revoke)", async () => {
  const fence = createAccessFence(FENCE_KEY);
  const result = await runFenced(fence, async (): Promise<PairResult> => ({ connector: { ...connector("c-1", "device"), id: "" }, credential: SECRET }));
  assert.ok(pairedAction(result, scope()) === null);
});

test("revoke: a stale result adds nothing; a failed revoke keeps the existing policy", async () => {
  // Stale: access moved while the revoke was in flight. The result is discarded; the fence move
  // itself (existing policy) is what wipes the secret, through the fence subscription.
  const moving = createAccessFence(FENCE_KEY);
  moving.admitRevision(1);
  let state = reduce([paired(SECRET, { epoch: moving.epoch() }, "c-1")]);
  const unsubscribe = moving.subscribe(() => {
    state = credentialReducer(state, { type: "fence_moved" });
  });
  const held = deferred<RevokeResult>();
  const pending = runFenced(moving, () => held.promise);
  moving.admitRevision(2);
  held.resolve({ connector: revokedConnector("c-1") });
  // Even with a MATCHING connector ID, a stale result never dispatches.
  const untouched = reduce([paired(SECRET, {}, "c-1")]);
  assert.ok((await settleRevoke(untouched, pending)) === untouched, "a stale revoke result never dispatches");
  unsubscribe();
  assert.equal(state.status, "none", "cleared by the fence move, as before");

  // Failed (e.g. 409 stale revision): no result reaches onRevoked, so the secret stays until acknowledged.
  const failing = createAccessFence(FENCE_KEY);
  const kept = reduce([paired(SECRET, { epoch: failing.epoch() }, "c-1")]);
  await assert.rejects(settleRevoke(kept, runFenced(failing, async (): Promise<RevokeResult> => Promise.reject(new Error("STALE_REVISION")))));
  assert.equal(kept.status, "shown");
});

test("static: RevokeDialog reports only current results, and ConnectorsCard clears by the returned server connector ID", () => {
  const rows = source("src", "components", "patient", "devices", "ConnectorRows.tsx");
  assert.match(rows, /if \(result\.status === "current"\) \{[^}]*onRevoked\(result\.value\.connector\)/);
  const card = source("src", "components", "patient", "devices", "ConnectorsCard.tsx");
  const handler = card.slice(card.indexOf("onRevoked={(connector) => {"));
  const dispatchLine = 'dispatch({ type: "connector_revoked", connectorId: connector.id })';
  assert.ok(handler.length > 0 && handler.indexOf(dispatchLine) > 0, "dispatches the server's connector ID");
  assert.ok(handler.indexOf(dispatchLine) < handler.indexOf("reload()"), "wiped before the list reloads");
  assert.doesNotMatch(handler.slice(0, handler.indexOf("reload()")), /connectorId: connector\.deviceId/, "never the reusable device name");
});
