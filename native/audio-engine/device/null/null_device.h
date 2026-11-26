#pragma once

#include "host/session.h"
#include <span>
#include <vector>

namespace effetune::audio {
// A caller advances virtual device time by submitting a planar callback buffer.
// Only the control-side test ingress and capture perform conversions and allocate.
class NullDevice {
public:
  Session session;
  std::vector<std::uint8_t> render(std::span<const std::uint8_t> input, std::uint32_t frames);
  static std::vector<std::uint8_t> render(Session &session, std::span<const std::uint8_t> input,
                                          std::uint32_t frames,
                                          std::uint64_t *processingNs = nullptr);
  struct BenchmarkTiming {
    std::uint64_t elapsedNs = 0;
    std::uint64_t blocks = 0;
  };
  // blockLoop holds whole blocks, each planar over blockSize frames, and is replayed
  // cyclically until the timed session renders add up to durationNs.
  static BenchmarkTiming benchmark(Session &session, std::span<const float> blockLoop,
                                   std::uint32_t blockSize, std::uint32_t warmupBlocks,
                                   std::uint64_t durationNs);
};
} // namespace effetune::audio
