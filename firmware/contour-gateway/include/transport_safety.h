#pragma once
#include <array>
#include <atomic>
#include <cstdint>
#include <string>

namespace santetrace {
// One NVS blob contains the identity and progress together. Never commit separate keys.
using CheckpointBytes = std::array<uint8_t, 76>;
struct Checkpoint { std::string binding; int acknowledgedSequence = -1; };
inline uint32_t checkpointHash(const CheckpointBytes& bytes) {
  uint32_t value = 2166136261u;
  for (size_t i = 0; i < 72; ++i) value = (value ^ bytes[i]) * 16777619u;
  return value;
}
inline bool validBinding(const std::string& binding) {
  if (binding.size() != 64) return false;
  for (char c : binding) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  return true;
}
inline bool encodeCheckpoint(const Checkpoint& checkpoint, CheckpointBytes& bytes) {
  if (!validBinding(checkpoint.binding) || checkpoint.acknowledgedSequence < -1 || checkpoint.acknowledgedSequence > 65535) return false;
  bytes = {}; bytes[0] = 'S'; bytes[1] = 'T'; bytes[2] = 'C'; bytes[3] = '1';
  for (size_t i = 0; i < 64; ++i) bytes[4 + i] = checkpoint.binding[i];
  const uint32_t sequence = static_cast<uint32_t>(checkpoint.acknowledgedSequence);
  for (unsigned i = 0; i < 4; ++i) bytes[68 + i] = sequence >> (i * 8);
  const uint32_t hash = checkpointHash(bytes);
  for (unsigned i = 0; i < 4; ++i) bytes[72 + i] = hash >> (i * 8);
  return true;
}
inline bool decodeCheckpoint(const CheckpointBytes& bytes, Checkpoint& result) {
  if (bytes[0] != 'S' || bytes[1] != 'T' || bytes[2] != 'C' || bytes[3] != '1') return false;
  uint32_t hash = 0, sequence = 0;
  for (unsigned i = 0; i < 4; ++i) { hash |= uint32_t(bytes[72 + i]) << (i * 8); sequence |= uint32_t(bytes[68 + i]) << (i * 8); }
  if (hash != checkpointHash(bytes) || (sequence != 0xffffffffu && sequence > 65535)) return false;
  const std::string binding(reinterpret_cast<const char*>(bytes.data() + 4), 64);
  if (!validBinding(binding)) return false;
  result = {binding, sequence == 0xffffffffu ? -1 : static_cast<int>(sequence)};
  return true;
}
inline bool selectCheckpoint(const Checkpoint* existing, const std::string& binding, uint16_t firstSequence,
                             bool pendingReadings, Checkpoint& selected) {
  if (!validBinding(binding)) return false;
  if (existing && existing->binding == binding && existing->acknowledgedSequence >= int(firstSequence) - 1) {
    selected = *existing; return true;
  }
  if (pendingReadings) return false;
  selected = {binding, int(firstSequence) - 1}; return true;
}
class TransportBarrier {
  std::atomic<bool> overflow_{false};
 public:
  bool canProcess() const { return !overflow_.load(std::memory_order_acquire); }
  bool canAdvanceCheckpoint() const { return canProcess(); }
  void overflow() { overflow_.store(true, std::memory_order_release); }
  // There is deliberately no unattended reset after losing a frame.
};
} // namespace santetrace
