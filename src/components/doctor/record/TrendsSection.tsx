"use client";

import { Button, EmptyState, Notice } from "@/components/ui";
import type { PatientRecord } from "@/lib/client/api";
import { BloodPressureChart } from "../charts/BloodPressureChart";
import { GlucoseCharts } from "../charts/GlucoseCharts";
import { LabCharts, labSeries } from "../charts/LabCharts";
import styles from "./Record.module.css";

interface TrendsSectionProps {
  record: PatientRecord;
  onOpenDocuments: () => void;
}

/** Trusted trajectory: received measurements and clinician-confirmed lab results only. */
export function TrendsSection({ record, onOpenDocuments }: TrendsSectionProps) {
  const { patient, measurements, observations, candidates, documents } = record;
  const hasBp = measurements.some((m) => m.kind === "blood_pressure");
  const hasGlucose = measurements.some((m) => m.kind === "glucose");
  const series = labSeries(patient.id, observations, candidates, documents);
  const pending = candidates.filter((c) => c.status === "proposed").length;

  if (measurements.length === 0 && series.length === 0) {
    return (
      <div className={styles.sectionStack}>
        <EmptyState
          icon="help-circle"
          title="Aucune mesure : statut inconnu"
          description="Aucune mesure reçue et aucun résultat biologique confirmé. L’absence de données n’indique pas un état stable."
        />
        {pending > 0 ? <PendingNotice count={pending} onOpen={onOpenDocuments} /> : null}
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
      {pending > 0 ? <PendingNotice count={pending} onOpen={onOpenDocuments} /> : null}
      {series.length > 0 ? (
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
