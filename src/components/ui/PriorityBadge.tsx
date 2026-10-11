import type { Priority, PriorityBadgeProps } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { PRIORITY_META } from "./status-meta";
import styles from "./Badge.module.css";

const PRIORITY_CLASS: Readonly<Record<Priority, string | undefined>> = {
  orange: styles.priorityOrange,
  red: styles.priorityRed,
};

const ICON_SIZE = { sm: 12, md: 14 } as const;

export interface PriorityBadgeExtraProps extends PriorityBadgeProps {
  className?: string;
}

/** Alert priority chip. Red is solid so it outranks every other mark on screen. */
export function PriorityBadge({ priority, label, size = "md", className }: PriorityBadgeExtraProps) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cx(styles.badge, styles[size], PRIORITY_CLASS[priority], className)}
      data-priority={priority}
    >
      <Icon name={meta.icon} size={ICON_SIZE[size]} className={styles.glyph} />
      <span className={styles.text}>{label ?? meta.label}</span>
    </span>
  );
}
