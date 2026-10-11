import assert from "node:assert/strict";
import test from "node:test";
import type { Alert, Candidate, Patient, Reminder } from "../src/contracts/care";
import type { AccessEnvelope, ProjectedRecord, SharingScope } from "../src/contracts/patient-platform";
import { bindToFence, createAccessFence, createMutationGuard, type AccessFence } from "../src/lib/client/access-fence";
import { withAlert, withDocument, withPatient, withReminder, withReview } from "../src/components/doctor/record/record-updates";

const ALL: SharingScope[] = ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"];

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const rules = {
  version: "demo-1",
  demonstration: true as const,
  systolicWarn: 140,
  diastolicWarn: 90,
  systolicHigh: 180,
  diastolicHigh: 110,
  glucoseWarn: 180,
  glucoseHigh: 250,
  glucoseUnit: "mg/dL" as const,
  overdueHours: 48,
};

const alert = (status: Alert["status"]): Alert => ({
  id: "alert-1",
  patientId: "p1",
  status,
  priority: "red",
  reason: "Systolic 182 mmHg >= 180 mmHg",
  ruleVersion: "demo-1",
  rulesSnapshot: rules,
  createdAt: "2026-10-11T08:00:00.000Z",
  history: [],
});

function access(scopes: SharingScope[], authorityRevision: number, canManageCare: boolean): AccessEnvelope {
  return {
    owner: false,
    relationship: canManageCare ? "primary" : "specialist",
    scopes,
    grantId: "g1",
    grantRevision: authorityRevision,
    authorityRevision,
    canManageCare,
    canReviewLabs: canManageCare,
  };
}

function record(scopes: SharingScope[], authorityRevision: number, canManageCare: boolean, alerts: Alert[]): ProjectedRecord {
  return {
    patient: {
      id: "p1",
      displayName: "Fatma (fictive)",
      region: "Sfax",
      age: 58,
      language: "fr",
      fictional: true,
      consent: true,
      status: "red",
      createdAt: "2026-10-01T08:00:00.000Z",
      rules: canManageCare ? rules : null,
    },
    measurements: [],
    alerts,
    reminders: [],
    documents: [],
    candidates: [],
    observations: [],
    access: access(scopes, authorityRevision, canManageCare),
    medicalFacts: [],
    plan: null,
    actions: [],
    evaluations: [],
    monitoring: null,
    proposals: [],
  };
}

/** The doctor record view: poll installs projections; mutations commit through the guard. */
function recordView() {
  const fence: AccessFence = createAccessFence("dr-ref::p1");
  let onScreen = fence;
  let current: ProjectedRecord | null = null;
  const install = (next: ProjectedRecord) => {
    if (fence.admitRevision(next.access.authorityRevision)) current = next;
  };
  const apply = bindToFence(fence, () => onScreen, (updater: (r: ProjectedRecord | null) => ProjectedRecord | null) => {
    current = updater(current);
  });
  const guard = createMutationGuard(fence, () => onScreen);
  return {
    fence,
    install,
    apply,
    guard,
    get: () => current,
    switchTo: (other: AccessFence) => {
      onScreen = other;
    },
  };
}

test("scope narrowed while an alert action is held: the old result cannot re-insert the excluded alert", async () => {
  const view = recordView();
  view.install(record(ALL, 4, true, [alert("new")]));

  // Doctor clicks "Accuser réception": the guard ticket is taken BEFORE the request.
  const commit = view.guard.begin();
  const response = held<{ alert: Alert }>();
  const pending = response.promise;

  // Meanwhile the owner downgrades the grant to measurements only. The doctor
  // stays authorized (no 403), the poll installs the narrower projection with a
  // higher authority revision.
  view.install(record(["status", "measurements"], 5, false, []));
  assert.equal(view.fence.denied(), false, "the doctor is still authorized");
  assert.deepEqual(view.get()?.alerts, []);

  response.resolve({ alert: alert("acknowledged") });
  const { alert: updated } = await pending;
  const applied = commit(() => view.apply(withAlert(updated)));

  assert.equal(applied, false, "the held result is discarded");
  assert.deepEqual(view.get()?.alerts, [], "no excluded alert re-inserted");
  assert.equal(view.get()?.access.authorityRevision, 5);
});

test("even without the guard, record updaters never re-add data the current projection hides", () => {
  const narrowed = record(["status", "measurements"], 5, false, []);
  assert.deepEqual(withAlert(alert("acknowledged"))(narrowed)?.alerts, []);
  const hiddenRules: Patient = { ...narrowed.patient, rules: { ...rules, version: "demo-2" } } as Patient;
  assert.equal(withPatient(hiddenRules)(narrowed)?.patient.rules, null, "hidden rules are not restored");
  const reminder: Reminder = { id: "r1", patientId: "p1", label: "Traitement du soir", dueAt: "2026-10-12T18:00:00.000Z", acknowledgedAt: null, taken: null, delivery: "pending" };
  assert.deepEqual(withReminder(reminder)(narrowed)?.reminders, [], "no creation without care authority");
  const candidate = { id: "c1", documentId: "d1", patientId: "p1", exam: "HbA1c", value: 7.1, unit: "%", examDate: null, page: 1, sourceText: "HbA1c 7.1 %", confidence: "high", confidenceReason: "lu", identityMatch: "matched", status: "confirmed" } as Candidate;
  assert.deepEqual(withReview(candidate, null)(narrowed)?.candidates, [], "documents hidden: nothing re-inserted");
  assert.deepEqual(withDocument({ id: "d1", patientId: "p1", filename: "x.pdf", uploadedAt: "2026-10-11T08:00:00.000Z", status: "review" }, [candidate])(narrowed)?.documents, []);
});

test("the guard still commits when nothing changed, and a new action after the change is accepted", async () => {
  const view = recordView();
  view.install(record(ALL, 4, true, [alert("new")]));
  const commit = view.guard.begin();
  assert.equal(commit(() => view.apply(withAlert(alert("acknowledged")))), true);
  assert.equal(view.get()?.alerts[0].status, "acknowledged");

  view.install(record(ALL, 5, true, [alert("acknowledged")]));
  const later = view.guard.begin();
  assert.equal(later(() => view.apply(withAlert(alert("resolved")))), true, "started after the change: current");
  assert.equal(view.get()?.alerts[0].status, "resolved");
});

test("the failure path is gated by the same ticket: a held error from the old authority is not shown", async () => {
  const view = recordView();
  view.install(record(ALL, 4, true, [alert("new")]));
  const shown: string[] = [];
  const commit = view.guard.begin(); // taken before try, as in AlertActions/RulesSection/RemindersSection/SummarySection
  const request = held<never>();
  const pending = request.promise.catch((error: Error) => {
    if (!commit(() => shown.push(`error: ${error.message}`))) shown.push("discarded");
  });
  // Owner narrows the scopes while the request is in flight.
  view.install(record(["status", "measurements"], 5, false, []));
  (request as unknown as { resolve: (v: unknown) => void }).resolve(Promise.reject(new Error("Alerte inaccessible.")));
  await pending;
  assert.deepEqual(shown, ["discarded"], "no error text from the previous authority reaches the screen");
});

test("a held result is discarded after a patient switch or a revocation", () => {
  const view = recordView();
  view.install(record(ALL, 4, true, [alert("new")]));
  const commitBeforeSwitch = view.guard.begin();
  view.switchTo(createAccessFence("dr-ref::p2"));
  assert.equal(commitBeforeSwitch(() => view.apply(withAlert(alert("acknowledged")))), false);

  const revoked = recordView();
  revoked.install(record(ALL, 4, true, [alert("new")]));
  const commitBeforeRevoke = revoked.guard.begin();
  revoked.fence.revoke();
  assert.equal(commitBeforeRevoke(() => revoked.apply(withAlert(alert("acknowledged")))), false);
  assert.equal(revoked.get()?.alerts[0].status, "new");
});
