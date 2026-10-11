"use client";

/**
 * One binding row (simulator or real device) and the revoke confirmation.
 * A real-device row never claims a connection: its badge says the physical
 * link is unverified.
 */
import { useState } from "react";
import { Badge, Button, Dialog } from "@/components/ui";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { revokeConnector, type ConnectorView } from "@/lib/client/devices-api";
import { createClientId } from "@/lib/client/ids";
import { toApiError, type ApiError, type Language } from "@/lib/client/transport";
import { When } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import { ApiErrorNotice } from "../share/ApiErrorNotice";
import { invalidatesList } from "../share/use-fenced-resource";
import dev from "./devices.module.css";
import styles from "../patient.module.css";

function KindBadge({ connector, lang }: { connector: ConnectorView; lang: Language }) {
  if (connector.kind === "simulator") {
    return (
      <Badge tone="outline" icon="activity">
        {SHARE_COPY[lang].simulator.badge}
      </Badge>
    );
  }
  return (
    <Badge tone="outline" icon="help-circle">
      {SHARE_COPY[lang].devices.rowBadge}
    </Badge>
  );
}

export function ConnectorRow({ connector, lang, onRevoke, live }: { connector: ConnectorView; lang: Language; onRevoke: () => void; live: boolean }) {
  const copy = SHARE_COPY[lang].simulator;
  return (
    <li className={dev.connector}>
      <div className={dev.connectorText}>
        <span className={dev.deviceName} dir="ltr">
          {connector.deviceId}
        </span>
        <span className={styles.metaLine}>
          <When iso={connector.createdAt} lang={lang} />
        </span>
      </div>
      <div className={styles.inlineActions}>
        <KindBadge connector={connector} lang={lang} />
        {connector.enabled ? (
          <Button variant="ghost" iconStart="x" onClick={onRevoke} disabled={!live}>
            {copy.revoke}
          </Button>
        ) : (
          <Badge tone="muted" icon="x">
            {copy.revoked}
          </Badge>
        )}
      </div>
    </li>
  );
}

interface RevokeDialogProps {
  target: ConnectorView | null;
  fence: AccessFence;
  onClose: () => void;
  onRevoked: (connector: ConnectorView) => void;
  /** 409 or access refused: the list is reloaded before any new attempt. */
  onRefused: (error: ApiError) => void;
}

export function RevokeDialog({ target, fence, onClose, onRevoked, onRefused }: RevokeDialogProps) {
  const { lang, t } = usePatientRuntime();
  const copy = SHARE_COPY[lang].simulator;
  const text = target?.kind === "device" ? SHARE_COPY[lang].devices : copy;
  // One key per (binding, revision): a retry of the same revoke reuses it, a reloaded revision gets a new one.
  const [clientId, setClientId] = useState<{ target: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const close = () => {
    setError(null);
    setClientId(null);
    onClose();
  };

  const confirm = async () => {
    if (!target || busy) return;
    const targetKey = `${target.id}:${target.revision}`;
    const key = clientId?.target === targetKey ? clientId : { target: targetKey, value: createClientId("connector-revoke") };
    setClientId(key);
    setBusy(true);
    setError(null);
    try {
      const result = await runFenced(fence, () => revokeConnector(target.id, { expectedRevision: target.revision, clientId: key.value }));
      if (result.status === "current") {
        setClientId(null);
        onRevoked(result.value.connector);
      } else {
        close();
      }
    } catch (caught) {
      const failure = toApiError(caught);
      setError(failure);
      if (invalidatesList(failure)) {
        setClientId(null);
        onRefused(failure);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={target !== null}
      onClose={close}
      title={text.revokeTitle}
      description={text.revokeBody}
      closeLabel={t.common.close}
      size="sm"
      footer={
        <div className={styles.dialogActions}>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>
            {busy ? copy.revoking : copy.revoke}
          </Button>
        </div>
      }
    >
      <div className={styles.stackSm}>
        {target ? (
          <p className={dev.deviceName} dir="ltr">
            {target.deviceId}
          </p>
        ) : null}
        {error ? <ApiErrorNotice error={error} lang={lang} /> : null}
      </div>
    </Dialog>
  );
}
