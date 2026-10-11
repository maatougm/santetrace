import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Patient, Measurement, Alert, Reminder, Document, Candidate, Observation, Rules } from "../contracts/care";
import type { AccountPrincipal, DoctorProfile, CareGrant, DoctorInvitation, ClaimCode, AccessJournalEntry } from "../contracts/patient-platform";
import type { PatientRevision, MedicalFact, MonitoringProfile, ConditionEvaluation, CareProposal, CarePlan, CareAction, ReusableProtocol, ProtocolApplication, CareMessage, ContactRequest, DueTask, Connector, ClinicianReport } from "../contracts/monitoring";
import type { ExternalVisitGrant, ExternalVisitSession, ExternalNote } from "../contracts/external-visit";
import { migrateCareState } from "./care-migrations";
import type { AiCaseScore } from "../contracts/ai-case-score";
export type CareState = { aiCaseScores?: AiCaseScore[]; schemaVersion: 2; accounts: AccountPrincipal[]; doctorProfiles: DoctorProfile[]; careGrants: CareGrant[]; doctorInvitations: DoctorInvitation[]; claimCodes: ClaimCode[]; accessJournal: AccessJournalEntry[]; legacyRelationships: {patientId:string;clinicianId:string;migratedAt:string}[]; patientRevisions: PatientRevision[]; medicalFacts: MedicalFact[]; monitoringProfiles: MonitoringProfile[]; conditionEvaluations: ConditionEvaluation[]; careProposals: CareProposal[]; carePlans: CarePlan[]; careActions: CareAction[]; protocols: ReusableProtocol[]; protocolApplications: ProtocolApplication[]; messages: CareMessage[]; contactRequests: ContactRequest[]; dueTasks: DueTask[]; workerHeartbeats: Record<string,string>; connectors: Connector[]; externalVisitGrants: ExternalVisitGrant[]; externalVisitSessions: ExternalVisitSession[]; externalNotes: ExternalNote[]; clinicianReports: ClinicianReport[]; patients: Patient[]; assignments: Record<string,string>; measurements: Measurement[]; alerts: Alert[]; reminders: Reminder[]; documents: Document[]; candidates: Candidate[]; observations: Observation[]; invites: {hash:string;patientId:string;expiresAt:string;usedAt:string|null}[]; idempotency: Record<string,{hash:string;result:unknown}>; ruleRevisions: {patientId:string;rules:Rules;author:string;at:string}[]; audit: {actorId:string;action:string;subjectId:string;at:string}[] };
export interface CareStoreAdapter { read(): CareState; transaction<T>(action:(state:CareState)=>T):T }
export const DEFAULT_CARE_RULES: Rules = {version:"demo-v1",demonstration:true,systolicWarn:140,diastolicWarn:90,systolicHigh:160,diastolicHigh:100,glucoseWarn:180,glucoseHigh:250,glucoseUnit:"mg/dL",overdueHours:24};
export function seedCareState(): CareState {
 const createdAt=new Date().toISOString();
 const patients:Patient[]=[{id:"fatma",displayName:"Fatma Ben Salah",region:"Siliana",age:62,language:"ar",fictional:true,consent:true,rules:{...DEFAULT_CARE_RULES},status:"unknown",createdAt},{id:"ahmed",displayName:"Ahmed Trabelsi",region:"Kairouan",age:54,language:"fr",fictional:true,consent:true,rules:{...DEFAULT_CARE_RULES},status:"unknown",createdAt}];
 return migrateCareState({patients,assignments:{fatma:"demo-clinician",ahmed:"demo-clinician"},measurements:[],alerts:[],reminders:[],documents:[],candidates:[],observations:[],invites:[],idempotency:{},ruleRevisions:[],audit:[]});
}
export class CareStore implements CareStoreAdapter {
 private db: DatabaseSync;
 constructor(path=process.env.HACKCURE_CARE_DATABASE_PATH || ".data/care.sqlite") {
  if(path!==":memory:") mkdirSync(dirname(resolve(path)),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS care_state (id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL)");
  this.db.prepare("INSERT OR IGNORE INTO care_state(id,body) VALUES(1,?)").run(JSON.stringify(seedCareState()));
  try {
   this.db.exec("BEGIN IMMEDIATE");
   const state=this.read() as unknown as Record<string,unknown>;
   if(state.schemaVersion!==2) {
    if(path!==":memory:") {
     // A second connection can read the consistent WAL snapshot while this writer lock
     // excludes another migration or write. VACUUM INTO must run outside its own transaction.
     const backupPath=resolve(path)+".schema-v1.backup-"+randomUUID()+".sqlite";
     const source=new DatabaseSync(path,{readOnly:true});
     try {source.prepare("VACUUM INTO ?").run(backupPath);chmodSync(backupPath,0o600);} finally {source.close();}
    }
    this.db.prepare("UPDATE care_state SET body=? WHERE id=1").run(JSON.stringify(migrateCareState(state)));
   }
   this.db.exec("COMMIT");
  } catch(error) {this.db.exec("ROLLBACK");this.db.close();throw error;}
 }
 read():CareState {return JSON.parse((this.db.prepare("SELECT body FROM care_state WHERE id=1").get() as {body:string}).body);}
 transaction<T>(action:(state:CareState)=>T):T {this.db.exec("BEGIN IMMEDIATE");try{const state=this.read();const result=action(state);if(result!==null&&(typeof result==="object"||typeof result==="function")&&typeof (result as {then?:unknown}).then==="function") {void Promise.resolve(result).catch(()=>{});throw new TypeError("CareStore transactions must be synchronous");}this.db.prepare("UPDATE care_state SET body=? WHERE id=1").run(JSON.stringify(state));this.db.exec("COMMIT");return result;}catch(error){this.db.exec("ROLLBACK");throw error;}}
 close(){this.db.close();}
}
const shared=globalThis as typeof globalThis & {careStore?:CareStore};
export function getCareStore(){return shared.careStore??=new CareStore();}
export function careId(){return randomUUID();}
