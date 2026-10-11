/**
 * Real time axis for Recharts (type="number", scale="time"): padded domain and
 * clean ticks aligned to the product time zone, so a lone point never sits on
 * the frame edge and labels read as calendar times rather than raw numbers.
 */
import { TIME_ZONE, zoneOffsetMs } from "../shared/time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const STEPS = [
  MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
] as const;

/** Kept low so "10 oct., 14:00" labels never collide on a ~600px plot (1024px screens). */
const TARGET_TICKS = 5;

export type TimeDomain = [number, number];

export function timeDomain(values: readonly number[], minPadMs: number): TimeDomain {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.06, minPadMs);
  return [min - pad, max + pad];
}

interface Formatters {
  time: Intl.DateTimeFormat;
  dayTime: Intl.DateTimeFormat;
  day: Intl.DateTimeFormat;
  month: Intl.DateTimeFormat;
}

const formatterCache = new Map<string, Formatters>();

function formattersFor(timeZone: string): Formatters {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created: Formatters = {
    time: new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone }),
    dayTime: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }),
    day: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone }),
    month: new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone }),
  };
  formatterCache.set(timeZone, created);
  return created;
}

function monthlyTicks([min, max]: TimeDomain, timeZone: string): number[] {
  const span = max - min;
  const monthStep = Math.max(1, Math.ceil(span / (30 * DAY) / TARGET_TICKS));
  const offset = zoneOffsetMs(min, timeZone);
  const zoned = new Date(min + offset);
  let year = zoned.getUTCFullYear();
  let month = zoned.getUTCMonth() + 1;
  const ticks: number[] = [];
  for (let guard = 0; guard < 240; guard += 1) {
    const zonedStart = Date.UTC(year, month - 1, 1);
    const tick = zonedStart - zoneOffsetMs(zonedStart, timeZone);
    if (tick > max) break;
    if (tick >= min) ticks.push(tick);
    month += monthStep;
    while (month > 12) {
      month -= 12;
      year += 1;
    }
  }
  return ticks;
}

export interface TimeTicks {
  ticks: number[];
  format: (ms: number) => string;
}

/** Ticks aligned to `timeZone` (product zone for measurements, UTC for lab calendar dates). */
export function timeTicks(domain: TimeDomain, timeZone: string = TIME_ZONE): TimeTicks {
  const [min, max] = domain;
  const span = Math.max(max - min, MINUTE);
  const step = STEPS.find((candidate) => span / candidate <= TARGET_TICKS);
  const formatters = formattersFor(timeZone);

  if (!step) {
    return { ticks: monthlyTicks(domain, timeZone), format: (ms) => formatters.month.format(ms) };
  }

  const offset = zoneOffsetMs(min, timeZone);
  const first = Math.ceil((min + offset) / step) * step - offset;
  const ticks: number[] = [];
  for (let tick = first; tick <= max; tick += step) ticks.push(tick);

  const multiDay = formatters.day.format(min) !== formatters.day.format(max);
  const format =
    step >= DAY
      ? (ms: number) => formatters.day.format(ms)
      : multiDay
        ? (ms: number) => formatters.dayTime.format(ms)
        : (ms: number) => formatters.time.format(ms);
  return { ticks, format };
}

/** Numeric value domain that always includes the given reference values. */
export function valueDomain(values: readonly number[], references: readonly number[], step: number): [number, number] {
  const all = [...values, ...references];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = Math.max((max - min) * 0.08, step / 2);
  return [Math.max(0, Math.floor((min - pad) / step) * step), Math.ceil((max + pad) / step) * step];
}
