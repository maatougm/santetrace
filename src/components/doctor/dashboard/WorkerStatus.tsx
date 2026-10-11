"use client";

import { Badge, Notice, Timestamp } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { DASHBOARD_COPY, workerRunningText } from "./dashboard-copy";
import type { WorkerHealth } from "./queue";

interface WorkerStatusProps {
  health: WorkerHealth;
  lang?: Language;
}

/** Visible warning when the monitoring worker has stopped or was never seen. */
export function WorkerStatusNotice({ health, lang = "fr" }: WorkerStatusProps) {
  if (health.state === "running") return null;
  const copy = DASHBOARD_COPY[lang];
  if (health.state === "never") {
    return (
      <Notice tone="info" icon="cloud-off" title={copy.workerNeverTitle}>
        {copy.workerNeverBody}
      </Notice>
    );
  }
  return (
    <Notice tone="info" icon="cloud-off" title={copy.workerStaleTitle}>
      {CARE_COPY[lang].monitoring.workerStale} {copy.workerLastSignal}{" "}
      <Timestamp iso={health.lastSeenAt} format="relative" locale={lang} />.
    </Notice>
  );
}

/** Compact confirmation while the worker is running (true heartbeat age). */
export function WorkerStatusBadge({ health, lang = "fr" }: WorkerStatusProps) {
  if (health.state !== "running") return null;
  return (
    <Badge tone="muted" icon="activity">
      {workerRunningText(health.ageMs, lang)}
    </Badge>
  );
}
