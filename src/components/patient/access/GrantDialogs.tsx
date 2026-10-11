"use client";

/**
 * Confirmations for one grant: revocation (the only place with a danger
 * button) and a section change for a secondary doctor. Both send the grant's
 * revision; a 409 or a discarded answer closes the dialog and makes the parent
 * reload the list. A retry resends the same request (same clientId); an edit
 * starts a new one.
 */
import { useRef, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import type { CareGrant, GrantUpdate, SharingScope } from "@/contracts/patient-platform";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import { updateGrant } from "@/lib/client/grants-api";
import { createClientId } from "@/lib/client/ids";
import type { ApiError } from "@/lib/client/transport";
import { usePatientRuntime } from "../PatientRuntime";
import { ApiErrorNotice } from "../record/ApiErrorNotice";
import { fencedCall } from "../record/fenced-call";
import { validateScopeSelection } from "./access-model";
import { ScopePicker, scopeInputId } from "./ScopePicker";
import styles from "./access.module.css";

export interface GrantDialogProps {
  grant: CareGrant;
  doctorName: string;
  onClose: () => void;
  onUpdated: (grant: CareGrant) => void;
  onConflict: () => void;
  /** The answer came back after the authority moved and was not shown. */
  onDiscarded: () => void;
}

function useGrantUpdate({ grant, onUpdated, onConflict, onDiscarded }: Pick<GrantDialogProps, "grant" | "onUpdated" | "onConflict" | "onDiscarded">) {
  const { data } = usePatientRuntime();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const pending = useRef<GrantUpdate | null>(null);

  const run = async (build: (clientId: string) => GrantUpdate) => {
    if (busy) return;
    const input = pending.current ?? build(createClientId("grant-update"));
    pending.current = input;
    // Captured once: after the await only this fence decides (a switch retires it).
    const fence = data.fence;
    setBusy(true);
    setFailure(null);
    const result = await fencedCall(fence, () => updateGrant(grant.id, input));
    setBusy(false);
    if (result.status === "stale") {
      if (!fence.denied()) onDiscarded();
      return;
    }
    if (result.status === "error") {
      if (result.error.isConflict) {
        pending.current = null;
        onConflict();
      } else {
        setFailure(result.error);
      }
      return;
    }
    pending.current = null;
    onUpdated(result.value.grant);
  };

  const restart = () => {
    pending.current = null;
  };

  return { busy, failure, run, restart };
}

export function RevokeDialog(props: GrantDialogProps) {
  const { grant, doctorName, onClose } = props;
  const { lang, t } = usePatientRuntime();
  const copy = ACCESS_COPY[lang];
  const { busy, failure, run } = useGrantUpdate(props);

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        {t.common.cancel}
      </Button>
      <Button
        variant="danger"
        iconStart="x-circle"
        loading={busy}
        onClick={() => void run((clientId) => ({ action: "revoke", expectedRevision: grant.revision, clientId }))}
      >
        {busy ? copy.doctors.revoking : copy.doctors.revokeConfirm}
      </Button>
    </>
  );

  return (
    <Dialog open onClose={onClose} title={copy.doctors.revokeTitle} description={copy.doctors.revokeBody} footer={footer} closeLabel={t.common.close} size="sm">
      <div className={styles.stack}>
        <p className={styles.inlineNote}>
          <bdi>{doctorName}</bdi> · {copy.relationship[grant.relationship]}
        </p>
        {failure ? <ApiErrorNotice error={failure} lang={lang} /> : null}
      </div>
    </Dialog>
  );
}

const sameScopes = (a: readonly SharingScope[], b: readonly SharingScope[]) => a.length === b.length && a.every((scope) => b.includes(scope));

export function ScopeDialog(props: GrantDialogProps) {
  const { grant, doctorName, onClose } = props;
  const { lang, t } = usePatientRuntime();
  const copy = ACCESS_COPY[lang].doctors;
  const [scopes, setScopes] = useState<SharingScope[]>(grant.scopes);
  const [showErrors, setShowErrors] = useState(false);
  const { busy, failure, run, restart } = useGrantUpdate(props);
  const selection = validateScopeSelection(scopes);
  const unchanged = sameScopes(scopes, grant.scopes);

  const save = () => {
    if (selection.error) {
      setShowErrors(true);
      document.getElementById(scopeInputId("edit-scope", selection.missing[0] ?? "status"))?.focus();
      return;
    }
    void run((clientId) => ({ action: "update", scopes, expectedRevision: grant.revision, clientId }));
  };

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        {t.common.cancel}
      </Button>
      <Button variant="primary" iconStart="check" loading={busy} disabled={unchanged} onClick={save}>
        {copy.saveScopes}
      </Button>
    </>
  );

  return (
    <Dialog open onClose={onClose} title={copy.editScopes} description={<bdi>{doctorName}</bdi>} footer={footer} closeLabel={t.common.close} closeOnBackdrop={false}>
      <div className={styles.stack}>
        <ScopePicker
          idPrefix="edit-scope"
          lang={lang}
          selected={scopes}
          locked={false}
          missing={selection.missing}
          emptyError={showErrors && selection.error === "empty"}
          onChange={(next) => {
            restart();
            setScopes(next);
          }}
        />
        {failure ? <ApiErrorNotice error={failure} lang={lang} /> : null}
      </div>
    </Dialog>
  );
}
