"use client";

import { useState, type FormEvent } from "react";
import { Button, Checkbox, Field, Notice, SegmentedControl, TextArea, describedBy } from "@/components/ui";
import type { AccessFence } from "@/lib/client/access-fence";
import { reviewCandidate, type Candidate, type CandidateReviewResponse } from "@/lib/client/api";
import { DISCARDED_OUTCOME } from "../care/outcome";
import { applyWhenCurrent } from "../care/section-access";
import { errorText } from "../shared/ApiErrorState";
import { toCalendarInputValue } from "../shared/dates";
import { ResultFields } from "./ResultFields";
import { LIMITS, requiredReason, validateResult, type ResultDraft, type ResultErrors } from "./validation";
import styles from "./Review.module.css";

type Mode = "confirm" | "correct" | "reject";

interface CandidateReviewFormProps {
  candidate: Candidate;
  /** Record access fence: a decision returning after a revocation or patient switch is not applied. */
  fence: AccessFence;
  onReviewed: (result: CandidateReviewResponse) => void;
}

function initialDraft(candidate: Candidate): ResultDraft {
  return {
    exam: candidate.exam,
    value: candidate.value === null ? "" : String(candidate.value),
    unit: candidate.unit ?? "",
    examDate: toCalendarInputValue(candidate.examDate),
    reason: "",
  };
}

function missingFields(candidate: Candidate): string[] {
  return [
    candidate.value === null ? "valeur" : null,
    !candidate.unit ? "unité" : null,
    !candidate.examDate ? "date d’examen" : null,
  ].filter((item): item is string => item !== null);
}

const IDENTITY_CHECK_LABEL: Record<Candidate["identityMatch"], string> = {
  matched: "J’ai vérifié sur la source que le nom correspond bien à ce patient.",
  unknown: "J’ai vérifié l’identité du patient sur la source.",
  mismatch: "J’ai vérifié l’identité du patient sur la source malgré la discordance signalée.",
};

/** Confirm / correct-and-confirm / reject, each with its own required evidence. */
export function CandidateReviewForm({ candidate, fence, onReviewed }: CandidateReviewFormProps) {
  const missing = missingFields(candidate);
  const canConfirmAsIs = missing.length === 0;
  const [mode, setMode] = useState<Mode>(canConfirmAsIs ? "confirm" : "correct");
  const [identity, setIdentity] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ResultDraft>(() => initialDraft(candidate));
  const [errors, setErrors] = useState<ResultErrors>({});
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ title: string; text: string } | null>(null);

  const idBase = `cand-${candidate.id}`;
  const identityId = `${idBase}-identity`;
  const rejectId = `${idBase}-reject-reason`;

  const send = async (input: Parameters<typeof reviewCandidate>[1]) => {
    setPending(true);
    setFailure(null);
    try {
      const result = await applyWhenCurrent(fence, () => reviewCandidate(candidate.id, input), onReviewed);
      if (result.status === "discarded") setFailure({ title: "Résultat écarté", text: DISCARDED_OUTCOME.text });
    } catch (error) {
      setFailure({ title: "Décision non enregistrée", text: errorText(error) });
    } finally {
      setPending(false);
    }
  };

  const checkIdentity = (): boolean => {
    if (identity) return true;
    setIdentityError("Cochez cette case après avoir vérifié l’identité sur le PDF source.");
    document.getElementById(identityId)?.focus();
    return false;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "reject") {
      const problem = requiredReason(rejectReason, "Motif du rejet");
      setRejectError(problem);
      if (problem) {
        document.getElementById(rejectId)?.focus();
        return;
      }
      void send({ action: "reject", reason: rejectReason.trim() });
      return;
    }
    if (mode === "confirm") {
      if (!canConfirmAsIs || !checkIdentity()) return;
      void send({ action: "confirm", identityConfirmed: true });
      return;
    }
    const result = validateResult(draft, { checkExam: true });
    setErrors(result.errors);
    if (!result.value) {
      const first = (["exam", "value", "unit", "examDate", "reason"] as const).find((key) => result.errors[key]);
      if (first) document.getElementById(`${idBase}-correct-${first}`)?.focus();
      return;
    }
    if (!checkIdentity()) return;
    void send({ action: "confirm", ...result.value, identityConfirmed: true });
  };

  const identityBlock = (
    <div className={styles.identity} data-match={candidate.identityMatch}>
      {candidate.identityMatch !== "matched" ? (
        <p className={styles.identityWarning}>
          {candidate.identityMatch === "mismatch"
            ? "Le nom lu dans la source ne correspond pas à ce patient. Ne confirmez qu’après vérification sur le PDF."
            : "Le nom du patient n’a pas été retrouvé dans la source. Vérifiez l’identité sur le PDF avant de confirmer."}
        </p>
      ) : null}
      <Checkbox
        id={identityId}
        checked={identity}
        invalid={Boolean(identityError)}
        aria-describedby={identityError ? `${identityId}-error` : undefined}
        onChange={(event) => {
          setIdentity(event.target.checked);
          setIdentityError(null);
        }}
        label={IDENTITY_CHECK_LABEL[candidate.identityMatch]}
      />
      {identityError ? (
        <p id={`${identityId}-error`} className={styles.fieldError}>
          {identityError}
        </p>
      ) : null}
    </div>
  );

  return (
    <form className={styles.reviewForm} onSubmit={submit} noValidate>
      <SegmentedControl<Mode>
        ariaLabel={`Décision pour ${candidate.exam}`}
        size="sm"
        value={mode}
        onChange={(next) => {
          setMode(next);
          setFailure(null);
        }}
        options={[
          { value: "confirm", label: "Confirmer", icon: "check", disabled: !canConfirmAsIs },
          { value: "correct", label: "Corriger puis confirmer", icon: "edit" },
          { value: "reject", label: "Rejeter", icon: "x-circle" },
        ]}
      />

      {!canConfirmAsIs ? (
        <p className={styles.blocked}>
          Confirmation directe impossible : {missing.join(", ")} manquante{missing.length > 1 ? "s" : ""}. Complétez à partir
          de la source.
        </p>
      ) : null}

      {mode === "confirm" ? identityBlock : null}

      {mode === "correct" ? (
        <>
          <ResultFields
            idPrefix={`${idBase}-correct`}
            draft={draft}
            errors={errors}
            onChange={(key, value) => {
              setDraft((current) => ({ ...current, [key]: value }));
              if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
            }}
            showExam
            reasonLabel="Motif de la correction"
            reasonHint="Obligatoire. Conservé avec la valeur extraite d’origine."
          />
          {identityBlock}
        </>
      ) : null}

      {mode === "reject" ? (
        <Field label="Motif du rejet" htmlFor={rejectId} hint="Obligatoire. La proposition reste tracée." error={rejectError} required>
          <TextArea
            id={rejectId}
            rows={2}
            value={rejectReason}
            maxLength={LIMITS.reason}
            invalid={Boolean(rejectError)}
            aria-describedby={describedBy(rejectId, { hint: "Obligatoire. La proposition reste tracée.", error: rejectError })}
            onChange={(event) => {
              setRejectReason(event.target.value);
              setRejectError(undefined);
            }}
          />
        </Field>
      ) : null}

      {failure ? (
        <Notice tone="neutral" icon="x-circle" role="alert" title={failure.title}>
          {failure.text}
        </Notice>
      ) : null}

      <div className={styles.formActions}>
        <Button
          type="submit"
          variant={mode === "reject" ? "secondary" : "primary"}
          iconStart={mode === "reject" ? "x-circle" : "check"}
          loading={pending}
          disabled={mode === "confirm" && !canConfirmAsIs}
        >
          {mode === "confirm" ? "Confirmer la valeur" : mode === "correct" ? "Enregistrer la correction et confirmer" : "Rejeter la proposition"}
        </Button>
      </div>
    </form>
  );
}
