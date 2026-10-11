import type { Ref } from "react";
import type { TextInputProps } from "./contract";
import { cx } from "./cx";
import styles from "./Control.module.css";

export interface TextInputExtraProps extends TextInputProps {
  ref?: Ref<HTMLInputElement>;
}

/**
 * Text/number input. `className` goes on the visual box (outer element);
 * every other prop, including `ref`, goes on the native <input>.
 */
export function TextInput({ invalid = false, suffix, className, ref, ...inputProps }: TextInputExtraProps) {
  const hasSuffix = suffix !== undefined && suffix !== null && suffix !== "";
  return (
    <span className={cx(styles.box, hasSuffix && styles.withSuffix, className)}>
      <input
        {...inputProps}
        ref={ref}
        className={styles.control}
        aria-invalid={invalid || inputProps["aria-invalid"] || undefined}
      />
      {hasSuffix ? (
        <span className={styles.suffix} aria-hidden="true">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}
