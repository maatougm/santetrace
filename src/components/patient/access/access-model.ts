/**
 * Pure decisions behind "Médecins et accès": invitation validation, grant
 * ordering and the one-time token reveal. The token only ever lives in
 * `TokenReveal`; grant lists, drafts and API inputs never carry it.
 */
import type {
  AccessJournalEntry,
  CareGrant,
  DoctorProfile,
  GrantIssue,
  GrantIssueResult,
  JournalResponse,
  Relationship,
  SharingScope,
} from "@/contracts/patient-platform";
import { missingScopeDependencies, scopesForRelationship } from "@/lib/client/grants-api";

/** Pending or active: the server allows one such grant per doctor and one such primary. */
export function isOpenGrant(grant: CareGrant): boolean {
  return grant.state === "pending" || grant.state === "active";
}

export function hasOpenPrimary(grants: readonly CareGrant[]): boolean {
  return grants.some((grant) => grant.relationship === "primary" && isOpenGrant(grant));
}

export interface DoctorChoice {
  doctor: DoctorProfile;
  /** State of this doctor's open grant, if any (the option is then not selectable). */
  openState: "pending" | "active" | null;
}

export function doctorChoices(doctors: readonly DoctorProfile[], grants: readonly CareGrant[]): DoctorChoice[] {
  return doctors.map((doctor) => {
    const open = grants.find((grant) => grant.clinicianId === doctor.id && isOpenGrant(grant));
    return { doctor, openState: open ? (open.state as "pending" | "active") : null };
  });
}

// ---------------------------------------------------------------------------
// Invitation draft
// ---------------------------------------------------------------------------

export interface InviteDraft {
  doctorId: string;
  relationship: Relationship;
  /** Scopes ticked by the patient; ignored for a primary (who receives all). */
  scopes: SharingScope[];
}

export interface InviteErrors {
  doctor?: "required" | "taken";
  relationship?: "primaryExists";
  scopes?: "empty" | "missing";
}

export interface InviteValidation {
  /** Scopes that would actually be requested. */
  scopes: SharingScope[];
  missing: SharingScope[];
  errors: InviteErrors;
  valid: boolean;
}

export function initialInviteDraft(grants: readonly CareGrant[]): InviteDraft {
  return { doctorId: "", relationship: hasOpenPrimary(grants) ? "generalist" : "primary", scopes: [] };
}

export interface ScopeSelection {
  missing: SharingScope[];
  error: "empty" | "missing" | null;
}

export function validateScopeSelection(scopes: readonly SharingScope[]): ScopeSelection {
  if (scopes.length === 0) return { missing: [], error: "empty" };
  const missing = missingScopeDependencies(scopes);
  return { missing, error: missing.length > 0 ? "missing" : null };
}

export function validateInvite(draft: InviteDraft, grants: readonly CareGrant[]): InviteValidation {
  const scopes = scopesForRelationship(draft.relationship, draft.scopes);
  const selection = validateScopeSelection(scopes);
  const taken = grants.some((grant) => grant.clinicianId === draft.doctorId && isOpenGrant(grant));
  const errors: InviteErrors = {
    ...(!draft.doctorId ? { doctor: "required" as const } : taken ? { doctor: "taken" as const } : {}),
    ...(draft.relationship === "primary" && hasOpenPrimary(grants) ? { relationship: "primaryExists" as const } : {}),
    ...(selection.error ? { scopes: selection.error } : {}),
  };
  return { scopes, missing: selection.missing, errors, valid: Object.keys(errors).length === 0 };
}

export function toGrantIssue(draft: InviteDraft, clientId: string): GrantIssue {
  return {
    targetClinicianId: draft.doctorId,
    relationship: draft.relationship,
    scopes: scopesForRelationship(draft.relationship, draft.scopes),
    clientId,
  };
}

/** Only secondaries choose their sections; a primary always has all of them. */
export function canEditScopes(grant: CareGrant): boolean {
  return grant.relationship !== "primary" && isOpenGrant(grant);
}

// ---------------------------------------------------------------------------
// Grant list
// ---------------------------------------------------------------------------

export function upsertGrant(grants: readonly CareGrant[], grant: CareGrant): CareGrant[] {
  return grants.some((g) => g.id === grant.id) ? grants.map((g) => (g.id === grant.id ? grant : g)) : [...grants, grant];
}

const STATE_ORDER: Record<CareGrant["state"], number> = { active: 0, pending: 1, revoked: 2 };

const time = (iso: string | null) => {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
};

export function sortGrants(grants: readonly CareGrant[]): CareGrant[] {
  return [...grants].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || time(b.issuedAt) - time(a.issuedAt));
}

// ---------------------------------------------------------------------------
// One-time token reveal (component memory only)
// ---------------------------------------------------------------------------

export type TokenReveal =
  | { kind: "hidden" }
  | { kind: "token"; grantId: string; token: string }
  /**
   * No code to show: the issuance was replayed (the server returns null), or
   * its answer was discarded by the access fence (grantId null).
   */
  | { kind: "replay"; grantId: string | null };

export const HIDDEN_REVEAL: TokenReveal = { kind: "hidden" };
export const DISCARDED_REVEAL: TokenReveal = { kind: "replay", grantId: null };

export function revealFromIssue(result: GrantIssueResult): TokenReveal {
  const token = result.invitationToken;
  return typeof token === "string" && token.length > 0
    ? { kind: "token", grantId: result.grant.id, token }
    : { kind: "replay", grantId: result.grant.id };
}

export type RevealAction = { type: "issued"; result: GrantIssueResult } | { type: "discarded" } | { type: "hide" };

/** The only state that ever holds the token; "hide" (or unmounting) drops it. */
export function revealReducer(_state: TokenReveal, action: RevealAction): TokenReveal {
  switch (action.type) {
    case "issued":
      return revealFromIssue(action.result);
    case "discarded":
      return DISCARDED_REVEAL;
    case "hide":
      return HIDDEN_REVEAL;
  }
}

// ---------------------------------------------------------------------------
// Access journal
// ---------------------------------------------------------------------------

export function mergeJournal(existing: readonly AccessJournalEntry[], page: JournalResponse): AccessJournalEntry[] {
  const seen = new Set(existing.map((entry) => entry.id));
  return [...existing, ...page.entries.filter((entry) => !seen.has(entry.id))];
}
