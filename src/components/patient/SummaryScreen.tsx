"use client";

/**
 * Factual summary from GET /api/patients/:id/summary (fixed template; `ai`
 * labelled), the fixed treatment-deferral line, and consent withdrawal.
 * No assistant / teach-back is implemented here on purpose.
 */
import { useState } from "react";
import { useLogout } from "@/components/layout";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Notice, PageHeader } from "@/components/ui";
import { describeApiError, getSummary, revokeConsent, type SummaryResponse } from "@/lib/client/api";
import { DEVICE_PURGE_FAILED } from "@/lib/client/session-cleanup";
import { usePolling } from "@/lib/client/use-polling";
import { When } from "./bits";
import { usePatientRuntime } from "./PatientRuntime";
import { LoadingBlock } from "./RecordGate";
import styles from "./patient.module.css";
import summaryStyles from "./summary.module.css";

const SUMMARY_REFRESH_MS = 30_000;

function SummaryCard() {
  const { t, lang, scope } = usePatientRuntime();
  const patientId = scope?.patientId ?? null;
  const summary = usePolling<SummaryResponse>(
    patientId ? `summary:${patientId}` : null,
    (signal) => getSummary(patientId ?? "", { signal }),
    { intervalMs: SUMMARY_REFRESH_MS, enabled: Boolean(patientId) },
  );

  if (!summary.data) {
    if (!summary.error) return <LoadingBlock label={t.common.loading} lines={4} />;
    if (summary.error.isOffline) {
      return <EmptyState icon="wifi-off" title={t.connection.offline} description={t.connection.noServerData} />;
    }
    const description = describeApiError(summary.error, lang);
    return (
      <ErrorState
        title={description.title}
        message={description.message}
        code={description.code}
        onRetry={() => void summary.refresh()}
        retryLabel={t.common.retry}
        retrying={summary.isRefreshing}
      />
    );
  }

  const { text, facts, ai } = summary.data;
  const readAt = summary.lastSuccessAt !== null ? new Date(summary.lastSuccessAt).toISOString() : null;
  return (
    <Card
      eyebrow={
        <Badge tone={ai ? "outline" : "muted"} icon={ai ? "info" : "lock"}>
          {ai ? t.summary.ai : t.summary.factual}
        </Badge>
      }
      actions={
        <Button variant="ghost" iconStart="refresh" loading={summary.isRefreshing} onClick={() => void summary.refresh()}>
          {t.common.refresh}
        </Button>
      }
    >
      <div className={styles.stack}>
        {t.summary.serverLanguage ? <p className={styles.metaLine}>{t.summary.serverLanguage}</p> : null}
        <p className={summaryStyles.text} lang="fr" dir="ltr">
          {text}
        </p>
        <p className={styles.metaLine}>
          {t.summary.facts(facts.length)} · <When iso={readAt} lang={lang} format="relative" label={t.summary.readAt} />
        </p>
        {summary.error ? <p className={styles.slipInfo}>{describeApiError(summary.error, lang).title}</p> : null}
      </div>
    </Card>
  );
}

function ConsentSection() {
  const { t, lang, scope, data, beforeLogout } = usePatientRuntime();
  const { logout, pending: loggingOut, error: logoutError } = useLogout({ onBeforeLogout: beforeLogout });
  // Not pending + error: the logout stopped before signing out (still signed in).
  const logoutStopped = logoutError !== null && !loggingOut;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    if (!scope) return;
    setBusy(true);
    setError(null);
    try {
      await revokeConsent(scope.patientId);
      setDone(true);
      setOpen(false);
      void data.refresh();
    } catch (caught) {
      const description = describeApiError(caught, lang);
      setError(`${description.title} — ${description.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t.summary.consentTitle} tone="muted" headingLevel={2}>
      <div className={styles.stack}>
        {done ? (
          <>
            <Notice
              tone="info"
              icon="shield"
              role="status"
              action={
                <Button variant="primary" iconStart="log-out" loading={loggingOut} onClick={() => void logout()}>
                  {t.logout.purge}
                </Button>
              }
            >
              {t.summary.consentDone}
            </Notice>
            {logoutStopped ? (
              <Notice
                tone="neutral"
                icon="alert-triangle"
                role="alert"
                title={t.logout.blockedTitle}
                action={
                  <Button variant="secondary" iconStart="refresh" onClick={() => void logout()}>
                    {t.logout.retryLogout}
                  </Button>
                }
              >
                {logoutError === DEVICE_PURGE_FAILED ? t.logout.blockedBody : t.logout.preparationFailedBody}
              </Notice>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.metaLine}>{t.summary.consentBody}</p>
            <div>
              <Button variant="secondary" iconStart="shield" onClick={() => setOpen(true)}>
                {t.summary.consentAction}
              </Button>
            </div>
          </>
        )}
      </div>
      <Dialog
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        size="sm"
        closeLabel={t.common.close}
        title={t.summary.consentConfirmTitle}
        description={t.summary.consentConfirmBody}
        footer={
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void revoke()}>
              {t.summary.consentConfirm}
            </Button>
          </div>
        }
      >
        {error ? (
          <p className={styles.slipError} role="alert">
            {error}
          </p>
        ) : null}
      </Dialog>
    </Card>
  );
}

export function SummaryScreen() {
  const { t } = usePatientRuntime();
  return (
    <div className={styles.page}>
      <PageHeader title={t.summary.title} back={{ href: "/patient", label: t.nav.home }} />
      <SummaryCard />
      <Notice tone="info" icon="stethoscope" role="note">
        {t.summary.deferral}
      </Notice>
      <ConsentSection />
    </div>
  );
}
