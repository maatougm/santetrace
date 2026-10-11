"use client";

import { useEffect, useState } from "react";
import type { TimestampProps } from "./contract";
import {
  DEFAULT_TIME_ZONE,
  formatAbsolute,
  formatRelative,
  INVALID_LABEL,
  MISSING_LABEL,
  parseIso,
} from "./timestamp-format";
import { cx } from "./cx";
import { VisuallyHidden } from "./VisuallyHidden";
import styles from "./Timestamp.module.css";

const RELATIVE_REFRESH_MS = 30_000;

export interface TimestampExtraProps extends TimestampProps {
  /** IANA zone for absolute formats. Default "Africa/Tunis" (stable SSR/CSR output). */
  timeZone?: string;
  className?: string;
}

/**
 * <time> with locale-aware formatting. Relative values refresh every 30 s and
 * carry the absolute date in `title`. Missing input renders "—" + hidden text.
 */
export function Timestamp({
  iso,
  locale = "fr",
  format = "datetime",
  label,
  timeZone = DEFAULT_TIME_ZONE,
  className,
}: TimestampExtraProps) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  const isRelative = format === "relative";

  useEffect(() => {
    if (!isRelative) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), RELATIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isRelative]);

  const prefix = label ? <span className={styles.label}>{label} </span> : null;
  const date = parseIso(iso);

  if (!iso || !date) {
    const hiddenText = iso ? INVALID_LABEL[locale] : MISSING_LABEL[locale];
    return (
      <span className={cx(styles.timestamp, className)}>
        {prefix}
        <span aria-hidden="true" className={styles.missing}>
          —
        </span>
        <VisuallyHidden>{hiddenText}</VisuallyHidden>
      </span>
    );
  }

  const absolute = formatAbsolute(date, locale, "datetime", timeZone);
  const text = isRelative
    ? formatRelative(date, locale, nowMs ?? Date.now())
    : formatAbsolute(date, locale, format, timeZone);

  return (
    <span className={cx(styles.timestamp, className)}>
      {prefix}
      <time dateTime={date.toISOString()} title={isRelative ? absolute : undefined} suppressHydrationWarning>
        {text}
      </time>
    </span>
  );
}
