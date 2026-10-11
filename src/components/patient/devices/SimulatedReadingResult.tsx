"use client";

/**
 * What the server returned for one simulated event: its measurement (value,
 * unit, measured/received times, source, binding, quality), the monitoring
 * priority with its coverage, and any alert. The simulator badge stays on the
 * card; pulse is shown unscored; green is never shown without full coverage.
 */
import { useCallback } from "react";
import { Badge, Button, Card, KeyValueList, LinkButton, Notice, PriorityBadge, PRIORITY_LABELS_AR, StatusBadge } from "@/components/ui";
import type { Alert } from "@/contracts/care";
import type { MonitoringState } from "@/contracts/monitoring";
import { CARE_COPY } from "@/lib/client/copy/care";
import { reasonText, UNTRANSLATED_REASON } from "@/lib/client/copy/reasons";
import { SHARE_COPY } from "@/lib/client/copy/share";
import type { MeasurementReceipt } from "@/lib/client/devices-api";
import { formatDateTime, isSimulatedMeasurement, isUnscoredMeasurement, measurementKindLabel, measurementSourceLabel } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import type { Language } from "@/lib/client/transport";
import { CareStatusBadge, Ltr, Reading, When } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import { alertAudience, monitoringView } from "./simulator-logic";
import dev from "./devices.module.css";
import styles from "../patient.module.css";

/** Server reasons in FR/AR when known; anything else verbatim, marked as untranslated English. */
function ReasonItem({ reason, lang }: { reason: string; lang: Language }) {
  const rendered = reasonText(reason, lang);
  if (rendered.translated) return <li>{rendered.text}</li>;
  return (
    <li>
      <span lang="en" dir="ltr">
        {rendered.text}
      </span>{" "}
      <span className={styles.metaLine}>({UNTRANSLATED_REASON[lang]})</span>
    </li>
  );
}

function MonitoringBlock({ monitoring, lang }: { monitoring: MonitoringState; lang: Language }) {
  const care = CARE_COPY[lang];
  const view = monitoringView(monitoring);
  return (
    <section className={dev.monitoring} aria-labelledby="sim-monitoring-title">
      <h4 id="sim-monitoring-title" className={dev.monitoringTitle}>
        {care.monitoring.globalTitle}
      </h4>
      <div className={dev.badges}>
        <CareStatusBadge status={view.status} lang={lang} />
      </div>
      {view.downgraded ? <p className={styles.metaLine}>{care.monitoring.notGreenBecause}</p> : null}
      {monitoring.coverage.length > 0 ? (
        <ul className={dev.badgeList} aria-label={care.plan.coverageTitle}>
          {monitoring.coverage.map((coverage, index) => (
            <li key={`${coverage}-${index}`}>
              <Badge tone={coverage === "complete" ? "neutral" : "outline"} icon={coverage === "complete" ? "check" : "help-circle"}>
                {care.coverage[coverage]}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {/* The epoch "never evaluated" sentinel is never shown as a time, nor replaced by another one. */}
      <p className={styles.metaLine}>
        {view.evaluatedAt ? care.monitoring.evaluatedAt(formatDateTime(view.evaluatedAt, lang)) : care.monitoring.noEvaluation}
      </p>
      {monitoring.reasons.length > 0 ? (
        <div className={styles.stackSm}>
          <p className={styles.kindLabel}>{care.monitoring.reasonsTitle}</p>
          <ul className={dev.reasons}>
            {monitoring.reasons.map((reason, index) => (
              <ReasonItem key={`${index}-${reason}`} reason={reason} lang={lang} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function AlertBlock({ alert, lang, t }: { alert: Alert; lang: Language; t: Messages }) {
  const care = CARE_COPY[lang];
  // Never imply a care team the owner's current grants do not show (FR-027).
  const audience = alertAudience(usePatientRuntime().careTeam.status);
  const audienceText =
    audience === "care_team" ? t.measure.result.alertCreated : audience === "nobody" ? t.noReferent.alertCreated : t.noReferent.unknownTeam;
  return (
    <div className={styles.stackSm}>
      {alert.priority === "red" ? (
        <Notice tone="red" title={care.red.fixedTitle}>
          <p className={styles.noticeLine}>{care.red.fixedBody}</p>
          <p className={styles.noticeMeta}>{care.red.fixedNote}</p>
        </Notice>
      ) : null}
      <p className={styles.inlineActions}>
        <PriorityBadge priority={alert.priority} size="sm" label={lang === "ar" ? PRIORITY_LABELS_AR[alert.priority] : undefined} />
        <span className={styles.metaLine}>{audienceText}</span>
      </p>
      {audience === "nobody" ? (
        <div>
          <LinkButton href="/patient/doctors" variant="secondary" iconStart="user-plus">
            {t.noReferent.invite}
          </LinkButton>
        </div>
      ) : null}
    </div>
  );
}

interface SimulatedReadingResultProps {
  receipt: MeasurementReceipt;
  lang: Language;
  t: Messages;
  live: boolean;
  resending: boolean;
  onResend: () => void;
}

export function SimulatedReadingResult({ receipt, lang, t, live, resending, onResend }: SimulatedReadingResultProps) {
  const copy = SHARE_COPY[lang].simulator;
  const care = CARE_COPY[lang];
  const { measurement } = receipt;
  const unscored = isUnscoredMeasurement(measurement);
  const quality = measurement.connector?.quality;
  // A new server receipt: move focus to it so keyboard and screen-reader users notice it.
  const focusOnMount = useCallback((node: HTMLDivElement | null) => node?.focus(), []);

  return (
    <div ref={focusOnMount} tabIndex={-1}>
      <Card
        id="sim-result"
        eyebrow={measurementKindLabel(measurement.kind, lang)}
        title={copy.received}
        headingLevel={3}
        actions={
          <Badge tone="outline" icon="activity">
            {copy.badge}
          </Badge>
        }
      >
        <div className={styles.stack}>
          <div className={dev.resultTop}>
            <Reading value={measurement} lang={lang} size="lg" />
            {unscored ? (
              <StatusBadge status="unknown" label={care.monitoring.pulseUnscored} />
            ) : (
              <CareStatusBadge status={measurement.status} lang={lang} size="lg" />
            )}
          </div>
          <div className={dev.badges}>
            {isSimulatedMeasurement(measurement) ? (
              <Badge tone="outline" icon="activity">
                {care.verification.simulated}
              </Badge>
            ) : null}
            {quality === "suspect" ? (
              <Badge tone="outline" icon="help-circle">
                {copy.quality.suspect}
              </Badge>
            ) : null}
          </div>
          {unscored ? <p className={styles.metaLine}>{copy.pulseUnscored}</p> : null}
          <KeyValueList
            dense
            items={[
              { label: t.common.measuredAt, value: <When iso={measurement.measuredAt} lang={lang} /> },
              { label: t.common.receivedAt, value: <When iso={measurement.receivedAt} lang={lang} /> },
              { label: t.history.source, value: measurementSourceLabel(measurement.source, lang) },
              ...(measurement.connector ? [{ label: copy.deviceIdLabel, value: <Ltr>{measurement.connector.deviceId}</Ltr> }] : []),
              ...(quality ? [{ label: copy.qualityLabel, value: copy.quality[quality] }] : []),
            ]}
          />
          {measurement.clockWarning ? <p className={styles.metaLine}>{t.history.delayed}</p> : null}
          <MonitoringBlock monitoring={receipt.monitoring} lang={lang} />
          {receipt.alert ? <AlertBlock alert={receipt.alert} lang={lang} t={t} /> : null}
          <div className={dev.actions}>
            <Button variant="secondary" iconStart="refresh" loading={resending} disabled={!live} onClick={onResend}>
              {resending ? copy.sending : copy.resend}
            </Button>
            <p className={styles.metaLine}>{copy.resendHint}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
