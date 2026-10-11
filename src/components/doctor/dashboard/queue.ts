/**
 * Clinician priority queue. The server decides each patient's aggregate
 * priority and coverage; this module only orders the rows and refuses to show
 * a reassuring green the server data does not support. It never lowers a
 * server priority and never re-evaluates rules.
 */
import type { AccessEnvelope, Alert, DashboardPatient, Measurement, MonitoringState, Status } from "@/lib/client/api";
import type { Coverage } from "@/contracts/monitoring";
import { SHARING_SCOPES, type DoctorQueueSummary, type QueueBucket, type Relationship, type SharingScope } from "@/contracts/patient-platform";
import { CARE_COPY } from "@/lib/client/copy/care";
import { displayableEvaluationTime, reasonText, type ReasonText } from "@/lib/client/copy/reasons";
import {
  isSimulatedMeasurement,
  isSuspectMeasurement,
  isUnscoredMeasurement,
  measurementQualityLabel,
  measurementSourceLabel,
  statusLabel,
  statusRank,
} from "@/lib/client/format";
import { isOpenAlert } from "../shared/alerts";

/** The worker wakes every 15 s and recovers leases after 60 s (contract). */
export const WORKER_STALE_MS = 60_000;

/** Complete only when the server listed coverage and every entry is "complete". */
export function isCoverageComplete(coverage: readonly Coverage[] | null | undefined): boolean {
  return Boolean(coverage && coverage.length > 0 && coverage.every((entry) => entry === "complete"));
}

/**
 * Chip text for one entry of a patient's aggregate coverage. In the aggregate,
 * "unsupported" means some limits are not assessed (e.g. [unsupported,
 * complete]), not that monitoring is unavailable; the per-condition wording
 * (monitoring.unsupportedCondition, coverage.unsupported) stays for cards.
 */
export function aggregateCoverageLabel(entry: Coverage): string {
  return entry === "unsupported" ? CARE_COPY.fr.monitoring.partialCoverage : CARE_COPY.fr.coverage[entry];
}

export type MeasurementBadge = "simulated" | "suspect" | "unscored";

/**
 * Labels that must follow a reading wherever it is shown: simulated origin, a
 * suspect signal (excluded from the rules) and an unscored kind (pulse).
 */
export function measurementBadges(measurement: Measurement): MeasurementBadge[] {
  const badges: MeasurementBadge[] = [];
  if (isSimulatedMeasurement(measurement)) badges.push("simulated");
  if (isSuspectMeasurement(measurement)) badges.push("suspect");
  if (isUnscoredMeasurement(measurement)) badges.push("unscored");
  return badges;
}

/** Badges with their French text, taken from the shared format helpers (same wording everywhere). */
export function measurementBadgeItems(measurement: Measurement): { key: MeasurementBadge; label: string }[] {
  const label = (badge: MeasurementBadge): string => {
    if (badge === "simulated") return measurementSourceLabel("simulated", "fr");
    if (badge === "suspect") return measurementQualityLabel(measurement, "fr") ?? "";
    return "Non évalué (aucun profil de suivi)";
  };
  return measurementBadges(measurement).map((key) => ({ key, label: label(key) }));
}

/** Why a server green cannot be shown as green. */
export type GreenCap = "coverage" | "not_evaluated" | "worker";

export function greenCap(monitoring: MonitoringState | null | undefined, workerRunning = true): GreenCap | null {
  if (monitoring?.priority !== "green") return null;
  if (!isCoverageComplete(monitoring.coverage)) return "coverage";
  if (!evaluatedAtOrNull(monitoring.evaluatedAt)) return "not_evaluated";
  return workerRunning ? null : "worker";
}

/**
 * Priority shown for a patient: the server aggregate, raised to the priority
 * of any open alert (an open episode stays visible until explicitly resolved),
 * and downgraded from green to unknown when coverage is incomplete, the
 * evaluation is undated, or the monitoring worker is not running.
 */
export function displayPriority(
  monitoring: MonitoringState | null | undefined,
  openAlerts: readonly Pick<Alert, "priority">[],
  workerRunning = true,
): Status {
  let priority: Status = monitoring?.priority ?? "unknown";
  if (greenCap(monitoring, workerRunning)) priority = "unknown";
  for (const alert of openAlerts) {
    if (statusRank(alert.priority) < statusRank(priority)) priority = alert.priority;
  }
  return priority;
}

export interface QueueRow {
  patient: DashboardPatient;
  /** Display priority (see displayPriority). */
  priority: Status;
  /** The server said green but it is shown as unknown, and why. */
  greenCap: GreenCap | null;
  openAlerts: number;
  openRed: boolean;
  /** An open (new or acknowledged) orange alert: clinical work, never below administrative work. */
  openOrange: boolean;
  oldestOpenAlertAt: string | null;
  /** Oldest visible open alert of the row's displayed priority (red or orange); null otherwise. */
  oldestTierAlertAt: string | null;
  /** Something waits on this clinician (see hasPendingWork). Never changes the priority. */
  pendingWork: boolean;
  /** Server's oldest waiting item, only when pendingWork. */
  oldestPendingAt: string | null;
}

const waiting = (bucket: QueueBucket | null | undefined): boolean => (bucket?.count ?? 0) > 0;

/**
 * Work waiting on the clinician: clinical messages, contact requests,
 * proposals awaiting review, an overdue plan review, blocked protocols.
 * Proposals that need patient inputs wait on the patient, not the doctor.
 * Unshared (null) sections are unknown, never counted as work or as zero.
 */
export function hasPendingWork(queue: DoctorQueueSummary | null | undefined): boolean {
  if (!queue) return false;
  return (
    waiting(queue.clinicalMessages) ||
    waiting(queue.contactRequests) ||
    (queue.proposals?.awaitingReview ?? 0) > 0 ||
    queue.planReview?.overdue === true ||
    waiting(queue.blockedProtocols)
  );
}

export type QueueCounter =
  | { key: "clinicalMessages" | "contactRequests" | "blockedProtocols" | "proposals" | "planReview"; state: "not_shared" }
  | { key: "clinicalMessages" | "contactRequests" | "blockedProtocols"; state: "count"; count: number; oldestAt: string | null }
  | { key: "proposals"; state: "proposals"; awaitingReview: number; needsInputs: number; oldestAt: string | null }
  | { key: "planReview"; state: "plan"; overdue: boolean; dueAt: string | null };

function bucketCounter(key: "clinicalMessages" | "contactRequests" | "blockedProtocols", bucket: QueueBucket | null): QueueCounter {
  return bucket ? { key, state: "count", count: bucket.count, oldestAt: bucket.oldestAt } : { key, state: "not_shared" };
}

/** Per-row counters; null when the server sent no queue summary at all. */
export function queueCounters(queue: DoctorQueueSummary | null | undefined): QueueCounter[] | null {
  if (!queue) return null;
  const { proposals, planReview } = queue;
  return [
    bucketCounter("clinicalMessages", queue.clinicalMessages),
    bucketCounter("contactRequests", queue.contactRequests),
    proposals
      ? { key: "proposals", state: "proposals", awaitingReview: proposals.awaitingReview, needsInputs: proposals.needsInputs, oldestAt: proposals.oldestAt }
      : { key: "proposals", state: "not_shared" },
    planReview ? { key: "planReview", state: "plan", overdue: planReview.overdue, dueAt: planReview.dueAt } : { key: "planReview", state: "not_shared" },
    bucketCounter("blockedProtocols", queue.blockedProtocols),
  ];
}

function timeOrInfinity(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function oldest(alerts: readonly Alert[]): string | null {
  return alerts.reduce<string | null>(
    (current, alert) => (timeOrInfinity(alert.createdAt) < timeOrInfinity(current) ? alert.createdAt : current),
    null,
  );
}

function toRow(patient: DashboardPatient, alerts: readonly Alert[], workerRunning: boolean): QueueRow {
  const open = alerts.filter((alert) => alert.patientId === patient.id && isOpenAlert(alert));
  const priority = displayPriority(patient.monitoring, open, workerRunning);
  const pendingWork = hasPendingWork(patient.queue);
  const red = open.filter((alert) => alert.priority === "red");
  const orange = open.filter((alert) => alert.priority === "orange");
  return {
    patient,
    priority,
    greenCap: priority === "unknown" ? greenCap(patient.monitoring, workerRunning) : null,
    openAlerts: open.length,
    openRed: red.length > 0,
    openOrange: orange.length > 0,
    oldestOpenAlertAt: oldest(open),
    oldestTierAlertAt: priority === "red" ? oldest(red) : priority === "orange" ? oldest(orange) : null,
    pendingWork,
    oldestPendingAt: pendingWork ? (patient.queue?.oldestPendingAt ?? null) : null,
  };
}

/** Earlier first; missing or unreadable times last; 0 when equal or both missing. */
function compareTimes(a: string | null, b: string | null): number {
  const delta = timeOrInfinity(a) - timeOrInfinity(b);
  return delta !== 0 && !Number.isNaN(delta) ? (delta < 0 ? -1 : 1) : 0;
}

/**
 * 0 displayed red, 1 displayed orange, 2 other work waiting on the clinician,
 * 3 everyone else. The displayed priority already includes visible open
 * alerts (an open red episode stays red), and a status shared without its
 * alerts still ranks by that status: no hidden alert is inferred.
 */
function tier(row: QueueRow): number {
  if (row.priority === "red") return 0;
  if (row.priority === "orange") return 1;
  return row.pendingWork ? 2 : 3;
}

function compareRows(a: QueueRow, b: QueueRow): number {
  const byTier = tier(a) - tier(b);
  if (byTier !== 0) return byTier;
  // Red/orange tiers: a visible open episode first, oldest first.
  const episode = tier(a) < 2 ? compareTimes(a.oldestTierAlertAt, b.oldestTierAlertAt) : 0;
  if (episode !== 0) return episode;
  if (a.pendingWork !== b.pendingWork) return a.pendingWork ? -1 : 1;
  const pending = a.pendingWork ? compareTimes(a.oldestPendingAt, b.oldestPendingAt) : 0;
  if (pending !== 0) return pending;
  const rank = statusRank(a.priority) - statusRank(b.priority);
  if (rank !== 0) return rank;
  return a.patient.displayName.localeCompare(b.patient.displayName, "fr");
}

/**
 * Returns new rows in four tiers: displayed red (visible open red episode
 * first, oldest first), displayed orange (likewise), other work waiting on the
 * clinician (oldest waiting item first), then everyone else by display
 * priority (unknown above green). Inside a tier, waiting work comes first,
 * then name. Tiers only order rows: they never change a priority or its
 * colour, and a row keeps its pending counters.
 */
export function buildPatientQueue(
  patients: readonly DashboardPatient[],
  alerts: readonly Alert[],
  workerRunning = true,
): QueueRow[] {
  return patients.map((patient) => toRow(patient, alerts, workerRunning)).sort(compareRows);
}

function shares(access: AccessEnvelope | null | undefined, scope: SharingScope): boolean {
  return Boolean(access?.owner || access?.scopes.includes(scope));
}

export type AlertsDisplay = { state: "not_shared" } | { state: "count"; count: number; oldestAt: string | null };

/** Open alerts are counted only where the alerts section is shared; otherwise "non partagé", never 0. */
export function alertsDisplay(row: Pick<QueueRow, "patient" | "openAlerts" | "oldestOpenAlertAt">): AlertsDisplay {
  if (!shares(row.patient.access, "alerts")) return { state: "not_shared" };
  return { state: "count", count: row.openAlerts, oldestAt: row.oldestOpenAlertAt };
}

export interface PriorityDisplay {
  /** Unchanged display priority (the colour). */
  status: Status;
  label: string;
  /** False when the patient did not share the monitoring status: nothing was evaluated for this doctor. */
  monitoringShared: boolean;
}

export function priorityDisplay(row: Pick<QueueRow, "patient" | "priority">): PriorityDisplay {
  const monitoringShared = shares(row.patient.access, "status");
  return { status: row.priority, label: monitoringShared ? statusLabel(row.priority) : "Statut non partagé", monitoringShared };
}

/** Server sentinel (epoch 0), pre-2000 or unreadable value: not yet evaluated (shared rule with patient screens). */
export function evaluatedAtOrNull(iso: string | null | undefined): string | null {
  return displayableEvaluationTime(iso);
}

/** First `limit` server reasons for the queue, in French when known (untranslated ones are flagged), plus the rest count. */
export function queueReasons(reasons: readonly string[], limit: number): { shown: ReasonText[]; hidden: number } {
  return {
    shown: reasons.slice(0, limit).map((reason) => reasonText(reason, "fr")),
    hidden: Math.max(0, reasons.length - limit),
  };
}

export type WorkerHealth =
  | { state: "running"; lastSeenAt: string; ageMs: number }
  | { state: "stale"; lastSeenAt: string; ageMs: number }
  | { state: "never" };

export function workerHealth(
  heartbeat: string | null | undefined,
  referenceMs: number,
  thresholdMs: number = WORKER_STALE_MS,
): WorkerHealth {
  // Same sentinel rule as evaluations: "never", not "stale since 1970".
  const lastSeenAt = evaluatedAtOrNull(heartbeat);
  if (!lastSeenAt) return { state: "never" };
  const seen = Date.parse(lastSeenAt);
  const ageMs = Math.max(0, referenceMs - seen);
  return { state: ageMs > thresholdMs ? "stale" : "running", lastSeenAt, ageMs };
}

/**
 * "Now" on the server clock: its answer time plus what elapsed locally since,
 * so a skewed device clock cannot hide a stopped worker.
 */
export function referenceTimeMs(serverTime: string | null | undefined, receivedAtMs: number | null, nowMs: number): number {
  const server = serverTime ? Date.parse(serverTime) : Number.NaN;
  if (Number.isNaN(server) || receivedAtMs === null) return nowMs;
  return server + Math.max(0, nowMs - receivedAtMs);
}

export interface AccessSummary {
  relationship: Relationship | null;
  /** Granted scopes in canonical order. */
  scopes: SharingScope[];
  missing: SharingScope[];
  /** Anything short of full primary care authority. */
  limited: boolean;
  canManageCare: boolean;
}

export function accessSummary(access: AccessEnvelope | null | undefined): AccessSummary {
  const granted = new Set(access?.scopes ?? []);
  const scopes = SHARING_SCOPES.filter((scope) => granted.has(scope));
  const missing = SHARING_SCOPES.filter((scope) => !granted.has(scope));
  const canManageCare = access?.canManageCare === true;
  return {
    relationship: access?.relationship ?? null,
    scopes,
    missing,
    limited: !canManageCare || missing.length > 0,
    canManageCare,
  };
}
