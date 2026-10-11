"use client";

import { useState, type FormEvent } from "react";
import { Button, Notice, Timestamp } from "@/components/ui";
import type { AccessFence } from "@/lib/client/access-fence";
import { correctObservation, type Observation } from "@/lib/client/api";
import { formatNumber } from "@/lib/client/format";
import { DISCARDED_OUTCOME } from "../care/outcome";
import { applyWhenCurrent } from "../care/section-access";
import { errorText } from "../shared/ApiErrorState";
import { formatCalendarDate, toCalendarInputValue } from "../shared/dates";
import { ResultFields } from "./ResultFields";
import { validateResult, type ResultDraft, type ResultErrors } from "./validation";
import styles from "./Review.module.css";

interface ObservationPanelProps {
  observation: Observation;
  /** Correction needs lab-review authority; otherwise value and history are read-only. */
  editable: boolean;
  /** Record access fence: a correction returning after a revocation or patient switch is not applied. */
  fence: AccessFence;
  onUpdated: (observation: Observation) => void;
}

function draftFrom(observation: Observation): ResultDraft {
  return {
    exam: observation.exam,
    value: String(observation.value),
    unit: observation.unit,
    examDate: toCalendarInputValue(observation.examDate),
    reason: "",
  };
}

/** Confirmed (trusted) value with its full revision history and a correction form. */
export function ObservationPanel({ observation, editable, fence, onUpdated }: ObservationPanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ResultDraft>(() => draftFrom(observation));
  const [errors, setErrors] = useState<ResultErrors>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const idBase = `obs-${observation.id}`;

  const open = () => {
    setDraft(draftFrom(observation));
    setErrors({});
    setFailure(null);
    setSuccess(null);
    setEditing(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateResult(draft, { checkExam: false });
    setErrors(result.errors);
    if (!result.value) {
      const first = (["value", "unit", "examDate", "reason"] as const).find((key) => result.errors[key]);
      if (first) document.getElementById(`${idBase}-${first}`)?.focus();
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const { value, unit, examDate, reason } = result.value;
      const outcome = await applyWhenCurrent(
        fence,
        () => correctObservation(observation.id, { value, unit, examDate, reason }),
        (response) => onUpdated(response.observation),
      );
      if (outcome.status === "discarded") {
        setFailure(DISCARDED_OUTCOME.text);
        return;
      }
      setEditing(false);
      setSuccess("Correction enregistrée. La valeur précédente, l’auteur et le motif restent visibles ci-dessous.");
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setPending(false);
    }
  };

  const revisions = [...observation.revisions].reverse();

  return (
    <div className={styles.observation}>
      <div className={styles.observationHead}>
        <div>
          <p className={styles.eyebrow}>Résultat confirmé (dans le dossier)</p>
          <p className={styles.observationValue}>
            {observation.exam} : {formatNumber(observation.value, "fr", 2)} {observation.unit}
          </p>
          <p className={styles.muted}>
            Examen du {formatCalendarDate(observation.examDate)} · confirmé par{" "}
            <span className={styles.mono}>{observation.confirmedBy}</span>, <Timestamp iso={observation.confirmedAt} />
          </p>
        </div>
        {editable && !editing ? (
          <Button size="sm" variant="secondary" iconStart="edit" onClick={open}>
            Corriger
          </Button>
        ) : null}
      </div>

      {success ? <Notice tone="success">{success}</Notice> : null}

      {editable && editing ? (
        <form className={styles.reviewForm} onSubmit={(event) => void submit(event)} noValidate>
          <ResultFields
            idPrefix={idBase}
            draft={draft}
            errors={errors}
            onChange={(key, value) => {
              setDraft((current) => ({ ...current, [key]: value }));
              if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
            }}
            showExam={false}
            reasonLabel="Motif de la correction"
            reasonHint="Obligatoire. L’ancienne valeur est conservée dans l’historique."
          />
          {failure ? (
            <Notice tone="neutral" icon="x-circle" role="alert" title="Correction non enregistrée">
              {failure}
            </Notice>
          ) : null}
          <div className={styles.formActions}>
            <Button type="submit" variant="primary" iconStart="check" loading={pending}>
              Enregistrer la correction
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              Annuler
            </Button>
          </div>
        </form>
      ) : null}

      <div>
        <h4 className={styles.historyTitle}>Historique des corrections ({observation.revisions.length})</h4>
        {revisions.length === 0 ? (
          <p className={styles.muted}>Aucune correction depuis la confirmation.</p>
        ) : (
          <ol className={styles.revisions}>
            {revisions.map((revision, index) => (
              <li key={`${revision.at}-${index}`}>
                <p>
                  Valeur précédente{" "}
                  <strong className={styles.num}>
                    {formatNumber(revision.value, "fr", 2)} {revision.unit}
                  </strong>{" "}
                  (examen du {formatCalendarDate(revision.examDate)})
                </p>
                <p className={styles.muted}>
                  Remplacée par <span className={styles.mono}>{revision.author}</span>, <Timestamp iso={revision.at} />
                </p>
                <p className={styles.reasonQuote}>Motif : {revision.reason}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
