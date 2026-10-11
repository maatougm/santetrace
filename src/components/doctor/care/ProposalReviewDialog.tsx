"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, Dialog, Field, Notice, Select, TextArea, describedBy } from "@/components/ui";
import { UNKNOWN_LANGUAGE_TEXT } from "@/components/layout/source-language";
import type { CareProposal, RevisionGuard } from "@/contracts/monitoring";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { reviewProposal, reviseProposal, type ProposalReviewResult } from "@/lib/client/care-api";
import { CARE_COPY, templateText } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import { errorText } from "../shared/ApiErrorState";
import { fmtDateTime } from "../shared/time";
import { sameGuard } from "./guard";
import { nextAttempt, type Attempt } from "./idempotency";
import { DISCARDED_OUTCOME, classifyConflict, type Outcome } from "./outcome";
import { EDITABLE_TEMPLATE_IDS, REVIEW_LIMITS, buildDecisionInput, buildEditInput, initialEditTemplate } from "./proposal-review";
import type { ReviewMode } from "./ProposalItem";
import styles from "./Care.module.css";

const copy = CARE_COPY.fr;

export interface ReviewTarget {
  mode: ReviewMode;
  proposal: CareProposal;
  /** Distinguishes two openings of the same dialog (resets the form). */
  nonce: number;
}

interface ProposalReviewDialogProps {
  target: ReviewTarget | null;
  /** Current server guard sent as expectedGuard; null blocks every decision. */
  currentGuard: RevisionGuard | null;
  fence: AccessFence;
  onClose: () => void;
  onOutcome: (outcome: Outcome) => void;
  /** 409: the record moved on or the key was reused; the proposal must be re-examined. */
  onConflict: (proposal: CareProposal, text: string) => void;
}

const TITLE: Record<ReviewMode, string> = {
  approve: "Valider une fois",
  reject: "Ne pas retenir cette proposition",
  edit: "Modifier la proposition",
};

function approvedMessage(result: ProposalReviewResult): string {
  const { proposal, action } = result;
  const by = proposal.decision ? `par ${proposal.decision.clinicianId}` : "";
  const created = action
    ? `Action ajoutée au plan : ${templateText(action.action.templateId, "fr")} (échéance ${fmtDateTime(action.dueAt)}).`
    : "Le serveur n’a créé aucune action.";
  return `Validée une fois ${by} — révision ${proposal.revision}. ${created} Aucun protocole réutilisable n’a été créé.`;
}

/** Approve once or reject (reason required), or edit (new revision). Bound to the reviewed revision and guard. */
export function ProposalReviewDialog({ target, currentGuard, fence, onClose, onOutcome, onConflict }: ProposalReviewDialogProps) {
  const context = { currentGuard };
  // A stale draft can be re-bound to the current record with its own action.
  const stale = Boolean(target && currentGuard && !sameGuard(target.proposal.guard, currentGuard));
  const baseId = useId();
  const reasonId = `${baseId}-reason`;
  const templateFieldId = `${baseId}-template`;
  const formId = `${baseId}-form`;
  const [formKey, setFormKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [template, setTemplate] = useState("");
  const [error, setError] = useState<{ field: "reason" | "template"; text: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);

  const key = target ? `${target.mode}:${target.proposal.id}:${target.proposal.revision}:${target.nonce}` : null;
  if (key !== formKey) {
    setFormKey(key);
    setReason("");
    setTemplate(initialEditTemplate(target, currentGuard));
    setError(null);
    setFailure(null);
    setAttempt(null);
  }

  const showError = (field: "reason" | "template", text: string) => {
    setError({ field, text });
    document.getElementById(field === "reason" ? reasonId : templateFieldId)?.focus();
  };

  const send = async (proposal: CareProposal, mode: ReviewMode, clientId: string) => {
    if (mode === "edit") {
      const built = buildEditInput(proposal, template, reason, clientId, context);
      if (!built.ok) return null;
      const result = await runFenced(fence, () => reviseProposal(proposal.id, built.input));
      return result.status === "stale" ? null : `Nouvelle révision ${result.value.proposal.revision} enregistrée. Une décision séparée reste nécessaire.`;
    }
    const built = buildDecisionInput(proposal, mode, reason, clientId, context);
    if (!built.ok) return null;
    const result = await runFenced(fence, () => reviewProposal(proposal.id, built.input));
    if (result.status === "stale") return null;
    return mode === "approve" ? approvedMessage(result.value) : `Non retenue — révision ${result.value.proposal.revision}, motif enregistré.`;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || busy) return;
    const { mode, proposal } = target;
    setError(null);
    setFailure(null);
    const draft = mode === "edit" ? buildEditInput(proposal, template, reason, "", context) : buildDecisionInput(proposal, mode, reason, "", context);
    if (!draft.ok) {
      showError(mode === "edit" && !EDITABLE_TEMPLATE_IDS.includes(template) ? "template" : "reason", draft.error);
      return;
    }
    // Same payload: same key (safe retry). Edited payload: new key.
    const next = nextAttempt(attempt, draft.input, () => createClientId(`proposal-${mode}`));
    setAttempt(next);
    setBusy(true);
    try {
      const message = await send(proposal, mode, next.clientId);
      onOutcome(message ? { ok: true, text: message } : DISCARDED_OUTCOME);
    } catch (caught) {
      const conflict = classifyConflict(caught);
      if (conflict.kind === "other") setFailure(errorText(caught));
      else onConflict(proposal, conflict.text);
    } finally {
      setBusy(false);
    }
  };

  const mode = target?.mode ?? "approve";
  const proposal = target?.proposal;
  const reasonError = error?.field === "reason" ? error.text : null;
  const templateError = error?.field === "template" ? error.text : null;

  return (
    <Dialog
      open={target !== null}
      onClose={() => (busy ? undefined : onClose())}
      closeOnBackdrop={!busy}
      title={TITLE[mode]}
      description={proposal ? `${copy.proposalKind[proposal.kind]} · ${templateText(proposal.action.templateId, "fr")} · révision ${proposal.revision}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {mode === "approve" ? "Valider une fois" : mode === "reject" ? "Ne pas retenir" : "Enregistrer la révision"}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        {mode === "approve" ? (
          <Notice tone="info" title="Validation unique — ne crée pas de protocole réutilisable">
            L’action est ajoutée une fois au plan du patient. Une réutilisation demande une autorisation séparée et bornée (« Autoriser une
            réutilisation bornée », onglet Protocoles).
          </Notice>
        ) : null}
        {mode === "edit" ? (
          <>
            <p className={styles.mutedBlock}>
              La modification crée une nouvelle révision liée au dossier actuel. Elle devra ensuite être validée ou rejetée séparément.
              {stale ? " Le dossier a changé depuis ce brouillon : vous pouvez garder la même action pour le réexaminer." : ""}
            </p>
            <Field label="Action du registre" htmlFor={templateFieldId} error={templateError} required>
              <Select
                id={templateFieldId}
                value={template}
                invalid={Boolean(templateError)}
                aria-describedby={describedBy(templateFieldId, { error: templateError })}
                onChange={(event) => setTemplate(event.target.value)}
              >
                <option value="">Choisir…</option>
                {EDITABLE_TEMPLATE_IDS.map((id) => (
                  <option key={id} value={id} disabled={id === proposal?.action.templateId && !stale}>
                    {templateText(id, "fr")} ({id})
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : null}
        <Field label={mode === "approve" ? "Motif de la validation" : "Motif"} htmlFor={reasonId} error={reasonError} required>
          <TextArea
            {...UNKNOWN_LANGUAGE_TEXT}
            id={reasonId}
            value={reason}
            rows={3}
            maxLength={REVIEW_LIMITS.reasonMax}
            invalid={Boolean(reasonError)}
            aria-describedby={describedBy(reasonId, { error: reasonError })}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {failure ? (
          <Notice tone="neutral" icon="x-circle" role="alert" title="Décision non enregistrée">
            {failure}
          </Notice>
        ) : null}
      </form>
    </Dialog>
  );
}
