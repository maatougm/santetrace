import type { Actor } from "../contracts/care";
import type { CareState } from "./care-store";
import type { EvidenceSnapshot, SourceRef, GroundedClaim, ProposalDraft, ValidatedOutput } from "../contracts/monitoring";
import { currentGuard, requirePatientCapability } from "./patient-access-service";
import { CLAIM_CODES, ONBOARDING_QUESTIONS, REFERENCE_SOURCE, REFERENCE_TEXT, object, exactKeys, validateActionTemplate, actionTemplateDefinition, claimCategoryForSource } from "./monitoring-content";
export function buildAuthorizedEvidence(state: CareState, actor: Actor, patientId: string): EvidenceSnapshot {
    requirePatientCapability(state, actor, patientId, "summary");
    const patient = state.patients.find(p => p.id === patientId)!;
    if (!patient.fictional)
        throw new Error("Fictional demonstration required");
    const facts = state.medicalFacts.filter(f => f.patientId === patientId && !f.supersededBy).map(f => structuredClone(f));
    const measurements = state.measurements.filter(m => m.patientId === patientId).map(m => structuredClone(m));
    const sources: SourceRef[] = [];
    const chunks: EvidenceSnapshot["chunks"] = [];
    function add(source: SourceRef, text: string) { sources.push(source); chunks.push({ id: `${source.kind}:${source.id}:${source.revision}`, source, text: text.slice(0, 4000), extractionVersion: "source-v1" }); }
    for (const f of facts)
        add({ kind: "patient_fact", id: f.id, revision: f.revision, contentHash: null, date: f.createdAt, verification: f.verification, polarity: f.polarity }, JSON.stringify({ kind: f.kind, code: f.code, label: f.label, value: f.value, polarity: f.polarity }));
    for (const m of measurements)
        add({ kind: "measurement", id: m.id, revision: 1, contentHash: null, date: m.measuredAt, verification: m.connector?.quality === "suspect" ? "candidate" : m.source === "simulated" || m.connector?.simulated ? "simulated" : "patient_reported", polarity: "affirmed" }, JSON.stringify(m.kind === "blood_pressure" ? { kind: m.kind, systolic: m.systolic, diastolic: m.diastolic, unit: m.unit } : { kind: m.kind, value: m.value, unit: m.unit }));
    for (const o of state.observations.filter(o => o.patientId === patientId)) {
        const d = state.documents.find(d => d.id === o.documentId && d.patientId === patientId);
        if (!d)
            continue;
        add({ kind: "observation", id: o.id, revision: 1 + o.revisions.length, contentHash: d.contentHash ?? null, date: o.examDate, verification: "confirmed", polarity: "affirmed", documentId: o.documentId }, JSON.stringify({ exam: o.exam, value: o.value, unit: o.unit }));
    }
    for (const c of state.candidates.filter(c => c.patientId === patientId && c.status === "proposed")) {
        const d = state.documents.find(d => d.id === c.documentId && d.patientId === patientId);
        if (!d)
            continue;
        add({ kind: "candidate", id: c.id, revision: 1, contentHash: d.contentHash ?? null, date: c.examDate ?? d.uploadedAt, verification: "candidate", polarity: "unknown", documentId: c.documentId, page: c.page, quote: c.sourceText.slice(0, 1000) }, JSON.stringify({ exam: c.exam, value: c.value, unit: c.unit, sourceText: c.sourceText.slice(0, 1000) }));
    }
    for (const n of state.externalNotes.filter(n => n.patientId === patientId))
        add({ kind: "external_note", id: n.id, revision: 1, contentHash: null, date: n.consultationDate ?? n.receivedAt, verification: "external_unverified", polarity: "unknown" }, n.text);
    add({ ...REFERENCE_SOURCE }, REFERENCE_TEXT);
    return { patientId, guard: currentGuard(state, patientId), sources, chunks, facts, measurements, coverage: [...new Set(state.conditionEvaluations.filter(e => e.patientId === patientId).flatMap(e => e.coverage))] };
}
function canonical(value: unknown): string { return JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v); }
const allowedCategory = claimCategoryForSource;
export function validateGroundedOutput(value: unknown, snapshot: EvidenceSnapshot): ValidatedOutput {
    const v = object(value);
    exactKeys(v, ["claims", "questionIds", "proposals"]);
    if (!Array.isArray(v.claims) || v.claims.length > 10 || !Array.isArray(v.questionIds) || v.questionIds.length > 16 || !Array.isArray(v.proposals) || v.proposals.length > 10)
        throw new Error("Invalid output bounds");
    const sources = new Map(snapshot.sources.map(s => [s.id, s]));
    if (sources.size !== snapshot.sources.length)
        throw new Error("Ambiguous source namespace");
    const ids = (value: unknown): string[] => { if (!Array.isArray(value) || value.length > 16 || value.some(id => typeof id !== "string" || !sources.has(id)) || new Set(value).size !== value.length)
        throw new Error("Invalid sources"); return value as string[]; };
    const questions = (value: unknown): string[] => { if (!Array.isArray(value) || value.length > 16 || value.some(id => !ONBOARDING_QUESTIONS.some(q => q.id === id)) || new Set(value).size !== value.length)
        throw new Error("Invalid questions"); return value as string[]; };
    const claims = v.claims.map(raw => {
        const c = object(raw);
        exactKeys(c, ["category", "code", "parameters", "sourceIds"]);
        if (typeof c.code !== "string" || !CLAIM_CODES.includes(c.code as typeof CLAIM_CODES[number]))
            throw new Error("Unknown claim");
        const params = object(c.parameters);
        const sourceIds = ids(c.sourceIds);
        if (c.code === "missing_context") {
            if (c.category !== "missing" || sourceIds.length)
                throw new Error("Invalid missing claim");
            exactKeys(params, []);
        }
        else if (c.code === "hypothesis_review") {
            if (c.category !== "hypothesis" || sourceIds.length !== 2 || !sourceIds.some(id => sources.get(id)!.kind === "reference") || !sourceIds.some(id => snapshot.facts.some(f => f.id === id && f.kind === "condition" && f.polarity === "affirmed")))
                throw new Error("Unsupported hypothesis");
            exactKeys(params, []);
        }
        else {
            if (sourceIds.length !== 1)
                throw new Error("A source is required");
            const s = sources.get(sourceIds[0])!;
            const kind = { fact_statement: "patient_fact", measurement_value: "measurement", lab_value: "observation", candidate_value: "candidate", external_note: "external_note" }[c.code];
            if (s.kind !== kind || c.category !== allowedCategory(s))
                throw new Error("Invalid provenance");
            if (c.code === "fact_statement") {
                exactKeys(params, ["polarity"]);
                if (params.polarity !== s.polarity)
                    throw new Error("Invalid polarity");
            }
            else
                exactKeys(params, []);
        }
        return { category: c.category, code: c.code, parameters: params, sourceIds } as GroundedClaim;
    });
    const proposals = v.proposals.map(raw => {
        const p = object(raw);
        exactKeys(p, ["kind", "action", "sources", "missingQuestionIds"]);
        const action = validateActionTemplate(p.action);
        if (actionTemplateDefinition(action.templateId).kind !== p.kind)
            throw new Error("Invalid proposal kind");
        if (!Array.isArray(p.sources) || p.sources.length > 16 || !p.sources.length)
            throw new Error("Sources required");
        const refs = p.sources.map(raw => { const ref = object(raw); if (typeof ref.id !== "string")
            throw new Error("Invalid reference"); const trusted = sources.get(ref.id); if (!trusted || canonical(ref) !== canonical(trusted))
            throw new Error("Forged source reference"); return structuredClone(trusted); });
        if (p.kind !== "information") {
            const code = action.templateId === "home.blood_pressure" ? "hypertension" : action.templateId === "home.glucose" ? "diabetes" : null;
            if (!refs.some(s => s.kind === "reference") || !refs.some(s => snapshot.facts.some(f => f.id === s.id && f.kind === "condition" && f.polarity === "affirmed" && ["confirmed", "patient_reported"].includes(f.verification) && (code ? f.code === code : ["hypertension", "diabetes"].includes(f.code ?? "")))))
                throw new Error("No matching condition and reference support");
        }
        return { kind: p.kind, action, sources: refs, missingQuestionIds: questions(p.missingQuestionIds) } as ProposalDraft;
    });
    return { claims, questionIds: questions(v.questionIds), proposals };
}
/** Send only structured, bounded data and opaque aliases; no names/document prose. */
export function redactEvidenceForModel(snapshot: EvidenceSnapshot) {
    const aliasToId = new Map<string, string>();
    const aliases = new Map<string, string>();
    const selectedSources = [...snapshot.sources.filter(s => s.kind === "reference"), ...snapshot.sources.filter(s => s.kind !== "reference").sort((a, b) => b.date.localeCompare(a.date))].slice(0, 40);
    selectedSources.forEach((s, i) => { const alias = `source_${i + 1}`; aliases.set(s.id, alias); aliasToId.set(alias, s.id); });
    const ref = (s: SourceRef): SourceRef => ({ kind: s.kind, id: aliases.get(s.id)!, revision: s.revision, contentHash: null, date: s.date, verification: s.verification, polarity: s.polarity, ...(s.page !== undefined ? { page: s.page } : {}) });
    const facts = snapshot.facts.filter(f => aliases.has(f.id)).map((f, i) => ({ kind: f.kind, verification: f.verification, revision: f.revision, createdAt: f.createdAt, polarity: f.polarity, supersededBy: null, id: aliases.get(f.id)!, patientId: "fictional_patient", code: ["hypertension", "diabetes"].includes(f.code ?? "") ? f.code : null, label: ["hypertension", "diabetes"].includes(f.code ?? "") ? f.code! : "declared_item", value: null, sources: f.sources.filter(s => aliases.has(s.id)).map(ref) }));
    const measurements = snapshot.measurements.filter(m => aliases.has(m.id)).map(m => ({ id: aliases.get(m.id)!, patientId: "fictional_patient", kind: m.kind, unit: m.unit, measuredAt: m.measuredAt, capturedAt: m.capturedAt, receivedAt: m.receivedAt, source: m.source, status: m.status, clientId: "redacted", ruleVersion: "synthetic", ...(m.kind === "blood_pressure" ? { systolic: m.systolic, diastolic: m.diastolic } : { value: m.value }) })) as EvidenceSnapshot["measurements"];
    const redacted: EvidenceSnapshot = { patientId: "fictional_patient", guard: { ...snapshot.guard, profileVersions: snapshot.guard.profileVersions.map((_, i) => `profile_${i + 1}`) }, sources: selectedSources.map(ref), facts, measurements, chunks: [], coverage: snapshot.coverage };
    return { snapshot: redacted, aliasToId };
}
export function restoreModelSourceIds(value: unknown, snapshot: EvidenceSnapshot, aliases: Map<string, string>): unknown {
    const v = object(value);
    exactKeys(v, ["claims", "questionIds", "proposals"]);
    if (!Array.isArray(v.claims) || !Array.isArray(v.proposals))
        throw new Error("Invalid output");
    const id = (v: unknown) => { if (typeof v !== "string" || !aliases.has(v))
        throw new Error("Unknown source alias"); return aliases.get(v)!; };
    return { ...v, claims: v.claims.map(raw => { const c = object(raw); if (!Array.isArray(c.sourceIds))
            throw new Error("Invalid claims"); return { ...c, sourceIds: c.sourceIds.map(id) }; }), proposals: v.proposals.map(raw => { const p = object(raw); if (!Array.isArray(p.sources))
            throw new Error("Invalid proposals"); return { ...p, sources: p.sources.map(raw => { const r = object(raw); const original = snapshot.sources.find(s => s.id === id(r.id))!; const modelRef = redactEvidenceForModel(snapshot).snapshot.sources.find(s => s.id === r.id); if (canonical(r) !== canonical(modelRef))
                throw new Error("Forged model reference"); return original; }) }; }) };
}
/** Values are rendered from the authorized store snapshot, never copied from model parameters. */
export function renderGroundedClaims(claims: GroundedClaim[], snapshot: EvidenceSnapshot): GroundedClaim[] {
    return claims.map(claim => {
        const source = snapshot.sources.find(s => s.id === claim.sourceIds[0]);
        let parameters: GroundedClaim["parameters"] = { ...claim.parameters };
        if (claim.code === "fact_statement") {
            const f = snapshot.facts.find(f => f.id === source?.id);
            if (f)
                parameters = { polarity: f.polarity, label: f.label, ...(f.code ? { code: f.code } : {}), ...(f.value !== null ? { value: f.value } : {}) };
        }
        if (claim.code === "measurement_value") {
            const m = snapshot.measurements.find(m => m.id === source?.id);
            if (m)
                parameters = { kind: m.kind, unit: m.unit, measuredAt: m.measuredAt, ...(m.kind === "blood_pressure" ? { systolic: m.systolic, diastolic: m.diastolic } : { value: m.value }) };
        }
        if ((claim.code === "lab_value" || claim.code === "candidate_value") && source) {
            const chunk = snapshot.chunks.find(c => c.source.id === source.id);
            if (chunk) {
                const values = JSON.parse(chunk.text) as Record<string, unknown>;
                parameters = { date: source.date };
                for (const key of ["exam", "value", "unit"])
                    if (typeof values[key] === "string" || typeof values[key] === "number")
                        parameters[key] = values[key] as string | number;
            }
        }
        if (claim.code === "external_note" && source) {
            const chunk = snapshot.chunks.find(c => c.source.id === source.id);
            parameters = { verification: "external_unverified", ...(chunk ? { note: chunk.text } : {}) };
        }
        if (claim.code === "hypothesis_review")
            parameters = { labelKey: "hypothesis.review_required", referenceVersion: 1 };
        return { ...claim, parameters };
    });
}
