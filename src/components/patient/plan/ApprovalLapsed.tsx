"use client";

/**
 * The server's live check says a PENDING action's original approval no longer
 * holds (`action.approval.currentlyApproved === false`). Shown instead of any
 * "Validé…" line: wait for reconfirmation, what changed (reasons, translated
 * or marked untranslated) and when it was checked. A finished action never
 * gets this directive; its historical origin line is shown instead.
 */
import { Badge } from "@/components/ui";
import type { CareAction } from "@/contracts/monitoring";
import { CARE_COPY } from "@/lib/client/copy/care";
import { formatDateTime } from "@/lib/client/format";
import type { Language } from "@/lib/client/transport";
import { ReasonList } from "../monitoring/ReasonList";
import { actionApproval } from "./plan-view";
import patientStyles from "../patient.module.css";

export function ApprovalLapsed({ action, lang }: { action: CareAction; lang: Language }) {
  const copy = CARE_COPY[lang].plan;
  const approval = action.approval;
  // Only a pending action can be "waited on"; a finished one keeps its history instead.
  if (!approval || !actionApproval(action, lang).awaitReconfirmation) return null;
  return (
    <div className={patientStyles.stackSm}>
      <p>
        <Badge tone="outline" icon="clock">
          {copy.approvalLapsed}
        </Badge>
      </p>
      <p className={patientStyles.metaLine}>{copy.approvalLapsedNote}</p>
      <ReasonList reasons={approval.reasons} lang={lang} />
      <p className={patientStyles.metaLine}>{copy.approvalCheckedAt(formatDateTime(approval.checkedAt, lang))}</p>
    </div>
  );
}
