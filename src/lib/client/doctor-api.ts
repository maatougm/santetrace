/**
 * Clinician-only client for the experimental AI case attention estimate
 * (backend contract: src/contracts/ai-case-score.ts, owned by the backend).
 *
 * - GET only reads the clinician's current cached estimate; it never runs the model.
 * - POST runs the model and is sent ONLY from an explicit doctor click (never on
 *   render, never from polling). Body is exactly `{ clientId }`.
 * - Every payload is re-validated here: a malformed estimate becomes `null`, so
 *   no screen can show a number the server did not genuinely return.
 * - Optional medical-consultation provenance is validated separately: invalid
 *   metadata is dropped (never guessed), without dropping a valid estimate.
 */
import type { AiCaseScore, AiCaseScoreFailure, AiCaseScoreResponse } from "@/contracts/ai-case-score";
import type { MedicalConsultationMeta } from "@/contracts/medical-consultation";
import type { AiFailure, RevisionGuard } from "@/contracts/monitoring";
import { aiOptions, request, seg, type RequestOptions } from "./transport";

export type { AiCaseScore, AiCaseScoreFailure, AiCaseScoreResponse, MedicalConsultationMeta };

export const AI_CASE_SCORE_FAILURES: readonly AiCaseScoreFailure[] = [
  "no_evidence",
  "red_policy",
  "provider_unavailable",
  "disabled",
  "invalid_output",
  "abstained",
  "stale_context",
  "timeout",
  "aborted",
  "busy",
];

const MAX_SOURCES = 10;
const MAX_LIMITATIONS = 12;
const MAX_TEXT = 400;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max = MAX_TEXT): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function isGuard(value: unknown): value is RevisionGuard {
  if (!isRecord(value)) return false;
  const counts = [value.contextRevision, value.evidenceRevision, value.authorityRevision, value.carePlanRevision];
  return counts.every(isCount) && Array.isArray(value.profileVersions) && value.profileVersions.every((v) => typeof v === "string");
}

function isTextList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => isText(item));
}

// ---------------------------------------------------------------------------
// Medical-consultation provenance (contract: src/contracts/medical-consultation.ts)
// ---------------------------------------------------------------------------

const MAX_MODEL_ID = 200;
const MAX_PIPELINE_IDENTITY = 400;
/** C0/C1 controls and bidi overrides/isolates: never part of a model or pipeline identifier. */
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;

const CONSULTATION_STATUSES: ReadonlySet<string> = new Set<MedicalConsultationMeta["status"]>(["consulted", "unavailable", "skipped"]);
/** Exhaustive by construction: a new contract failure must be listed here to be accepted. */
const AI_FAILURE_KEYS: Readonly<Record<AiFailure, true>> = {
  disabled: true,
  provider_unavailable: true,
  timeout: true,
  aborted: true,
  busy: true,
  invalid_output: true,
  no_evidence: true,
  stale_context: true,
};

const isIdentifier = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max && !UNPRINTABLE.test(value);
const isSafeCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isAiFailure = (value: unknown): value is AiFailure => typeof value === "string" && Object.hasOwn(AI_FAILURE_KEYS, value);

/**
 * Validated consultation metadata, rebuilt with only the contract fields, or
 * null. Anything malformed or missing is null: a status is never guessed, and a
 * "consulted" claim that also reports a failure is contradictory, so refused.
 */
export function parseConsultationMeta(value: unknown): MedicalConsultationMeta | null {
  if (!isRecord(value)) return null;
  const { status, specialistModel, brainModel, pipelineVersion, failureReason, durationMs, sourceCount } = value;
  if (typeof status !== "string" || !CONSULTATION_STATUSES.has(status)) return null;
  if (!isIdentifier(specialistModel, MAX_MODEL_ID) || !isIdentifier(brainModel, MAX_MODEL_ID)) return null;
  if (!isIdentifier(pipelineVersion, MAX_MODEL_ID)) return null;
  if (failureReason !== null && !isAiFailure(failureReason)) return null;
  if (!isSafeCount(durationMs) || !isSafeCount(sourceCount)) return null;
  if (status === "consulted" && failureReason !== null) return null;
  return {
    status: status as MedicalConsultationMeta["status"],
    specialistModel,
    brainModel,
    pipelineVersion,
    failureReason,
    durationMs,
    sourceCount,
  };
}

/** The generation pipeline identity, kept only as a bounded printable string. */
export function parsePipelineIdentity(value: unknown): string | null {
  return isIdentifier(value, MAX_PIPELINE_IDENTITY) ? value : null;
}

/** A genuine estimate: integer 0..100, "needs_review", dated, sourced, with its model. */
export function parseAiCaseScore(value: unknown): AiCaseScore | null {
  if (!isRecord(value)) return null;
  const score = value.value;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) return null;
  if (value.status !== "needs_review") return null;
  if (!isText(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) return null;
  if (!isText(value.model) || !isText(value.promptVersion)) return null;
  if (!isTextList(value.sourceIds, MAX_SOURCES) || value.sourceIds.length === 0) return null;
  if (new Set(value.sourceIds).size !== value.sourceIds.length) return null;
  if (!isTextList(value.limitations, MAX_LIMITATIONS)) return null;
  if (!isGuard(value.guard)) return null;
  // Optional provenance: kept only when valid; an invalid one never costs the estimate.
  const { consultation: rawConsultation, pipelineIdentity: rawIdentity, ...rest } = value;
  const consultation = parseConsultationMeta(rawConsultation);
  const pipelineIdentity = parsePipelineIdentity(rawIdentity);
  return {
    ...(rest as Omit<AiCaseScore, "consultation" | "pipelineIdentity">),
    ...(consultation ? { consultation } : {}),
    ...(pipelineIdentity ? { pipelineIdentity } : {}),
  };
}

function parseFailure(value: unknown): AiCaseScoreFailure | null {
  return typeof value === "string" && (AI_CASE_SCORE_FAILURES as readonly string[]).includes(value) ? (value as AiCaseScoreFailure) : null;
}

/**
 * Normalised response. An unparseable estimate is reported as `invalid_output`
 * (never displayed); an unknown reason is kept as null rather than invented.
 * A response-level consultation (failed/abstained estimate) is kept only when valid.
 */
export function parseAiCaseScoreResponse(payload: unknown): AiCaseScoreResponse {
  if (!isRecord(payload)) return { aiCaseScore: null, reason: "invalid_output", cached: false };
  const aiCaseScore = payload.aiCaseScore === null ? null : parseAiCaseScore(payload.aiCaseScore);
  const malformed = payload.aiCaseScore !== null && aiCaseScore === null;
  const consultation = parseConsultationMeta(payload.consultation);
  return {
    aiCaseScore,
    reason: malformed ? "invalid_output" : aiCaseScore ? null : parseFailure(payload.reason),
    cached: aiCaseScore !== null && payload.cached === true,
    ...(consultation ? { consultation } : {}),
  };
}

/** The dashboard's `patients[i].aiCaseScore` (absent on older servers), validated. */
export function dashboardAiCaseScore(patient: object): AiCaseScore | null {
  const value = (patient as { aiCaseScore?: unknown }).aiCaseScore;
  return value === undefined || value === null ? null : parseAiCaseScore(value);
}

const scorePath = (patientId: string): string => `/patients/${seg(patientId)}/ai-case-score`;

/** Current cached estimate for this clinician, without running the model. */
export async function getAiCaseScore(patientId: string, options?: RequestOptions): Promise<AiCaseScoreResponse> {
  const payload = await request<unknown>(scorePath(patientId), { ...options, expect: ["aiCaseScore"] });
  return parseAiCaseScoreResponse(payload);
}

/** Explicit doctor request. `clientId` is one idempotency key per click. */
export async function requestAiCaseScore(patientId: string, clientId: string, options?: RequestOptions): Promise<AiCaseScoreResponse> {
  const payload = await request<unknown>(scorePath(patientId), {
    ...aiOptions(options),
    method: "POST",
    json: { clientId },
    expect: ["aiCaseScore"],
  });
  return parseAiCaseScoreResponse(payload);
}
