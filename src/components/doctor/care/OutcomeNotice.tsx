"use client";

import { useEffect, useRef } from "react";
import { Notice } from "@/components/ui";
import type { Outcome } from "./outcome";
import styles from "./Care.module.css";

/**
 * Result of the last decision. Receives focus when `focusKey` changes, so a
 * keyboard user is not left on <body> when the button that opened the dialog
 * disappeared with the decided item.
 */
export function OutcomeNotice({ outcome, focusKey }: { outcome: Outcome | null; focusKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusKey > 0) ref.current?.focus();
  }, [focusKey]);
  if (!outcome) return null;
  return (
    <div ref={ref} tabIndex={-1} className={styles.focusTarget}>
      <Notice tone={outcome.ok ? "success" : "neutral"}>{outcome.text}</Notice>
    </div>
  );
}
