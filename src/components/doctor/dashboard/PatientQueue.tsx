"use client";

import { useId, useMemo, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import type { Alert, Language } from "@/lib/client/api";
import { DASHBOARD_COPY, resultText } from "./dashboard-copy";
import { PatientTable } from "./PatientTable";
import { QueueToolbar } from "./QueueToolbar";
import type { QueueRow, WorkerHealth } from "./queue";
import { filterQueue, queueFilterCounts, type QueueFilter } from "./queue-filter";
import { newAlertCounts } from "./row-indicators";
import { WorkerStatusBadge } from "./WorkerStatus";
import styles from "./Dashboard.module.css";

interface PatientQueueProps {
  /** Ordered by buildPatientQueue. */
  rows: readonly QueueRow[];
  /** Alerts visible to this clinician (for the "new alerts" indicator). */
  alerts: readonly Alert[];
  worker: WorkerHealth;
  lang?: Language;
}

/** Search + quick filters over the queue; filtering removes rows, never re-orders them. */
export function PatientQueue({ rows, alerts, worker, lang = "fr" }: PatientQueueProps) {
  const headingId = useId();
  const copy = DASHBOARD_COPY[lang];
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("all");
  const shown = useMemo(() => filterQueue(rows, { filter, search }), [rows, filter, search]);
  const counts = useMemo(() => queueFilterCounts(rows, search), [rows, search]);
  const newAlerts = useMemo(() => newAlertCounts(alerts), [alerts]);

  const reset = () => {
    setSearch("");
    setFilter("all");
  };

  return (
    <section className={styles.queue} aria-labelledby={headingId}>
      {/* The page h1 already reads "Patients": the section keeps its heading for assistive tech only. */}
      <h2 id={headingId} className="visually-hidden">
        {copy.queueHeading}
      </h2>
      <QueueToolbar
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        counts={counts}
        lang={lang}
      />
      <div className={styles.tableMeta}>
        <p className={styles.resultCount} role="status">
          {resultText(shown.length, rows.length, lang)}
        </p>
        <p className={styles.caveat}>
          <strong className={styles.caveatLead}>{copy.caveatLead}</strong> {copy.caveat}
        </p>
      </div>
      <div className={styles.tableCard}>
        {shown.length > 0 ? (
          <PatientTable rows={shown} newAlerts={newAlerts} lang={lang} />
        ) : (
          <EmptyState
            compact
            icon="search"
            title={copy.noMatchTitle}
            description={copy.noMatchBody}
            action={
              <Button variant="secondary" iconStart="x" onClick={reset}>
                {copy.resetFilters}
              </Button>
            }
          />
        )}
      </div>
      <div className={styles.queueFoot}>
        <details className={styles.ordering}>
          <summary className={styles.orderingSummary}>{copy.orderingSummary}</summary>
          <p className={styles.footnote}>{copy.orderingBody}</p>
        </details>
        <WorkerStatusBadge health={worker} lang={lang} />
      </div>
    </section>
  );
}
