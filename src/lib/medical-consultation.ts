import type { AiCaseScorePrompt } from "../contracts/ai-case-score";
import type { MedicalConsultationMeta } from "../contracts/medical-consultation";
import type { EvidenceSnapshot, GenerationOptions, GroundedPrompt, ValidatedOutput } from "../contracts/monitoring";
import { LocalModelError, ModelOperationGate, type LocalModel } from "./local-model";
import { validateGroundedOutput } from "./medical-evidence";
import { AI_SCHEMA_VERSION, CLAIM_CODES } from "./monitoring-content";
import { medicalPipelineIdentity, MEDICAL_PIPELINE_VERSION } from "./generation-identity";

/** A provider JSON object cannot forge this internal per-call envelope. */
class ConsultedOutput {
  constructor(readonly output: unknown, readonly consultation: MedicalConsultationMeta) {}
}
export function unwrapMedicalConsultation(value: unknown): { output: unknown; consultation?: MedicalConsultationMeta } {
  return value instanceof ConsultedOutput ? { output: value.output, consultation: structuredClone(value.consultation) } : { output: value };
}

function admittedSnapshot(snapshot: EvidenceSnapshot): EvidenceSnapshot {
  const sources = snapshot.sources.filter(source => source.kind === "reference" || (["patient_fact", "measurement"].includes(source.kind) && ["confirmed", "patient_reported", "simulated"].includes(source.verification)));
  const ids = new Set(sources.map(source => source.id));
  return { ...structuredClone(snapshot), sources: structuredClone(sources), chunks: [], facts: snapshot.facts.filter(fact => ids.has(fact.id)).map(fact => structuredClone(fact)), measurements: snapshot.measurements.filter(measurement => ids.has(measurement.id)).map(measurement => structuredClone(measurement)) };
}
const consultationGate = new ModelOperationGate();
type ConsultationConfig = { specialistTimeoutMs?: number; totalTimeoutMs?: number };

/** Local specialist selects supported medical context; the cloud brain owns final closed-schema output. */
export class MedicalConsultationModel implements LocalModel {
  readonly model: string;
  readonly cacheIdentity: string;
  readonly generationMode = "cloud_model" as const;
  constructor(private readonly brain: LocalModel, private readonly specialist: LocalModel, private readonly config: ConsultationConfig = {}) {
    if (!brain.model || !specialist.model) throw new LocalModelError("provider_unavailable");
    this.model = brain.model;
    this.cacheIdentity = medicalPipelineIdentity(brain.model, specialist.model);
  }
  async generate(prompt: GroundedPrompt, options: GenerationOptions = {}): Promise<unknown> {
    // Patient onboarding is outside the clinician consultation; preserve its existing path.
    if (prompt.purpose === "onboarding") return this.brain.generate(prompt, options);
    return this.run(prompt.snapshot, options, async (advisory, nextOptions) => this.brain.generate({ ...prompt, ...(advisory ? { medicalAdvisory: { advisoryOnly: true, output: advisory } } : {}) }, nextOptions));
  }
  async generateCaseScore(prompt: AiCaseScorePrompt, options: GenerationOptions = {}): Promise<unknown> {
    if (!this.brain.generateCaseScore) throw new LocalModelError("provider_unavailable");
    return this.run(prompt.snapshot, options, (advisory, nextOptions) => this.brain.generateCaseScore!({ ...prompt, ...(advisory ? { medicalAdvisory: { advisoryOnly: true, output: advisory } } : {}) }, nextOptions));
  }
  async embed(_texts: string[], _options: GenerationOptions = {}): Promise<number[][]> { throw new LocalModelError("disabled"); }
  private async run(snapshot: EvidenceSnapshot, options: GenerationOptions, synthesize: (advisory: ValidatedOutput | null, options: GenerationOptions) => Promise<unknown>): Promise<unknown> {
    if (options.signal?.aborted) throw new LocalModelError("aborted");
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const totalBudget = Math.min(30_000, Math.max(1, options.timeoutMs ?? this.config.totalTimeoutMs ?? 30_000));
    const started = performance.now();
    let totalExpired = false;
    let release: (() => void) | undefined;
    const consultation: MedicalConsultationMeta = { status: "skipped", specialistModel: this.specialist.model!, brainModel: this.model, pipelineVersion: MEDICAL_PIPELINE_VERSION, failureReason: "no_evidence", durationMs: 0, sourceCount: 0 };
    const timer = setTimeout(() => { totalExpired = true; controller.abort(); }, totalBudget);
    let abortListener: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => { abortListener = () => reject(new LocalModelError(totalExpired ? "timeout" : "aborted")); controller.signal.addEventListener("abort", abortListener, { once: true }); });
    void aborted.catch(() => {}); // A queued gate rejection can precede the first phase race.
    // Gate is inside the same total deadline; queued work cannot extend the budget.
    try {
      release = await consultationGate.acquire(controller.signal);
      const admitted = admittedSnapshot(snapshot);
      let advisory: ValidatedOutput | null = null;
      if (admitted.sources.some(source => source.kind !== "reference")) {
        const phase = new AbortController();
        const cancelPhase = () => phase.abort();
        controller.signal.addEventListener("abort", cancelPhase, { once: true });
        const phaseStarted = performance.now();
        const specialistBudget = Math.min(8_000, Math.max(1, this.config.specialistTimeoutMs ?? 8_000), Math.max(1, totalBudget - (performance.now() - started)));
        let phaseExpired = false;
        let phaseAbortListener: (() => void) | undefined;
        const phaseAborted = new Promise<never>((_, reject) => { phaseAbortListener = () => reject(new LocalModelError(phaseExpired ? "timeout" : "aborted")); phase.signal.addEventListener("abort", phaseAbortListener, { once: true }); });
        const phaseTimer = setTimeout(() => { phaseExpired = true; phase.abort(); }, specialistBudget);
        try {
          const medicalPrompt: GroundedPrompt = { purpose: "report", schemaVersion: AI_SCHEMA_VERSION, promptVersion: MEDICAL_PIPELINE_VERSION, snapshot: admitted, allowedCodes: [...CLAIM_CODES] };
          const raw = await Promise.race([this.specialist.generate(medicalPrompt, { signal: phase.signal, timeoutMs: specialistBudget }), phaseAborted, aborted]);
          const candidate = validateGroundedOutput(raw, admitted);
          if (candidate.claims.length > 3 || candidate.questionIds.length || candidate.proposals.length) throw new LocalModelError("invalid_output");
          advisory = candidate;
          consultation.status = "consulted";
          consultation.failureReason = null;
          consultation.sourceCount = new Set(advisory.claims.flatMap(claim => claim.sourceIds)).size;
        } catch (error) {
          if (controller.signal.aborted) throw new LocalModelError(totalExpired ? "timeout" : "aborted");
          advisory = null;
          consultation.status = "unavailable";
          consultation.failureReason = error instanceof LocalModelError ? error.reason : "invalid_output";
        } finally {
          consultation.durationMs = Math.round(performance.now() - phaseStarted);
          clearTimeout(phaseTimer);
          controller.signal.removeEventListener("abort", cancelPhase);
          if (phaseAbortListener) phase.signal.removeEventListener("abort", phaseAbortListener);
          phase.abort();
        }
      }
      if (controller.signal.aborted) throw new LocalModelError(totalExpired ? "timeout" : "aborted");
      const remaining = Math.floor(totalBudget - (performance.now() - started));
      if (remaining <= 0) throw new LocalModelError("timeout");
      const output = await Promise.race([synthesize(advisory, { signal: controller.signal, timeoutMs: remaining }), aborted]);
      if (controller.signal.aborted) throw new LocalModelError(totalExpired ? "timeout" : "aborted");
      return new ConsultedOutput(output, structuredClone(consultation));
    } catch (error) {
      const reason = totalExpired ? "timeout" : options.signal?.aborted ? "aborted" : error instanceof LocalModelError ? error.reason : "provider_unavailable";
      throw new LocalModelError(reason, structuredClone(consultation));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
      controller.abort();
      release?.();
    }
  }
}
