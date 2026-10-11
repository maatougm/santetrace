/**
 * Doctor access chosen by the patient (feature 006, lot A): directory,
 * invitations, scopes, revocation and access journal. Invitation tokens are
 * returned once (null on replay) and must only live in component memory.
 */
import type {
  CareGrant,
  DoctorInvitationSummary,
  DoctorProfile,
  GrantAccept,
  GrantIssue,
  GrantIssueResult,
  GrantUpdate,
  JournalResponse,
  Relationship,
  SharingScope,
} from "@/contracts/patient-platform";
import { SHARING_SCOPES } from "@/contracts/patient-platform";
import { request, seg, withQuery, type RequestOptions } from "./transport";

export type {
  CareGrant,
  DoctorInvitationSummary,
  DoctorProfile,
  GrantAccept,
  GrantIssue,
  GrantIssueResult,
  GrantUpdate,
  JournalResponse,
  Relationship,
  SharingScope,
};
export { SHARING_SCOPES };

export function listDoctors(options?: RequestOptions): Promise<{ doctors: DoctorProfile[] }> {
  return request<{ doctors: DoctorProfile[] }>("/doctors", { ...options, expect: ["doctors"] });
}

export function listGrants(patientId: string, options?: RequestOptions): Promise<{ grants: CareGrant[] }> {
  return request<{ grants: CareGrant[] }>(`/patients/${seg(patientId)}/grants`, { ...options, expect: ["grants"] });
}

export function issueDoctorInvitation(patientId: string, input: GrantIssue, options?: RequestOptions): Promise<GrantIssueResult> {
  return request<GrantIssueResult>(`/patients/${seg(patientId)}/grants`, {
    ...options,
    method: "POST",
    json: input,
    expect: ["grant", "invitationToken"],
  });
}

/** Invitations addressed to the signed-in doctor (metadata only, never tokens). */
export function listDoctorInvitations(options?: RequestOptions): Promise<{ invitations: DoctorInvitationSummary[] }> {
  return request<{ invitations: DoctorInvitationSummary[] }>("/doctor-invitations", { ...options, expect: ["invitations"] });
}

export function acceptDoctorInvitation(input: GrantAccept, options?: RequestOptions): Promise<{ grant: CareGrant }> {
  return request<{ grant: CareGrant }>("/doctor-invitations/accept", {
    ...options,
    method: "POST",
    json: input,
    expect: ["grant"],
  });
}

export function updateGrant(grantId: string, input: GrantUpdate, options?: RequestOptions): Promise<{ grant: CareGrant }> {
  return request<{ grant: CareGrant }>(`/grants/${seg(grantId)}`, { ...options, method: "PATCH", json: input, expect: ["grant"] });
}

export function getAccessJournal(
  patientId: string,
  page: { cursor?: string | null; limit?: number } = {},
  options?: RequestOptions,
): Promise<JournalResponse> {
  const path = withQuery(`/patients/${seg(patientId)}/access-journal`, { cursor: page.cursor ?? null, limit: page.limit });
  return request<JournalResponse>(path, { ...options, expect: ["entries", "nextCursor"] });
}

// ---------------------------------------------------------------------------
// Scope rules mirrored from data-model.md "Permission projection" (hints only;
// the server rejects invalid selections).
// ---------------------------------------------------------------------------

/** Summary and alerts need status + measurements + clinical + documents. */
const COMPOSITE_REQUIREMENTS: Partial<Record<SharingScope, readonly SharingScope[]>> = {
  summary: ["status", "measurements", "clinical", "documents"],
  alerts: ["status", "measurements", "clinical", "documents"],
};

/** Scopes missing for a composite selection to be accepted. Empty when valid. */
export function missingScopeDependencies(scopes: readonly SharingScope[]): SharingScope[] {
  const selected = new Set(scopes);
  const missing = new Set<SharingScope>();
  for (const scope of scopes) {
    for (const required of COMPOSITE_REQUIREMENTS[scope] ?? []) {
      if (!selected.has(required)) missing.add(required);
    }
  }
  return SHARING_SCOPES.filter((scope) => missing.has(scope));
}

/** A primary referent needs every scope; secondaries choose. */
export function scopesForRelationship(relationship: Relationship, chosen: readonly SharingScope[]): SharingScope[] {
  if (relationship === "primary") return [...SHARING_SCOPES];
  return SHARING_SCOPES.filter((scope) => chosen.includes(scope));
}

/** Doctor-side link carrying an invitation token in the fragment (never sent to the server by navigation). */
export const INVITATION_FRAGMENT_KEY = "invitation";

export function invitationLink(origin: string, token: string): string {
  return `${origin}/doctor/invitations#${INVITATION_FRAGMENT_KEY}=${encodeURIComponent(token)}`;
}
