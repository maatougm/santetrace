/**
 * Clinician per-item proposal review (spec 006 story 2, FR-005/006/014).
 * Pure decisions: which controls a proposal allows, and the exact inputs sent
 * for "approve once", "reject" and "edit". Approving once never carries any
 * reuse field: reusable protocols are built separately (protocol-authorization).
 */
import type { CareProposal, ProposalDecision, ProposalEdit, ProposalStatus, RevisionGuard } from "@/contracts/monitoring";
import { isFullProposal } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { sameGuard } from "./guard";

export const REVIEW_LIMITS = { reasonMax: 500 } as const;

/** Closed action registry the clinician may pick from (never the "unknown" fallback label). */
export const EDITABLE_TEMPLATE_IDS: readonly string[] = Object.keys(CARE_COPY.fr.template).filter((id) => id !== "unknown");

export type BuildResult<T> = { ok: true; input: T } | { ok: false; error: string };

/** Why an open draft must be re-examined before a decision. */
export type RecheckReason = "conflict" | "inputs" | "unknown" | "changed";

export interface ReviewGate {
  canApprove: boolean;
  canReject: boolean;
  /** Edit re-binds the draft to the current record (also the way to re-examine a stale draft). */
  canEdit: boolean;
  mustRecheck: boolean;
  decided: boolean;
  recheck: RecheckReason | null;
}

export interface ReviewContext {
  /** Current server guard (guard.ts); null when not sent: no decision is possible. */
  currentGuard: RevisionGuard | null;
  /** The server answered 409 for this revision. */
  conflicted?: boolean;
}

/**
 * Open states. The server creates and edits drafts as `needs_review` (awaiting
 * a decision), so it stays approvable. A draft is stale when its guard differs
 * from the current record guard: the server would refuse approve and reject,
 * and only an edit (re-bound to the current guard) re-examines it.
 */
const OPEN_STATES: ReadonlySet<CareProposal["state"]> = new Set(["pending", "needs_review", "needs_inputs"]);

function recheckReason(proposal: CareProposal, { currentGuard, conflicted = false }: ReviewContext): RecheckReason | null {
  if (conflicted) return "conflict";
  if (proposal.state === "needs_inputs") return "inputs";
  if (!currentGuard) return "unknown";
  return sameGuard(proposal.guard, currentGuard) ? null : "changed";
}

export function proposalReviewGate(proposal: CareProposal, context: ReviewContext & { canManageCare: boolean }): ReviewGate {
  const open = OPEN_STATES.has(proposal.state);
  const recheck = open ? recheckReason(proposal, context) : null;
  const manage = context.canManageCare && open;
  const contextKnown = context.currentGuard !== null;
  const current = contextKnown && recheck !== "changed";
  return {
    canApprove: manage && recheck === null,
    canReject: manage && current,
    canEdit: manage && contextKnown,
    mustRecheck: recheck !== null,
    decided: !open,
    recheck,
  };
}

function checkReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return "Indiquez un motif.";
  if (trimmed.length > REVIEW_LIMITS.reasonMax) return `${REVIEW_LIMITS.reasonMax} caractères au maximum.`;
  return null;
}

/** Approve once or reject one item: the reviewed revision and the current server guard. */
export function buildDecisionInput(
  proposal: CareProposal,
  decision: ProposalDecision["decision"],
  reason: string,
  clientId: string,
  context: ReviewContext,
): BuildResult<ProposalDecision> {
  const gate = proposalReviewGate(proposal, { ...context, canManageCare: true });
  if (!context.currentGuard) return { ok: false, error: "Contexte actuel du dossier inconnu : actualisez avant de décider." };
  if (decision === "approve" && !gate.canApprove) {
    return { ok: false, error: "À réexaminer avant validation : informations manquantes ou dossier modifié." };
  }
  if (decision === "reject" && !gate.canReject) {
    return { ok: false, error: gate.decided ? "Cette proposition est déjà décidée." : "Dossier modifié : réexaminez d’abord la proposition." };
  }
  const reasonError = checkReason(reason);
  if (reasonError) return { ok: false, error: reasonError };
  return {
    ok: true,
    input: { decision, expectedRevision: proposal.revision, expectedGuard: context.currentGuard, reason: reason.trim(), clientId },
  };
}

/**
 * Edit creates a new revision bound to the current record; a separate decision
 * is still required. The same action is accepted only to re-bind a stale draft.
 */
export function buildEditInput(proposal: CareProposal, templateId: string, reason: string, clientId: string, context: ReviewContext): BuildResult<ProposalEdit> {
  if (!OPEN_STATES.has(proposal.state)) return { ok: false, error: "Cette proposition est déjà décidée." };
  if (!context.currentGuard) return { ok: false, error: "Contexte actuel du dossier inconnu : actualisez avant de modifier." };
  if (!EDITABLE_TEMPLATE_IDS.includes(templateId)) return { ok: false, error: "Choisissez une action du registre." };
  const stale = !sameGuard(proposal.guard, context.currentGuard);
  if (templateId === proposal.action.templateId && !stale) return { ok: false, error: "Choisissez une action différente de l’actuelle." };
  const reasonError = checkReason(reason);
  if (reasonError) return { ok: false, error: reasonError };
  return {
    ok: true,
    input: {
      action: { templateId, templateVersion: 1, parameters: {} },
      sources: proposal.sources,
      expectedRevision: proposal.revision,
      expectedGuard: context.currentGuard,
      reason: reason.trim(),
      clientId,
    },
  };
}

export interface ProposalGroups {
  home_measurement: CareProposal[];
  lab_exam: CareProposal[];
  information: CareProposal[];
  /** Status-only projections (no care authority): kind and state only. */
  statusOnly: ProposalStatus[];
}

const openFirst = (a: { state: CareProposal["state"] }, b: { state: CareProposal["state"] }) =>
  Number(!OPEN_STATES.has(a.state)) - Number(!OPEN_STATES.has(b.state));

/** Home measurements, lab exams and information requests are reviewed separately; open items first. */
export function groupProposals(proposals: readonly (CareProposal | ProposalStatus)[]): ProposalGroups {
  const full = proposals.filter(isFullProposal).sort(openFirst);
  return {
    home_measurement: full.filter((p) => p.kind === "home_measurement"),
    lab_exam: full.filter((p) => p.kind === "lab_exam"),
    information: full.filter((p) => p.kind === "information"),
    statusOnly: proposals.filter((p) => !isFullProposal(p)).sort(openFirst),
  };
}
