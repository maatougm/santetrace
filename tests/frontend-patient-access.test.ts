import assert from "node:assert/strict";
import test from "node:test";
import { toRegistration, validateRegistration, type RegistrationDraft } from "../src/components/auth/account-validation";
import { readClaimCode } from "../src/lib/client/config";
import { ACCESS_COPY } from "../src/lib/client/copy/access";
import { invitationLink, missingScopeDependencies, scopesForRelationship } from "../src/lib/client/grants-api";
import { isFullProposal, suggestProfileBindings, toPatientProposalStatus } from "../src/lib/client/care-api";
import { isNavActive } from "../src/components/layout/nav";
import { describeApiError, withQuery, ApiError } from "../src/lib/client/transport";
import { absoluteShareUrl, readGuestToken } from "../src/lib/client/share-api";

const copy = ACCESS_COPY.fr.auth;
const valid: RegistrationDraft = {
  login: "  Amina.Demo ",
  password: "correct horse battery",
  passwordConfirm: "correct horse battery",
  displayName: "Amina (fictive)",
  region: "Sfax",
  age: "54",
  language: "ar",
  consent: true,
  fictional: true,
  claimCode: "",
};

test("registration body is exactly the public contract: no role, patient, clinician or verification field", () => {
  const body = toRegistration(valid, "account-1");
  assert.deepEqual(Object.keys(body).sort(), ["age", "clientId", "consent", "displayName", "fictionalDemo", "language", "login", "password", "region"]);
  assert.equal(body.login, "amina.demo");
  assert.equal(body.consent, true);
  assert.equal(body.fictionalDemo, true);
  assert.equal(toRegistration({ ...valid, claimCode: " abc " }, "c").claimCode, "abc");
});

test("registration validation: consent and fictional-only are required, age 18..120, login pattern, password 12..128", () => {
  assert.deepEqual(validateRegistration(valid, copy), {});
  const errors = validateRegistration({ ...valid, consent: false, fictional: false, age: "17", login: "a b", password: "short", passwordConfirm: "x" }, copy);
  assert.equal(errors.consent, copy.consentRequired);
  assert.equal(errors.fictional, copy.fictionalRequired);
  assert.equal(errors.age, copy.invalidAge);
  assert.equal(errors.login, copy.invalidLogin);
  assert.equal(errors.password, copy.invalidPassword);
  assert.equal(errors.passwordConfirm, copy.passwordMismatch);
});

test("claim code is read from the fragment only (claim= or legacy code=)", () => {
  assert.equal(readClaimCode("#claim=ABC123"), "ABC123");
  assert.equal(readClaimCode("#code=XYZ"), "XYZ");
  assert.equal(readClaimCode(""), null);
  assert.equal(readClaimCode("#other=1"), null);
});

test("guest token: the server's canonical '/share#<43-char raw token>' fragment is read; previews of other shapes are not", () => {
  const raw = "A".repeat(20) + "b-_9".repeat(5) + "xyz"; // 43 base64url characters
  assert.equal(raw.length, 43);
  const url = absoluteShareUrl("http://127.0.0.1:3011", `/share#${raw}`);
  assert.equal(url, `http://127.0.0.1:3011/share#${raw}`);
  assert.equal(readGuestToken(new URL(url).hash), raw);
  assert.equal(readGuestToken(`#token=${raw}`), raw);
  assert.equal(readGuestToken("#"), null);
  assert.equal(readGuestToken("#short"), null);
  assert.equal(readGuestToken("#a b c"), null);
});

test("scope rules: primary gets every scope; summary/alerts need status+measurements+clinical+documents", () => {
  assert.deepEqual(scopesForRelationship("primary", []), ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"]);
  assert.deepEqual(scopesForRelationship("specialist", ["documents", "measurements"]), ["measurements", "documents"]);
  assert.deepEqual(missingScopeDependencies(["summary", "measurements"]), ["status", "clinical", "documents"]);
  assert.deepEqual(missingScopeDependencies(["measurements", "documents"]), []);
});

test("invitation link carries the token in the fragment, never in the query or path", () => {
  const link = invitationLink("http://127.0.0.1:3001", "tok_123");
  const url = new URL(link);
  assert.equal(url.search, "");
  assert.equal(url.pathname, "/doctor/invitations");
  assert.equal(url.hash, "#invitation=tok_123");
});

test("patient proposal view keeps only id/revision/kind/state even if a full draft leaks", () => {
  const leaked = {
    id: "p1",
    patientId: "x",
    revision: 2,
    kind: "lab_exam" as const,
    state: "pending" as const,
    action: { templateId: "exam.clinician_review", templateVersion: 1, parameters: { exam: "HbA1c" } },
    sources: [],
    guard: { contextRevision: 1, evidenceRevision: 1, authorityRevision: 1, carePlanRevision: 0, profileVersions: [] },
    decision: null,
    history: [],
  };
  assert.equal(isFullProposal(leaked), true);
  const view = toPatientProposalStatus(leaked);
  assert.deepEqual(view, { id: "p1", revision: 2, kind: "lab_exam", state: "pending" });
  assert.equal(isFullProposal(view), false);
});

test("profile binding suggestions only for current affirmed hypertension/diabetes facts, and only with known rules", () => {
  const fact = (id: string, code: string | null, polarity: "affirmed" | "unknown", supersededBy: string | null = null) => ({
    id, patientId: "p", kind: "condition" as const, code, label: id, value: null, polarity, verification: "patient_reported" as const, sources: [], revision: 1, createdAt: "x", supersededBy,
  });
  const facts = [fact("f1", "hypertension", "affirmed"), fact("f2", "diabetes", "unknown"), fact("f3", "asthma", "affirmed"), fact("f4", "diabetes", "affirmed", "f5")];
  assert.deepEqual(suggestProfileBindings(facts, "demo-2"), [{ conditionFactId: "f1", profileId: "demo_blood_pressure", profileVersion: "demo-2" }]);
  assert.deepEqual(suggestProfileBindings(facts, null), []);
});

test("grouped patient nav keeps existing URLs and highlights their group", () => {
  const record = { href: "/patient/record", label: "Dossier", icon: "file-text" as const, matches: ["/patient/documents", "/patient/share"] };
  assert.equal(isNavActive("/patient/documents", record), true);
  assert.equal(isNavActive("/patient/share", record), true);
  assert.equal(isNavActive("/patient/measure", record), false);
  assert.equal(isNavActive("/patient", { href: "/patient", label: "Suivi", icon: "home", exact: true }), true);
  assert.equal(isNavActive("/patient/plan", { href: "/patient", label: "Suivi", icon: "home", exact: true }), false);
});

test("transport helpers: query building skips empty values; 503 is described as busy, not success", () => {
  assert.equal(withQuery("/x", { cursor: null, limit: 50, after: "" }), "/x?limit=50");
  const busy = describeApiError(new ApiError({ status: 503, code: "AUTH_BUSY", kind: "http", message: "busy" }), "ar");
  assert.equal(busy.code, "AUTH_BUSY");
  assert.match(busy.message, /لم يُسجَّل/);
});
