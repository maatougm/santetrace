"use client";

import { useId, useMemo, type ReactNode } from "react";
import { Badge, DemoLabel, Timestamp, type IconName } from "@/components/ui";
import type { PatientRecord } from "@/lib/client/api";
import { formatMeasurement } from "@/lib/client/format";
import { alertsDisplay, measurementBadgeItems, type MeasurementBadge, type QueueRow } from "../dashboard/queue";
import { hasScope } from "../PatientAccessScope";
import { latestMeasurement } from "../shared/alerts";
import { useNow } from "../shared/hooks";
import { DEMO_RULE_LABEL, LANGUAGE_LABEL } from "../shared/labels";
import { fmtDateTime, fmtRelative } from "../shared/time";
import { AccessScopeNotice } from "./AccessScopeNotice";
import { newAlertCount, recordSituationRow } from "./situation";
import { PriorityCell, ReasonsList } from "./SituationCells";
import styles from "./Situation.module.css";

/** Labels follow the reading (texts from the shared format helpers): simulated, suspect, unscored. */
const BADGE_ICON: Record<MeasurementBadge, IconName> = {
  simulated: "activity",
  suspect: "help-circle",
  unscored: "help-circle",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function LatestMeasurement({ record }: { record: PatientRecord }) {
  const now = useNow(15_000);
  if (!hasScope(record, "measurements")) return <span className={styles.muted}>Mesures non partagées</span>;
  const latest = latestMeasurement(record.measurements);
  if (!latest) return <span className={styles.muted}>Aucune mesure reçue</span>;
  const badges = measurementBadgeItems(latest);
  return (
    <>
      <strong className={styles.value}>{formatMeasurement(latest)}</strong>
      <span className={styles.muted} title={fmtDateTime(latest.measuredAt)}>
        {fmtRelative(latest.measuredAt, now)}
      </span>
      {badges.length > 0 ? (
        <span className={styles.chips}>
          {badges.map((badge) => (
            <Badge key={badge.key} tone="outline" icon={BADGE_ICON[badge.key]}>
              {badge.label}
            </Badge>
          ))}
        </span>
      ) : null}
    </>
  );
}

/** Open alerts only where the alerts section is shared; "non partagées" is never shown as 0. */
function OpenAlerts({ row, fresh }: { row: QueueRow; fresh: number }) {
  const display = alertsDisplay(row);
  if (display.state === "not_shared") return <span className={styles.muted}>Alertes non partagées</span>;
  if (display.count === 0) return <strong className={styles.value}>0</strong>;
  return (
    <>
      <strong className={styles.value}>{display.count}</strong>
      <span className={styles.muted}>
        dont {fresh} nouvelle{fresh > 1 ? "s" : ""}
      </span>
      {display.oldestAt ? (
        <span className={styles.muted}>
          <Timestamp iso={display.oldestAt} format="relative" label="La plus ancienne" />
        </span>
      ) : null}
    </>
  );
}

function RulesFacts({ rules }: { rules: PatientRecord["patient"]["rules"] }) {
  return (
    <>
      <Fact label="Règles en vigueur">
        {rules ? (
          <>
            <code className={styles.mono} title={rules.version}>
              {rules.version}
            </code>
            <Badge tone="outline">{DEMO_RULE_LABEL}</Badge>
          </>
        ) : (
          <Badge tone="muted" icon="lock">
            Non partagées
          </Badge>
        )}
      </Fact>
      <Fact label="Retard toléré">
        <strong className={styles.value}>{rules ? `${rules.overdueHours} h` : "—"}</strong>
      </Fact>
    </>
  );
}

/**
 * What the dashboard queue no longer shows, in one compact card: displayed
 * priority (same caps as the queue, plus the record's coverage cap), reasons,
 * identity facts, latest reading with its labels, open alerts, rules and access.
 */
export function SituationCard({ record }: { record: PatientRecord }) {
  const titleId = useId();
  const row = useMemo(() => recordSituationRow(record), [record]);
  const { patient } = record;
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          Situation
        </h2>
        <DemoLabel>Patient fictif</DemoLabel>
      </div>
      <div className={styles.grid}>
        <div className={styles.block}>
          <h3 className={styles.label}>Urgence</h3>
          <PriorityCell row={row} />
        </div>
        <div className={styles.block}>
          <h3 className={styles.label}>Raisons (serveur)</h3>
          <ReasonsList row={row} />
        </div>
      </div>
      <dl className={styles.facts}>
        <Fact label="Patient">
          {patient.age} ans · {patient.region} · {LANGUAGE_LABEL[patient.language]}
        </Fact>
        <Fact label="Dernière mesure">
          <LatestMeasurement record={record} />
        </Fact>
        <Fact label="Alertes ouvertes">
          <OpenAlerts row={row} fresh={newAlertCount(record.alerts)} />
        </Fact>
        <RulesFacts rules={patient.rules} />
      </dl>
      {record.access.owner ? null : (
        <div className={styles.access}>
          <h3 className={styles.label}>Votre accès</h3>
          <AccessScopeNotice access={record.access} />
        </div>
      )}
    </section>
  );
}
