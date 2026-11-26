#pragma once
#include <cstdint>
#include <optional>

namespace effetune::audio {
// Loopback capture delivers no packets while nothing renders to the endpoint.
// A boundary marks that pause so the capture FIFO can end the burst. Packets
// arrive once per device period with scheduling jitter, so a single late
// period must not count as a pause: each boundary drains the FIFO and restarts
// its resampler, which is audible inside continuous playback.
class LoopbackSilence {
public:
  static constexpr std::uint64_t idlePeriods = 3;

  void supplied(std::uint64_t nowNs) noexcept { lastPacket_ = nowNs; }
  bool takeBoundary(std::uint64_t nowNs, std::uint64_t periodNs) noexcept {
    if (!lastPacket_ || nowNs - *lastPacket_ < idlePeriods * periodNs)
      return false;
    lastPacket_.reset();
    return true;
  }

private:
  std::optional<std::uint64_t> lastPacket_;
};
} // namespace effetune::audio
