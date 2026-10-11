"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Card, Notice, Skeleton } from "@/components/ui";
import type { ProtocolApplication, ProtocolStateInput, ReusableProtocol } from "@/contracts/monitoring";
import { listProtocolApplications, listProtocols } from "@/lib/client/assist-api";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import type { DoctorSectionProps } from "../PatientAccessScope";
import { ApiErrorState } from "../shared/ApiErrorState";
import { protocolsScopeGate } from "./section-access";
import { OutcomeNotice } from "./OutcomeNotice";
import type { Outcome } from "./outcome";
import { eligibleSourceProposals } from "./protocol-authorization";
import { deliveredCount } from "./protocol-log";
import { ProtocolApplicationsLog } from "./ProtocolApplicationsLog";
import { ProtocolCard } from "./ProtocolCard";
import { ProtocolForm, type ProtocolFormSession } from "./ProtocolForm";
import { ProtocolStateDialog, type ProtocolStateTarget } from "./ProtocolStateDialog";
import { useCurrentContext } from "./use-current-context";
import { useEpochScoped, useFencedResource, type ResourceState } from "./use-fenced";
import styles from "./Care.module.css";

function usedCount(log: ResourceState<{ applications: ProtocolApplication[] }>, protocolId: string): number | null {
  return log.status === "ready" ? deliveredCount(log.value.applications, protocolId) : null;
}

/**
 * Reusable protocols and their application log (spec 006 story 4, FR-012..014).
 * Their source history is a composite read (summary scope). A 403 from these
 * reads stays local to this section: it never revokes the record fence.
 */
export function ProtocolsSection(props: DoctorSectionProps) {
  const gate = protocolsScopeGate(props.record.access);
  if (!gate.allowed) {
    return (
      <Notice tone="neutral" icon="lock" title="Protocoles non disponibles pour ce compte">
        L’historique des protocoles et de leurs sources demande l’accès « {ACCESS_COPY.fr.scope.summary} », qui nécessite{" "}
        {PROTOCOL_SCOPE_LIST}. Accès manquant : {gate.missing.map((scope) => ACCESS_COPY.fr.scope[scope]).join(", ")}. Rien n’est affiché.
      </Notice>
    );
  }
  return <ProtocolsPanel {...props} />;
}

const PROTOCOL_SCOPE_LIST = (["status", "measurements", "clinical", "documents"] as const).map((scope) => ACCESS_COPY.fr.scope[scope].toLowerCase()).join(", ");

function ProtocolsPanel({ patientId, record, fence, refresh }: DoctorSectionProps) {
  const canManage = record.access.canManageCare;
  // Plan or authority changes can suspend protocols server-side: reload with them.
  const reloadKey = `${record.access.authorityRevision}:${record.plan?.revision ?? 0}:${record.plan?.state ?? "none"}`;
  const protocolsLoader = useCallback((signal: AbortSignal) => listProtocols(patientId, { signal }), [patientId]);
  const logLoader = useCallback((signal: AbortSignal) => listProtocolApplications(patientId, { signal }), [patientId]);
  const protocols = useFencedResource(fence, protocolsLoader, reloadKey);
  const log = useFencedResource(fence, logLoader, reloadKey);

  const [formSession, setFormSession] = useState<ProtocolFormSession | null>(null);
  const [stateTarget, setStateTarget] = useState<ProtocolStateTarget | null>(null);
  const [outcome, setOutcome] = useEpochScoped<Outcome>(fence);
  const [focusKey, setFocusKey] = useState(0);
  const openings = useRef(0);
  const eligible = eligibleSourceProposals(record.proposals, patientId);
  const planActive = record.plan?.state === "active";
  const currentContext = useCurrentContext(patientId, record, fence);

  const reloadAll = () => {
    protocols.reload();
    log.reload();
    refresh();
  };
  const report = (next: Outcome) => {
    setFormSession(null);
    setStateTarget(null);
    setOutcome(next);
    setFocusKey((value) => value + 1);
    reloadAll();
  };
  const openForm = (protocol: ReusableProtocol | null) => {
    setOutcome(null);
    openings.current += 1;
    setFormSession({ protocol, nonce: openings.current });
  };
  const openState = (protocol: ReusableProtocol, action: ProtocolStateInput["action"]) => {
    setOutcome(null);
    openings.current += 1;
    setStateTarget({ protocol, action, nonce: openings.current });
  };

  return (
    <div className={styles.stack}>
      <Card
        title="Protocoles réutilisables"
        description="Autorisations explicites et bornées du médecin référent, pour ce patient uniquement. « Valider une fois » n’en crée jamais."
        actions={
          canManage ? (
            <Button variant="primary" iconStart="shield" disabled={!planActive || eligible.length === 0} onClick={() => openForm(null)}>
              Autoriser une réutilisation bornée…
            </Button>
          ) : null
        }
      >
        <div className={styles.stack}>
          {canManage && !planActive ? (
            <p className={styles.mutedBlock}>Plan de suivi non actif : activez-le (onglet Plan) avant toute autorisation de réutilisation.</p>
          ) : null}
          {canManage && planActive && eligible.length === 0 ? (
            <p className={styles.mutedBlock}>
              Aucune mesure à domicile validée pour ce patient : validez d’abord une proposition une fois (onglet Plan). Un examen n’est jamais
              réutilisable.
            </p>
          ) : null}
          {!canManage ? (
            <Notice tone="neutral" icon="lock">
              Autorisation et révision réservées au médecin référent : lecture seule pour ce compte.
            </Notice>
          ) : null}
          <OutcomeNotice outcome={outcome} focusKey={focusKey} />
          {protocols.state.status === "loading" ? <Skeleton lines={4} /> : null}
          {protocols.state.status === "error" ? <ApiErrorState error={protocols.state.error} onRetry={protocols.reload} compact /> : null}
          {protocols.state.status === "ready" && protocols.state.value.protocols.length === 0 ? (
            <p className={styles.mutedBlock}>Aucun protocole pour ce patient. Toute nouvelle consigne passe par une revue.</p>
          ) : null}
          {protocols.state.status === "ready"
            ? protocols.state.value.protocols.map((protocol) => (
                <ProtocolCard
                  key={`${protocol.id}:${protocol.revision}`}
                  protocol={protocol}
                  facts={record.medicalFacts}
                  used={usedCount(log.state, protocol.id)}
                  canManage={canManage}
                  onRevise={openForm}
                  onState={openState}
                />
              ))
            : null}
        </div>
      </Card>

      <Card title="Journal des applications" padding="none">
        {log.state.status === "loading" ? (
          <div className={styles.panel}>
            <Skeleton lines={3} />
          </div>
        ) : null}
        {log.state.status === "error" ? <ApiErrorState error={log.state.error} onRetry={log.reload} compact /> : null}
        {log.state.status === "ready" ? <ProtocolApplicationsLog applications={log.state.value.applications} /> : null}
      </Card>

      <ProtocolForm
        session={formSession}
        patientId={patientId}
        record={record}
        context={currentContext}
        fence={fence}
        onClose={() => setFormSession(null)}
        onOutcome={report}
        onRefresh={refresh}
      />
      <ProtocolStateDialog target={stateTarget} fence={fence} onClose={() => setStateTarget(null)} onOutcome={report} />
    </div>
  );
}
