"use client";

import { Badge, Field, SegmentedControl, TextInput, Timestamp, describedBy } from "@/components/ui";
import { PLAN_DEADLINE_MAX_DAYS, type DeadlineChoice } from "./plan-update";
import styles from "./Care.module.css";

export const DEADLINE_PASSED = "Échéance dépassée";

interface ReviewDeadlineFieldProps {
  id: string;
  /** Deadline currently recorded on the plan (null: none). */
  current: string | null;
  /** The current deadline has passed (computed by the caller's clock). */
  overdue: boolean;
  /** false: deadline-only edit, where "Ne pas modifier" makes no sense. Default true. */
  allowKeep?: boolean;
  choice: DeadlineChoice["kind"];
  local: string;
  error: string | null;
  onChoice: (choice: DeadlineChoice["kind"]) => void;
  onLocal: (value: string) => void;
}

/** Optional clinician review deadline: keep (key omitted), set (UTC ISO), or clear (null). Nothing is pre-filled. */
export function ReviewDeadlineField({ id, current, overdue, allowKeep = true, choice, local, error, onChoice, onLocal }: ReviewDeadlineFieldProps) {
  const hint = `Au plus ${PLAN_DEADLINE_MAX_DAYS} jours, dans le futur. Heure de cet appareil, enregistrée en UTC.`;
  const options = [
    ...(allowKeep ? [{ value: "keep" as const, label: "Ne pas modifier" }] : []),
    { value: "set" as const, label: "Fixer une date" },
    { value: "clear" as const, label: "Effacer", disabled: current === null },
  ];
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{allowKeep ? "Date limite de revue (facultatif)" : "Date limite de revue"}</legend>
      <p className={styles.row}>
        <span className={styles.muted}>Actuelle :</span>
        {current ? <Timestamp iso={current} /> : <span className={styles.muted}>aucune</span>}
        {current && overdue ? (
          <Badge tone="outline" icon="clock">
            {DEADLINE_PASSED}
          </Badge>
        ) : null}
      </p>
      <p className={styles.mutedBlock}>Une revue en retard reste visible ; le silence du médecin ne vaut pas accord.</p>
      <SegmentedControl<DeadlineChoice["kind"]> ariaLabel="Date limite de revue" size="sm" value={choice} onChange={onChoice} options={options} />
      {choice === "set" ? (
        <Field label="Nouvelle date limite de revue" htmlFor={id} hint={hint} error={error} required>
          <TextInput
            id={id}
            type="datetime-local"
            value={local}
            invalid={Boolean(error)}
            aria-describedby={describedBy(id, { hint, error })}
            onChange={(event) => onLocal(event.target.value)}
          />
        </Field>
      ) : null}
      {choice === "clear" ? <p className={styles.mutedBlock}>La date limite actuelle sera retirée du plan.</p> : null}
    </fieldset>
  );
}
