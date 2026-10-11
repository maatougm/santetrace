"use client";

import { Notice } from "@/components/ui";
import { hasScope, type DoctorSectionProps } from "../PatientAccessScope";
import { CoverageCard } from "./CoverageCard";
import { PlanCard } from "./PlanCard";
import { ProposalsPanel } from "./ProposalsPanel";
import styles from "./Care.module.css";

/** Coverage and evaluations, versioned plan, and per-item proposal review (spec 006 stories 2–3). */
export function CarePlanSection(props: DoctorSectionProps) {
  const { record } = props;
  return (
    <div className={styles.stack}>
      {hasScope(record, "status") ? (
        <CoverageCard record={record} />
      ) : (
        <Notice tone="neutral" icon="lock" title="Couverture non partagée">
          Le patient n’a pas partagé le statut de suivi avec ce compte.
        </Notice>
      )}
      <PlanCard {...props} />
      {hasScope(record, "clinical") ? (
        <ProposalsPanel {...props} />
      ) : (
        <Notice tone="neutral" icon="lock" title="Propositions non partagées">
          Les informations cliniques ne sont pas partagées avec ce compte.
        </Notice>
      )}
    </div>
  );
}
