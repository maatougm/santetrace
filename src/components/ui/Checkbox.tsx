"use client";

import { useId, type Ref } from "react";
import type { CheckboxProps } from "./contract";
import { cx } from "./cx";
import styles from "./Checkbox.module.css";

export interface CheckboxExtraProps extends CheckboxProps {
  ref?: Ref<HTMLInputElement>;
  /** Sets aria-invalid (e.g. a required consent left unchecked). */
  invalid?: boolean;
}

/**
 * Native checkbox with a visible label and optional description (wired via
 * aria-describedby). The whole row is the 44px hit target. `className` goes on the row.
 */
export function Checkbox({
  label,
  description,
  className,
  id,
  invalid = false,
  ref,
  ...inputProps
}: CheckboxExtraProps) {
  const generatedId = useId();
  const inputId = id ?? `cb-${generatedId}`;
  const labelId = `${inputId}-label`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const describedBy = [inputProps["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined;

  return (
    <label htmlFor={inputId} className={cx(styles.root, className)}>
      <span className={styles.boxWrap}>
        <input
          {...inputProps}
          ref={ref}
          id={inputId}
          type="checkbox"
          className={styles.input}
          aria-labelledby={inputProps["aria-labelledby"] ?? labelId}
          aria-describedby={describedBy}
          aria-invalid={invalid || inputProps["aria-invalid"] || undefined}
        />
        <svg className={styles.check} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M20 6.5 9.5 17 4 11.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
