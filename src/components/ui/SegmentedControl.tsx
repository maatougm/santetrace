"use client";

import { useId } from "react";
import type { SegmentedControlProps } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import styles from "./SegmentedControl.module.css";

export interface SegmentedControlExtraProps<T extends string> extends SegmentedControlProps<T> {
  /** Form field name for the underlying radios. Generated when omitted. */
  name?: string;
  className?: string;
}

/**
 * Single choice between a few options (unit, period, language). Built on native
 * radios, so arrow keys, Tab and screen readers behave as a radio group.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  fullWidth = false,
  name,
  className,
}: SegmentedControlExtraProps<T>) {
  const generatedName = useId();
  const groupName = name ?? `seg-${generatedName}`;
  const iconSize = size === "sm" ? 14 : 16;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(styles.group, styles[size], fullWidth && styles.fullWidth, className)}
    >
      {options.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            className={styles.input}
            name={groupName}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span className={styles.face}>
            {option.icon ? <Icon name={option.icon} size={iconSize} className={styles.faceIcon} /> : null}
            <span className={styles.faceLabel}>{option.label}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
