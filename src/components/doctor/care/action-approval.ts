/**
 * Live approval of an approved action (CareAction.approval, recomputed by the
 * server at read time). A pending action whose approval is no longer current
 * must be reconfirmed; it is never shown as validated. Without the metadata
 * the UI makes no approval claim.
 */
import type { CareAction } from "@/contracts/monitoring";
import { reasonText } from "@/lib/client/copy/reasons";
import { protocolReasonText } from "./protocol-text";

export const APPROVAL_LABEL = {
  current: "Approbation en vigueur",
  reconfirm: "À reconfirmer : l’approbation n’est plus en vigueur",
} as const;

export interface ReasonLabel {
  text: string;
  translated: boolean;
}

export type ApprovalView =
  | { kind: "current"; checkedAt: string }
  /** `path`: where the clinician re-approves (a fresh proposal, or a protocol revision). */
  | { kind: "reconfirm"; reasons: ReasonLabel[]; checkedAt: string; path: "proposal" | "protocol" }
  | { kind: "unknown" }
  /** Self-reported or cancelled: nothing left to approve. */
  | { kind: "closed" };

/** Server codes first, then the evaluator sentence table; anything else stays as recorded. */
export function approvalReasonText(reason: string): ReasonLabel {
  const code = protocolReasonText(reason);
  return code.translated ? code : reasonText(reason, "fr");
}

export function actionApprovalView(action: CareAction): ApprovalView {
  if (action.state !== "pending") return { kind: "closed" };
  const approval = action.approval;
  if (!approval) return { kind: "unknown" };
  if (approval.currentlyApproved) return { kind: "current", checkedAt: approval.checkedAt };
  return {
    kind: "reconfirm",
    reasons: approval.reasons.map(approvalReasonText),
    checkedAt: approval.checkedAt,
    path: action.protocolId ? "protocol" : "proposal",
  };
}
