/**
 * Dashboard polling payload: each patient's projection (access, aggregate
 * monitoring, waiting work) and the alerts this clinician may see, from
 * GET /api/dashboard alone. Patient records are not read here: the queue does
 * not display record data, and every record read is journaled for the patient.
 *
 * The fetcher keeps no cache between polls, so a failed or denied dashboard
 * read can never let older data resurface (usePolling clears it on denial).
 */
import { getDashboard, type Alert, type DashboardResponse } from "@/lib/client/api";

export interface DashboardData {
  dashboard: DashboardResponse;
  /** Epoch ms (device clock) when the dashboard answer arrived. */
  receivedAt: number;
}

/** Change signature: priority, rules, authority, waiting work and alert states (not the server clock). */
export function dashboardSignature(dashboard: Pick<DashboardResponse, "patients" | "alerts">): string {
  const patients = dashboard.patients
    .map(
      (p) =>
        `${p.id}:${p.monitoring?.priority ?? "none"}:${p.rules?.version ?? "-"}:${p.access?.authorityRevision ?? "-"}:${JSON.stringify(p.queue ?? null)}`,
    )
    .join("|");
  const alerts = dashboard.alerts.map((a) => `${a.id}:${a.status}`).join("|");
  return `${patients}#${alerts}`;
}

/** Fetcher for the guarded 2 s dashboard poll (create once per signed-in clinician). */
export function createDashboardFetcher(): (signal: AbortSignal) => Promise<DashboardData> {
  return async (signal) => {
    const dashboard = await getDashboard({ signal });
    return { dashboard, receivedAt: Date.now() };
  };
}

/** Immutable replacement of one alert in the dashboard payload. */
export function withUpdatedAlert(data: DashboardData | null, updated: Alert): DashboardData | null {
  if (!data) return data;
  return {
    ...data,
    dashboard: {
      ...data.dashboard,
      alerts: data.dashboard.alerts.map((alert) => (alert.id === updated.id ? updated : alert)),
    },
  };
}
