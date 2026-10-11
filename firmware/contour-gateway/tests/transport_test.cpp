#include "transport_safety.h"
#include <cassert>
#include <iostream>
#include <thread>
using namespace santetrace;

int main() {
  unsigned checks = 0;
  auto check = [&checks](bool condition) { assert(condition); ++checks; };
  const std::string oldBinding(64, 'a'), newBinding(64, 'b');
  CheckpointBytes oldBlob{}, newBlob{};
  check(encodeCheckpoint({oldBinding, 65000}, oldBlob));
  Checkpoint oldState, selected;
  check(decodeCheckpoint(oldBlob, oldState));
  // A new meter/epoch must never inherit a previous meter's high ACK.
  check(selectCheckpoint(&oldState, newBinding, 7, false, selected));
  check(selected.binding == newBinding && selected.acknowledgedSequence == 6);
  check(encodeCheckpoint(selected, newBlob));
  // Failure before one atomic NVS put: the old complete blob remains and initialization repeats safely.
  Checkpoint beforeFailure;
  check(decodeCheckpoint(oldBlob, beforeFailure));
  check(selectCheckpoint(&beforeFailure, newBinding, 7, false, selected));
  check(selected.binding == newBinding && selected.acknowledgedSequence == 6);
  // Failure after the put: the new complete blob has both the new identity and the new start.
  Checkpoint afterFailure;
  check(decodeCheckpoint(newBlob, afterFailure));
  check(selectCheckpoint(&afterFailure, newBinding, 7, false, selected));
  check(selected.binding == newBinding && selected.acknowledgedSequence == 6);
  check(!selectCheckpoint(&oldState, newBinding, 7, true, selected));
  check(!selectCheckpoint(nullptr, newBinding, 7, true, selected));
  check(selectCheckpoint(&oldState, oldBinding, 0, true, selected));
  check(selected.acknowledgedSequence == 65000);
  Checkpoint lower{newBinding, 5};
  check(!selectCheckpoint(&lower, newBinding, 100, true, selected));
  check(selectCheckpoint(&lower, newBinding, 100, false, selected));
  check(selected.acknowledgedSequence == 99);
  check(encodeCheckpoint({newBinding, -1}, newBlob));
  check(decodeCheckpoint(newBlob, selected) && selected.acknowledgedSequence == -1);
  check(!encodeCheckpoint({newBinding, 65536}, newBlob));
  check(!encodeCheckpoint({newBinding, -2}, newBlob));
  check(!encodeCheckpoint({"invalid", 1}, newBlob));
  // Torn data fails closed instead of combining a new identity with old progress.
  check(encodeCheckpoint({newBinding, 6}, newBlob));
  auto torn = newBlob;
  for (size_t i = 0; i < 36; ++i) torn[i] = oldBlob[i];
  check(!decodeCheckpoint(torn, selected));
  torn = newBlob; torn[68] ^= 128; check(!decodeCheckpoint(torn, selected));
  torn = newBlob; torn[4] ^= 1; check(!decodeCheckpoint(torn, selected));
  // Lost sequence N closes admission, processing and every later receipt's ACK gate.
  TransportBarrier barrier;
  check(barrier.canProcess()); check(barrier.canAdvanceCheckpoint());
  barrier.overflow();
  for (int sequence = 101; sequence < 200; ++sequence) {
    (void)sequence; check(!barrier.canProcess()); check(!barrier.canAdvanceCheckpoint());
  }
  barrier.overflow(); check(!barrier.canAdvanceCheckpoint());
  TransportBarrier concurrent;
  std::thread callback([&concurrent] { concurrent.overflow(); });
  callback.join();
  check(!concurrent.canProcess() && !concurrent.canAdvanceCheckpoint());
  std::cout << checks << " transport safety assertions passed\n";
}
