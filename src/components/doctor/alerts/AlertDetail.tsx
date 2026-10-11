"use client";

import Link from "next/link";
import { Badge, Icon, KeyValueList, PriorityBadge, Timestamp } from "@/components/ui";
import type { Alert, Measurement, Patient } from "@/lib/client/api";
import { formatMeasurement, formatNumber, measurementKindLabel, measurementProvenanceLabel } from "@/lib/client/format";
import { crossedLevel, evidenceRows, type EvidenceRow } from "../shared/alerts";
import { ALERT_ACTION_LABEL, ALERT_STATUS_LABEL, DEMO_RULE_LABEL } from "../shared/labels";
import { patientHref } from "../shared/routes";
import { AlertActions } from "./AlertActions";
import type { MutationGuard } from "@/lib/client/access-fence";
import styles from "./AlertDetail.module.css";

interface AlertDetailProps {
  alert: Alert;
  /** Triggering measurement when it is available in the loaded record. */
  measurement: Measurement | null;
  /** Shown with a link to the record when rendered outside the record page. */
  patient?: Pick<Patient, "id" | "displayName"> | null;
  onUpdated: (alert: Alert) => void;
  /** Mutation guard of the patient record view (optional elsewhere). */
  guard?: MutationGuard;
  /** id applied to the panel heading so callers can move focus to it. */
  headingId?: string;
}

const CROSSED_LABEL: Record<ReturnType<typeof crossedLevel>, string> = {
  red: "Seuil priorité haute atteint",
  orange: "Seuil de suivi atteint",
  none: "Aucun seuil atteint pour cette valeur",
  not_comparable: "Unités différentes : conversion faite par le serveur (voir motif)",
};

function EvidenceTable({ rows, version }: { rows: EvidenceRow[]; version: string }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.evidence}>
        <caption className={styles.caption}>
          Valeur reçue comparée aux seuils de la version <span className={styles.mono}>{version}</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Mesure</th>
            <th scope="col" className={styles.num}>
              Valeur reçue
            </th>
            <th scope="col" className={styles.num}>
              Seuil de suivi
            </th>
            <th scope="col" className={styles.num}>
              Seuil priorité haute
            </th>
            <th scope="col">Constat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const level = crossedLevel(row);
            return (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td className={styles.num}>
                  <strong>{formatNumber(row.value, "fr", 1)}</strong> {row.unit}
                </td>
                <td className={styles.num}>
                  ≥ {formatNumber(row.warn, "fr", 1)} {row.thresholdUnit}
                </td>
                <td className={styles.num}>
                  ≥ {formatNumber(row.high, "fr", 1)} {row.thresholdUnit}
                </td>
                <td>
                  {level === "red" || level === "orange" ? (
                    <PriorityBadge priority={level} size="sm" label={CROSSED_LABEL[level]} />
                  ) : (
                    <span className={styles.muted}>{CROSSED_LABEL[level]}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AlertHistory({ alert }: { alert: Alert }) {
  if (alert.history.length === 0) {
    return <p className={styles.muted}>Aucune action clinicien enregistrée pour cette alerte.</p>;
  }
  return (
    <ol className={styles.history}>
      {[...alert.history].reverse().map((entry, index) => (
        <li key={`${entry.at}-${index}`} className={styles.historyItem}>
          <div className={styles.historyHead}>
            <strong>{ALERT_ACTION_LABEL[entry.action] ?? entry.action}</strong>
            <span className={styles.muted}>
              par <span className={styles.mono}>{entry.author}</span> · <Timestamp iso={entry.at} />
            </span>
          </div>
          {entry.note ? <p className={styles.note}>{entry.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}

/** Exact triggering evidence, timestamps, audit history and the three actions. */
export function AlertDetail({ alert, measurement, patient, onUpdated, headingId, guard }: AlertDetailProps) {
  const rows = measurement ? evidenceRows(measurement, alert.rulesSnapshot) : [];
  const closed = alert.status === "resolved" || alert.status === "rejected";

  return (
    <article className={styles.detail} aria-labelledby={headingId}>
      <header className={styles.head}>
        <div className={styles.badges}>
          <PriorityBadge priority={alert.priority} />
          <Badge tone={closed ? "muted" : "outline"}>{ALERT_STATUS_LABEL[alert.status]}</Badge>
        </div>
        <h2 id={headingId} className={styles.title} tabIndex={-1}>
          {measurement ? `${measurementKindLabel(measurement.kind)} · ${formatMeasurement(measurement)}` : "Alerte"}
        </h2>
        {patient ? (
          <p className={styles.patient}>
            <Icon name="user" size={16} />
            <Link href={patientHref(patient.id, "alerts")}>{patient.displayName}</Link>
            <Badge tone="muted">Patient fictif</Badge>
          </p>
        ) : null}
      </header>

      <section className={styles.block} aria-label="Motif enregistré">
        <h3 className={styles.blockTitle}>Motif enregistré par le moteur de règles</h3>
        <p className={styles.reason}>{alert.reason}</p>
      </section>

      <section className={styles.block} aria-label="Preuve">
        <h3 className={styles.blockTitle}>Preuve</h3>
        {measurement && rows.length > 0 ? (
          <EvidenceTable rows={rows} version={alert.ruleVersion} />
        ) : (
          <p className={styles.muted}>
            Mesure source non chargée dans cette vue : le motif ci-dessus reste la trace enregistrée par le serveur.
          </p>
        )}
        <p className={styles.rule}>
          <span>Version de règle</span>
          <code className={styles.mono}>{alert.ruleVersion}</code>
          <Badge tone="outline" icon="info">
            {DEMO_RULE_LABEL}
          </Badge>
        </p>
      </section>

      <section className={styles.block} aria-label="Horodatages">
        <h3 className={styles.blockTitle}>Horodatages</h3>
        <KeyValueList
          dense
          columns={2}
          items={[
            { label: "Mesurée le", value: <Timestamp iso={measurement?.measuredAt} /> },
            { label: "Saisie sur l’appareil", value: <Timestamp iso={measurement?.capturedAt} /> },
            { label: "Reçue par le serveur", value: <Timestamp iso={measurement?.receivedAt} /> },
            { label: "Alerte créée", value: <Timestamp iso={alert.createdAt} /> },
            { label: "Réception accusée", value: <Timestamp iso={alert.acknowledgedAt} /> },
            { label: "Résolue", value: <Timestamp iso={alert.resolvedAt} /> },
            {
              label: "Source de la mesure",
              value: measurement ? measurementProvenanceLabel(measurement) : "—",
            },
          ]}
        />
        {measurement?.clockWarning ? (
          <p className={styles.warning}>
            <Icon name="clock" size={16} />
            <span>Horloge : {measurement.clockWarning}</span>
          </p>
        ) : null}
      </section>

      <section className={styles.block} aria-label="Actions">
        <h3 className={styles.blockTitle}>Actions</h3>
        <AlertActions key={alert.id} alert={alert} onUpdated={onUpdated} focusAfterId={headingId} guard={guard} />
      </section>

      <section className={styles.block} aria-label="Historique d’audit">
        <h3 className={styles.blockTitle}>Historique d’audit</h3>
        <AlertHistory alert={alert} />
      </section>
    </article>
  );
}
