import type { Actor } from "../contracts/care";
import type { DueTask, RevisionGuard, TickResult } from "../contracts/monitoring";
import { careId, type CareState, type CareStoreAdapter } from "./care-store";
import { refreshMonitoring } from "./care-service";
import { actionTemplateDefinition } from "./monitoring-content";
import { boundedText, canonical, fail, hash } from "./monitoring-utils";
import { currentGuard, requirePatientCapability } from "./patient-access-service";
import { isActionCurrentlyApproved, isProtocolNotTriggered, ProtocolService } from "./protocol-service";

export type MonitoringWorkerOptions = { beforeCommit?: (task: Readonly<DueTask>) => Promise<void>; maxTasksPerTick?: number; clock?: () => string };
const LEASE_MS = 60000;
function currentClinician(state: CareState, patientId: string): Actor | null {
  const grant = state.careGrants.find(g => g.patientId === patientId && g.relationship === "primary" && g.state === "active");
  const principal = grant && state.accounts.find(a => a.id === grant.clinicianId && a.role === "clinician" && a.enabled);
  if (!principal) return null;
  const actor: Actor = { id: principal.id, role: "clinician", patientId: null, displayName: principal.displayName };
  try { requirePatientCapability(state, actor, patientId, "manage"); return actor; } catch { return null; }
}
function sameGuard(a: RevisionGuard, b: RevisionGuard) { return canonical(a) === canonical(b); }
function phase(state: CareState, patientId: string, kind: DueTask["kind"], phaseKey: string, dueAt: string, resourceId: string | null, guard: RevisionGuard) {
  if (state.dueTasks.some(t => t.phaseKey === phaseKey)) return;
  state.dueTasks.push({ id: careId(), patientId, kind, phaseKey, dueAt, attempts: 0, state: "pending", leaseOwner: null, leaseUntil: null, guard: structuredClone(guard), resourceId });
}
function reviewPhaseKey(planId: string, revision: number, deadline: string) { return `review:${planId}:${revision}:${deadline}`; }
function reviewDelivered(state: CareState, patientId: string, logicalPhase: string) {
  return state.dueTasks.some(task => task.patientId === patientId && task.kind === "review_overdue" && task.state === "completed" && (task.phaseKey === logicalPhase || task.phaseKey.startsWith(`${logicalPhase}:guard:`)));
}
function schedule(state: CareState, now: string) {
  for (const patient of state.patients) {
    if (!patient.consent || !currentClinician(state, patient.id)) continue;
    const guard = currentGuard(state, patient.id), fingerprint = hash(canonical(guard));
    phase(state, patient.id, "evaluate", `evaluation:${patient.id}:${fingerprint}:initial`, now, null, guard);
    const evaluations = state.conditionEvaluations.filter(e => e.patientId === patient.id && sameGuard(e.guard, guard));
    for (const deadline of new Set(evaluations.flatMap(e => e.nextDueAt ? [e.nextDueAt] : []))) phase(state, patient.id, "evaluate", `evaluation:${patient.id}:${fingerprint}:deadline:${deadline}`, deadline, null, guard);
    for (const action of state.careActions.filter(a => a.patientId === patient.id && a.state === "pending")) {
      if (!state.reminders.some(r => r.patientId === patient.id && r.origin?.actionId === action.id)) phase(state, patient.id, "remind", `action:${action.id}:guard:${fingerprint}`, action.dueAt, action.id, guard);
    }
    const plan = state.carePlans.find(p => p.patientId === patient.id);
    if (plan?.reviewDeadline) {
      const logicalPhase = reviewPhaseKey(plan.id, plan.revision, plan.reviewDeadline);
      if (!reviewDelivered(state, patient.id, logicalPhase)) phase(state, patient.id, "review_overdue", `${logicalPhase}:guard:${fingerprint}`, plan.reviewDeadline, plan.id, guard);
    }
    for (const protocol of state.protocols.filter(p => p.patientId === patient.id && p.state === "active")) {
      const ids = protocol.predicates.flatMap(p => p.kind === "requirements_complete" ? p.requirementIds : p.kind === "evidence_fresh" ? [p.requirementId] : []);
      const kinds = state.monitoringProfiles.filter(p => plan?.profileBindings.some(b => b.profileId === p.id && b.profileVersion === p.version)).flatMap(p => p.requirements.filter(r => ids.includes(r.id) && r.kind === "measurement").flatMap(r => r.measurementKind ? [r.measurementKind] : []));
      const latest = state.measurements.filter(m => m.patientId === patient.id && kinds.includes(m.kind)).sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt) || a.id.localeCompare(b.id))[0];
      if (latest && !state.protocolApplications.some(a => a.protocolId === protocol.id && a.triggerId === latest.id) && !isProtocolNotTriggered(state, protocol, now)) phase(state, patient.id, "protocol_apply", `protocol:${protocol.id}:${latest.id}`, now, JSON.stringify([protocol.id, latest.id]), guard);
    }
  }
}
function clearLease(task: DueTask) { task.leaseOwner = null; task.leaseUntil = null; }
function leaseCurrent(state: CareState, task: DueTask, workerId: string, commitAt: number): boolean {
  const current = state.dueTasks.find(t => t.id === task.id);
  return Boolean(current && current.state === "claimed" && current.leaseOwner === workerId && current.attempts === task.attempts && current.leaseUntil === task.leaseUntil && current.leaseUntil && Date.parse(current.leaseUntil) > commitAt);
}
function authorisedTask(state: CareState, task: DueTask): boolean { return Boolean(currentClinician(state, task.patientId) && sameGuard(currentGuard(state, task.patientId), task.guard)); }

/** Short synchronous claims and commits surround asynchronous work. No browser process is involved. */
export class MonitoringWorker {
  constructor(public store: CareStoreAdapter, private options: MonitoringWorkerOptions = {}) {}
  async tick(now: string, workerId: string): Promise<TickResult> {
    boundedText(workerId, 100);
    const timestamp = Date.parse(now);
    if (!Number.isFinite(timestamp)) fail("INVALID_TIME");
    now = new Date(timestamp).toISOString();
    const started = performance.now();
    const commitTime = () => {
      const at = this.options.clock ? Date.parse(this.options.clock()) : timestamp + performance.now() - started;
      if (!Number.isFinite(at)) fail("INVALID_WORKER_CLOCK");
      return Math.max(timestamp, at);
    };
    const limit = this.options.maxTasksPerTick ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail("INVALID_WORKER_LIMIT");
    const result: TickResult = { claimed: 0, completed: 0, failed: 0, heartbeatAt: now };
    this.store.transaction(state => { state.workerHeartbeats[workerId] = now; schedule(state, now); });
    for (let count = 0; count < limit; count++) {
      const task = this.store.transaction(state => {
        const candidates = state.dueTasks.filter(t => Date.parse(t.dueAt) <= timestamp && (t.state === "pending" || t.state === "claimed" && (!t.leaseUntil || Date.parse(t.leaseUntil) <= timestamp)));
        candidates.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || (a.kind === "evaluate" ? -1 : b.kind === "evaluate" ? 1 : 0) || a.id.localeCompare(b.id));
        const candidate = candidates[0];
        if (!candidate) return null;
        candidate.state = "claimed"; candidate.leaseOwner = workerId; candidate.leaseUntil = new Date(timestamp + LEASE_MS).toISOString(); candidate.attempts++;
        return structuredClone(candidate);
      });
      if (!task) break;
      result.claimed++;
      try {
        await this.options.beforeCommit?.(task);
        if (task.kind === "protocol_apply") {
          const eligible = this.store.transaction(state => {
            if (!leaseCurrent(state, task, workerId, commitTime())) return false;
            if (!authorisedTask(state, task)) { const current = state.dueTasks.find(t => t.id === task.id)!; current.state = "cancelled"; clearLease(current); return false; }
            return true;
          });
          if (!eligible) continue;
          let pair: unknown;
          try { pair = JSON.parse(task.resourceId ?? ""); } catch { fail("INVALID_TASK"); }
          if (!Array.isArray(pair) || pair.length !== 2 || pair.some(v => typeof v !== "string")) fail("INVALID_TASK");
          const executionAt = new Date(commitTime()).toISOString();
          await new ProtocolService(this.store, () => executionAt).apply(pair[0], pair[1], task.guard, executionAt, { commitCondition: state => leaseCurrent(state, task, workerId, commitTime()) && authorisedTask(state, task) });
        }
        const completed = this.store.transaction(state => {
          if (!leaseCurrent(state, task, workerId, commitTime())) return false;
          const current = state.dueTasks.find(t => t.id === task.id)!;
          if (!authorisedTask(state, task)) { current.state = "cancelled"; clearLease(current); return false; }
          const clinician = currentClinician(state, task.patientId)!;
          const executionAt = new Date(commitTime()).toISOString();
          if (task.kind === "evaluate") refreshMonitoring(state, task.patientId, executionAt);
          if (task.kind === "remind") {
            const action = state.careActions.find(a => a.id === task.resourceId && a.patientId === task.patientId);
            if (!action || !isActionCurrentlyApproved(state, action, executionAt)) { current.state = "cancelled"; clearLease(current); return false; }
            if (!state.reminders.some(r => r.origin?.actionId === action.id)) {
              const language = state.patients.find(p => p.id === task.patientId)!.language, label = actionTemplateDefinition(action.action.templateId).patientText[language];
              state.reminders.push({ id: careId(), patientId: task.patientId, label, dueAt: action.dueAt, acknowledgedAt: null, taken: null, delivery: "sent", origin: { kind: "care_action", actionId: action.id, planId: action.planId, protocolId: action.protocolId, originVersion: action.originVersion } });
              if (!state.messages.some(m => m.kind === "approved_action" && m.actionId === action.id)) state.messages.push({ id: careId(), revision: 1, patientId: task.patientId, clinicianId: clinician.id, threadId: JSON.stringify([task.patientId, clinician.id]), authorId: clinician.id, authorCategory: "system", text: label, kind: "approved_action", actionId: action.id, createdAt: executionAt, readAt: null, review: null });
            }
          }
          if (task.kind === "review_overdue") {
            const plan = state.carePlans.find(p => p.id === task.resourceId), blocked = state.protocolApplications.find(a => a.id === task.resourceId && a.state === "blocked");
            if (!blocked && (!plan || !plan.reviewDeadline || Date.parse(plan.reviewDeadline) > timestamp)) { current.state = "cancelled"; clearLease(current); return false; }
            if (blocked || !reviewDelivered(state, task.patientId, reviewPhaseKey(plan!.id, plan!.revision, plan!.reviewDeadline!))) {
              const language = state.patients.find(p => p.id === task.patientId)!.language;
              state.messages.push({ id: careId(), revision: 1, patientId: task.patientId, clinicianId: clinician.id, threadId: JSON.stringify([task.patientId, clinician.id]), authorId: clinician.id, authorCategory: "system", text: language === "fr" ? "Une revue médicale du suivi est nécessaire. Ce rappel ne garantit pas un contact du médecin." : "تلزم مراجعة طبية للمتابعة. هذا التذكير لا يضمن اتصال الطبيب.", kind: "administrative", actionId: null, createdAt: executionAt, readAt: null, review: null });
            }
          }
          current.state = "completed"; clearLease(current); return true;
        });
        if (completed) result.completed++;
      } catch {
        result.failed++;
        this.store.transaction(state => {
          if (!leaseCurrent(state, task, workerId, commitTime())) return;
          const current = state.dueTasks.find(t => t.id === task.id)!;
          if (!authorisedTask(state, task)) current.state = "cancelled";
          else if (current.attempts >= 5) current.state = "failed";
          else { current.state = "pending"; current.dueAt = new Date(timestamp + 15000 * current.attempts).toISOString(); }
          clearLease(current);
        });
      }
    }
    // Newly changed assessments schedule their next freshness deadline immediately.
    this.store.transaction(state => schedule(state, now));
    return result;
  }
}
