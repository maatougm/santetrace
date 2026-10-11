import type { Actor } from "../contracts/care";
import type { CareAction, CareActionApproval, EligibilityInput, EligibilityResult, EvidenceSnapshot, MonitoringRequirement, ProtocolApplication, ProtocolAuthorization, ProtocolPredicate, ProtocolReviewInput, ProtocolStateInput, ReusableProtocol, RevisionGuard, SourceRef } from "../contracts/monitoring";
import { careId, type CareState, type CareStoreAdapter } from "./care-store";
import { assertCurrentMonitoringGuard, strictMonitoringInput } from "./care-plan-service";
import { refreshMonitoring } from "./care-service";
import { buildAuthorizedEvidence, validateGroundedOutput } from "./medical-evidence";
import { actionTemplateDefinition, validateActionTemplate } from "./monitoring-content";
import { boundedText, canonical, fail, integer, recordProtocolHistory, replay } from "./monitoring-utils";
import { currentGuard, journalAccess, requirePatientCapability, requirePatientReadScope } from "./patient-access-service";
import { hasUnassessedClinicalContext } from "./intervention-service";

type Truth = true | false | "unknown";
type BoundRequirement = { requirement: MonitoringRequirement; conditionFactId: string };
function requirements(state: Pick<CareState, "monitoringProfiles">, plan: EligibilityInput["plan"]): Map<string, BoundRequirement> {
  const result = new Map<string, BoundRequirement>(), ambiguous = new Set<string>();
  for (const binding of plan?.profileBindings ?? []) {
    const profile = state.monitoringProfiles.find(p => p.id === binding.profileId && p.version === binding.profileVersion);
    for (const requirement of profile?.requirements ?? []) {
      // Ambiguous names are unusable; a protocol cannot select one by coincidence.
      if (ambiguous.has(requirement.id)) continue;
      if (result.has(requirement.id)) { result.delete(requirement.id); ambiguous.add(requirement.id); }
      else result.set(requirement.id, { requirement, conditionFactId: binding.conditionFactId });
    }
  }
  return result;
}

/** Latest source wins, including an inadmissible latest reading; older evidence is never a fallback. */
function requirementSource(requirement: MonitoringRequirement, evidence: EvidenceSnapshot, now: number, maximum = requirement.maxAgeSeconds): SourceRef | null {
  const candidates = evidence.sources.filter(source => source.kind === requirement.kind && (source.kind !== "measurement" || evidence.measurements.some(m => m.id === source.id && (!requirement.measurementKind || m.kind === requirement.measurementKind))));
  if (candidates.some(source => !Number.isFinite(Date.parse(source.date)))) return null;
  candidates.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
  const source = candidates[0];
  if (!source || source.polarity !== "affirmed" || !requirement.admittedVerification.includes(source.verification)) return null;
  if (candidates.some(other => other.id === source.id && canonical(other) !== canonical(source))) return null;
  const age = now - Date.parse(source.date), maxAge = Math.min(requirement.maxAgeSeconds, maximum);
  if (!Number.isFinite(maxAge) || maxAge <= 0 || age < 0 || age >= maxAge * 1000) return null;
  if (source.kind === "measurement") {
    const matches = evidence.measurements.filter(m => m.id === source.id), measurement = matches[0];
    if (!measurement || measurement.patientId !== evidence.patientId || source.revision !== 1 || measurement.measuredAt !== source.date || measurement.status === "unknown" || measurement.connector?.quality === "suspect" || matches.some(m => canonical(m) !== canonical(measurement))) return null;
    if (measurement.kind === "blood_pressure" && (measurement.unit !== "mmHg" || !Number.isFinite(measurement.systolic) || !Number.isFinite(measurement.diastolic) || measurement.systolic <= measurement.diastolic || measurement.diastolic <= 0)) return null;
    if (measurement.kind === "glucose" && (!["mg/dL", "mmol/L"].includes(measurement.unit) || !Number.isFinite(measurement.value) || measurement.value <= 0)) return null;
  }
  return structuredClone(source);
}

function boundRequirements(input: EligibilityInput): Map<string, MonitoringRequirement> { return new Map([...requirements({ monitoringProfiles: input.profiles ?? [] }, input.plan)].map(([id, value]) => [id, value.requirement])); }

/** This answers only whether a high-only trigger was crossed, never whether a patient is well. */
function knownHighOnlyNonTrigger(conditionFactId: string, input: EligibilityInput, now: number): boolean {
  const condition = input.evidence.facts.find(f => f.id === conditionFactId && f.kind === "condition" && f.polarity === "affirmed" && !f.supersededBy && ["confirmed", "patient_reported", "simulated"].includes(f.verification));
  const binding = input.plan?.profileBindings.find(b => b.conditionFactId === conditionFactId);
  const profile = input.profiles?.find(p => p.id === binding?.profileId && p.version === binding.profileVersion);
  const evaluation = input.evaluations.find(e => e.conditionFactId === conditionFactId && canonical(e.guard) === canonical(input.guard));
  if (!condition?.code || !profile || profile.demonstration !== true || !profile.conditionCodes.includes(condition.code)
    || !evaluation || evaluation.profileId !== profile.id || evaluation.profileVersion !== profile.version
    || !evaluation.coverage.includes("complete") || evaluation.coverage.some(c => !["complete", "unsupported"].includes(c))) return false;
  const kind = profile.rulePack === "demo_blood_pressure" ? "blood_pressure" : profile.rulePack === "demo_glucose" ? "glucose" : null;
  if (!kind || !profile.requirements.length || profile.requirements.some(r => r.kind !== "measurement" || r.measurementKind !== kind)) return false;
  const r = profile.rules, pairs = kind === "blood_pressure" ? [[r.systolicWarn, r.systolicHigh], [r.diastolicWarn, r.diastolicHigh]] : [[r.glucoseWarn, r.glucoseHigh]];
  if (r.demonstration !== true || pairs.some(([warn, high]) => !Number.isFinite(warn) || !Number.isFinite(high) || warn <= 0 || high <= warn)) return false;
  return profile.requirements.every(requirement => {
    const source = requirementSource(requirement, input.evidence, now);
    const measurement = source && input.evidence.measurements.find(m => m.id === source.id);
    if (!source || !measurement || !evaluation.sources.some(s => canonical(s) === canonical(source))) return false;
    if (kind === "blood_pressure" && measurement.kind === "blood_pressure") return measurement.systolic < r.systolicWarn && measurement.diastolic < r.diastolicWarn;
    if (kind === "glucose" && measurement.kind === "glucose" && ["mg/dL", "mmol/L"].includes(r.glucoseUnit)) {
      const value = measurement.unit === r.glucoseUnit ? measurement.value : measurement.unit === "mmol/L" ? measurement.value * 18 : measurement.value / 18;
      return Number.isFinite(value) && value < r.glucoseWarn;
    }
    return false;
  });
}

function predicateTruth(predicate: ProtocolPredicate, input: EligibilityInput, now: number, bound: Map<string, MonitoringRequirement>): Truth {
  if (predicate.kind === "priority_equals") {
    const evaluations = input.evaluations.filter(e => e.conditionFactId === predicate.conditionFactId && canonical(e.guard) === canonical(input.guard));
    if (evaluations.length !== 1) return "unknown";
    if (evaluations[0].priority === "unknown") return knownHighOnlyNonTrigger(predicate.conditionFactId, input, now) ? false : "unknown";
    return evaluations[0].priority === predicate.value;
  }
  if (predicate.kind === "fact_equals") {
    const facts = input.evidence.facts.filter(f => f.id === predicate.factId && !f.supersededBy);
    if (facts.length !== 1 || ["unknown", "uncertain"].includes(facts[0].polarity) || !["confirmed", "patient_reported", "simulated"].includes(facts[0].verification)) return "unknown";
    return facts[0].polarity === predicate.polarity;
  }
  if (predicate.kind === "evidence_fresh") {
    const requirement = bound.get(predicate.requirementId);
    return requirement && requirementSource(requirement, input.evidence, now, predicate.maxAgeSeconds) ? true : "unknown";
  }
  if (predicate.kind === "requirements_complete") return predicate.requirementIds.length && predicate.requirementIds.every(id => { const requirement = bound.get(id); return requirement && requirementSource(requirement, input.evidence, now); }) ? true : "unknown";
  return "unknown";
}

function eligibility(input: EligibilityInput, now: string, bound = boundRequirements(input)): EligibilityResult {
  const protocol = input.protocol, at = Date.parse(now), reasons: string[] = [];
  if (!Number.isFinite(at)) fail("INVALID_TIME");
  const deny = (condition: boolean, reason: string) => { if (condition) reasons.push(reason); };
  deny(protocol.state !== "active", "protocol_inactive");
  deny(!input.consent, "consent_withdrawn");
  deny(!input.hasCurrentAuthority, "authority_unavailable");
  deny(input.hasUnassessedContext, "unassessed_context");
  deny(!input.plan || input.plan.state !== "active" || input.plan.clinicianId !== protocol.clinicianId || input.plan.patientId !== protocol.patientId, "plan_inactive");
  deny(Boolean(input.plan?.reviewDeadline && (!Number.isFinite(Date.parse(input.plan.reviewDeadline)) || Date.parse(input.plan.reviewDeadline) <= at)), "plan_review_overdue");
  deny(input.guard.contextRevision !== protocol.requiredContextRevision || input.guard.authorityRevision !== protocol.authorityRevision || input.guard.carePlanRevision !== protocol.carePlanRevision || canonical(input.guard.profileVersions) !== canonical(protocol.profileVersions), "changed_approved_context");
  deny(input.evidence.patientId !== protocol.patientId || canonical(input.evidence.guard) !== canonical(input.guard), "changed_evidence");
  deny(!Number.isFinite(Date.parse(protocol.validUntil)) || Date.parse(protocol.validUntil) <= at, "protocol_expired");
  deny(input.unresolved.some(a => a.patientId === protocol.patientId && a.priority === "red" && ["new", "acknowledged"].includes(a.status)) || input.evaluations.some(e => e.patientId === protocol.patientId && e.priority === "red"), "unresolved_red");
  deny(protocol.predicates.length === 0 || !protocol.predicates.some(p => p.kind === "priority_equals") || !protocol.predicates.some(p => p.kind === "requirements_complete"), "missing_required_predicates");
  for (const predicate of protocol.predicates) { const value = predicateTruth(predicate, input, at, bound); if (value !== true) reasons.push(value === "unknown" ? "unknown_predicate" : "predicate_not_matched"); }
  for (const exclusion of protocol.exclusions) { const value = predicateTruth(exclusion, input, at, bound); if (value !== false) reasons.push(value === "unknown" ? "unknown_exclusion" : "exclusion_matched"); }
  for (const stop of protocol.stopCriteria) { const value = predicateTruth(stop, input, at, bound); if (value !== false) reasons.push(value === "unknown" ? "unknown_stop_criterion" : "stop_criterion_matched"); }
  const committed = input.applications.filter(a => a.protocolId === protocol.id && a.state === "delivered");
  deny(committed.length >= protocol.maxApplications, "application_limit");
  const last = Math.max(...committed.map(a => Date.parse(a.deliveredAt ?? a.createdAt)));
  deny(Number.isFinite(last) && at - last < protocol.minIntervalSeconds * 1000, "cooldown");
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)], guard: structuredClone(input.guard) };
}

export function evaluateEligibility(input: EligibilityInput, now: string): EligibilityResult { return eligibility(input, now); }

function onlyNonTrigger(reasons: string[]): boolean {
  return reasons.includes("predicate_not_matched") && reasons.every(reason => ["predicate_not_matched", "cooldown", "application_limit"].includes(reason));
}

/** Skip ordinary non-trigger work; relevant uncertainty and all safety stops still require evaluation. */
export function isProtocolNotTriggered(state: CareState, protocol: ReusableProtocol, now: string): boolean {
  const { input, bound } = eligibilityInput(state, protocol, now);
  return onlyNonTrigger(eligibility(input, now, bound).reasons);
}

function protocolById(state: CareState, id: string): ReusableProtocol { const protocol = state.protocols.find(p => p.id === id); if (!protocol) fail("NOT_FOUND", "Protocole inaccessible.", 404); return protocol; }
function clinicianActor(state: CareState, protocol: ReusableProtocol): Actor | null {
  const principal = state.accounts.find(a => a.id === protocol.clinicianId && a.role === "clinician" && a.enabled);
  if (!principal) return null;
  return { id: principal.id, role: "clinician", patientId: null, displayName: principal.displayName };
}

function eligibilityInput(state: CareState, protocol: ReusableProtocol, now: string): { input: EligibilityInput; bound: Map<string, MonitoringRequirement>; actor: Actor | null } {
  const actor = clinicianActor(state, protocol), patient = state.patients.find(p => p.id === protocol.patientId);
  let authority = false;
  if (actor) { try { requirePatientCapability(state, actor, protocol.patientId, "manage"); authority = true; } catch { /* A worker does not gain read access from a historical protocol. */ } }
  const guard = currentGuard(state, protocol.patientId);
  const evidence = authority ? buildAuthorizedEvidence(state, actor!, protocol.patientId) : { patientId: protocol.patientId, guard, sources: [], facts: [], measurements: [], chunks: [], coverage: [] };
  const plan = state.carePlans.find(p => p.patientId === protocol.patientId) ?? null;
  return { actor, bound: new Map([...requirements(state, plan)].map(([id, value]) => [id, value.requirement])), input: { protocol, plan, guard, profiles: state.monitoringProfiles, hasCurrentAuthority: authority, hasUnassessedContext: hasUnassessedClinicalContext(state, protocol.patientId), consent: Boolean(patient?.consent), evidence, evaluations: state.conditionEvaluations.filter(e => e.patientId === protocol.patientId), applications: state.protocolApplications.filter(a => a.patientId === protocol.patientId), unresolved: state.alerts.filter(a => a.patientId === protocol.patientId) } };
}

function validatePredicates(value: unknown, state: CareState, patientId: string, plan: EligibilityInput["plan"]): ProtocolPredicate[] {
  if (!Array.isArray(value) || value.length > 12) fail("INVALID_PREDICATES");
  const bound = requirements(state, plan);
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("INVALID_PREDICATES");
    const kind = (raw as Record<string, unknown>).kind;
    if (kind === "priority_equals") {
      const p = strictMonitoringInput(raw, ["kind", "conditionFactId", "value"]), conditionFactId = boundedText(p.conditionFactId, 100);
      if (p.value !== "orange" || !plan?.profileBindings.some(b => b.conditionFactId === conditionFactId) || !state.medicalFacts.some(f => f.id === conditionFactId && f.patientId === patientId && f.kind === "condition" && f.polarity === "affirmed" && !f.supersededBy)) fail("INVALID_PREDICATES");
      return { kind, conditionFactId, value: "orange" };
    }
    if (kind === "fact_equals") {
      const p = strictMonitoringInput(raw, ["kind", "factId", "polarity"]), factId = boundedText(p.factId, 100);
      if (!["affirmed", "negated"].includes(String(p.polarity)) || !state.medicalFacts.some(f => f.id === factId && f.patientId === patientId && !f.supersededBy)) fail("INVALID_PREDICATES");
      return { kind, factId, polarity: p.polarity as "affirmed" | "negated" };
    }
    if (kind === "evidence_fresh") {
      const p = strictMonitoringInput(raw, ["kind", "requirementId", "maxAgeSeconds"]), requirementId = boundedText(p.requirementId, 150);
      if (!bound.has(requirementId)) fail("INVALID_PREDICATES");
      return { kind, requirementId, maxAgeSeconds: integer(p.maxAgeSeconds, 1, 604800) };
    }
    if (kind === "requirements_complete") {
      const p = strictMonitoringInput(raw, ["kind", "requirementIds"]);
      if (!Array.isArray(p.requirementIds) || !p.requirementIds.length || p.requirementIds.length > 12 || p.requirementIds.some(id => typeof id !== "string" || !bound.has(id)) || new Set(p.requirementIds).size !== p.requirementIds.length) fail("INVALID_PREDICATES");
      return { kind, requirementIds: [...p.requirementIds] as string[] };
    }
    fail("INVALID_PREDICATES");
  });
}

function authorization(state: CareState, actor: Actor, patientId: string, body: ProtocolAuthorization | ProtocolReviewInput, at: string, revision = false) {
  const input = strictMonitoringInput(body, ["sourceProposalId", "actions", "predicates", "exclusions", "stopCriteria", "validUntil", "minIntervalSeconds", "maxApplications", "expectedGuard", "clientId", ...(revision ? ["expectedRevision", "reason"] : [])]);
  requirePatientCapability(state, actor, patientId, "manage");
  const guard = assertCurrentMonitoringGuard(state, patientId, input.expectedGuard);
  const plan = state.carePlans.find(p => p.patientId === patientId);
  if (!plan || plan.state !== "active" || plan.clinicianId !== actor.id) fail("PLAN_INACTIVE", "Plan actif approuvé requis.", 409);
  if (hasUnassessedClinicalContext(state, patientId)) fail("UNASSESSED_CONTEXT", "Un message clinique attend sa revue.", 409);
  const sourceProposalId = boundedText(input.sourceProposalId, 100), proposal = state.careProposals.find(p => p.id === sourceProposalId && p.patientId === patientId);
  if (!proposal || proposal.state !== "approved" || proposal.kind !== "home_measurement" || proposal.decision?.clinicianId !== actor.id || !state.careActions.some(a => a.proposalId === proposal.id && plan.actionIds.includes(a.id))) fail("APPROVED_HOME_ACTION_REQUIRED");
  if (!revision && (proposal.guard.contextRevision !== guard.contextRevision || proposal.guard.authorityRevision !== guard.authorityRevision)) fail("STALE_CONTEXT", "Nouvelle revue explicite requise.", 409);
  if (!Array.isArray(input.actions) || input.actions.length !== 1) fail("INVALID_ACTION");
  let action: ProtocolAuthorization["actions"][number];
  try { action = validateActionTemplate(input.actions[0]); } catch { fail("INVALID_ACTION"); }
  if (actionTemplateDefinition(action.templateId).kind !== "home_measurement" || canonical(action) !== canonical(proposal.action)) fail("UNCHANGED_APPROVED_ACTION_REQUIRED");
  try { validateGroundedOutput({ claims: [], questionIds: [], proposals: [{ kind: proposal.kind, action, sources: proposal.sources, missingQuestionIds: [] }] }, buildAuthorizedEvidence(state, actor, patientId)); } catch { fail("STALE_SOURCES", "Les sources doivent être revues.", 409); }
  const predicates = validatePredicates(input.predicates, state, patientId, plan), exclusions = validatePredicates(input.exclusions, state, patientId, plan), stopCriteria = validatePredicates(input.stopCriteria, state, patientId, plan);
  if (!predicates.some(p => p.kind === "priority_equals") || !predicates.some(p => p.kind === "requirements_complete")) fail("INVALID_PREDICATES", "Priorité orange et exigences de preuve requises.");
  const validUntil = boundedText(input.validUntil, 40), validity = Date.parse(validUntil) - Date.parse(at);
  if (!Number.isFinite(validity) || validity <= 0 || validity > 30 * 86400000) fail("INVALID_VALIDITY");
  return { sourceProposalId, actions: [action], predicates, exclusions, stopCriteria, validUntil: new Date(validUntil).toISOString(), minIntervalSeconds: integer(input.minIntervalSeconds, 60, 604800), maxApplications: integer(input.maxApplications, 1, 100), guard, clientId: boundedText(input.clientId, 128) };
}

export class ProtocolService {
  constructor(public store: CareStoreAdapter, private clock = () => new Date().toISOString()) {}
  authorize(actor: Actor, patientId: string, body: ProtocolAuthorization): ReusableProtocol {
    return this.store.transaction(state => {
      requirePatientCapability(state, actor, patientId, "manage");
      const clientId = boundedText(body.clientId, 128);
      const result = replay(state, JSON.stringify([actor.id, "protocol_authorize", patientId, clientId]), body, () => {
        const at = this.clock(), a = authorization(state, actor, patientId, body, at);
        const protocol: ReusableProtocol = { id: careId(), patientId, revision: 1, state: "active", clinicianId: actor.id, sourceProposalId: a.sourceProposalId, authorityRevision: a.guard.authorityRevision, requiredContextRevision: a.guard.contextRevision, carePlanRevision: a.guard.carePlanRevision, profileVersions: [...a.guard.profileVersions], actions: a.actions, predicates: a.predicates, exclusions: a.exclusions, stopCriteria: a.stopCriteria, validUntil: a.validUntil, minIntervalSeconds: a.minIntervalSeconds, maxApplications: a.maxApplications, createdAt: at, history: [{ revision: 1, at, clinicianId: actor.id, reason: "Autorisation explicite de réutilisation" }] };
        state.protocols.push(protocol); recordProtocolHistory(state, protocol, at, actor.id, "Autorisation explicite de réutilisation"); journalAccess(state, actor, patientId, "authorize_protocol", "protocol", protocol.id, "allowed"); return structuredClone(protocol);
      });
      return structuredClone(protocolById(state, result.id));
    });
  }
  revise(actor: Actor, id: string, body: ProtocolReviewInput): ReusableProtocol {
    return this.store.transaction(state => {
      const protocol = protocolById(state, id); requirePatientCapability(state, actor, protocol.patientId, "manage");
      replay(state, JSON.stringify([actor.id, "protocol_revise", id, boundedText(body.clientId, 128)]), body, () => {
        if (protocol.revision !== integer(body.expectedRevision, 1) || protocol.state === "revoked") fail("STALE_REVISION", "Le protocole a changé.", 409);
        const at = this.clock(), reason = boundedText(body.reason, 1000), a = authorization(state, actor, protocol.patientId, body, at, true);
        if (a.sourceProposalId !== protocol.sourceProposalId || canonical(a.actions) !== canonical(protocol.actions)) fail("UNCHANGED_APPROVED_ACTION_REQUIRED");
        recordProtocolHistory(state, protocol, at, actor.id, "État avant nouvelle revue explicite");
        Object.assign(protocol, { revision: protocol.revision + 1, state: "active", clinicianId: actor.id, authorityRevision: a.guard.authorityRevision, requiredContextRevision: a.guard.contextRevision, carePlanRevision: a.guard.carePlanRevision, profileVersions: a.guard.profileVersions, predicates: a.predicates, exclusions: a.exclusions, stopCriteria: a.stopCriteria, validUntil: a.validUntil, minIntervalSeconds: a.minIntervalSeconds, maxApplications: a.maxApplications });
        recordProtocolHistory(state, protocol, at, actor.id, reason); journalAccess(state, actor, protocol.patientId, "revise_protocol", "protocol", id, "allowed"); return structuredClone(protocol);
      });
      return structuredClone(protocol);
    });
  }
  setState(actor: Actor, id: string, body: ProtocolStateInput): ReusableProtocol {
    strictMonitoringInput(body, ["action", "expectedRevision", "reason", "clientId"]);
    if (!["suspend", "revoke"].includes(body.action)) fail("INVALID_ACTION");
    return this.store.transaction(state => {
      const protocol = protocolById(state, id); requirePatientCapability(state, actor, protocol.patientId, "manage");
      replay(state, JSON.stringify([actor.id, "protocol_state", id, boundedText(body.clientId, 128)]), body, () => {
        if (protocol.revision !== integer(body.expectedRevision, 1) || protocol.state === "revoked") fail("STALE_REVISION", "Le protocole a changé.", 409);
        const at = this.clock(), reason = boundedText(body.reason, 1000);
        recordProtocolHistory(state, protocol, at, actor.id, "État avant suspension ou révocation");
        protocol.state = body.action === "revoke" ? "revoked" : "suspended"; protocol.revision++;
        recordProtocolHistory(state, protocol, at, actor.id, reason); journalAccess(state, actor, protocol.patientId, `protocol_${body.action}`, "protocol", id, "allowed"); return structuredClone(protocol);
      });
      return structuredClone(protocol);
    });
  }
  list(actor: Actor, patientId: string) {
    return this.store.transaction(state => { requirePatientReadScope(state, actor, patientId, "summary"); journalAccess(state, actor, patientId, "read_protocols", "patient", patientId, "allowed"); return { protocols: structuredClone(state.protocols.filter(p => p.patientId === patientId)) }; });
  }
  applications(actor: Actor, patientId: string) {
    return this.store.transaction(state => { requirePatientReadScope(state, actor, patientId, "summary"); journalAccess(state, actor, patientId, "read_protocol_applications", "patient", patientId, "allowed"); return { applications: structuredClone(state.protocolApplications.filter(p => p.patientId === patientId)) }; });
  }

  /** Internal worker operation: snapshots before asynchronous work, rechecks everything at commit. */
  async apply(id: string, triggerId: string, expectedGuard: RevisionGuard, now: string, options: { beforeCommit?: () => Promise<void>; commitCondition?: (state: CareState) => boolean } = {}): Promise<ProtocolApplication> {
    boundedText(triggerId, 100);
    const suppliedAt = Date.parse(now), started = performance.now();
    if (!Number.isFinite(suppliedAt)) fail("INVALID_TIME");
    const currentTime = () => {
      const clockAt = Date.parse(this.clock());
      if (!Number.isFinite(clockAt)) fail("INVALID_TIME");
      return new Date(Math.ceil(Math.max(clockAt, suppliedAt + performance.now() - started))).toISOString();
    };
    const replayRelease = (state: CareState, protocol: ReusableProtocol, existing: ProtocolApplication, at: string) => {
      const actor = clinicianActor(state, protocol);
      if (!actor) fail("APPLICATION_UNAVAILABLE", "Autorité indisponible.", 409);
      requirePatientCapability(state, actor, protocol.patientId, "manage");
      if (canonical(existing.guard) !== canonical(currentGuard(state, protocol.patientId)) || protocol.state !== "active" || existing.protocolVersion !== protocol.revision || Date.parse(protocol.validUntil) <= Date.parse(at)) fail("APPLICATION_UNAVAILABLE", "Le contexte a changé.", 409);
      if (existing.state === "delivered") {
        refreshMonitoring(state, protocol.patientId, at);
        const { input, bound } = eligibilityInput(state, protocol, at);
        // Idempotent release is not an additional application; retain all other counts.
        input.applications = input.applications.filter(application => application.id !== existing.id);
        if (!eligibility(input, at, bound).eligible) fail("APPLICATION_UNAVAILABLE", "Les conditions approuvées ne sont plus valides.", 409);
      }
      return structuredClone(existing);
    };
    const start = this.store.transaction(state => {
      const protocol = protocolById(state, id), patientId = protocol.patientId;
      assertCurrentMonitoringGuard(state, patientId, expectedGuard);
      if (!state.measurements.some(m => m.id === triggerId && m.patientId === patientId)) fail("INVALID_TRIGGER");
      const existing = state.protocolApplications.find(a => a.protocolId === id && a.triggerId === triggerId);
      if (existing) {
        return { existing: replayRelease(state, protocol, existing, currentTime()), guard: currentGuard(state, patientId), revision: protocol.revision };
      }
      if (state.patients.find(p => p.id === patientId)?.consent) refreshMonitoring(state, patientId, now);
      return { existing: null, guard: currentGuard(state, patientId), revision: protocol.revision };
    });
    if (start.existing) return start.existing;
    await options.beforeCommit?.();
    return this.store.transaction(state => {
      if (options.commitCondition && !options.commitCondition(state)) fail("LEASE_LOST", "Le travail a été repris.", 409);
      const protocol = protocolById(state, id), at = currentTime();
      const existing = state.protocolApplications.find(a => a.protocolId === id && a.triggerId === triggerId);
      if (existing) return replayRelease(state, protocol, existing, at);
      if (state.patients.find(p => p.id === protocol.patientId)?.consent) refreshMonitoring(state, protocol.patientId, at);
      const { input, bound, actor } = eligibilityInput(state, protocol, at);
      const evaluated = eligibility(input, at, bound), reasons = [...evaluated.reasons];
      if (canonical(start.guard) !== canonical(input.guard) || start.revision !== protocol.revision) reasons.push("changed_delivery_guard");
      const relevant = [...new Set(protocol.predicates.flatMap(p => p.kind === "requirements_complete" ? p.requirementIds : p.kind === "evidence_fresh" ? [p.requirementId] : []))];
      const sources = relevant.flatMap(reqId => { const req = bound.get(reqId), source = req && requirementSource(req, input.evidence, Date.parse(at)); return source ? [source] : []; });
      if (!sources.some(s => s.id === triggerId && s.kind === "measurement")) reasons.push("trigger_not_current");
      const notTriggered = onlyNonTrigger(reasons);
      const application: ProtocolApplication = { id: careId(), patientId: protocol.patientId, protocolId: id, protocolVersion: protocol.revision, triggerId, guard: structuredClone(input.guard), state: notTriggered ? "not_triggered" : reasons.length ? "blocked" : "delivered", reasons: [...new Set(reasons)], sources, actionId: null, createdAt: at, deliveredAt: null };
      if (!reasons.length) {
        const action: CareAction = { id: careId(), patientId: protocol.patientId, planId: input.plan!.id, revision: 1, proposalId: null, protocolId: id, originVersion: protocol.revision, action: structuredClone(protocol.actions[0]), dueAt: at, state: "pending", reportedAt: null, clientId: `protocol:${id}:${triggerId}`, createdAt: at };
        state.careActions.push(action); application.actionId = action.id; application.deliveredAt = at;
        const language = state.patients.find(p => p.id === protocol.patientId)!.language;
        state.messages.push({ id: careId(), revision: 1, patientId: protocol.patientId, clinicianId: protocol.clinicianId, threadId: JSON.stringify([protocol.patientId, protocol.clinicianId]), authorId: protocol.clinicianId, authorCategory: "system", text: actionTemplateDefinition(action.action.templateId).patientText[language], kind: "approved_action", actionId: action.id, createdAt: at, readAt: null, review: null });
        state.dueTasks.push({ id: careId(), patientId: protocol.patientId, kind: "remind", phaseKey: `action:${action.id}:initial`, dueAt: at, attempts: 0, state: "pending", leaseOwner: null, leaseUntil: null, guard: input.guard, resourceId: action.id });
        journalAccess(state, actor!, protocol.patientId, "apply_protocol", "protocol_application", application.id, "allowed");
      } else if (!notTriggered && !state.dueTasks.some(t => t.phaseKey === `protocol-blocked:${application.id}`)) {
        state.dueTasks.push({ id: careId(), patientId: protocol.patientId, kind: "review_overdue", phaseKey: `protocol-blocked:${application.id}`, dueAt: at, attempts: 0, state: "pending", leaseOwner: null, leaseUntil: null, guard: input.guard, resourceId: application.id });
      }
      state.protocolApplications.push(application); return structuredClone(application);
    });
  }
}

/** Current approval only; completion/read history must never manufacture a fresh authority. */
export function isActionCurrentlyApproved(state: CareState, action: CareAction, now: string): boolean {
  return currentActionApproval(state, action, now).currentlyApproved;
}

/** Recompute at the read boundary; keep stored decisions and action progress unchanged. */
export function currentActionApproval(state: CareState, action: CareAction, now: string): CareActionApproval {
  const reasons: string[] = [], at = Date.parse(now);
  const deny = (condition: boolean, reason: string) => { if (condition) reasons.push(reason); };
  const plan = state.carePlans.find(p => p.id === action.planId && p.patientId === action.patientId), patient = state.patients.find(p => p.id === action.patientId);
  deny(!Number.isFinite(at), "invalid_time");
  deny(!patient?.consent, "consent_withdrawn");
  deny(action.state !== "pending", "action_not_pending");
  deny(!plan || plan.state !== "active" || !plan.clinicianId, "plan_inactive");
  const principal = state.accounts.find(a => a.id === plan?.clinicianId && a.role === "clinician" && a.enabled);
  let authority = false;
  if (principal) { try { requirePatientCapability(state, { id: principal.id, role: "clinician", patientId: null, displayName: principal.displayName }, action.patientId, "manage"); authority = true; } catch { /* Historical approval cannot supply current rights. */ } }
  deny(!authority, "authority_unavailable");
  try { validateActionTemplate(action.action); } catch { reasons.push("invalid_action"); }
  deny(Boolean(plan?.reviewDeadline && (!Number.isFinite(Date.parse(plan.reviewDeadline)) || Date.parse(plan.reviewDeadline) <= at)), "plan_review_overdue");
  const guard = currentGuard(state, action.patientId);
  deny(hasUnassessedClinicalContext(state, action.patientId), "unassessed_context");
  if (action.protocolId) {
    const protocol = state.protocols.find(p => p.id === action.protocolId);
    deny(!protocol || protocol.state !== "active", "protocol_inactive");
    deny(Boolean(protocol && (protocol.revision !== action.originVersion || protocol.requiredContextRevision !== guard.contextRevision || protocol.authorityRevision !== guard.authorityRevision || protocol.carePlanRevision !== guard.carePlanRevision || canonical(protocol.profileVersions) !== canonical(guard.profileVersions))), "changed_approved_context");
    deny(Boolean(protocol && (!Number.isFinite(Date.parse(protocol.validUntil)) || Date.parse(protocol.validUntil) <= at)), "protocol_expired");
    deny(!protocol || protocol.patientId !== action.patientId || protocol.clinicianId !== plan?.clinicianId || !protocol.actions.some(a => canonical(a) === canonical(action.action)) || !state.protocolApplications.some(a => a.actionId === action.id && a.patientId === action.patientId && a.protocolId === action.protocolId && a.protocolVersion === action.originVersion && a.state === "delivered"), "source_approval_unavailable");
  } else {
    const proposal = state.careProposals.find(p => p.id === action.proposalId && p.patientId === action.patientId);
    deny(!proposal || proposal.state !== "approved" || proposal.revision !== action.originVersion || proposal.decision?.clinicianId !== plan?.clinicianId || canonical(proposal.action) !== canonical(action.action) || !plan?.actionIds.includes(action.id), "source_approval_unavailable");
    deny(Boolean(proposal && (proposal.guard.contextRevision !== guard.contextRevision || proposal.guard.authorityRevision !== guard.authorityRevision)), "changed_approved_context");
  }
  return { currentlyApproved: reasons.length === 0, reasons: [...new Set(reasons)], checkedAt: now };
}

export function projectCareAction(state: CareState, action: CareAction, now: string): CareAction {
  return { ...structuredClone(action), approval: currentActionApproval(state, action, now) };
}
