import type { Actor } from "../contracts/care";
import type { ActionReportInput, CareAction, CarePlan, CareProposal, PlanResponse, PlanUpdate, ProposalDecision, ProposalEdit, ProposalReviewResult, RevisionGuard } from "../contracts/monitoring";
import { SHARING_SCOPES } from "../contracts/patient-platform";
import { careId, type CareState, type CareStoreAdapter } from "./care-store";
import { boundedText, canonical, fail, integer, replay } from "./monitoring-utils";
import { buildAuthorizedEvidence, validateGroundedOutput } from "./medical-evidence";
import { actionTemplateDefinition, questionsFor, validateActionTemplate } from "./monitoring-content";
import { bumpPatientRevision, currentGuard, hasScope, journalAccess, projectPatientRecord, requirePatientCapability, resolvePatientAccess, suspendPatientProtocols } from "./patient-access-service";
import { refreshMonitoring } from "./care-service";
import { projectCareAction } from "./protocol-service";

export function strictMonitoringInput(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("INVALID_INPUT");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))) fail("INVALID_INPUT");
  return input;
}

export function assertCurrentMonitoringGuard(state: CareState, patientId: string, value: unknown, proposalRevision?: number): RevisionGuard {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_GUARD");
  const input = value as Record<string, unknown>;
  const mandatory = ["contextRevision", "evidenceRevision", "authorityRevision", "carePlanRevision", "profileVersions"];
  if (mandatory.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !mandatory.includes(key) && key !== "proposalRevision")) fail("INVALID_GUARD");
  for (const key of mandatory.slice(0, 4)) integer(input[key]);
  if (!Array.isArray(input.profileVersions) || input.profileVersions.length > 20 || input.profileVersions.some(v => typeof v !== "string" || v.length > 200)) fail("INVALID_GUARD");
  if (input.proposalRevision !== undefined && integer(input.proposalRevision) !== proposalRevision) fail("STALE_REVISION", "La proposition a changé.", 409);
  const expected = { ...input }; delete expected.proposalRevision;
  const current = currentGuard(state, patientId);
  if (canonical(current) !== canonical(expected)) fail("STALE_CONTEXT", "Le dossier a changé. Actualisez la revue.", 409);
  return current;
}

function ensurePlan(state: CareState, patientId: string): CarePlan {
  let plan = state.carePlans.find(plan => plan.patientId === patientId);
  const primary = state.patients.find(p => p.id === patientId)?.consent ? state.careGrants.find(grant => grant.patientId === patientId && grant.relationship === "primary" && grant.state === "active" && SHARING_SCOPES.every(scope => grant.scopes.includes(scope)) && state.accounts.some(a => a.id === grant.clinicianId && a.enabled && a.role === "clinician")) : undefined;
  if (!plan) {
    plan = { id: careId(), patientId, revision: 0, state: primary ? "suspended" : "awaiting_clinician", clinicianId: primary?.clinicianId ?? null, profileBindings: [], actionIds: [], reviewDeadline: null };
    state.carePlans.push(plan);
  } else if (["active", "suspended"].includes(plan.state) && plan.clinicianId && plan.clinicianId !== primary?.clinicianId) {
    // Loss of the responsible principal invalidates readiness once. Restoration cannot
    // silently reactivate that former policy; a current primary must approve it again.
    bumpPatientRevision(state, patientId, "authority");
    plan.state = "awaiting_clinician"; plan.clinicianId = null; plan.revision++;
  }
  return plan;
}

function planResponse(state: CareState, actor: Actor, patientId: string, now: string): PlanResponse {
  const access = resolvePatientAccess(state, actor, patientId);
  if (!hasScope(access, "clinical")) fail("FORBIDDEN", "Droits insuffisants.", 403);
  const guard = currentGuard(state, patientId);
  const evaluations = hasScope(access, "summary") ? state.conditionEvaluations.filter(e => e.patientId === patientId && canonical(e.guard) === canonical(guard)) : [];
  const metadata = access.canManageCare ? projectPatientRecord(state, actor, patientId, now) : null;
  return structuredClone({ plan: state.carePlans.find(p => p.patientId === patientId) ?? null, actions: state.careActions.filter(a => a.patientId === patientId).map(action => projectCareAction(state, action, now)), evaluations, coverage: evaluations.length ? [...new Set(evaluations.flatMap(e => e.coverage))] : ["missing"], ...(metadata ? { guard: metadata.guard, requirementIds: metadata.requirementIds } : {}) });
}

function validateProposal(state: CareState, actor: Actor, proposal: CareProposal): void {
  try {
    validateGroundedOutput({ claims: [], questionIds: [], proposals: [{ kind: proposal.kind, action: proposal.action, sources: proposal.sources, missingQuestionIds: [] }] }, buildAuthorizedEvidence(state, actor, proposal.patientId));
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) throw error;
    fail("INVALID_PROPOSAL", "Action ou sources non valides.");
  }
}

function proposalById(state: CareState, id: string): CareProposal {
  const proposal = state.careProposals.find(p => p.id === id);
  if (!proposal) fail("NOT_FOUND", "Proposition inaccessible.", 404);
  return proposal;
}

function recordProposalHistory(proposal: CareProposal, at: string, author: string, reason: string) {
  if (proposal.history.some(entry => entry.revision === proposal.revision)) return;
  const snapshot = { revision: proposal.revision, action: structuredClone(proposal.action), sources: structuredClone(proposal.sources), guard: structuredClone(proposal.guard), state: proposal.state, at, author, reason };
  proposal.history.push(snapshot);
}

export class CarePlanService {
  constructor(public store: CareStoreAdapter, private clock = () => new Date().toISOString()) {}

  getPlan(actor: Actor, patientId: string): PlanResponse {
    return this.store.transaction(state => {
      const access = resolvePatientAccess(state, actor, patientId);
      if (!hasScope(access, "clinical")) fail("FORBIDDEN", "Droits insuffisants.", 403);
      // ponytail: lazy revision-zero shell preserves already generated proposal guards.
      ensurePlan(state, patientId);
      journalAccess(state, actor, patientId, "read_plan", "patient", patientId, "allowed");
      return planResponse(state, actor, patientId, this.clock());
    });
  }

  listProposals(actor: Actor, patientId: string) {
    return this.store.transaction(state => {
      const access = resolvePatientAccess(state, actor, patientId);
      if (!hasScope(access, "clinical")) fail("FORBIDDEN", "Droits insuffisants.", 403);
      journalAccess(state, actor, patientId, "read_proposals", "patient", patientId, "allowed");
      return { proposals: state.careProposals.filter(p => p.patientId === patientId).map(p => access.canManageCare ? structuredClone(p) : { id: p.id, revision: p.revision, kind: p.kind, state: p.state }) };
    });
  }

  reviewProposal(actor: Actor, id: string, body: ProposalDecision): ProposalReviewResult {
    const input = strictMonitoringInput(body, ["decision", "expectedRevision", "expectedGuard", "reason", "clientId"]);
    const clientId = boundedText(input.clientId, 128), reason = boundedText(input.reason, 1000), revision = integer(input.expectedRevision, 1);
    if (input.decision !== "approve" && input.decision !== "reject") fail("INVALID_ACTION");
    return this.store.transaction(state => {
      const proposal = proposalById(state, id);
      requirePatientCapability(state, actor, proposal.patientId, "manage");
      return replay(state, JSON.stringify([actor.id, "proposal_decision", id, clientId]), body, () => {
        if (proposal.revision !== revision || !["pending", "needs_review", "needs_inputs"].includes(proposal.state)) fail("STALE_REVISION", "La proposition a déjà changé.", 409);
        const guard = assertCurrentMonitoringGuard(state, proposal.patientId, input.expectedGuard, revision);
        if (canonical(proposal.guard) !== canonical(guard)) fail("STALE_CONTEXT", "La proposition doit être actualisée.", 409);
        validateProposal(state, actor, proposal);
        if (input.decision === "approve" && (proposal.state === "needs_inputs" || questionsFor(state.medicalFacts.filter(f => f.patientId === proposal.patientId && !f.supersededBy)).some(q => q.required))) fail("NEEDS_INPUTS", "Complétez les informations requises.", 409);
        const at = this.clock();
        recordProposalHistory(proposal, at, actor.id, reason);
        proposal.state = input.decision === "approve" ? "approved" : "rejected";
        proposal.revision++;
        proposal.decision = { clinicianId: actor.id, at, reason };
        recordProposalHistory(proposal, at, actor.id, reason);
        let plan = state.carePlans.find(p => p.patientId === proposal.patientId) ?? null;
        let action: CareAction | null = null;
        if (input.decision === "approve") {
          plan = ensurePlan(state, proposal.patientId); plan.revision++; plan.clinicianId = actor.id;
          if (plan.state === "awaiting_clinician" || plan.state === "revoked") plan.state = "suspended";
          suspendPatientProtocols(state, proposal.patientId);
          action = { id: careId(), patientId: proposal.patientId, planId: plan.id, revision: 1, proposalId: proposal.id, protocolId: null, originVersion: proposal.revision, action: structuredClone(proposal.action), dueAt: at, state: "pending", reportedAt: null, clientId, createdAt: at };
          state.careActions.push(action); plan.actionIds.push(action.id);
          state.dueTasks.push({ id: careId(), patientId: proposal.patientId, kind: "remind", phaseKey: `action:${action.id}:initial`, dueAt: action.dueAt, attempts: 0, state: "pending", leaseOwner: null, leaseUntil: null, guard: currentGuard(state, proposal.patientId), resourceId: action.id });
          refreshMonitoring(state, proposal.patientId, at);
        }
        journalAccess(state, actor, proposal.patientId, `proposal_${input.decision}`, "proposal", id, "allowed");
        return structuredClone({ proposal, plan, action });
      });
    });
  }

  reviseProposal(actor: Actor, id: string, body: ProposalEdit): CareProposal {
    const input = strictMonitoringInput(body, ["action", "sources", "expectedRevision", "expectedGuard", "reason", "clientId"]);
    const clientId = boundedText(input.clientId, 128), reason = boundedText(input.reason, 1000), revision = integer(input.expectedRevision, 1);
    return this.store.transaction(state => {
      const proposal = proposalById(state, id); requirePatientCapability(state, actor, proposal.patientId, "manage");
      return replay(state, JSON.stringify([actor.id, "proposal_edit", id, clientId]), body, () => {
        if (proposal.revision !== revision || !["pending", "needs_review", "needs_inputs"].includes(proposal.state)) fail("STALE_REVISION", "La proposition a changé.", 409);
        const guard = assertCurrentMonitoringGuard(state, proposal.patientId, input.expectedGuard, revision);
        let action: CareProposal["action"];
        try { action = validateActionTemplate(input.action); } catch { fail("INVALID_PROPOSAL", "Action non valide."); }
        if (!Array.isArray(input.sources)) fail("INVALID_PROPOSAL");
        const edited: CareProposal = { ...proposal, action, kind: actionTemplateDefinition(action.templateId).kind, sources: structuredClone(input.sources) as CareProposal["sources"], guard, decision: null };
        validateProposal(state, actor, edited);
        recordProposalHistory(proposal, this.clock(), actor.id, reason);
        Object.assign(proposal, edited); proposal.revision++;
        proposal.state = questionsFor(state.medicalFacts.filter(f => f.patientId === proposal.patientId && !f.supersededBy)).some(q => q.required) ? "needs_inputs" : "needs_review";
        recordProposalHistory(proposal, this.clock(), actor.id, reason);
        journalAccess(state, actor, proposal.patientId, "edit_proposal", "proposal", id, "allowed");
        state.audit.push({ actorId: actor.id, action: "proposal_edit", subjectId: id, at: this.clock() });
        return structuredClone(proposal);
      });
    });
  }

  updatePlan(actor: Actor, patientId: string, body: PlanUpdate): PlanResponse {
    const hasDeadline = body !== null && typeof body === "object" && Object.hasOwn(body, "reviewDeadline");
    const input = strictMonitoringInput(body, ["action", "profileBindings", "expectedRevision", "clientId", ...(hasDeadline ? ["reviewDeadline"] : [])]);
    const clientId = boundedText(input.clientId, 128), revision = integer(input.expectedRevision);
    if (input.action !== "activate" && input.action !== "suspend") fail("INVALID_ACTION");
    if (!Array.isArray(input.profileBindings) || input.profileBindings.length > 20) fail("INVALID_PROFILES");
    return this.store.transaction(state => {
      requirePatientCapability(state, actor, patientId, "manage");
      replay(state, JSON.stringify([actor.id, "plan_update", patientId, clientId]), body, () => {
        const plan = ensurePlan(state, patientId); if (plan.revision !== revision) fail("STALE_REVISION", "Le plan a changé.", 409);
        if (hasDeadline && input.reviewDeadline !== null) {
          const deadline = typeof input.reviewDeadline === "string" ? Date.parse(input.reviewDeadline) : NaN, at = Date.parse(this.clock());
          if (!Number.isFinite(deadline) || !Number.isFinite(at) || new Date(deadline).toISOString() !== input.reviewDeadline || deadline <= at || deadline - at > 30 * 86400000) fail("INVALID_REVIEW_DEADLINE", "Échéance UTC future requise, dans les 30 prochains jours.");
        }
        const bindings = (input.profileBindings as unknown[]).map(raw => {
          const b = strictMonitoringInput(raw, ["conditionFactId", "profileId", "profileVersion"]);
          const conditionFactId = boundedText(b.conditionFactId, 100), profileId = boundedText(b.profileId, 100), profileVersion = boundedText(b.profileVersion, 100);
          const fact = state.medicalFacts.find(f => f.patientId === patientId && f.id === conditionFactId && f.kind === "condition" && f.polarity === "affirmed" && !f.supersededBy && ["confirmed", "patient_reported"].includes(f.verification));
          const profile = state.monitoringProfiles.find(p => p.id === profileId && p.version === profileVersion);
          if (!fact || !profile || !fact.code || !profile.conditionCodes.includes(fact.code)) fail("INVALID_PROFILES", "Profil ou condition non disponible.");
          return { conditionFactId, profileId, profileVersion };
        });
        if (new Set(bindings.map(b => b.conditionFactId)).size !== bindings.length || (input.action === "activate" && !bindings.length)) fail("INVALID_PROFILES");
        plan.state = input.action === "activate" ? "active" : "suspended"; plan.clinicianId = actor.id; plan.profileBindings = bindings; plan.revision++;
        if (hasDeadline) plan.reviewDeadline = input.reviewDeadline as string | null;
        suspendPatientProtocols(state, patientId);
        refreshMonitoring(state, patientId, this.clock());
        journalAccess(state, actor, patientId, `plan_${input.action}`, "plan", plan.id, "allowed");
        // Cache the mutation outcome, not time-sensitive live approval metadata.
        return { planId: plan.id };
      });
      return planResponse(state, actor, patientId, this.clock());
    });
  }

  reportAction(actor: Actor, id: string, body: ActionReportInput): CareAction {
    const input = strictMonitoringInput(body, ["state", "expectedRevision", "clientId"]);
    const clientId = boundedText(input.clientId, 128), revision = integer(input.expectedRevision, 1);
    if (input.state !== "completed" && input.state !== "not_completed") fail("INVALID_ACTION");
    return this.store.transaction(state => {
      const action = state.careActions.find(a => a.id === id); if (!action) fail("NOT_FOUND", "Action inaccessible.", 404);
      requirePatientCapability(state, actor, action.patientId, "owner");
      return replay(state, JSON.stringify([actor.id, "action_report", id, clientId]), body, () => {
        if (action.revision !== revision || action.state !== "pending") fail("STALE_REVISION", "L'action a changé.", 409);
        action.state = input.state as "completed" | "not_completed"; action.revision++; action.reportedAt = this.clock();
        for (const task of state.dueTasks.filter(t => t.patientId === action.patientId && t.resourceId === action.id && t.kind === "remind" && ["pending", "claimed"].includes(t.state))) { task.state = "cancelled"; task.leaseOwner = null; task.leaseUntil = null; }
        journalAccess(state, actor, action.patientId, "report_action", "action", action.id, "allowed");
        return structuredClone(action);
      });
    });
  }
}
