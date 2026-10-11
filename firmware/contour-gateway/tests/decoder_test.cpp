#include "glucose_decoder.h"
#include <cassert>
#include <iostream>
#include <vector>
using namespace santetrace;

int main() {
  unsigned checks = 0;
  auto check = [&checks](bool condition) { assert(condition); ++checks; };
  const std::vector<uint8_t> kg = {0x02,1,0,0xea,0x07,10,11,8,30,0,0x78,0xb0,0x11};
  const ClockPolicy verified{true,60,true,0};
  auto decode = [](const std::vector<uint8_t>& p, ClockPolicy c) { return decodeGlucose(p.data(), p.size(), c); };
  auto normal = decode(kg, verified);
  check(normal.ok); check(normal.record.value == 120); check(!normal.record.mmol); check(!normal.record.suspect);
  check(normal.record.measuredAt == "2026-10-11T07:30:00.000Z"); check(normal.record.baseStamp == "20261011T083000");
  check(eventId("0123456789abcdef", "1", normal.record) == "ble-glucose:0123456789abcdef:1:1:20261011T083000:0");
  check(eventId("0123456789abcdef", "invalid:epoch", normal.record).empty());
  check(eventId("not_a_sha256", "1", normal.record).empty());
  auto mmol = kg; mmol[0] = 0x06; mmol[10] = 0x37; mmol[11] = 0xc0;
  auto molResult = decode(mmol, verified);
  check(molResult.ok && molResult.record.mmol && molResult.record.value == 5.5);
  auto offset = kg; offset[0] |= 1; offset.insert(offset.begin() + 10, {0xc4,0xff});
  auto offsetResult = decode(offset, {true,60,false,0});
  check(offsetResult.ok && offsetResult.record.timeOffsetMinutes == -60);
  check(offsetResult.record.measuredAt == "2026-10-11T06:30:00.000Z");
  check(!decode(kg, {false,60,true,0}).ok); check(!decode(kg, {true,841,true,0}).ok);
  check(!decode(kg, {true,60,false,0}).ok);
  for (size_t n = 0; n < kg.size(); ++n) {
    auto truncated = kg; truncated.resize(n); check(!decode(truncated, verified).ok);
  }
  auto trailing = kg; trailing.push_back(0); check(!decode(trailing, verified).ok);
  auto reserved = kg; reserved[0] |= 0x20; check(!decode(reserved, verified).ok);
  for (uint16_t special : {0x07fe,0x07ff,0x0800,0x0801,0x0802,0xb7ff}) {
    auto invalid = kg; invalid[10] = special & 255; invalid[11] = special >> 8;
    check(!decode(invalid, verified).ok);
  }
  auto zero = kg; zero[10] = 0; zero[11] = 0; check(!decode(zero, verified).ok);
  auto negative = kg; negative[10] = 0xff; negative[11] = 0xff; check(!decode(negative, verified).ok);
  auto invalidDate = kg; invalidDate[5] = 2; invalidDate[6] = 30; check(!decode(invalidDate, verified).ok);
  invalidDate = kg; invalidDate[5] = 0; check(!decode(invalidDate, verified).ok);
  invalidDate = kg; invalidDate[3] = 0; invalidDate[4] = 0; check(!decode(invalidDate, verified).ok);
  invalidDate = kg; invalidDate[7] = 24; check(!decode(invalidDate, verified).ok);
  auto warning = kg; warning[0] |= 8; warning.insert(warning.end(), {1,0});
  check(decode(warning, verified).ok && decode(warning, verified).record.suspect);
  warning[14] = 8; warning[13] = 0; check(!decode(warning, verified).ok); // Time fault.
  warning[14] = 16; check(!decode(warning, verified).ok); // RFU sensor bit12.
  auto context = kg; context[0] |= 16;
  check(decode(context, verified).ok && decode(context, verified).record.suspect && decode(context, verified).record.contextFollows);
  for (uint8_t typeSample : {uint8_t(0x1a),uint8_t(0x41),uint8_t(0x10),uint8_t(0x51)}) {
    auto control = kg; control[12] = typeSample; check(!decode(control, verified).ok);
  }
  auto unsupported = kg; unsupported[12] = 0x13;
  check(decode(unsupported, verified).ok && decode(unsupported, verified).record.suspect);
  auto fingerPlasma = kg; fingerPlasma[12] = 0x12;
  check(decode(fingerPlasma, verified).ok && !decode(fingerPlasma, verified).record.suspect);
  const uint8_t validContextBytes[] = {2,1,0,1};
  check(validContext(validContextBytes, sizeof(validContextBytes), 1));
  check(!validContext(validContextBytes, sizeof(validContextBytes), 2));
  check(!validContext(validContextBytes, 3, 1));
  const uint8_t malformedContext[] = {0x80,1,0,0};
  check(!validContext(malformedContext, sizeof(malformedContext), 1));
  auto sameRecordOtherTimezone = decode(kg, {true,120,true,0});
  check(sameRecordOtherTimezone.ok && sameRecordOtherTimezone.record.measuredAt != normal.record.measuredAt);
  check(eventId("0123456789abcdef", "1", sameRecordOtherTimezone.record) == eventId("0123456789abcdef", "1", normal.record));
  check(eventId("0123456789abcdef", "2", normal.record) != eventId("0123456789abcdef", "1", normal.record));
  int64_t leapTime = 0; std::string iso;
  check(civilSeconds(2024,2,29,0,0,0,leapTime) && isoUtc(leapTime, iso) && iso == "2024-02-29T00:00:00.000Z");
  check(!civilSeconds(2023,2,29,0,0,0,leapTime));
  check(!isoUtc(-1, iso));
  std::cout << checks << " decoder assertions passed\n";
}
