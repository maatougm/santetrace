"use client";

/**
 * History: device-only unsent items first (dashed "non envoyé" slips), then
 * server measurements newest first. Alert lines say "reçue par le serveur"
 * until the server reports a clinician action (acknowledged/resolved/rejected);
 * an open alert mentions a care team only if an accepted doctor can see it.
 */
import { Badge, Button, EmptyState, Icon, LinkButton, PageHeader, PriorityBadge, PRIORITY_LABELS_AR } from "@/components/ui";
import type { Alert, Language, Measurement, PatientRecord } from "@/lib/client/api";
import {
  formatDate,
  isUnscoredMeasurement,
  measurementKindLabel,
  measurementProvenanceLabel,
  measurementQualityLabel,
  measurementStatusLabel,
} from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import { CareStatusBadge, colon, Ltr, Reading, SectionTitle, When } from "./bits";
import { alertSeenAt, historyAlertText, isAlertSeen } from "./monitoring/care-team-view";
import { OutboxSlip } from "./OutboxSlip";
import { usePatientRuntime } from "./PatientRuntime";
import type { CareTeamStatus } from "./useCareTeam";
import { RecordGate } from "./RecordGate";
import hist from "./history.module.css";
import styles from "./patient.module.css";

function AlertLine({ alert, team, lang, t }: { alert: Alert; team: CareTeamStatus; lang: Language; t: Messages }) {
  const seenAt = alertSeenAt(alert);
  const seen = isAlertSeen(alert);
  return (
    <div className={`${hist.alert} ${seen ? hist.alertSeen : ""}`}>
      <PriorityBadge priority={alert.priority} size="sm" label={lang === "ar" ? PRIORITY_LABELS_AR[alert.priority] : undefined} />
      <p className={hist.alertText}>
        <Icon name={seen ? "eye" : "inbox"} size={14} />
        <span>
          {historyAlertText(team, alert, t)}
          {seen && seenAt ? (
            <>
              {" · "}
              <When iso={seenAt} lang={lang} />
            </>
          ) : null}
        </span>
      </p>
    </div>
  );
}

interface MeasurementRowProps {
  measurement: Measurement;
  alert: Alert | undefined;
  team: CareTeamStatus;
  lang: Language;
  t: Messages;
}

function MeasurementRow({ measurement, alert, team, lang, t }: MeasurementRowProps) {
  // A suspect reading is excluded from the rules: say so next to its status.
  const quality = measurementQualityLabel(measurement, lang);
  return (
    <li className={hist.row}>
      <div className={hist.rowTop}>
        <span className={styles.kindLabel}>
          <Icon name={measurement.kind === "blood_pressure" ? "heart-pulse" : measurement.kind === "pulse" ? "activity" : "droplet"} size={16} />
          {measurementKindLabel(measurement.kind, lang)}
        </span>
        <span className={styles.inlineActions}>
          {isUnscoredMeasurement(measurement) ? (
            <Badge tone="outline" icon="help-circle">
              {measurementStatusLabel(measurement, lang)}
            </Badge>
          ) : (
            <CareStatusBadge status={measurement.status} lang={lang} size="sm" />
          )}
          {quality ? (
            <Badge tone="outline" icon="help-circle">
              {quality}
            </Badge>
          ) : null}
        </span>
      </div>
      <Reading value={measurement} lang={lang} size="md" />
      <p className={styles.metaLine}>
        <When iso={measurement.measuredAt} lang={lang} label={t.common.measuredAt} />
      </p>
      <p className={styles.metaLine}>
        <When iso={measurement.receivedAt} lang={lang} label={t.common.receivedAt} />
      </p>
      <p className={styles.metaLine}>
        {t.history.source}
        {colon(lang)}
        {measurementProvenanceLabel(measurement, lang)} · {t.history.ruleVersion}{" "}
        <Ltr>{measurement.ruleVersion}</Ltr>
      </p>
      {measurement.clockWarning ? (
        <p className={hist.warning}>
          <Icon name="clock" size={14} />
          {t.history.delayed}
        </p>
      ) : null}
      {alert ? <AlertLine alert={alert} team={team} lang={lang} t={t} /> : null}
    </li>
  );
}

function MeasurementList({ record }: { record: PatientRecord }) {
  const { t, lang, careTeam } = usePatientRuntime();
  const sorted = [...record.measurements].sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));
  const alertByMeasurement = new Map<string, Alert>();
  record.alerts.forEach((alert) => {
    if (alert.measurementId) alertByMeasurement.set(alert.measurementId, alert);
  });

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon="activity"
        title={t.history.empty}
        action={
          <LinkButton href="/patient/measure" variant="primary" iconStart="plus">
            {t.home.measureCta}
          </LinkButton>
        }
      />
    );
  }

  const groups = sorted.reduce<{ day: string; items: Measurement[] }[]>((acc, measurement) => {
    const day = formatDate(measurement.measuredAt, lang);
    const last = acc[acc.length - 1];
    if (last && last.day === day) return [...acc.slice(0, -1), { day, items: [...last.items, measurement] }];
    return [...acc, { day, items: [measurement] }];
  }, []);

  return (
    <section className={styles.stack} aria-labelledby="hist-server">
      <SectionTitle id="hist-server">
        {t.history.serverTitle} <Ltr>({sorted.length})</Ltr>
      </SectionTitle>
      {groups.map((group) => (
        <div key={group.day} className={hist.day}>
          <h3 className={hist.dayTitle}>{group.day}</h3>
          <ol className={hist.list}>
            {group.items.map((measurement) => (
              <MeasurementRow
                key={measurement.id}
                measurement={measurement}
                alert={alertByMeasurement.get(measurement.id)}
                team={careTeam.status}
                lang={lang}
                t={t}
              />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

export function HistoryScreen() {
  const { t, lang, outbox } = usePatientRuntime();
  const unsent = outbox.entries.filter((entry) => entry.state !== "server_received");
  const waiting = unsent.some((entry) => entry.state === "queued");

  return (
    <div className={styles.page}>
      <PageHeader
        title={t.history.title}
        actions={
          <LinkButton href="/patient/summary" variant="secondary" iconStart="clipboard">
            {t.history.summaryLink}
          </LinkButton>
        }
      />

      {unsent.length > 0 ? (
        <section className={styles.stack} aria-labelledby="hist-unsent">
          <SectionTitle
            id="hist-unsent"
            action={
              waiting ? (
                <Button variant="secondary" iconStart="refresh" loading={outbox.replaying} onClick={() => void outbox.replay()}>
                  {t.outbox.retry}
                </Button>
              ) : null
            }
          >
            {t.history.unsentTitle} <Ltr>({unsent.length})</Ltr>
          </SectionTitle>
          <p className={styles.metaLine}>{t.history.unsentHint}</p>
          {unsent.map((entry) => (
            <OutboxSlip key={entry.clientId} entry={entry} lang={lang} t={t} onDiscard={outbox.discard} />
          ))}
        </section>
      ) : null}

      <RecordGate>{(record) => <MeasurementList record={record} />}</RecordGate>
    </div>
  );
}
