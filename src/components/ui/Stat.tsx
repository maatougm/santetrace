import type { StatProps } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { StatusBadge } from "./StatusBadge";
import styles from "./Stat.module.css";

export interface StatExtraProps extends StatProps {
  /** "sm" for dense rows, "lg" for the patient's headline value. Default "md". */
  size?: "sm" | "md" | "lg";
  /** Overrides the StatusBadge label (e.g. Arabic). */
  statusLabel?: string;
  className?: string;
}

/**
 * One measured value: label, big tabular number + unit, then status and meta.
 * Value and unit are an LTR island so "138/86 mmHg" never reorders in Arabic.
 */
export function Stat({ label, value, unit, meta, status, icon, size = "md", statusLabel, className }: StatExtraProps) {
  return (
    <div className={cx(styles.stat, styles[size], status === "unknown" && styles.unknown, className)}>
      <div className={styles.labelRow}>
        {icon ? <Icon name={icon} size={16} className={styles.labelIcon} /> : null}
        <span>{label}</span>
      </div>
      <div>
        <span className={styles.valueRow} dir="ltr">
          <span className={styles.value}>{value}</span>
          {unit ? <span className={styles.unit}>{unit}</span> : null}
        </span>
      </div>
      {status || meta ? (
        <div className={styles.metaRow}>
          {status ? <StatusBadge status={status} size="sm" label={statusLabel} /> : null}
          {meta ? <span>{meta}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
