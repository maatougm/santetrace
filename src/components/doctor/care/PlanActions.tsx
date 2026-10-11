"use client";

import { Badge, DataTable, Notice, Timestamp, type BadgeTone, type IconName, type TableColumn } from "@/components/ui";
import type { CareAction } from "@/contracts/monitoring";
import { CARE_COPY, templateText } from "@/lib/client/copy/care";
import { useNow } from "../shared/hooks";
import { actionApprovalView } from "./action-approval";
import { ActionApprovalCell } from "./ActionApprovalCell";
import styles from "./Care.module.css";

const copy = CARE_COPY.fr;

const STATE_BADGE: Readonly<Record<CareAction["state"], { tone: BadgeTone; icon: IconName }>> = {
  pending: { tone: "outline", icon: "clock" },
  completed: { tone: "neutral", icon: "user" },
  not_completed: { tone: "neutral", icon: "user" },
  cancelled: { tone: "muted", icon: "x" },
};

function columns(now: number, canManage: boolean): TableColumn<CareAction>[] {
  return [
    {
      key: "action",
      header: "Action",
      render: (a) => (
        <span className={styles.tightStack}>
          <span className={styles.strongText}>{templateText(a.action.templateId, "fr")}</span>
          <bdi className={styles.mono}>{a.action.templateId}</bdi>
        </span>
      ),
    },
    {
      key: "origin",
      header: "Origine",
      render: (a) =>
        a.protocolId ? (
          <span>
            Protocole <bdi className={styles.mono}>{a.protocolId}</bdi> · version {a.originVersion}
          </span>
        ) : (
          <span>
            Validée une fois · proposition <bdi className={styles.mono}>{a.proposalId ?? "—"}</bdi> · révision {a.originVersion}
          </span>
        ),
    },
    {
      key: "due",
      header: "Échéance",
      render: (a) => (
        <span className={styles.tightStack}>
          <Timestamp iso={a.dueAt} />
          {a.state === "pending" && Date.parse(a.dueAt) < now ? (
            <Badge tone="outline" icon="clock">
              {copy.plan.overdue}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "state",
      header: "Auto-déclaration du patient",
      render: (a) => (
        <span className={styles.tightStack}>
          <Badge tone={STATE_BADGE[a.state].tone} icon={STATE_BADGE[a.state].icon}>
            {copy.actionState[a.state]}
          </Badge>
          {a.reportedAt ? <Timestamp iso={a.reportedAt} label="Le" className={styles.muted} /> : null}
        </span>
      ),
    },
    { key: "approval", header: "Approbation actuelle", render: (a) => <ActionApprovalCell action={a} canManage={canManage} /> },
  ];
}

/**
 * Actions with origin, due date, the patient's self-report and their live
 * approval (recomputed by the server). An action no longer approved is "à
 * reconfirmer", never shown as validated.
 */
export function PlanActions({ actions, canManage }: { actions: readonly CareAction[]; canManage: boolean }) {
  const now = useNow(60_000);
  if (actions.length === 0) return <p className={styles.mutedBlock}>Aucune action approuvée dans ce plan.</p>;
  const rows = [...actions].sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt));
  const toReconfirm = actions.filter((a) => actionApprovalView(a).kind === "reconfirm").length;
  return (
    <div className={styles.tightStack}>
      {toReconfirm > 0 ? (
        <Notice tone="neutral" icon="refresh" title={`${toReconfirm} action(s) à reconfirmer`}>
          Leur approbation n’est plus en vigueur (raisons ci-dessous) : elles ne valent pas consigne validée tant qu’elles ne sont pas
          revalidées.
        </Notice>
      ) : null}
      <DataTable
        columns={columns(now, canManage)}
        rows={rows}
        rowKey={(a) => a.id}
        caption="« Déclarée faite » est une déclaration du patient : ni une résolution clinique ni la clôture d’une alerte."
        scrollLabel="Actions du plan"
        dense
      />
    </div>
  );
}
