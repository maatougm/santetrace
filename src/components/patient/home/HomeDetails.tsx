"use client";

/**
 * Secondary home information, behind native disclosures: monitoring coverage,
 * reasons and per-condition cards (inside the status card), and the device
 * outbox counts. The unsent state itself stays visible in the shell's
 * StatusStrip on every screen.
 */
import Link from "next/link";
import { Button, Icon, Notice } from "@/components/ui";
import type { Language, PatientRecord } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { ConditionCoverageCards } from "../monitoring/ConditionCoverageCards";
import { CoverageList } from "../monitoring/CoverageList";
import { ReasonList } from "../monitoring/ReasonList";
import { conditionCards } from "../monitoring/monitoring-view";
import { usePatientRuntime } from "../PatientRuntime";
import { Disclosure } from "./Disclosure";
import { HOME_COPY } from "./home-copy";
import type { HomeStatusView } from "./home-status";
import css from "../home.module.css";
import styles from "../patient.module.css";
import mon from "../monitoring/monitoring.module.css";

interface MonitoringDetailsProps {
  record: PatientRecord;
  view: HomeStatusView;
  live: boolean;
  lang: Language;
}

export function MonitoringDetails({ record, view, live, lang }: MonitoringDetailsProps) {
  const copy = CARE_COPY[lang];
  const title = HOME_COPY[lang].detailsMonitoring;
  if (!live) {
    return (
      <Disclosure title={title} variant="inline">
        <Notice tone="neutral" icon="cloud-off">
          {copy.monitoring.onlineOnly}
        </Notice>
      </Disclosure>
    );
  }
  const cards = conditionCards(record.medicalFacts, record.evaluations);
  if (view.coverage.length === 0 && view.reasons.length === 0 && cards.length === 0) return null;
  return (
    <Disclosure title={title} variant="inline">
      <CoverageList coverage={view.coverage} lang={lang} label={copy.plan.coverageTitle} />
      {view.reasons.length > 0 ? (
        <div>
          <h3 className={mon.subTitle}>{copy.monitoring.reasonsTitle}</h3>
          <ReasonList reasons={view.reasons} lang={lang} />
        </div>
      ) : null}
      <ConditionCoverageCards cards={cards} lang={lang} />
    </Disclosure>
  );
}

function outboxText(runtime: ReturnType<typeof usePatientRuntime>): string {
  const { outbox, t } = runtime;
  const { counts } = outbox;
  const waiting = counts.queued + counts.sending;
  const parts = [
    waiting > 0 ? t.outbox.waiting(waiting) : null,
    counts.failed > 0 ? t.outbox.failed(counts.failed) : null,
    counts.server_received > 0 ? t.outbox.received(counts.server_received) : null,
  ].filter((part): part is string => part !== null);
  if (outbox.status === "unavailable") return t.outbox.storageUnavailable;
  return parts.length > 0 ? parts.join(" · ") : t.outbox.nothingPending;
}

export function OutboxDetails() {
  const runtime = usePatientRuntime();
  const { outbox, t } = runtime;
  if (outbox.status !== "ready" && outbox.status !== "unavailable") return null;
  const waiting = outbox.counts.queued + outbox.counts.sending;
  return (
    <Disclosure title={t.outbox.title}>
      <p className={styles.metaLine}>{outboxText(runtime)}</p>
      {waiting > 0 ? (
        <Button variant="secondary" iconStart="refresh" loading={outbox.replaying} onClick={() => void outbox.replay()}>
          {t.outbox.retry}
        </Button>
      ) : null}
      <Link href="/patient/history" className={css.textLink}>
        {t.common.seeAll}
        <Icon name="chevron-right" size={18} />
      </Link>
    </Disclosure>
  );
}
