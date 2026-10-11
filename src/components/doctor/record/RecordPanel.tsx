"use client";

import { useMemo } from "react";
import { Notice } from "@/components/ui";
import type { MutationGuard } from "@/lib/client/access-fence";
import type { Measurement, PatientRecord } from "@/lib/client/api";
import { AlertWorkspace } from "../alerts/AlertWorkspace";
import { CarePlanSection } from "../care/CarePlanSection";
import { ClinicalReportSection } from "../care/ClinicalReportSection";
import { ProtocolsSection } from "../care/ProtocolsSection";
import { MessageSection } from "../comms/MessageSection";
import { RecordSearchSection } from "../comms/RecordSearchSection";
import type { DoctorSectionProps } from "../PatientAccessScope";
import { NotShared } from "./AccessScopeNotice";
import { DocumentsSection } from "./DocumentsSection";
import { ExternalNotesSection } from "./ExternalNotesSection";
import { MeasurementsSection } from "./MeasurementsSection";
import { RemindersSection } from "./RemindersSection";
import { RulesSection } from "./RulesSection";
import { SummarySection } from "./SummarySection";
import { TrendsSection } from "./TrendsSection";
import type { TabId } from "./record-tabs";
import { withAlert, withDocument, withPatient, withReminder } from "./record-updates";
import styles from "./Record.module.css";

type Apply = (updater: (current: PatientRecord | null) => PatientRecord | null) => void;

interface RecordPanelProps {
  tab: TabId;
  section: DoctorSectionProps;
  apply: Apply;
  guard: MutationGuard;
  rulesNotice: string | null;
  onRulesNotice: (notice: string) => void;
  onOpenDocuments: () => void;
}

function RulesPanel({ section, apply, guard, rulesNotice, onRulesNotice }: Omit<RecordPanelProps, "tab" | "onOpenDocuments">) {
  const { patient } = section.record;
  if (!patient.rules) return <NotShared what="Règles de suivi" />;
  return (
    <div className={styles.sectionStack}>
      {rulesNotice ? (
        <Notice tone="success" title="Nouvelle version enregistrée">
          {rulesNotice}
        </Notice>
      ) : null}
      <RulesSection
        key={patient.rules.version}
        patient={{ ...patient, rules: patient.rules }}
        guard={guard}
        onUpdated={(updated) => {
          onRulesNotice(
            `Version ${updated.rules.version} en vigueur pour les prochaines mesures. Les alertes existantes conservent leur version d’origine.`,
          );
          apply(withPatient(updated));
        }}
      />
    </div>
  );
}

/** Content of the active record tab (access is checked by the caller). */
export function RecordPanel(props: RecordPanelProps) {
  const { tab, section, apply, guard, onOpenDocuments } = props;
  const { record } = section;
  const measurementById = useMemo<ReadonlyMap<string, Measurement>>(
    () => new Map(record.measurements.map((m) => [m.id, m])),
    [record.measurements],
  );

  switch (tab) {
    case "messages":
      return <MessageSection {...section} />;
    case "alerts":
      return (
        <AlertWorkspace
          title="Alertes du patient"
          alerts={record.alerts}
          measurements={measurementById}
          onAlertUpdated={(alert) => apply(withAlert(alert))}
          showPatient={false}
          guard={guard}
        />
      );
    case "care":
      return <CarePlanSection {...section} />;
    case "trends":
      return <TrendsSection record={record} onOpenDocuments={onOpenDocuments} />;
    case "measurements":
      return <MeasurementsSection measurements={record.measurements} />;
    case "documents":
      return (
        <DocumentsSection
          patientId={record.patient.id}
          documents={record.documents}
          candidates={record.candidates}
          observations={record.observations}
          onUploaded={(document, candidates) => apply(withDocument(document, candidates))}
        />
      );
    case "report":
      return <ClinicalReportSection {...section} />;
    case "protocols":
      return <ProtocolsSection {...section} />;
    case "search":
      return <RecordSearchSection {...section} />;
    case "notes":
      return <ExternalNotesSection notes={record.externalNotes ?? []} />;
    case "reminders":
      return (
        <RemindersSection
          patientId={record.patient.id}
          reminders={record.reminders}
          onCreated={(reminder) => apply(withReminder(reminder))}
          guard={guard}
        />
      );
    case "rules":
      return <RulesPanel {...props} />;
    case "summary":
      return <SummarySection record={record} fence={section.fence} guard={guard} />;
  }
}
