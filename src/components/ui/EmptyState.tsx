import type { EmptyStateProps } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import styles from "./State.module.css";

export interface EmptyStateExtraProps extends EmptyStateProps {
  className?: string;
}

/**
 * For genuinely empty data ("Aucune mesure"). Never use it for failures —
 * use ErrorState — or for missing clinical values — use StatusBadge "unknown".
 */
export function EmptyState({ icon = "inbox", title, description, action, compact = false, className }: EmptyStateExtraProps) {
  const emblem = (
    <span className={styles.emblem}>
      <Icon name={icon} size={compact ? 18 : 22} />
    </span>
  );
  const text = (
    <>
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </>
  );

  if (compact) {
    return (
      <div className={cx(styles.state, styles.compact, className)}>
        {emblem}
        <div className={styles.compactBody}>{text}</div>
      </div>
    );
  }

  return (
    <div className={cx(styles.state, className)}>
      {emblem}
      {text}
    </div>
  );
}
