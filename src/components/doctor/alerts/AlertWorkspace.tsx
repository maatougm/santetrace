"use client";

import { useId, useMemo, useState } from "react";
import { Dialog, EmptyState, SegmentedControl } from "@/components/ui";
import type { MutationGuard } from "@/lib/client/access-fence";
import type { Alert, Measurement, Patient } from "@/lib/client/api";
import { isOpenAlert, sortAlertQueue } from "../shared/alerts";
import { useMediaQuery } from "../shared/hooks";
import { AlertDetail } from "./AlertDetail";
import { AlertQueue } from "./AlertQueue";
import styles from "./AlertWorkspace.module.css";

type QueueView = "open" | "closed";

interface AlertWorkspaceProps {
  alerts: readonly Alert[];
  patients?: readonly Pick<Patient, "id" | "displayName">[];
  measurements: ReadonlyMap<string, Measurement>;
  onAlertUpdated: (alert: Alert) => void;
  /** Shows patient names and record links (dashboard). */
  showPatient: boolean;
  title: string;
  /** Wide layout breakpoint for the side panel; narrower screens use a dialog. */
  sidePanelQuery?: string;
  /** Patient record view: its mutation guard (held results across authority changes are discarded). */
  guard?: MutationGuard;
}

function focusHeading(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true }));
}

/**
 * Alert queue + evidence panel. Inspect and acknowledge = select a row, then
 * "Accuser réception" (two primary interactions).
 */
export function AlertWorkspace({
  alerts,
  patients = [],
  measurements,
  onAlertUpdated,
  showPatient,
  title,
  sidePanelQuery = "(min-width: 1180px)",
  guard,
}: AlertWorkspaceProps) {
  const headingId = useId();
  const titleId = useId();
  const [view, setView] = useState<QueueView>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wide = useMediaQuery(sidePanelQuery);

  const patientNames = useMemo(() => new Map(patients.map((p) => [p.id, p.displayName])), [patients]);
  const openAlerts = useMemo(() => sortAlertQueue(alerts.filter(isOpenAlert)), [alerts]);
  const closedAlerts = useMemo(() => sortAlertQueue(alerts.filter((a) => !isOpenAlert(a))), [alerts]);
  const visible = view === "open" ? openAlerts : closedAlerts;

  const selected = selectedId ? (alerts.find((a) => a.id === selectedId) ?? null) : null;
  const selectedPatient = selected ? patients.find((p) => p.id === selected.patientId) : undefined;
  const selectedMeasurement = selected?.measurementId ? (measurements.get(selected.measurementId) ?? null) : null;

  const select = (alertId: string) => {
    setSelectedId(alertId);
    if (wide) focusHeading(headingId);
  };

  const detail = selected ? (
    <AlertDetail
      alert={selected}
      measurement={selectedMeasurement}
      patient={showPatient && selectedPatient ? selectedPatient : null}
      onUpdated={onAlertUpdated}
      headingId={headingId}
      guard={guard}
    />
  ) : null;

  return (
    <div className={styles.workspace} data-wide={wide || undefined}>
      <section className={styles.queue} aria-labelledby={titleId}>
        <header className={styles.queueHead}>
          <h2 id={titleId} className={styles.queueTitle}>
            {title}
          </h2>
          <SegmentedControl<QueueView>
            ariaLabel="Filtrer les alertes"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "open", label: `Ouvertes (${openAlerts.length})` },
              { value: "closed", label: `Clôturées (${closedAlerts.length})` },
            ]}
          />
        </header>
        {visible.length > 0 ? (
          <AlertQueue
            alerts={visible}
            selectedId={selectedId}
            onSelect={select}
            patientNames={showPatient ? patientNames : undefined}
            measurements={measurements}
            ariaLabel={view === "open" ? "Alertes ouvertes, par priorité" : "Alertes clôturées"}
          />
        ) : view === "open" ? (
          <EmptyState
            compact
            icon="inbox"
            title="Aucune alerte ouverte"
            description="Cela ne signifie pas que les patients vont bien : un statut « inconnu » signale des données manquantes ou en retard."
          />
        ) : (
          <EmptyState compact icon="inbox" title="Aucune alerte clôturée" />
        )}
      </section>

      {wide ? (
        <aside className={styles.panel} aria-label="Détail de l’alerte sélectionnée">
          {detail ?? (
            <EmptyState
              compact
              icon="eye"
              title="Sélectionnez une alerte"
              description="La preuve exacte (valeur, seuils, version de règle, horodatages) et les actions s’affichent ici."
            />
          )}
        </aside>
      ) : (
        <Dialog open={selected !== null} onClose={() => setSelectedId(null)} title="Détail de l’alerte" size="lg">
          {detail}
        </Dialog>
      )}
    </div>
  );
}
