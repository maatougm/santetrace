/**
 * Care-team wording decisions (spec 006 FR-027, root QA item 9).
 *
 * A measurement result, delivery trail, history line or status text may only
 * mention a care team ("équipe soignante") when an accepted doctor can see the
 * patient's alerts (`careTeam.status === "present"`). With no such doctor it
 * says so plainly; when the app cannot tell ("unknown": loading, offline,
 * refused) it says it cannot confirm, and never implies anyone received or
 * viewed anything. A clinician action already recorded by the server
 * (acknowledged/resolved/rejected) is shown from that server data alone.
 */
import type { Alert } from "@/contracts/care";
import type { EvaluatedStatus } from "@/lib/client/api";
import type { Messages } from "@/lib/client/i18n";
import type { CareTeamStatus } from "../useCareTeam";

/** Evidence that a clinician acted on the alert, from server data only. */
export function alertSeenAt(alert: Alert): string | null {
  if (alert.acknowledgedAt) return alert.acknowledgedAt;
  if (alert.status === "resolved") return alert.resolvedAt ?? null;
  if (alert.status === "rejected" || alert.status === "acknowledged") {
    const lastAction = alert.history?.[alert.history.length - 1];
    return lastAction?.at ?? null;
  }
  return null;
}

export function isAlertSeen(alert: Pick<Alert, "status">): boolean {
  return alert.status !== "new";
}

export interface CareStep {
  label: string;
  at: string | null;
  done: boolean;
  /** Show "pas encore": only for a step that can still happen. */
  waiting: boolean;
}

/** Third delivery step for a measurement's alert; null when it must be omitted. */
export function deliveryCareStep(team: CareTeamStatus, alert: Alert | null, t: Messages): CareStep | null {
  if (!alert) return null;
  if (isAlertSeen(alert) || team === "present") {
    const done = isAlertSeen(alert);
    return { label: t.delivery.careTeam, at: alertSeenAt(alert), done, waiting: !done };
  }
  // "Nobody has access" is a fact about now, not a step still to come.
  return team === "none" ? { label: t.noReferent.deliveryStep, at: null, done: false, waiting: false } : null;
}

export interface ReceiptNotes {
  notes: string[];
  /** Offer the doctor invitation (/patient/doctors). */
  invite: boolean;
}

/** Notes under a measurement received by the server. */
export function receiptNotes(team: CareTeamStatus, alert: Pick<Alert, "status"> | null, t: Messages): ReceiptNotes {
  const newAlert = alert?.status === "new";
  if (team === "present") {
    return { notes: [...(newAlert ? [t.measure.result.alertCreated] : []), t.measure.result.receivedNote], invite: false };
  }
  if (team === "none") {
    return { notes: [...(newAlert ? [t.noReferent.alertCreated] : []), t.noReferent.receivedNote], invite: true };
  }
  return { notes: [t.noReferent.unknownTeam], invite: false };
}

/** History line for a measurement's alert. */
export function historyAlertText(team: CareTeamStatus, alert: Pick<Alert, "status">, t: Messages): string {
  if (isAlertSeen(alert) || team === "present") return t.history.alert[alert.status];
  return team === "none" ? t.noReferent.historyAlertOpen : t.outbox.state.server_received;
}

/** Home status explanation for an orange/red server status. */
export function statusExplainText(team: CareTeamStatus, status: Exclude<EvaluatedStatus, "green">, t: Messages): string {
  if (team === "present") return t.status.explain[status];
  if (team === "none") return status === "red" ? t.noReferent.statusRed : t.noReferent.statusOrange;
  // The fixed red guidance names no care team and is kept.
  return status === "red" ? t.status.explain.red : t.noReferent.unknownTeam;
}
