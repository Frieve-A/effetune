#ifndef EFFETUNE_PLUGINS_RESONATOR_MODAL_RESONATOR_COMMON_H
#define EFFETUNE_PLUGINS_RESONATOR_MODAL_RESONATOR_COMMON_H

#include <cmath>
#include <cstdint>
#include <limits>

namespace effetune::plugins::resonator::modal_resonator {

constexpr std::uint32_t kResonatorCount = 5u;
constexpr double kMinimumFrequencyLog = 3.0;

inline std::uint32_t delayBufferLength(double sample_rate) noexcept {
  if (!std::isfinite(sample_rate) || sample_rate <= 0.0)
    return 2u;
  const double maximum_delay = std::floor(sample_rate / std::exp(kMinimumFrequencyLog));
  if (maximum_delay < 1.0)
    return 2u;
  constexpr double kLargestDelay =
      static_cast<double>(std::numeric_limits<std::uint32_t>::max() - 1u);
  if (maximum_delay >= kLargestDelay) {
    return std::numeric_limits<std::uint32_t>::max();
  }
  return static_cast<std::uint32_t>(maximum_delay) + 1u;
}

} // namespace effetune::plugins::resonator::modal_resonator

#endif
