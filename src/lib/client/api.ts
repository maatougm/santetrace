/**
 * Typed same-origin client for the HackCure API (feature 001 routes plus the
 * feature 006 projected record). Transport, errors and deadlines live in
 * `transport.ts` and are re-exported here so existing imports keep working.
 * Feature 006 helpers live in accounts-api, grants-api, care-api, assist-api,
 * search-api, devices-api and share-api.
 *
 * Every helper throws ApiError on failure. Nothing here invents data: when the
 * backend is missing (404 HTML / 501) or unreachable, callers get a typed error
 * they must surface honestly.
 */
import type {
  Actor,
  Alert,
  CareRecord,
  Candidate,
  Document,
  Measurement,
  Observation,
  Patient,
  Reminder,
  Rules,
  Status,
} from "@/contracts/care";
import type { MonitoringState } from "@/contracts/monitoring";
import type { AccessEnvelope, DoctorQueueSummary, ProjectedRecord } from "@/contracts/patient-platform";
import { API_BASE, request, seg, type Language, type RequestOptions } from "./transport";

export {
  ApiError,
  AI_TIMEOUT_MS,
  CLIENT_ERROR_CODES,
  DEFAULT_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  describeApiError,
  isApiError,
  toApiError,
} from "./transport";
export type { ApiErrorKind, ErrorDescription, Language, RequestOptions } from "./transport";

export type {
  AccessEnvelope,
  Actor,
  Alert,
  Candidate,
  CareRecord,
  Document as CareDocument,
  Measurement,
  MonitoringState,
  Observation,
  Patient,
  ProjectedRecord,
  Reminder,
  Rules,
  Status,
};

export type Role = Actor["role"];
export type MeasurementKind = Measurement["kind"];
export type MeasurementUnit = Measurement["unit"];
export type GlucoseUnit = Rules["glucoseUnit"];
export type EvaluatedStatus = Exclude<Status, "unknown">;

// ---------------------------------------------------------------------------
// Request / response DTOs (mirrors contracts/api.md)
// ---------------------------------------------------------------------------

export interface SessionEnvelope {
  actor: Actor | null;
  mode: "fictional_demo";
}

/** Dashboard row: projected patient (rules hidden without the needed scope) + access and aggregate monitoring. */
export type DashboardPatient = ProjectedRecord["patient"] & {
  access?: AccessEnvelope;
  monitoring?: MonitoringState | null;
  /** Waiting work per granted section (null section = not shared; 0 = inspected). */
  queue?: DoctorQueueSummary;
};

export interface DashboardResponse {
  patients: DashboardPatient[];
  alerts: Alert[];
  serverTime: string;
  /** Last monitoring-worker heartbeat (null: never seen). Absent on older servers. */
  workerHeartbeat?: string | null;
}

/**
 * What GET /api/patients/:id returns: the current-grant projection. Kept under
 * the historical client name for compatibility; denied sections are empty/null.
 */
export type PatientRecord = ProjectedRecord;

interface MeasurementBase {
  /** ISO timestamp with timezone of when the reading was taken. */
  measuredAt: string;
  /** ISO timestamp of local capture (offline queue time); optional. */
  capturedAt?: string;
  /** Stable idempotency key; reuse the same value on every replay. */
  clientId: string;
}

export interface BloodPressureInput extends MeasurementBase {
  kind: "blood_pressure";
  systolic: number;
  diastolic: number;
  unit: "mmHg";
}

export interface GlucoseInput extends MeasurementBase {
  kind: "glucose";
  value: number;
  unit: GlucoseUnit;
}

export type MeasurementInput = BloodPressureInput | GlucoseInput;

export interface PatientMessage {
  text: string;
  status: EvaluatedStatus;
  ai: false;
}

export interface MeasurementResponse {
  measurement: Measurement;
  alert: Alert | null;
  patientMessage: PatientMessage;
}

export type AlertAction = "acknowledge" | "reject" | "resolve";

export type AlertUpdateInput =
  | { action: "acknowledge"; note?: string }
  | { action: "reject" | "resolve"; note: string };

export type RulesInput = Pick<
  Rules,
  | "systolicWarn"
  | "diastolicWarn"
  | "systolicHigh"
  | "diastolicHigh"
  | "glucoseWarn"
  | "glucoseHigh"
  | "glucoseUnit"
  | "overdueHours"
>;

export interface ReminderInput {
  label: string;
  dueAt: string;
}

export interface ReminderAcknowledgmentInput {
  taken: boolean;
  clientId: string;
}

export interface UploadDocumentResponse {
  document: Document;
  candidates: Candidate[];
}

export type CandidateReviewInput =
  | {
      action: "confirm";
      exam?: string;
      value?: number;
      unit?: string;
      examDate?: string;
      /** Required by the server when any proposed field is corrected. */
      reason?: string;
      /** Explicit clinician identity check when identityMatch is unknown/mismatch. */
      identityConfirmed?: boolean;
    }
  | { action: "reject"; reason: string };

export interface CandidateReviewResponse {
  candidate: Candidate;
  observation: Observation | null;
}

export interface ObservationCorrectionInput {
  value: number;
  unit: string;
  examDate: string;
  reason: string;
}

export interface SummaryFact {
  id: string;
  kind: string;
  sourceId?: string;
}

export interface SummaryResponse {
  text: string;
  facts: SummaryFact[];
  ai: boolean;
}

/** Structured observation export. Shape beyond `subject` is server-defined. */
export interface ExportResponse {
  subject: string;
  mode?: string;
  terminologyMapping?: string;
  measurements?: Measurement[];
  observations?: Observation[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function getSession(options?: RequestOptions): Promise<SessionEnvelope> {
  return request<SessionEnvelope>("/session", { ...options, expect: ["actor"] });
}

// Legacy role/password and one-time-code logins are retired (feature 006):
// accounts-api.ts holds registerPatient/loginAccount.

export function signOut(options?: RequestOptions): Promise<{ ok: true }> {
  return request<{ ok: true }>("/session", { ...options, method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export function getDashboard(options?: RequestOptions): Promise<DashboardResponse> {
  return request<DashboardResponse>("/dashboard", { ...options, expect: ["patients", "alerts"] });
}

export function getPatient(patientId: string, options?: RequestOptions): Promise<PatientRecord> {
  return request<PatientRecord>(`/patients/${seg(patientId)}`, {
    ...options,
    expect: ["patient", "measurements", "alerts", "reminders", "observations", "documents", "candidates", "access"],
  });
}

export function submitMeasurement(patientId: string, input: MeasurementInput, options?: RequestOptions): Promise<MeasurementResponse> {
  return request<MeasurementResponse>(`/patients/${seg(patientId)}/measurements`, {
    ...options,
    method: "POST",
    json: input,
    expect: ["measurement", "patientMessage"],
  });
}

export function updateAlert(alertId: string, input: AlertUpdateInput, options?: RequestOptions): Promise<{ alert: Alert }> {
  return request<{ alert: Alert }>(`/alerts/${seg(alertId)}`, { ...options, method: "PATCH", json: input, expect: ["alert"] });
}

export function updateRules(patientId: string, input: RulesInput, options?: RequestOptions): Promise<{ patient: Patient }> {
  return request<{ patient: Patient }>(`/patients/${seg(patientId)}/rules`, {
    ...options,
    method: "PATCH",
    json: input,
    expect: ["patient"],
  });
}

export function createReminder(patientId: string, input: ReminderInput, options?: RequestOptions): Promise<{ reminder: Reminder }> {
  return request<{ reminder: Reminder }>(`/patients/${seg(patientId)}/reminders`, {
    ...options,
    method: "POST",
    json: input,
    expect: ["reminder"],
  });
}

export function acknowledgeReminder(
  reminderId: string,
  input: ReminderAcknowledgmentInput,
  options?: RequestOptions,
): Promise<{ reminder: Reminder }> {
  return request<{ reminder: Reminder }>(`/reminders/${seg(reminderId)}/acknowledgments`, {
    ...options,
    method: "POST",
    json: input,
    expect: ["reminder"],
  });
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/** Withdraws consent (patient or assigned clinician). Blocks later reads and replay. */
export function revokeConsent(patientId: string, options?: RequestOptions): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/patients/${seg(patientId)}/consent`, {
    ...options,
    method: "PATCH",
    json: { consent: false },
    expect: ["ok"],
  });
}

// ---------------------------------------------------------------------------
// EndoRecord
// ---------------------------------------------------------------------------

export const DOCUMENT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxPages: 20,
  mimeType: "application/pdf",
} as const;

export function uploadDocument(patientId: string, file: File, options?: RequestOptions): Promise<UploadDocumentResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return request<UploadDocumentResponse>(`/patients/${seg(patientId)}/documents`, {
    ...options,
    method: "POST",
    formData,
    expect: ["document", "candidates"],
  });
}

/**
 * Same-origin, cookie-authorized URL for the original PDF. Use it as an
 * iframe/object src or link; append `#page=N` to open a specific page.
 */
export function documentSourceUrl(documentId: string, page?: number): string {
  const base = `${API_BASE}/documents/${seg(documentId)}/source`;
  return page && Number.isInteger(page) && page > 0 ? `${base}#page=${page}` : base;
}

export function reviewCandidate(
  candidateId: string,
  input: CandidateReviewInput,
  options?: RequestOptions,
): Promise<CandidateReviewResponse> {
  return request<CandidateReviewResponse>(`/candidates/${seg(candidateId)}`, {
    ...options,
    method: "PATCH",
    json: input,
    expect: ["candidate"],
  });
}

export function correctObservation(
  observationId: string,
  input: ObservationCorrectionInput,
  options?: RequestOptions,
): Promise<{ observation: Observation }> {
  return request<{ observation: Observation }>(`/observations/${seg(observationId)}`, {
    ...options,
    method: "PATCH",
    json: input,
    expect: ["observation"],
  });
}

export function getSummary(patientId: string, options?: RequestOptions): Promise<SummaryResponse> {
  return request<SummaryResponse>(`/patients/${seg(patientId)}/summary`, { ...options, expect: ["text", "facts"] });
}

export function getExport(patientId: string, options?: RequestOptions): Promise<ExportResponse> {
  return request<ExportResponse>(`/patients/${seg(patientId)}/export`, { ...options, expect: ["subject"] });
}
