import type { NoticeProps, NoticeTone } from "./contract";
import { cx } from "./cx";
import { Icon } from "./Icon";
import type { AnyIconName } from "./icons";
import styles from "./Notice.module.css";

const DEFAULT_ICON: Readonly<Record<NoticeTone, AnyIconName>> = {
  neutral: "info",
  info: "info",
  success: "check-circle",
  orange: "alert-triangle",
  red: "alert-octagon",
};

export interface NoticeExtraProps extends NoticeProps {
  className?: string;
  id?: string;
}

/**
 * Inline message block. neutral/info/success are non-priority; orange/red are
 * reserved for priority clinical content. Red defaults to role="alert".
 */
export function Notice({ tone = "neutral", title, children, action, icon, role, className, id }: NoticeExtraProps) {
  const resolvedRole = role ?? (tone === "red" ? "alert" : "status");
  return (
    <div
      id={id}
      role={resolvedRole}
      className={cx(styles.notice, styles[tone], action ? styles.withAction : undefined, className)}
    >
      <Icon name={icon ?? DEFAULT_ICON[tone]} size={18} className={styles.icon} />
      <div className={styles.content}>
        {title ? <p className={styles.title}>{title}</p> : null}
        {children !== undefined && children !== null ? <div className={styles.body}>{children}</div> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
