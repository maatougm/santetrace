"use client";

/**
 * Connectivity + outbox strip rendered in PatientShell's statusSlot.
 * Says where the data on screen comes from (live server, stale, or a dated
 * device copy) and how many actions the server has not received yet.
 */
import { Button, Icon, LinkButton, type IconName } from "@/components/ui";
import { describeApiError } from "@/lib/client/api";
import { formatDateTime, formatRelative } from "@/lib/client/format";
import { usePatientRuntime, type PatientRuntime } from "./PatientRuntime";
import styles from "./StatusStrip.module.css";

type Tone = "ok" | "warn" | "block";

interface Connectivity {
  tone: Tone;
  icon: IconName;
  label: string;
  detail: string | null;
  signIn: boolean;
}

function describeConnectivity({ data, online, lang, t }: PatientRuntime): Connectivity {
  const error = data.error;
  const lastIso = data.lastSuccessAt !== null ? new Date(data.lastSuccessAt).toISOString() : null;
  if (error?.isUnauthenticated) {
    return { tone: "block", icon: "lock", label: t.connection.sessionExpired, detail: null, signIn: true };
  }
  if (error?.code === "CONSENT_REVOKED") {
    return { tone: "block", icon: "shield", label: t.connection.consentRevoked, detail: null, signIn: false };
  }
  const staleDetail =
    data.origin === "device" && data.deviceSavedAt
      ? t.connection.deviceCopy(formatDateTime(data.deviceSavedAt, lang))
      : lastIso
        ? t.connection.staleSince(formatRelative(lastIso, lang))
        : t.connection.noServerData;
  if (!online || error?.isOffline) {
    return { tone: "warn", icon: "wifi-off", label: t.connection.offline, detail: staleDetail, signIn: false };
  }
  if (error) {
    const label = error.isUnavailable || error.status >= 500 ? t.connection.unreachable : describeApiError(error, lang).title;
    return { tone: "warn", icon: "cloud-off", label, detail: staleDetail, signIn: false };
  }
  if (lastIso) {
    return {
      tone: "ok",
      icon: "wifi",
      label: t.connection.online,
      detail: t.connection.syncedAgo(formatRelative(lastIso, lang)),
      signIn: false,
    };
  }
  return { tone: "ok", icon: "refresh", label: t.common.loading, detail: null, signIn: false };
}

export function StatusStrip() {
  const runtime = usePatientRuntime();
  const { t, outbox, pwa } = runtime;
  const connectivity = describeConnectivity(runtime);
  const { counts } = outbox;
  const waiting = counts.queued + counts.sending;

  return (
    <div className={styles.strip}>
      <div className={`${styles.row} ${styles[connectivity.tone]}`}>
        <Icon name={connectivity.icon} size={16} className={styles.icon} />
        <p className={styles.text}>
          <span role="status" className={styles.label}>
            {connectivity.label}
          </span>
          {connectivity.detail ? <span className={styles.detail}>{connectivity.detail}</span> : null}
        </p>
        {connectivity.signIn ? (
          <LinkButton href="/" variant="primary">
            {t.common.signInAgain}
          </LinkButton>
        ) : (
          <span className={styles.chips}>
            {pwa.installed ? <span className={styles.chip}>{t.connection.installed}</span> : null}
            {pwa.offlineReady ? (
              <span className={styles.chip}>
                <Icon name="check" size={12} />
                {t.connection.offlineReady}
              </span>
            ) : null}
          </span>
        )}
      </div>

      {outbox.status === "unavailable" ? (
        <div className={`${styles.row} ${styles.warn}`}>
          <Icon name="alert-triangle" size={16} className={styles.icon} />
          <p className={styles.text} role="status">
            {t.outbox.storageUnavailable}
          </p>
        </div>
      ) : null}

      {waiting + counts.failed > 0 ? (
        <div className={`${styles.row} ${styles.outbox}`}>
          <Icon name="clock" size={16} className={styles.icon} />
          <p className={styles.text} role="status">
            {waiting > 0 ? <span className={styles.label}>{t.outbox.waiting(waiting)}</span> : null}
            {counts.failed > 0 ? <span className={styles.failed}>{t.outbox.failed(counts.failed)}</span> : null}
          </p>
          {waiting > 0 ? (
            <Button
              variant="secondary"
              iconStart="refresh"
              loading={outbox.replaying}
              onClick={() => void outbox.replay()}
            >
              {outbox.replaying ? t.outbox.retrying : t.outbox.retry}
            </Button>
          ) : (
            <LinkButton href="/patient/history" variant="ghost" iconEnd="chevron-right">
              {t.common.seeAll}
            </LinkButton>
          )}
        </div>
      ) : null}
    </div>
  );
}
