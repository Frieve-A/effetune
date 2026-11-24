#pragma once
#include <cstdint>
#include <optional>

namespace effetune::audio {
class LoopbackSilence {
public:
  void supplied(std::uint64_t nowNs) noexcept { lastPacket_ = nowNs; }
  bool takeBoundary(std::uint64_t nowNs, std::uint64_t periodNs) noexcept {
    if (!lastPacket_ || nowNs - *lastPacket_ < periodNs)
      return false;
    lastPacket_.reset();
    return true;
  }

private:
  std::optional<std::uint64_t> lastPacket_;
};
} // namespace effetune::audio
