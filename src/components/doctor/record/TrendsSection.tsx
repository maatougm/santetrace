"use client";

import { Button, EmptyState, Notice } from "@/components/ui";
import type { PatientRecord } from "@/lib/client/api";
import { BloodPressureChart } from "../charts/BloodPressureChart";
import { GlucoseCharts } from "../charts/GlucoseCharts";
import { LabCharts, labSeries } from "../charts/LabCharts";
import { readability, recordCounts } from "./read-visibility";
import styles from "./Record.module.css";

interface TrendsSectionProps {
  record: PatientRecord;
  onOpenDocuments: () => void;
}

const LABS_NOT_SHARED = "Résultats biologiques non partagés";

/**
 * Trusted trajectory: received measurements and clinician-confirmed lab results only.
 * Lab results need owner or clinical + documents: when they are not shared, an empty
 * projection is shown as "non partagés", never as "aucun résultat confirmé".
 */
export function TrendsSection({ record, onOpenDocuments }: TrendsSectionProps) {
  const { patient, measurements, observations, candidates, documents } = record;
  const { labs: labsShared } = readability(record.access);
  const hasBp = measurements.some((m) => m.kind === "blood_pressure");
  const hasGlucose = measurements.some((m) => m.kind === "glucose");
  const series = labsShared ? labSeries(patient.id, observations, candidates, documents) : [];
  const pending = recordCounts(record).pendingLabs;
  const pendingNotice = pending !== null && pending > 0 ? <PendingNotice count={pending} onOpen={onOpenDocuments} /> : null;

  if (measurements.length === 0 && series.length === 0) {
    return (
      <div className={styles.sectionStack}>
        <EmptyState
          icon="help-circle"
          title="Aucune mesure : statut inconnu"
          description={
            labsShared
              ? "Aucune mesure reçue et aucun résultat biologique confirmé. L’absence de données n’indique pas un état stable."
              : `Aucune mesure reçue. ${LABS_NOT_SHARED} avec ce compte. L’absence de données n’indique pas un état stable.`
          }
        />
        {pendingNotice}
      </div>
    );
  }

  return (
    <div className={styles.sectionStack}>
      <h2 className={styles.groupTitle}>Mesures reçues</h2>
      <div className={styles.chartGrid}>
        {hasBp ? (
          <BloodPressureChart measurements={measurements} rules={patient.rules} />
        ) : (
          <EmptyState compact icon="heart-pulse" title="Aucune tension reçue" description="Statut inconnu pour la tension." />
        )}
        {hasGlucose ? (
          <GlucoseCharts measurements={measurements} rules={patient.rules} />
        ) : (
          <EmptyState compact icon="droplet" title="Aucune glycémie reçue" description="Statut inconnu pour la glycémie." />
        )}
      </div>

      <h2 className={styles.groupTitle}>Résultats biologiques confirmés (EndoRecord)</h2>
      {pendingNotice}
      {!labsShared ? (
        <EmptyState
          compact
          icon="lock"
          title={LABS_NOT_SHARED}
          description="Les résultats confirmés et les valeurs en attente de revue ne sont pas partagés avec ce compte."
        />
      ) : series.length > 0 ? (
        <div className={styles.chartGrid}>
          <LabCharts series={series} />
        </div>
      ) : (
        <EmptyState
          compact
          icon="file-text"
          title="Aucun résultat confirmé"
          description="Les valeurs extraites d’un document n’apparaissent ici qu’après confirmation par un clinicien."
        />
      )}
    </div>
  );
}

function PendingNotice({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <Notice
      tone="info"
      icon="file-text"
      title={`${count} résultat${count > 1 ? "s" : ""} proposé${count > 1 ? "s" : ""} en attente de revue`}
      action={
        <Button size="sm" variant="secondary" onClick={onOpen}>
          Voir les documents
        </Button>
      }
    >
      Non affiché{count > 1 ? "s" : ""} sur les courbes tant qu’un clinicien ne les a pas confirmés à partir de la source.
    </Notice>
  );
}
