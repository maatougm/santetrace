import assert from "node:assert/strict";
import { after, test } from "node:test";
import { acceptDemoActor, demoHomePath, enabledDemoRoles } from "../src/components/auth/demo-login";
import { getDemoLoginRoles, postDemoLogin } from "../src/lib/client/demo-login-api";

// Unit environment only: fetch is stubbed, no server or browser is involved.
const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

type Captured = { url: string; method: string; body: string | null };

function stubFetch(status: number, payload: unknown, captured: Captured[] = []): Captured[] {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return captured;
}

test("only the roles the server enables become buttons, in a fixed order, without duplicates", () => {
  assert.deepEqual(enabledDemoRoles({ enabled: true, roles: ["clinician", "patient"] }), ["patient", "clinician"]);
  assert.deepEqual(enabledDemoRoles({ enabled: true, roles: ["clinician"] }), ["clinician"]);
  assert.deepEqual(enabledDemoRoles({ roles: ["patient", "patient", "admin"] }), ["patient"]);
  assert.deepEqual(enabledDemoRoles({ enabled: false, roles: ["patient", "clinician"] }), [], "disabled feature: no buttons");
});

test("a malformed or unknown answer shows nothing", () => {
  for (const payload of [null, undefined, "patient", 42, [], {}, { roles: "patient" }, { roles: [1, null] }, { enabled: "yes", roles: ["patient"] }]) {
    assert.deepEqual(enabledDemoRoles(payload), [], JSON.stringify(payload));
  }
});

test("each role routes to its own space, and a mismatched actor is refused", () => {
  assert.equal(demoHomePath("patient"), "/patient");
  assert.equal(demoHomePath("clinician"), "/doctor");
  const actor = { id: "a", role: "clinician" as const, displayName: "Dr Démo", patientId: null };
  assert.deepEqual(acceptDemoActor("clinician", { actor }), actor);
  assert.equal(acceptDemoActor("patient", { actor }), null, "asked for patient, got a clinician");
  assert.equal(acceptDemoActor("patient", { actor: { id: "a" } }), null);
  assert.equal(acceptDemoActor("patient", {}), null);
});

test("GET reads the enabled roles; a failure or disabled feature yields no roles", async () => {
  const calls = stubFetch(200, { enabled: true, roles: ["patient", "clinician"] });
  assert.deepEqual(await getDemoLoginRoles(), ["patient", "clinician"]);
  assert.equal(calls[0].url, "/api/care/demo-login");
  assert.equal(calls[0].method, "GET");
  stubFetch(404, { error: { code: "NOT_FOUND", message: "x" } });
  assert.deepEqual(await getDemoLoginRoles(), []);
  stubFetch(200, { enabled: false, roles: [] });
  assert.deepEqual(await getDemoLoginRoles(), []);
});

test("POST sends exactly {role} and never any credential", async () => {
  const actor = { id: "p", role: "patient", displayName: "Patient démo", patientId: "nadia" };
  const calls = stubFetch(200, { actor });
  const result = await postDemoLogin("patient");
  assert.deepEqual(result, actor);
  assert.equal(calls[0].url, "/api/care/demo-login");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(JSON.parse(calls[0].body ?? "null"), { role: "patient" });
  assert.doesNotMatch(calls[0].body ?? "", /password|login|token/i);
});

test("a POST answer for another role is rejected, not admitted", async () => {
  stubFetch(200, { actor: { id: "d", role: "clinician", displayName: "Dr", patientId: null } });
  await assert.rejects(postDemoLogin("patient"));
});
