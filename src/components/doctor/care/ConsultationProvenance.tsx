"use client";

/**
 * Optional medical-consultation provenance under an AI result (report,
 * proposals, case estimate). Renders nothing when the server returned no
 * valid metadata. Neutral styling: text plus icon, never colour alone.
 */
import { Icon } from "@/components/ui";
import { consultationView } from "./consultation-view";
import styles from "./ConsultationProvenance.module.css";

export function ConsultationProvenance({ consultation }: { consultation: unknown }) {
  const view = consultationView(consultation);
  if (!view) return null;
  return (
    <div className={styles.box} role="group" aria-label="Provenance de la consultation médicale">
      <p className={styles.title}>
        <Icon name={view.icon} size={16} />
        <span>{view.title}</span>
      </p>
      {view.details.map((detail) => (
        <p key={detail} className={styles.line}>
          {detail}
        </p>
      ))}
      {view.models ? (
        <p className={styles.line}>
          Spécialiste <bdi className={styles.mono}>{view.models.specialist}</bdi> · modèle principal <bdi className={styles.mono}>{view.models.brain}</bdi>
        </p>
      ) : null}
      <p className={styles.note}>{view.disclaimer}</p>
    </div>
  );
}
