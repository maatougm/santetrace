import { randomBytes } from "node:crypto";
import type { Actor } from "../contracts/care";
import { SHARING_SCOPES, type AccessEnvelope, type CareGrant, type DoctorInvitationSummary, type GrantIssueResult, type ProjectedRecord, type SharingScope } from "../contracts/patient-platform";
import type { RevisionGuard } from "../contracts/monitoring";
import { careId, type CareState, type CareStoreAdapter } from "./care-store";
import { aggregateMonitoring } from "./monitoring-evaluation";
import { boundedText, canonical, fail, hash, integer, replay, recordProtocolHistory } from "./monitoring-utils";
import { projectCareAction } from "./protocol-service";
export function currentGuard(state: CareState, id: string): RevisionGuard {
    const revision = state.patientRevisions.find(r => r.patientId === id), plan = state.carePlans.find(p => p.patientId === id);
    return { contextRevision: revision?.contextRevision ?? 0, evidenceRevision: revision?.evidenceRevision ?? 0, authorityRevision: revision?.authorityRevision ?? 0, carePlanRevision: plan?.revision ?? 0, profileVersions: (plan?.profileBindings ?? []).map(b => `${b.profileId}:${b.profileVersion}`).sort() };
}
export function suspendPatientProtocols(state: CareState, id: string): void { for (const p of state.protocols.filter(p => p.patientId === id && p.state === "active")) {
    const at = new Date().toISOString();
    recordProtocolHistory(state,p,at,p.clinicianId,"Politique avant suspension du contexte ou des droits");
    p.state = "suspended";
    p.revision++;
    recordProtocolHistory(state,p,at,p.clinicianId,"Suspension automatique du contexte ou des droits ; nouvelle revue requise");
} }
export function bumpPatientRevision(state: CareState, id: string, kind: "context" | "evidence" | "authority"): void {
    let r = state.patientRevisions.find(r => r.patientId === id);
    if (!r) {
        r = { patientId: id, contextRevision: 0, evidenceRevision: 0, authorityRevision: 0 };
        state.patientRevisions.push(r);
    }
    const key = kind === "context" ? "contextRevision" : kind === "evidence" ? "evidenceRevision" : "authorityRevision";
    r[key]++;
    if (kind !== "evidence")
        suspendPatientProtocols(state, id);
}
function owner(state: CareState, actor: Actor, id: string): boolean { return actor.role === "patient" && actor.patientId === id && state.accounts.some(a => a.id === actor.id && a.role === "patient" && a.patientId === id && a.enabled); }
export function resolvePatientAccess(state: CareState, actor: Actor, id: string): AccessEnvelope {
    const p = state.patients.find(p => p.id === id);
    if (!p)
        fail("NOT_FOUND", "Dossier inaccessible.", 404);
    const authorityRevision = currentGuard(state, id).authorityRevision;
    if (owner(state, actor, id))
        return { owner: true, relationship: null, scopes: [...SHARING_SCOPES], grantId: null, grantRevision: null, authorityRevision, canManageCare: false, canReviewLabs: false };
    if (actor.role !== "clinician" || !state.accounts.some(a => a.id === actor.id && a.enabled && a.role === "clinician"))
        fail("NOT_FOUND", "Dossier inaccessible.", 404);
    const g = state.careGrants.find(g => g.patientId === id && g.clinicianId === actor.id && g.state === "active");
    if (!g)
        fail("NOT_FOUND", "Dossier inaccessible.", 404);
    if (!p.consent)
        fail("CONSENT_REVOKED", "Consentement retiré.", 403);
    const manage = g.relationship === "primary" && SHARING_SCOPES.every(scope => g.scopes.includes(scope));
    return { owner: false, relationship: g.relationship, scopes: [...g.scopes], grantId: g.id, grantRevision: g.revision, authorityRevision, canManageCare: manage, canReviewLabs: manage };
}
export function requirePatientCapability(state: CareState, actor: Actor, id: string, scope: SharingScope | "owner" | "manage"): AccessEnvelope {
    const access = resolvePatientAccess(state, actor, id);
    if (!state.patients.find(p => p.id === id)!.consent)
        fail("CONSENT_REVOKED", "Consentement retiré.", 403);
    if (scope === "owner" ? !access.owner : scope === "manage" ? !access.canManageCare : !hasScope(access, scope))
        fail("FORBIDDEN", "Droits insuffisants.", 403);
    return access;
}
export function requirePatientReadScope(state: CareState, actor: Actor, id: string, scope: SharingScope): AccessEnvelope {
    const access = resolvePatientAccess(state, actor, id);
    if (!hasScope(access, scope))
        fail("FORBIDDEN", "Droits insuffisants.", 403);
    return access;
}
export function hasScope(a: AccessEnvelope, scope: SharingScope): boolean { const required: SharingScope[] = scope === "summary" ? ["summary", "status", "clinical", "measurements", "documents"] : scope === "alerts" ? ["alerts", "status", "clinical", "measurements", "documents"] : [scope]; return required.every(s => a.scopes.includes(s)); }
export function journalAccess(state: CareState, actor: Actor, id: string, action: string, resourceType: string, resourceId: string, outcome: "allowed" | "denied"): void {
    const grant = state.careGrants.find(g => g.patientId === id && g.clinicianId === actor.id && g.state === "active");
    state.accessJournal.push({ id: careId(), patientId: id, actorId: actor.id, actorCategory: actor.role, actorDisplayName: actor.displayName, action, resourceType, resourceId, grantId: grant?.id ?? null, grantRevision: grant?.revision ?? null, outcome, at: new Date().toISOString() });
    if (state.accessJournal.length > 10000)
        state.accessJournal.splice(0, state.accessJournal.length - 10000);
}
export function recordDeniedAccess(store: CareStoreAdapter, actor: Actor, id: string, action: string): void { store.transaction(s => { if (s.patients.some(p => p.id === id))
    journalAccess(s, actor, id, action, "patient", id, "denied"); }); }
export function projectPatientRecord(state: CareState, actor: Actor, id: string, now = new Date().toISOString()): ProjectedRecord {
    const access = resolvePatientAccess(state, actor, id), p = state.patients.find(p => p.id === id)!;
    const clinical = hasScope(access, "clinical"), docs = hasScope(access, "documents"), summary = hasScope(access, "summary"), status = hasScope(access, "status");
    const guard = currentGuard(state, id);
    const evaluations = state.conditionEvaluations.filter(e => e.patientId === id && canonical(e.guard) === canonical(guard));
    const aggregate = aggregateMonitoring(evaluations, state.alerts.filter(a => a.patientId === id));
    const plan = state.carePlans.find(p => p.patientId === id) ?? null;
    const boundRequirements = access.canManageCare ? (plan?.profileBindings ?? []).flatMap(binding => {
        const fact = state.medicalFacts.find(f => f.patientId === id && f.id === binding.conditionFactId && f.kind === "condition" && f.polarity === "affirmed" && !f.supersededBy && ["confirmed", "patient_reported"].includes(f.verification));
        const profile = state.monitoringProfiles.find(p => p.id === binding.profileId && p.version === binding.profileVersion);
        return fact?.code && profile?.conditionCodes.includes(fact.code) ? profile.requirements.map(r => r.id) : [];
    }) : [];
    // Ambiguous names are unusable by protocol predicates, even across two bindings.
    const requirementIds = boundRequirements.filter((name, index, names) => names.indexOf(name) === index && names.lastIndexOf(name) === index).sort();
    const proposals = clinical ? state.careProposals.filter(p => p.patientId === id).map(p => access.canManageCare ? p : ({ id: p.id, revision: p.revision, kind: p.kind, state: p.state })) : [];
    return { patient: { ...p, status: status ? aggregate.priority : "unknown", rules: access.owner || access.canManageCare ? structuredClone(p.rules) : null }, access,
        ...(access.canManageCare ? { guard, requirementIds } : {}),
        ...(clinical ? { revision: structuredClone(state.patientRevisions.find(r=>r.patientId===id) ?? {patientId:id,contextRevision:0,evidenceRevision:0,authorityRevision:0}) } : {}),
        measurements: hasScope(access, "measurements") ? state.measurements.filter(m => m.patientId === id) : [], alerts: hasScope(access, "alerts") ? state.alerts.filter(a => a.patientId === id) : [],
        reminders: clinical ? state.reminders.filter(r => r.patientId === id) : [], documents: docs ? state.documents.filter(d => d.patientId === id) : [], candidates: clinical && docs ? state.candidates.filter(c => c.patientId === id) : [], observations: clinical && docs ? state.observations.filter(o => o.patientId === id) : [],
        externalNotes: clinical ? state.externalNotes.filter(n => n.patientId === id) : [], medicalFacts: clinical ? state.medicalFacts.filter(f => f.patientId === id && (access.owner || !f.supersededBy)) : [], plan: clinical ? plan : null, actions: clinical ? state.careActions.filter(a => a.patientId === id).map(action => projectCareAction(state, action, now)) : [], evaluations: summary ? evaluations : [], monitoring: status ? (summary ? aggregate : { ...aggregate, reasons: [] }) : null, proposals };
}
function scopes(value: unknown): SharingScope[] { if (!Array.isArray(value) || !value.length || value.length > SHARING_SCOPES.length || value.some(s => !SHARING_SCOPES.includes(s)) || new Set(value).size !== value.length)
    fail("INVALID_SCOPES"); const result = [...value] as SharingScope[]; if (result.some(s => ["summary", "alerts"].includes(s)) && !["status", "measurements", "clinical", "documents"].every(s => result.includes(s as SharingScope)))
    fail("INVALID_SCOPES"); return result; }
export class PatientAccessService {
    constructor(public store: CareStoreAdapter, private clock = () => Date.now()) { }
    listDoctors() { const s = this.store.read(); return { doctors: s.doctorProfiles.filter(d => s.accounts.some(a => a.id === d.id && a.enabled)) }; }
    list(actor: Actor, id: string) { return this.store.transaction(s => { const a = resolvePatientAccess(s, actor, id); if (!a.owner)
        fail("FORBIDDEN", "Accès propriétaire requis.", 403); journalAccess(s, actor, id, "read_grants", "patient", id, "allowed"); return { grants: s.careGrants.filter(g => g.patientId === id) }; }); }
    issue(actor: Actor, id: string, b: Record<string, unknown>): GrantIssueResult {
        const clientId = boundedText(b.clientId, 128), target = boundedText(b.targetClinicianId, 100), selected = scopes(b.scopes);
        if (b.relationship === "primary" && !SHARING_SCOPES.every(scope => selected.includes(scope)))
            fail("INVALID_SCOPES");
        if (!["primary", "generalist", "specialist"].includes(String(b.relationship)))
            fail("INVALID_RELATIONSHIP");
        return this.store.transaction(s => {
            requirePatientCapability(s, actor, id, "owner");
            const key = JSON.stringify([actor.id, "grant_issue", id, clientId]), old = s.idempotency[key], digest = hash(canonical(b));
            if (old) {
                if (old.hash !== digest)
                    fail("IDEMPOTENCY_CONFLICT", "Identifiant déjà utilisé.", 409);
                const meta = old.result as {
                    grantId: string;
                };
                const grant = s.careGrants.find(g => g.id === meta.grantId)!;
                return { grant, invitationToken: null };
            }
            if (!s.accounts.some(a => a.id === target && a.enabled && a.role === "clinician"))
                fail("NOT_FOUND", "Médecin indisponible.", 404);
            if (s.careGrants.some(g => g.patientId === id && g.state !== "revoked" && (g.clinicianId === target || (g.relationship === "primary" && b.relationship === "primary"))))
                fail("GRANT_CONFLICT", "Relation déjà présente.", 409);
            const at = new Date(this.clock()).toISOString(), token = randomBytes(32).toString("base64url"), grant: CareGrant = { id: careId(), patientId: id, clinicianId: target, relationship: b.relationship as CareGrant["relationship"], scopes: selected, state: "pending", issuedAt: at, acceptedAt: null, revokedAt: null, revision: 1 };
            s.careGrants.push(grant);
            s.doctorInvitations.push({ id: careId(), grantId: grant.id, targetClinicianId: target, tokenHash: hash(token), expiresAt: new Date(this.clock() + 24 * 3600000).toISOString(), acceptedAt: null });
            s.idempotency[key] = { hash: digest, result: { grantId: grant.id } };
            bumpPatientRevision(s, id, "authority");
            journalAccess(s, actor, id, "issue_grant", "grant", grant.id, "allowed");
            return { grant, invitationToken: token };
        });
    }
    invitations(actor: Actor): {
        invitations: DoctorInvitationSummary[];
    } { if (actor.role !== "clinician")
        fail("FORBIDDEN", "Accès médecin requis.", 403); const s = this.store.read(); return { invitations: s.doctorInvitations.filter(i => i.targetClinicianId === actor.id && Date.parse(i.expiresAt) > this.clock()).flatMap(i => { const g = s.careGrants.find(g => g.id === i.grantId), p = s.patients.find(p => p.id === g?.patientId); return g && p?.consent ? [{ id: i.id, grantId: g.id, patientDisplayName: p.displayName, relationship: g.relationship, scopes: g.scopes, expiresAt: i.expiresAt, state: g.state }] : []; }) }; }
    accept(actor: Actor, b: Record<string, unknown>) { const token = boundedText(b.token, 128), clientId = boundedText(b.clientId, 128); return this.store.transaction(s => { if (actor.role !== "clinician" || !s.accounts.some(a => a.id === actor.id && a.enabled && a.role === "clinician"))
        fail("FORBIDDEN", "Accès médecin requis.", 403); const i = s.doctorInvitations.find(i => i.tokenHash === hash(token) && i.targetClinicianId === actor.id), g = s.careGrants.find(g => g.id === i?.grantId); if (!i || !g || g.state === "revoked")
        fail("NOT_FOUND", "Invitation indisponible.", 404); if (!s.patients.find(p => p.id === g.patientId)!.consent)
        fail("CONSENT_REVOKED", "Consentement retiré.", 403); return replay(s, JSON.stringify([actor.id, "grant_accept", clientId]), { tokenHash: hash(token), clientId }, () => { if (i.acceptedAt || g.state !== "pending" || Date.parse(i.expiresAt) <= this.clock())
        fail("NOT_FOUND", "Invitation indisponible.", 404); g.state = "active"; g.acceptedAt = new Date(this.clock()).toISOString(); g.revision++; i.acceptedAt = g.acceptedAt; bumpPatientRevision(s, g.patientId, "authority"); journalAccess(s, actor, g.patientId, "accept_grant", "grant", g.id, "allowed"); return { grant: g }; }); }); }
    update(actor: Actor, id: string, b: Record<string, unknown>) {
        const clientId = boundedText(b.clientId, 128);
        return this.store.transaction(s => {
            const g = s.careGrants.find(g => g.id === id);
            if (!g)
                fail("NOT_FOUND", "Relation inaccessible.", 404);
            if (!resolvePatientAccess(s, actor, g.patientId).owner)
                fail("FORBIDDEN", "Accès propriétaire requis.", 403);
            return replay(s, JSON.stringify([actor.id, "grant_update", id, clientId]), b, () => {
                if (g.revision !== integer(b.expectedRevision))
                    fail("STALE_REVISION", "La relation a changé.", 409);
                if (b.action === "revoke") {
                    g.state = "revoked";
                    g.revokedAt = new Date(this.clock()).toISOString();
                }
                else if (b.action === "update" && g.state !== "revoked")
                    g.scopes = scopes(b.scopes);
                else
                    fail("INVALID_ACTION");
                g.revision++;
                bumpPatientRevision(s, g.patientId, "authority");
                if (g.relationship === "primary" && (!SHARING_SCOPES.every(scope => g.scopes.includes(scope)) || g.state === "revoked")) {
                    const plan = s.carePlans.find(p => p.patientId === g.patientId);
                    if (plan) {
                        plan.state = "awaiting_clinician";
                        plan.clinicianId = null;
                        plan.revision++;
                    }
                }
                journalAccess(s, actor, g.patientId, "update_grant", "grant", g.id, "allowed");
                return { grant: g };
            });
        });
    }
    journal(actor: Actor, id: string, cursor: string | null = null, limit = 50) { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        fail("INVALID_INPUT"); const s = this.store.read(); if (!resolvePatientAccess(s, actor, id).owner)
        fail("FORBIDDEN", "Accès propriétaire requis.", 403); const entries = s.accessJournal.filter(e => e.patientId === id).reverse(); const index = cursor ? entries.findIndex(e => e.id === cursor) : -1; if (cursor && index < 0)
        fail("INVALID_CURSOR"); const offset = index + 1; return { entries: entries.slice(offset, offset + limit), nextCursor: entries.length > offset + limit ? entries[offset + limit - 1].id : null }; }
}
