/**
 * Client-side validation mirroring the server bounds in care-service.ts
 * (measurement()): BP 50–300 / 30–200 mmHg with systolic > diastolic, glucose
 * 20–600 mg/dL or 1–33.4 mmol/L with an explicit unit, measuredAt with zone and
 * not in the future. Invalid input never reaches the network.
 */
import type { GlucoseUnit, MeasurementKind } from "@/lib/client/api";
import { fromDateTimeLocalValue } from "@/lib/client/format";
import type { MeasurementDraft } from "@/lib/client/outbox";

export const MEASURE_BOUNDS = {
  systolic: { min: 50, max: 300 },
  diastolic: { min: 30, max: 200 },
  "mg/dL": { min: 20, max: 600 },
  "mmol/L": { min: 1, max: 33.4 },
} as const;

/** Client margin below the server's 5-minute future tolerance. */
const FUTURE_TOLERANCE_MS = 2 * 60_000;
/** Server marks measurements older than this as delayed (clockWarning). */
const DELAYED_AFTER_MS = 24 * 3600_000;

export interface MeasureFormValues {
  kind: MeasurementKind;
  systolic: string;
  diastolic: string;
  glucose: string;
  glucoseUnit: GlucoseUnit | null;
  measuredAtLocal: string;
}

export type MeasureField = "systolic" | "diastolic" | "glucose" | "glucoseUnit" | "measuredAt";

export type MeasureError =
  | { code: "required" }
  | { code: "notNumber" }
  | { code: "notInteger" }
  | { code: "range"; min: number; max: number; unit: string }
  | { code: "systolicNotAbove" }
  | { code: "unitRequired" }
  | { code: "looksLikeMmol" }
  | { code: "looksLikeMgdl" }
  | { code: "timeInvalid" }
  | { code: "timeFuture" };

export interface MeasureValidation {
  draft: MeasurementDraft | null;
  errors: Partial<Record<MeasureField, MeasureError>>;
  delayed: boolean;
}

/** Accepts "7,2" and "7.2"; rejects anything that is not a plain decimal number. */
export function parseLocaleNumber(raw: string): number | null {
  const normalised = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

function readNumber(raw: string, integer: boolean): { value: number } | { error: MeasureError } {
  if (!raw.trim()) return { error: { code: "required" } };
  const value = parseLocaleNumber(raw);
  if (value === null) return { error: { code: "notNumber" } };
  if (integer && !Number.isInteger(value)) return { error: { code: "notInteger" } };
  return { value };
}

function inRange(value: number, bounds: { min: number; max: number }): boolean {
  return value >= bounds.min && value <= bounds.max;
}

function validateTime(local: string, now: number): { iso: string; delayed: boolean } | { error: MeasureError } {
  const iso = fromDateTimeLocalValue(local);
  if (!iso) return { error: { code: "timeInvalid" } };
  const at = Date.parse(iso);
  if (at > now + FUTURE_TOLERANCE_MS) return { error: { code: "timeFuture" } };
  return { iso, delayed: now - at > DELAYED_AFTER_MS };
}

function validateBloodPressure(values: MeasureFormValues, errors: Partial<Record<MeasureField, MeasureError>>) {
  const systolic = readNumber(values.systolic, true);
  const diastolic = readNumber(values.diastolic, true);
  let result: { systolic: number; diastolic: number } | null = null;
  if ("error" in systolic) errors.systolic = systolic.error;
  else if (!inRange(systolic.value, MEASURE_BOUNDS.systolic)) {
    errors.systolic = { code: "range", ...MEASURE_BOUNDS.systolic, unit: "mmHg" };
  }
  if ("error" in diastolic) errors.diastolic = diastolic.error;
  else if (!inRange(diastolic.value, MEASURE_BOUNDS.diastolic)) {
    errors.diastolic = { code: "range", ...MEASURE_BOUNDS.diastolic, unit: "mmHg" };
  }
  if (!errors.systolic && !errors.diastolic && "value" in systolic && "value" in diastolic) {
    if (systolic.value <= diastolic.value) errors.systolic = { code: "systolicNotAbove" };
    else result = { systolic: systolic.value, diastolic: diastolic.value };
  }
  return result;
}

function validateGlucose(values: MeasureFormValues, errors: Partial<Record<MeasureField, MeasureError>>) {
  const unit = values.glucoseUnit;
  if (!unit) errors.glucoseUnit = { code: "unitRequired" };
  const parsed = readNumber(values.glucose, false);
  if ("error" in parsed) {
    errors.glucose = parsed.error;
    return null;
  }
  if (!unit) return null;
  const value = parsed.value;
  if (inRange(value, MEASURE_BOUNDS[unit])) return { value, unit };
  // Ambiguous value/unit: prompt the patient to check the unit instead of guessing.
  if (unit === "mg/dL" && inRange(value, MEASURE_BOUNDS["mmol/L"])) errors.glucose = { code: "looksLikeMmol" };
  else if (unit === "mmol/L" && inRange(value, MEASURE_BOUNDS["mg/dL"])) errors.glucose = { code: "looksLikeMgdl" };
  else errors.glucose = { code: "range", ...MEASURE_BOUNDS[unit], unit };
  return null;
}

export function validateMeasure(values: MeasureFormValues, now: number = Date.now()): MeasureValidation {
  const errors: Partial<Record<MeasureField, MeasureError>> = {};
  const time = validateTime(values.measuredAtLocal, now);
  if ("error" in time) errors.measuredAt = time.error;
  const delayed = "delayed" in time ? time.delayed : false;

  if (values.kind === "blood_pressure") {
    const bp = validateBloodPressure(values, errors);
    const draft: MeasurementDraft | null =
      bp && "iso" in time && Object.keys(errors).length === 0
        ? { kind: "blood_pressure", systolic: bp.systolic, diastolic: bp.diastolic, unit: "mmHg", measuredAt: time.iso }
        : null;
    return { draft, errors, delayed };
  }

  const glucose = validateGlucose(values, errors);
  const draft: MeasurementDraft | null =
    glucose && "iso" in time && Object.keys(errors).length === 0
      ? { kind: "glucose", value: glucose.value, unit: glucose.unit, measuredAt: time.iso }
      : null;
  return { draft, errors, delayed };
}
