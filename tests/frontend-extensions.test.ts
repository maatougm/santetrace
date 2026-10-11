import assert from "node:assert/strict";
import test from "node:test";
import type { Measurement, Observation } from "../src/contracts/care";
import type { ExternalNote, GuestRecord } from "../src/contracts/external-visit";
import type { CareAction, MedicalFact, MonitoringState } from "../src/contracts/monitoring";
import { absoluteShareUrl, readGuestToken } from "../src/lib/client/share-api";
import { ApiError } from "../src/lib/client/transport";
import {
  INITIAL_LANDING,
  correctableNotes,
  formatCalendarDate,
  guestNoteInput,
  guestSessionReducer,
  isVisitExpired,
  landingReducer,
  landingToken,
  measurementBadges,
  validateDeclaration,
  visitDeadline,
  type GuestSessionAction,
  type GuestSessionState,
  type LandingAction,
  type LandingState,
} from "../src/components/guest/guest-state";
import { createGuestRecordLoader } from "../src/components/guest/guest-record-loader";
import {
  buildShareGroups,
  canRevokeGrant,
  countSelected,
  factTitle,
  issueClientId,
  selectAll,
  selectionHasDocument,
  selectionKey,
  selectionRefs,
  toggleSelection,
  type ShareSource,
} from "../src/components/patient/share/share-selection";
import {
  alertAudience,
  eventForSend,
  isValidDeviceId,
  monitoringView,
  resendEvent,
  validateSimulatorDraft,
  type SimulatorDraft,
} from "../src/components/patient/devices/simulator-logic";

// ---------------------------------------------------------------------------
// Fixtures (fictional)
// ---------------------------------------------------------------------------

const TOKEN = "tok_ABCdef0123456789-xyz";
const NOW = Date.parse("2026-10-11T10:00:00.000Z");

const apiError = (status: number, code = "HTTP_ERROR", kind: ApiError["kind"] = "http") =>
  new ApiError({ status, code, kind, message: `test ${status} ${code}` });
const VISIT_GONE = apiError(404, "VISIT_UNAVAILABLE");
const OFFLINE = apiError(0, "NETWORK_UNAVAILABLE", "network");

const base = {
  patientId: "p-000",
  capturedAt: "2026-10-11T08:00:00.000Z",
  receivedAt: "2026-10-11T08:00:05.000Z",
  clientId: "c-1",
  ruleVersion: "demo-1",
};

const bp = (id: string, measuredAt: string, extra: Partial<Measurement> = {}): Measurement =>
  ({ ...base, id, measuredAt, source: "app", kind: "blood_pressure", systolic: 142, diastolic: 91, unit: "mmHg", status: "orange", ...extra }) as Measurement;

const pulse = (id: string, extra: Partial<Measurement> = {}): Measurement =>
  ({ ...base, id, measuredAt: "2026-10-11T07:00:00.000Z", source: "simulated", kind: "pulse", value: 72, unit: "bpm", status: "unknown", ...extra }) as Measurement;

const observation = (id: string, corrections: number): Observation => ({
  id,
  patientId: "p-000",
  exam: "HbA1c",
  value: 7.2,
  unit: "%",
  examDate: "2026-09-01T00:00:00.000Z",
  documentId: "d-1",
  candidateId: "cand-1",
  confirmedBy: "dr-000",
  confirmedAt: "2026-09-02T00:00:00.000Z",
  revisions: Array.from({ length: corrections }, (_, i) => ({
    value: 7 + i / 10,
    unit: "%",
    examDate: "2026-09-01T00:00:00.000Z",
    reason: "correction",
    author: "dr-000",
    at: "2026-09-03T00:00:00.000Z",
  })),
});

const fact = (id: string, revision: number, supersededBy: string | null = null): MedicalFact => ({
  id,
  patientId: "p-000",
  kind: "condition",
  code: null,
  label: "Exemple",
  value: null,
  polarity: "affirmed",
  verification: "patient_reported",
  sources: [],
  revision,
  createdAt: "2026-10-01T00:00:00.000Z",
  supersededBy,
});

const action = (id: string, revision: number, state: CareAction["state"] = "pending"): CareAction => ({
  id,
  patientId: "p-000",
  planId: "plan-1",
  revision,
  proposalId: "prop-1",
  protocolId: null,
  originVersion: 1,
  action: { templateId: "home.blood_pressure", templateVersion: 1, parameters: {} },
  dueAt: "2026-10-12T08:00:00.000Z",
  state,
  reportedAt: null,
  clientId: "c-a",
  createdAt: "2026-10-10T00:00:00.000Z",
});

const shareSource = (): ShareSource => ({
  measurements: [bp("m-old", "2026-10-09T08:00:00.000Z"), bp("m-new", "2026-10-11T08:00:00.000Z")],
  observations: [observation("o-1", 2)],
  medicalFacts: [fact("f-current", 4), fact("f-old", 1, "f-current")],
  documents: [
    { id: "d-1", patientId: "p-000", filename: "exemple.pdf", uploadedAt: "2026-09-01T00:00:00.000Z", status: "reviewed" },
    { id: "d-bad", patientId: "p-000", filename: "illisible.pdf", uploadedAt: "2026-09-02T00:00:00.000Z", status: "failed" },
  ],
  actions: [action("a-1", 2), action("a-cancelled", 3, "cancelled")],
});

const note = (id: string, grantId: string, extra: Partial<ExternalNote> = {}): ExternalNote => ({
  id,
  patientId: "p-000",
  grantId,
  sessionId: "s-1",
  declaredName: "Dr Exemple",
  organization: "",
  verification: "external_unverified",
  text: "Note fictive",
  consultationDate: null,
  receivedAt: "2026-10-11T09:00:00.000Z",
  correctsNoteId: null,
  ...extra,
});

const guestRecord = (): GuestRecord => ({
  visit: {
    id: "s-1",
    grantId: "g-1",
    declaredName: "Dr Exemple",
    organization: "",
    verification: "unverified",
    openedAt: "2026-10-11T09:30:00.000Z",
    expiresAt: "2026-10-11T10:30:00.000Z",
    idleExpiresAt: "2026-10-11T09:45:00.000Z",
  },
  selection: {
    measurements: [bp("m-new", "2026-10-11T08:00:00.000Z")],
    observations: [observation("o-1", 0)],
    documents: [{ id: "d-1", patientId: "p-000", filename: "exemple.pdf", uploadedAt: "2026-09-01T00:00:00.000Z", status: "reviewed" }],
    medicalFacts: [fact("f-current", 4)],
    actions: [action("a-1", 2)],
  },
  notes: [note("n-1", "g-1"), note("n-other", "g-2")],
});

const activeState = (): GuestSessionState =>
  guestSessionReducer({ phase: "loading", error: null }, { type: "loaded", record: guestRecord() });

// ---------------------------------------------------------------------------
// readGuestToken
// ---------------------------------------------------------------------------

test("readGuestToken: absent fragment gives no token", () => {
  assert.equal(readGuestToken(""), null);
  assert.equal(readGuestToken("#"), null);
});

test("readGuestToken: malformed values are refused", () => {
  assert.equal(readGuestToken("#token="), null);
  assert.equal(readGuestToken("#token=short"), null);
  assert.equal(readGuestToken("#token=has spaces in the token value"), null);
  assert.equal(readGuestToken("#token=<script>alert(1)</script>xxxxxx"), null);
  assert.equal(readGuestToken(`#token=${"a".repeat(513)}`), null);
});

test("readGuestToken: a valid token is read with or without the leading #", () => {
  assert.equal(readGuestToken(`#token=${TOKEN}`), TOKEN);
  assert.equal(readGuestToken(`token=${TOKEN}`), TOKEN);
});

// What the server issues: "/share#<32 random bytes, base64url>" (43 chars, no key).
const SERVER_TOKEN = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 251) % 256)).toString("base64url");

test("readGuestToken: the server's bare 43-char base64url fragment is read as is", () => {
  assert.equal(SERVER_TOKEN.length, 43);
  assert.match(SERVER_TOKEN, /[-_]/);
  assert.equal(readGuestToken(`#${SERVER_TOKEN}`), SERVER_TOKEN);
  assert.equal(readGuestToken(new URL(`https://exemple.test/share#${SERVER_TOKEN}`).hash), SERVER_TOKEN);
});

test("readGuestToken: malformed bare fragments are refused", () => {
  assert.equal(readGuestToken("#short"), null);
  assert.equal(readGuestToken(`#${SERVER_TOKEN.slice(0, 20)} ${SERVER_TOKEN.slice(20)}`), null);
  assert.equal(readGuestToken(`#${SERVER_TOKEN}/../x`), null);
  assert.equal(readGuestToken(`#${"a".repeat(513)}`), null);
});

test("absoluteShareUrl: the owner sees the full same-origin link, the fragment kept intact", () => {
  assert.equal(absoluteShareUrl("https://hackcure.test", `/share#${SERVER_TOKEN}`), `https://hackcure.test/share#${SERVER_TOKEN}`);
  assert.equal(absoluteShareUrl("https://hackcure.test", `https://autre.test/share#${SERVER_TOKEN}`), `https://autre.test/share#${SERVER_TOKEN}`);
});

test("readGuestToken: accepted alias keys work, unknown keys are ignored", () => {
  assert.equal(readGuestToken(`#t=${TOKEN}`), TOKEN);
  assert.equal(readGuestToken(`#visit=${TOKEN}`), TOKEN);
  assert.equal(readGuestToken(`#foo=bar&token=${TOKEN}`), TOKEN);
  assert.equal(readGuestToken(`#code=${TOKEN}`), null);
});

// ---------------------------------------------------------------------------
// Guest landing: preview-safe state machine
// ---------------------------------------------------------------------------

const run = (actions: LandingAction[], from: LandingState = INITIAL_LANDING) => actions.reduce(landingReducer, from);

test("landing: reading a valid fragment prepares the token but never starts redemption", () => {
  const state = run([{ type: "fragment_read", token: readGuestToken(`#token=${TOKEN}`) }]);
  assert.equal(state.phase, "ready");
  assert.equal(landingToken(state), TOKEN);
});

test("landing: a server-issued link (bare fragment) is only prepared on load; activation needs the explicit submit", () => {
  const loaded = run([{ type: "fragment_read", token: readGuestToken(`#${SERVER_TOKEN}`) }]);
  assert.equal(loaded.phase, "ready");
  assert.equal(landingToken(loaded), SERVER_TOKEN);
  const submitted = landingReducer(loaded, { type: "submit" });
  assert.equal(submitted.phase, "submitting");
  // The server answers every refusal with 404 VISIT_UNAVAILABLE: same neutral state, token dropped.
  const refused = landingReducer(submitted, { type: "redeem_failed", error: VISIT_GONE });
  assert.deepEqual(refused, { phase: "unavailable" });
});

test("landing: a second fragment read (StrictMode re-run, hash already stripped) cannot erase the token", () => {
  const state = run([
    { type: "fragment_read", token: TOKEN },
    { type: "fragment_read", token: null },
  ]);
  assert.equal(state.phase, "ready");
  assert.equal(landingToken(state), TOKEN);
});

test("landing: no sequence of passive events reaches the redeeming phase", () => {
  const passive: LandingAction[] = [
    { type: "fragment_read", token: TOKEN },
    { type: "fragment_read", token: null },
    { type: "redeem_failed", error: OFFLINE },
    { type: "fragment_read", token: TOKEN },
  ];
  let state: LandingState = INITIAL_LANDING;
  for (const step of passive) {
    state = landingReducer(state, step);
    assert.notEqual(state.phase, "submitting");
  }
});

test("landing: only an explicit submit with a token starts redemption", () => {
  assert.equal(run([{ type: "submit" }]).phase, "reading");
  assert.equal(run([{ type: "fragment_read", token: null }, { type: "submit" }]).phase, "no_token");
  const submitting = run([{ type: "fragment_read", token: TOKEN }, { type: "submit" }]);
  assert.equal(submitting.phase, "submitting");
  assert.equal(landingToken(submitting), TOKEN);
});

test("landing: success and neutral refusals both drop the token", () => {
  const ready: LandingAction = { type: "fragment_read", token: TOKEN };
  const opened = run([ready, { type: "submit" }, { type: "redeemed" }]);
  assert.equal(opened.phase, "opened");
  assert.equal(landingToken(opened), null);
  for (const error of [VISIT_GONE, apiError(401), apiError(403), apiError(404), apiError(410), apiError(409)]) {
    const refused = run([ready, { type: "submit" }, { type: "redeem_failed", error }]);
    assert.equal(refused.phase, "unavailable", `status ${error.status} ${error.code}`);
    assert.equal(landingToken(refused), null);
  }
});

test("landing: a transport failure keeps the token in memory for an explicit retry", () => {
  const state = run([{ type: "fragment_read", token: TOKEN }, { type: "submit" }, { type: "redeem_failed", error: OFFLINE }]);
  assert.equal(state.phase, "ready");
  assert.equal(landingToken(state), TOKEN);
  assert.ok(state.phase === "ready" && state.failure === OFFLINE);
});

test("landing: declaration is bounded and the name is required", () => {
  assert.deepEqual(validateDeclaration({ declaredName: "  Dr Exemple ", organization: " " }), {
    ok: true,
    value: { declaredName: "Dr Exemple", organization: "" },
  });
  const empty = validateDeclaration({ declaredName: "   ", organization: "" });
  assert.ok(!empty.ok && empty.errors.declaredName === "nameRequired");
  const long = validateDeclaration({ declaredName: "a".repeat(101), organization: "b".repeat(101) });
  assert.ok(!long.ok && long.errors.declaredName === "nameTooLong" && long.errors.organization === "organizationTooLong");
});

// ---------------------------------------------------------------------------
// Guest session: refusal clears everything, held responses cannot restore it
// ---------------------------------------------------------------------------

test("guest session: every session-ending refusal drops the selection and notes", () => {
  for (const error of [VISIT_GONE, apiError(401), apiError(403), apiError(404), apiError(410)]) {
    const opened = guestSessionReducer(activeState(), { type: "open_document", documentId: "d-1" });
    const cleared = guestSessionReducer(opened, { type: "load_failed", error });
    assert.deepEqual(cleared, { phase: "unavailable" }, `status ${error.status} ${error.code}`);
  }
  assert.deepEqual(guestSessionReducer(activeState(), { type: "session_over" }), { phase: "unavailable" });
});

test("guest session: the first PDF denial ends the whole session; later record and note answers are ignored", () => {
  const viewing = guestSessionReducer(activeState(), { type: "open_document", documentId: "d-1" });
  assert.ok(viewing.phase === "active" && viewing.openDocumentId === "d-1");
  const denied = guestSessionReducer(viewing, { type: "source_denied" });
  assert.deepEqual(denied, { phase: "unavailable" });
  const lateRecord = guestSessionReducer(denied, { type: "loaded", record: guestRecord() });
  const lateNote = guestSessionReducer(lateRecord, { type: "note_added", note: note("n-late", "g-1") });
  const reopened = guestSessionReducer(lateNote, { type: "open_document", documentId: "d-1" });
  assert.deepEqual(reopened, { phase: "unavailable" });
});

test("guest session: a response held across the refusal cannot restore guest data", () => {
  const cleared = guestSessionReducer(activeState(), { type: "session_over" });
  assert.deepEqual(guestSessionReducer(cleared, { type: "loaded", record: guestRecord() }), { phase: "unavailable" });
  const ended = guestSessionReducer(activeState(), { type: "ended", confirmed: false });
  assert.deepEqual(ended, { phase: "ended", confirmed: false });
  assert.deepEqual(guestSessionReducer(ended, { type: "loaded", record: guestRecord() }), ended);
});

test("guest session: a transient failure keeps data but marks it stale", () => {
  const state = guestSessionReducer(activeState(), { type: "load_failed", error: OFFLINE });
  assert.equal(state.phase, "active");
  assert.ok(state.phase === "active" && state.stale === OFFLINE && state.record.selection.measurements.length === 1);
  const recovered = guestSessionReducer(state, { type: "loaded", record: guestRecord() });
  assert.ok(recovered.phase === "active" && recovered.stale === null);
});

test("guest session: the idle expiry clears the view (informational, the server decides)", () => {
  const { visit } = guestRecord(); // idle 09:45, absolute 10:30
  assert.equal(visitDeadline(visit), Date.parse("2026-10-11T09:45:00.000Z"));
  assert.equal(isVisitExpired(visit, Date.parse("2026-10-11T09:44:59.000Z")), false);
  assert.equal(isVisitExpired(visit, Date.parse("2026-10-11T09:45:00.000Z")), true);
  assert.deepEqual(guestSessionReducer(activeState(), { type: "expired_locally" }), { phase: "unavailable" });
});

test("guest session: a server answer moves the idle deadline, never past the absolute cap", () => {
  const refreshed = { ...guestRecord().visit, idleExpiresAt: "2026-10-11T10:40:00.000Z" };
  const state = guestSessionReducer(activeState(), { type: "loaded", record: { ...guestRecord(), visit: refreshed } });
  assert.ok(state.phase === "active");
  assert.equal(visitDeadline(state.record.visit), Date.parse("2026-10-11T10:30:00.000Z"));
  assert.equal(isVisitExpired(state.record.visit, Date.parse("2026-10-11T10:00:00.000Z")), false);
  assert.equal(isVisitExpired(state.record.visit, Date.parse("2026-10-11T10:30:00.000Z")), true);
});

// Lets pending promise callbacks run (setImmediate is not faked by the mock timers below).
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("guest record: read once on mount, then only on explicit reloads — never on a timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let reads = 0;
  const actions: GuestSessionAction[] = [];
  const loader = createGuestRecordLoader(
    async () => {
      reads += 1;
      return guestRecord();
    },
    (action) => actions.push(action),
  );
  loader.load();
  await flush();
  t.mock.timers.tick(60 * 60_000);
  await flush();
  assert.equal(reads, 1, "no read happens while the guest is inactive");
  loader.load();
  await flush();
  assert.equal(reads, 2);
  assert.deepEqual(
    actions.map((a) => a.type),
    ["loaded", "loaded"],
  );
});

test("guest record: reads never overlap, and stop() aborts and discards a held answer", async () => {
  const pending: { resolve: (record: GuestRecord) => void; signal: AbortSignal }[] = [];
  const actions: GuestSessionAction[] = [];
  const loader = createGuestRecordLoader(
    (signal) => new Promise<GuestRecord>((resolve) => pending.push({ resolve, signal })),
    (action) => actions.push(action),
  );
  loader.load();
  loader.load();
  assert.equal(pending.length, 1, "a second request while one is in flight is not sent");
  loader.stop();
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve(guestRecord());
  await flush();
  loader.load();
  assert.equal(pending.length, 1, "a stopped loader sends nothing");
  assert.deepEqual(actions, []);
});

test("guest record: a refusal is dispatched for the reducer to end the session", async () => {
  const actions: GuestSessionAction[] = [];
  const loader = createGuestRecordLoader(() => Promise.reject(VISIT_GONE), (action) => actions.push(action));
  loader.load();
  await flush();
  assert.deepEqual(actions, [{ type: "load_failed", error: VISIT_GONE }]);
  assert.deepEqual(guestSessionReducer(activeState(), actions[0]), { phase: "unavailable" });
});

test("guest session: only a selected document can be opened, and appended notes are not duplicated", () => {
  const unknownDoc = guestSessionReducer(activeState(), { type: "open_document", documentId: "d-not-selected" });
  assert.ok(unknownDoc.phase === "active" && unknownDoc.openDocumentId === null);
  const added = guestSessionReducer(activeState(), { type: "note_added", note: note("n-2", "g-1") });
  const again = guestSessionReducer(added, { type: "note_added", note: note("n-2", "g-1") });
  assert.ok(again.phase === "active");
  assert.deepEqual(
    again.record.notes.map((n) => n.id),
    ["n-1", "n-other", "n-2"],
  );
});

test("guest session: a poll started before a note was recorded does not hide that note", () => {
  const added = guestSessionReducer(activeState(), { type: "note_added", note: note("n-2", "g-1") });
  const heldPoll = guestSessionReducer(added, { type: "loaded", record: guestRecord() });
  assert.ok(heldPoll.phase === "active");
  assert.deepEqual(
    heldPoll.record.notes.map((n) => n.id),
    ["n-1", "n-other", "n-2"],
  );
  const caughtUp = guestSessionReducer(heldPoll, { type: "loaded", record: { ...guestRecord(), notes: [...guestRecord().notes, note("n-2", "g-1")] } });
  assert.ok(caughtUp.phase === "active" && caughtUp.record.notes.length === 3);
});

test("guest note: one clientId per note, reused on retry, corrections only within this grant", () => {
  const record = guestRecord();
  let ids = 0;
  const makeId = () => `note-${++ids}`;
  assert.deepEqual(correctableNotes(record).map((n) => n.id), ["n-1"]);

  const first = guestNoteInput({ text: "  Revoir dans 1 mois ", consultationDate: "", correctsNoteId: "n-other" }, record, null, makeId);
  assert.ok(first.ok);
  assert.deepEqual(first.input, { text: "Revoir dans 1 mois", consultationDate: null, correctsNoteId: null, clientId: "note-1" });

  const retry = guestNoteInput({ text: "Revoir dans 1 mois", consultationDate: "", correctsNoteId: "" }, record, { input: first.input, received: false }, makeId);
  assert.ok(retry.ok && retry.input.clientId === "note-1");

  const afterSuccess = guestNoteInput({ text: "Revoir dans 1 mois", consultationDate: "", correctsNoteId: "" }, record, { input: first.input, received: true }, makeId);
  assert.ok(afterSuccess.ok && afterSuccess.input.clientId === "note-2");

  const correction = guestNoteInput({ text: "Correction", consultationDate: "2026-10-11", correctsNoteId: "n-1" }, record, null, makeId);
  assert.ok(correction.ok);
  assert.equal(correction.input.correctsNoteId, "n-1");
});

test("guest note: consultationDate is a calendar string YYYY-MM-DD or null, never a timestamp", () => {
  const record = guestRecord();
  let ids = 0;
  const makeId = () => `note-${++ids}`;
  const dateOf = (consultationDate: string) => {
    const result = guestNoteInput({ text: "Note", consultationDate, correctsNoteId: "" }, record, null, makeId);
    assert.ok(result.ok);
    return result.input.consultationDate;
  };
  assert.equal(dateOf("2026-10-11"), "2026-10-11");
  assert.equal(dateOf(""), null);
  assert.equal(dateOf("11/10/2026"), null);
  assert.equal(dateOf("2026-10-11T00:00"), null);
  assert.equal(dateOf(new Date("2026-10-11T00:00").toISOString()), null);
});

test("calendar dates are displayed without time-zone shifting", () => {
  assert.equal(formatCalendarDate("2026-10-11", "fr"), "11 oct. 2026");
  // West of UTC a timestamp-based formatter would print 31/12/2025 here.
  const newYear = formatCalendarDate("2026-01-01", "ar");
  assert.match(newYear, /2026/);
  assert.doesNotMatch(newYear, /2025|31/);
  assert.equal(formatCalendarDate(null, "fr"), "—");
});

test("guest note: empty and over-long notes never reach the network", () => {
  const record = guestRecord();
  const makeId = () => assert.fail("no id for an invalid note");
  assert.deepEqual(guestNoteInput({ text: "   ", consultationDate: "", correctsNoteId: "" }, record, null, makeId), { ok: false, error: "noteEmpty" });
  assert.deepEqual(guestNoteInput({ text: "x".repeat(4001), consultationDate: "", correctsNoteId: "" }, record, null, makeId), {
    ok: false,
    error: "noteTooLong",
  });
});

test("simulated label follows the reading by source or by server-resolved connector binding", () => {
  assert.deepEqual(measurementBadges(pulse("m-p")), { simulated: true, unscored: true });
  const viaConnector = bp("m-c", "2026-10-11T08:00:00.000Z", {
    source: "device",
    connector: { connectorId: "c", deviceId: "sim-1", externalEventId: "e", simulated: true, quality: "accepted" },
  });
  assert.deepEqual(measurementBadges(viaConnector), { simulated: true, unscored: false });
  assert.deepEqual(measurementBadges(bp("m-a", "2026-10-11T08:00:00.000Z")), { simulated: false, unscored: false });
});

// ---------------------------------------------------------------------------
// Owner share selection
// ---------------------------------------------------------------------------

test("share selection: refs carry the current revision of each selected element", () => {
  const groups = buildShareGroups(shareSource());
  const refs = selectionRefs(groups, selectAll(groups));
  assert.deepEqual(refs, [
    { kind: "measurement", id: "m-new", revision: 1 },
    { kind: "measurement", id: "m-old", revision: 1 },
    { kind: "observation", id: "o-1", revision: 3 },
    { kind: "patient_fact", id: "f-current", revision: 4 },
    { kind: "document", id: "d-1", revision: 1 },
    { kind: "approved_action", id: "a-1", revision: 2 },
  ]);
});

test("share selection: superseded facts, cancelled actions and failed documents are not offered", () => {
  const ids = buildShareGroups(shareSource()).flatMap((group) => group.entries.map((entry) => entry.ref.id));
  assert.ok(!ids.includes("f-old"));
  assert.ok(!ids.includes("a-cancelled"));
  assert.ok(!ids.includes("d-bad"));
});

test("share selection: toggling is immutable and stale keys never produce refs", () => {
  const groups = buildShareGroups(shareSource());
  const empty: ReadonlySet<string> = new Set();
  // The key ignores the revision: a selection follows the element to its current version.
  const one = toggleSelection(empty, selectionKey({ kind: "observation", id: "o-1" }), true);
  assert.equal(empty.size, 0);
  const withStale = toggleSelection(one, "measurement:m-deleted", true);
  assert.deepEqual(selectionRefs(groups, withStale), [{ kind: "observation", id: "o-1", revision: 3 }]);
  assert.equal(countSelected(groups, withStale), 1);
  assert.equal(selectionHasDocument(groups, withStale), false);
  const withDoc = toggleSelection(withStale, "document:d-1", true);
  assert.equal(selectionHasDocument(groups, withDoc), true);
  assert.equal(countSelected(groups, toggleSelection(withDoc, "document:d-1", false)), 1);
});

// Onboarding facts are stored with the registry code as label ("diabetes", "declared").
const coded = (id: string, kind: MedicalFact["kind"], code: string | null, label: string): MedicalFact => ({ ...fact(id, 1), kind, code, label });

test("fact titles: registry codes are named in FR/AR, 'declared' shows the kind, typed labels stay as written", () => {
  const source = {
    ...shareSource(),
    medicalFacts: [
      coded("f-dia", "condition", "diabetes", "diabetes"),
      coded("f-hta", "condition", "hypertension", "hypertension"),
      coded("f-all", "allergy", "declared", "declared"),
      coded("f-typed", "symptom", null, "Vertiges le matin"),
      coded("f-unknown", "condition", "asthma", "asthma"),
    ],
  };
  const titles = (lang: "fr" | "ar") =>
    buildShareGroups(source)
      .flatMap((group) => group.entries)
      .flatMap((entry) => (entry.kind === "patient_fact" ? [[entry.ref.id, factTitle(entry.item, lang)] as const] : []));
  const fr = new Map(titles("fr"));
  assert.deepEqual(fr.get("f-dia"), { kind: "Maladie ou condition", label: "Diabète" });
  assert.deepEqual(fr.get("f-hta"), { kind: "Maladie ou condition", label: "Hypertension artérielle" });
  assert.deepEqual(fr.get("f-all"), { kind: "Allergie", label: null });
  assert.deepEqual(fr.get("f-typed"), { kind: "Symptôme", label: "Vertiges le matin" });
  assert.deepEqual(fr.get("f-unknown"), { kind: "Maladie ou condition", label: "asthma" }, "unknown codes are shown, never guessed");
  const ar = new Map(titles("ar"));
  assert.deepEqual(ar.get("f-dia"), { kind: "مرض أو حالة", label: "السكري" });
  assert.deepEqual(ar.get("f-all"), { kind: "حساسية", label: null });
  for (const [, title] of [...fr, ...ar]) {
    assert.ok(![title.kind, title.label].some((text) => text === "diabetes" || text === "hypertension" || text === "declared"));
  }
  // Display only: the refs sent to the server keep the stored facts untouched.
  const refs = selectionRefs(buildShareGroups(source), selectAll(buildShareGroups(source))).filter((r) => r.kind === "patient_fact");
  assert.deepEqual(
    refs.map((r) => r.id),
    ["f-dia", "f-hta", "f-all", "f-typed", "f-unknown"],
  );
});

test("fact titles: the guest's frozen selection shows named facts in FR and AR", () => {
  const record = guestRecord();
  const frozen = { ...record.selection, medicalFacts: [coded("f-dia", "condition", "diabetes", "diabetes"), coded("f-tr", "treatment", "declared", "declared")] };
  assert.deepEqual(
    frozen.medicalFacts.map((f) => factTitle(f, "fr")),
    [
      { kind: "Maladie ou condition", label: "Diabète" },
      { kind: "Traitement déclaré", label: null },
    ],
  );
  assert.deepEqual(
    frozen.medicalFacts.map((f) => factTitle(f, "ar")),
    [
      { kind: "مرض أو حالة", label: "السكري" },
      { kind: "علاج مُصرَّح به", label: null },
    ],
  );
});

test("share issuance: same selection retried keeps its clientId, a new link gets a new one", () => {
  let ids = 0;
  const makeId = () => `share-${++ids}`;
  const refs = [{ kind: "document" as const, id: "d-1", revision: 1 }];
  const first = issueClientId(null, refs, makeId);
  assert.equal(first.clientId, "share-1");
  assert.equal(issueClientId({ ...first, settled: false }, refs, makeId).clientId, "share-1");
  assert.equal(issueClientId({ ...first, settled: true }, refs, makeId).clientId, "share-2");
  assert.equal(issueClientId({ ...first, settled: false }, [...refs, { kind: "measurement", id: "m", revision: 1 }], makeId).clientId, "share-3");
});

test("share grants: only pending or active links can be revoked", () => {
  assert.equal(canRevokeGrant({ state: "pending" }), true);
  assert.equal(canRevokeGrant({ state: "active" }), true);
  assert.equal(canRevokeGrant({ state: "revoked" }), false);
  assert.equal(canRevokeGrant({ state: "expired" }), false);
});

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

// 90 minutes before NOW in the test machine's own zone, so the fixture is never "in the future".
const PAST_LOCAL = toLocal(NOW - 90 * 60_000);

const draft = (extra: Partial<SimulatorDraft> = {}): SimulatorDraft => ({
  kind: "blood_pressure",
  systolic: "142",
  diastolic: "91",
  value: "",
  glucoseUnit: "mmol/L",
  measuredAtLocal: PAST_LOCAL,
  quality: "accepted",
  ...extra,
});

test("simulator: a valid reading becomes a typed event body with an ISO measuredAt", () => {
  const result = validateSimulatorDraft(draft(), NOW);
  assert.ok(result.ok);
  assert.deepEqual(result.body, {
    measuredAt: new Date(PAST_LOCAL).toISOString(),
    reading: { kind: "blood_pressure", systolic: 142, diastolic: 91, unit: "mmHg" },
    quality: "accepted",
  });
});

test("simulator: pulse is sent in bpm and glucose keeps its explicit unit", () => {
  const pulseResult = validateSimulatorDraft(draft({ kind: "pulse", value: "72", glucoseUnit: "mg/dL", quality: "suspect" }), NOW);
  assert.ok(pulseResult.ok);
  assert.deepEqual(pulseResult.body.reading, { kind: "pulse", value: 72, unit: "bpm" });
  assert.equal(pulseResult.body.quality, "suspect");
  const glucose = validateSimulatorDraft(draft({ kind: "glucose", value: "7,2" }), NOW);
  assert.ok(glucose.ok);
  assert.deepEqual(glucose.body.reading, { kind: "glucose", value: 7.2, unit: "mmol/L" });
});

test("simulator: demo input bounds are enforced before any request", () => {
  const errorOf = (extra: Partial<SimulatorDraft>) => {
    const result = validateSimulatorDraft(draft(extra), NOW);
    return result.ok ? null : result.errors;
  };
  assert.equal(errorOf({ systolic: "60", diastolic: "30" }), null);
  assert.equal(errorOf({ systolic: "260", diastolic: "160" }), null);
  assert.deepEqual(errorOf({ systolic: "59" }), { systolic: "outOfRange" });
  assert.deepEqual(errorOf({ systolic: "261", diastolic: "161" }), { systolic: "outOfRange", diastolic: "outOfRange" });
  assert.deepEqual(errorOf({ systolic: "142.5" }), { systolic: "outOfRange" });
  assert.deepEqual(errorOf({ kind: "pulse", value: "0" }), { value: "outOfRange" });
  assert.equal(errorOf({ kind: "pulse", value: "300" }), null);
  assert.deepEqual(errorOf({ kind: "pulse", value: "301" }), { value: "outOfRange" });
  assert.equal(errorOf({ kind: "glucose", value: "33" }), null);
  assert.deepEqual(errorOf({ kind: "glucose", value: "33.5" }), { value: "outOfRange" });
  assert.equal(errorOf({ kind: "glucose", value: "600", glucoseUnit: "mg/dL" }), null);
  assert.deepEqual(errorOf({ kind: "glucose", value: "abc" }), { value: "outOfRange" });
});

test("simulator: invalid or future measurement times are refused, past ones are kept as measured", () => {
  const invalid = validateSimulatorDraft(draft({ measuredAtLocal: "11/10/2026" }), NOW);
  assert.ok(!invalid.ok && invalid.errors.measuredAt === "invalidTime");
  const future = validateSimulatorDraft(draft({ measuredAtLocal: toLocal(NOW + 10 * 60_000) }), NOW);
  assert.ok(!future.ok && future.errors.measuredAt === "invalidTime");
  const old = validateSimulatorDraft(draft({ measuredAtLocal: "2026-10-01T06:00" }), NOW);
  assert.ok(old.ok && old.body.measuredAt === new Date("2026-10-01T06:00").toISOString());
});

test("simulator: one externalEventId per reading; resend is the identical event", () => {
  let ids = 0;
  const makeId = () => `sim-${++ids}`;
  const valid = validateSimulatorDraft(draft(), NOW);
  assert.ok(valid.ok);
  const first = eventForSend(valid.body, null, makeId);
  assert.equal(first.externalEventId, "sim-1");
  assert.deepEqual(resendEvent({ event: first, received: true }), first);
  assert.equal(eventForSend(valid.body, { event: first, received: false }, makeId).externalEventId, "sim-1");
  assert.equal(eventForSend(valid.body, { event: first, received: true }, makeId).externalEventId, "sim-2");
  const other = validateSimulatorDraft(draft({ systolic: "150" }), NOW);
  assert.ok(other.ok);
  assert.equal(eventForSend(other.body, { event: first, received: false }, makeId).externalEventId, "sim-3");
});

test("simulator: device names follow the pairing rule", () => {
  assert.equal(isValidDeviceId("sim-01"), true);
  assert.equal(isValidDeviceId("ab"), false);
  assert.equal(isValidDeviceId("sim 01"), false);
  assert.equal(isValidDeviceId("a".repeat(41)), false);
});

const EVALUATED = "2026-10-11T08:00:00.000Z";
const monitoringState = (priority: MonitoringState["priority"], coverage: MonitoringState["coverage"], evaluatedAt = EVALUATED): MonitoringState => ({
  priority,
  coverage,
  reasons: [],
  evaluatedAt,
});

test("monitoring view: green is shown only with complete coverage", () => {
  const view = (status: string, coverageComplete: boolean, downgraded: boolean, evaluatedAt: string | null = EVALUATED) => ({
    status,
    coverageComplete,
    downgraded,
    evaluatedAt,
  });
  assert.deepEqual(monitoringView(monitoringState("green", ["complete"])), view("green", true, false));
  assert.deepEqual(monitoringView(monitoringState("green", ["complete", "missing"])), view("unknown", false, true));
  assert.deepEqual(monitoringView(monitoringState("green", [])), view("unknown", false, true));
  assert.deepEqual(monitoringView(monitoringState("orange", ["stale"])), view("orange", false, false));
  assert.deepEqual(monitoringView(null), view("unknown", false, false, null));
});

test("simulator alert line never implies a care team the owner's grants do not show", () => {
  assert.equal(alertAudience("present"), "care_team");
  assert.equal(alertAudience("none"), "nobody");
  assert.equal(alertAudience("unknown"), "unconfirmed");
});

test("monitoring view: the epoch 'never evaluated' sentinel is never shown as a time", () => {
  assert.equal(monitoringView(monitoringState("unknown", [], "1970-01-01T00:00:00.000Z")).evaluatedAt, null);
  assert.equal(monitoringView(monitoringState("unknown", [], "pas une date")).evaluatedAt, null);
  assert.equal(monitoringView(monitoringState("orange", ["complete"])).evaluatedAt, EVALUATED);
});

function toLocal(epoch: number): string {
  const date = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
