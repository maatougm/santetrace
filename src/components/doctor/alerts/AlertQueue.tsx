"use client";

import { Badge, Icon, PriorityBadge } from "@/components/ui";
import type { Alert, Measurement } from "@/lib/client/api";
import { formatMeasurement } from "@/lib/client/format";
import { useNow } from "../shared/hooks";
import { ALERT_STATUS_LABEL, shortVersion } from "../shared/labels";
import { fmtDateTime, fmtRelative } from "../shared/time";
import styles from "./AlertQueue.module.css";

interface AlertQueueProps {
  /** Already ordered by the caller (see sortAlertQueue). */
  alerts: readonly Alert[];
  selectedId: string | null;
  onSelect: (alertId: string) => void;
  patientNames?: ReadonlyMap<string, string>;
  measurements?: ReadonlyMap<string, Measurement>;
  ariaLabel: string;
}

/** Selectable alert rows: textual priority, status, reason, patient, times, rule version. */
export function AlertQueue({ alerts, selectedId, onSelect, patientNames, measurements, ariaLabel }: AlertQueueProps) {
  const now = useNow(15_000);
  return (
    <ul className={styles.list} aria-label={ariaLabel}>
      {alerts.map((alert) => {
        const measurement = alert.measurementId ? measurements?.get(alert.measurementId) : undefined;
        const patientName = patientNames?.get(alert.patientId);
        const selected = alert.id === selectedId;
        const open = alert.status === "new" || alert.status === "acknowledged";
        return (
          <li key={alert.id}>
            <button
              type="button"
              className={styles.row}
              data-priority={open ? alert.priority : undefined}
              data-status={alert.status}
              aria-pressed={selected}
              onClick={() => onSelect(alert.id)}
            >
              <span className={styles.badges}>
                <PriorityBadge priority={alert.priority} size="sm" />
                <Badge tone={alert.status === "new" ? "outline" : "muted"}>{ALERT_STATUS_LABEL[alert.status]}</Badge>
              </span>
              <span className={styles.main}>
                <span className={styles.headline}>
                  {patientName ? <span className={styles.patient}>{patientName}</span> : null}
                  {measurement ? <span className={styles.value}>{formatMeasurement(measurement)}</span> : null}
                </span>
                <span className={styles.reason}>{alert.reason}</span>
                <span className={styles.meta}>
                  <span>
                    Mesure : {measurement ? fmtDateTime(measurement.measuredAt) : "non chargée"}
                  </span>
                  <span>Alerte {fmtRelative(alert.createdAt, now)}</span>
                  <span title={alert.ruleVersion}>Règle {shortVersion(alert.ruleVersion)} (démo)</span>
                </span>
              </span>
              <Icon name="chevron-right" size={18} className={styles.chevron} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
