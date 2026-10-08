// Display coordinates only; neither decoder nor emitted beat identities depend on this clock.
#pragma once
#include "rd6_engine.h"
#include <array>
#include <cmath>

namespace effetune::plugins::analyzer::rhythm_a3 {
class ProvisionalClock {
public:
  void reset() noexcept {
    read_ = count_ = 0u;
    anchored_ = false;
  }
  void forward(const BeatEvent &beat) noexcept {
    if (count_ != 0u && points_[read_].epoch != beat.epoch)
      reset();
    if (count_ == kCapacity) {
      read_ = (read_ + 1u) % kCapacity;
      --count_;
    }
    points_[(read_ + count_++) % kCapacity] = {beat.time, beat.period, beat.epoch, beat.index};
  }
  void commit(const BeatEvent &beat) noexcept {
    anchor_ = {beat.time, beat.period, beat.epoch, beat.index};
    anchored_ = true;
  }
  // Match the closest forward beat within half the smaller local period. The first
  // (earlier) equal-distance beat wins. Remaining forward beats receive dense indices.
  bool annotate(double time, double &position, double &period) const noexcept {
    if ((!anchored_ && count_ == 0u) || (anchored_ && time < anchor_.time))
      return false;
    std::uint32_t match = count_;
    double distance = 0.0;
    if (anchored_) {
      for (std::uint32_t i = 0u; i < count_; ++i) {
        const auto &point = points_[(read_ + i) % kCapacity];
        const double local =
            anchor_.period > 0.0 && anchor_.period < point.period ? anchor_.period : point.period;
        const double delta = std::fabs(point.time - anchor_.time);
        if (local > 0.0 && delta <= .5 * local && (match == count_ || delta < distance)) {
          match = i;
          distance = delta;
        }
      }
    }
    AnalysisAnchor previous = anchored_ ? anchor_ : points_[read_];
    if (!anchored_ && time < previous.time) {
      period = previous.period;
      if (!(period > 0.0))
        return false;
      position = static_cast<double>(previous.index) + (time - previous.time) / period;
      return true;
    }
    for (std::uint32_t i = anchored_ ? 0u : 1u; i < count_; ++i) {
      const auto &point = points_[(read_ + i) % kCapacity];
      if (anchored_ && (point.time <= anchor_.time || i == match))
        continue;
      // Keep the first immutable identity when timestamps coincide in a display fixture.
      if (point.time <= previous.time)
        continue;
      if (time <= point.time && point.time > previous.time) {
        period = point.time - previous.time;
        position = static_cast<double>(previous.index) + (time - previous.time) / period;
        return true;
      }
      previous = {point.time, point.period, point.epoch, previous.index + 1};
    }
    period = previous.period;
    if (!(period > 0.0))
      return false;
    position = static_cast<double>(previous.index) + (time - previous.time) / period;
    return true;
  }

private:
  // Eight seconds at the fastest supported tempo exceeds the fixed-lag window.
  static constexpr std::uint32_t kCapacity = 32u;
  std::array<AnalysisAnchor, kCapacity> points_{};
  AnalysisAnchor anchor_;
  std::uint32_t read_ = 0u, count_ = 0u;
  bool anchored_ = false;
};
} // namespace effetune::plugins::analyzer::rhythm_a3
