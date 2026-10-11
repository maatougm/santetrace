import assert from "node:assert/strict";
import test from "node:test";
import type { AccessEnvelope, SharingScope } from "../src/contracts/patient-platform";
import type { PatientRecord } from "../src/lib/client/api";
import {
  documentLabCounts,
  planAbsence,
  readability,
  recordCounts,
  visibleOpenAlertCount,
} from "../src/components/doctor/record/read-visibility";
import { tabAllowed, tabCounts } from "../src/components/doctor/record/record-tabs";

/**
 * The backend projects a denied section as [] / null, so array shape cannot
 * tell "not shared" from "inspected and empty". These fixtures deliberately
 * keep populated arrays under narrow scopes (as an older, broader projection
 * would): only the CURRENT access envelope may decide what is countable.
 */

const ALL_SCOPES: SharingScope[] = ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"];
const ALERT_COMPOSITE: SharingScope[] = ["alerts", "status", "clinical", "measurements", "documents"];

function access(overrides: Partial<AccessEnvelope>): AccessEnvelope {
  return {
    owner: false,
    relationship: "generalist",
    scopes: [],
    grantId: "grant-1",
    grantRevision: 1,
    authorityRevision: 1,
    canManageCare: false,
    canReviewLabs: false,
    ...overrides,
  };
}

const FULL_PRIMARY = access({ relationship: "primary", scopes: ALL_SCOPES, canManageCare: true, canReviewLabs: true });
/** Owners get every scope from the server, but their edit-capability fields are false. */
const OWNER = access({ owner: true, relationship: null, grantId: null, grantRevision: null, scopes: ALL_SCOPES });
/** Even an owner envelope with an empty scope list reads everything. */
const OWNER_NO_SCOPES = access({ owner: true, relationship: null, grantId: null, grantRevision: null, scopes: [] });

/** Two open alerts (plus closed ones), one PDF with a pending and a confirmed HbA1c, proposals, a note, reminders. */
function populated(envelope: AccessEnvelope): PatientRecord {
  return {
    access: envelope,
    alerts: [{ status: "new" }, { status: "acknowledged" }, { status: "resolved" }, { status: "rejected" }],
    measurements: [{ id: "m1" }, { id: "m2" }],
    documents: [{ id: "doc-1" }, { id: "doc-2" }],
    candidates: [
      { id: "c1", documentId: "doc-1", status: "proposed" },
      { id: "c2", documentId: "doc-1", status: "confirmed" },
    ],
    observations: [{ id: "o1", documentId: "doc-1", candidateId: "c2" }],
    proposals: [{ state: "pending" }, { state: "needs_review" }, { state: "approved" }],
    externalNotes: [{ id: "n1" }],
    reminders: [{ id: "r1" }, { id: "r2" }],
    plan: null,
  } as unknown as PatientRecord;
}

/** Same account, every section authorized and inspected but empty. */
function emptied(record: PatientRecord): PatientRecord {
  return { ...record, alerts: [], measurements: [], candidates: [], observations: [], proposals: [], externalNotes: [], reminders: [] };
}

const NOTHING_KNOWN = { openAlerts: null, measurements: null, pendingLabs: null, reviewableProposals: null, externalNotes: null, reminders: null };

// --- 1. measurements + documents generalist (the reproduced case) -----------------

test("measurements+documents generalist: hidden alerts, reminders, labs, proposals and notes are unknown, never 0", () => {
  const generalist = populated(access({ scopes: ["measurements", "documents"] }));

  assert.deepEqual(recordCounts(generalist), { ...NOTHING_KNOWN, measurements: 2 });
  assert.equal(visibleOpenAlertCount(generalist), null, "the header alert shortcut gets 'unknown', not 0");

  const tabs = tabCounts(generalist);
  assert.equal(tabs.measurements, 2);
  for (const id of ["alerts", "reminders", "documents", "care", "notes"] as const) {
    assert.equal(tabs[id], undefined, `${id}: no badge`);
  }
  for (const [id, count] of Object.entries(tabs)) assert.notEqual(count, 0, `${id} never shows an invented 0`);

  const read = readability(generalist.access);
  assert.equal(read.documents, true, "the PDF stays readable and openable");
  assert.equal(read.measurements, true);
  assert.equal(read.labs, false, "structured lab values are not shared");
  assert.equal(tabAllowed(generalist, "documents"), true, "the Documents tab opens…");
  assert.deepEqual(documentLabCounts(generalist, "doc-1"), { pending: null, confirmed: null, total: null }, "…without per-document counts");
});

test("mutation rights never grant reads: canReviewLabs/canManageCare do not reveal lab counts", () => {
  const editor = populated(access({ scopes: ["measurements", "documents"], canReviewLabs: true, canManageCare: true }));
  assert.equal(readability(editor.access).labs, false);
  assert.equal(recordCounts(editor).pendingLabs, null);
  assert.equal(tabCounts(editor).documents, undefined);
  assert.deepEqual(documentLabCounts(editor, "doc-1"), { pending: null, confirmed: null, total: null });
});

// --- 2. clinical + documents secondary, read-only -----------------------------------

test("clinical+documents secondary (no review/manage rights) reads real lab counts, including a genuine 0", () => {
  const secondary = populated(access({ relationship: "specialist", scopes: ["status", "clinical", "documents"] }));
  assert.equal(secondary.access.canReviewLabs, false);
  assert.equal(secondary.access.canManageCare, false);

  assert.equal(readability(secondary.access).labs, true);
  assert.deepEqual(documentLabCounts(secondary, "doc-1"), { pending: 1, confirmed: 1, total: 2 });
  assert.deepEqual(documentLabCounts(secondary, "doc-2"), { pending: 0, confirmed: 0, total: 0 }, "a PDF with no extracted value is a real 0");
  assert.equal(tabCounts(secondary).documents, 1);

  const empty = emptied(secondary);
  assert.equal(recordCounts(empty).pendingLabs, 0);
  assert.equal(tabCounts(empty).documents, 0, "authorized and empty: the badge keeps its real 0");

  assert.equal(recordCounts(secondary).reminders, 2, "clinical makes reminders readable…");
  assert.equal(tabAllowed(secondary, "reminders"), false);
  assert.equal(tabCounts(secondary).reminders, undefined, "…but the reminders tab stays reserved: no badge on a closed tab");
  assert.equal(tabCounts(secondary).alerts, undefined, "alerts composite incomplete");
});

// --- 3. full primary and owner ------------------------------------------------------

for (const [label, envelope] of [
  ["full primary", FULL_PRIMARY],
  ["owner (edit capabilities false)", OWNER],
  ["owner with an empty scope list", OWNER_NO_SCOPES],
] as const) {
  test(`${label}: populated arrays give their real counts, empty arrays a real 0`, () => {
    const full = populated(envelope);
    assert.deepEqual(recordCounts(full), { openAlerts: 2, measurements: 2, pendingLabs: 1, reviewableProposals: 2, externalNotes: 1, reminders: 2 });
    assert.deepEqual(tabCounts(full), { alerts: 2, care: 2, measurements: 2, documents: 1, notes: 1, reminders: 2 });
    assert.deepEqual(documentLabCounts(full, "doc-1"), { pending: 1, confirmed: 1, total: 2 });
    assert.equal(planAbsence(full), "none");

    const empty = emptied(full);
    assert.deepEqual(recordCounts(empty), { openAlerts: 0, measurements: 0, pendingLabs: 0, reviewableProposals: 0, externalNotes: 0, reminders: 0 });
    assert.deepEqual(
      tabCounts(empty),
      { alerts: 0, care: undefined, measurements: 0, documents: 0, notes: undefined, reminders: 0 },
      "care and notes keep their 'no badge for 0' rule",
    );
    assert.equal(visibleOpenAlertCount(empty), 0, "an inspected empty alert list is a real 0");
  });
}

// --- 4. status-only and clinical-without-documents ----------------------------------

test("status-only: the care tab opens, but neither the plan's absence nor a proposal count is known", () => {
  const statusOnly = populated(access({ scopes: ["status"] }));
  assert.equal(tabAllowed(statusOnly, "care"), true);
  assert.equal(tabCounts(statusOnly).care, undefined);
  assert.equal(recordCounts(statusOnly).reviewableProposals, null);
  assert.equal(planAbsence(statusOnly), "notShared", "status alone cannot establish 'Aucun plan'");
  assert.deepEqual(recordCounts(statusOnly), NOTHING_KNOWN);
});

test("clinical without documents: clinical counts are known, structured labs are not", () => {
  const clinical = populated(access({ scopes: ["status", "clinical"] }));
  const read = readability(clinical.access);
  assert.equal(read.clinical, true);
  assert.equal(read.labs, false);
  assert.equal(read.documents, false);
  assert.deepEqual(recordCounts(clinical), { ...NOTHING_KNOWN, reviewableProposals: 2, externalNotes: 1, reminders: 2 });
  assert.deepEqual(documentLabCounts(clinical, "doc-1"), { pending: null, confirmed: null, total: null });
  assert.equal(tabCounts(clinical).documents, undefined);
  assert.equal(tabCounts(clinical).care, 2);
  assert.equal(tabCounts(clinical).notes, 1);
  assert.equal(planAbsence(clinical), "none");
});

test("an absent historical externalNotes property stays unknown rather than 0", () => {
  const record = { ...populated(FULL_PRIMARY), externalNotes: undefined };
  assert.equal(recordCounts(record).externalNotes, null);
  assert.equal(tabCounts(record).notes, undefined);
});

// --- 5. scope downgrade --------------------------------------------------------------

test("scope downgrade: the current envelope suppresses counts even when old arrays are still populated", () => {
  const before = populated(FULL_PRIMARY);
  assert.equal(tabCounts(before).alerts, 2);

  const narrowed: PatientRecord = {
    ...before,
    access: { ...before.access, scopes: ["measurements", "documents"], canManageCare: false, canReviewLabs: false, grantRevision: 2, authorityRevision: 2 },
  };
  assert.deepEqual(recordCounts(narrowed), { ...NOTHING_KNOWN, measurements: 2 });
  assert.deepEqual(tabCounts(narrowed), { alerts: undefined, care: undefined, measurements: 2, documents: undefined, notes: undefined, reminders: undefined });
  assert.deepEqual(documentLabCounts(narrowed, "doc-1"), { pending: null, confirmed: null, total: null });
  assert.equal(planAbsence(narrowed), "notShared");

  const restored: PatientRecord = { ...narrowed, access: before.access };
  assert.equal(tabCounts(restored).alerts, 2, "eligibility is recomputed per envelope, never cached");
  assert.equal(before.access.scopes.length, ALL_SCOPES.length, "inputs are left untouched");
});

// --- 6. alert composite --------------------------------------------------------------

test("alerts need the whole composite (alerts, status, clinical, measurements, documents)", () => {
  for (const missing of ALERT_COMPOSITE) {
    const partial = populated(access({ relationship: "primary", scopes: ALL_SCOPES.filter((scope) => scope !== missing), canManageCare: true }));
    assert.equal(readability(partial.access).alerts, false, `without ${missing}`);
    assert.equal(visibleOpenAlertCount(partial), null, `without ${missing}`);
    assert.equal(tabCounts(partial).alerts, undefined, `without ${missing}`);
  }
  const complete = populated(access({ scopes: ALERT_COMPOSITE }));
  assert.equal(visibleOpenAlertCount(complete), 2, "new + acknowledged; resolved and rejected excluded");
  assert.equal(tabCounts(complete).alerts, 2);

  const closedOnly: PatientRecord = { ...complete, alerts: complete.alerts.filter((alert) => alert.status === "resolved" || alert.status === "rejected") };
  assert.equal(visibleOpenAlertCount(closedOnly), 0, "only closed alerts: a real 0");
});
