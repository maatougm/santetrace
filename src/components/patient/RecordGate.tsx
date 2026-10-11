"use client";

/**
 * Renders children only with real patient data (server response or a dated
 * device copy). Otherwise shows an explicit loading, offline-without-copy,
 * session-expired, consent-revoked or server error state.
 */
import type { ReactNode } from "react";
import { EmptyState, ErrorState, LinkButton, Skeleton } from "@/components/ui";
import { describeApiError, type PatientRecord } from "@/lib/client/api";
import { usePatientRuntime } from "./PatientRuntime";
import styles from "./patient.module.css";

export function LoadingBlock({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div className={styles.loadingBlock} aria-busy="true" role="status">
      <span className={styles.srOnly}>{label}</span>
      <Skeleton height={20} width="45%" />
      <Skeleton lines={lines} />
    </div>
  );
}

export function RecordGate({ children }: { children: (record: PatientRecord) => ReactNode }) {
  const { data, t, lang, scope } = usePatientRuntime();

  if (data.record) return <>{children(data.record)}</>;
  if (!scope || data.status === "loading" || data.status === "idle") {
    return <LoadingBlock label={t.common.loading} />;
  }

  const error = data.error;
  if (error?.isOffline) {
    return <EmptyState icon="wifi-off" title={t.connection.offline} description={t.home.noDataOffline} />;
  }
  if (error?.isUnauthenticated) {
    return (
      <EmptyState
        icon="lock"
        title={t.measure.result.sessionTitle}
        description={t.connection.sessionExpired}
        action={
          <LinkButton href="/" variant="primary">
            {t.common.signInAgain}
          </LinkButton>
        }
      />
    );
  }
  if (error?.code === "CONSENT_REVOKED") {
    return <EmptyState icon="shield" title={t.measure.result.consentTitle} description={t.connection.consentRevoked} />;
  }
  const description = describeApiError(error, lang);
  return (
    <ErrorState
      title={description.title}
      message={description.message}
      code={description.code}
      onRetry={() => void data.refresh()}
      retryLabel={t.common.retry}
      retrying={data.isRefreshing}
    />
  );
}
