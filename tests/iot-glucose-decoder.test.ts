import test from "node:test";
import assert from "node:assert/strict";
import { decodeGlucoseMeasurement, decodeSFloat16, type GlucoseDecodeOptions } from "../src/lib/iot/glucose-decoder";

const options: GlucoseDecodeOptions = {
  meterIdentity: "METER-TEST-001", epoch: "first", clockVerified: true,
  utcOffsetMinutes: 60, inheritedTimeOffsetMinutes: 0,
};
const packet = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(" ", ""), "hex"));
const glucose120 = "02 01 00 ea 07 0a 0b 08 1e 00 78 b0 11";
const expectError = (hex: string, code: string, policy = options) =>
  assert.throws(() => decodeGlucoseMeasurement(packet(hex), policy), { code });

test("IEEE SFLOAT decodes signed exponent and mantissa instead of unsigned concentration", () => {
  assert.equal(decodeSFloat16(0xb078), 0.0012);
  assert.equal(decodeSFloat16(0xc037), 0.0055);
  assert.equal(decodeSFloat16(0x1fff), -10);
  assert.equal(decodeSFloat16(0x100c), 120);
});

test("IEEE special SFLOAT values are never converted to a plausible glucose number", () => {
  for (const raw of [0x07fe, 0x07ff, 0x0800, 0x0801, 0x0802])
    assert.throws(() => decodeSFloat16(raw), { code: "special_sfloat" });
  for (const raw of [-1, 65536, 1.5, NaN])
    assert.throws(() => decodeSFloat16(raw), { code: "invalid_sfloat" });
});

test("golden kg/L notification becomes 120 mg/dL with the original verified meter time", () => {
  const result = decodeGlucoseMeasurement(packet(glucose120), options);
  assert.deepEqual(result.event.reading, { kind: "glucose", value: 120, unit: "mg/dL" });
  assert.equal(result.event.measuredAt, "2026-10-11T07:30:00.000Z");
  assert.equal(result.sequence, 1);
  assert.equal(result.baseTime, "20261011T083000");
  assert.equal(result.timeOffsetMinutes, 0);
  assert.equal(result.event.quality, "accepted");
  assert.deepEqual(result.qualityReasons, []);
  assert.match(result.event.externalEventId, /^ble-glucose:[a-f0-9]{16}:first:1:20261011T083000:0$/);
  assert.equal(JSON.stringify(result).includes(options.meterIdentity), false);
});

test("golden mol/L notification stays 5.5 mmol/L rather than being interpreted as kg/L", () => {
  const result = decodeGlucoseMeasurement(packet("06 02 00 ea 07 0a 0b 08 1e 00 37 c0 11"), options);
  assert.deepEqual(result.event.reading, { kind: "glucose", value: 5.5, unit: "mmol/L" });
});

test("signed meter Time Offset changes displayed date independently from timezone", () => {
  const positive = decodeGlucoseMeasurement(packet("03 01 00 ea 07 0a 0b 08 1e 00 5a 00 78 b0 11"), options);
  assert.equal(positive.timeOffsetMinutes, 90);
  assert.equal(positive.event.measuredAt, "2026-10-11T09:00:00.000Z");
  const negative = decodeGlucoseMeasurement(packet("03 01 00 ea 07 0a 0b 00 1e 00 c4 ff 78 b0 11"), options);
  assert.equal(negative.timeOffsetMinutes, -60);
  assert.equal(negative.event.measuredAt, "2026-10-10T22:30:00.000Z");
});

test("omitted Time Offset needs a prior offset from this verified record transfer", () => {
  const { inheritedTimeOffsetMinutes: _, ...first } = options;
  expectError(glucose120, "missing_time_offset", first);
  const result = decodeGlucoseMeasurement(packet(glucose120), { ...options, inheritedTimeOffsetMinutes: 90 });
  assert.equal(result.event.measuredAt, "2026-10-11T09:00:00.000Z");
  expectError(glucose120, "invalid_time_policy", { ...options, inheritedTimeOffsetMinutes: 32768 });
});

test("unconfirmed or unspecified clock and timezone are rejected, never replaced by now", () => {
  expectError(glucose120, "unverified_clock", { ...options, clockVerified: false } as unknown as GlucoseDecodeOptions);
  const { utcOffsetMinutes: _, ...withoutZone } = options;
  expectError(glucose120, "invalid_time_policy", withoutZone as GlucoseDecodeOptions);
  for (const utcOffsetMinutes of [-841, 841, 60.5, NaN])
    expectError(glucose120, "invalid_time_policy", { ...options, utcOffsetMinutes });
});

test("invalid calendar dates including unknown meter date and normalized overflow fail closed", () => {
  for (const date of ["00 00 0a 0b 08 1e 00", "ea 07 00 0b 08 1e 00", "ea 07 02 1e 08 1e 00",
    "ea 07 0a 0b 18 1e 00", "ea 07 0a 0b 08 3c 00", "ea 07 0a 0b 08 1e 3c"])
    expectError(`02 01 00 ${date} 78 b0 11`, "invalid_base_time");
  const leap = decodeGlucoseMeasurement(packet("02 01 00 e8 07 02 1d 08 1e 00 78 b0 11"), options);
  assert.equal(leap.event.measuredAt, "2024-02-29T07:30:00.000Z");
});

test("length and reserved flags are checked before optional field parsing", () => {
  const full = packet("0b 01 00 ea 07 0a 0b 08 1e 00 00 00 78 b0 11 00 00");
  for (let length = 0; length < full.length; length++)
    assert.throws(() => decodeGlucoseMeasurement(full.subarray(0, length), options), { code: "invalid_length" });
  expectError(`${glucose120} 00`, "invalid_length");
  expectError(glucose120.replace(/^02/, "22"), "reserved_flags");
  expectError("00 01 00 ea 07 0a 0b 08 1e 00", "missing_concentration");
});

test("sensor warning and unverifiable context remain suspect and cannot become accepted", () => {
  const warning = decodeGlucoseMeasurement(packet("0a 01 00 ea 07 0a 0b 08 1e 00 78 b0 11 01 00"), options);
  assert.equal(warning.sensorStatus, 1);
  assert.equal(warning.event.quality, "suspect");
  assert.deepEqual(warning.qualityReasons, ["sensor_warning"]);
  const context = decodeGlucoseMeasurement(packet(glucose120.replace(/^02/, "12")), options);
  assert.equal(context.contextFollows, true);
  assert.equal(context.event.quality, "suspect");
  assert.deepEqual(context.qualityReasons, ["context_not_verified"]);
  expectError("0a 01 00 ea 07 0a 0b 08 1e 00 78 b0 11 00 08", "clock_fault");
  expectError("0a 01 00 ea 07 0a 0b 08 1e 00 78 b0 11 00 10", "reserved_sensor_status");
});

test("control solution is not a patient measurement and reserved sample fields are rejected", () => {
  for (const sample of ["1a", "41"]) expectError(glucose120.slice(0, -2) + sample, "control_solution");
  for (const sample of ["10", "1b", "01", "51"]) expectError(glucose120.slice(0, -2) + sample, "reserved_sample");
  for (const sample of ["13", "21", "f1", "19"]) {
    const result = decodeGlucoseMeasurement(packet(glucose120.slice(0, -2) + sample), options);
    assert.equal(result.event.quality, "suspect");
    assert.deepEqual(result.qualityReasons, ["unsupported_sample"]);
  }
});

test("nonpositive concentrations are rejected and positive values are never clamped", () => {
  expectError(glucose120.replace("78 b0", "00 00"), "invalid_concentration");
  expectError(glucose120.replace("78 b0", "ff bf"), "invalid_concentration");
  const large = decodeGlucoseMeasurement(packet(glucose120.replace("78 b0", "bc b2")), options);
  assert.equal(large.event.reading.value, 700);
});

test("retry identifier is stable without using arrival time and distinguishes sequence reset and meter", () => {
  const first = decodeGlucoseMeasurement(packet(glucose120), options);
  const retry = decodeGlucoseMeasurement(packet(glucose120), options);
  assert.deepEqual(retry.event, first.event);
  const changedZone = decodeGlucoseMeasurement(packet(glucose120), { ...options, utcOffsetMinutes: 0 });
  assert.equal(changedZone.event.externalEventId, first.event.externalEventId);
  assert.notEqual(changedZone.event.measuredAt, first.event.measuredAt); // A changed retry will conflict, not create a new reading.
  for (const policy of [{ ...options, epoch: "reset2" }, { ...options, meterIdentity: "METER-TEST-002" }])
    assert.notEqual(decodeGlucoseMeasurement(packet(glucose120), policy).event.externalEventId, first.event.externalEventId);
  const later = decodeGlucoseMeasurement(packet(glucose120.replace("0a 0b", "0a 0c")), options);
  assert.notEqual(later.event.externalEventId, first.event.externalEventId);
  for (const policy of [{ ...options, epoch: "" }, { ...options, epoch: "unsafe:epoch" }, { ...options, meterIdentity: " " }])
    expectError(glucose120, "invalid_identity", policy);
});
