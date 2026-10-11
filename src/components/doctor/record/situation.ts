/**
 * The record's "Situation" as a queue row, so the record and the dashboard
 * share one display rule set (queue.ts: open alerts raise the priority, an
 * unsupported or undated green shows as unknown). The record adds its own
 * stricter cap (care/coverage.ts): a recorded condition without an evaluating
 * profile also blocks green. No worker heartbeat reaches the record, so the
 * dashboard's worker cap cannot apply here.
 */
import type { PatientRecord } from "@/lib/client/api";
import { globalMonitoringView } from "../care/coverage";
import { buildPatientQueue, type QueueRow } from "../dashboard/queue";

export type SituationSource = Pick<PatientRecord, "patient" | "access" | "monitoring" | "alerts" | "evaluations" | "medicalFacts">;

export function recordSituationRow(record: SituationSource): QueueRow {
  const [row] = buildPatientQueue([{ ...record.patient, access: record.access, monitoring: record.monitoring }], record.alerts);
  if (row.priority !== "green") return row;
  const global = globalMonitoringView(record.monitoring, record.evaluations, record.medicalFacts);
  return global.status === "green" ? row : { ...row, priority: "unknown", greenCap: "coverage" };
}

/** Unseen ("new") alerts in the record; acknowledged ones were already seen. */
export function newAlertCount(alerts: PatientRecord["alerts"]): number {
  return alerts.filter((alert) => alert.status === "new").length;
}
