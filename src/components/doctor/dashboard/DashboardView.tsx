"use client";

import { useMemo } from "react";
import { Card, EmptyState, LinkButton, PageHeader, Skeleton } from "@/components/ui";
import { useActorSession } from "@/components/layout";
import { ApiErrorState } from "../shared/ApiErrorState";
import { useNow } from "../shared/hooks";
import { StaleNotice, SyncStatus } from "../shared/SyncStatus";
import { useGuardedPolling } from "../shared/use-guarded-polling";
import { createDashboardFetcher } from "./dashboard-data";
import { PatientQueue } from "./PatientQueue";
import { buildPatientQueue, referenceTimeMs, workerHealth } from "./queue";
import { WorkerStatusNotice } from "./WorkerStatus";
import styles from "./Dashboard.module.css";

const INVITATIONS_HREF = "/doctor/invitations";

function DashboardSkeleton() {
  return (
    <div className={styles.stack} aria-busy="true" aria-label="Chargement de la file de patients">
      <Skeleton height={44} width="min(100%, 28rem)" radius={4} />
      <Skeleton height={44} radius={4} />
      <Skeleton height={320} radius={8} />
    </div>
  );
}

function NoPatients() {
  return (
    <Card>
      <EmptyState
        icon="users"
        title="Aucun patient ne vous a donné accès"
        description="Les patients créent eux-mêmes leur dossier et choisissent leurs médecins. Quand un patient vous invite, acceptez son invitation pour voir son dossier ici."
        action={
          <LinkButton href={INVITATIONS_HREF} iconStart="inbox">
            Voir mes invitations
          </LinkButton>
        }
      />
    </Card>
  );
}

/** Clinician priority queue, polled every 2 s. Alerts are handled inside each record. */
export function DashboardView() {
  const { actor } = useActorSession();
  // A fresh fetcher per signed-in clinician (the poll key is per actor too).
  const fetcher = useMemo(() => createDashboardFetcher(), [actor.id]);
  const { data, error, status, isRefreshing, lastSuccessAt, refresh } = useGuardedPolling(
    `doctor-dashboard:${actor.id}`,
    fetcher,
    { intervalMs: 2_000 },
  );
  const now = useNow(5_000);
  const worker = data
    ? workerHealth(data.dashboard.workerHeartbeat, referenceTimeMs(data.dashboard.serverTime, data.receivedAt, now))
    : null;
  const workerRunning = worker?.state === "running";

  const rows = useMemo(
    () => (data ? buildPatientQueue(data.dashboard.patients, data.dashboard.alerts, workerRunning) : []),
    [data, workerRunning],
  );

  const header = (
    <PageHeader
      title="Patients"
      description="Patients fictifs qui vous ont donné accès, par priorité. Seuils de démonstration non validés cliniquement."
      actions={
        <div className={styles.headerActions}>
          <SyncStatus lastSuccessAt={lastSuccessAt} error={error} isRefreshing={isRefreshing} />
          <LinkButton href={INVITATIONS_HREF} iconStart="inbox" variant="secondary">
            Invitations reçues
          </LinkButton>
        </div>
      }
    />
  );

  if (status === "loading") {
    return (
      <div className={styles.page}>
        {header}
        <DashboardSkeleton />
      </div>
    );
  }

  if (!data || !worker) {
    return (
      <div className={styles.page}>
        {header}
        <ApiErrorState error={error} onRetry={() => void refresh()} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {header}
      <StaleNotice error={error} lastSuccessAt={lastSuccessAt} onRetry={() => void refresh()} isRefreshing={isRefreshing} />
      <WorkerStatusNotice health={worker} />
      {data.dashboard.patients.length === 0 ? (
        <NoPatients />
      ) : (
        <PatientQueue rows={rows} alerts={data.dashboard.alerts} worker={worker} />
      )}
    </div>
  );
}
