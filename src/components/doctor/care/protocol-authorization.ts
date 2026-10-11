/**
 * Bounded reusable authorization (spec 006 story 4, FR-012..014). Builds the
 * exact ProtocolAuthorization / ProtocolReviewInput from the clinician's form.
 *
 * - Source: an APPROVED home_measurement proposal of this patient only (first
 *   demo is home follow-up; lab exams are never reused), with an active plan.
 * - expectedGuard is the CURRENT record guard (the server compares it exactly);
 *   an approval made before a context or authority change needs a new review.
 * - Nothing is pre-filled: validity, minimum interval and count are explicit
 *   clinician inputs, checked against PROTOCOL_FORM_LIMITS (input sanity, not
 *   clinical defaults). Predicates stay in the closed contract union.
 * The server alone decides eligibility; this module never scores similarity.
 */
import type {
  CarePlan,
  CareProposal,
  MedicalFact,
  ProposalStatus,
  ProtocolAuthorization,
  ProtocolReviewInput,
  ProtocolStateInput,
  ReusableProtocol,
  RevisionGuard,
} from "@/contracts/monitoring";
import { PROTOCOL_FORM_LIMITS } from "@/lib/client/assist-api";
import { isFullProposal } from "@/lib/client/care-api";
import { fromDateTimeLocalValue } from "@/lib/client/format";
import {
  checkPredicateList,
  missingRequiredPredicate,
  parseBoundedInt,
  predicateToDraft,
  type PredicateDraft,
  type PredicateListKey,
} from "./protocol-predicates";
import type { BuildResult } from "./proposal-review";

export {
  CHECKABLE_POLARITIES,
  PREDICATE_KINDS,
  PREDICATE_LIMITS,
  emptyPredicate,
  type PredicateDraft,
  type PredicateKind,
  type PredicateListKey,
} from "./protocol-predicates";

const HOUR_SECONDS = 3_600;
const DAY_MS = 24 * HOUR_SECONDS * 1_000;

export interface ProtocolFormDraft {
  sourceProposalId: string;
  templateId: string;
  predicates: PredicateDraft[];
  exclusions: PredicateDraft[];
  stopCriteria: PredicateDraft[];
  /** datetime-local value (device time). */
  validUntil: string;
  minIntervalHours: string;
  maxApplications: string;
}

export type ProtocolFormField = "source" | "template" | PredicateListKey | "validUntil" | "minInterval" | "maxApplications" | "reason";
export type ProtocolFormErrors = Partial<Record<ProtocolFormField, string>>;
export type ProtocolBuildResult<T> = { ok: true; input: T } | { ok: false; errors: ProtocolFormErrors };

export interface ProtocolBuildContext {
  patientId: string;
  /** The proposal named by draft.sourceProposalId, as currently known (undefined: not found). */
  proposal: CareProposal | ProposalStatus | undefined;
  facts: readonly MedicalFact[];
  plan: CarePlan | null;
  /** Current server guard (guard.ts resolveCurrentGuard); null when not known. */
  currentGuard: RevisionGuard | null;
  /** Requirement ids bound in the active plan (record.requirementIds); null: not provided, the server validates. */
  requirementIds: readonly string[] | null;
  now: Date;
  clientId: string;
}

/** A blank form: every bound must be typed by the clinician. */
export function emptyProtocolDraft(sourceProposalId: string, templateId = ""): ProtocolFormDraft {
  return { sourceProposalId, templateId, predicates: [], exclusions: [], stopCriteria: [], validUntil: "", minIntervalHours: "", maxApplications: "" };
}

export function eligibleSourceProposals(proposals: readonly (CareProposal | ProposalStatus)[], patientId: string): CareProposal[] {
  return proposals.filter(isFullProposal).filter((p) => sourceProblem(p, patientId) === null);
}

function sourceProblem(proposal: CareProposal | ProposalStatus | undefined, patientId: string): string | null {
  if (!proposal) return "Choisissez une proposition déjà validée.";
  if (!isFullProposal(proposal)) return "Le détail de cette proposition n’est pas disponible pour ce compte.";
  if (proposal.patientId !== patientId) return "Cette proposition appartient à un autre patient.";
  if (proposal.kind === "lab_exam") return "Un examen ne peut pas être réutilisé : seule une mesure à domicile validée peut l’être.";
  if (proposal.kind !== "home_measurement") return "Seule une mesure à domicile validée peut être réutilisée.";
  if (proposal.state !== "approved") return "La proposition doit d’abord être validée une fois (« Valider une fois »).";
  return null;
}

function contextProblem(ctx: ProtocolBuildContext, approved: CareProposal | null, revision: boolean): string | null {
  if (!ctx.plan || ctx.plan.state !== "active") return "Plan actif requis : activez le plan de suivi avant d’autoriser une réutilisation.";
  if (!ctx.currentGuard) return "Contexte actuel du dossier inconnu (aucune évaluation à jour) : actualisez avant d’autoriser.";
  const moved =
    approved && (approved.guard.contextRevision !== ctx.currentGuard.contextRevision || approved.guard.authorityRevision !== ctx.currentGuard.authorityRevision);
  if (!revision && moved) return "Le dossier ou les accès ont changé depuis cette validation : une nouvelle revue explicite est nécessaire.";
  return null;
}

function checkValidity(raw: string, now: Date): { value: string | null; error: string | null } {
  if (!raw.trim()) return { value: null, error: "Indiquez la date de fin de validité." };
  const iso = fromDateTimeLocalValue(raw);
  if (!iso) return { value: null, error: "Date et heure invalides." };
  const at = Date.parse(iso);
  if (at <= now.getTime()) return { value: null, error: "La fin de validité doit être dans le futur." };
  if (at > now.getTime() + PROTOCOL_FORM_LIMITS.validityDaysMax * DAY_MS) {
    return { value: null, error: `${PROTOCOL_FORM_LIMITS.validityDaysMax} jours au maximum.` };
  }
  return { value: iso, error: null };
}

function buildAuthorization(draft: ProtocolFormDraft, ctx: ProtocolBuildContext, revision: boolean): ProtocolBuildResult<ProtocolAuthorization> {
  const errors: ProtocolFormErrors = {};
  const { proposal } = ctx;
  const source = sourceProblem(proposal, ctx.patientId) ?? (proposal?.id !== draft.sourceProposalId ? "Proposition source incohérente." : null);
  const approved = !source && proposal && isFullProposal(proposal) ? proposal : null;
  const context = contextProblem(ctx, approved, revision);
  if (source ?? context) errors.source = source ?? context ?? undefined;
  if (approved && draft.templateId !== approved.action.templateId) {
    errors.template = "L’action réutilisée doit être exactement celle de la proposition validée.";
  }

  const scope = { patientId: ctx.patientId, facts: ctx.facts, plan: ctx.plan, requirementIds: ctx.requirementIds };
  const predicates = checkPredicateList(draft.predicates, scope);
  const exclusions = checkPredicateList(draft.exclusions, scope);
  const stopCriteria = checkPredicateList(draft.stopCriteria, scope);
  const missing = predicates.error ? null : missingRequiredPredicate(predicates.value);
  if (predicates.error ?? missing) errors.predicates = predicates.error ?? missing ?? undefined;
  if (exclusions.error) errors.exclusions = exclusions.error;
  if (stopCriteria.error) errors.stopCriteria = stopCriteria.error;

  const validity = checkValidity(draft.validUntil, ctx.now);
  if (validity.error) errors.validUntil = validity.error;
  const intervalHours = parseBoundedInt(draft.minIntervalHours, PROTOCOL_FORM_LIMITS.minIntervalHoursMin, PROTOCOL_FORM_LIMITS.minIntervalHoursMax);
  if (intervalHours === null) {
    errors.minInterval = `Entre ${PROTOCOL_FORM_LIMITS.minIntervalHoursMin} et ${PROTOCOL_FORM_LIMITS.minIntervalHoursMax} heures (nombre entier).`;
  }
  const maxApplications = parseBoundedInt(draft.maxApplications, PROTOCOL_FORM_LIMITS.maxApplicationsMin, PROTOCOL_FORM_LIMITS.maxApplicationsMax);
  if (maxApplications === null) {
    errors.maxApplications = `Entre ${PROTOCOL_FORM_LIMITS.maxApplicationsMin} et ${PROTOCOL_FORM_LIMITS.maxApplicationsMax} applications (nombre entier).`;
  }

  const guard = ctx.currentGuard;
  if (!approved || !guard || Object.keys(errors).length > 0 || !validity.value || intervalHours === null || maxApplications === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    input: {
      sourceProposalId: approved.id,
      actions: [approved.action],
      predicates: predicates.value,
      exclusions: exclusions.value,
      stopCriteria: stopCriteria.value,
      validUntil: validity.value,
      minIntervalSeconds: intervalHours * HOUR_SECONDS,
      maxApplications,
      expectedGuard: guard,
      clientId: ctx.clientId,
    },
  };
}

/** Explicit bounded authorization from an approved home measurement. */
export function buildProtocolAuthorization(draft: ProtocolFormDraft, ctx: ProtocolBuildContext): ProtocolBuildResult<ProtocolAuthorization> {
  return buildAuthorization(draft, ctx, false);
}

function reasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return "Indiquez un motif.";
  return trimmed.length > PROTOCOL_FORM_LIMITS.reasonMax ? `${PROTOCOL_FORM_LIMITS.reasonMax} caractères au maximum.` : null;
}

/**
 * Explicit review: a full new bounded authorization bound to the current
 * context, same source proposal and action, creating an immutable new version.
 */
export function buildProtocolRevision(
  protocol: ReusableProtocol,
  draft: ProtocolFormDraft,
  ctx: ProtocolBuildContext,
  reason: string,
): ProtocolBuildResult<ProtocolReviewInput> {
  const built = buildAuthorization(draft, ctx, true);
  const errors: ProtocolFormErrors = built.ok ? {} : { ...built.errors };
  if (protocol.state === "revoked") errors.source = "Un protocole retiré ne peut pas être révisé : créez une nouvelle autorisation.";
  else if (draft.sourceProposalId !== protocol.sourceProposalId) errors.source = "Une révision garde la même proposition source et la même action.";
  const problem = reasonError(reason);
  if (problem) errors.reason = problem;
  if (!built.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { ...built.input, expectedRevision: protocol.revision, reason: reason.trim() } };
}

export function buildProtocolStateInput(
  protocol: ReusableProtocol,
  action: ProtocolStateInput["action"],
  reason: string,
  clientId: string,
): BuildResult<ProtocolStateInput> {
  const allowed = action === "suspend" ? protocol.state === "active" : protocol.state !== "revoked";
  if (!allowed) return { ok: false, error: "Cet état ne permet plus cette action." };
  const problem = reasonError(reason);
  if (problem) return { ok: false, error: problem };
  return { ok: true, input: { action, expectedRevision: protocol.revision, reason: reason.trim(), clientId } };
}

/**
 * Revision form: conditions start from the clinician's previous version for
 * review; validity, interval and count are left blank and must be re-entered.
 */
export function draftFromProtocol(protocol: ReusableProtocol): ProtocolFormDraft {
  return {
    ...emptyProtocolDraft(protocol.sourceProposalId, protocol.actions[0]?.templateId ?? ""),
    predicates: protocol.predicates.map(predicateToDraft),
    exclusions: protocol.exclusions.map(predicateToDraft),
    stopCriteria: protocol.stopCriteria.map(predicateToDraft),
  };
}
