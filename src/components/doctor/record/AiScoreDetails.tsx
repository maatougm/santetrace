"use client";

/**
 * A genuine estimate: value /100, date, model string, optional consultation
 * provenance (only when returned and valid), real sources and the server's limitations.
 */
import { Badge, Timestamp } from "@/components/ui";
import type { PatientRecord } from "@/lib/client/api";
import type { AiCaseScore } from "@/lib/client/doctor-api";
import { ConsultationProvenance } from "../care/ConsultationProvenance";
import { fmtDateTime } from "../shared/time";
import { limitationText, scoreSourceItems, type ScoreSourceItem } from "./ai-case-score-view";
import styles from "./AiCaseScore.module.css";

function SourceItem({ item }: { item: ScoreSourceItem }) {
  if (item.kind === "unresolved") {
    return (
      <li className={styles.source}>
        <code className={styles.sourceId}>{item.id}</code>
        <span className={styles.muted}>Source non visible dans ce dossier</span>
      </li>
    );
  }
  return (
    <li className={styles.source}>
      <span className={styles.sourceKind}>{item.kind === "measurement" ? "Mesure" : "Information médicale"}</span>
      <strong>{item.label}</strong>
      {item.kind === "measurement" ? (
        <>
          <span className={styles.muted}>{fmtDateTime(item.at)}</span>
          {item.badges.map((badge) => (
            <Badge key={badge.key} tone="outline" icon="help-circle">
              {badge.label}
            </Badge>
          ))}
        </>
      ) : null}
    </li>
  );
}

export function AiScoreDetails({ score, cached, record }: { score: AiCaseScore; cached: boolean; record: PatientRecord }) {
  const sources = scoreSourceItems(score.sourceIds, record);
  return (
    <div className={styles.details}>
      <p className={styles.value}>
        <data value={score.value}>{score.value}</data>
        <span className={styles.outOf}>/100</span>
      </p>
      <p className={styles.meta}>
        Estimée le <Timestamp iso={score.createdAt} format="datetime" /> · modèle <code className={styles.model}>{score.model}</code>
        {cached ? " · estimation enregistrée pour cette version du dossier" : null}
      </p>
      <ConsultationProvenance consultation={score.consultation} />
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Sources citées ({sources.length})</h3>
        <ul className={styles.list}>
          {sources.map((item) => (
            <SourceItem key={item.id} item={item} />
          ))}
        </ul>
      </div>
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Limites</h3>
        <ul className={styles.list}>
          {score.limitations.map((raw) => {
            const limitation = limitationText(raw);
            return (
              <li key={raw} lang={limitation.translated ? undefined : "en"}>
                {limitation.text}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
