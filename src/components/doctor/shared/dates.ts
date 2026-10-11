/**
 * Calendar-date helpers for lab exam dates, which the backend stores as
 * YYYY-MM-DD without a time zone. They are placed at UTC midnight and always
 * formatted in UTC, so a date never shifts by a day whatever the browser zone
 * (chart ticks for lab series use the same UTC zone, see time-axis.ts).
 */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const CALENDAR_TIME_ZONE = "UTC";

const calendarFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: CALENDAR_TIME_ZONE });

export function isCalendarDate(value: string | null | undefined): value is string {
  return typeof value === "string" && CALENDAR_DATE.test(value);
}

function calendarParts(value: string): [number, number, number] {
  const [year, month, day] = value.split("-").map(Number);
  return [year, month, day];
}

/** Epoch ms at UTC midnight for a calendar date (or the instant of an ISO timestamp). */
export function calendarDateToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  if (isCalendarDate(value)) {
    const [year, month, day] = calendarParts(value);
    return Date.UTC(year, month - 1, day);
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function formatCalendarDate(value: string | null | undefined): string {
  const ms = calendarDateToMs(value);
  return ms === null ? "—" : calendarFormatter.format(ms);
}

function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Value for <input type="date"> from either a calendar date or an ISO timestamp. */
export function toCalendarInputValue(value: string | null | undefined): string {
  if (!value) return "";
  if (isCalendarDate(value)) return value;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? localToday(new Date(ms)) : "";
}

/** True when the calendar date is a real day (rejects 2026-02-31). */
export function isValidCalendarDate(value: string): boolean {
  if (!isCalendarDate(value)) return false;
  const [year, month, day] = calendarParts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Calendar date after today's date on this device, i.e. an impossible exam date. */
export function isFutureCalendarDate(value: string, now: Date = new Date()): boolean {
  return isCalendarDate(value) && value > localToday(now);
}
