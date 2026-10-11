"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, Dialog, Field, Notice, TextArea, describedBy } from "@/components/ui";
import { UNKNOWN_LANGUAGE_TEXT } from "@/components/layout/source-language";
import type { ProtocolStateInput, ReusableProtocol } from "@/contracts/monitoring";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { PROTOCOL_FORM_LIMITS, setProtocolState } from "@/lib/client/assist-api";
import { ASSIST_COPY } from "@/lib/client/copy/assist";
import { createClientId } from "@/lib/client/ids";
import { errorText } from "../shared/ApiErrorState";
import { nextAttempt, type Attempt } from "./idempotency";
import { DISCARDED_OUTCOME, classifyConflict, type Outcome } from "./outcome";
import { buildProtocolStateInput } from "./protocol-authorization";
import styles from "./Care.module.css";

export interface ProtocolStateTarget {
  protocol: ReusableProtocol;
  action: ProtocolStateInput["action"];
  /** Distinguishes two openings (resets the form). */
  nonce: number;
}

interface ProtocolStateDialogProps {
  target: ProtocolStateTarget | null;
  fence: AccessFence;
  onClose: () => void;
  onOutcome: (outcome: Outcome) => void;
}

/** Suspend or revoke with a required reason, bound to the protocol revision shown. */
export function ProtocolStateDialog({ target, fence, onClose, onOutcome }: ProtocolStateDialogProps) {
  const reasonId = `${useId()}-reason`;
  const formId = `${reasonId}-form`;
  const [formKey, setFormKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);

  const key = target ? `${target.protocol.id}:${target.action}:${target.nonce}` : null;
  if (key !== formKey) {
    setFormKey(key);
    setReason("");
    setError(null);
    setFailure(null);
    setAttempt(null);
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || busy) return;
    const built = buildProtocolStateInput(target.protocol, target.action, reason, "");
    setFailure(null);
    if (!built.ok) {
      setError(built.error);
      document.getElementById(reasonId)?.focus();
      return;
    }
    setError(null);
    // Same payload: same key (safe retry). Edited reason: new key.
    const next = nextAttempt(attempt, built.input, () => createClientId(`protocol-${target.action}`));
    setAttempt(next);
    const input = { ...built.input, clientId: next.clientId };
    setBusy(true);
    try {
      const result = await runFenced(fence, () => setProtocolState(target.protocol.id, input));
      if (result.status === "stale") onOutcome(DISCARDED_OUTCOME);
      else onOutcome({ ok: true, text: `${ASSIST_COPY.fr.protocolState[result.value.protocol.state]} — version ${result.value.protocol.revision}, motif enregistré.` });
    } catch (caught) {
      const conflict = classifyConflict(caught);
      if (conflict.kind === "other") setFailure(errorText(caught));
      else onOutcome({ ok: false, text: `Protocole modifié entre-temps : ${conflict.text}` });
    } finally {
      setBusy(false);
    }
  };

  const revoke = target?.action === "revoke";
  return (
    <Dialog
      open={target !== null}
      onClose={() => (busy ? undefined : onClose())}
      closeOnBackdrop={!busy}
      title={revoke ? "Retirer le protocole" : "Suspendre le protocole"}
      description={
        revoke
          ? "Le retrait est définitif : aucune nouvelle application. L’historique et les applications passées restent consultables."
          : "Aucune nouvelle application pendant la suspension. Seule une nouvelle version explicite pourra l’autoriser à nouveau."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" form={formId} variant={revoke ? "danger" : "primary"} loading={busy}>
            {revoke ? "Retirer définitivement" : "Suspendre"}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Motif" htmlFor={reasonId} error={error} required>
          <TextArea
            {...UNKNOWN_LANGUAGE_TEXT}
            id={reasonId}
            rows={3}
            maxLength={PROTOCOL_FORM_LIMITS.reasonMax}
            value={reason}
            invalid={Boolean(error)}
            aria-describedby={describedBy(reasonId, { error })}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {failure ? (
          <Notice tone="neutral" icon="x-circle" role="alert" title="État du protocole inchangé">
            {failure}
          </Notice>
        ) : null}
      </form>
    </Dialog>
  );
}
