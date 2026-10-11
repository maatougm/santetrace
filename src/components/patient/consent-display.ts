/**
 * What the summary's consent panel may say, decided from the runtime's
 * patient record/error rather than from component memory (which a remount or
 * reload forgets).
 *
 * The server only accepts withdrawal (`consent: false`), never re-granting, so
 * any server-originated sign of withdrawal is final: this visit's successful
 * POST, a CONSENT_REVOKED refusal, or a record (even a dated device copy) that
 * says `consent: false`. "Active" needs a live server record saying `true`
 * with a working poll. Loading, offline, other refusals and a missing field
 * are never presented as either answer.
 */
import type { PatientData } from "./usePatientRecord";

export type ConsentDisplay = "revoked" | "active" | "loading" | "unknown";

export interface ConsentDisplayInput {
  /** This visit's revoke POST succeeded for the current actor (memory only). */
  acknowledged: boolean;
  record: { patient: { consent?: boolean } } | null;
  origin: PatientData["origin"];
  error: { code: string } | null;
}

export function consentDisplay({ acknowledged, record, origin, error }: ConsentDisplayInput): ConsentDisplay {
  if (acknowledged || error?.code === "CONSENT_REVOKED" || record?.patient.consent === false) return "revoked";
  if (!error && origin === "server" && record?.patient.consent === true) return "active";
  return !error && origin !== "server" ? "loading" : "unknown";
}
