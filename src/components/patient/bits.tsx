"use client";

/**
 * Small patient-only display helpers. Numbers and units are isolated with
 * <bdi dir="ltr"> so "142/91 mmHg" never reorders inside Arabic text.
 */
import type { ReactNode } from "react";
import { StatusBadge, Timestamp, CARE_STATUS_LABELS_AR } from "@/components/ui";
import type { Language, Measurement, Status } from "@/lib/client/api";
import { formatMeasurementNumber, formatNumber } from "@/lib/client/format";
import styles from "./patient.module.css";

/** French puts a (non-breaking) space before a colon; Arabic does not. */
export function colon(lang: Language): string {
  return lang === "fr" ? " : " : ": ";
}

type ReadingValue =Pick<Measurement, "kind" | "systolic" | "diastolic" | "value" | "unit">;

export function Reading({
  value,
  lang,
  size = "md",
}: {
  value: ReadingValue;
  lang: Language;
  size?: "sm" | "md" | "lg";
}) {
  const number = formatMeasurementNumber(value, lang);
  return (
    <bdi dir="ltr" className={`${styles.reading} ${styles[`reading-${size}`]}`}>
      <span className={styles.readingNumber}>{number}</span>
      <span className={styles.readingUnit}>{value.unit}</span>
    </bdi>
  );
}

/** Inline Latin/numeric token inside possibly-Arabic text. */
export function Ltr({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className={styles.ltr}>
      {children}
    </bdi>
  );
}

export function NumberWithUnit({ value, unit, lang, digits = 1 }: { value: number; unit: string; lang: Language; digits?: number }) {
  return (
    <Ltr>
      {formatNumber(value, lang, digits)} {unit}
    </Ltr>
  );
}

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Timestamp in the device's own time zone (the patient entered local times). */
export function When({
  iso,
  lang,
  format = "datetime",
  label,
}: {
  iso: string | null | undefined;
  lang: Language;
  format?: "datetime" | "date" | "time" | "relative";
  label?: string;
}) {
  return <Timestamp iso={iso} locale={lang} format={format} label={label} timeZone={deviceTimeZone()} />;
}

export function CareStatusBadge({ status, lang, size = "md" }: { status: Status; lang: Language; size?: "sm" | "md" | "lg" }) {
  return <StatusBadge status={status} size={size} label={lang === "ar" ? CARE_STATUS_LABELS_AR[status] : undefined} />;
}

export function SectionTitle({ id, children, action }: { id?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.sectionHead}>
      <h2 id={id} className={styles.sectionTitle}>
        {children}
      </h2>
      {action}
    </div>
  );
}
