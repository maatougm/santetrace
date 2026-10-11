import type { CareState } from "./care-store";

/** Preserve every legacy resource; historical assignments confer no live authority. */
export function migrateCareState(input: Record<string, unknown>, at = new Date().toISOString()): CareState {
 if (typeof input.schemaVersion === "number" && input.schemaVersion > 2) throw new Error("Unsupported care schema version");
 if (input.schemaVersion === 2) return input as CareState;
 const state = { ...input };
 const collections = ["accounts", "doctorProfiles", "careGrants", "doctorInvitations", "claimCodes", "accessJournal", "legacyRelationships", "patientRevisions", "medicalFacts", "monitoringProfiles", "conditionEvaluations", "careProposals", "carePlans", "careActions", "protocols", "protocolApplications", "messages", "contactRequests", "dueTasks", "connectors", "externalVisitGrants", "externalVisitSessions", "externalNotes", "clinicianReports"];
 for (const key of collections) state[key] ??= [];
 state.workerHeartbeats ??= {};
 const relationships = state.legacyRelationships as CareState["legacyRelationships"];
 for (const [patientId, clinicianId] of Object.entries((state.assignments ?? {}) as Record<string,string>)) {
  if (!relationships.some(r => r.patientId === patientId && r.clinicianId === clinicianId)) relationships.push({patientId,clinicianId,migratedAt:at});
 }
 const revisions = state.patientRevisions as CareState["patientRevisions"];
 for (const patient of state.patients as CareState["patients"]) {
  if (!revisions.some(r => r.patientId === patient.id)) revisions.push({patientId:patient.id,contextRevision:0,evidenceRevision:0,authorityRevision:0});
 }
 state.schemaVersion = 2;
 return state as CareState;
}
