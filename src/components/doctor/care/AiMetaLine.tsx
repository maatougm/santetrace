"use client";

import { Badge, Notice, Timestamp } from "@/components/ui";
import type { AiMeta } from "@/contracts/monitoring";
import { CARE_COPY } from "@/lib/client/copy/care";
import { aiModeBadge } from "./ai-mode-badge";
import { ConsultationProvenance } from "./ConsultationProvenance";
import styles from "./Care.module.css";

const copy = CARE_COPY.fr;

/**
 * How a model-backed result was produced: mode, model, time, the optional
 * medical-consultation provenance (re-validated; nothing shown when absent or
 * malformed), and the fallback when the model failed.
 */
export function AiMetaLine({ meta, fallbackLabel }: { meta: AiMeta; fallbackLabel: string }) {
  // A mode outside the contract renders no badge; the rest of the line still shows.
  const badge = aiModeBadge(meta.mode);
  return (
    <div className={styles.tightStack}>
      <p className={styles.metaLine}>
        {badge ? (
          <Badge tone={badge.tone} icon={badge.icon}>
            {badge.label}
          </Badge>
        ) : null}
        {meta.model ? (
          <span>
            Modèle <bdi className={styles.mono}>{meta.model}</bdi>
          </span>
        ) : null}
        <Timestamp iso={meta.generatedAt} label="Généré le" />
        <span>
          Schéma <bdi className={styles.mono}>{meta.schemaVersion}</bdi> · consigne <bdi className={styles.mono}>{meta.promptVersion}</bdi>
        </span>
      </p>
      <ConsultationProvenance consultation={meta.consultation} />
      {meta.failureReason ? (
        <Notice tone="neutral" icon="info" title={`Repli sans IA : ${copy.aiFailure[meta.failureReason]}`}>
          {fallbackLabel}
        </Notice>
      ) : null}
    </div>
  );
}
