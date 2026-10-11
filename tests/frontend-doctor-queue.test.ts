import assert from "node:assert/strict";
import test from "node:test";
import type { Alert, DashboardPatient, Measurement } from "../src/lib/client/api";
import { ApiError } from "../src/lib/client/transport";
import { invitationLink } from "../src/lib/client/grants-api";
import type { AccessEnvelope, DoctorQueueSummary } from "../src/contracts/patient-platform";
import type { CareMessage, MonitoringState, SearchHit, SourceRef } from "../src/contracts/monitoring";
import { CARE_COPY } from "../src/lib/client/copy/care";
import { measurementQualityLabel, measurementSourceLabel } from "../src/lib/client/format";
import {
  accessSummary,
  aggregateCoverageLabel,
  alertsDisplay,
  buildPatientQueue,
  displayPriority,
  evaluatedAtOrNull,
  hasPendingWork,
  measurementBadgeItems,
  measurementBadges,
  priorityDisplay,
  queueCounters,
  queueReasons,
  referenceTimeMs,
  workerHealth,
} from "../src/components/doctor/dashboard/queue";
import { dashboardSignature } from "../src/components/doctor/dashboard/dashboard-data";
import {
  invitationAcceptError,
  invitationDisplayState,
  readInvitationFragment,
} from "../src/components/doctor/invitations/invitation-fragment";
import {
  canReviewMessage,
  contactActions,
  fetchThreadTail,
  mergeMessages,
  messageStatus,
  needsReadReceipt,
  validateMessageText,
  reviewGuardFrom,
} from "../src/components/doctor/comms/message-state";
import {
  formatScore,
  hitLabel,
  hitSourceLink,
  normalizeSearchQuery,
  partitionHits,
} from "../src/components/doctor/comms/search-results";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 11, hour, minute)).toISOString();

const FULL_ACCESS: AccessEnvelope = {
  owner: false,
  relationship: "primary",
  scopes: ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"],
  grantId: "grant-1",
  grantRevision: 1,
  authorityRevision: 3,
  canManageCare: true,
  canReviewLabs: true,
};

const monitoring = (priority: MonitoringState["priority"], coverage: MonitoringState["coverage"]): MonitoringState => ({
  priority,
  coverage,
  reasons: [],
  evaluatedAt: at(8),
});

function patient(id: string, state: MonitoringState | null, displayName = id): DashboardPatient {
  return {
    id,
    displayName,
    region: "Sfax",
    age: 54,
    language: "fr",
    fictional: true,
    consent: true,
    rules: null,
    status: state?.priority ?? "unknown",
    createdAt: at(1),
    access: FULL_ACCESS,
    monitoring: state,
  };
}

function alert(id: string, patientId: string, priority: Alert["priority"], status: Alert["status"], createdAt: string): Alert {
  return {
    id,
    patientId,
    status,
    priority,
    reason: "demo",
    ruleVersion: "demo-v1",
    rulesSnapshot: {
      version: "demo-v1",
      demonstration: true,
      systolicWarn: 140,
      diastolicWarn: 90,
      systolicHigh: 180,
      diastolicHigh: 110,
      glucoseWarn: 180,
      glucoseHigh: 300,
      glucoseUnit: "mg/dL",
      overdueHours: 48,
    },
    createdAt,
    history: [],
  };
}

const order = (rows: readonly { patient: { id: string } }[]) => rows.map((row) => row.patient.id);

// ---------------------------------------------------------------------------
// Clinician queue
// ---------------------------------------------------------------------------

test("an open red episode ranks first even when the latest evaluation is green", () => {
  const rows = buildPatientQueue(
    [
      patient("orange", monitoring("orange", ["complete"])),
      patient("red-eval", monitoring("red", ["complete"])),
      patient("green-with-open-red", monitoring("green", ["complete"])),
    ],
    [alert("a1", "green-with-open-red", "red", "acknowledged", at(6))],
  );
  assert.deepEqual(order(rows), ["green-with-open-red", "red-eval", "orange"]);
  assert.equal(rows[0].priority, "red");
  assert.equal(rows[0].openRed, true);
});

test("unknown ranks above green, and a green with incomplete coverage is shown as unknown", () => {
  const rows = buildPatientQueue(
    [
      patient("green", monitoring("green", ["complete"])),
      patient("green-stale", monitoring("green", ["complete", "stale"])),
      patient("never-evaluated", null),
    ],
    [],
  );
  assert.deepEqual(order(rows), ["green-stale", "never-evaluated", "green"]);
  assert.deepEqual(
    rows.map((row) => row.priority),
    ["unknown", "unknown", "green"],
  );
  assert.equal(rows[0].greenCap, "coverage");
  assert.equal(rows[1].greenCap, null);
});

test("a server green is not shown as green while the worker is down or without a dated evaluation", () => {
  const green = monitoring("green", ["complete"]);
  const rows = buildPatientQueue([patient("g", green)], [], false);
  assert.equal(rows[0].priority, "unknown");
  assert.equal(rows[0].greenCap, "worker");
  assert.equal(displayPriority(green, [], false), "unknown");
  assert.equal(displayPriority(monitoring("orange", ["complete"]), [], false), "orange", "non-green priorities are never lowered");
  assert.equal(displayPriority({ ...green, evaluatedAt: "1970-01-01T00:00:00.000Z" }, []), "unknown");
  assert.equal(buildPatientQueue([patient("g", { ...green, evaluatedAt: "x" })], [])[0].greenCap, "not_evaluated");
});

test("within the same priority, the oldest open alert comes first; patients without open alerts follow", () => {
  const rows = buildPatientQueue(
    [
      patient("no-alert", monitoring("orange", ["complete"])),
      patient("recent", monitoring("orange", ["complete"])),
      patient("oldest", monitoring("orange", ["complete"])),
    ],
    [
      alert("r", "recent", "orange", "new", at(9)),
      alert("o", "oldest", "orange", "acknowledged", at(7)),
      alert("closed", "no-alert", "orange", "resolved", at(5)),
    ],
  );
  assert.deepEqual(order(rows), ["oldest", "recent", "no-alert"]);
  assert.equal(rows[0].oldestOpenAlertAt, at(7));
  assert.equal(rows[2].openAlerts, 0);
});

test("display priority is never a reassuring green without complete current coverage, and never lowers the server priority", () => {
  assert.equal(displayPriority(monitoring("green", ["complete"]), []), "green");
  assert.equal(displayPriority(monitoring("green", []), []), "unknown");
  assert.equal(displayPriority(monitoring("green", ["complete", "missing"]), []), "unknown");
  assert.equal(displayPriority(monitoring("green", ["unsupported"]), []), "unknown");
  assert.equal(displayPriority(null, []), "unknown");
  assert.equal(displayPriority(undefined, []), "unknown");
  assert.equal(displayPriority(monitoring("orange", ["stale"]), []), "orange");
  assert.equal(displayPriority(monitoring("unknown", ["missing"]), [{ priority: "orange" }]), "orange");
  assert.equal(displayPriority(monitoring("green", ["complete"]), [{ priority: "orange" }]), "orange");
  assert.equal(displayPriority(monitoring("orange", ["complete"]), [{ priority: "red" }]), "red");
});

test("buildPatientQueue leaves its inputs untouched", () => {
  const patients = Object.freeze([patient("b", null, "Béa"), patient("a", null, "Ali")]);
  const alerts = Object.freeze([alert("x", "b", "orange", "new", at(3))]);
  const rows = buildPatientQueue(patients, alerts);
  assert.deepEqual(order(rows), ["b", "a"]);
  assert.deepEqual(
    patients.map((p) => p.id),
    ["b", "a"],
  );
});

const IDLE: DoctorQueueSummary = {
  clinicalMessages: { count: 0, oldestAt: null },
  contactRequests: { count: 0, oldestAt: null },
  proposals: { awaitingReview: 0, needsInputs: 0, oldestAt: null },
  planReview: { overdue: false, dueAt: null },
  blockedProtocols: { count: 0, oldestAt: null },
  oldestPendingAt: null,
};

const withQueue = (base: DashboardPatient, queue: DoctorQueueSummary | undefined): DashboardPatient => ({ ...base, queue });

test("pending clinician work: messages, contact requests, proposals to review, overdue plan review, blocked protocols", () => {
  assert.equal(hasPendingWork(undefined), false);
  assert.equal(hasPendingWork(IDLE), false);
  assert.equal(hasPendingWork({ ...IDLE, proposals: { awaitingReview: 0, needsInputs: 2, oldestAt: at(1) } }), false, "waiting on the patient, not on the doctor");
  assert.equal(hasPendingWork({ ...IDLE, clinicalMessages: { count: 1, oldestAt: at(1) } }), true);
  assert.equal(hasPendingWork({ ...IDLE, contactRequests: { count: 1, oldestAt: at(1) } }), true);
  assert.equal(hasPendingWork({ ...IDLE, proposals: { awaitingReview: 1, needsInputs: 0, oldestAt: at(1) } }), true);
  assert.equal(hasPendingWork({ ...IDLE, planReview: { overdue: true, dueAt: at(1) } }), true);
  assert.equal(hasPendingWork({ ...IDLE, blockedProtocols: { count: 1, oldestAt: at(1) } }), true);
  const unshared: DoctorQueueSummary = { clinicalMessages: null, contactRequests: null, proposals: null, planReview: null, blockedProtocols: null, oldestPendingAt: null };
  assert.equal(hasPendingWork(unshared), false);
});

test("open red stays first; then pending work by oldest pending item; then the priority order; colours never change", () => {
  const waitingSince = (iso: string): DoctorQueueSummary => ({ ...IDLE, clinicalMessages: { count: 1, oldestAt: iso }, oldestPendingAt: iso });
  const rows = buildPatientQueue(
    [
      withQueue(patient("orange-idle", monitoring("orange", ["complete"])), IDLE),
      withQueue(patient("green-recent-work", monitoring("green", ["complete"])), waitingSince(at(9))),
      withQueue(patient("red-open", monitoring("green", ["complete"])), IDLE),
      withQueue(patient("unknown-old-work", monitoring("unknown", ["missing"])), waitingSince(at(4))),
      withQueue(patient("green-idle", monitoring("green", ["complete"])), IDLE),
    ],
    [alert("r", "red-open", "red", "new", at(2))],
  );
  // Root decision: a displayed orange priority precedes purely administrative work.
  assert.deepEqual(order(rows), ["red-open", "orange-idle", "unknown-old-work", "green-recent-work", "green-idle"]);
  const byId = new Map(rows.map((row) => [row.patient.id, row]));
  assert.equal(byId.get("green-recent-work")?.priority, "green", "pending work never changes the clinical colour");
  assert.equal(byId.get("unknown-old-work")?.priority, "unknown");
  assert.equal(byId.get("green-recent-work")?.pendingWork, true);
  assert.equal(byId.get("orange-idle")?.pendingWork, false);
});

test("pending work outranks an idle patient of the same priority", () => {
  const rows = buildPatientQueue(
    [
      withQueue(patient("a-idle", monitoring("orange", ["complete"])), IDLE),
      withQueue(patient("b-contact", monitoring("orange", ["complete"])), { ...IDLE, contactRequests: { count: 2, oldestAt: at(5) }, oldestPendingAt: at(5) }),
    ],
    [],
  );
  assert.deepEqual(order(rows), ["b-contact", "a-idle"]);
});

const pendingMessage = (iso: string): DoctorQueueSummary => ({ ...IDLE, clinicalMessages: { count: 1, oldestAt: iso }, oldestPendingAt: iso });

test("an open orange episode outranks older administrative work; it keeps its pending counters", () => {
  const rows = buildPatientQueue(
    [
      withQueue(patient("green-old-message", monitoring("green", ["complete"])), pendingMessage(at(1))),
      withQueue(patient("orange-open", monitoring("orange", ["complete"])), pendingMessage(at(8))),
    ],
    [alert("o", "orange-open", "orange", "acknowledged", at(9))],
  );
  assert.deepEqual(order(rows), ["orange-open", "green-old-message"]);
  assert.equal(rows[0].openOrange, true);
  assert.equal(rows[0].pendingWork, true, "pending counters still shown in the orange tier");
  assert.equal(rows[1].priority, "green", "pending work never changes the colour");
});

test("red outranks everything, oldest open red first; then orange by oldest open orange; then pending; then idle", () => {
  const rows = buildPatientQueue(
    [
      withQueue(patient("idle-unknown", null), IDLE),
      withQueue(patient("pending-oldest", monitoring("green", ["complete"])), pendingMessage(at(0))),
      withQueue(patient("orange-new", monitoring("orange", ["complete"])), IDLE),
      withQueue(patient("red-recent", monitoring("red", ["complete"])), IDLE),
      withQueue(patient("orange-old", monitoring("orange", ["complete"])), IDLE),
      withQueue(patient("red-old", monitoring("green", ["complete"])), pendingMessage(at(0))),
    ],
    [
      alert("r1", "red-recent", "red", "new", at(11)),
      alert("r2", "red-old", "red", "acknowledged", at(3)),
      alert("o1", "orange-new", "orange", "new", at(10)),
      alert("o2", "orange-old", "orange", "new", at(2)),
    ],
  );
  assert.deepEqual(order(rows), ["red-old", "red-recent", "orange-old", "orange-new", "pending-oldest", "idle-unknown"]);
});

test("pending work outranks idle unknown and green patients; idle unknown stays above idle green; colours unchanged", () => {
  const rows = buildPatientQueue(
    [
      withQueue(patient("idle-green", monitoring("green", ["complete"])), IDLE),
      withQueue(patient("idle-unknown", monitoring("unknown", ["missing"])), IDLE),
      withQueue(patient("pending-green", monitoring("green", ["complete"])), { ...IDLE, planReview: { overdue: true, dueAt: at(2) }, oldestPendingAt: at(2) }),
    ],
    [],
  );
  assert.deepEqual(order(rows), ["pending-green", "idle-unknown", "idle-green"]);
  assert.deepEqual(
    rows.map((row) => row.priority),
    ["green", "unknown", "green"],
  );
});

test("a messages-only row shows unshared status and alerts, never 0 or an evaluated unknown; colour unchanged", () => {
  const messagesOnly: DashboardPatient = {
    ...patient("msg-only", null),
    status: "unknown",
    access: { ...FULL_ACCESS, relationship: "specialist", scopes: ["messages"], canManageCare: false, canReviewLabs: false },
    queue: { clinicalMessages: { count: 1, oldestAt: at(3) }, contactRequests: { count: 0, oldestAt: null }, proposals: null, planReview: null, blockedProtocols: null, oldestPendingAt: at(3) },
  };
  const alertsEmpty = withQueue(patient("alerts-empty", monitoring("orange", ["complete"])), IDLE);
  const rows = buildPatientQueue([alertsEmpty, messagesOnly], []);
  const byId = new Map(rows.map((row) => [row.patient.id, row]));
  const hidden = byId.get("msg-only");
  const shown = byId.get("alerts-empty");
  assert.ok(hidden && shown);
  assert.deepEqual(alertsDisplay(hidden), { state: "not_shared" });
  assert.deepEqual(priorityDisplay(hidden), { status: "unknown", label: "Statut non partagé", monitoringShared: false });
  assert.deepEqual(alertsDisplay(shown), { state: "count", count: 0, oldestAt: null });
  assert.deepEqual(priorityDisplay(shown), { status: "orange", label: "Suivi requis", monitoringShared: true });
  // The displayed orange priority precedes the messages-only row's administrative work.
  assert.deepEqual(order(rows), ["alerts-empty", "msg-only"]);
});

test("open alerts are counted only where the alerts section is shared", () => {
  const [row] = buildPatientQueue([withQueue(patient("p", monitoring("orange", ["complete"])), IDLE)], [alert("a", "p", "orange", "new", at(4))]);
  assert.deepEqual(alertsDisplay(row), { state: "count", count: 1, oldestAt: at(4) });
  const owner = { ...row, patient: { ...row.patient, access: { ...FULL_ACCESS, owner: true, scopes: [] } } };
  assert.equal(alertsDisplay(owner).state, "count");
  const noAccess = { ...row, patient: { ...row.patient, access: undefined } };
  assert.deepEqual(alertsDisplay(noAccess), { state: "not_shared" });
});

const statusOnly = (base: DashboardPatient): DashboardPatient => ({
  ...base,
  access: { ...FULL_ACCESS, relationship: "specialist", scopes: ["status"], canManageCare: false, canReviewLabs: false },
  queue: { ...IDLE, clinicalMessages: null, contactRequests: null, proposals: null, planReview: null, blockedProtocols: null },
});

test("a status-only red row (alerts not shared) sorts before green message work; its colour stays red", () => {
  const rows = buildPatientQueue(
    [
      withQueue(patient("green-message", monitoring("green", ["complete"])), pendingMessage(at(0))),
      statusOnly(patient("red-status-only", monitoring("red", ["complete"]))),
    ],
    [],
  );
  assert.deepEqual(order(rows), ["red-status-only", "green-message"]);
  assert.equal(rows[0].priority, "red");
  assert.deepEqual(alertsDisplay(rows[0]), { state: "not_shared" }, "hidden alerts stay hidden");
  assert.equal(rows[0].openRed, false, "no hidden alert is inferred");
});

test("a status-only orange row sorts before green administrative work", () => {
  const rows = buildPatientQueue(
    [
      withQueue(patient("green-contact", monitoring("green", ["complete"])), { ...IDLE, contactRequests: { count: 1, oldestAt: at(0) }, oldestPendingAt: at(0) }),
      statusOnly(patient("orange-status-only", monitoring("orange", ["complete"]))),
    ],
    [],
  );
  assert.deepEqual(order(rows), ["orange-status-only", "green-contact"]);
  assert.equal(rows[0].priority, "orange");
});

test("within the red tier, a visible open red alert keeps its place ahead of a red status without visible alert", () => {
  const rows = buildPatientQueue(
    [
      statusOnly(patient("a-red-status", monitoring("red", ["complete"]))),
      withQueue(patient("z-open-red", monitoring("green", ["complete"])), IDLE),
    ],
    [alert("r", "z-open-red", "red", "acknowledged", at(5))],
  );
  assert.deepEqual(order(rows), ["z-open-red", "a-red-status"]);
});

test("aggregate coverage [unsupported, complete] reads as partial coverage, never 'monitoring unavailable'", () => {
  const labels = (["unsupported", "complete"] as const).map(aggregateCoverageLabel);
  assert.equal(labels[0], CARE_COPY.fr.monitoring.partialCoverage);
  assert.notEqual(labels[0], CARE_COPY.fr.coverage.unsupported);
  assert.notEqual(labels[0], CARE_COPY.fr.monitoring.unsupportedCondition);
  assert.doesNotMatch(labels.join(" "), /Suivi non disponible/);
  assert.equal(labels[1], CARE_COPY.fr.coverage.complete, "a complete entry is unchanged");
  assert.equal(aggregateCoverageLabel("stale"), CARE_COPY.fr.coverage.stale, "other gaps keep their shared label");
});

test("the queue's latest measurement carries its simulated, suspect and unscored labels", () => {
  const base = {
    id: "m",
    patientId: "p",
    measuredAt: at(8),
    capturedAt: at(8),
    receivedAt: at(8),
    clientId: "c",
    ruleVersion: "demo-v1",
  };
  const suspectSim: Measurement = {
    ...base,
    kind: "blood_pressure",
    systolic: 180,
    diastolic: 120,
    unit: "mmHg",
    status: "unknown",
    source: "simulated",
    connector: { connectorId: "k", deviceId: "sim-qa-suspect", externalEventId: "e", simulated: true, quality: "suspect" },
  };
  const acceptedSim: Measurement = { ...suspectSim, status: "orange", connector: { ...suspectSim.connector!, quality: "accepted" } };
  const manual: Measurement = { ...base, kind: "blood_pressure", systolic: 155, diastolic: 95, unit: "mmHg", status: "orange", source: "app" };
  const pulse: Measurement = { ...base, kind: "pulse", value: 72, unit: "bpm", status: "unknown", source: "app" };
  assert.deepEqual(measurementBadges(suspectSim), ["simulated", "suspect"]);
  assert.deepEqual(measurementBadges(acceptedSim), ["simulated"]);
  assert.deepEqual(measurementBadges(manual), []);
  assert.deepEqual(measurementBadges(pulse), ["unscored"]);
});

test("queue reading labels come from the shared format helpers, never copied strings", () => {
  const suspect: Measurement = {
    id: "s",
    patientId: "p",
    measuredAt: at(8),
    capturedAt: at(8),
    receivedAt: at(8),
    clientId: "c",
    ruleVersion: "demo-v1",
    kind: "blood_pressure",
    systolic: 180,
    diastolic: 120,
    unit: "mmHg",
    status: "unknown",
    source: "device",
    connector: { connectorId: "k", deviceId: "sim", externalEventId: "e", simulated: true, quality: "suspect" },
  };
  const items = measurementBadgeItems(suspect);
  assert.deepEqual(
    items.map((item) => item.key),
    ["simulated", "suspect"],
  );
  assert.equal(items.find((item) => item.key === "suspect")?.label, measurementQualityLabel(suspect, "fr"));
  assert.equal(items.find((item) => item.key === "simulated")?.label, measurementSourceLabel("simulated", "fr"));
  assert.deepEqual(measurementBadgeItems({ ...suspect, source: "app", connector: undefined }), []);
});

test("queue counters: a null section is 'not shared', never 0; zero means inspected and nothing waiting", () => {
  assert.equal(queueCounters(undefined), null);
  const counters = queueCounters({
    clinicalMessages: null,
    contactRequests: { count: 0, oldestAt: null },
    proposals: { awaitingReview: 2, needsInputs: 1, oldestAt: at(3) },
    planReview: { overdue: true, dueAt: at(1) },
    blockedProtocols: null,
    oldestPendingAt: at(1),
  });
  assert.ok(counters);
  const byKey = new Map(counters.map((counter) => [counter.key, counter]));
  assert.deepEqual(byKey.get("clinicalMessages"), { key: "clinicalMessages", state: "not_shared" });
  assert.deepEqual(byKey.get("blockedProtocols"), { key: "blockedProtocols", state: "not_shared" });
  assert.deepEqual(byKey.get("contactRequests"), { key: "contactRequests", state: "count", count: 0, oldestAt: null });
  assert.deepEqual(byKey.get("proposals"), { key: "proposals", state: "proposals", awaitingReview: 2, needsInputs: 1, oldestAt: at(3) });
  assert.deepEqual(byKey.get("planReview"), { key: "planReview", state: "plan", overdue: true, dueAt: at(1) });
});

test("the dashboard change signature moves when a patient's waiting work changes", () => {
  const base = { patients: [withQueue(patient("p", monitoring("orange", ["complete"])), IDLE)], alerts: [], serverTime: at(10) };
  const busier = { ...base, patients: [withQueue(base.patients[0], { ...IDLE, clinicalMessages: { count: 1, oldestAt: at(9) }, oldestPendingAt: at(9) })] };
  const unshared = { ...base, patients: [withQueue(base.patients[0], { ...IDLE, clinicalMessages: null })] };
  assert.notEqual(dashboardSignature(base), dashboardSignature(busier));
  assert.notEqual(dashboardSignature(base), dashboardSignature(unshared));
  const laterAnswer = { ...base, serverTime: at(11) };
  assert.equal(dashboardSignature(base), dashboardSignature(laterAnswer), "the server clock alone is not a change");
});

test("worker heartbeat: missing or unreadable is never seen; older than 60 s is stale", () => {
  const reference = Date.parse(at(10));
  assert.deepEqual(workerHealth(null, reference), { state: "never" });
  assert.deepEqual(workerHealth(undefined, reference), { state: "never" });
  assert.deepEqual(workerHealth("not-a-date", reference), { state: "never" });
  assert.deepEqual(workerHealth("1970-01-01T00:00:00.000Z", reference), { state: "never" });
  assert.deepEqual(workerHealth(new Date(reference - 30_000).toISOString(), reference), {
    state: "running",
    lastSeenAt: new Date(reference - 30_000).toISOString(),
    ageMs: 30_000,
  });
  const stale = workerHealth(new Date(reference - 61_000).toISOString(), reference);
  assert.equal(stale.state, "stale");
  assert.equal(stale.state === "stale" ? stale.ageMs : null, 61_000);
  // A heartbeat slightly ahead of the reference (clock skew) is not "negative age".
  assert.equal(workerHealth(new Date(reference + 2_000).toISOString(), reference).state, "running");
});

test("worker staleness is measured on the server clock plus time elapsed since the answer", () => {
  const serverTime = at(10);
  const receivedAt = 1_000_000;
  assert.equal(referenceTimeMs(serverTime, receivedAt, receivedAt + 45_000), Date.parse(serverTime) + 45_000);
  assert.equal(referenceTimeMs("garbage", receivedAt, 2_000_000), 2_000_000);
  assert.equal(referenceTimeMs(serverTime, null, 2_000_000), 2_000_000);
});

test("the server's epoch sentinel or an unreadable evaluatedAt means never evaluated", () => {
  assert.equal(evaluatedAtOrNull("1970-01-01T00:00:00.000Z"), null);
  assert.equal(evaluatedAtOrNull("nope"), null);
  assert.equal(evaluatedAtOrNull(null), null);
  assert.equal(evaluatedAtOrNull(at(8)), at(8));
  // Same rule as the patient home (displayableEvaluationTime): nothing before 2000 is a real evaluation.
  assert.equal(evaluatedAtOrNull("1999-12-31T23:59:59.000Z"), null);
  assert.deepEqual(workerHealth("1999-12-31T23:59:59.000Z", Date.parse(at(10))), { state: "never" });
});

test("queue reasons are shown in French when known, verbatim and flagged otherwise, with the rest counted", () => {
  const { shown, hidden } = queueReasons(
    [
      "Unresolved alert episodes remain open until an explicit clinician decision.",
      "Systolic 182 mmHg >= 180 mmHg (red; demo rule demo-1).",
      "Some brand new server sentence.",
      "No current condition evaluations are available.",
    ],
    3,
  );
  assert.equal(hidden, 1);
  assert.deepEqual(
    shown.map((reason) => reason.translated),
    [true, true, false],
  );
  assert.match(shown[0].text, /décision explicite du médecin/);
  assert.match(shown[1].text, /^Systolique 182 mmHg ≥ seuil 180 mmHg/);
  assert.equal(shown[2].text, "Some brand new server sentence.");
  assert.deepEqual(queueReasons([], 3), { shown: [], hidden: 0 });
});

test("secondary or partial access is visibly limited; only full primary care authority is not", () => {
  assert.deepEqual(accessSummary(FULL_ACCESS), {
    relationship: "primary",
    scopes: FULL_ACCESS.scopes,
    missing: [],
    limited: false,
    canManageCare: true,
  });
  const specialist = accessSummary({
    ...FULL_ACCESS,
    relationship: "specialist",
    scopes: ["messages", "status"],
    canManageCare: false,
    canReviewLabs: false,
  });
  assert.equal(specialist.limited, true);
  assert.deepEqual(specialist.scopes, ["status", "messages"]);
  assert.deepEqual(specialist.missing, ["measurements", "clinical", "documents", "summary", "alerts"]);
  assert.equal(accessSummary({ ...FULL_ACCESS, canManageCare: false }).limited, true);
  assert.equal(accessSummary(undefined).limited, true);
});

// ---------------------------------------------------------------------------
// Invitation fragment
// ---------------------------------------------------------------------------

test("an invitation fragment is read once and always stripped, keeping unrelated fragment parts", () => {
  assert.deepEqual(readInvitationFragment("#invitation=tok-123"), { present: true, token: "tok-123", remainingHash: "" });
  assert.deepEqual(readInvitationFragment("#tab=x&invitation=tok-123"), { present: true, token: "tok-123", remainingHash: "#tab=x" });
  assert.deepEqual(readInvitationFragment("#other"), { present: false, token: null, remainingHash: "#other" });
  assert.deepEqual(readInvitationFragment(""), { present: false, token: null, remainingHash: "" });
});

test("an empty, malformed, spaced or oversized invitation token is stripped but never accepted", () => {
  for (const hash of ["#invitation=", "#invitation=a%20b", "#invitation=%E0%A4%A", `#invitation=${"x".repeat(600)}`]) {
    const read = readInvitationFragment(hash);
    assert.equal(read.present, true, hash);
    assert.equal(read.token, null, hash);
    assert.equal(read.remainingHash, "", hash);
  }
});

test("the patient's invitation link round-trips through the fragment reader", () => {
  const token = "Ab+/=_-9";
  const link = invitationLink("https://demo.example", token);
  assert.equal(readInvitationFragment(new URL(link).hash).token, token);
});

test("refused invitations get one neutral message whatever the reason (invalid, expired, used, other doctor)", () => {
  const refused = [400, 403, 404, 409, 410].map((status) =>
    invitationAcceptError(
      new ApiError({ status, code: "INVITATION_UNAVAILABLE", kind: "http", message: "x", serverMessage: "Invitation destinée à Dr B" }),
    ),
  );
  assert.equal(new Set(refused).size, 1);
  assert.doesNotMatch(refused[0], /Dr B/);
  const offline = invitationAcceptError(new ApiError({ status: 0, code: "NETWORK_UNAVAILABLE", kind: "network", message: "x" }));
  assert.notEqual(offline, refused[0]);
  assert.match(offline, /Rien n’a été accepté/);
  // Session expiry and rate limiting are not refusals of the invitation itself.
  for (const status of [401, 429]) {
    const other = invitationAcceptError(new ApiError({ status, code: "X", kind: "http", message: "x", serverMessage: "Dr B" }));
    assert.notEqual(other, refused[0]);
    assert.doesNotMatch(other, /Dr B/);
  }
});

test("a pending invitation past its expiry is displayed as expired", () => {
  const now = Date.parse(at(12));
  const summary = { id: "i", grantId: "g", patientDisplayName: "P", relationship: "primary" as const, scopes: [], state: "pending" as const };
  assert.equal(invitationDisplayState({ ...summary, expiresAt: at(11) }, now), "expired");
  assert.equal(invitationDisplayState({ ...summary, expiresAt: at(13) }, now), "pending");
  assert.equal(invitationDisplayState({ ...summary, expiresAt: at(11), state: "active" }, now), "active");
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const DOCTOR = "doctor-1";

function message(overrides: Partial<CareMessage> & Pick<CareMessage, "id">): CareMessage {
  return {
    revision: 1,
    patientId: "p1",
    clinicianId: DOCTOR,
    threadId: "t1",
    authorId: "p1",
    authorCategory: "patient",
    text: "Bonjour",
    kind: "clinical",
    actionId: null,
    createdAt: at(8),
    readAt: null,
    review: null,
    ...overrides,
  };
}

const REVIEW = {
  clinicianId: DOCTOR,
  at: at(9),
  reason: "Lu en contexte",
  guard: { contextRevision: 1, evidenceRevision: 1, authorityRevision: 1, carePlanRevision: 1, profileVersions: [] },
};

test("recorded, read and reviewed are three distinct message states", () => {
  assert.deepEqual(messageStatus(message({ id: "m1" }), DOCTOR), {
    mine: false,
    fromPatient: true,
    read: "unread",
    review: "unreviewed",
    forwarded: null,
  });
  // Reviewed does not imply read (the server keeps readAt null on review).
  assert.deepEqual(messageStatus(message({ id: "m2", review: REVIEW }), DOCTOR), {
    mine: false,
    fromPatient: true,
    read: "unread",
    review: "reviewed",
    forwarded: null,
  });
  // Read does not imply reviewed.
  assert.equal(messageStatus(message({ id: "m3", readAt: at(9) }), DOCTOR).review, "unreviewed");
  // A clinician's own message has a read receipt but no clinical review.
  assert.deepEqual(
    messageStatus(message({ id: "m4", authorId: DOCTOR, authorCategory: "clinician", readAt: at(9) }), DOCTOR),
    { mine: true, fromPatient: false, read: "read", review: "not_applicable", forwarded: null },
  );
});

test("the review guard is only ever server-built: record guard, else the care-plan guard, else none", () => {
  const current = { contextRevision: 4, evidenceRevision: 2, authorityRevision: 3, carePlanRevision: 1, profileVersions: ["p:1"] };
  const planGuard = { ...current, evidenceRevision: 5 };
  const staleEvaluation = { guard: { ...current, contextRevision: 3 } };
  const withGuard = { guard: current, evaluations: [staleEvaluation] };
  // Record / plan answers without a server guard, but with evaluations that carry one.
  const withoutGuard = { guard: undefined, evaluations: [staleEvaluation] };
  assert.deepEqual(reviewGuardFrom(withGuard, { guard: planGuard }), current);
  assert.deepEqual(reviewGuardFrom(withoutGuard, { guard: planGuard }), planGuard);
  // Evaluations are never used to derive a guard.
  assert.equal(reviewGuardFrom(withoutGuard), null);
  assert.equal(reviewGuardFrom(withoutGuard, withoutGuard), null);
  assert.equal(reviewGuardFrom({}, null), null);
});

test("a forwarded copy is a reviewable patient message; the forwarded original only records the forwarding", () => {
  const copy = message({ id: "copy", forwardedFromMessageId: "orig", forwardedFromMessageRevision: 1 });
  assert.equal(messageStatus(copy, DOCTOR).forwarded, "copy");
  assert.equal(messageStatus(copy, DOCTOR).review, "unreviewed");
  assert.equal(canReviewMessage(copy, true), true);
  assert.equal(needsReadReceipt(copy, DOCTOR), true);
  const original = message({ id: "orig", clinicianId: "secondary", forwardedForReview: { messageId: "copy", clinicianId: DOCTOR, at: at(9) } });
  assert.equal(messageStatus(original, "secondary").forwarded, "forwarded_out");
  // Forwarding is not a review of the original.
  assert.equal(messageStatus(original, "secondary").review, "unreviewed");
});

test("read receipts are only for unread patient messages in the viewer's own thread", () => {
  assert.equal(needsReadReceipt(message({ id: "a" }), DOCTOR), true);
  assert.equal(needsReadReceipt(message({ id: "b", readAt: at(9) }), DOCTOR), false);
  assert.equal(needsReadReceipt(message({ id: "c", authorCategory: "clinician", authorId: DOCTOR }), DOCTOR), false);
  assert.equal(needsReadReceipt(message({ id: "d", clinicianId: "doctor-2" }), DOCTOR), false);
});

test("only a clinician with care authority can mark an unreviewed clinical patient message", () => {
  assert.equal(canReviewMessage(message({ id: "a" }), true), true);
  assert.equal(canReviewMessage(message({ id: "a" }), false), false);
  assert.equal(canReviewMessage(message({ id: "b", review: REVIEW }), true), false);
  assert.equal(canReviewMessage(message({ id: "c", kind: "administrative" }), true), false);
  assert.equal(canReviewMessage(message({ id: "d", authorCategory: "clinician", authorId: DOCTOR }), true), false);
});

test("merging keeps chronological order, takes the fresher copy and never mutates inputs", () => {
  const existing = Object.freeze([message({ id: "m2", createdAt: at(9) }), message({ id: "m1", createdAt: at(8), revision: 2, review: REVIEW })]);
  const incoming = Object.freeze([
    message({ id: "m2", createdAt: at(9), readAt: at(10) }),
    message({ id: "m1", createdAt: at(8), revision: 1 }),
    message({ id: "m3", createdAt: at(11) }),
  ]);
  const merged = mergeMessages(existing, incoming);
  assert.deepEqual(
    merged.map((m) => m.id),
    ["m1", "m2", "m3"],
  );
  assert.equal(merged[0].revision, 2, "an older revision never overwrites a newer one");
  assert.equal(merged[1].readAt, at(10), "same revision: the later answer wins (read receipts do not bump revision)");
  assert.equal(existing[0].readAt, null);
});

test("thread loading follows cursors to the newest page and resumes from the last page's cursor", async () => {
  const pages: Record<string, { messages: CareMessage[]; nextCursor: string | null }> = {
    start: { messages: [message({ id: "m1", createdAt: at(1) })], nextCursor: "c1" },
    c1: { messages: [message({ id: "m2", createdAt: at(2) })], nextCursor: "c2" },
    c2: { messages: [message({ id: "m3", createdAt: at(3) })], nextCursor: null },
  };
  const calls: (string | null)[] = [];
  const fetchPage = async (after: string | null) => {
    calls.push(after);
    return pages[after ?? "start"];
  };
  const first = await fetchThreadTail(fetchPage, null);
  assert.deepEqual(
    first.messages.map((m) => m.id),
    ["m1", "m2", "m3"],
  );
  assert.equal(first.tailCursor, "c2");
  assert.equal(first.complete, true);

  pages.c2 = { messages: [message({ id: "m3", createdAt: at(3), readAt: at(4) }), message({ id: "m4", createdAt: at(5) })], nextCursor: null };
  const next = await fetchThreadTail(fetchPage, first);
  assert.deepEqual(calls, [null, "c1", "c2", "c2"]);
  assert.deepEqual(
    next.messages.map((m) => m.id),
    ["m1", "m2", "m3", "m4"],
  );
  assert.equal(next.messages[2].readAt, at(4));

  const bounded = await fetchThreadTail(fetchPage, null, 2);
  assert.equal(bounded.complete, false);
  assert.equal(bounded.tailCursor, "c2");
});

test("message text: required, plain, at most 2000 characters", () => {
  assert.equal(validateMessageText("   "), "empty");
  assert.equal(validateMessageText("x".repeat(2001)), "too_long");
  assert.equal(validateMessageText("a\u0000b"), "invalid");
  assert.equal(validateMessageText("x".repeat(2000)), null);
  assert.equal(validateMessageText("ligne 1\nligne 2"), null);
});

test("contact request actions follow its state; closed requests offer nothing", () => {
  assert.deepEqual(contactActions("requested"), ["acknowledge", "contact_reported", "cancel"]);
  assert.deepEqual(contactActions("acknowledged"), ["contact_reported", "cancel"]);
  assert.deepEqual(contactActions("contact_reported"), []);
  assert.deepEqual(contactActions("cancelled"), []);
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function source(overrides: Partial<SourceRef>): SourceRef {
  return {
    kind: "observation",
    id: "obs-1",
    revision: 1,
    contentHash: null,
    date: at(8),
    verification: "confirmed",
    polarity: "affirmed",
    ...overrides,
  };
}

const hit = (id: string, overrides: Partial<SourceRef>): SearchHit => ({ id, source: source(overrides), excerpt: "HbA1c 7,2 %", score: 0.42 });

test("reference hits are separated from patient sources, keeping server order", () => {
  const { patient: own, reference } = partitionHits([
    hit("h1", {}),
    hit("h2", { kind: "reference", verification: "reference" }),
    hit("h3", { kind: "candidate", verification: "candidate" }),
    hit("h4", { kind: "patient_fact", verification: "reference" }),
  ]);
  assert.deepEqual(
    own.map((h) => h.id),
    ["h1", "h3"],
  );
  assert.deepEqual(
    reference.map((h) => h.id),
    ["h2", "h4"],
  );
});

test("external notes stay with the patient's sources but carry their own unverified label", () => {
  const note = hit("n1", { kind: "external_note", verification: "external_unverified" });
  const unverified = hit("n2", { kind: "patient_fact", verification: "external_unverified" });
  const { patient: own, reference } = partitionHits([note, hit("r", { kind: "reference", verification: "reference" }), unverified]);
  assert.deepEqual(
    own.map((h) => h.id),
    ["n1", "n2"],
  );
  assert.deepEqual(
    reference.map((h) => h.id),
    ["r"],
  );
  assert.equal(hitLabel(note), "external_note");
  assert.equal(hitLabel(unverified), "external_note");
  assert.equal(hitLabel(hit("p", {})), "patient");
  assert.equal(hitLabel(hit("r", { kind: "reference", verification: "reference" })), "reference");
  assert.equal(hitLabel(hit("x", { kind: "external_note", verification: "reference" })), "reference", "a reference is never shown as a patient source");
});

test("source links are built only from the ids carried by a patient hit", () => {
  assert.deepEqual(hitSourceLink("p 1", hit("h", { documentId: "doc/9", page: 2 })), {
    href: "/doctor/patients/p%201/documents/doc%2F9",
    page: 2,
  });
  assert.deepEqual(hitSourceLink("p1", hit("h", { kind: "candidate", id: "cand#1", documentId: "d1", page: 1 })), {
    href: "/doctor/patients/p1/documents/d1#candidate-cand%231",
    page: 1,
  });
  assert.deepEqual(hitSourceLink("p1", hit("h", { documentId: "d1", page: 0 })), { href: "/doctor/patients/p1/documents/d1", page: null });
  assert.deepEqual(hitSourceLink("p1", hit("h", { documentId: "d1", page: 2.5 })), { href: "/doctor/patients/p1/documents/d1", page: null });
  assert.equal(hitSourceLink("p1", hit("h", {})), null, "no document id: no link is invented");
  assert.equal(hitSourceLink("p1", hit("h", { documentId: "" })), null);
  assert.equal(hitSourceLink("p1", hit("h", { kind: "reference", verification: "reference", documentId: "d1" })), null);
});

test("search query is trimmed, required and bounded", () => {
  assert.deepEqual(normalizeSearchQuery("  HbA1c  "), { query: "HbA1c", error: null });
  assert.equal(normalizeSearchQuery("   ").error, "empty");
  assert.equal(normalizeSearchQuery("x".repeat(501)).error, "too_long");
  assert.equal(normalizeSearchQuery("x".repeat(500)).error, null);
});

test("similarity score is shown with two decimals or not at all", () => {
  assert.equal(formatScore(null), null);
  assert.equal(formatScore(Number.NaN), null);
  assert.equal(formatScore(0.4231), "0,42");
});
