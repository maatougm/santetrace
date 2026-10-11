import { connectionBadgeView, type ConnectionLanguage, type LiveStatus } from "./connection-badge";
import { cx } from "./cx";
import styles from "./ConnectionBadge.module.css";

export interface ConnectionBadgeProps {
  status: LiveStatus;
  lastEventAt: number | null;
  lang?: ConnectionLanguage;
  /** "inverse" sits on the blue clinician header band. */
  surface?: "default" | "inverse";
  className?: string;
}

/**
 * Honest live-connection indicator (colour + text, never colour alone).
 * Presentational only: the caller passes the live hook's state. The status
 * region text only changes with the status, so screen readers are not
 * interrupted on every live event; the last-event time stays in the tooltip.
 */
export function ConnectionBadge({ status, lastEventAt, lang = "fr", surface = "default", className }: ConnectionBadgeProps) {
  const view = connectionBadgeView(status, lastEventAt, lang);
  return (
    <span
      className={cx(styles.badge, styles[view.tone], surface === "inverse" && styles.inverse, className)}
      role="status"
      title={view.detail}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{view.label}</span>
      <span className="visually-hidden">{` — ${view.description}`}</span>
    </span>
  );
}
