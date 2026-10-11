import assert from "node:assert/strict";
import test from "node:test";
import type { CareGrant } from "../src/contracts/patient-platform";
import { careTeamFrom, careTeamNow, type CareTeamSnapshot } from "../src/components/patient/useCareTeam";
import { CARE_COPY, factDisplayLabel } from "../src/lib/client/copy/care";

const ALL_SCOPES: CareGrant["scopes"] = ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"];

const grant = (overrides: Partial<CareGrant>): CareGrant => ({
  id: "g",
  patientId: "p",
  clinicianId: "dr-a",
  relationship: "specialist",
  scopes: ["measurements"],
  state: "active",
  issuedAt: "2026-10-11T08:00:00.000Z",
  acceptedAt: "2026-10-11T08:05:00.000Z",
  revokedAt: null,
  revision: 1,
  ...overrides,
});

const enabled = (...ids: string[]) => new Set(ids);

test("a fresh owner with no doctor has no care team: nobody can see an alert", () => {
  assert.deepEqual(careTeamFrom([], enabled("dr-ref")), { status: "none", alertClinicianIds: [], primaryClinicianId: null });
});

test("pending, revoked or alerts-less grants never count as a team that sees alerts", () => {
  const team = careTeamFrom(
    [
      grant({ id: "1", clinicianId: "dr-ref", state: "pending", relationship: "primary", scopes: ALL_SCOPES }),
      grant({ id: "2", clinicianId: "dr-gen", state: "revoked", scopes: ["alerts", "status", "measurements", "clinical", "documents"] }),
      grant({ id: "3", clinicianId: "dr-spe", state: "active", scopes: ["measurements", "documents"] }),
    ],
    enabled("dr-ref", "dr-gen", "dr-spe"),
  );
  assert.equal(team.status, "none");
  assert.equal(team.primaryClinicianId, null);
});

test("an accepted, enabled doctor with the alerts scope makes the team present; the accepted primary is named", () => {
  const team = careTeamFrom(
    [grant({ id: "1", clinicianId: "dr-ref", relationship: "primary", scopes: ALL_SCOPES }), grant({ id: "2", clinicianId: "dr-spe" })],
    enabled("dr-ref", "dr-spe"),
  );
  assert.deepEqual(team, { status: "present", alertClinicianIds: ["dr-ref"], primaryClinicianId: "dr-ref" });
});

test("a disabled doctor keeps a historical 'active' grant but is no care team (no enabled recipient)", () => {
  const grants = [grant({ id: "1", clinicianId: "dr-ref", relationship: "primary", scopes: ALL_SCOPES })];
  // Directory (enabled accounts only) no longer lists dr-ref.
  assert.deepEqual(careTeamFrom(grants, enabled("dr-gen")), { status: "none", alertClinicianIds: [], primaryClinicianId: null });
});

test("directory or grants unavailable gives unknown, never an optimistic team", () => {
  const grants = [grant({ clinicianId: "dr-ref", relationship: "primary", scopes: ALL_SCOPES })];
  assert.equal(careTeamFrom(grants, null).status, "unknown");
  assert.equal(careTeamFrom(null, enabled("dr-ref")).status, "unknown");
});

test("a team read under an earlier access epoch is cleared immediately (unknown) until a fresh read", () => {
  const snapshot: CareTeamSnapshot = {
    grants: [grant({ clinicianId: "dr-ref", relationship: "primary", scopes: ALL_SCOPES })],
    doctorIds: ["dr-ref"],
    epoch: 3,
  };
  assert.equal(careTeamNow(snapshot, 3, { latestReadFailed: false, denied: false }).status, "present");
  // The patient revoked the doctor: the record poll moved the fence epoch to 4.
  assert.equal(careTeamNow(snapshot, 4, { latestReadFailed: false, denied: false }).status, "unknown");
  // A failed latest read (directory down) or a denied fence also stops showing the old team.
  assert.equal(careTeamNow(snapshot, 3, { latestReadFailed: true, denied: false }).status, "unknown");
  assert.equal(careTeamNow(snapshot, 3, { latestReadFailed: false, denied: true }).status, "unknown");
  assert.equal(careTeamNow(null, 3, { latestReadFailed: false, denied: false }).status, "unknown");
});

test("onboarding facts stored with raw registry codes are displayed with FR/AR names", () => {
  const fact = (kind: "condition" | "allergy" | "treatment" | "symptom", code: string | null, label: string) => ({ kind, code, label });
  assert.equal(factDisplayLabel(fact("condition", "hypertension", "hypertension"), "fr"), "Hypertension artérielle");
  assert.equal(factDisplayLabel(fact("condition", "diabetes", "diabetes"), "ar"), CARE_COPY.ar.factCode.diabetes);
  assert.equal(factDisplayLabel(fact("allergy", "declared", "declared"), "fr"), CARE_COPY.fr.factKind.allergy);
  assert.equal(factDisplayLabel(fact("treatment", "declared", "declared"), "ar"), CARE_COPY.ar.factKind.treatment);
  // A label the patient typed is shown as written; an unknown code is never translated by guess.
  assert.equal(factDisplayLabel(fact("treatment", null, "Metformine 500"), "fr"), "Metformine 500");
  assert.equal(factDisplayLabel(fact("condition", "asthma", "asthma"), "fr"), "asthma");
});
