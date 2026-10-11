"use client";

/**
 * /patient/share — one-use external consultation (spec 006 story 8). The
 * patient picks elements already in the current record, reads every limit,
 * issues a link shown once, and can list and revoke issued links. Needs the
 * server: a device copy lacks facts and actions, so nothing is offered from it.
 */
import { useCallback } from "react";
import { Notice, PageHeader } from "@/components/ui";
import type { PatientRecord } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { listExternalVisits, type OwnerVisitList } from "@/lib/client/share-api";
import { RecordGate } from "../RecordGate";
import { usePatientRuntime } from "../PatientRuntime";
import { ShareComposer } from "./ShareComposer";
import { ShareGrantList } from "./ShareGrantList";
import { useFencedResource } from "./use-fenced-resource";
import styles from "../patient.module.css";

function ShareContent({ record }: { record: PatientRecord }) {
  const { lang, t, online, data } = usePatientRuntime();
  const copy = SHARE_COPY[lang].share;
  const fromServer = data.origin === "server";
  const live = online && fromServer;
  const patientId = record.patient.id;
  const fetcher = useCallback((signal: AbortSignal): Promise<OwnerVisitList> => listExternalVisits(patientId, { signal }), [patientId]);
  const visits = useFencedResource(data.fence, live, fetcher);

  if (!fromServer) {
    return (
      <Notice tone="neutral" icon="cloud-off" title={copy.offline}>
        {CARE_COPY[lang].monitoring.onlineOnly}
      </Notice>
    );
  }

  return (
    <>
      <ShareComposer record={record} fence={data.fence} live={live} onIssued={visits.reload} onRefused={visits.reload} lang={lang} />
      <ShareGrantList fence={data.fence} live={live} resource={visits} lang={lang} t={t} />
    </>
  );
}

export function ShareScreen() {
  const { lang } = usePatientRuntime();
  const copy = SHARE_COPY[lang].share;
  return (
    <div className={styles.page}>
      <PageHeader title={copy.title} description={copy.description} back={{ href: "/patient/record", label: CARE_COPY[lang].record.title }} />
      <RecordGate>{(record) => <ShareContent record={record} />}</RecordGate>
    </div>
  );
}
