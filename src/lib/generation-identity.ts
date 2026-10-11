import type { LocalModel } from "./local-model";

export const MEDICAL_PIPELINE_VERSION = "source-bound-medical-consultation-v2";
export const DEFAULT_NVIDIA_GENERATION_ID = "google/gemma-4-31b-it";
export function medicalPipelineIdentity(brain: string, specialist: string): string {
  return `${brain}|medical=${specialist}|${MEDICAL_PIPELINE_VERSION}`;
}
export function modelCacheIdentity(model: LocalModel | undefined): string | undefined {
  return model?.cacheIdentity ?? model?.model;
}
/** Pure configuration identity; never loads a provider or reads/returns a credential. */
export function configuredGenerationIdentity(): { model: string; cacheIdentity: string } | null {
  if (process.env.HACKCURE_AI_PROVIDER !== "nvidia") return null;
  const model = process.env.HACKCURE_NVIDIA_MODEL ?? DEFAULT_NVIDIA_GENERATION_ID;
  if (![DEFAULT_NVIDIA_GENERATION_ID, "nvidia/nemotron-3-super-120b-a12b"].includes(model)) return null;
  if (process.env.HACKCURE_MEDICAL_SPECIALIST_ENABLED !== "true") return { model, cacheIdentity: model };
  const specialist = process.env.HACKCURE_MEDICAL_SPECIALIST_MODEL;
  if (!specialist || !/^[a-zA-Z0-9._:/-]{1,100}$/.test(specialist)) return null;
  return { model, cacheIdentity: medicalPipelineIdentity(model, specialist) };
}
