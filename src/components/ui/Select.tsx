import type { Ref } from "react";
import type { SelectProps } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import styles from "./Control.module.css";

export interface SelectExtraProps extends SelectProps {
  ref?: Ref<HTMLSelectElement>;
}

/** Native <select> in the kit's control box. `className` goes on the outer box. */
export function Select({ invalid = false, className, children, ref, ...selectProps }: SelectExtraProps) {
  return (
    <span className={cx(styles.box, className)}>
      <select
        {...selectProps}
        ref={ref}
        className={cx(styles.control, styles.select)}
        aria-invalid={invalid || selectProps["aria-invalid"] || undefined}
      >
        {children}
      </select>
      <Icon name="chevron-down" size={18} className={styles.selectIcon} />
    </span>
  );
}
