import type { FieldProps } from "./contract";
import { cx } from "./cx";
import { errorId, hintId } from "./field-ids";
import { Icon } from "./Icon";
import { VisuallyHidden } from "./VisuallyHidden";
import styles from "./Field.module.css";

export interface FieldExtraProps extends FieldProps {
  className?: string;
  /** Screen-reader text for the required marker. Default "obligatoire". */
  requiredLabel?: string;
}

/**
 * Visible label + optional hint + error for one control. Wire the control with
 * `id={htmlFor}` and `aria-describedby={describedBy(htmlFor, { hint, error })}`.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  className,
  requiredLabel = "obligatoire",
}: FieldExtraProps) {
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={htmlFor} className={styles.label}>
        <span>{label}</span>
        {required ? (
          <>
            <span className={styles.required} aria-hidden="true">
              *
            </span>
            <VisuallyHidden>({requiredLabel})</VisuallyHidden>
          </>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId(htmlFor)} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={errorId(htmlFor)} className={styles.error}>
          <Icon name="x-circle" size={16} className={styles.errorIcon} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
