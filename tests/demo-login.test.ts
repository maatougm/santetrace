import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { CareStore } from "../src/lib/care-store";
import { createDemoLoginHandler } from "../src/lib/demo-login";
import { resolveSessionActor } from "../src/lib/care-session";
import { PublicCredentialThrottle } from "../src/lib/care-http";

const patientId = "6ba1ee80-c835-403e-af9f-7908b67b7ea2";
const keys = ["APP_ORIGIN", "SESSION_SECRET", "HACKCURE_DEMO_QUICK_LOGIN_ENABLED"];
const old = keys.map(key => process.env[key]);
before(() => { process.env.APP_ORIGIN = "http://localhost:3012"; process.env.SESSION_SECRET = "synthetic-demo-login-test-secret"; delete process.env.HACKCURE_DEMO_QUICK_LOGIN_ENABLED; });
after(() => keys.forEach((key, index) => old[index] === undefined ? delete process.env[key] : process.env[key] = old[index]));
function fixture() {
  const store = new CareStore(":memory:");
  store.transaction(state => {
    state.patients.push({ ...state.patients[0], id: patientId, displayName: "Fictional QA Patient" });
    const createdAt = new Date().toISOString();
    state.accounts.push(
      { id: "qa-patient-principal", role: "patient", patientId, login: "qa.patient.day.0240", displayName: "Fictional QA Patient", passwordHash: "unused", enabled: true, sessionVersion: 1, createdAt },
      { id: "demo-clinician", role: "clinician", patientId: null, login: "medecin.ref", displayName: "Fictional QA Doctor", passwordHash: "unused", enabled: true, sessionVersion: 1, createdAt },
    );
    state.doctorProfiles.push({ id: "demo-clinician", displayName: "Fictional QA Doctor", specialty: "Demo", fictional: true });
  });
  return store;
}
const request = (body: unknown, origin: string | null = "http://localhost:3012") => new Request("http://localhost:3012/api/care/demo-login", {
  method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
});
test("disabled by default hides roles and refuses password-free sessions", async () => {
  const store = fixture(); try {
    const handler = createDemoLoginHandler(store), before = store.read();
    assert.deepEqual(await (await handler(new Request("http://localhost:3012/api/care/demo-login"))).json(), { enabled: false, roles: [] });
    const response = await handler(request({ role: "patient" }));
    assert.equal(response.status, 404); assert.equal(response.headers.has("set-cookie"), false);
    assert.deepEqual(store.read(), before);
  } finally { store.close(); }
});
test("enabled fixed fictional roles receive ordinary revocable HttpOnly sessions without account writes", async () => {
  const store = fixture(); try {
    const now = Date.now(), before = store.read(), handler = createDemoLoginHandler(store, { enabled: () => true, clock: () => now });
    assert.deepEqual(await (await handler(new Request("http://localhost:3012/api/care/demo-login"))).json(), { enabled: true, roles: ["patient", "clinician"] });
    for (const role of ["patient", "clinician"] as const) {
      const response = await handler(request({ role })), value = await response.json();
      assert.equal(response.status, 200); assert.equal(value.actor.role, role);
      assert.equal(value.actor.patientId, role === "patient" ? patientId : null);
      const cookie = response.headers.get("set-cookie")!;
      assert.match(cookie, /HttpOnly; SameSite=Strict/);
      assert.equal(resolveSessionActor(new Request("http://localhost:3012/api/session", { headers: { cookie } }), store, now)?.id, value.actor.id);
      assert.equal(JSON.stringify(value).includes("password"), false);
    }
    assert.deepEqual(store.read(), before);
  } finally { store.close(); }
});
test("arbitrary account IDs, passwords, extra keys, unknown roles and absent or cross-site origins are refused", async () => {
  const store = fixture(); try {
    const handler = createDemoLoginHandler(store, { enabled: () => true });
    for (const body of [{ role: "admin" }, { role: "patient", id: "fatma" }, { role: "clinician", password: "x" }, {}]) {
      const response = await handler(request(body)); assert.equal(response.status, 400); assert.equal(response.headers.has("set-cookie"), false);
    }
    for (const origin of [null, "https://evil.example"]) assert.equal((await handler(request({ role: "patient" }, origin))).status, 403);
  } finally { store.close(); }
});
test("disabled accounts, missing fixed identity and mixed real records never permit quick login", async () => {
  for (const mutate of [
    (store: CareStore) => store.transaction(state => { state.accounts[0].enabled = false; }),
    (store: CareStore) => store.transaction(state => { state.accounts[0].patientId = "fatma"; }),
    (store: CareStore) => store.transaction(state => { (state.patients[0] as unknown as { fictional: boolean }).fictional = false; }),
    (store: CareStore) => store.transaction(state => { state.patients.find(patient => patient.id === patientId)!.consent = false; }),
  ]) {
    const store = fixture(); try { mutate(store); const response = await createDemoLoginHandler(store, { enabled: () => true })(request({ role: "patient" })); assert.equal(response.status, 404); assert.equal(response.headers.has("set-cookie"), false); } finally { store.close(); }
  }
});
test("successful quick logins consume a bounded credential attempt budget", async () => {
  const store = fixture(); try {
    const handler = createDemoLoginHandler(store, { enabled: () => true, throttle: new PublicCredentialThrottle(() => 10, 1) });
    assert.equal((await handler(request({ role: "patient" }))).status, 200);
    const response = await handler(request({ role: "patient" }));
    assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.equal(response.headers.has("set-cookie"), false);
  } finally { store.close(); }
});
