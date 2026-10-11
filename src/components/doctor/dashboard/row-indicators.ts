/**
 * Tiny, true indicators shown under a patient's name in the queue. Nothing is
 * inferred: an unshared section is reported as such, never as zero.
 */
import type { Alert } from "@/lib/client/api";
import type { DoctorQueueSummary } from "@/contracts/patient-platform";
import { alertsDisplay, queueCounters, type QueueCounter, type QueueRow } from "./queue";

/** Unseen ("new") alerts per patient; acknowledged ones were already seen. */
export function newAlertCounts(alerts: readonly Pick<Alert, "patientId" | "status">[]): ReadonlyMap<string, number> {
  const fresh = alerts.filter((alert) => alert.status === "new").map((alert) => alert.patientId);
  return new Map([...new Set(fresh)].map((patientId) => [patientId, fresh.filter((id) => id === patientId).length]));
}

export type NewAlertsIndicator = { state: "not_shared" } | { state: "count"; count: number };

/** New alerts for a row, only where the patient shared the alerts section. */
export function newAlertsIndicator(row: Pick<QueueRow, "patient" | "openAlerts" | "oldestOpenAlertAt">, counts: ReadonlyMap<string, number>): NewAlertsIndicator {
  if (alertsDisplay(row).state === "not_shared") return { state: "not_shared" };
  return { state: "count", count: counts.get(row.patient.id) ?? 0 };
}

const plural = (count: number, one: string, many: string): string => `${count} ${count > 1 ? many : one}`;

function counterText(counter: QueueCounter): string | null {
  if (counter.state === "count" && counter.count > 0) {
    if (counter.key === "clinicalMessages") return plural(counter.count, "message clinique", "messages cliniques");
    if (counter.key === "contactRequests") return plural(counter.count, "demande de contact", "demandes de contact");
    return plural(counter.count, "protocole bloqué", "protocoles bloqués");
  }
  if (counter.state === "proposals" && counter.awaitingReview > 0) {
    return plural(counter.awaitingReview, "proposition à revoir", "propositions à revoir");
  }
  if (counter.state === "plan" && counter.overdue) return "revue du plan en retard";
  return null;
}

/**
 * What waits on this clinician, in French ("2 messages cliniques, revue du
 * plan en retard"), or null when nothing does. Mirrors hasPendingWork:
 * proposals waiting on the patient and unshared sections are not work.
 */
export function pendingWorkSummary(queue: DoctorQueueSummary | null | undefined): string | null {
  const parts = (queueCounters(queue) ?? []).map(counterText).filter((text): text is string => text !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}
