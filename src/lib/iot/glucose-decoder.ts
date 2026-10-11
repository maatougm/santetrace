import { createHash } from "node:crypto";
import type { ConnectorEvent } from "../../contracts/monitoring";

export type GlucoseDecodeOptions = {
  meterIdentity: string;
  epoch: string;
  clockVerified: true;
  utcOffsetMinutes: number;
  inheritedTimeOffsetMinutes?: number;
};
export type GlucoseDecodeErrorCode = "invalid_sfloat" | "special_sfloat" | "invalid_length"
  | "reserved_flags" | "missing_concentration" | "invalid_identity" | "unverified_clock"
  | "invalid_time_policy" | "missing_time_offset" | "invalid_base_time" | "invalid_concentration"
  | "reserved_sample" | "control_solution" | "reserved_sensor_status" | "clock_fault";
export type GlucoseQualityReason = "sensor_warning" | "context_not_verified" | "unsupported_sample";
export type DecodedGlucoseMeasurement = {
  event: ConnectorEvent & { reading: { kind: "glucose"; value: number; unit: "mg/dL" | "mmol/L" } };
  sequence: number;
  /** Original meter calendar fields, before user Time Offset and timezone conversion. */
  baseTime: string;
  timeOffsetMinutes: number;
  sensorStatus: number;
  contextFollows: boolean;
  qualityReasons: GlucoseQualityReason[];
};

export class GlucoseDecodeError extends Error {
  constructor(public readonly code: GlucoseDecodeErrorCode) {
    super(`Glucose notification rejected: ${code}`);
    this.name = "GlucoseDecodeError";
  }
}
function reject(code: GlucoseDecodeErrorCode): never { throw new GlucoseDecodeError(code); }
function signed(value: number, bits: number): number {
  return value & (1 << (bits - 1)) ? value - 2 ** bits : value;
}
function sfloatParts(raw: number): { mantissa: number; exponent: number } {
  if (!Number.isInteger(raw) || raw < 0 || raw > 0xffff) reject("invalid_sfloat");
  const unsignedMantissa = raw & 0x0fff;
  // These mantissas are reserved by IEEE 11073. Conservatively reject them at any exponent.
  if ([0x07fe, 0x07ff, 0x0800, 0x0801, 0x0802].includes(unsignedMantissa)) reject("special_sfloat");
  return { mantissa: signed(unsignedMantissa, 12), exponent: signed(raw >>> 12, 4) };
}
export function decodeSFloat16(raw: number): number {
  const { mantissa, exponent } = sfloatParts(raw);
  return Number(`${mantissa}e${exponent}`);
}
function integerBetween(value: number | undefined, min: number, max: number): value is number {
  return Number.isInteger(value) && value! >= min && value! <= max;
}

/**
 * Server-side reference decoder for SIG Glucose Measurement (0x2A18), not a BLE driver.
 * Source: GLS v1.0.1 §3.1 and GATT Specification Supplement §3.119.
 * https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/GLS_v1.0.1/out/en/index-en.html
 * Meter time has no timezone. Provision a verified clock and fixed UTC offset for this
 * record transfer; never derive either from receipt time. For DST transitions, a verified
 * per-record offset is required. A missing sensor Time Offset must come from this transfer.
 * Context is not decoded here, so records requiring it remain suspect.
 */
export function decodeGlucoseMeasurement(bytes: Uint8Array, options: GlucoseDecodeOptions): DecodedGlucoseMeasurement {
  if (!(bytes instanceof Uint8Array) || bytes.length < 10) reject("invalid_length");
  const flags = bytes[0];
  if (flags & 0xe0) reject("reserved_flags");
  const hasTimeOffset = Boolean(flags & 1), hasConcentration = Boolean(flags & 2), hasStatus = Boolean(flags & 8);
  const expectedLength = 10 + (hasTimeOffset ? 2 : 0) + (hasConcentration ? 3 : 0) + (hasStatus ? 2 : 0);
  if (bytes.length !== expectedLength) reject("invalid_length");
  if (!hasConcentration) reject("missing_concentration");
  if (!options || typeof options.meterIdentity !== "string" || !options.meterIdentity.trim()
    || Buffer.byteLength(options.meterIdentity, "utf8") > 100
    || typeof options.epoch !== "string" || !/^[A-Za-z0-9_-]{1,8}$/.test(options.epoch)) reject("invalid_identity");
  if (options.clockVerified !== true) reject("unverified_clock");
  if (!integerBetween(options.utcOffsetMinutes, -840, 840)) reject("invalid_time_policy");
  if (options.inheritedTimeOffsetMinutes !== undefined
    && !integerBetween(options.inheritedTimeOffsetMinutes, -32768, 32767)) reject("invalid_time_policy");
  if (!hasTimeOffset && options.inheritedTimeOffsetMinutes === undefined) reject("missing_time_offset");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sequence = view.getUint16(1, true), year = view.getUint16(3, true);
  const month = bytes[5], day = bytes[6], hour = bytes[7], minute = bytes[8], second = bytes[9];
  const baseMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const calendar = new Date(baseMs);
  if (year < 1582 || year > 9999 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59
    || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day)
    reject("invalid_base_time");
  let offset = 10;
  const timeOffsetMinutes = hasTimeOffset ? view.getInt16(offset, true) : options.inheritedTimeOffsetMinutes!;
  if (hasTimeOffset) offset += 2;
  const { mantissa, exponent } = sfloatParts(view.getUint16(offset, true));
  offset += 2;
  const sample = bytes[offset++], sampleType = sample & 0x0f, sampleLocation = sample >>> 4;
  if (sampleType === 10 || sampleLocation === 4) reject("control_solution");
  if (sampleType < 1 || sampleType > 9 || ![1, 2, 3, 15].includes(sampleLocation)) reject("reserved_sample");
  const sensorStatus = hasStatus ? view.getUint16(offset, true) : 0;
  if (sensorStatus & 0xf000) reject("reserved_sensor_status");
  if (sensorStatus & 0x0800) reject("clock_fault");
  const unit = flags & 4 ? "mmol/L" : "mg/dL";
  // Shift the decimal exponent directly, avoiding intermediate kg/L or mol/L rounding.
  const value = Number(`${mantissa}e${exponent + (unit === "mg/dL" ? 5 : 3)}`);
  if (!Number.isFinite(value) || value <= 0) reject("invalid_concentration");
  const measured = new Date(baseMs + (timeOffsetMinutes - options.utcOffsetMinutes) * 60000);
  if (measured.getUTCFullYear() < 1582 || measured.getUTCFullYear() > 9999) reject("invalid_base_time");
  const pad = (part: number) => String(part).padStart(2, "0");
  const baseTime = `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(minute)}${pad(second)}`;
  const fingerprint = createHash("sha256").update(options.meterIdentity, "utf8").digest("hex").slice(0, 16);
  const externalEventId = `ble-glucose:${fingerprint}:${options.epoch}:${sequence}:${baseTime}:${timeOffsetMinutes}`;
  const contextFollows = Boolean(flags & 0x10), qualityReasons: GlucoseQualityReason[] = [];
  if (sensorStatus) qualityReasons.push("sensor_warning");
  if (contextFollows) qualityReasons.push("context_not_verified");
  // Current ingestion does not preserve sample type/site. Only finger capillary samples
  // can be accepted by this limited reference; other valid sites/types remain suspect.
  if (![1, 2].includes(sampleType) || sampleLocation !== 1) qualityReasons.push("unsupported_sample");
  return {
    event: { externalEventId, measuredAt: measured.toISOString(), reading: { kind: "glucose", value, unit },
      quality: qualityReasons.length ? "suspect" : "accepted" },
    sequence, baseTime, timeOffsetMinutes, sensorStatus, contextFollows, qualityReasons,
  };
}
