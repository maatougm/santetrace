import test from "node:test";
import assert from "node:assert/strict";
import * as interventions from "../src/lib/intervention-service";
import { InterventionService } from "../src/lib/intervention-service";
import { currentGuard, PatientAccessService } from "../src/lib/patient-access-service";
import { SHARING_SCOPES } from "../src/contracts/patient-platform";
import type { Actor } from "../src/contracts/care";
import type { ReusableProtocol } from "../src/contracts/monitoring";
import { fixtureStore, testOwner, testDoctor } from "./helpers/care-fixture";
const now = "2026-10-11T12:00:00.000Z";
const secondary: Actor = { ...testDoctor, id: "secondary" };
function setup() {
  const store = fixtureStore();
  store.transaction(s => s.careGrants.push({ ...s.careGrants[0], id: "grant:secondary", clinicianId: "secondary", relationship: "specialist", scopes: ["messages"] }));
  return { store, service: new InterventionService(store, () => now) };
}
const message = { text: "Mes douleurs ont changé.", kind: "clinical" as const, clinicianId: testDoctor.id, clientId: "message-1" };

test("real clinician message reaches owner and each physician sees only their own thread", () => {
  const { store, service } = setup(); try {
    const first = service.sendMessage(testDoctor, "fatma", message);
    service.sendMessage(secondary, "fatma", { ...message, clinicianId: secondary.id, text: "Autre conversation", clientId: "secondary-message" });
    assert.equal(service.listMessages(testOwner, "fatma", testDoctor.id).messages[0].id, first.id);
    assert.equal(service.listMessages(testDoctor, "fatma").messages.length, 1);
    assert.equal(service.listMessages(secondary, "fatma").messages.length, 1);
    assert.throws(() => service.listMessages(secondary, "fatma", testDoctor.id));
    assert.throws(() => service.sendMessage(secondary, "fatma", message));
  } finally { store.close(); }
});

test("patient text cannot bypass unassessed clinical context by claiming administrative kind", () => {
  const { store, service } = setup(); try {
    store.transaction(s => s.protocols.push({ id: "repeat", patientId: "fatma", revision: 1, state: "active" } as ReusableProtocol));
    const sent = service.sendMessage(testOwner, "fatma", { ...message, kind: "administrative" });
    assert.equal(sent.kind, "clinical"); assert.equal(sent.review, null);
    assert.equal(currentGuard(store.read(), "fatma").contextRevision, 1);
    assert.equal(store.read().protocols[0].state, "suspended");
    const retry = service.sendMessage(testOwner, "fatma", { ...message, kind: "administrative" });
    assert.equal(retry.id, sent.id); assert.equal(currentGuard(store.read(), "fatma").contextRevision, 1);
  } finally { store.close(); }
});

test("clinician clinical instructions suspend previous protocol context while administrative text does not", () => {
  const { store, service } = setup(); try {
    store.transaction(s => s.protocols.push({ id: "repeat", patientId: "fatma", revision: 1, state: "active" } as ReusableProtocol));
    service.sendMessage(testDoctor, "fatma", { ...message, kind: "administrative", text: "Rendez-vous confirmé", clientId: "admin" });
    assert.equal(store.read().protocols[0].state, "active");
    service.sendMessage(testDoctor, "fatma", { ...message, text: "Le traitement est revu", clientId: "clinical" });
    assert.equal(store.read().protocols[0].state, "suspended");
    assert.equal(currentGuard(store.read(), "fatma").contextRevision, 1);
  } finally { store.close(); }
});

test("message replay and read fail immediately after named grant revocation", () => {
  const { store, service } = setup(); try {
    const sent = service.sendMessage(testOwner, "fatma", message);
    store.transaction(s => { s.careGrants[0].state = "revoked"; });
    assert.throws(() => service.sendMessage(testOwner, "fatma", message));
    assert.throws(() => service.markRead(testDoctor, sent.id, { clientId: "read" }));
    assert.throws(() => service.listMessages(testDoctor, "fatma"));
  } finally { store.close(); }
});

test("read receipt is separate from clinical review and only recipient may acknowledge reading", () => {
  const { store, service } = setup(); try {
    const sent = service.sendMessage(testOwner, "fatma", message);
    assert.throws(() => service.markRead(testOwner, sent.id, { clientId: "author-read" }));
    const read = service.markRead(testDoctor, sent.id, { clientId: "read" });
    assert.equal(read.readAt, now); assert.equal(read.review, null);
    assert.equal(read.revision, sent.revision);
    assert.deepEqual(service.markRead(testDoctor, sent.id, { clientId: "read" }), read);
  } finally { store.close(); }
});

test("primary reviews current medical context without reactivating suspended protocol", () => {
  const { store, service } = setup(); try {
    store.transaction(s => s.protocols.push({ id: "repeat", patientId: "fatma", revision: 1, state: "active" } as ReusableProtocol));
    const sent = service.sendMessage(testOwner, "fatma", message);
    const body = { expectedRevision: sent.revision, expectedGuard: currentGuard(store.read(), "fatma"), reason: "Message examiné", clientId: "review" };
    assert.throws(() => service.reviewMessage(secondary, sent.id, body));
    const reviewed = service.reviewMessage(testDoctor, sent.id, body);
    assert.equal(reviewed.review?.clinicianId, testDoctor.id); assert.equal(reviewed.readAt, null);
    assert.equal(reviewed.revision, sent.revision + 1); assert.equal(store.read().protocols[0].state, "suspended");
    assert.equal(currentGuard(store.read(), "fatma").contextRevision, 1);
  } finally { store.close(); }
});

test("stale clinical review is rejected and cannot clear new unassessed message", () => {
  const { store, service } = setup(); try {
    const sent = service.sendMessage(testOwner, "fatma", message); const guard = currentGuard(store.read(), "fatma");
    service.sendMessage(testOwner, "fatma", { ...message, text: "Nouvelle douleur", clientId: "new" });
    assert.throws(() => service.reviewMessage(testDoctor, sent.id, { expectedRevision: sent.revision, expectedGuard: guard, reason: "Ancien", clientId: "stale-review" }), (e: unknown) => Boolean(e && typeof e === "object" && "status" in e && e.status === 409));
    assert.equal(store.read().messages[0].review, null);
  } finally { store.close(); }
});

test("plain text stays text and invalid lengths, controls and authority fields are rejected", () => {
  const { store, service } = setup(); try {
    const text = "<script>alert('x')</script>";
    assert.equal(service.sendMessage(testDoctor, "fatma", { ...message, text }).text, text);
    for (const text of [" ", "x".repeat(2001), "a\u0000b"]) assert.throws(() => service.sendMessage(testOwner, "fatma", { ...message, text, clientId: "bad" }));
    assert.throws(() => service.sendMessage(testOwner, "fatma", { ...message, reviewed: true } as never));
    assert.equal(store.read().messages.length, 1);
  } finally { store.close(); }
});

test("cursor pagination returns later messages without skipping or exposing another thread", () => {
  const { store, service } = setup(); try {
    for (let i = 0; i < 52; i++) service.sendMessage(testDoctor, "fatma", { ...message, text: `Message ${i}`, clientId: `msg-${i}` });
    const page = service.listMessages(testOwner, "fatma", testDoctor.id); assert.equal(page.messages.length, 50); assert.ok(page.nextCursor);
    const next = service.listMessages(testOwner, "fatma", testDoctor.id, page.nextCursor!); assert.equal(next.messages.length, 2); assert.equal(next.nextCursor, null);
    assert.throws(() => service.listMessages(testOwner, "fatma", testDoctor.id, "forged-cursor"));
  } finally { store.close(); }
});

test("call lifecycle is request and attributable report, never connected state", () => {
  const { store, service } = setup(); try {
    const requested = service.requestContact(testOwner, "fatma", { clinicianId: testDoctor.id, clientId: "call" });
    assert.equal(requested.state, "requested"); assert.equal(service.requestContact(testOwner, "fatma", { clinicianId: testDoctor.id, clientId: "call" }).id, requested.id);
    assert.throws(() => service.updateContact(testOwner, requested.id, { action: "acknowledge", expectedRevision: 1, reason: "Lu", clientId: "patient-ack" }));
    const ack = service.updateContact(testDoctor, requested.id, { action: "acknowledge", expectedRevision: 1, reason: "Demande reçue", clientId: "ack" });
    assert.equal(ack.state, "acknowledged");
    const reported = service.updateContact(testOwner, requested.id, { action: "contact_reported", expectedRevision: ack.revision, reason: "Nous avons parlé", clientId: "report" });
    assert.equal(reported.state, "contact_reported"); assert.equal(reported.history.at(-1)?.authorId, testOwner.id);
    assert.equal(service.listContacts(secondary, "fatma").contacts.length, 0);
    assert.throws(() => service.updateContact(testDoctor, requested.id, { action: "connected", expectedRevision: reported.revision, reason: "Transport", clientId: "fake" } as never));
  } finally { store.close(); }
});

test("contact updates reject stale decisions and revoked idempotent replay", () => {
  const { store, service } = setup(); try {
    const request = service.requestContact(testOwner, "fatma", { clinicianId: testDoctor.id, clientId: "call" });
    const body = { action: "cancel" as const, expectedRevision: request.revision, reason: "Annuler", clientId: "cancel" };
    const cancelled = service.updateContact(testOwner, request.id, body); assert.equal(cancelled.state, "cancelled"); assert.deepEqual(service.updateContact(testOwner, request.id, body), cancelled);
    assert.throws(() => service.updateContact(testDoctor, request.id, { ...body, action: "contact_reported", clientId: "later" }));
    store.transaction(s => { s.careGrants[0].state = "revoked"; });
    assert.throws(() => service.updateContact(testOwner, request.id, body));
  } finally { store.close(); }
});
test("enabled owner keeps historical messages and contact records after doctor revocation and consent withdrawal", () => {
  const { store, service } = setup(); try {
    const sent = service.sendMessage(testDoctor, "fatma", message), contact = service.requestContact(testOwner, "fatma", { clinicianId: testDoctor.id, clientId: "history-contact" });
    store.transaction(s => { s.careGrants[0].state = "revoked"; });
    assert.equal(service.listMessages(testOwner, "fatma", testDoctor.id).messages[0].id, sent.id); assert.equal(service.listContacts(testOwner, "fatma").contacts[0].id, contact.id);
    assert.throws(() => service.listMessages(testDoctor, "fatma"));
    store.transaction(s => { s.patients[0].consent = false; });
    assert.equal(service.listMessages(testOwner, "fatma").messages.length, 1); assert.equal(service.listContacts(testOwner, "fatma").contacts.length, 1);
    assert.throws(() => service.sendMessage(testOwner, "fatma", { ...message, clientId: "new-after-withdrawal" }));
    assert.throws(() => service.requestContact(testOwner, "fatma", { clinicianId: testDoctor.id, clientId: "new-after-withdrawal" }));
  } finally { store.close(); }
});
test("private secondary message is explicitly forwarded by owner for primary review without exposing the whole thread", () => {
  const { store, service } = setup(); try {
    store.transaction(s => s.protocols.push({ id: "repeat", patientId: "fatma", revision: 1, state: "active" } as ReusableProtocol));
    const original = service.sendMessage(testOwner, "fatma", { ...message, clinicianId: secondary.id, clientId: "private-medical" });
    service.sendMessage(secondary, "fatma", { ...message, clinicianId: secondary.id, text: "Réponse privée", clientId: "private-reply" });
    assert.equal(service.listMessages(testDoctor, "fatma").messages.length, 0);
    const forwarded = service.forwardMessage(testOwner, original.id, { clinicianId: testDoctor.id, clientId: "forward" });
    assert.equal(forwarded.forwardedFromMessageId, original.id); assert.equal(forwarded.forwardedFromMessageRevision, original.revision); assert.equal(forwarded.text, original.text); assert.equal(forwarded.authorCategory, "patient");
    assert.equal(service.forwardMessage(testOwner, original.id, { clinicianId: testDoctor.id, clientId: "forward" }).id, forwarded.id);
    assert.equal(service.forwardMessage(testOwner, original.id, { clinicianId: testDoctor.id, clientId: "another-forward" }).id, forwarded.id, "different retry ID still does not duplicate copied medical context");
    assert.equal(service.listMessages(testDoctor, "fatma").messages.length, 1); assert.equal(store.read().messages.find(m => m.id === original.id)?.review, null);
    const reviewed = service.reviewMessage(testDoctor, forwarded.id, { expectedRevision: forwarded.revision, expectedGuard: currentGuard(store.read(), "fatma"), reason: "Contenu transmis revu", clientId: "forward-review" });
    assert.equal(reviewed.review?.clinicianId, testDoctor.id); assert.equal(store.read().messages.find(m => m.id === original.id)?.review?.clinicianId, testDoctor.id);
    assert.equal(store.read().protocols[0].state, "suspended"); assert.equal(store.read().messages.filter(m => m.authorCategory === "patient" && m.kind === "clinical" && !m.review).length, 0);
    assert.equal(service.listMessages(testDoctor, "fatma").messages.length, 1);
  } finally { store.close(); }
});
test("forwarding rejects doctor requests, wrong patient, nonprimary target, forged fields and withdrawal", () => {
  const { store, service } = setup(); try {
    const original = service.sendMessage(testOwner, "fatma", { ...message, clinicianId: secondary.id });
    const input = { clinicianId: testDoctor.id, clientId: "forward" };
    assert.throws(() => service.forwardMessage(testDoctor, original.id, input)); assert.throws(() => service.forwardMessage({ ...testOwner, patientId: "ahmed" }, original.id, input));
    assert.throws(() => service.forwardMessage(testOwner, original.id, { ...input, clinicianId: secondary.id }));
    assert.throws(() => service.forwardMessage(testOwner, original.id, { ...input, forwardedFromMessageId: "forged" } as never));
    store.transaction(s => { s.patients[0].consent = false; }); assert.throws(() => service.forwardMessage(testOwner, original.id, input)); assert.equal(store.read().messages.length, 1);
  } finally { store.close(); }
});
test("forwarded review fails if the original source revision or content no longer matches", () => {
  for (const changeRevision of [true, false]) { const { store, service } = setup(); try {
    const original = service.sendMessage(testOwner, "fatma", { ...message, clinicianId: secondary.id });
    const forwarded = service.forwardMessage(testOwner, original.id, { clinicianId: testDoctor.id, clientId: "forward" });
    store.transaction(s => { const source = s.messages.find(m => m.id === original.id)!; if (changeRevision) source.revision++; else source.text = "Autre contenu"; });
    assert.throws(() => service.reviewMessage(testDoctor, forwarded.id, { expectedRevision: forwarded.revision, expectedGuard: currentGuard(store.read(), "fatma"), reason: "Revue", clientId: "stale-copy" }));
    assert.equal(store.read().messages.find(m => m.id === original.id)?.review, null); assert.equal(store.read().messages.find(m => m.id === forwarded.id)?.review, null);
  } finally { store.close(); } }
});
test("forward replay checks original source revision and never returns an outdated copied message", () => {
  const { store, service } = setup(); try {
    const original = service.sendMessage(testOwner, "fatma", { ...message, clinicianId: secondary.id });
    const input = { clinicianId: testDoctor.id, clientId: "forward" };
    service.forwardMessage(testOwner, original.id, input);
    store.transaction(s => { s.messages.find(m => m.id === original.id)!.revision++; });
    assert.throws(() => service.forwardMessage(testOwner, original.id, input));
    assert.throws(() => service.forwardMessage(testOwner, original.id, { ...input, clientId: "different-key" }));
    assert.equal(store.read().messages.length, 2);
  } finally { store.close(); }
});
test("forward replay after a successful matching review returns current attribution without a second context mutation", () => {
  const { store, service } = setup(); try {
    const original = service.sendMessage(testOwner, "fatma", { ...message, clinicianId: secondary.id });
    const input = { clinicianId: testDoctor.id, clientId: "forward" }, copy = service.forwardMessage(testOwner, original.id, input), guard = currentGuard(store.read(), "fatma");
    service.reviewMessage(testDoctor, copy.id, { expectedRevision: copy.revision, expectedGuard: guard, reason: "Revue explicite", clientId: "review" });
    const replay = service.forwardMessage(testOwner, original.id, input); assert.equal(replay.review?.clinicianId, testDoctor.id); assert.equal(replay.revision, 2); assert.deepEqual(currentGuard(store.read(), "fatma"), guard); assert.equal(store.read().messages.length, 2);
  } finally { store.close(); }
});
test("same source reviewed through replacement primary does not leave an orphan copy as new unassessed context", () => {
  const { store, service } = setup(); try {
    assert.equal(typeof interventions.hasUnassessedClinicalContext, "function", "clinical context must distinguish validated copies from distinct source versions");
    const next = { ...testDoctor, id: "next-primary" }, access = new PatientAccessService(store, () => Date.parse(now));
    store.transaction(s => s.accounts.push({ ...next, login: "next.primary", passwordHash: "test-only", enabled: true, sessionVersion: 1, createdAt: now }));
    const original = service.sendMessage(testOwner, "fatma", { ...message, clinicianId: secondary.id, clientId: "private" });
    const oldCopy = service.forwardMessage(testOwner, original.id, { clinicianId: testDoctor.id, clientId: "old-primary-forward" });
    access.update(testOwner, "grant:fatma", { action: "revoke", expectedRevision: 1, clientId: "revoke-old" });
    const issued = access.issue(testOwner, "fatma", { targetClinicianId: next.id, relationship: "primary", scopes: [...SHARING_SCOPES], clientId: "next-primary-grant" });
    access.accept(next, { token: issued.invitationToken!, clientId: "next-primary-accept" });
    const newCopy = service.forwardMessage(testOwner, original.id, { clinicianId: next.id, clientId: "next-primary-forward" });
    service.reviewMessage(next, newCopy.id, { expectedRevision: newCopy.revision, expectedGuard: currentGuard(store.read(), "fatma"), reason: "Revue du contenu transmis exact", clientId: "new-primary-review" });
    assert.equal(store.read().messages.find(m => m.id === oldCopy.id)?.review, null, "the old physician must not acquire a fictitious review marker");
    assert.equal(interventions.hasUnassessedClinicalContext(store.read(), "fatma"), false);
    service.sendMessage(testOwner, "fatma", { ...message, clinicianId: secondary.id, text: "Autre nouveau symptôme", clientId: "unrelated" });
    assert.equal(interventions.hasUnassessedClinicalContext(store.read(), "fatma"), true, "unrelated clinical text still needs an explicit review");
  } finally { store.close(); }
});
test("an orphan copy with a changed source version or forged source binding cannot borrow another review", () => {
  const { store, service } = setup(); try {
    assert.equal(typeof interventions.hasUnassessedClinicalContext, "function");
    const original = service.sendMessage(testOwner, "fatma", { ...message, clinicianId: secondary.id });
    const copy = service.forwardMessage(testOwner, original.id, { clinicianId: testDoctor.id, clientId: "forward" });
    service.reviewMessage(testDoctor, copy.id, { expectedRevision: 1, expectedGuard: currentGuard(store.read(), "fatma"), reason: "Revue exacte", clientId: "review" });
    store.transaction(s => s.messages.push({ ...copy, id: "orphan", clinicianId: "former-primary", review: null, forwardedFromMessageRevision: original.revision + 1 }));
    assert.equal(interventions.hasUnassessedClinicalContext(store.read(), "fatma"), true);
    store.transaction(s => { s.messages.find(m => m.id === "orphan")!.forwardedFromMessageRevision = original.revision; s.messages.find(m => m.id === "orphan")!.text = "Different source content"; });
    assert.equal(interventions.hasUnassessedClinicalContext(store.read(), "fatma"), true);
  } finally { store.close(); }
});
