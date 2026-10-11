import type { Ref } from "react";
import type { TextAreaProps } from "./contract";
import { cx } from "./cx";
import styles from "./Control.module.css";

export interface TextAreaExtraProps extends TextAreaProps {
  ref?: Ref<HTMLTextAreaElement>;
}

/** Multi-line text control. `className` goes on the outer box. */
export function TextArea({ invalid = false, className, ref, ...areaProps }: TextAreaExtraProps) {
  return (
    <span className={cx(styles.box, styles.areaBox, className)}>
      <textarea
        {...areaProps}
        ref={ref}
        className={cx(styles.control, styles.textarea)}
        aria-invalid={invalid || areaProps["aria-invalid"] || undefined}
      />
    </span>
  );
}
