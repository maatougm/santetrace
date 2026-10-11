import { createHash } from "node:crypto";
import type { Actor } from "../contracts/care";
import type { AiMeta, AiFailure, EvidenceSnapshot, FactInput, FactCorrection, MedicalFact, OnboardingInput, OnboardingResponse, GenerationOptions, ProposalGenerationResponse, ReportResponse, ValidatedOutput, GroundedPrompt, RevisionGuard, CareProposal } from "../contracts/monitoring";
import { CareError } from "./care-service";
import { careId, type CareStoreAdapter, type CareState } from "./care-store";
import { requirePatientCapability, currentGuard, bumpPatientRevision, journalAccess } from "./patient-access-service";
import { buildAuthorizedEvidence, validateGroundedOutput, redactEvidenceForModel, restoreModelSourceIds, renderGroundedClaims } from "./medical-evidence";
import { AI_SCHEMA_VERSION, AI_PROMPT_VERSION, CLAIM_CODES, ONBOARDING_QUESTIONS, deterministicOutput, questionsFor, object, exactKeys } from "./monitoring-content";
import { LocalModelError, ModelOperationGate, type LocalModel } from "./local-model";
import { unwrapMedicalConsultation } from "./medical-consultation";
import type { MedicalConsultationMeta } from "../contracts/medical-consultation";
function fail(code: string, status = 400): never { throw new CareError(status, code, "La demande ne peut pas être traitée."); }
function canonical(value: unknown): string { return JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v); }
function replay<T>(s: CareState, key: string, input: unknown, action: () => T): T { const hash = createHash("sha256").update(canonical(input)).digest("hex"); const previous = s.idempotency[key]; if (previous) {
    if (previous.hash !== hash)
        fail("IDEMPOTENCY_CONFLICT", 409);
    return structuredClone(previous.result) as T;
} const result = action(); s.idempotency[key] = { hash, result: structuredClone(result) }; return result; }
function bounded(v: unknown, max: number, nullable = false) { if (nullable && v === null)
    return; if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))
    fail("INVALID_INPUT"); }
function validateFact(input: FactInput, correction = false) { let v: Record<string, unknown>; try {
    v = object(input);
    exactKeys(v, correction ? ["kind", "code", "label", "value", "polarity", "expectedContextRevision", "clientId", "expectedRevision", "reason"] : ["kind", "code", "label", "value", "polarity", "expectedContextRevision", "clientId"]);
}
catch {
    fail("INVALID_INPUT");
} if (!["condition", "symptom", "treatment", "allergy"].includes(input.kind) || !["affirmed", "negated", "uncertain", "unknown"].includes(input.polarity) || !Number.isSafeInteger(input.expectedContextRevision) || input.expectedContextRevision < 0)
    fail("INVALID_INPUT"); bounded(input.code, 80, true); if (input.code !== null && !(input.kind === "condition" ? ["hypertension", "diabetes"] : ["declared"]).includes(input.code))
    fail("INVALID_INPUT"); bounded(input.label, 200); bounded(input.value, 2000, true); bounded(input.clientId, 120); if (correction) {
    const c = input as FactCorrection;
    bounded(c.reason, 500);
    if (!Number.isSafeInteger(c.expectedRevision) || c.expectedRevision < 1)
        fail("INVALID_INPUT");
} }
function guardMatches(s: CareState, pid: string, guard: RevisionGuard) { if (canonical(currentGuard(s, pid)) !== canonical(guard))
    fail("STALE_CONTEXT", 409); }
function createFact(s: CareState, patientId: string, input: FactInput, now: string, old?: MedicalFact): MedicalFact { const id = careId(), revision = (old?.revision ?? 0) + 1; const f: MedicalFact = { id, patientId, kind: input.kind, code: input.code, label: input.label.trim(), value: input.value?.trim() ?? null, polarity: input.polarity, verification: "patient_reported", sources: [{ kind: "patient_fact", id, revision, contentHash: null, date: now, verification: "patient_reported", polarity: input.polarity }], revision, createdAt: now, supersededBy: null }; if (old) {
    old.supersededBy = id;
    f.correction = { correctsFactId: old.id, reason: (input as Partial<FactCorrection>).reason?.trim() ?? "onboarding answer replaced" };
} s.medicalFacts.push(f); return f; }
const generationGate = new ModelOperationGate();
type GenerationPurpose = "proposals" | "report";
type GenerationResponse = ProposalGenerationResponse | ReportResponse;
type InFlightGeneration = { fingerprint: string; task: Promise<GenerationResponse> };
// Share a reservation across HTTP-created service instances using the same store.
// Durable replay and authorization remain in the store transaction, not this map.
const inFlightGenerations = new WeakMap<CareStoreAdapter, Map<string, InFlightGeneration>>();
async function boundedGeneration(model: LocalModel, prompt: GroundedPrompt, options: GenerationOptions): Promise<unknown> {
    if (options.signal?.aborted)
        throw new LocalModelError("aborted");
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let release: (() => void) | undefined;
    let listener: () => void = () => { };
    try {
        return await Promise.race([(async () => { release = await generationGate.acquire(controller.signal); return model.generate(prompt, { timeoutMs: options.timeoutMs, signal: controller.signal }); })(), new Promise<never>((_, reject) => { listener = () => { controller.abort(); reject(new LocalModelError("aborted")); }; options.signal?.addEventListener("abort", listener, { once: true }); timeout = setTimeout(() => { controller.abort(); reject(new LocalModelError("timeout")); }, Math.max(1, Math.min(options.timeoutMs ?? 30000, 30000))); })]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
        options.signal?.removeEventListener("abort", listener);
        release?.();
    }
}
export class MonitoringAiService {
    constructor(private readonly store: CareStoreAdapter, private readonly model?: LocalModel, private readonly clock: () => string = () => new Date().toISOString()) { }
    recordFact(actor: Actor, patientId: string, input: FactInput): MedicalFact { validateFact(input); return this.store.transaction(s => { requirePatientCapability(s, actor, patientId, "owner"); return replay(s, JSON.stringify([actor.id, "medical_fact", patientId, input.clientId]), input, () => { if (currentGuard(s, patientId).contextRevision !== input.expectedContextRevision)
        fail("STALE_CONTEXT", 409); const fact = createFact(s, patientId, input, this.clock()); bumpPatientRevision(s, patientId, "context"); bumpPatientRevision(s, patientId, "evidence"); return structuredClone(fact); }); }); }
    correctFact(actor: Actor, id: string, input: FactCorrection): MedicalFact { validateFact(input, true); return this.store.transaction(s => { const old = s.medicalFacts.find(f => f.id === id); if (!old)
        fail("NOT_FOUND", 404); requirePatientCapability(s, actor, old.patientId, "owner"); return replay(s, JSON.stringify([actor.id, "fact_correction", id, input.clientId]), input, () => { if (old.supersededBy || old.revision !== input.expectedRevision || currentGuard(s, old.patientId).contextRevision !== input.expectedContextRevision)
        fail("STALE_CONTEXT", 409); const fact = createFact(s, old.patientId, input, this.clock(), old); bumpPatientRevision(s, old.patientId, "context"); bumpPatientRevision(s, old.patientId, "evidence"); return structuredClone(fact); }); }); }
    async onboarding(actor: Actor, patientId: string, input: OnboardingInput | null, options: GenerationOptions = {}): Promise<OnboardingResponse> {
        if (input !== null) {
            try {
                const v = object(input);
                exactKeys(v, ["answers", "expectedContextRevision", "clientId"]);
            }
            catch {
                fail("INVALID_INPUT");
            }
            bounded(input.clientId, 120);
            if (!Number.isSafeInteger(input.expectedContextRevision) || input.expectedContextRevision < 0 || !Array.isArray(input.answers) || !input.answers.length || input.answers.length > 16)
                fail("INVALID_INPUT");
            const seen = new Set<string>();
            for (const answer of input.answers) {
                try {
                    exactKeys(object(answer), ["questionId", "value", "polarity"]);
                }
                catch {
                    fail("INVALID_INPUT");
                }
                const q = ONBOARDING_QUESTIONS.find(q => q.id === answer.questionId);
                if (!q || seen.has(q.id) || !["affirmed", "negated", "uncertain", "unknown"].includes(answer.polarity))
                    fail("INVALID_INPUT");
                seen.add(q.id);
                if (q.answerKind === "boolean") {
                    if (answer.value !== null && typeof answer.value !== "boolean")
                        fail("INVALID_INPUT");
                    if (answer.value === false && answer.polarity === "affirmed" || answer.value === true && answer.polarity === "negated" || answer.value === null && !["unknown", "uncertain"].includes(answer.polarity))
                        fail("INVALID_INPUT");
                }
                else
                    bounded(answer.value, 2000, true);
            }
            this.store.transaction(s => { requirePatientCapability(s, actor, patientId, "owner"); replay(s, JSON.stringify([actor.id, "onboarding", patientId, input.clientId]), input, () => { if (currentGuard(s, patientId).contextRevision !== input.expectedContextRevision)
                fail("STALE_CONTEXT", 409); for (const a of input.answers) {
                const [kind, code] = a.questionId.split(".");
                const old = s.medicalFacts.find(f => f.patientId === patientId && f.kind === kind && f.code === code && !f.supersededBy);
                createFact(s, patientId, { kind: kind as MedicalFact["kind"], code, label: code, value: typeof a.value === "string" ? a.value : null, polarity: a.polarity, clientId: input.clientId, expectedContextRevision: input.expectedContextRevision }, this.clock(), old);
            } bumpPatientRevision(s, patientId, "context"); bumpPatientRevision(s, patientId, "evidence"); return { ok: true }; }); });
        }
        const snapshot = this.capture(actor, patientId, "onboarding");
        const { output, meta } = await this.generate(snapshot, "onboarding", options);
        const state = this.store.read();
        requirePatientCapability(state, actor, patientId, actor.role === "patient" ? "owner" : "manage");
        guardMatches(state, patientId, snapshot.guard);
        return { facts: snapshot.facts, questions: questionsFor(snapshot.facts).filter(q => q.required || !output.questionIds.length || output.questionIds.includes(q.id)), meta };
    }
    async generateProposals(actor: Actor, patientId: string, options: GenerationOptions = {}): Promise<ProposalGenerationResponse> {
        return this.generateWithReplay(actor, patientId, "proposals", options, (state, snapshot, output, meta) => {
            const access = requirePatientCapability(state, actor, patientId, actor.role === "patient" ? "owner" : "manage");
            // Required inputs are derived from trusted facts; model questions are suggestions.
            const requiresInputs = questionsFor(snapshot.facts).some(question => question.required);
            const proposals = output.proposals.map(draft => {
                const fingerprint = canonical({ action: draft.action, sources: draft.sources, guard: snapshot.guard });
                const existing = state.careProposals.find(proposal => proposal.patientId === patientId && ["pending", "needs_inputs", "needs_review"].includes(proposal.state) && canonical({ action: proposal.action, sources: proposal.sources, guard: proposal.guard }) === fingerprint);
                if (existing) return existing;
                const proposalState = requiresInputs ? "needs_inputs" : "needs_review";
                const proposal: CareProposal = {
                    id: careId(),
                    patientId,
                    revision: 1,
                    kind: draft.kind,
                    state: proposalState,
                    action: structuredClone(draft.action),
                    sources: structuredClone(draft.sources),
                    guard: structuredClone(snapshot.guard),
                    decision: null,
                    history: [{
                        revision: 1,
                        action: structuredClone(draft.action),
                        sources: structuredClone(draft.sources),
                        guard: structuredClone(snapshot.guard),
                        state: proposalState,
                        at: this.clock(),
                        author: actor.id,
                        reason: "generated_draft",
                    }],
                };
                state.careProposals.push(proposal);
                journalAccess(state, actor, patientId, "generate_proposal", "care_proposal", proposal.id, "allowed");
                return proposal;
            });
            return {
                proposals: proposals.map(proposal => access.canManageCare ? structuredClone(proposal) : { id: proposal.id, revision: proposal.revision, kind: proposal.kind, state: proposal.state }),
                meta,
            };
        });
    }

    async report(actor: Actor, patientId: string, options: GenerationOptions = {}): Promise<ReportResponse> {
        return this.generateWithReplay(actor, patientId, "report", options, (state, snapshot, output, meta) => {
            const sourceIds = new Set(output.claims.flatMap(claim => claim.sourceIds));
            const report = {
                id: careId(),
                patientId,
                revision: 1,
                guard: structuredClone(snapshot.guard),
                claims: output.claims,
                sources: snapshot.sources.filter(source => sourceIds.has(source.id)),
                createdAt: this.clock(),
                stale: false,
            };
            state.clinicianReports.push(report);
            journalAccess(state, actor, patientId, "generate_report", "clinician_report", report.id, "allowed");
            return { report: structuredClone(report), meta };
        });
    }

    private assertGenerationAccess(state: CareState, actor: Actor, patientId: string, purpose: GenerationPurpose): void {
        if (purpose === "report") {
            if (actor.role !== "clinician") fail("FORBIDDEN", 403);
            requirePatientCapability(state, actor, patientId, "summary");
        } else {
            requirePatientCapability(state, actor, patientId, actor.role === "patient" ? "owner" : "manage");
        }
    }

    private savedGeneration<T extends GenerationResponse>(state: CareState, key: string, fingerprint: string, patientId: string): T | null {
        const previous = state.idempotency[key];
        if (!previous) return null;
        if (previous.hash !== fingerprint) fail("IDEMPOTENCY_CONFLICT", 409);
        const result = previous.result as T;
        guardMatches(state, patientId, result.meta.guard);
        return structuredClone(result);
    }

    private async generateWithReplay<T extends GenerationResponse>(
        actor: Actor,
        patientId: string,
        purpose: GenerationPurpose,
        options: GenerationOptions,
        commit: (state: CareState, snapshot: EvidenceSnapshot, output: ValidatedOutput, meta: AiMeta) => T,
    ): Promise<T> {
        if (options.clientId !== undefined) {
            bounded(options.clientId, 120);
            if (/[\u0000-\u001f\u007f]/.test(options.clientId)) fail("INVALID_INPUT");
        }
        const snapshot = this.capture(actor, patientId, purpose);
        const key = options.clientId === undefined ? null : JSON.stringify([actor.id, patientId, purpose, options.clientId]);
        // Request bodies contain only clientId. Transport controls and source prose
        // are deliberately excluded from the semantic mutation fingerprint.
        const fingerprint = createHash("sha256").update(canonical({ purpose, schemaVersion: AI_SCHEMA_VERSION, promptVersion: AI_PROMPT_VERSION, ...(this.model?.cacheIdentity ? { pipelineIdentity: this.model.cacheIdentity } : {}) })).digest("hex");
        let reservations = inFlightGenerations.get(this.store);
        if (!reservations) {
            reservations = new Map();
            inFlightGenerations.set(this.store, reservations);
        }
        if (key) {
            const state = this.store.read();
            this.assertGenerationAccess(state, actor, patientId, purpose);
            const saved = this.savedGeneration<T>(state, key, fingerprint, patientId);
            if (saved) return saved;
            const active = reservations.get(key);
            if (active) {
                if (active.fingerprint !== fingerprint) fail("IDEMPOTENCY_CONFLICT", 409);
                const result = await active.task as T;
                const current = this.store.read();
                this.assertGenerationAccess(current, actor, patientId, purpose);
                guardMatches(current, patientId, result.meta.guard);
                return structuredClone(result);
            }
        }

        const task = (async () => {
            const { output, meta } = await this.generate(snapshot, purpose, options);
            return this.store.transaction(state => {
                this.assertGenerationAccess(state, actor, patientId, purpose);
                guardMatches(state, patientId, snapshot.guard);
                if (key) {
                    // A second process may have committed while this model ran.
                    const saved = this.savedGeneration<T>(state, key, fingerprint, patientId);
                    if (saved) return saved;
                }
                const result = commit(state, snapshot, output, meta);
                if (key) state.idempotency[key] = { hash: fingerprint, result: structuredClone(result) };
                return result;
            });
        })();
        if (key) reservations.set(key, { fingerprint, task });
        try {
            const result = await task;
            const current = this.store.read();
            this.assertGenerationAccess(current, actor, patientId, purpose);
            guardMatches(current, patientId, result.meta.guard);
            return structuredClone(result);
        } finally {
            if (key && reservations.get(key)?.task === task) reservations.delete(key);
        }
    }
    private capture(actor: Actor, patientId: string, purpose: GroundedPrompt["purpose"]) { const s = this.store.read(); if (purpose === "report") {
        if (actor.role !== "clinician")
            fail("FORBIDDEN", 403);
        requirePatientCapability(s, actor, patientId, "summary");
    }
    else
        requirePatientCapability(s, actor, patientId, actor.role === "patient" ? "owner" : "manage"); return buildAuthorizedEvidence(s, actor, patientId); }
    private async generate(snapshot: EvidenceSnapshot, purpose: GroundedPrompt["purpose"], options: GenerationOptions): Promise<{
        output: ValidatedOutput;
        meta: AiMeta;
    }> {
        // Fallback is held to the same closed source/provenance schema as a model.
        const fallback = validateGroundedOutput(deterministicOutput(snapshot), snapshot);
        let output: ValidatedOutput = fallback, mode: AiMeta["mode"] = "deterministic", failureReason: AiFailure | null = null;
        let consultation: MedicalConsultationMeta | undefined;
        const state = this.store.read();
        const red = state.alerts.some(a => a.patientId === snapshot.patientId && a.priority === "red" && ["new", "acknowledged"].includes(a.status));
        if (!red) {
            if (!this.model)
                failureReason = "disabled";
            else if (!snapshot.sources.some(s => s.kind !== "reference"))
                failureReason = "no_evidence";
            else
                try {
                    const redacted = redactEvidenceForModel(snapshot);
                    const value = await boundedGeneration(this.model, { purpose, schemaVersion: AI_SCHEMA_VERSION, promptVersion: AI_PROMPT_VERSION, snapshot: redacted.snapshot, allowedCodes: [...CLAIM_CODES] }, options);
                    const result = unwrapMedicalConsultation(value);
                    consultation = result.consultation;
                    output = validateGroundedOutput(restoreModelSourceIds(result.output, snapshot, redacted.aliasToId), snapshot);
                    mode = this.model.generationMode ?? "local_model";
                }
                catch (error) {
                    failureReason = error instanceof LocalModelError ? error.reason : "invalid_output";
                    if (error instanceof LocalModelError) consultation = error.consultation;
                }
        }
        // Examinations and hypotheses are clinician drafts; never turn model output into medical facts.
        return { output: { ...output, claims: renderGroundedClaims(output.claims, snapshot) }, meta: { mode, model: mode !== "deterministic" ? this.model?.model ?? (mode === "cloud_model" ? "cloud" : "local") : null, schemaVersion: AI_SCHEMA_VERSION, promptVersion: AI_PROMPT_VERSION, guard: structuredClone(snapshot.guard), generatedAt: this.clock(), stale: false, failureReason, ...(consultation ? { consultation } : {}), ...(this.model?.cacheIdentity ? { pipelineIdentity: this.model.cacheIdentity } : {}) } };
    }
}
