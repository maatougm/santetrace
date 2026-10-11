import type { Actor, Rules, Measurement, Alert, Status } from "../contracts/care";
import type { ReadingInput, MonitoringState, EvidenceSnapshot } from "../contracts/monitoring";
import { careId, type CareState, type CareStoreAdapter } from "./care-store";
import { CareError } from "./care-error";
import { fail, boundedText as text, replay } from "./monitoring-utils";
import { bumpPatientRevision, currentGuard, hasScope, journalAccess, projectPatientRecord, recordDeniedAccess, requirePatientReadScope, requirePatientCapability, resolvePatientAccess } from "./patient-access-service";
import { aggregateMonitoring, createDemoMonitoringProfiles, evaluateCondition } from "./monitoring-evaluation";
import { projectDoctorQueueSummary } from "./doctor-queue-summary";
import { currentAiCaseScore } from "./ai-case-score";
import { configuredGenerationIdentity } from "./generation-identity";
export { CareError } from "./care-error";
export function requireActor(actor: Actor | null): Actor { if (!actor)
    fail("UNAUTHENTICATED", "Connexion requise.", 401); return actor; }
export function requireClinician(actor: Actor) { if (actor.role !== "clinician")
    fail("FORBIDDEN", "Accès refusé.", 403); }
export function authorizePatient(state: CareState, actor: Actor, id: string) { resolvePatientAccess(state, actor, id); const p = state.patients.find(p => p.id === id)!; if (!p.consent)
    fail("CONSENT_REVOKED", "Consentement retiré.", 403); return p; }
export function audit(state: CareState, actor: Actor, action: string, subjectId: string, now = new Date().toISOString()) { state.audit.push({ actorId: actor.id, action, subjectId, at: now }); }
function num(value: unknown, min: number, max: number) { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    fail("INVALID_INPUT", "Valeur numérique invalide."); return value; }
function date(value: unknown) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    fail("INVALID_TIME", "Date avec fuseau horaire requise."); return new Date(value).toISOString(); }
export function evaluateMeasurement(m: Pick<Measurement, "kind" | "systolic" | "diastolic" | "value" | "unit">, rules: Rules): {
    status: Status;
    reason: string;
} {
    const evidence: string[] = [];
    let status: Status = "green";
    const check = (label: string, v: number, warn: number, high: number, unit: string) => { if (v >= high) {
        status = "red";
        evidence.push(`${label} ${v} ${unit} >= ${high} ${unit} (red)`);
    }
    else if (v >= warn) {
        if (status !== "red")
            status = "orange";
        evidence.push(`${label} ${v} ${unit} >= ${warn} ${unit} (orange)`);
    } };
    if (m.kind === "pulse")
        return { status: "unknown", reason: "Pulse recorded in bpm; no demonstration scoring profile." };
    if (m.kind === "blood_pressure") {
        check("Systolic", m.systolic!, rules.systolicWarn, rules.systolicHigh, "mmHg");
        check("Diastolic", m.diastolic!, rules.diastolicWarn, rules.diastolicHigh, "mmHg");
    }
    else {
        const value = m.unit === rules.glucoseUnit ? m.value! : m.unit === "mmol/L" ? m.value! * 18 : m.value! / 18;
        check("Glucose", value, rules.glucoseWarn, rules.glucoseHigh, rules.glucoseUnit);
        if (m.unit !== rules.glucoseUnit)
            evidence.unshift(`Conversion: ${m.value} ${m.unit} = ${value} ${rules.glucoseUnit} (factor 18)`);
    }
    return { status, reason: `Demo rule ${rules.version}: ${evidence.join("; ") || "No demonstration threshold crossed"}` };
}
export function patientMessage(status: Status, language: "fr" | "ar") { const messages = { fr: { red: "Mesure au-dessus du seuil de démonstration. Contactez un professionnel de santé. En cas de symptômes graves, sollicitez les urgences locales. Aucun contact soignant n’est garanti par cette application.", orange: "Mesure au-dessus du seuil de suivi de démonstration. À revoir avec un professionnel de santé.", green: "Aucun seuil haut de démonstration dépassé pour cette mesure. Cela ne remplace pas un avis médical.", unknown: "Données insuffisantes ou mesure non évaluée. Un avis médical reste nécessaire." }, ar: { red: "القياس أعلى من الحد التجريبي. اتصل بطبيب أو بأحد العاملين في الرعاية الصحية. في حالة أعراض خطيرة، اطلب خدمات الطوارئ المحلية. التطبيق لا يضمن اتصال الطبيب.", orange: "القياس أعلى من حد المتابعة التجريبي. راجعه مع طبيب أو أحد العاملين في الرعاية الصحية.", green: "لم يتجاوز هذا القياس الحدود العليا التجريبية. هذا لا يعوض الرأي الطبي.", unknown: "البيانات غير كافية أو القياس غير مقيّم. تبقى مراجعة الطبيب ضرورية." } }; return { text: messages[language][status], status, ai: false as const }; }
export function refreshMonitoring(state: CareState, id: string, now = new Date().toISOString()): MonitoringState {
    const patient = state.patients.find(p => p.id === id)!;
    for (const profile of createDemoMonitoringProfiles(patient.rules))
        if (!state.monitoringProfiles.some(p => p.id === profile.id && p.version === profile.version))
            state.monitoringProfiles.push(profile);
    const guard = currentGuard(state, id), facts = state.medicalFacts.filter(f => f.patientId === id && !f.supersededBy), measurements = state.measurements.filter(m => m.patientId === id);
    const evidence: EvidenceSnapshot = { patientId: id, guard, facts, measurements, chunks: [], coverage: [], sources: measurements.map(m => ({ kind: "measurement", id: m.id, revision: 1, contentHash: null, date: m.measuredAt, verification: m.source === "simulated" || m.connector?.simulated ? "simulated" : "patient_reported", polarity: "affirmed" })) };
    const plan = state.carePlans.find(p => p.patientId === id) ?? null;
    // An explicit absence is retained as evidence, not treated as a disease to monitor.
    // Unknown or uncertain declarations still retain their visible coverage gaps.
    const evaluations = facts.filter(f => f.kind === "condition" && f.polarity !== "negated").map(condition => { const binding = plan?.profileBindings.find(b => b.conditionFactId === condition.id), profile = binding ? state.monitoringProfiles.find(p => p.id === binding.profileId && p.version === binding.profileVersion) ?? null : null; return evaluateCondition({ condition, profile, plan, evidence, guard }, now); });
    state.conditionEvaluations = state.conditionEvaluations.filter(e => e.patientId !== id).concat(evaluations);
    const monitoring = aggregateMonitoring(evaluations, state.alerts.filter(a => a.patientId === id));
    patient.status = monitoring.priority;
    return monitoring;
}
/** Atomic common path for manual and connector readings; caller checks authority first. */
export function ingestReading(state: CareState, id: string, b: Record<string, unknown>, source: Measurement["source"] = "app", connector?: Measurement["connector"], now = new Date().toISOString()) {
    const patient = state.patients.find(p => p.id === id);
    if (!patient || !patient.consent)
        fail("CONSENT_REVOKED", "Capture indisponible.", 403);
    const measuredAt = date(b.measuredAt), capturedAt = b.capturedAt ? date(b.capturedAt) : measuredAt, at = Date.parse(now);
    if (Date.parse(measuredAt) > at + 300000)
        fail("FUTURE_TIME", "La mesure est datée dans le futur.");
    if (Date.parse(capturedAt) > at + 300000 || Date.parse(capturedAt) < Date.parse(measuredAt))
        fail("INVALID_TIME", "Horodatage de capture incohérent.");
    let reading: ReadingInput;
    if (b.kind === "blood_pressure") {
        if (b.unit !== "mmHg")
            fail("INVALID_UNIT", "Unité mmHg requise.");
        const systolic = num(b.systolic, 50, 300), diastolic = num(b.diastolic, 30, 200);
        if (systolic <= diastolic)
            fail("INVALID_BP", "La systolique doit dépasser la diastolique.");
        reading = { kind: "blood_pressure", systolic, diastolic, unit: "mmHg" };
    }
    else if (b.kind === "glucose") {
        if (b.unit !== "mg/dL" && b.unit !== "mmol/L")
            fail("INVALID_UNIT", "Unité de glucose explicite requise.");
        reading = { kind: "glucose", unit: b.unit, value: num(b.value, b.unit === "mg/dL" ? 20 : 1, b.unit === "mg/dL" ? 600 : 33.4) };
    }
    else if (b.kind === "pulse") {
        if (b.unit !== "bpm")
            fail("INVALID_UNIT", "Unité bpm requise.");
        reading = { kind: "pulse", unit: "bpm", value: num(b.value, 1, 300) };
    }
    else
        fail("INVALID_KIND", "Type de mesure invalide.");
    const evaluated = evaluateMeasurement(reading, patient.rules), status = connector?.quality === "suspect" ? "unknown" : evaluated.status;
    const measurement = { ...reading, id: careId(), patientId: id, measuredAt, capturedAt, receivedAt: now, clientId: text(b.clientId, 128), source, status, ruleVersion: patient.rules.version, ...(connector ? { connector } : {}), ...(at - Date.parse(measuredAt) > 24 * 3600000 ? { clockWarning: "Delayed measurement; measured and received times differ." } : {}) } as Measurement;
    state.measurements.push(measurement);
    bumpPatientRevision(state, id, "evidence");
    let alert: Alert | null = null;
    if (status === "red" || status === "orange") {
        alert = { id: careId(), patientId: id, measurementId: measurement.id, status: "new", priority: status, reason: evaluated.reason, ruleVersion: patient.rules.version, rulesSnapshot: { ...patient.rules }, createdAt: now, history: [] };
        state.alerts.push(alert);
    }
    return { measurement, alert, monitoring: refreshMonitoring(state, id, now), patientMessage: patientMessage(status, patient.language) };
}
export class CareService {
    constructor(public store: CareStoreAdapter) { }
    private transact<T>(actor: Actor, id: string, action: string, fn: (s: CareState) => T): T { try {
        return this.store.transaction(fn);
    }
    catch (e) {
        if (e instanceof CareError && [403, 404].includes(e.status))
            recordDeniedAccess(this.store, actor, id, action);
            if (e instanceof CareError && [403,404].includes(e.status)) e.accessJournalRecorded = true;
        throw e;
    } }
    login(_body: Record<string, unknown>): Actor { return fail("ENROLLMENT_RETIRED", "Utilisez le compte permanent du patient.", 410); }
    enroll(_actor: Actor, _b: Record<string, unknown>) { return fail("ENROLLMENT_RETIRED", "Le patient crée son propre compte.", 410); }
    invite(_actor: Actor, _id: string) { return fail("ENROLLMENT_RETIRED", "Utilisez les invitations de médecins.", 410); }
    dashboard(actor: Actor) {
        requireClinician(actor);
        return this.store.transaction(s => {
            if (!s.accounts.some(account => account.id === actor.id && account.role === "clinician" && account.enabled))
                fail("FORBIDDEN", "Accès médecin requis.", 403);
            const now = new Date().toISOString();
            const ids = [...new Set(s.careGrants.filter(grant => grant.clinicianId === actor.id && grant.state === "active" &&
                s.patients.some(patient => patient.id === grant.patientId && patient.consent)).map(grant => grant.patientId))];
            const records = ids.map(id => {
                refreshMonitoring(s, id, now);
                const record = projectPatientRecord(s, actor, id, now), queue = projectDoctorQueueSummary(s, actor, id, now);
                journalAccess(s, actor, id, "read_dashboard", "patient", id, "allowed");
                return { record, queue };
            });
            audit(s, actor, "read_dashboard", actor.id, now);
            const generation = configuredGenerationIdentity();
            return { patients: records.map(({ record, queue }) => ({ ...record.patient, access: record.access, monitoring: record.monitoring, queue, aiCaseScore: currentAiCaseScore(s, actor, record.patient.id, generation?.model, generation?.cacheIdentity) })),
                alerts: records.flatMap(({ record }) => record.alerts), serverTime: now,
                workerHeartbeat: Object.values(s.workerHeartbeats).sort().at(-1) ?? null };
        });
    }
    patient(actor: Actor, id: string) { return this.transact(actor, id, "read_patient", s => { resolvePatientAccess(s, actor, id); refreshMonitoring(s, id); const result = projectPatientRecord(s, actor, id); audit(s, actor, "read_patient", id); journalAccess(s, actor, id, "read_patient", "patient", id, "allowed"); return result; }); }
    consent(actor: Actor, id: string, b: Record<string, unknown>) { if (b.consent !== false)
        fail("INVALID_CONSENT", "Seul le retrait est accepté ici."); return this.transact(actor, id, "revoke_consent", s => { if (!resolvePatientAccess(s, actor, id).owner)
        fail("FORBIDDEN", "Accès propriétaire requis.", 403); s.patients.find(p => p.id === id)!.consent = false; bumpPatientRevision(s, id, "authority"); for (const p of s.carePlans.filter(p => p.patientId === id)) {
        p.state = "suspended";
        p.revision++;
    } for (const t of s.dueTasks.filter(t => t.patientId === id && t.state !== "completed"))
        t.state = "cancelled"; for (const v of s.externalVisitGrants.filter(v => v.patientId === id)) {
        v.state = "revoked";
        v.revision++;
    } for (const c of s.connectors.filter(c => c.patientId === id)) {
        c.enabled = false;
        c.revision++;
    } journalAccess(s, actor, id, "revoke_consent", "patient", id, "allowed"); audit(s, actor, "revoke_consent", id); return { ok: true }; }); }
    measurement(actor: Actor, id: string, b: Record<string, unknown>) { return this.transact(actor, id, "submit_measurement", s => { const access = requirePatientCapability(s, actor, id, "measurements"); if (!access.owner && !access.canManageCare)
        fail("FORBIDDEN", "Capture propriétaire ou référent requise.", 403); return replay(s, JSON.stringify([actor.id, "measurement", id, text(b.clientId, 128)]), b, () => { const result = ingestReading(s, id, b); audit(s, actor, "submit_measurement", result.measurement.id); journalAccess(s, actor, id, "submit_measurement", "measurement", result.measurement.id, "allowed"); return result; }); }); }
    alert(actor: Actor, id: string, b: Record<string, unknown>) { const patientId = this.store.read().alerts.find(a => a.id === id)?.patientId ?? ""; return this.transact(actor, patientId, "update_alert", s => { requireClinician(actor); const alert = s.alerts.find(a => a.id === id); if (!alert)
        fail("NOT_FOUND", "Alerte inaccessible.", 404); requirePatientCapability(s, actor, alert.patientId, "manage"); if (!["acknowledge", "reject", "resolve"].includes(String(b.action)))
        fail("INVALID_ACTION", "Action invalide."); const action = b.action as string, note = action === "acknowledge" ? (b.note ? text(b.note) : undefined) : text(b.note); if (alert.status === "resolved" || alert.status === "rejected")
        fail("INVALID_TRANSITION", "Alerte déjà clôturée.", 409); if (action === "acknowledge" && alert.status === "acknowledged")
        return { alert }; const at = new Date().toISOString(); alert.status = action === "acknowledge" ? "acknowledged" : action === "reject" ? "rejected" : "resolved"; if (action === "acknowledge")
        alert.acknowledgedAt ??= at; if (action === "resolve")
        alert.resolvedAt = at; alert.history.push({ action, author: actor.id, at, ...(note === undefined ? {} : { note }) }); audit(s, actor, action, id); journalAccess(s, actor, alert.patientId, action, "alert", id, "allowed"); refreshMonitoring(s, alert.patientId); return { alert }; }); }
    rules(actor: Actor, id: string, b: Record<string, unknown>) { requireClinician(actor); return this.transact(actor, id, "update_rules", s => { requirePatientCapability(s, actor, id, "manage"); const p = s.patients.find(p => p.id === id)!; const r: Rules = { version: `demo-${careId()}`, demonstration: true, systolicWarn: num(b.systolicWarn, 50, 300), systolicHigh: num(b.systolicHigh, 50, 300), diastolicWarn: num(b.diastolicWarn, 30, 200), diastolicHigh: num(b.diastolicHigh, 30, 200), glucoseWarn: num(b.glucoseWarn, 1, 600), glucoseHigh: num(b.glucoseHigh, 1, 600), glucoseUnit: b.glucoseUnit as Rules["glucoseUnit"], overdueHours: num(b.overdueHours, 1, 720) }; if (!["mg/dL", "mmol/L"].includes(r.glucoseUnit) || r.systolicWarn >= r.systolicHigh || r.diastolicWarn >= r.diastolicHigh || r.glucoseWarn >= r.glucoseHigh)
        fail("INVALID_RULES", "Seuils incohérents."); s.ruleRevisions.push({ patientId: id, rules: { ...p.rules }, author: actor.id, at: new Date().toISOString() }); p.rules = r; bumpPatientRevision(s, id, "context"); const plan = s.carePlans.find(p => p.patientId === id); if (plan) {
        plan.state = "suspended";
        plan.revision++;
    } refreshMonitoring(s, id); audit(s, actor, "update_rules", id); return { patient: projectPatientRecord(s, actor, id).patient }; }); }
    reminder(actor: Actor, id: string, b: Record<string, unknown>) { requireClinician(actor); return this.transact(actor, id, "create_reminder", s => { requirePatientCapability(s, actor, id, "manage"); const reminder = { id: careId(), patientId: id, label: text(b.label, 200), dueAt: date(b.dueAt), acknowledgedAt: null, taken: null, delivery: "local" as const }; s.reminders.push(reminder); audit(s, actor, "create_reminder", id); return { reminder }; }); }
    acknowledgeReminder(actor: Actor, id: string, b: Record<string, unknown>) { if (actor.role !== "patient")
        fail("FORBIDDEN", "Auto-déclaration du patient requise.", 403); return this.store.transaction(s => { const r = s.reminders.find(r => r.id === id); if (!r)
        fail("NOT_FOUND", "Rappel inaccessible.", 404); requirePatientCapability(s, actor, r.patientId, "owner"); const clientId = text(b.clientId, 128); if (typeof b.taken !== "boolean")
        fail("INVALID_INPUT", "Auto-déclaration explicite requise."); return replay(s, JSON.stringify([actor.id, "reminder_acknowledgment", r.patientId, id, clientId]), b, () => { if (r.acknowledgedAt)
        fail("ALREADY_REPORTED", "Rappel déjà déclaré.", 409); r.taken = b.taken as boolean; r.acknowledgedAt = new Date().toISOString(); audit(s, actor, "self_report_reminder", id); return { reminder: r }; }); }); }
    summary(actor: Actor, id: string) { requirePatientReadScope(this.store.read(), actor, id, "summary"); const p = this.patient(actor, id); return { text: `${p.measurements.length} mesure(s) reçue(s), ${p.observations.length} résultat(s) confirmé(s). ${p.measurements.length ? "Valeurs et dates disponibles dans l’historique." : "Aucune mesure disponible : statut inconnu."} Synthèse factuelle de démonstration. Aucun changement de traitement proposé.`, facts: [...p.measurements.map(m => ({ id: m.id, kind: m.kind })), ...p.observations.map(o => ({ id: o.id, kind: o.exam, sourceId: o.documentId }))], ai: false }; }
    export(actor: Actor, id: string) { requirePatientReadScope(this.store.read(), actor, id, "summary"); const p = this.patient(actor, id); return { subject: id, mode: "fictional_demo", terminologyMapping: "unverified", measurements: p.measurements, observations: p.observations }; }
}
