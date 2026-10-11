/**
 * Alert queue ordering and evidence rows. The server decides priority and
 * status; this module only orders what it returned and lays out the stored
 * rule snapshot next to the stored measurement, without re-evaluating rules.
 */
import type { Alert, Measurement, Rules } from "@/lib/client/api";

export function isOpenAlert(alert: Pick<Alert, "status">): boolean {
  return alert.status === "new" || alert.status === "acknowledged";
}

/**
 * Queue rank: red new, red acknowledged, orange new, orange acknowledged, closed.
 * Severity comes before lifecycle because acknowledging an alert only records
 * that it was seen: the patient is not yet contacted and the alert stays open.
 */
function queueRank(alert: Pick<Alert, "status" | "priority">): number {
  if (!isOpenAlert(alert)) return 4;
  const severity = alert.priority === "red" ? 0 : 2;
  return severity + (alert.status === "new" ? 0 : 1);
}

/** Unreadable timestamps sort as oldest, so they never jump ahead of dated alerts. */
function createdTime(alert: Pick<Alert, "createdAt">): number {
  const time = Date.parse(alert.createdAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Returns a new array: open alerts by severity, then lifecycle, then most recent first. */
export function sortAlertQueue<T extends Pick<Alert, "status" | "priority" | "createdAt">>(alerts: readonly T[]): T[] {
  return [...alerts].sort((a, b) => {
    const rank = queueRank(a) - queueRank(b);
    if (rank !== 0) return rank;
    const timeA = createdTime(a);
    const timeB = createdTime(b);
    return timeA === timeB ? 0 : timeB > timeA ? 1 : -1;
  });
}

export interface OpenAlertCount {
  /** Every open alert of this priority, acknowledged or not. */
  total: number;
  new: number;
  acknowledged: number;
}

export interface OpenAlertSummary {
  red: OpenAlertCount;
  orange: OpenAlertCount;
}

/** Open alerts per priority. Acknowledged alerts still count: they are not resolved. */
export function summarizeOpenAlerts(alerts: readonly Pick<Alert, "status" | "priority">[]): OpenAlertSummary {
  const count = (priority: Alert["priority"]): OpenAlertCount => {
    const open = alerts.filter((a) => a.priority === priority && isOpenAlert(a));
    const fresh = open.filter((a) => a.status === "new").length;
    return { total: open.length, new: fresh, acknowledged: open.length - fresh };
  };
  return { red: count("red"), orange: count("orange") };
}

export interface EvidenceRow {
  key: string;
  label: string;
  /** Value exactly as recorded, with its own unit. */
  value: number;
  unit: string;
  warn: number;
  high: number;
  thresholdUnit: string;
  /** False when units differ: the server converted, the UI does not. */
  comparable: boolean;
}

/**
 * Rows pairing the recorded value with the thresholds of the rule snapshot that
 * produced the alert. Comparator is always "≥" in the backend rules.
 */
export function evidenceRows(measurement: Measurement, rules: Rules): EvidenceRow[] {
  if (measurement.kind === "blood_pressure") {
    const rows: EvidenceRow[] = [];
    if (typeof measurement.systolic === "number") {
      rows.push({
        key: "systolic",
        label: "Systolique",
        value: measurement.systolic,
        unit: "mmHg",
        warn: rules.systolicWarn,
        high: rules.systolicHigh,
        thresholdUnit: "mmHg",
        comparable: true,
      });
    }
    if (typeof measurement.diastolic === "number") {
      rows.push({
        key: "diastolic",
        label: "Diastolique",
        value: measurement.diastolic,
        unit: "mmHg",
        warn: rules.diastolicWarn,
        high: rules.diastolicHigh,
        thresholdUnit: "mmHg",
        comparable: true,
      });
    }
    return rows;
  }
  if (typeof measurement.value !== "number") return [];
  return [
    {
      key: "glucose",
      label: "Glycémie",
      value: measurement.value,
      unit: measurement.unit,
      warn: rules.glucoseWarn,
      high: rules.glucoseHigh,
      thresholdUnit: rules.glucoseUnit,
      comparable: measurement.unit === rules.glucoseUnit,
    },
  ];
}

/** Which threshold of the snapshot the recorded value reaches (same unit only). */
export function crossedLevel(row: EvidenceRow): "red" | "orange" | "none" | "not_comparable" {
  if (!row.comparable) return "not_comparable";
  if (row.value >= row.high) return "red";
  if (row.value >= row.warn) return "orange";
  return "none";
}

export function countOpenByPatient(alerts: readonly Alert[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const alert of alerts) {
    if (isOpenAlert(alert)) counts.set(alert.patientId, (counts.get(alert.patientId) ?? 0) + 1);
  }
  return counts;
}

/** Immutable replacement of one alert inside a list. */
export function replaceAlert<T extends { id: string }>(list: readonly T[], updated: T): T[] {
  return list.map((item) => (item.id === updated.id ? updated : item));
}

export function latestMeasurement(measurements: readonly Measurement[]): Measurement | null {
  return measurements.reduce<Measurement | null>((latest, current) => {
    if (!latest) return current;
    return Date.parse(current.measuredAt) > Date.parse(latest.measuredAt) ? current : latest;
  }, null);
}
