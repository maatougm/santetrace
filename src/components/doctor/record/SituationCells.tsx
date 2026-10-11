"use client";

import { Badge, StatusBadge, Timestamp } from "@/components/ui";
import type { MonitoringState } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { UNTRANSLATED_REASON } from "@/lib/client/copy/reasons";
import {
  accessSummary,
  aggregateCoverageLabel,
  evaluatedAtOrNull,
  priorityDisplay,
  queueReasons,
  type GreenCap,
  type QueueRow,
} from "../dashboard/queue";
import styles from "./Situation.module.css";

const care = CARE_COPY.fr;

const GREEN_CAP_TEXT: Record<GreenCap, string> = {
  coverage: care.monitoring.notGreenBecause,
  not_evaluated: "Pas de vert : pas encore évalué.",
  worker: "Pas de vert : surveillance automatique interrompue, évaluation possiblement périmée.",
};

function CoverageChips({ monitoring }: { monitoring: MonitoringState | null | undefined }) {
  if (!monitoring) {
    return (
      <Badge tone="outline" icon="help-circle">
        Non évalué
      </Badge>
    );
  }
  if (monitoring.coverage.length === 0) {
    return (
      <Badge tone="outline" icon="help-circle">
        Couverture non renseignée
      </Badge>
    );
  }
  return (
    <span className={styles.chips}>
      {[...new Set(monitoring.coverage)].map((coverage) => (
        <Badge key={coverage} tone={coverage === "complete" ? "muted" : "outline"} icon={coverage === "complete" ? "check" : "help-circle"}>
          {aggregateCoverageLabel(coverage)}
        </Badge>
      ))}
    </span>
  );
}

/** Displayed priority with its coverage and evaluation time: never a bare colour. */
export function PriorityCell({ row }: { row: QueueRow }) {
  const monitoring = row.patient.monitoring;
  const evaluatedAt = evaluatedAtOrNull(monitoring?.evaluatedAt);
  const display = priorityDisplay(row);
  if (!display.monitoringShared) {
    return (
      <span className={styles.cellStack}>
        <StatusBadge status={display.status} label={display.label} size="md" />
        <span className={styles.muted}>Le patient n’a pas partagé le statut de suivi avec vous.</span>
      </span>
    );
  }
  return (
    <span className={styles.cellStack}>
      <StatusBadge status={display.status} label={display.label} size="md" />
      {row.openRed ? <span className={styles.flag}>{care.monitoring.redOpenTitle} : reste prioritaire jusqu’à résolution</span> : null}
      {row.greenCap ? <span className={styles.muted}>{GREEN_CAP_TEXT[row.greenCap]}</span> : null}
      <CoverageChips monitoring={monitoring} />
      {evaluatedAt ? (
        <span className={styles.muted}>
          <Timestamp iso={evaluatedAt} format="relative" label="Évalué" />
        </span>
      ) : (
        <span className={styles.muted}>Pas encore évalué</span>
      )}
    </span>
  );
}

/** Every server reason, in French when known; an untranslated one stays verbatim (lang="en") and is flagged. */
export function ReasonsList({ row }: { row: QueueRow }) {
  const monitoring = row.patient.monitoring;
  if (!priorityDisplay(row).monitoringShared) return <span className={styles.muted}>Non partagées</span>;
  if (!monitoring) return <span className={styles.muted}>Aucune évaluation reçue</span>;
  if (monitoring.reasons.length === 0) {
    const { scopes } = accessSummary(row.patient.access);
    return (
      <span className={styles.muted}>
        {scopes.includes("summary") ? "Aucune raison fournie" : "Raisons non partagées (accès limité)"}
      </span>
    );
  }
  const { shown } = queueReasons(monitoring.reasons, monitoring.reasons.length);
  return (
    <ul className={styles.reasons}>
      {shown.map((reason, index) =>
        reason.translated ? (
          <li key={`${index}-${reason.text}`}>{reason.text}</li>
        ) : (
          <li key={`${index}-${reason.text}`}>
            <span lang="en">{reason.text}</span> <span className={styles.muted}>({UNTRANSLATED_REASON.fr})</span>
          </li>
        ),
      )}
    </ul>
  );
}
