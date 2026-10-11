import type { EvidenceSnapshot, RevisionGuard } from "./monitoring";
import type { MedicalAdvisory, MedicalConsultationMeta } from "./medical-consultation";

/** Experimental case attention estimate. Never a validated risk probability or care authority. */
export type AiCaseScore = {
  id: string; patientId: string; clinicianId: string; value: number; status: "needs_review";
  sourceIds: string[]; createdAt: string; guard: RevisionGuard; model: string;
  promptVersion: string; limitations: string[]; evidenceFingerprint: string; consultation?: MedicalConsultationMeta; pipelineIdentity?: string;
};
export type AiCaseScoreFailure = "no_evidence" | "red_policy" | "provider_unavailable" | "disabled" | "invalid_output" | "abstained" | "stale_context" | "timeout" | "aborted" | "busy";
export type AiCaseScoreResponse = { aiCaseScore: AiCaseScore | null; reason: AiCaseScoreFailure | null; cached: boolean; consultation?: MedicalConsultationMeta };
export type AiCaseScorePrompt = { purpose: "case_attention_estimate"; promptVersion: string; snapshot: EvidenceSnapshot; medicalAdvisory?: MedicalAdvisory };
