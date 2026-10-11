"use client";

import { useId, useState } from "react";
import { Button, Dialog, Notice } from "@/components/ui";
import type { CarePlan } from "@/contracts/monitoring";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { updateCarePlan } from "@/lib/client/care-api";
import { createClientId } from "@/lib/client/ids";
import { errorText } from "../shared/ApiErrorState";
import { fmtDateTime } from "../shared/time";
import { nextAttempt, type Attempt } from "./idempotency";
import { DISCARDED_OUTCOME, classifyConflict, type Outcome } from "./outcome";
import { buildDeadlineEdit, type DeadlineEdit } from "./plan-update";
import { ReviewDeadlineField } from "./ReviewDeadlineField";

interface DeadlineEditDialogProps {
  /** The active plan being edited; null closes the dialog. */
  plan: CarePlan | null;
  patientId: string;
  overdue: boolean;
  fence: AccessFence;
  onClose: () => void;
  onOutcome: (outcome: Outcome) => void;
}

/**
 * Deadline-only edit of an active plan (primary referent). Re-sends
 * "activate" with the current bindings and revision; never suspends.
 */
export function DeadlineEditDialog({ plan, patientId, overdue, fence, onClose, onOutcome }: DeadlineEditDialogProps) {
  const fieldId = `${useId()}-deadline-edit`;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [choice, setChoice] = useState<DeadlineEdit["kind"]>("set");
  const [local, setLocal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);

  const key = plan ? `${plan.id}:${plan.revision}` : null;
  if (key !== openKey) {
    setOpenKey(key);
    setChoice("set");
    setLocal("");
    setError(null);
    setFailure(null);
    setAttempt(null);
  }

  const submit = async () => {
    if (!plan || busy) return;
    const built = buildDeadlineEdit(plan, choice === "set" ? { kind: "set", local } : { kind: "clear" }, new Date());
    if (!built.ok) {
      setError(built.error);
      document.getElementById(fieldId)?.focus();
      return;
    }
    setError(null);
    setFailure(null);
    // Same payload: same key (safe retry). Another date or revision: new key.
    const next = nextAttempt(attempt, built.input, () => createClientId("plan-deadline"));
    setAttempt(next);
    setBusy(true);
    try {
      const result = await runFenced(fence, () => updateCarePlan(patientId, { ...built.input, clientId: next.clientId }));
      if (result.status === "stale") return onOutcome(DISCARDED_OUTCOME);
      const deadline = result.value.plan?.reviewDeadline ?? null;
      onOutcome({
        ok: true,
        text: deadline
          ? `Date limite de revue enregistrée par le serveur : ${fmtDateTime(deadline)}. Le plan reste actif.`
          : "Date limite de revue effacée par le serveur. Le plan reste actif.",
      });
    } catch (caught) {
      // 400 (invalid deadline) and 409 (plan changed) keep the dialog open with the server's reason.
      const conflict = classifyConflict(caught);
      setFailure(conflict.kind === "other" ? errorText(caught) : conflict.text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={plan !== null}
      onClose={() => (busy ? undefined : onClose())}
      closeOnBackdrop={!busy}
      title="Modifier la date limite de revue"
      description="Le plan reste actif avec ses profils actuels ; seule la date limite change."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            {choice === "clear" ? "Effacer la date limite" : "Enregistrer la date limite"}
          </Button>
        </>
      }
    >
      <ReviewDeadlineField
        id={fieldId}
        current={plan?.reviewDeadline ?? null}
        overdue={overdue}
        allowKeep={false}
        choice={choice}
        local={local}
        error={error}
        onChoice={(next) => {
          if (next !== "keep") setChoice(next);
          setError(null);
        }}
        onLocal={(value) => {
          setLocal(value);
          setError(null);
        }}
      />
      {failure ? (
        <Notice tone="neutral" icon="x-circle" role="alert" title="Date limite non modifiée">
          {failure}
        </Notice>
      ) : null}
    </Dialog>
  );
}
