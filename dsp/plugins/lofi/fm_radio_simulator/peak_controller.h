// FM Radio Simulator: MPX peak controller (lookahead limiter).
//
// Shared verbatim between kernel.cpp (production) and native_test.cpp
// (unit test) so the test always exercises the real implementation.

#ifndef EFFETUNE_PLUGINS_LOFI_FM_RADIO_SIMULATOR_PEAK_CONTROLLER_H
#define EFFETUNE_PLUGINS_LOFI_FM_RADIO_SIMULATOR_PEAK_CONTROLLER_H

#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::lofi {

constexpr std::uint32_t kPeakLookahead = 16u;

struct PeakController final {
  std::array<float, kPeakLookahead> delay{};
  std::uint32_t position = 0u;
  float gain = 1.0F;
  float release = 0.999F;

  void configure(double sample_rate) noexcept {
    release = static_cast<float>(std::exp(-1.0 / (0.050 * sample_rate)));
  }

  void reset() noexcept {
    delay.fill(0.0F);
    position = 0u;
    gain = 1.0F;
  }

  float process(float input) noexcept {
    delay[position] = input;
    float peak = 0.0F;
    for (float sample : delay) {
      const float absolute = sample < 0.0F ? -sample : sample;
      peak = absolute > peak ? absolute : peak;
    }
    const float target = peak > 0.98F ? 0.98F / peak : 1.0F;
    gain = target < gain ? target : release * gain + (1.0F - release) * target;
    position = position + 1u == kPeakLookahead ? 0u : position + 1u;
    return delay[position] * gain;
  }
};

} // namespace effetune::plugins::lofi

#endif // EFFETUNE_PLUGINS_LOFI_FM_RADIO_SIMULATOR_PEAK_CONTROLLER_H
