"use client";

import { useId, useMemo, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import type { Alert } from "@/lib/client/api";
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
}

function resultText(shown: number, total: number): string {
  const patients = `patient${total > 1 ? "s" : ""}`;
  return shown === total ? `${total} ${patients}` : `${shown} sur ${total} ${patients} affichés`;
}

/** Search + quick filters over the queue; filtering removes rows, never re-orders them. */
export function PatientQueue({ rows, alerts, worker }: PatientQueueProps) {
  const headingId = useId();
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
      <div className={styles.queueHead}>
        <h2 id={headingId} className={styles.queueTitle}>
          File de priorité
        </h2>
        <WorkerStatusBadge health={worker} />
      </div>
      <QueueToolbar search={search} onSearchChange={setSearch} filter={filter} onFilterChange={setFilter} counts={counts} />
      <p className={styles.resultCount} role="status">
        {resultText(shown.length, rows.length)}
      </p>
      <div className={styles.tableCard}>
        {shown.length > 0 ? (
          <PatientTable rows={shown} newAlerts={newAlerts} />
        ) : (
          <EmptyState
            compact
            icon="search"
            title="Aucun patient ne correspond"
            description="Modifiez la recherche ou le filtre. Les patients restent dans la file : seul l’affichage est filtré."
            action={
              <Button variant="secondary" iconStart="x" onClick={reset}>
                Réinitialiser la recherche et les filtres
              </Button>
            }
          />
        )}
      </div>
      <p className={styles.footnote}>
        Estimation IA : signal d’attention expérimental, à revoir, calculé seulement à votre demande dans le dossier ; ce
        n’est pas une probabilité clinique et il ne change pas l’ordre. Ordre : priorité haute, suivi requis, travail en
        attente pour vous, puis les autres (inconnu avant vert).
      </p>
    </section>
  );
}
