"use client";

/**
 * One device-only outbox entry that the server has NOT received (queued,
 * sending or failed). Rendered as a dashed, hatched "slip" so it can never be
 * mistaken for server data.
 */
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { measurementKindLabel } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import type { OutboxEntry } from "@/lib/client/outbox";
import { Ltr, Reading, When } from "./bits";
import { LocalEvaluationNotice } from "./LocalEvaluationNotice";
import styles from "./patient.module.css";

interface OutboxSlipProps {
  entry: OutboxEntry;
  lang: Language;
  t: Messages;
  onDiscard: (clientId: string) => Promise<void>;
  showLocalEvaluation?: boolean;
}

function ErrorLine({ entry, lang, t }: { entry: OutboxEntry; lang: Language; t: Messages }) {
  const error = entry.lastError;
  if (!error) return null;
  // Server messages are written in French by the backend: show them verbatim in French only.
  const serverText = lang === "fr" && error.message ? error.message : null;
  return (
    <p className={entry.state === "failed" ? styles.slipError : styles.slipInfo}>
      {t.outbox.errors[error.kind]}
      {serverText ? ` ${serverText}` : null}
      {error.code ? (
        <>
          {" "}
          <Ltr>({error.code})</Ltr>
        </>
      ) : null}
    </p>
  );
}

export function OutboxSlip({ entry, lang, t, onDiscard, showLocalEvaluation = true }: OutboxSlipProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discardError, setDiscardError] = useState(false);

  const discard = async () => {
    setBusy(true);
    setDiscardError(false);
    try {
      await onDiscard(entry.clientId);
    } catch {
      setDiscardError(true);
      setBusy(false);
      setConfirming(false);
    }
  };

  // Delivery failures are not clinical priority: amber/red tones stay reserved for alerts.
  const stateTone = entry.state === "failed" ? "muted" : "outline";

  return (
    <article className={`${styles.slip} ${entry.state === "failed" ? styles.slipFailed : ""}`}>
      <header className={styles.slipHead}>
        <span className={styles.slipStub}>{t.outbox.notSent}</span>
        <Badge tone={stateTone} icon={entry.state === "failed" ? "x-circle" : "clock"}>
          {t.outbox.state[entry.state]}
        </Badge>
      </header>

      {entry.kind === "redacted" ? (
        <div className={styles.slipBody}>
          <p className={styles.slipKind}>
            {entry.originalKind === "measurement" ? t.measure.title : t.history.reminderReport}
          </p>
          <p className={styles.slipError}>{t.outbox.redacted}</p>
        </div>
      ) : entry.kind === "measurement" ? (
        <div className={styles.slipBody}>
          <p className={styles.slipKind}>{measurementKindLabel(entry.payload.kind, lang)}</p>
          <Reading value={entry.payload} lang={lang} size="md" />
          <p className={styles.metaLine}>
            <When iso={entry.payload.measuredAt} lang={lang} label={t.common.measuredAt} />
          </p>
        </div>
      ) : (
        <div className={styles.slipBody}>
          <p className={styles.slipKind}>{t.history.reminderReport}</p>
          <p className={styles.slipTitle}>
            {entry.reminder.label} · {entry.payload.taken ? t.reminders.taken : t.reminders.notTaken}
          </p>
          <p className={styles.metaLine}>
            <When iso={entry.reminder.dueAt} lang={lang} label={t.reminders.due} />
          </p>
        </div>
      )}

      <ErrorLine entry={entry} lang={lang} t={t} />

      {showLocalEvaluation && entry.kind === "measurement" && entry.state !== "failed" ? (
        <LocalEvaluationNotice evaluation={entry.localEvaluation} lang={lang} t={t} />
      ) : (
        <p className={styles.metaLine}>{t.outbox.careTeamNotInformed}</p>
      )}

      <footer className={styles.slipFoot}>
        <span className={styles.metaLine}>
          <When iso={entry.capturedAt} lang={lang} format="relative" label={t.outbox.savedOnDevice} />
          {entry.attempts > 0 ? ` · ${t.outbox.attempts(entry.attempts)}` : null}
        </span>
        {confirming ? (
          <span className={styles.slipActions}>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button variant="danger" iconStart="x" onClick={() => void discard()} loading={busy}>
              {t.outbox.discard}
            </Button>
          </span>
        ) : (
          <Button variant="ghost" iconStart="x" onClick={() => setConfirming(true)} disabled={entry.state === "sending"}>
            {t.outbox.discard}
          </Button>
        )}
      </footer>
      {confirming && entry.state !== "failed" ? <p className={styles.slipWarning}>{t.outbox.careTeamNotInformed}</p> : null}
      {discardError ? (
        <p className={styles.slipError} role="alert">
          {t.outbox.storageUnavailable}
        </p>
      ) : null}
    </article>
  );
}
