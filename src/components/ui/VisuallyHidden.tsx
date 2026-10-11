import type { ReactNode } from "react";
import styles from "./a11y.module.css";

export interface VisuallyHiddenProps {
  children: ReactNode;
  id?: string;
}

/** Text available to assistive technology but not rendered visually. */
export function VisuallyHidden({ children, id }: VisuallyHiddenProps) {
  return (
    <span id={id} className={styles.srOnly}>
      {children}
    </span>
  );
}
