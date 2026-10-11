"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button, Dialog, Field, Notice, TextArea, describedBy } from "@/components/ui";
import { UNKNOWN_LANGUAGE_TEXT } from "@/components/layout/source-language";
import { REVIEW_REASON_MAX } from "./message-state";
import { messageReviewFocusFallback } from "./MessageItem";
import styles from "./Comms.module.css";

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  submitting: boolean;
  /** Server failure, kept until the next attempt. */
  failure: ReactNode | null;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}

/**
 * Confirmation that records a required, attributable reason. Mount it with a
 * `key` per target so the reason starts empty for every new action.
 */
export function ReasonDialog({ open, title, description, confirmLabel, submitting, failure, onSubmit, onClose }: ReasonDialogProps) {
  const reasonId = useId();
  const formId = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hint = `Visible dans l’historique, ${REVIEW_REASON_MAX} caractères au plus.`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = reason.trim();
    const problem = !trimmed ? "Indiquez un motif." : trimmed.length > REVIEW_REASON_MAX ? `${REVIEW_REASON_MAX} caractères au maximum.` : null;
    setError(problem);
    if (problem) {
      document.getElementById(reasonId)?.focus();
      return;
    }
    onSubmit(trimmed);
  };

  // While the request is in flight the dialog stays open, so its answer cannot land on another target.
  const close = () => {
    if (!submitting) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      closeOnBackdrop={false}
      // Only an opener inside a marked message gets a stand-in; other reason dialogs keep plain opener return.
      returnFocusFallback={messageReviewFocusFallback}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            Annuler
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.stack} onSubmit={submit} noValidate>
        <div className={styles.mutedBlock}>{description}</div>
        <Field label="Motif" htmlFor={reasonId} hint={hint} error={error} required>
          <TextArea
            {...UNKNOWN_LANGUAGE_TEXT}
            id={reasonId}
            value={reason}
            rows={3}
            maxLength={REVIEW_REASON_MAX}
            invalid={Boolean(error)}
            aria-describedby={describedBy(reasonId, { hint, error })}
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        {failure ? (
          <Notice tone="neutral" icon="x-circle" role="alert" title="Rien n’a été enregistré">
            {failure}
          </Notice>
        ) : null}
      </form>
    </Dialog>
  );
}
