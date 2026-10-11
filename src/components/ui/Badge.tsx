import type { BadgeProps } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import styles from "./Badge.module.css";

export interface BadgeExtraProps extends BadgeProps {
  className?: string;
}

/**
 * Small label for counts, categories and metadata. The orange/red tones are
 * for priority content only; use neutral/accent/muted/outline otherwise.
 */
export function Badge({ tone = "neutral", icon, children, title, className }: BadgeExtraProps) {
  return (
    <span className={cx(styles.badge, styles[tone], className)} title={title}>
      {icon ? <Icon name={icon} size={14} className={styles.glyph} /> : null}
      <span className={styles.text}>{children}</span>
    </span>
  );
}
