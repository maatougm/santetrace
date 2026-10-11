/**
 * Pure logic for the explicit demo simulator: input bounds (demo sanity
 * limits, not alert thresholds), the typed ConnectorEvent body, one
 * externalEventId per reading, and the honest priority view of a receipt.
 * The server resolves patient and simulation identity; nothing here claims a
 * reading is real.
 */
import type { Status } from "@/contracts/care";
import type { ConnectorEvent, MonitoringState, ReadingInput } from "@/contracts/monitoring";
import { displayableEvaluationTime } from "@/lib/client/copy/reasons";
import { SIMULATOR_LIMITS, type ConnectorView } from "@/lib/client/devices-api";
import { fromDateTimeLocalValue } from "@/lib/client/format";
import { parseLocaleNumber } from "../measure-validation";
import type { CareTeamStatus } from "../useCareTeam";

export type SimulatorKind = ReadingInput["kind"];
export type GlucoseUnit = Extract<ReadingInput, { kind: "glucose" }>["unit"];

export interface SimulatorDraft {
  kind: SimulatorKind;
  systolic: string;
  diastolic: string;
  /** Glucose or pulse value. */
  value: string;
  glucoseUnit: GlucoseUnit;
  /** datetime-local value in the device's time zone. */
  measuredAtLocal: string;
  quality: ConnectorEvent["quality"];
}

export type SimulatorField = "systolic" | "diastolic" | "value" | "measuredAt";
export type SimulatorError = "outOfRange" | "invalidTime";
export type SimulatedEventBody = Omit<ConnectorEvent, "externalEventId">;

export type SimulatorValidation =
  | { ok: true; body: SimulatedEventBody }
  | { ok: false; errors: Partial<Record<SimulatorField, SimulatorError>> };

/** Same margin as the manual measurement form: a simulated reading cannot be in the future. */
const FUTURE_TOLERANCE_MS = 2 * 60_000;

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{3,40}$/;

export function isValidDeviceId(raw: string): boolean {
  return DEVICE_ID_PATTERN.test(raw.trim());
}

/**
 * Bindings the simulated-reading card may send through: enabled simulators
 * only. A real-device binding is never offered (the server's simulate route
 * refuses it with 404); its readings arrive only when the device sends them.
 */
export function selectableSimulators<T extends Pick<ConnectorView, "kind" | "enabled">>(connectors: readonly T[]): T[] {
  return connectors.filter((connector) => connector.enabled && connector.kind === "simulator");
}

export interface Bounds {
  min: number;
  max: number;
  unit: string;
}

export function simulatorBounds(field: Exclude<SimulatorField, "measuredAt">, kind: SimulatorKind, glucoseUnit: GlucoseUnit): Bounds {
  if (field === "systolic") return { ...SIMULATOR_LIMITS.systolic, unit: "mmHg" };
  if (field === "diastolic") return { ...SIMULATOR_LIMITS.diastolic, unit: "mmHg" };
  if (kind === "pulse") return { ...SIMULATOR_LIMITS.pulse, unit: "bpm" };
  return glucoseUnit === "mg/dL" ? { ...SIMULATOR_LIMITS.glucoseMgDl, unit: "mg/dL" } : { ...SIMULATOR_LIMITS.glucoseMmol, unit: "mmol/L" };
}

/** A number within bounds; mmHg and bpm are whole numbers. */
function readBounded(raw: string, bounds: Bounds, integer: boolean): number | null {
  const value = parseLocaleNumber(raw);
  if (value === null || (integer && !Number.isInteger(value))) return null;
  return value >= bounds.min && value <= bounds.max ? value : null;
}

function readTime(local: string, now: number): string | null {
  const iso = fromDateTimeLocalValue(local);
  if (!iso || Date.parse(iso) > now + FUTURE_TOLERANCE_MS) return null;
  return iso;
}

function readReading(draft: SimulatorDraft): { reading: ReadingInput | null; errors: Partial<Record<SimulatorField, SimulatorError>> } {
  if (draft.kind === "blood_pressure") {
    const systolic = readBounded(draft.systolic, simulatorBounds("systolic", draft.kind, draft.glucoseUnit), true);
    const diastolic = readBounded(draft.diastolic, simulatorBounds("diastolic", draft.kind, draft.glucoseUnit), true);
    const errors = {
      ...(systolic === null ? { systolic: "outOfRange" as const } : {}),
      ...(diastolic === null ? { diastolic: "outOfRange" as const } : {}),
    };
    const reading = systolic !== null && diastolic !== null ? { kind: "blood_pressure" as const, systolic, diastolic, unit: "mmHg" as const } : null;
    return { reading, errors };
  }
  const integer = draft.kind === "pulse";
  const value = readBounded(draft.value, simulatorBounds("value", draft.kind, draft.glucoseUnit), integer);
  if (value === null) return { reading: null, errors: { value: "outOfRange" } };
  const reading: ReadingInput =
    draft.kind === "pulse" ? { kind: "pulse", value, unit: "bpm" } : { kind: "glucose", value, unit: draft.glucoseUnit };
  return { reading, errors: {} };
}

export function validateSimulatorDraft(draft: SimulatorDraft, now: number = Date.now()): SimulatorValidation {
  const { reading, errors } = readReading(draft);
  const measuredAt = readTime(draft.measuredAtLocal, now);
  const allErrors = measuredAt === null ? { ...errors, measuredAt: "invalidTime" as const } : errors;
  if (!reading || measuredAt === null || Object.keys(allErrors).length > 0) return { ok: false, errors: allErrors };
  return { ok: true, body: { measuredAt, reading, quality: draft.quality } };
}

export interface SentReading {
  event: ConnectorEvent;
  /** The server answered with a receipt for this event. */
  received: boolean;
}

function sameBody(a: SimulatedEventBody, b: SimulatedEventBody): boolean {
  return a.measuredAt === b.measuredAt && a.quality === b.quality && JSON.stringify(a.reading) === JSON.stringify(b.reading);
}

/**
 * One externalEventId per reading: retrying the same unconfirmed reading
 * reuses it (the server deduplicates); a changed or already received reading
 * is a new event.
 */
export function eventForSend(body: SimulatedEventBody, previous: SentReading | null, makeId: () => string): ConnectorEvent {
  if (previous && !previous.received && sameBody(previous.event, body)) return previous.event;
  return { externalEventId: makeId(), ...body };
}

/** "Renvoyer la même mesure": the identical event, byte for byte. */
export function resendEvent(previous: SentReading): ConnectorEvent {
  return previous.event;
}

export type AlertAudience = "care_team" | "nobody" | "unconfirmed";

/**
 * Who an alert from this reading can reach, from the owner's current grants
 * (FR-027): only "present" may mention a care team; "unknown" is never
 * treated as present.
 */
export function alertAudience(status: CareTeamStatus): AlertAudience {
  if (status === "present") return "care_team";
  return status === "none" ? "nobody" : "unconfirmed";
}

export interface PriorityView {
  status: Status;
  coverageComplete: boolean;
  /** A green priority hidden because coverage is incomplete. */
  downgraded: boolean;
  /** Displayable evaluation time; null for the epoch "never evaluated" sentinel (never another time). */
  evaluatedAt: string | null;
}

/** Never a reassuring green without complete coverage; orange/red are always shown as earned. */
export function monitoringView(state: MonitoringState | null): PriorityView {
  if (!state) return { status: "unknown", coverageComplete: false, downgraded: false, evaluatedAt: null };
  const evaluatedAt = displayableEvaluationTime(state.evaluatedAt);
  const coverageComplete = state.coverage.length > 0 && state.coverage.every((c) => c === "complete");
  if (state.priority === "green" && !coverageComplete) return { status: "unknown", coverageComplete, downgraded: true, evaluatedAt };
  return { status: state.priority, coverageComplete, downgraded: false, evaluatedAt };
}
