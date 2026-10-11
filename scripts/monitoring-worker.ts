import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { CareStore } from "../src/lib/care-store";
import { MonitoringWorker } from "../src/lib/monitoring-worker";
import { PatientAccountService } from "../src/lib/patient-account-service";

async function main() {
  const workerId = process.env.HACKCURE_WORKER_ID || `local-${randomUUID()}`;
  const store = new CareStore(), worker = new MonitoringWorker(store), controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    // Reconcile configured clinician authority even when no HTTP request has run.
    await new PatientAccountService(store).initialize();
    while (!controller.signal.aborted) {
      try { console.log(JSON.stringify({ kind: "monitoring_tick", workerId, ...await worker.tick(new Date().toISOString(), workerId) })); }
      catch { console.error(JSON.stringify({ kind: "monitoring_tick_failed", workerId, at: new Date().toISOString() })); }
      try { await pause(15000, undefined, { signal: controller.signal }); } catch { if (!controller.signal.aborted) throw new Error("Worker interval failed"); }
    }
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); store.close(); }
}
void main().catch(() => { console.error("Monitoring worker failed to initialize."); process.exitCode = 1; });
