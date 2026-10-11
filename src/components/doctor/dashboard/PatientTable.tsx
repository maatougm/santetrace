"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { Icon, StatusBadge, VisuallyHidden } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { dashboardAiCaseScore } from "@/lib/client/doctor-api";
import { aiCaseScoreEligible, queueScoreView } from "../record/ai-case-score-view";
import { patientHref } from "../shared/routes";
import { DASHBOARD_COPY, newAlertsText, pendingWorkText, urgencyLabel } from "./dashboard-copy";
import { priorityDisplay, type QueueRow } from "./queue";
import { newAlertsIndicator } from "./row-indicators";
import { ScoreCell } from "./ScoreCell";
import styles from "./Dashboard.module.css";

/** Elements that handle their own click inside a row. */
const NESTED_CONTROL = "a, button, input, select, textarea, label, summary";

interface PatientTableProps {
  /** Rows from buildPatientQueue, possibly filtered, never re-sorted. */
  rows: readonly QueueRow[];
  /** Unseen alerts per patient (see newAlertCounts). */
  newAlerts: ReadonlyMap<string, number>;
  lang?: Language;
}

interface IndicatorProps {
  row: QueueRow;
  newAlerts: ReadonlyMap<string, number>;
  lang: Language;
}

/** Only true, text-labelled facts: unseen alerts (where shared) and work waiting on you. */
function PatientIndicators({ row, newAlerts, lang }: IndicatorProps) {
  const fresh = newAlertsIndicator(row, newAlerts);
  const freshCount = fresh.state === "count" ? fresh.count : 0;
  if (freshCount === 0 && !row.pendingWork) return null;
  const pending = row.pendingWork ? pendingWorkText(row.patient.queue, lang) : null;
  return (
    <span className={styles.indicators}>
      {freshCount > 0 ? (
        <span className={styles.indicator}>
          <Icon name="bell" size={14} />
          {newAlertsText(freshCount, lang)}
        </span>
      ) : null}
      {row.pendingWork ? (
        <span className={styles.indicator} title={pending ?? undefined}>
          <Icon name="clock" size={14} />
          {DASHBOARD_COPY[lang].pendingBadge}
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
 * One queue: Patient · Urgence · Estimation IA, in buildPatientQueue order.
 * The name is a real link (keyboard and screen readers); the whole row also
 * opens the record on click. Below ~520px each row becomes a two-line card
 * (name then urgency, estimate at the inline end) with explicit table roles kept.
 */
export function PatientTable({ rows, newAlerts, lang = "fr" }: PatientTableProps) {
  const router = useRouter();
  const copy = DASHBOARD_COPY[lang];
  return (
    <table className={styles.table} role="table">
      <caption>
        <VisuallyHidden>{copy.caption}</VisuallyHidden>
      </caption>
      <thead className={styles.thead} role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader" className={`${styles.th} ${styles.colPatient}`}>
            {copy.columnPatient}
          </th>
          <th scope="col" role="columnheader" className={`${styles.th} ${styles.colUrgency}`}>
            {copy.columnUrgency}
          </th>
          <th scope="col" role="columnheader" className={`${styles.th} ${styles.colScore}`}>
            {copy.columnEstimate}
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => {
          const display = priorityDisplay(row);
          const href = patientHref(row.patient.id);
          const score = queueScoreView(dashboardAiCaseScore(row.patient), aiCaseScoreEligible(row.patient.access));
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
                  <bdi>{row.patient.displayName}</bdi>
                </Link>
                <PatientIndicators row={row} newAlerts={newAlerts} lang={lang} />
              </td>
              <td role="cell" className={`${styles.td} ${styles.urgencyCell}`}>
                <StatusBadge status={display.status} label={urgencyLabel(display, lang)} size="sm" />
              </td>
              <td role="cell" className={`${styles.td} ${styles.scoreCell}`} data-score={score.kind}>
                <span className={styles.cellLabel} aria-hidden="true">
                  {copy.columnEstimate}
                </span>
                <ScoreCell view={score} lang={lang} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
