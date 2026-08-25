#ifndef EFFETUNE_DSP_DENORMAL_NOISE_H
#define EFFETUNE_DSP_DENORMAL_NOISE_H

#include <cstdint>

namespace effetune::dsp {

class NyquistDenormalNoise final {
public:
  static constexpr double kAmplitude = 1.0e-19;
  static constexpr std::uint32_t kMaximumPluginCount = 128u;
  // FM Radio Simulator has the current maximum of 38 coherent injection sites.
  static constexpr std::uint32_t kMaximumInternalCoherentSitesPerPlugin = 38u;
  static constexpr std::uint32_t kMaximumCoherentSitesPerPlugin =
      1u + kMaximumInternalCoherentSitesPerPlugin;
  static constexpr double kMaximumCombinedAmplitude =
      kAmplitude * kMaximumPluginCount * kMaximumCoherentSitesPerPlugin;
  static constexpr double kMaximumOutputNoiseAmplitude = 3.9810717055349695e-15;
  static_assert(kMaximumCombinedAmplitude <= kMaximumOutputNoiseAmplitude);

  constexpr void reset() noexcept { positive_ = true; }

  [[nodiscard]] constexpr double sample(std::uint32_t frame) const noexcept {
    const bool positive = ((frame & 1u) == 0u) == positive_;
    return positive ? kAmplitude : -kAmplitude;
  }

  constexpr void advance(std::uint32_t frame_count) noexcept {
    if ((frame_count & 1u) != 0u)
      positive_ = !positive_;
  }

private:
  bool positive_ = true;
};

} // namespace effetune::dsp

#endif
