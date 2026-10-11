"use client";

import { Badge, Button, Timestamp } from "@/components/ui";
import type { CareAction } from "@/contracts/monitoring";
import { UNTRANSLATED_REASON } from "@/lib/client/copy/reasons";
import { APPROVAL_LABEL, actionApprovalView } from "./action-approval";
import styles from "./Care.module.css";

/** Id of the proposals card (ProposalsPanel): re-approval of a once-validated action starts there. */
export const PROPOSALS_CARD_ID = "care-proposals";

function goToProposals() {
  const card = document.getElementById(PROPOSALS_CARD_ID);
  card?.scrollIntoView({ block: "start" });
  card?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
}

/** Live approval of one action: in force, to reconfirm (with reasons and the re-approval path), or not reported. */
export function ActionApprovalCell({ action, canManage }: { action: CareAction; canManage: boolean }) {
  const view = actionApprovalView(action);
  if (view.kind === "closed") return <span className={styles.muted}>—</span>;
  if (view.kind === "unknown") return <span className={styles.muted}>État d’approbation non fourni par le serveur</span>;
  if (view.kind === "current") {
    return (
      <span className={styles.tightStack}>
        <Badge tone="neutral" icon="check">
          {APPROVAL_LABEL.current}
        </Badge>
        <Timestamp iso={view.checkedAt} label="Vérifiée le" className={styles.muted} />
      </span>
    );
  }
  return (
    <span className={styles.tightStack}>
      <Badge tone="outline" icon="refresh">
        {APPROVAL_LABEL.reconfirm}
      </Badge>
      <ul className={styles.bullets}>
        {view.reasons.map((reason, index) =>
          reason.translated ? (
            <li key={index}>{reason.text}</li>
          ) : (
            <li key={index}>
              <bdi className={styles.mono} lang="en">
                {reason.text}
              </bdi>{" "}
              <span className={styles.muted}>({UNTRANSLATED_REASON.fr})</span>
            </li>
          ),
        )}
      </ul>
      <Timestamp iso={view.checkedAt} label="Vérifiée le" className={styles.muted} />
      {canManage ? (
        view.path === "protocol" ? (
          <a className={styles.link} href="#protocols">
            Réviser le protocole (onglet Protocoles)
          </a>
        ) : (
          <Button size="sm" variant="secondary" iconStart="refresh" onClick={goToProposals}>
            Revoir dans les propositions
          </Button>
        )
      ) : (
        <span className={styles.muted}>Reconfirmation réservée au médecin référent.</span>
      )}
    </span>
  );
}
