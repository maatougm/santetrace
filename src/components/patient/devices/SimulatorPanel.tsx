"use client";

/**
 * /patient/measure/devices — "Appareils et simulateur" (spec 006 story 7).
 * Two explicit choices: the demo simulator (its readings are labelled
 * simulated by the server) or a real device binding (a server binding and a
 * one-time credential; no Bluetooth or physical connection is made or
 * claimed). Online only; offline nothing is sent. The content is keyed by the
 * access context, so a patient or fence change starts from an empty memory.
 */
import { useCallback } from "react";
import { Badge, Notice, PageHeader } from "@/components/ui";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { listConnectors } from "@/lib/client/devices-api";
import { RecordGate } from "../RecordGate";
import { usePatientRuntime } from "../PatientRuntime";
import { useFencedResource } from "../share/use-fenced-resource";
import { ConnectorsCard, type ConnectorList } from "./ConnectorsCard";
import { SimulatedReadingCard } from "./SimulatedReadingCard";
import styles from "../patient.module.css";

function DevicesContent({ patientId }: { patientId: string }) {
  const { lang, online, data } = usePatientRuntime();
  const copy = SHARE_COPY[lang].simulator;
  const { fence, refresh } = data;
  const fetcher = useCallback((signal: AbortSignal): Promise<ConnectorList> => listConnectors(patientId, { signal }), [patientId]);
  const resource = useFencedResource(fence, online, fetcher);
  const connectors = resource.state.status === "ready" ? resource.state.value.connectors : [];
  const onReceived = useCallback(() => void refresh(), [refresh]);

  return (
    <>
      {!online ? (
        <Notice tone="neutral" icon="wifi-off">
          {copy.offline}
        </Notice>
      ) : null}
      <ConnectorsCard patientId={patientId} fence={fence} live={online} resource={resource} />
      {resource.state.status === "ready" ? (
        <SimulatedReadingCard patientId={patientId} fence={fence} live={online} connectors={connectors} onReceived={onReceived} />
      ) : null}
    </>
  );
}

export function SimulatorPanel() {
  const { lang, t, data } = usePatientRuntime();
  const copy = SHARE_COPY[lang].simulator;
  const fenceKey = data.fence.key ?? "no-patient";
  return (
    <div className={styles.page}>
      <PageHeader
        title={copy.title}
        description={copy.description}
        back={{ href: "/patient/measure", label: t.nav.measure }}
        actions={
          <Badge tone="outline" icon="activity">
            {copy.badge}
          </Badge>
        }
      />
      <RecordGate>{(record) => <DevicesContent key={`${fenceKey}|${record.patient.id}`} patientId={record.patient.id} />}</RecordGate>
    </div>
  );
}
