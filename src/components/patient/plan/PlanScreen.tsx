"use client";

/**
 * Patient plan (spec 006 stories 2, 4, 5; FR-005/006/018): what is proposed
 * (state only), approved (exact template), pending, late or reported.
 *
 * Live data shows everything; a device copy shows only the previously
 * approved actions, dated, and says the rest is available online only.
 */
import { useCallback } from "react";
import { ErrorState, LinkButton, Notice, PageHeader } from "@/components/ui";
import type { ProtocolApplication } from "@/contracts/monitoring";
import { listProtocolApplications } from "@/lib/client/assist-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { describeApiError, type Language, type PatientRecord } from "@/lib/client/api";
import { NoReferentNotice } from "../monitoring/NoReferentNotice";
import { needsReferent } from "../monitoring/monitoring-view";
import { usePatientRuntime } from "../PatientRuntime";
import { RecordGate } from "../RecordGate";
import { ApprovedAdviceCard } from "./ApprovedAdviceCard";
import { PlanActions } from "./PlanActions";
import { CoverageCard, PlanStateCard, ProposalsCard } from "./PlanOverview";
import { adviceFromBlocked, blockedApplications } from "./plan-view";
import { useDoctorDirectory } from "./useDoctorDirectory";
import { useFencedResource } from "./useFencedResource";
import { HOME_COPY } from "../home/home-copy";
import { PLAN_LINKS } from "../patient-nav";
import patientStyles from "../patient.module.css";
import styles from "./plan.module.css";

const BLOCKED_SHOWN = 3;

/** Protocol reuse refused by the server: shown so the patient knows a review is needed. */
function BlockedAdvice({ patientId, lang }: { patientId: string; lang: Language }) {
  const { data, t } = usePatientRuntime();
  const load = useCallback(
    (signal: AbortSignal) => listProtocolApplications(patientId, { signal }).then((r) => r.applications),
    [patientId],
  );
  const applications = useFencedResource<ProtocolApplication[]>(data.fence, `applications:${patientId}`, load);
  if (applications.error) {
    // Route not shipped yet: this section simply does not exist.
    if (applications.error.isUnavailable) return null;
    const description = describeApiError(applications.error, lang);
    return (
      <ErrorState
        compact
        title={description.title}
        message={description.message}
        code={description.code}
        onRetry={applications.reload}
        retryLabel={t.common.retry}
      />
    );
  }
  const blocked = blockedApplications(applications.value ?? []).slice(0, BLOCKED_SHOWN);
  return (
    <>
      {blocked.map((application) => (
        <ApprovedAdviceCard key={application.id} advice={adviceFromBlocked(application)} lang={lang} headingLevel={2} />
      ))}
    </>
  );
}

function PlanBody({ record }: { record: PatientRecord }) {
  const { lang, data } = usePatientRuntime();
  const doctors = useDoctorDirectory();
  const copy = CARE_COPY[lang];

  if (data.origin !== "server") {
    return (
      <>
        <Notice tone="neutral" icon="cloud-off">
          {copy.monitoring.onlineOnly}
        </Notice>
        <PlanActions actions={record.actions} lang={lang} deviceSavedAt={data.deviceSavedAt} />
      </>
    );
  }

  return (
    <>
      {needsReferent(record, data.origin) ? <NoReferentNotice lang={lang} /> : null}
      <PlanStateCard plan={record.plan} doctors={doctors} lang={lang} />
      <PlanActions actions={record.actions} lang={lang} deviceSavedAt={null} />
      <BlockedAdvice patientId={record.patient.id} lang={lang} />
      <ProposalsCard record={record} lang={lang} />
      <CoverageCard record={record} lang={lang} stale={data.error !== null} />
    </>
  );
}

/** Reminders and questions stay one tap away, live or from a device copy. */
function PlanLinks({ lang }: { lang: Language }) {
  const copy = CARE_COPY[lang].plan;
  return (
    <nav aria-label={HOME_COPY[lang].planLinksTitle} className={styles.planLinks}>
      {PLAN_LINKS.map((link) => (
        <LinkButton key={link.href} href={link.href} variant="secondary" iconStart={link.icon} iconEnd="chevron-right" fullWidth>
          {copy[link.key]}
        </LinkButton>
      ))}
    </nav>
  );
}

export function PlanScreen() {
  const { lang } = usePatientRuntime();
  const copy = CARE_COPY[lang].plan;
  return (
    <div className={patientStyles.page}>
      <PageHeader title={copy.title} description={copy.description} />
      <PlanLinks lang={lang} />
      <RecordGate>{(record) => <PlanBody record={record} />}</RecordGate>
    </div>
  );
}
