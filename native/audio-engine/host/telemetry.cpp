#include "telemetry.h"
#include "engine.h"
namespace effetune::audio {
void Telemetry::read(Engine &engine, std::uint64_t endFrame, std::uint64_t revision,
                     VisualizerStage stage, bool independent) noexcept {
  const auto next = write_.load(std::memory_order_relaxed);
  if ((!enabled && !independent && !midiMetering) ||
      next - read_.load(std::memory_order_acquire) >= packets_.size()) {
    if (!backlog_)
      backlog_ = endFrame;
    return;
  }
  auto &p = packets_[next % packets_.size()];
  p.bytes = engine.readTelemetry(p.data.data(), static_cast<unsigned>(p.data.size()), &p.dropped);
  dropped_.fetch_add(p.dropped, std::memory_order_relaxed);
  if (!p.bytes)
    return;
  p.endFrame = endFrame;
  p.mixerEndFrame = backlog_ ? backlog_ : endFrame;
  backlog_ = 0;
  p.revision = revision;
  p.stage = stage;
  write_.store(next + 1, std::memory_order_release);
}
const TelemetryPacket *Telemetry::front() const noexcept {
  const auto read = read_.load(std::memory_order_relaxed);
  return read == write_.load(std::memory_order_acquire) ? nullptr
                                                        : &packets_[read % packets_.size()];
}
void Telemetry::pop() noexcept { read_.fetch_add(1, std::memory_order_release); }
} // namespace effetune::audio
