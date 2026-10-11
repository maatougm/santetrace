import type { Actor } from "../contracts/care";
import type { AssistantInput, AssistantResponse, AiMeta } from "../contracts/monitoring";
import type { CareState, CareStoreAdapter } from "./care-store";
import { strictMonitoringInput } from "./care-plan-service";
import { patientMessage, refreshMonitoring } from "./care-service";
import { InterventionService } from "./intervention-service";
import { buildAuthorizedEvidence } from "./medical-evidence";
import { actionTemplateDefinition } from "./monitoring-content";
import { boundedText, fail } from "./monitoring-utils";
import { currentGuard, journalAccess, requirePatientCapability } from "./patient-access-service";
import { isActionCurrentlyApproved, projectCareAction } from "./protocol-service";

const copy = {
  fr: { noReferent: "Aucun médecin référent autorisé n’est disponible dans ce dossier. Invitez un médecin pour une revue ; aucun message n’a été envoyé.", recorded: "Votre question est enregistrée pour la revue de votre médecin référent. Cela ne garantit pas une réponse ni un contact. Ne modifiez pas votre traitement sur cette base.", needsReview: "Aucune consigne approuvée applicable actuellement. Une revue de votre médecin est nécessaire.", noMeasurement: "Aucune mesure n’est enregistrée dans votre dossier.", noPlan: "Votre plan attend la revue d’un médecin référent autorisé.", activePlan: "Votre plan de suivi est actif. Les actions proposées nécessitent une approbation du médecin.", suspendedPlan: "Votre plan de suivi est suspendu ou doit être revu par votre médecin.", allDone: "Aucune action approuvée en attente actuellement." },
  ar: { noReferent: "لا يوجد طبيب مرجعي مخوّل في هذا الملف. ادعُ طبيباً للمراجعة. لم تُرسل أي رسالة.", recorded: "تم تسجيل سؤالك لمراجعة طبيبك المرجعي. هذا لا يضمن الرد أو الاتصال. لا تغيّر علاجك بناءً على ذلك.", needsReview: "لا توجد تعليمات معتمدة قابلة للتطبيق حالياً. تلزم مراجعة الطبيب.", noMeasurement: "لا توجد قياسات مسجلة في ملفك.", noPlan: "خطة المتابعة تنتظر مراجعة طبيب مرجعي مخوّل.", activePlan: "خطة المتابعة نشطة. الإجراءات المقترحة تتطلب موافقة الطبيب.", suspendedPlan: "خطة المتابعة معلّقة أو تحتاج إلى مراجعة الطبيب.", allDone: "لا توجد إجراءات معتمدة قيد الانتظار حالياً." },
};

function meta(state: CareState, patientId: string, at: string): AiMeta {
  return { mode: "deterministic", model: null, schemaVersion: "approved-assistant-v1", promptVersion: "closed-patient-queries-v1", guard: currentGuard(state, patientId), generatedAt: at, stale: false, failureReason: null };
}
function response(state: CareState, patientId: string, at: string, replyKind: AssistantResponse["replyKind"], answer: string): AssistantResponse {
  return { replyKind, answer, approvedActions: [], sources: [], messageId: null, meta: meta(state, patientId, at) };
}
function primary(state: CareState, actor: Actor, patientId: string): string | null {
  const grant = state.careGrants.find(g => g.patientId === patientId && g.relationship === "primary" && g.state === "active");
  if (!grant) return null;
  const principal = state.accounts.find(a => a.id === grant.clinicianId && a.role === "clinician" && a.enabled);
  if (!principal) return null;
  try { requirePatientCapability(state, { id: principal.id, role: "clinician", patientId: null, displayName: principal.displayName }, patientId, "manage"); requirePatientCapability(state, actor, patientId, "owner"); } catch { return null; }
  return principal.id;
}

export class AssistantService {
  constructor(public store: CareStoreAdapter, private clock = () => new Date().toISOString()) {}

  respond(actor: Actor, patientId: string, body: AssistantInput): AssistantResponse {
    if (!body || typeof body !== "object" || !["record_query", "question", "health_update"].includes(body.kind)) fail("INVALID_INPUT");
    strictMonitoringInput(body, body.kind === "record_query" ? ["kind", "topic", "clientId"] : ["kind", "question", "clientId"]);
    const clientId = boundedText(body.clientId, 128);
    if (body.kind === "record_query" && !["next_action", "last_measurement", "plan_status"].includes(body.topic)) fail("INVALID_INPUT");
    if (body.kind !== "record_query") boundedText(body.question, 2000);
    const prepared = this.store.transaction(state => {
      requirePatientCapability(state, actor, patientId, "owner");
      const patient = state.patients.find(p => p.id === patientId)!, language = patient.language, text = copy[language], at = this.clock();
      const monitoring = refreshMonitoring(state, patientId, at);
      journalAccess(state, actor, patientId, "assistant_query", "patient", patientId, "allowed");
      if (monitoring.priority === "red") return { result: response(state, patientId, at, "needs_clinician", patientMessage("red", language).text), clinicianId: null };
      if (body.kind !== "record_query") {
        const clinicianId = primary(state, actor, patientId);
        return { result: response(state, patientId, at, clinicianId ? "needs_clinician" : "unavailable", clinicianId ? text.recorded : text.noReferent), clinicianId };
      }
      if (body.topic === "last_measurement") {
        const evidence = buildAuthorizedEvidence(state, actor, patientId), measurement = evidence.measurements.sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt) || a.id.localeCompare(b.id))[0];
        if (!measurement) return { result: response(state, patientId, at, "record_answer", text.noMeasurement), clinicianId: null };
        const value = measurement.kind === "blood_pressure" ? `${measurement.systolic}/${measurement.diastolic}` : String(measurement.value);
        const label = language === "fr" ? "Dernière mesure enregistrée" : "آخر قياس مسجل";
        const result = response(state, patientId, at, "record_answer", `${label} : ${value} ${measurement.unit} (${measurement.measuredAt}).`);
        result.sources = evidence.sources.filter(s => s.kind === "measurement" && s.id === measurement.id);
        return { result, clinicianId: null };
      }
      const plan = state.carePlans.find(p => p.patientId === patientId);
      if (body.topic === "plan_status") return { result: response(state, patientId, at, "record_answer", !plan || plan.state === "awaiting_clinician" ? text.noPlan : plan.state === "active" ? text.activePlan : text.suspendedPlan), clinicianId: null };
      const pending = state.careActions.filter(a => a.patientId === patientId && a.state === "pending").sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
      const approved = pending.filter(a => isActionCurrentlyApproved(state, a, at));
      if (!approved.length) return { result: response(state, patientId, at, pending.length ? "needs_clinician" : "record_answer", pending.length ? text.needsReview : text.allDone), clinicianId: null };
      const action = approved[0], result = response(state, patientId, at, "approved_action", actionTemplateDefinition(action.action.templateId).patientText[language]);
      result.approvedActions = [projectCareAction(state, action, at)];
      const evidence = buildAuthorizedEvidence(state, actor, patientId);
      const sources = action.protocolId ? state.protocolApplications.find(a => a.actionId === action.id)?.sources ?? [] : state.careProposals.find(p => p.id === action.proposalId)?.sources ?? [];
      result.sources = sources.filter(source => evidence.sources.some(current => current.id === source.id && current.revision === source.revision && current.contentHash === source.contentHash)).map(s => structuredClone(s));
      return { result, clinicianId: null };
    });
    if (!prepared.clinicianId || body.kind === "record_query") return prepared.result;
    // Message insertion and idempotency are real durable operations, outside the read transaction.
    const message = new InterventionService(this.store, this.clock).sendMessage(actor, patientId, { text: body.question, kind: "clinical", clinicianId: prepared.clinicianId, clientId });
    return this.store.transaction(state => {
      requirePatientCapability(state, actor, patientId, "owner");
      if (primary(state, actor, patientId) !== message.clinicianId) fail("STALE_AUTHORITY", "Le médecin autorisé a changé.", 409);
      return { ...prepared.result, messageId: message.id, meta: meta(state, patientId, this.clock()) };
    });
  }
}
