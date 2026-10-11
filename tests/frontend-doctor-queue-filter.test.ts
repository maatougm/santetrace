import assert from "node:assert/strict";
import test from "node:test";
import type { Alert, DashboardPatient } from "../src/lib/client/api";
import type { AccessEnvelope, DoctorQueueSummary } from "../src/contracts/patient-platform";
import type { MonitoringState } from "../src/contracts/monitoring";
import { buildPatientQueue, hasPendingWork, type QueueRow } from "../src/components/doctor/dashboard/queue";
import {
  QUEUE_FILTERS,
  filterQueue,
  matchesFilter,
  normalizeSearchText,
  queueFilterCounts,
} from "../src/components/doctor/dashboard/queue-filter";
import { newAlertCounts, newAlertsIndicator, pendingWorkSummary } from "../src/components/doctor/dashboard/row-indicators";

// ---------------------------------------------------------------------------
// Fixtures (same shapes as frontend-doctor-queue.test.ts)
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

const NO_STATUS_NO_ALERTS: AccessEnvelope = {
  ...FULL_ACCESS,
  relationship: "specialist",
  scopes: ["measurements", "documents"],
  canManageCare: false,
};

const monitoring = (priority: MonitoringState["priority"], coverage: MonitoringState["coverage"]): MonitoringState => ({
  priority,
  coverage,
  reasons: [],
  evaluatedAt: at(8),
});

const IDLE: DoctorQueueSummary = {
  clinicalMessages: { count: 0, oldestAt: null },
  contactRequests: { count: 0, oldestAt: null },
  proposals: { awaitingReview: 0, needsInputs: 0, oldestAt: null },
  planReview: { overdue: false, dueAt: null },
  blockedProtocols: { count: 0, oldestAt: null },
  oldestPendingAt: null,
};

interface PatientOptions {
  name?: string;
  access?: AccessEnvelope;
  queue?: DoctorQueueSummary;
}

function patient(id: string, state: MonitoringState | null, options: PatientOptions = {}): DashboardPatient {
  return {
    id,
    displayName: options.name ?? id,
    region: "Sfax",
    age: 54,
    language: "fr",
    fictional: true,
    consent: true,
    rules: null,
    status: state?.priority ?? "unknown",
    createdAt: at(1),
    access: options.access ?? FULL_ACCESS,
    monitoring: state,
    queue: options.queue,
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

const ids = (rows: readonly QueueRow[]) => rows.map((row) => row.patient.id);
const waiting = (iso: string): DoctorQueueSummary => ({ ...IDLE, clinicalMessages: { count: 2, oldestAt: iso }, oldestPendingAt: iso });

/** A mixed queue: every filter has at least one row and some rows match several filters. */
function mixedQueue(): QueueRow[] {
  return buildPatientQueue(
    [
      patient("green", monitoring("green", ["complete"]), { name: "Hédi Ben Salah" }),
      patient("green-capped", monitoring("green", ["complete", "stale"]), { name: "Amel Trabelsi" }),
      patient("orange", monitoring("orange", ["complete"]), { name: "Sami Gharbi" }),
      patient("red-by-alert", monitoring("green", ["complete"]), { name: "Fatma Ben Ali" }),
      patient("waiting", monitoring("green", ["complete"]), { name: "Leïla N’Diaye", queue: waiting(at(5)) }),
      patient("not-shared", null, { name: "Rym Jlassi", access: NO_STATUS_NO_ALERTS }),
      patient("never-evaluated", null, { name: "Mohamed Ben Salah" }),
    ],
    [alert("a-red", "red-by-alert", "red", "new", at(6)), alert("a-closed", "orange", "orange", "resolved", at(4))],
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test("search text ignores case, accents, typographic apostrophes and extra spaces", () => {
  assert.equal(normalizeSearchText("  Hédi   BEN  Salah "), "hedi ben salah");
  assert.equal(normalizeSearchText("Leïla N’Diaye"), "leila n'diaye");
  assert.equal(normalizeSearchText("ÉLOÏSE"), "eloise");
  assert.equal(normalizeSearchText(""), "");
});

test("search matches display names case- and accent-insensitively, every word in any order", () => {
  const rows = mixedQueue();
  assert.deepEqual(ids(filterQueue(rows, { filter: "all", search: "hedi" })), ["green"]);
  assert.deepEqual(ids(filterQueue(rows, { filter: "all", search: "LEILA n'diaye" })), ["waiting"]);
  assert.deepEqual(ids(filterQueue(rows, { filter: "all", search: "salah ben" })).sort(), ["green", "never-evaluated"]);
  assert.deepEqual(ids(filterQueue(rows, { filter: "all", search: "   " })), ids(rows), "a blank query keeps every row");
  assert.deepEqual(filterQueue(rows, { filter: "all", search: "zzz" }), []);
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

test("filters follow the displayed priority, never the raw server value", () => {
  const rows = mixedQueue();
  assert.deepEqual(ids(filterQueue(rows, { filter: "red", search: "" })), ["red-by-alert"], "an open red alert raises a server green");
  assert.deepEqual(ids(filterQueue(rows, { filter: "orange", search: "" })), ["orange"], "a resolved orange alert does not count");
  assert.deepEqual(ids(filterQueue(rows, { filter: "pending", search: "" })), ["waiting"]);
  assert.deepEqual(
    ids(filterQueue(rows, { filter: "review", search: "" })).sort(),
    ["green-capped", "never-evaluated", "not-shared"],
    "unknown (including a capped green) and unshared statuses need checking",
  );
  assert.equal(matchesFilter(rows.find((row) => row.patient.id === "green")!, "review"), false, "a real green is not 'à vérifier'");
});

test("filtering preserves the buildPatientQueue order exactly (filter, never re-sort)", () => {
  const rows = mixedQueue();
  for (const filter of QUEUE_FILTERS) {
    for (const search of ["", "ben", "a"]) {
      const shown = ids(filterQueue(rows, { filter, search }));
      const expected = ids(rows).filter((id) => shown.includes(id));
      assert.deepEqual(shown, expected, `${filter} / "${search}"`);
    }
  }
  assert.deepEqual(ids(filterQueue(rows, { filter: "all", search: "" })), ids(rows));
});

test("filterQueue leaves the rows untouched and returns a new array", () => {
  const rows = Object.freeze(mixedQueue());
  const before = ids(rows);
  const shown = filterQueue(rows, { filter: "all", search: "" });
  assert.notEqual(shown, rows);
  assert.deepEqual(ids(rows), before);
});

test("filter counts are true counts of the rows each filter would show, within the current search", () => {
  const rows = mixedQueue();
  assert.deepEqual(queueFilterCounts(rows), { all: 7, red: 1, orange: 1, pending: 1, review: 3 });
  assert.deepEqual(queueFilterCounts(rows, "ben"), { all: 3, red: 1, orange: 0, pending: 0, review: 1 });
  for (const filter of QUEUE_FILTERS) {
    assert.equal(queueFilterCounts(rows, "a")[filter], filterQueue(rows, { filter, search: "a" }).length, filter);
  }
  assert.deepEqual(queueFilterCounts([]), { all: 0, red: 0, orange: 0, pending: 0, review: 0 });
});

// ---------------------------------------------------------------------------
// Row indicators
// ---------------------------------------------------------------------------

test("new alert counts only include unseen alerts, per patient", () => {
  const counts = newAlertCounts([
    alert("1", "p1", "red", "new", at(1)),
    alert("2", "p1", "orange", "new", at(2)),
    alert("3", "p1", "red", "acknowledged", at(3)),
    alert("4", "p2", "orange", "resolved", at(4)),
    alert("5", "p2", "orange", "rejected", at(5)),
  ]);
  assert.equal(counts.get("p1"), 2);
  assert.equal(counts.get("p2"), undefined);
});

test("the new-alerts indicator is shown only where the alerts section is shared", () => {
  const rows = buildPatientQueue(
    [patient("shared", null), patient("hidden", null, { access: NO_STATUS_NO_ALERTS })],
    [alert("1", "shared", "orange", "new", at(1))],
  );
  const counts = newAlertCounts([alert("1", "shared", "orange", "new", at(1)), alert("2", "hidden", "red", "new", at(1))]);
  const byId = new Map(rows.map((row) => [row.patient.id, row]));
  assert.deepEqual(newAlertsIndicator(byId.get("shared")!, counts), { state: "count", count: 1 });
  assert.deepEqual(newAlertsIndicator(byId.get("hidden")!, counts), { state: "not_shared" }, "never shown as 0 or as a count");
});

test("pending work summary names only what waits on the clinician, consistent with hasPendingWork", () => {
  assert.equal(pendingWorkSummary(undefined), null);
  assert.equal(pendingWorkSummary(IDLE), null);
  assert.equal(pendingWorkSummary({ ...IDLE, proposals: { awaitingReview: 0, needsInputs: 3, oldestAt: at(1) } }), null);
  assert.equal(
    pendingWorkSummary({
      ...IDLE,
      clinicalMessages: { count: 2, oldestAt: at(1) },
      contactRequests: { count: 1, oldestAt: at(1) },
      proposals: { awaitingReview: 1, needsInputs: 2, oldestAt: at(1) },
      planReview: { overdue: true, dueAt: at(1) },
      blockedProtocols: { count: 3, oldestAt: at(1) },
    }),
    "2 messages cliniques, 1 demande de contact, 1 proposition à revoir, revue du plan en retard, 3 protocoles bloqués",
  );
  const unshared: DoctorQueueSummary = { clinicalMessages: null, contactRequests: null, proposals: null, planReview: null, blockedProtocols: null, oldestPendingAt: null };
  assert.equal(pendingWorkSummary(unshared), null, "unshared sections are unknown, never work");
  for (const queue of [IDLE, waiting(at(1)), unshared, { ...IDLE, planReview: { overdue: true, dueAt: null } }]) {
    assert.equal(pendingWorkSummary(queue) !== null, hasPendingWork(queue));
  }
});
