"use client";

import { Field, TextArea, TextInput, describedBy } from "@/components/ui";
import { UNKNOWN_LANGUAGE_TEXT } from "@/components/layout/source-language";
import { LIMITS, type ResultDraft, type ResultErrors } from "./validation";
import styles from "./Review.module.css";

interface ResultFieldsProps {
  idPrefix: string;
  draft: ResultDraft;
  errors: ResultErrors;
  onChange: (key: keyof ResultDraft, value: string) => void;
  showExam: boolean;
  reasonLabel: string;
  reasonHint: string;
}

const UNIT_SUGGESTIONS = ["%", "mmol/mol", "g/L", "mg/dL", "mmol/L", "µmol/L"];

/** Editable exam/value/unit/date + mandatory reason, each with its own error. */
export function ResultFields({ idPrefix, draft, errors, onChange, showExam, reasonLabel, reasonHint }: ResultFieldsProps) {
  const id = (key: keyof ResultDraft) => `${idPrefix}-${key}`;
  const listId = `${idPrefix}-units`;
  return (
    <div className={styles.fields}>
      {showExam ? (
        <Field label="Examen" htmlFor={id("exam")} error={errors.exam} required>
          <TextInput
            id={id("exam")}
            value={draft.exam}
            maxLength={LIMITS.exam}
            invalid={Boolean(errors.exam)}
            aria-describedby={describedBy(id("exam"), { error: errors.exam })}
            onChange={(event) => onChange("exam", event.target.value)}
          />
        </Field>
      ) : null}
      <div className={styles.fieldRow}>
        <Field label="Valeur" htmlFor={id("value")} error={errors.value} required>
          <TextInput
            id={id("value")}
            inputMode="decimal"
            value={draft.value}
            invalid={Boolean(errors.value)}
            aria-describedby={describedBy(id("value"), { error: errors.value })}
            onChange={(event) => onChange("value", event.target.value)}
          />
        </Field>
        <Field label="Unité" htmlFor={id("unit")} error={errors.unit} required>
          <TextInput
            id={id("unit")}
            list={listId}
            value={draft.unit}
            maxLength={LIMITS.unit}
            autoComplete="off"
            invalid={Boolean(errors.unit)}
            aria-describedby={describedBy(id("unit"), { error: errors.unit })}
            onChange={(event) => onChange("unit", event.target.value)}
          />
        </Field>
        <datalist id={listId}>
          {UNIT_SUGGESTIONS.map((unit) => (
            <option key={unit} value={unit} />
          ))}
        </datalist>
        <Field label="Date d’examen" htmlFor={id("examDate")} error={errors.examDate} required>
          <TextInput
            id={id("examDate")}
            type="date"
            value={draft.examDate}
            invalid={Boolean(errors.examDate)}
            aria-describedby={describedBy(id("examDate"), { error: errors.examDate })}
            onChange={(event) => onChange("examDate", event.target.value)}
          />
        </Field>
      </div>
      <Field label={reasonLabel} htmlFor={id("reason")} hint={reasonHint} error={errors.reason} required>
        <TextArea
          {...UNKNOWN_LANGUAGE_TEXT}
          id={id("reason")}
          rows={2}
          value={draft.reason}
          maxLength={LIMITS.reason}
          invalid={Boolean(errors.reason)}
          aria-describedby={describedBy(id("reason"), { hint: reasonHint, error: errors.reason })}
          onChange={(event) => onChange("reason", event.target.value)}
        />
      </Field>
    </div>
  );
}
