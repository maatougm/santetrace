"use client";

/**
 * Result step. Shows "received" only with a server response (server text,
 * status and receivedAt); otherwise the honest queued / failed / not-kept state.
 * Care-team wording appears only when an accepted doctor can see alerts.
 * While this screen is open, a queued entry that later replays successfully is
 * picked up live from the outbox.
 */
import { Badge, Button, Card, LinkButton, Notice } from "@/components/ui";
import type { Alert, Language } from "@/lib/client/api";
import { measurementKindLabel } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import type { MeasurementEntry } from "@/lib/client/outbox";
import { CareStatusBadge, Ltr, Reading, When } from "./bits";
import { DeliverySteps } from "./DeliverySteps";
import { LocalEvaluationNotice } from "./LocalEvaluationNotice";
import { receiptNotes } from "./monitoring/care-team-view";
import { usePatientRuntime } from "./PatientRuntime";
import type { CareTeamStatus } from "./useCareTeam";
import measure from "./measure.module.css";
import styles from "./patient.module.css";

interface MeasureResultProps {
  entry: MeasurementEntry;
  persisted: boolean;
  retrying: boolean;
  onRetry: () => void;
  onCorrect: () => void;
  onNew: () => void;
}

interface ReceivedProps {
  entry: MeasurementEntry;
  alert: Alert | null;
  team: CareTeamStatus;
  lang: Language;
  t: Messages;
}

function Received({ entry, alert, team, lang, t }: ReceivedProps) {
  const result = entry.result;
  if (!result) return null;
  const { patientMessage, measurement } = result;
  // No "équipe soignante" receipt unless an accepted doctor can see alerts (FR-027).
  const receipt = receiptNotes(team, alert, t);
  const tone =
    patientMessage.status === "red" ? "priority-red" : patientMessage.status === "orange" ? "priority-orange" : "default";
  return (
    <Card tone={tone} eyebrow={measurementKindLabel(measurement.kind, lang)} title={t.measure.result.receivedTitle}>
      <div className={styles.stack}>
        <div className={measure.resultTop}>
          <Reading value={measurement} lang={lang} size="lg" />
          <CareStatusBadge status={patientMessage.status} lang={lang} size="lg" />
        </div>
        <p className={styles.serverMessage} dir="auto">
          {patientMessage.text}
        </p>
        <p>
          <Badge tone="muted" icon="lock">
            {t.common.fixedMessage}
          </Badge>
        </p>
        <DeliverySteps lang={lang} t={t} capturedAt={entry.capturedAt} receivedAt={measurement.receivedAt} alert={alert} team={team} />
        {receipt.notes.map((note) => (
          <p key={note} className={styles.metaLine}>
            {note}
          </p>
        ))}
        {receipt.invite ? (
          <p>
            <LinkButton href="/patient/doctors" variant="secondary" iconStart="user-plus">
              {t.noReferent.invite}
            </LinkButton>
          </p>
        ) : null}
        {measurement.clockWarning ? <p className={styles.metaLine}>{t.history.delayed}</p> : null}
        <p className={styles.metaLine}>
          <When iso={measurement.measuredAt} lang={lang} label={t.common.measuredAt} />
          <br />
          <When iso={measurement.receivedAt} lang={lang} label={t.common.receivedAt} />
          <br />
          {t.history.ruleVersion} <Ltr>{measurement.ruleVersion}</Ltr> · {t.common.demoRules}
        </p>
      </div>
    </Card>
  );
}

function Queued({ entry, persisted, team, lang, t }: { entry: MeasurementEntry; persisted: boolean; team: CareTeamStatus; lang: Language; t: Messages }) {
  const copy = t.measure.result;
  const sessionExpired = entry.lastError?.kind === "unauthenticated";
  return (
    <div className={styles.stack}>
      {!persisted ? (
        <Notice tone="neutral" icon="x-circle" title={copy.noStorageTitle} role="alert">
          {copy.noStorageBody}
        </Notice>
      ) : sessionExpired ? (
        <Notice
          tone="neutral"
          icon="lock"
          title={copy.sessionTitle}
          action={
            <LinkButton href="/" variant="primary">
              {t.common.signInAgain}
            </LinkButton>
          }
        >
          {copy.sessionBody}
        </Notice>
      ) : (
        <Notice tone="neutral" icon="cloud-off" title={copy.queuedTitle}>
          {entry.state === "sending" ? t.outbox.state.sending : copy.queuedBody}
        </Notice>
      )}
      <section className={styles.slip} aria-label={t.outbox.notSent}>
        <header className={styles.slipHead}>
          <span className={styles.slipStub}>{t.outbox.notSent}</span>
          <Badge tone="outline" icon="clock">
            {t.outbox.state[entry.state]}
          </Badge>
        </header>
        <div className={styles.slipBody}>
          <p className={styles.slipKind}>{measurementKindLabel(entry.payload.kind, lang)}</p>
          <Reading value={entry.payload} lang={lang} size="lg" />
          <p className={styles.metaLine}>
            <When iso={entry.payload.measuredAt} lang={lang} label={t.common.measuredAt} />
          </p>
        </div>
        <DeliverySteps lang={lang} t={t} capturedAt={persisted ? entry.capturedAt : null} receivedAt={null} team={team} />
      </section>
      {persisted ? <LocalEvaluationNotice evaluation={entry.localEvaluation} lang={lang} t={t} /> : null}
    </div>
  );
}

function Failed({ entry, lang, t, onCorrect }: { entry: MeasurementEntry; lang: Language; t: Messages; onCorrect: () => void }) {
  const copy = t.measure.result;
  const error = entry.lastError;
  if (error?.kind === "consent_revoked") {
    return (
      <Notice tone="neutral" icon="shield" title={copy.consentTitle} role="alert">
        {copy.consentBody}
      </Notice>
    );
  }
  const serverText = lang === "fr" && error?.message ? error.message : null;
  return (
    <Notice
      tone="neutral"
      icon="x-circle"
      title={copy.failedTitle}
      role="alert"
      action={
        <Button variant="primary" iconStart="edit" onClick={onCorrect}>
          {t.outbox.correct}
        </Button>
      }
    >
      <p className={styles.noticeStrong}>
        {error ? t.outbox.errors[error.kind] : null}
        {serverText ? ` ${serverText}` : null}
        {error?.code ? (
          <>
            {" "}
            <Ltr>({error.code})</Ltr>
          </>
        ) : null}
      </p>
      <p className={styles.noticeLine}>{copy.failedBody}</p>
    </Notice>
  );
}

export function MeasureResult({ entry, persisted, retrying, onRetry, onCorrect, onNew }: MeasureResultProps) {
  const { lang, t, data, outbox, careTeam } = usePatientRuntime();
  const stored = persisted ? outbox.entries.find((candidate) => candidate.clientId === entry.clientId) : undefined;
  // A stored redacted record means consent was withdrawn during replay: show it
  // as failed with that error (the in-memory copy on screen keeps the values).
  const live: MeasurementEntry =
    stored?.kind === "measurement"
      ? stored
      : stored?.kind === "redacted"
        ? { ...entry, state: "failed", lastError: stored.lastError }
        : entry;
  const serverAlert = live.result?.alert ?? null;
  const alert = serverAlert ? (data.record?.alerts.find((a) => a.id === serverAlert.id) ?? serverAlert) : null;
  const pending = live.state === "queued" || live.state === "sending";

  return (
    <div className={measure.form}>
      <h2 className={styles.srOnly} id="m-result-title">
        {t.measure.steps.result}
      </h2>
      {live.state === "server_received" ? <Received entry={live} alert={alert} team={careTeam.status} lang={lang} t={t} /> : null}
      {pending ? <Queued entry={live} persisted={persisted} team={careTeam.status} lang={lang} t={t} /> : null}
      {live.state === "failed" ? <Failed entry={live} lang={lang} t={t} onCorrect={onCorrect} /> : null}

      <div className={measure.resultActions}>
        {pending ? (
          <Button variant="secondary" size="lg" iconStart="refresh" loading={retrying || live.state === "sending"} onClick={onRetry}>
            {t.outbox.retry}
          </Button>
        ) : null}
        <Button variant={pending ? "secondary" : "primary"} size="lg" iconStart="plus" onClick={onNew}>
          {t.measure.result.newMeasure}
        </Button>
        <LinkButton href="/patient/history" variant="ghost" iconEnd="chevron-right">
          {t.measure.result.history}
        </LinkButton>
        <LinkButton href="/patient" variant="ghost" iconStart="home">
          {t.measure.result.home}
        </LinkButton>
      </div>
    </div>
  );
}
