#pragma once
#include "network_output.h"
#include <array>
#include <atomic>
#include <cstdint>
namespace effetune {
class Engine;
}
namespace effetune::audio {
struct TelemetryPacket {
  std::array<std::uint8_t, 65536> data;
  std::uint32_t bytes = 0, dropped = 0;
  std::uint64_t endFrame = 0, mixerEndFrame = 0, revision = 0;
  VisualizerStage stage = VisualizerStage::pipeline;
};
class Telemetry {
public:
  void read(Engine &engine, std::uint64_t endFrame, std::uint64_t revision, VisualizerStage stage,
            bool independent = false) noexcept;
  const TelemetryPacket *front() const noexcept;
  void pop() noexcept;
  std::uint64_t dropped() const noexcept { return dropped_.load(std::memory_order_relaxed); }
  bool enabled = true;
  bool midiMetering = false;

private:
  std::array<TelemetryPacket, 3> packets_;
  std::atomic<unsigned> read_{0}, write_{0};
  std::atomic<std::uint64_t> dropped_{0};
  std::uint64_t backlog_ = 0;
};
} // namespace effetune::audio
