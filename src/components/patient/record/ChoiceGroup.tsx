"use client";

/**
 * Native radio group in a fieldset: the legend names the group, each option
 * is a 44px row with an optional hint, and hint/error are wired to every
 * radio with aria-describedby. No option is pre-selected unless `value` says so.
 */
import type { ReactNode } from "react";
import { Icon } from "@/components/ui";
import styles from "./choice.module.css";

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

interface ChoiceGroupProps<T extends string> {
  /** Prefix for ids: each radio is `${idPrefix}-${value}`. */
  idPrefix: string;
  legend: ReactNode;
  options: readonly ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  hint?: ReactNode;
  error?: string | null;
  inline?: boolean;
  smallLegend?: boolean;
}

export const choiceId = (idPrefix: string, value: string) => `${idPrefix}-${value}`;

export function ChoiceGroup<T extends string>({
  idPrefix,
  legend,
  options,
  value,
  onChange,
  hint,
  error,
  inline = false,
  smallLegend = false,
}: ChoiceGroupProps<T>) {
  const hintId = `${idPrefix}-hint`;
  const errorId = `${idPrefix}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <fieldset className={styles.fieldset}>
      <legend className={`${styles.legend} ${smallLegend ? styles.legendSmall : ""}`}>{legend}</legend>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <div className={inline ? styles.choicesInline : styles.choices}>
        {options.map((option) => {
          const id = choiceId(idPrefix, option.value);
          const optionHintId = option.description ? `${id}-hint` : null;
          return (
            <label key={option.value} htmlFor={id} className={styles.choice}>
              <input
                id={id}
                type="radio"
                className={styles.radio}
                name={idPrefix}
                value={option.value}
                checked={value === option.value}
                disabled={option.disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={[describedBy, optionHintId].filter(Boolean).join(" ") || undefined}
                onChange={() => onChange(option.value)}
              />
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>{option.label}</span>
                {option.description ? (
                  <span id={optionHintId ?? undefined} className={styles.choiceHint}>
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} className={styles.error}>
          <Icon name="x-circle" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
