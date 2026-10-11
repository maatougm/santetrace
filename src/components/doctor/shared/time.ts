/**
 * Clinician display times, aligned with the UI kit <Timestamp> (product time
 * zone Africa/Tunis) so text, tables, tooltips and chart axes agree.
 */
import { DEFAULT_TIME_ZONE, formatTimestamp } from "@/components/ui";

export const TIME_ZONE = DEFAULT_TIME_ZONE;

export function fmtDateTime(iso: string | null | undefined): string {
  return formatTimestamp(iso, "fr", "datetime") ?? "—";
}

export function fmtDate(iso: string | null | undefined): string {
  return formatTimestamp(iso, "fr", "date") ?? "—";
}

export function fmtRelative(iso: string | null | undefined, nowMs: number): string {
  return formatTimestamp(iso, "fr", "relative", { nowMs }) ?? "—";
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = offsetFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  offsetFormatters.set(timeZone, formatter);
  return formatter;
}

/** Offset (ms) of a time zone (default: product zone) from UTC at a given instant. */
export function zoneOffsetMs(ms: number, timeZone: string = TIME_ZONE): number {
  const parts = Object.fromEntries(
    offsetFormatter(timeZone).formatToParts(ms).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}
