"use client";

import { Badge, Notice, Timestamp } from "@/components/ui";
import { CARE_COPY } from "@/lib/client/copy/care";
import type { WorkerHealth } from "./queue";

/** Visible warning when the monitoring worker has stopped or was never seen. */
export function WorkerStatusNotice({ health }: { health: WorkerHealth }) {
  if (health.state === "running") return null;
  if (health.state === "never") {
    return (
      <Notice tone="info" icon="cloud-off" title="Surveillance automatique jamais vue : évaluations potentiellement périmées">
        Le serveur n’a reçu aucun signal du service de surveillance. Les échéances de suivi, relances et réévaluations
        programmées peuvent ne pas avoir été traitées.
      </Notice>
    );
  }
  return (
    <Notice tone="info" icon="cloud-off" title="Surveillance automatique interrompue : évaluations potentiellement périmées">
      {CARE_COPY.fr.monitoring.workerStale} Dernier signal du service : <Timestamp iso={health.lastSeenAt} format="relative" />.
    </Notice>
  );
}

/** Compact confirmation for the queue header while the worker is running. */
export function WorkerStatusBadge({ health }: { health: WorkerHealth }) {
  if (health.state !== "running") return null;
  return (
    <Badge tone="muted" icon="activity">
      Surveillance automatique active · signal il y a {Math.round(health.ageMs / 1000)} s
    </Badge>
  );
}
