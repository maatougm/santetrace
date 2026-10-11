#pragma once
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>

// Pure, allocation-bounded wire decoder. Bluetooth SIG Glucose Service v1.0.1.
namespace santetrace {
struct ClockPolicy {
  bool verified = false;
  int utcOffsetMinutes = 0; // A local wall-clock policy, NOT the sensor Time Offset.
  bool inheritedOffsetKnown = false;
  int inheritedTimeOffsetMinutes = 0;
};
struct GlucoseRecord {
  uint16_t sequence = 0;
  int timeOffsetMinutes = 0;
  double value = 0;
  bool mmol = false;
  bool contextFollows = false;
  bool suspect = false;
  uint16_t sensorStatus = 0;
  uint8_t typeSample = 0;
  int64_t utcSeconds = 0;
  std::string measuredAt;
  std::string baseStamp;
};
struct DecodeResult {
  bool ok = false;
  const char* error = "malformed";
  GlucoseRecord record;
};
inline uint16_t read16(const uint8_t* p) {
  return static_cast<uint16_t>(p[0] | static_cast<uint16_t>(p[1]) << 8);
}
inline bool leap(int year) { return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0); }
inline int monthDays(int year, int month) {
  constexpr int days[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  return days[month - 1] + (month == 2 && leap(year) ? 1 : 0);
}
inline bool civilSeconds(int year, int month, int day, int hour, int minute, int second, int64_t& result) {
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 ||
      day > monthDays(year, month) || hour > 23 || minute > 59 || second > 59) return false;
  int64_t days = 0;
  for (int y = 1970; y < year; ++y) days += leap(y) ? 366 : 365;
  for (int m = 1; m < month; ++m) days += monthDays(year, m);
  result = ((days + day - 1) * 24 + hour) * 3600 + minute * 60 + second;
  return true;
}
inline bool isoUtc(int64_t seconds, std::string& result) {
  if (seconds < 0) return false;
  int64_t days = seconds / 86400;
  int year = 1970;
  while (year <= 9999 && days >= (leap(year) ? 366 : 365)) days -= leap(year++) ? 366 : 365;
  if (year > 9999) return false;
  int month = 1;
  while (month < 12 && days >= monthDays(year, month)) days -= monthDays(year, month++);
  char text[32];
  std::snprintf(text, sizeof(text), "%04d-%02d-%02dT%02d:%02d:%02d.000Z", year, month,
    static_cast<int>(days) + 1, static_cast<int>((seconds / 3600) % 24),
    static_cast<int>((seconds / 60) % 60), static_cast<int>(seconds % 60));
  result = text;
  return true;
}
inline bool sfloat(uint16_t encoded, double& result) {
  const uint16_t mantissaBits = encoded & 0x0fff;
  if (mantissaBits >= 0x07fe && mantissaBits <= 0x0802) return false;
  int mantissa = mantissaBits >= 0x0800 ? static_cast<int>(mantissaBits) - 4096 : mantissaBits;
  int exponent = encoded >> 12;
  if (exponent >= 8) exponent -= 16;
  result = mantissa * std::pow(10.0, exponent);
  return std::isfinite(result);
}
inline DecodeResult decodeGlucose(const uint8_t* bytes, size_t size, const ClockPolicy& clock) {
  DecodeResult out;
  if (!clock.verified || clock.utcOffsetMinutes < -840 || clock.utcOffsetMinutes > 840) {
    out.error = "clock_unverified"; return out;
  }
  if (!bytes || size < 10 || size > 17) return out;
  const uint8_t flags = bytes[0];
  if (flags & 0xe0) { out.error = "reserved_flags"; return out; }
  if (!(flags & 2)) { out.error = "concentration_missing"; return out; }
  const size_t expected = 10 + ((flags & 1) ? 2 : 0) + 3 + ((flags & 8) ? 2 : 0);
  if (size != expected) return out;
  GlucoseRecord& r = out.record;
  r.sequence = read16(bytes + 1);
  const int year = read16(bytes + 3), month = bytes[5], day = bytes[6];
  const int hour = bytes[7], minute = bytes[8], second = bytes[9];
  int64_t baseSeconds;
  if (!civilSeconds(year, month, day, hour, minute, second, baseSeconds)) {
    out.error = "invalid_base_time"; return out;
  }
  size_t cursor = 10;
  if (flags & 1) {
    const uint16_t encoded = read16(bytes + cursor);
    r.timeOffsetMinutes = encoded >= 0x8000 ? static_cast<int>(encoded) - 65536 : encoded;
    cursor += 2;
  } else {
    if (!clock.inheritedOffsetKnown) { out.error = "time_offset_missing"; return out; }
    r.timeOffsetMinutes = clock.inheritedTimeOffsetMinutes;
  }
  if (r.timeOffsetMinutes < -32768 || r.timeOffsetMinutes > 32767) {
    out.error = "invalid_time_offset"; return out;
  }
  double concentration;
  if (!sfloat(read16(bytes + cursor), concentration) || concentration <= 0) {
    out.error = "invalid_sfloat"; return out;
  }
  r.mmol = (flags & 4) != 0;
  // These are base units; kg/L * 100000 = mg/dL, mol/L * 1000 = mmol/L.
  r.value = std::round(concentration * (r.mmol ? 1000.0 : 100000.0) * 1000000.0) / 1000000.0;
  r.typeSample = bytes[cursor + 2];
  cursor += 3;
  if (flags & 8) r.sensorStatus = read16(bytes + cursor);
  if (r.sensorStatus & 0xf000) { out.error = "reserved_sensor_status"; return out; }
  if (r.sensorStatus & 0x0800) { out.error = "clock_fault"; return out; }
  r.contextFollows = (flags & 16) != 0;
  // Only documented blood samples without contextual omissions may be accepted.
  const uint8_t type = r.typeSample & 15, location = r.typeSample >> 4;
  if (type == 10 || location == 4) { out.error = "control_solution"; return out; }
  if (type == 0 || type > 10 || location == 0 || (location > 4 && location != 15)) {
    out.error = "reserved_sample"; return out;
  }
  r.suspect = r.sensorStatus != 0 || r.contextFollows || (type != 1 && type != 2) || location != 1;
  r.utcSeconds = baseSeconds + (r.timeOffsetMinutes - clock.utcOffsetMinutes) * 60LL;
  if (!isoUtc(r.utcSeconds, r.measuredAt)) { out.error = "invalid_utc_time"; return out; }
  char stamp[24];
  std::snprintf(stamp, sizeof(stamp), "%04d%02d%02dT%02d%02d%02d", year, month, day, hour, minute, second);
  r.baseStamp = stamp;
  out.ok = true; out.error = nullptr;
  return out;
}
inline bool validEpoch(const std::string& epoch) {
  if (epoch.empty() || epoch.size() > 8) return false;
  for (char c : epoch) if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
    (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  return true;
}
inline std::string eventId(const std::string& meterFingerprint, const std::string& epoch, const GlucoseRecord& r) {
  if (meterFingerprint.size() != 16 || !validEpoch(epoch)) return {};
  for (char c : meterFingerprint) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return {};
  return "ble-glucose:" + meterFingerprint + ":" + epoch + ":" + std::to_string(r.sequence) + ":" +
    r.baseStamp + ":" + std::to_string(r.timeOffsetMinutes);
}
// Context is validated for length and association. It is not promoted to normal clinical evidence.
inline bool validContext(const uint8_t* bytes, size_t size, uint16_t sequence) {
  if (!bytes || size < 4 || size > 20 || read16(bytes + 1) != sequence) return false;
  uint8_t flags = bytes[0];
  if (((flags & 0x20) && !(flags & 0x10)) || !(flags & 0x5f)) return false;
  size_t expected = 3;
  if (flags & 0x80) { if (size < 4 || bytes[3] != 0) return false; ++expected; }
  if (flags & 1) expected += 3;
  if (flags & 2) ++expected;
  if (flags & 4) ++expected;
  if (flags & 8) expected += 3;
  if (flags & 16) expected += 3;
  if (flags & 64) expected += 2;
  return expected > 3 && expected == size;
}
} // namespace santetrace
