import type { ActionTemplate, MedicalFact, OnboardingQuestion, ProposalDraft, EvidenceSnapshot, GroundedClaim, SourceRef, ValidatedOutput } from "../contracts/monitoring";
export const AI_SCHEMA_VERSION = "monitoring-grounded-v1";
export const AI_PROMPT_VERSION = "monitoring-synthetic-v1";
export const CLAIM_CODES = ["fact_statement", "measurement_value", "lab_value", "candidate_value", "external_note", "missing_context", "hypothesis_review"] as const;
export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
    { id: "condition.hypertension", labelKey: "onboarding.hypertension", answerKind: "boolean", allowedValues: [], required: true },
    { id: "condition.diabetes", labelKey: "onboarding.diabetes", answerKind: "boolean", allowedValues: [], required: true },
    { id: "allergy.declared", labelKey: "onboarding.allergy", answerKind: "text", allowedValues: [], required: false },
    { id: "treatment.declared", labelKey: "onboarding.treatment", answerKind: "text", allowedValues: [], required: false },
    { id: "symptom.declared", labelKey: "onboarding.symptom", answerKind: "text", allowedValues: [], required: false },
];
export const REFERENCE_SOURCE = { kind: "reference" as const, id: "reference:synthetic-monitoring:v1", revision: 1, contentHash: null, date: "2026-10-11T00:00:00.000Z", verification: "reference" as const, polarity: "affirmed" as const };
export const REFERENCE_TEXT = "Synthetic demonstration template v1. Declared conditions require clinician assessment. Home measurement and examination proposals require explicit clinician review. This is a fictional demonstration reference, not a clinical guideline.";
const registry = {
    "information.review": { kind: "information" as const, patientText: { fr: "Préparer les informations pour la revue du médecin.", ar: "تحضير المعلومات لمراجعة الطبيب." }, parameters: [] as string[] },
    "home.blood_pressure": { kind: "home_measurement" as const, patientText: { fr: "Mesurer la tension selon le plan approuvé.", ar: "قياس ضغط الدم حسب الخطة المعتمدة." }, parameters: [] as string[] },
    "home.glucose": { kind: "home_measurement" as const, patientText: { fr: "Mesurer la glycémie selon le plan approuvé.", ar: "قياس السكر حسب الخطة المعتمدة." }, parameters: [] as string[] },
    "exam.clinician_review": { kind: "lab_exam" as const, patientText: { fr: "Examen à définir lors de la revue médicale.", ar: "فحص يحدده الطبيب أثناء المراجعة." }, parameters: [] as string[] },
};
export function actionTemplateDefinition(id: string) { if (!Object.hasOwn(registry, id))
    throw new Error("Unknown action template"); return structuredClone(registry[id as keyof typeof registry]); }
export function validateActionTemplate(value: unknown): ActionTemplate {
    const v = object(value);
    exactKeys(v, ["templateId", "templateVersion", "parameters"]);
    if (typeof v.templateId !== "string" || v.templateVersion !== 1)
        throw new Error("Invalid template");
    const definition = actionTemplateDefinition(v.templateId);
    const params = object(v.parameters);
    exactKeys(params, definition.parameters);
    return { templateId: v.templateId, templateVersion: 1, parameters: {} };
}
export function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype)
    throw new Error("Expected object"); return v as Record<string, unknown>; }
export function exactKeys(v: Record<string, unknown>, keys: readonly string[]) { if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)))
    throw new Error("Unexpected fields"); }
/** Answered does not mean clinically resolved: unknown/uncertain stay in the evidence. */
export function questionsFor(facts: MedicalFact[]) { return ONBOARDING_QUESTIONS.filter(q => !facts.some(f => !f.supersededBy && f.kind === q.id.split(".")[0] && f.code === q.id.split(".")[1])).map(q => structuredClone(q)); }
/** Provenance is a server property shared by validation, fallback and adapter schema. */
export function claimCategoryForSource(source: Pick<SourceRef, "verification">): GroundedClaim["category"] {
    if (source.verification === "confirmed") return "confirmed_fact";
    if (source.verification === "candidate" || source.verification === "external_unverified") return "candidate";
    return "patient_statement";
}

export function deterministicOutput(snapshot: EvidenceSnapshot): ValidatedOutput {
    const questions = questionsFor(snapshot.facts);
    const questionIds = questions.map(question => question.id);
    const requiredQuestionIds = questions.filter(question => question.required).map(question => question.id);
    const sourceCodes = {
        patient_fact: "fact_statement",
        measurement: "measurement_value",
        observation: "lab_value",
        candidate: "candidate_value",
        external_note: "external_note",
    };
    // A missing-context marker also makes a bounded report excerpt explicit.
    const nonReferenceSources = snapshot.sources.filter(source => source.kind !== "reference");
    const incomplete = questionIds.length > 0 || nonReferenceSources.length > 10;
    const budget = 10 - (incomplete ? 1 : 0);
    const selectedSources = nonReferenceSources
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, budget);
    const claims = selectedSources.map<GroundedClaim>(source => {
        const parameters: GroundedClaim["parameters"] = {};
        if (source.kind === "patient_fact") parameters.polarity = source.polarity;
        return {
            category: claimCategoryForSource(source),
            code: sourceCodes[source.kind as keyof typeof sourceCodes],
            parameters,
            sourceIds: [source.id],
        };
    });
    if (incomplete) claims.push({ category: "missing", code: "missing_context", parameters: {}, sourceIds: [] });

    const proposals: ProposalDraft[] = [];
    const reference = snapshot.sources.find(source => source.id === REFERENCE_SOURCE.id && source.kind === "reference");
    for (const fact of snapshot.facts.filter(fact => fact.kind === "condition" && fact.polarity === "affirmed" && ["confirmed", "patient_reported"].includes(fact.verification))) {
        if (proposals.length >= 10) break;
        const source = snapshot.sources.find(source => source.kind === "patient_fact" && source.id === fact.id);
        if (!source || !reference) continue;
        const homeTemplate = fact.code === "hypertension" ? "home.blood_pressure" : fact.code === "diabetes" ? "home.glucose" : null;
        const templateIds = homeTemplate ? [homeTemplate, "exam.clinician_review"] : ["information.review"];
        // Keep known-condition pairs separate and complete within the closed budget.
        // The examination is a clinician draft; no test is automatically prescribed.
        if (proposals.length + templateIds.length > 10) break;
        for (const templateId of templateIds) {
            proposals.push({
                kind: actionTemplateDefinition(templateId).kind,
                action: { templateId, templateVersion: 1, parameters: {} },
                sources: [structuredClone(source), structuredClone(reference)],
                missingQuestionIds: [...requiredQuestionIds],
            });
        }
    }
    return { claims, questionIds, proposals };
}
