"use client";

import { Badge, DataTable, EmptyState, StatusBadge, Timestamp, type TableColumn } from "@/components/ui";
import type { Measurement } from "@/lib/client/api";
import {
  formatMeasurement,
  isSimulatedMeasurement,
  isUnscoredMeasurement,
  measurementKindLabel,
  measurementProvenanceLabel,
  measurementQualityLabel,
  measurementStatusLabel,
} from "@/lib/client/format";
import { shortVersion } from "../shared/labels";
import styles from "./Record.module.css";

const COLUMNS: TableColumn<Measurement>[] = [
  {
    key: "measuredAt",
    header: "Mesurée le",
    render: (m) => <Timestamp iso={m.measuredAt} />,
  },
  {
    key: "kind",
    header: "Type",
    render: (m) => measurementKindLabel(m.kind),
  },
  {
    key: "value",
    header: "Valeur",
    numeric: true,
    render: (m) => <strong className={styles.value}>{formatMeasurement(m)}</strong>,
  },
  {
    key: "status",
    header: "Statut (règle)",
    render: (m) => (
      <span className={styles.cellStack}>
        {isUnscoredMeasurement(m) ? (
          <Badge tone="outline" icon="help-circle">
            {measurementStatusLabel(m)}
          </Badge>
        ) : (
          <StatusBadge status={m.status} label={measurementStatusLabel(m)} size="sm" />
        )}
        {measurementQualityLabel(m) ? (
          <Badge tone="outline" icon="alert-triangle">
            {measurementQualityLabel(m)}
          </Badge>
        ) : null}
        <span className={styles.mono} title={m.ruleVersion}>
          {shortVersion(m.ruleVersion)}
        </span>
      </span>
    ),
  },
  {
    key: "captured",
    header: "Saisie / reçue",
    render: (m) => (
      <span className={styles.cellStack}>
        <Timestamp iso={m.capturedAt} label="Saisie" />
        <Timestamp iso={m.receivedAt} label="Reçue" />
      </span>
    ),
  },
  {
    key: "source",
    header: "Source",
    render: (m) =>
      isSimulatedMeasurement(m) ? (
        <Badge tone="outline" icon="info">
          {measurementProvenanceLabel(m)}
        </Badge>
      ) : (
        measurementProvenanceLabel(m)
      ),
  },
  {
    key: "clock",
    header: "Horloge",
    render: (m) =>
      m.clockWarning ? <span className={styles.clockWarning}>{m.clockWarning}</span> : <span className={styles.muted}>—</span>,
  },
];

/** Full measurement log, newest first, with all three timestamps kept distinct. */
export function MeasurementsSection({ measurements }: { measurements: readonly Measurement[] }) {
  if (measurements.length === 0) {
    return (
      <EmptyState
        icon="help-circle"
        title="Aucune mesure : statut inconnu"
        description="Le patient n’a encore transmis aucune mesure. Les mesures en attente sur son appareil n’apparaissent qu’après réception par le serveur."
      />
    );
  }
  const rows = [...measurements].sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));
  return (
    <div className={styles.flushCard}>
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(m) => m.id}
        caption="Mesures reçues par le serveur, des plus récentes aux plus anciennes. Statut évalué par la version de règle indiquée (démonstration)."
        scrollLabel="Tableau des mesures"
      />
    </div>
  );
}
