#pragma once
#include <cmath>
#include <cstdint>
#include <limits>
#include <span>

namespace effetune::plugins::others::sfz::conditions {
struct ControllerRange {
  std::uint32_t controller = 0;
  float low = -1, high = -1;
};
inline bool contains(const ControllerRange &range, float normalized) noexcept {
  return std::isfinite(normalized) && (range.low < 0 || normalized >= range.low) &&
         (range.high < 0 || normalized <= range.high);
}
template <class Controller>
bool matchControllers(std::span<const ControllerRange> ranges, Controller &&normalized) noexcept {
  for (const auto &range : ranges)
    if (!contains(range, normalized(range.controller)))
      return false;
  return true;
}
inline bool matchesEvent(std::span<const ControllerRange> ranges, std::uint32_t controller,
                         float normalized) noexcept {
  for (const auto &range : ranges)
    if (range.controller == controller && (range.low >= 0 || range.high >= 0) &&
        contains(range, normalized))
      return true;
  return false;
}
inline bool hasEventTrigger(std::span<const ControllerRange> ranges) noexcept {
  for (const auto &range : ranges)
    if (range.low >= 0 || range.high >= 0)
      return true;
  return false;
}
inline bool tempo(float low, float high, double bpm) noexcept {
  return std::isfinite(bpm) && bpm >= low && bpm < high;
}
// The caller snapshots group age before selecting every layer of one event and
// commits the timestamp after all accepted births. A never-played group has
// infinite age; an omitted upper bound permits its first birth.
inline bool timer(float low, float high, double groupAgeSeconds) noexcept {
  return !std::isnan(groupAgeSeconds) && groupAgeSeconds >= low &&
         (high == std::numeric_limits<float>::max() || groupAgeSeconds < high);
}
} // namespace effetune::plugins::others::sfz::conditions
