"use client";

import { Button, Icon, Notice } from "@/components/ui";
import { describeApiError, type ApiError } from "@/lib/client/api";
import { useNow } from "./hooks";
import { TIME_ZONE } from "./time";
import styles from "./SyncStatus.module.css";

interface SyncStatusProps {
  lastSuccessAt: number | null;
  error: ApiError | null;
  isRefreshing: boolean;
}

const clockFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: TIME_ZONE,
});

function clock(ms: number): string {
  return clockFormatter.format(ms);
}

function ageLabel(lastSuccessAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - lastSuccessAt) / 1000));
  if (seconds < 60) return `il y a ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  return `à ${clock(lastSuccessAt)}`;
}

/** Compact "mis à jour il y a X s" chip for page headers. Not a live region on purpose. */
export function SyncStatus({ lastSuccessAt, error, isRefreshing }: SyncStatusProps) {
  const now = useNow(1_000);
  const stale = Boolean(error);
  return (
    <p className={stale ? `${styles.chip} ${styles.stale}` : styles.chip}>
      <span className={styles.dot} aria-hidden="true" data-refreshing={isRefreshing || undefined} />
      {lastSuccessAt === null ? (
        <span>Synchronisation…</span>
      ) : (
        <span>
          {stale ? "Dernière mise à jour " : "Mis à jour "}
          <span className={styles.age}>{ageLabel(lastSuccessAt, now)}</span>
        </span>
      )}
      {stale ? <Icon name="cloud-off" size={14} title="Synchronisation interrompue" /> : null}
    </p>
  );
}

interface StaleNoticeProps {
  error: ApiError | null;
  lastSuccessAt: number | null;
  onRetry: () => void;
  isRefreshing: boolean;
}

/** Visible banner when polling fails while previous data stays on screen. */
export function StaleNotice({ error, lastSuccessAt, onRetry, isRefreshing }: StaleNoticeProps) {
  if (!error || lastSuccessAt === null) return null;
  const description = describeApiError(error, "fr");
  const since = clock(lastSuccessAt);
  return (
    <Notice
      tone="info"
      icon={error.isOffline ? "wifi-off" : "cloud-off"}
      role="status"
      title={`Données affichées du ${since} — possiblement périmées`}
      action={
        <Button size="sm" variant="secondary" iconStart="refresh" onClick={onRetry} loading={isRefreshing}>
          Réessayer
        </Button>
      }
    >
      {description.title} : {description.message} Les nouvelles mesures et alertes n’apparaissent pas tant que la
      synchronisation est interrompue.
    </Notice>
  );
}
