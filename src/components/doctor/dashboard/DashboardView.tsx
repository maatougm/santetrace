"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { Card, EmptyState, Icon, LinkButton, Skeleton } from "@/components/ui";
import { useActorSession, useClinicianLanguage } from "@/components/layout";
import type { Language } from "@/lib/client/api";
import { ApiErrorState } from "../shared/ApiErrorState";
import { useNow } from "../shared/hooks";
import { StaleNotice, SyncStatus } from "../shared/SyncStatus";
import { useGuardedPolling } from "../shared/use-guarded-polling";
import { DASHBOARD_COPY } from "./dashboard-copy";
import { createDashboardFetcher } from "./dashboard-data";
import { PatientQueue } from "./PatientQueue";
import { buildPatientQueue, referenceTimeMs, workerHealth } from "./queue";
import { WorkerStatusNotice } from "./WorkerStatus";
import styles from "./Dashboard.module.css";

const INVITATIONS_HREF = "/doctor/invitations";

function DashboardSkeleton({ lang }: { lang: Language }) {
  return (
    <div className={styles.stack} aria-busy="true" aria-label={DASHBOARD_COPY[lang].loadingQueue}>
      <Skeleton height={44} width="min(100%, 28rem)" radius={4} />
      <Skeleton height={44} radius={4} />
      <Skeleton height={320} radius={8} />
    </div>
  );
}

function NoPatients({ lang }: { lang: Language }) {
  const copy = DASHBOARD_COPY[lang];
  return (
    <Card>
      <EmptyState
        icon="users"
        title={copy.noPatientsTitle}
        description={copy.noPatientsBody}
        action={
          <LinkButton href={INVITATIONS_HREF} iconStart="inbox">
            {copy.noPatientsAction}
          </LinkButton>
        }
      />
    </Card>
  );
}

interface DashboardHeaderProps {
  lang: Language;
  /** Accepted patients; null until the first successful load (never an invented 0). */
  count: number | null;
  freshness: ReactNode;
}

/** Compact page header: Patients + count, one freshness chip, a quiet invitations link. No KPIs. */
function DashboardHeader({ lang, count, freshness }: DashboardHeaderProps) {
  const copy = DASHBOARD_COPY[lang];
  return (
    <header className={styles.pageHead}>
      <h1 className={styles.pageTitle}>
        {copy.title}
        {count !== null ? (
          <>
            {" "}
            <span className={styles.titleCount}>{count}</span>
          </>
        ) : null}
      </h1>
      <div className={styles.pageFresh}>{freshness}</div>
      <Link href={INVITATIONS_HREF} className={styles.quietLink}>
        <Icon name="inbox" size={18} />
        <span>{copy.invitationsLink}</span>
      </Link>
    </header>
  );
}

/** Clinician priority queue, polled every 2 s. Alerts are handled inside each record. */
export function DashboardView() {
  const { actor } = useActorSession();
  const { lang } = useClinicianLanguage();
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
    <DashboardHeader
      lang={lang}
      count={data ? data.dashboard.patients.length : null}
      freshness={<SyncStatus lastSuccessAt={lastSuccessAt} error={error} isRefreshing={isRefreshing} lang={lang} />}
    />
  );

  if (status === "loading") {
    return (
      <div className={styles.page}>
        {header}
        <DashboardSkeleton lang={lang} />
      </div>
    );
  }

  if (!data || !worker) {
    return (
      <div className={styles.page}>
        {header}
        <ApiErrorState error={error} onRetry={() => void refresh()} lang={lang} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {header}
      <StaleNotice error={error} lastSuccessAt={lastSuccessAt} onRetry={() => void refresh()} isRefreshing={isRefreshing} lang={lang} />
      <WorkerStatusNotice health={worker} lang={lang} />
      {data.dashboard.patients.length === 0 ? (
        <NoPatients lang={lang} />
      ) : (
        <PatientQueue rows={rows} alerts={data.dashboard.alerts} worker={worker} lang={lang} />
      )}
    </div>
  );
}
