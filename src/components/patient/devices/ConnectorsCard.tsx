"use client";

/**
 * Bindings: list, explicit pairing of a simulator or a real device, revoke
 * after confirmation. Pairing a real device creates a server binding and a
 * one-time credential; it is never a Bluetooth or physical connection. Every
 * result is fenced; a failure replaces the list instead of keeping data from an
 * earlier access context. The credential lives in this component's memory only
 * and is wiped on any access-context change (see credential-state.ts).
 */
import { useCallback, useEffect, useId, useReducer, useState, useSyncExternalStore } from "react";
import { Card, EmptyState, ErrorState, Notice, SegmentedControl, Skeleton, type SegmentedOption } from "@/components/ui";
import type { AccessFence, FencedResult } from "@/lib/client/access-fence";
import { SHARE_COPY } from "@/lib/client/copy/share";
import type { ConnectorKind, ConnectorView, PairResult } from "@/lib/client/devices-api";
import { describeApiError, type ApiError } from "@/lib/client/transport";
import { usePatientRuntime } from "../PatientRuntime";
import type { FencedResource } from "../share/use-fenced-resource";
import { ConnectorRow, RevokeDialog } from "./ConnectorRows";
import { CredentialNotice } from "./CredentialNotice";
import { NO_CREDENTIAL, credentialReducer, pairedAction, sameScope, visibleCredential, type CredentialScope } from "./credential-state";
import { DeviceSetupGuide } from "./DeviceSetupGuide";
import { PairForm } from "./PairForm";
import dev from "./devices.module.css";
import styles from "../patient.module.css";

export type ConnectorList = { connectors: ConnectorView[] };

export function upsertConnector(list: ConnectorList, connector: ConnectorView): ConnectorList {
  const exists = list.connectors.some((c) => c.id === connector.id);
  return {
    connectors: exists ? list.connectors.map((c) => (c.id === connector.id ? connector : c)) : [connector, ...list.connectors],
  };
}

interface ConnectorsCardProps {
  patientId: string;
  fence: AccessFence;
  live: boolean;
  resource: FencedResource<ConnectorList>;
}

/**
 * In-memory credential bound to (patient, fence key, epoch). A fence move
 * wipes it as it happens; a scope change or access denial seen at render
 * wipes it before anything is drawn; unmount drops it with the component.
 */
function useCredential(patientId: string, fence: AccessFence, accessDenied: boolean) {
  const epoch = useSyncExternalStore(fence.subscribe, fence.epoch, fence.epoch);
  const [state, dispatch] = useReducer(credentialReducer, NO_CREDENTIAL);
  const scope: CredentialScope = { patientId, fenceKey: fence.key, epoch };

  useEffect(() => fence.subscribe(() => dispatch({ type: "fence_moved" })), [fence]);

  if (state.status === "shown" && (accessDenied || !sameScope(state.scope, scope))) {
    dispatch(accessDenied ? { type: "access_denied" } : { type: "scope_changed", scope });
  }

  /** Read live after an await: the scope the fenced result actually completed under. */
  const scopeNow = useCallback((): CredentialScope => ({ patientId, fenceKey: fence.key, epoch: fence.epoch() }), [patientId, fence]);
  return { shown: visibleCredential(state, scope), dispatch, scopeNow };
}

export function ConnectorsCard({ patientId, fence, live, resource }: ConnectorsCardProps) {
  const { lang, t } = usePatientRuntime();
  const copy = SHARE_COPY[lang].simulator;
  const devices = SHARE_COPY[lang].devices;
  const guideId = `${useId()}-guide`;
  const [mode, setMode] = useState<ConnectorKind>("simulator");
  const [revokeTarget, setRevokeTarget] = useState<ConnectorView | null>(null);
  const { state, reload, update } = resource;
  const accessDenied = (state.status === "error" && state.error.isAccessDenied) || fence.denied();
  const { shown, dispatch, scopeNow } = useCredential(patientId, fence, accessDenied);

  const onSettled = (result: FencedResult<PairResult>) => {
    // Stale (access changed in flight): no credential, no list change.
    if (result.status !== "current") return;
    const action = pairedAction(result, scopeNow());
    update((list) => upsertConnector(list, result.value.connector));
    if (action) dispatch(action);
    reload();
  };

  const onRefused = (error: ApiError) => {
    if (error.isAccessDenied) dispatch({ type: "access_denied" });
    reload();
  };

  const modeOptions: SegmentedOption<ConnectorKind>[] = [
    { value: "simulator", label: devices.modeSimulator, icon: "activity" },
    { value: "device", label: devices.modeDevice, icon: "link" },
  ];

  const body = () => {
    // Offline before the first answer: the page-level offline notice says why nothing is listed.
    if (state.status === "loading") return live ? <Skeleton lines={2} /> : null;
    if (state.status === "error") {
      const description = describeApiError(state.error, lang);
      return <ErrorState compact title={description.title} message={description.message} code={description.code} onRetry={reload} retryLabel={t.common.retry} />;
    }
    if (state.value.connectors.length === 0) return <EmptyState compact icon="activity" title={copy.connectorsEmpty} />;
    return (
      <ul className={dev.connectorList}>
        {state.value.connectors.map((connector) => (
          <ConnectorRow key={connector.id} connector={connector} lang={lang} live={live} onRevoke={() => setRevokeTarget(connector)} />
        ))}
      </ul>
    );
  };

  return (
    <Card id="sim-connectors" title={copy.connectorsTitle}>
      <div className={styles.stack}>
        {body()}
        {shown ? (
          <CredentialNotice
            shown={shown}
            lang={lang}
            closeLabel={t.common.close}
            onToggle={() => dispatch({ type: "toggle_reveal" })}
            onAcknowledge={() => dispatch({ type: "acknowledge" })}
          />
        ) : null}
        <div className={dev.pairSection}>
          <div className={dev.block}>
            <p className={dev.blockLabel}>{devices.modeLabel}</p>
            <SegmentedControl<ConnectorKind> options={modeOptions} value={mode} onChange={setMode} ariaLabel={devices.modeLabel} size="lg" fullWidth />
          </div>
          {mode === "device" ? (
            <Notice tone="info" icon="info" role="note">
              {devices.bindingNotice}
            </Notice>
          ) : (
            <p className={styles.metaLine}>{devices.simulatorHint}</p>
          )}
          <PairForm key={mode} kind={mode} patientId={patientId} fence={fence} live={live} onSettled={onSettled} onRefused={onRefused} />
          {mode === "device" ? <DeviceSetupGuide lang={lang} headingId={guideId} /> : null}
        </div>
      </div>
      <RevokeDialog
        target={revokeTarget}
        fence={fence}
        onClose={() => setRevokeTarget(null)}
        onRefused={onRefused}
        onRevoked={(connector) => {
          // Called only for a current fenced result: clears the secret of THIS server binding only.
          dispatch({ type: "connector_revoked", connectorId: connector.id });
          update((list) => upsertConnector(list, connector));
          setRevokeTarget(null);
          reload();
        }}
      />
    </Card>
  );
}
