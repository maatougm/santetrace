"use client";

/**
 * Plan state, proposals in review and coverage for the patient (live data).
 *
 * Proposals are read only through `toPatientProposalStatus`: the patient sees
 * kind, state and count, never an exam name, parameters, sources or a
 * hypothesis. A passed review deadline reads "late", never as approval.
 */
import { Badge, Card, LinkButton, type BadgeTone } from "@/components/ui";
import type { CarePlan } from "@/contracts/monitoring";
import type { DoctorProfile } from "@/contracts/patient-platform";
import type { Language, PatientRecord } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { formatDateTime } from "@/lib/client/format";
import { Ltr } from "../bits";
import { CoverageList } from "../monitoring/CoverageList";
import { conditionCards, globalMonitoringDisplay, openRedAlert } from "../monitoring/monitoring-view";
import { doctorName, patientProposalRows, reviewDeadlineView } from "./plan-view";
import patientStyles from "../patient.module.css";
import styles from "./plan.module.css";

const PLAN_TONE: Record<CarePlan["state"], BadgeTone> = {
  awaiting_clinician: "outline",
  active: "neutral",
  suspended: "outline",
  revoked: "muted",
};

export function PlanStateCard({ plan, doctors, lang }: { plan: CarePlan | null; doctors: readonly DoctorProfile[]; lang: Language }) {
  const copy = CARE_COPY[lang].plan;
  const state = plan?.state ?? "awaiting_clinician";
  const review = reviewDeadlineView(plan, Date.now());
  const validated = plan !== null && (plan.state === "active" || plan.state === "suspended");
  const name = doctorName(plan?.clinicianId ?? null, doctors);
  return (
    <Card
      title={CARE_COPY[lang].planState[state]}
      actions={
        plan ? (
          <Badge tone={PLAN_TONE[state]} icon={state === "active" ? "check" : "clock"}>
            <Ltr>v{plan.revision}</Ltr>
          </Badge>
        ) : undefined
      }
    >
      <div className={patientStyles.stackSm}>
        {validated ? (
          <p className={patientStyles.metaLine}>{name ? copy.validatedBy(name, plan.revision) : copy.validatedGeneric(plan.revision)}</p>
        ) : null}
        {review.overdue ? (
          <p className={patientStyles.metaLine}>
            <Badge tone="outline" icon="clock">
              {copy.reviewOverdue}
            </Badge>
          </p>
        ) : review.deadline ? (
          <p className={patientStyles.metaLine}>{copy.reviewDeadline(formatDateTime(review.deadline, lang))}</p>
        ) : null}
      </div>
    </Card>
  );
}

export function ProposalsCard({ record, lang }: { record: PatientRecord; lang: Language }) {
  const copy = CARE_COPY[lang];
  // Neutral patient labels only: a pending lab exam is never named or called an exam.
  const rows = patientProposalRows(record.proposals, lang);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <Card title={copy.plan.proposalsTitle} description={total > 0 ? copy.plan.proposalsCount(total) : undefined}>
      {rows.length === 0 ? (
        <p className={patientStyles.emptyLine}>{copy.plan.proposalsEmpty}</p>
      ) : (
        <div className={patientStyles.stackSm}>
          <ul className={styles.list}>
            {rows.map((row) => (
              <li key={row.key} className={styles.groupRow}>
                <span>{row.kindLabel}</span>
                <span className={styles.badges}>
                  <Badge tone="outline" icon="clock">
                    {row.stateLabel}
                  </Badge>
                  <Badge tone="muted">
                    <Ltr>{row.count}</Ltr>
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
          <p className={patientStyles.metaLine}>{copy.plan.proposalHidden}</p>
        </div>
      )}
    </Card>
  );
}

export function CoverageCard({ record, lang, stale }: { record: PatientRecord; lang: Language; stale: boolean }) {
  const copy = CARE_COPY[lang];
  const display = globalMonitoringDisplay({
    monitoring: record.monitoring,
    patientStatus: record.patient.status,
    cards: conditionCards(record.medicalFacts, record.evaluations),
    openRed: openRedAlert(record.alerts) !== null,
    stale,
  });
  return (
    <Card title={copy.plan.coverageTitle}>
      <div className={patientStyles.stackSm}>
        {display.coverage.length > 0 ? <CoverageList coverage={display.coverage} lang={lang} /> : null}
        {!display.hasEvaluation ? <p className={patientStyles.metaLine}>{copy.monitoring.noEvaluation}</p> : null}
        {/* Only a real evaluation time (the epoch "never evaluated" sentinel is filtered out). */}
        {display.evaluatedAt ? (
          <p className={patientStyles.metaLine}>{copy.monitoring.evaluatedAt(formatDateTime(display.evaluatedAt, lang))}</p>
        ) : null}
        {display.notGreen ? <p className={patientStyles.metaLine}>{copy.monitoring.notGreenBecause}</p> : null}
        <div className={styles.links}>
          <LinkButton href="/patient" variant="ghost" iconEnd="chevron-right">
            {copy.monitoring.globalTitle}
          </LinkButton>
        </div>
      </div>
    </Card>
  );
}
