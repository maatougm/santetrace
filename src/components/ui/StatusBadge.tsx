import type { CareStatus, StatusBadgeProps } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { CARE_STATUS_META } from "./status-meta";
import styles from "./Badge.module.css";

const STATUS_CLASS: Readonly<Record<CareStatus, string | undefined>> = {
  green: styles.statusGreen,
  orange: styles.statusOrange,
  red: styles.statusRed,
  unknown: styles.statusUnknown,
};

const ICON_SIZE = { sm: 12, md: 14, lg: 16 } as const;

export interface StatusBadgeExtraProps extends StatusBadgeProps {
  className?: string;
}

/**
 * Care status chip: icon + text, never colour alone. "green" means no demo
 * threshold crossed; "unknown" means missing data and is never reassuring.
 */
export function StatusBadge({ status, label, size = "md", className }: StatusBadgeExtraProps) {
  const meta = CARE_STATUS_META[status];
  return (
    <span className={cx(styles.badge, styles[size], STATUS_CLASS[status], className)} data-status={status}>
      <Icon name={meta.icon} size={ICON_SIZE[size]} className={styles.glyph} />
      <span className={styles.text}>{label ?? meta.label}</span>
    </span>
  );
}
