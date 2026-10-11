"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { Icon, StatusBadge, VisuallyHidden } from "@/components/ui";
import { dashboardAiCaseScore } from "@/lib/client/doctor-api";
import { aiCaseScoreEligible, queueScoreView } from "../record/ai-case-score-view";
import { patientHref } from "../shared/routes";
import { priorityDisplay, type QueueRow } from "./queue";
import { newAlertsIndicator, pendingWorkSummary } from "./row-indicators";
import { ScoreCell } from "./ScoreCell";
import styles from "./Dashboard.module.css";

const CAPTION =
  "File priorisée : priorité rouge affichée (alerte rouge ouverte la plus ancienne d’abord), puis priorité orange affichée (de même), puis autre travail en attente pour vous (le plus ancien d’abord), puis les autres patients par priorité (inconnu avant vert). Cet ordre ne change jamais la priorité affichée, et la recherche ou les filtres retirent des lignes sans le modifier. « Inconnu » signale une couverture incomplète ou des données manquantes : ce n’est jamais un vert rassurant ; « non partagé » n’est pas zéro. Ouvrez le dossier pour les raisons, la dernière mesure et votre accès.";

/** Elements that handle their own click inside a row. */
const NESTED_CONTROL = "a, button, input, select, textarea, label, summary";

interface PatientTableProps {
  /** Rows from buildPatientQueue, possibly filtered, never re-sorted. */
  rows: readonly QueueRow[];
  /** Unseen alerts per patient (see newAlertCounts). */
  newAlerts: ReadonlyMap<string, number>;
}

/** Only true, text-labelled facts: unseen alerts (where shared) and work waiting on you. */
function PatientIndicators({ row, newAlerts }: { row: QueueRow; newAlerts: ReadonlyMap<string, number> }) {
  const fresh = newAlertsIndicator(row, newAlerts);
  const freshCount = fresh.state === "count" ? fresh.count : 0;
  const pending = row.pendingWork ? pendingWorkSummary(row.patient.queue) : null;
  if (freshCount === 0 && !row.pendingWork) return null;
  return (
    <span className={styles.indicators}>
      {freshCount > 0 ? (
        <span className={styles.indicator}>
          <Icon name="bell" size={14} />
          {freshCount} {freshCount > 1 ? "nouvelles alertes" : "nouvelle alerte"}
        </span>
      ) : null}
      {row.pendingWork ? (
        <span className={styles.indicator} title={pending ?? undefined}>
          <Icon name="clock" size={14} />
          En attente
          {pending ? <VisuallyHidden> : {pending}</VisuallyHidden> : null}
        </span>
      ) : null}
    </span>
  );
}

/** Row click opens the record, unless a nested control, a modified click or a text selection is involved. */
function shouldOpenFromRow(event: MouseEvent<HTMLTableRowElement>): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (event.target instanceof Element && event.target.closest(NESTED_CONTROL)) return false;
  return !window.getSelection()?.toString();
}

/**
 * Compact priority queue: Patient, Urgence, Score. The name is a real link
 * (keyboard and screen readers); the whole row also opens the record on click.
 * Below ~520px the rows stack (CSS), with explicit table roles kept.
 */
export function PatientTable({ rows, newAlerts }: PatientTableProps) {
  const router = useRouter();
  return (
    <table className={styles.table} role="table">
      <caption>
        <VisuallyHidden>{CAPTION}</VisuallyHidden>
      </caption>
      <thead className={styles.thead} role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader" className={styles.th}>
            Patient
          </th>
          <th scope="col" role="columnheader" className={`${styles.th} ${styles.colUrgency}`}>
            Urgence
          </th>
          <th scope="col" role="columnheader" className={`${styles.th} ${styles.colScore}`}>
            Estimation IA
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => {
          const display = priorityDisplay(row);
          const href = patientHref(row.patient.id);
          return (
            <tr
              key={row.patient.id}
              role="row"
              className={styles.row}
              data-priority={display.status}
              onClick={(event) => {
                if (shouldOpenFromRow(event)) router.push(href);
              }}
            >
              <td role="cell" className={`${styles.td} ${styles.patientCell}`}>
                <Link href={href} className={styles.patientLink}>
                  {row.patient.displayName}
                </Link>
                <PatientIndicators row={row} newAlerts={newAlerts} />
              </td>
              <td role="cell" className={`${styles.td} ${styles.urgencyCell}`}>
                <StatusBadge status={display.status} label={display.label} size="sm" />
              </td>
              <td role="cell" className={`${styles.td} ${styles.scoreCell}`}>
                <span className={styles.cellLabel} aria-hidden="true">
                  Estimation IA
                </span>
                <ScoreCell view={queueScoreView(dashboardAiCaseScore(row.patient), aiCaseScoreEligible(row.patient.access))} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
