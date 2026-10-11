import type { DemoLabelProps } from "./contract";
import { cx } from "./cx";
import styles from "./DemoLabel.module.css";

export const DEMO_LABEL_FR = "Démonstration fictive · données synthétiques";
export const DEMO_LABEL_AR = "عرض تجريبي · بيانات اصطناعية";

export interface DemoLabelExtraProps extends DemoLabelProps {
  className?: string;
}

/** Persistent honesty marker. "dark" tone sits on the navy clinician rail. */
export function DemoLabel({ children, tone = "light", className }: DemoLabelExtraProps) {
  return (
    <span className={cx(styles.label, styles[tone], className)}>
      <span className={styles.mark} aria-hidden="true" />
      <span className={styles.text}>{children ?? DEMO_LABEL_FR}</span>
    </span>
  );
}
