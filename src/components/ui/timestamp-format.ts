export type TimestampLocale = "fr" | "ar";
export type TimestampFormat = "datetime" | "date" | "time" | "relative";

/** Product time zone: patients and clinicians are in Tunisia. */
export const DEFAULT_TIME_ZONE = "Africa/Tunis";

/** Arabic keeps Latin digits (ar-TN convention, matches lab documents). */
export const INTL_LOCALE: Readonly<Record<TimestampLocale, string>> = {
  fr: "fr-FR",
  ar: "ar-TN-u-nu-latn",
};

export const MISSING_LABEL: Readonly<Record<TimestampLocale, string>> = {
  fr: "non renseigné",
  ar: "غير متوفر",
};

export const INVALID_LABEL: Readonly<Record<TimestampLocale, string>> = {
  fr: "Date invalide",
  ar: "تاريخ غير صالح",
};

const ABSOLUTE_OPTIONS: Readonly<Record<Exclude<TimestampFormat, "relative">, Intl.DateTimeFormatOptions>> = {
  datetime: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
  date: { day: "numeric", month: "short", year: "numeric" },
  time: { hour: "2-digit", minute: "2-digit" },
};

const RELATIVE_STEPS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** Parses an ISO-8601 string; returns null when absent or unparseable. */
export function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAbsolute(
  date: Date,
  locale: TimestampLocale,
  format: Exclude<TimestampFormat, "relative">,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...ABSOLUTE_OPTIONS[format], timeZone }).format(date);
}

export function formatRelative(date: Date, locale: TimestampLocale, nowMs: number): string {
  const diffSeconds = (date.getTime() - nowMs) / 1000;
  const formatter = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: "auto" });
  const step = RELATIVE_STEPS.find(([, seconds]) => Math.abs(diffSeconds) >= seconds) ?? RELATIVE_STEPS[RELATIVE_STEPS.length - 1];
  const [unit, seconds] = step;
  return formatter.format(Math.round(diffSeconds / seconds), unit);
}

/**
 * Formats an ISO timestamp for display. Returns null for missing/invalid input
 * so callers can render an explicit gap instead of a made-up date.
 */
export function formatTimestamp(
  iso: string | null | undefined,
  locale: TimestampLocale = "fr",
  format: TimestampFormat = "datetime",
  options: { nowMs?: number; timeZone?: string } = {},
): string | null {
  const date = parseIso(iso);
  if (!date) return null;
  if (format === "relative") {
    return formatRelative(date, locale, options.nowMs ?? Date.now());
  }
  return formatAbsolute(date, locale, format, options.timeZone);
}
