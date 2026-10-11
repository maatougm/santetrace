import type { AiFailure, ValidatedOutput } from "./monitoring";

export type MedicalConsultationMeta = {
  status: "consulted" | "unavailable" | "skipped";
  specialistModel: string;
  brainModel: string;
  pipelineVersion: string;
  failureReason: AiFailure | null;
  durationMs: number;
  sourceCount: number;
};
/** Advisory selections remain separate from the original admitted evidence. */
export type MedicalAdvisory = { advisoryOnly: true; output: ValidatedOutput };
