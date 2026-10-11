import type { Actor, CareRecord, Patient, Rules } from "./care";
import type { CareAction, CarePlan, CareProposal, ConditionEvaluation, MedicalFact, MonitoringState, PatientRevision, ProposalStatus, RevisionGuard } from "./monitoring";
import type { ExternalNote } from "./external-visit";

export type Relationship = "primary" | "generalist" | "specialist";
export type SharingScope = "status" | "measurements" | "clinical" | "documents" | "summary" | "alerts" | "messages";
export const SHARING_SCOPES: readonly SharingScope[] = ["status", "measurements", "clinical", "documents", "summary", "alerts", "messages"];
export type AccountPrincipal = { id: string; role: Actor["role"]; patientId: string | null; login: string; displayName: string; passwordHash: string; enabled: boolean; sessionVersion: number; configurationDisabled?: boolean; createdAt: string };
export type DoctorProfile = { id: string; displayName: string; specialty: string; fictional: true };
export type AccountRegistration = { login: string; password: string; displayName: string; region: string; age: number; language: "fr" | "ar"; consent: true; fictionalDemo: true; clientId: string; claimCode?: string };
export type AccountLogin = { login: string; password: string };
export type CareGrant = { id: string; patientId: string; clinicianId: string; relationship: Relationship; scopes: SharingScope[]; state: "pending" | "active" | "revoked"; issuedAt: string; acceptedAt: string | null; revokedAt: string | null; revision: number };
export type DoctorInvitation = { id: string; grantId: string; targetClinicianId: string; tokenHash: string; expiresAt: string; acceptedAt: string | null };
export type DoctorInvitationSummary = { id: string; grantId: string; patientDisplayName: string; relationship: Relationship; scopes: SharingScope[]; expiresAt: string; state: CareGrant["state"] };
export type ClaimCode = { hash: string; patientId: string; expiresAt: string; usedAt: string | null };
export type AccessJournalEntry = { id: string; patientId: string; actorId: string; actorCategory: "patient" | "clinician" | "guest" | "system"; actorDisplayName: string; action: string; resourceType: string; resourceId: string; grantId: string | null; grantRevision: number | null; outcome: "allowed" | "denied"; at: string };
export type AccessEnvelope = { owner: boolean; relationship: Relationship | null; scopes: SharingScope[]; grantId: string | null; grantRevision: number | null; authorityRevision: number; canManageCare: boolean; canReviewLabs: boolean };
export type ProjectedRecord = Omit<CareRecord, "patient"> & { patient: Omit<Patient, "rules"> & { rules: Rules | null }; access: AccessEnvelope; medicalFacts: MedicalFact[]; plan: CarePlan | null; actions: CareAction[]; evaluations: ConditionEvaluation[]; monitoring: MonitoringState | null; proposals: (CareProposal | ProposalStatus)[]; externalNotes?: ExternalNote[]; revision?: PatientRevision; guard?: RevisionGuard; requirementIds?: string[] };
export type GrantIssue = { targetClinicianId: string; relationship: Relationship; scopes: SharingScope[]; clientId: string };
export type GrantIssueResult = { grant: CareGrant; invitationToken: string | null };
export type GrantAccept = { token: string; clientId: string };
export type GrantUpdate = { action: "revoke"; expectedRevision: number; clientId: string } | { action: "update"; scopes: SharingScope[]; expectedRevision: number; clientId: string };
export type JournalResponse = { entries: AccessJournalEntry[]; nextCursor: string | null };
/** Waiting-work metadata. A null section is not shared; a zero count was inspected. */
export type QueueBucket = { count: number; oldestAt: string | null };
export type DoctorQueueSummary = {
    clinicalMessages: QueueBucket | null;
    contactRequests: QueueBucket | null;
    proposals: { awaitingReview: number; needsInputs: number; oldestAt: string | null } | null;
    planReview: { overdue: boolean; dueAt: string | null } | null;
    blockedProtocols: QueueBucket | null;
    oldestPendingAt: string | null;
};
