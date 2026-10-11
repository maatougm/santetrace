import type { ErrorStateProps } from "./contract";
import { Button } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";
import type { AnyIconName } from "./icons";
import styles from "./State.module.css";

export interface ErrorStateExtraProps extends ErrorStateProps {
  /** Default "cloud-off". Use "lock" for 401/403, "alert-triangle" for 5xx. */
  icon?: AnyIconName;
  /** Prefix before the machine code. Default "Code". */
  codeLabel?: string;
  /** Spinner on the retry button while a retry is running. */
  retrying?: boolean;
  className?: string;
}

/**
 * Honest API failure: what failed, the discreet machine code, optional retry.
 * Neutral ink (not red) so it never competes with priority alerts.
 */
export function ErrorState({
  title = "Impossible de charger ces données",
  message,
  code,
  onRetry,
  retryLabel = "Réessayer",
  compact = false,
  icon = "cloud-off",
  codeLabel = "Code",
  retrying = false,
  className,
}: ErrorStateExtraProps) {
  const emblem = (
    <span className={styles.emblem}>
      <Icon name={icon} size={compact ? 18 : 22} />
    </span>
  );
  const text = (
    <>
      <p className={styles.title}>{title}</p>
      <div className={styles.description}>{message}</div>
      {code ? (
        <p className={styles.code}>
          {codeLabel} <code>{code}</code>
        </p>
      ) : null}
      {onRetry ? (
        <div className={styles.action}>
          <Button variant="secondary" size={compact ? "sm" : "md"} iconStart="refresh" onClick={onRetry} loading={retrying}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </>
  );

  return (
    <div role="alert" className={cx(styles.state, styles.error, compact && styles.compact, className)}>
      {emblem}
      {compact ? <div className={styles.compactBody}>{text}</div> : text}
    </div>
  );
}
