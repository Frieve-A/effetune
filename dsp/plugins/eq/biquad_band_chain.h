#ifndef EFFETUNE_PLUGINS_EQ_BIQUAD_BAND_CHAIN_H
#define EFFETUNE_PLUGINS_EQ_BIQUAD_BAND_CHAIN_H

#include "effetune/dsp/biquad.h"
#include "effetune/dsp/channel_lanes.h"

#include <array>
#include <cstddef>
#include <cstdint>

namespace effetune::plugins::eq::detail {

// Linearly moves normalized biquad coefficients toward a target over a fixed number of frames.
struct CoefficientRamp {
  dsp::BiquadCoefficients current{};
  dsp::BiquadCoefficients target{};
  dsp::BiquadCoefficients step{0.0, 0.0, 0.0, 0.0, 0.0};
  std::uint32_t remaining = 0u;

  static bool identity(const dsp::BiquadCoefficients &value) noexcept {
    return value.b0 == 1.0 && value.b1 == 0.0 && value.b2 == 0.0 && value.a1 == 0.0 &&
           value.a2 == 0.0;
  }
  void snap(const dsp::BiquadCoefficients &value) noexcept {
    current = target = value;
    step = {0.0, 0.0, 0.0, 0.0, 0.0};
    remaining = 0u;
  }
  void retarget(const dsp::BiquadCoefficients &value, std::uint32_t frames) noexcept {
    target = value;
    const double denominator = static_cast<double>(frames);
    step = {(target.b0 - current.b0) / denominator, (target.b1 - current.b1) / denominator,
            (target.b2 - current.b2) / denominator, (target.a1 - current.a1) / denominator,
            (target.a2 - current.a2) / denominator};
    remaining = frames;
  }
  [[nodiscard]] bool processingRequired() const noexcept {
    return remaining != 0u || !identity(current);
  }
  [[nodiscard]] dsp::BiquadCoefficients value(std::uint32_t frame) const noexcept {
    const std::uint32_t elapsed = frame + 1u;
    if (elapsed >= remaining)
      return target;
    const double offset = static_cast<double>(elapsed);
    return {current.b0 + step.b0 * offset, current.b1 + step.b1 * offset,
            current.b2 + step.b2 * offset, current.a1 + step.a1 * offset,
            current.a2 + step.a2 * offset};
  }
  void advance(std::uint32_t frames) noexcept {
    if (frames >= remaining) {
      current = target;
      step = {0.0, 0.0, 0.0, 0.0, 0.0};
      remaining = 0u;
    } else {
      const double offset = static_cast<double>(frames);
      current = {current.b0 + step.b0 * offset, current.b1 + step.b1 * offset,
                 current.b2 + step.b2 * offset, current.a1 + step.a1 * offset,
                 current.a2 + step.a2 * offset};
      remaining -= frames;
    }
  }
};

// Filters Lanes adjacent planar channels through one band. Interleaving independent channels
// overlaps their recursions without changing any channel's arithmetic.
template <std::uint32_t Lanes>
inline void filterBandLanes(float *audio, std::uint32_t frame_count, const CoefficientRamp &ramp,
                            dsp::BiquadDf1State *states) noexcept {
  if (ramp.remaining == 0u) {
    const dsp::BiquadCoefficients target = ramp.target;
    dsp::processChannelLanes<Lanes>(
        audio, frame_count, frame_count, states,
        [&target](double input, dsp::BiquadDf1State &state, std::uint32_t) noexcept {
          return dsp::processBiquadDf1Sample(input, target, state);
        });
  } else {
    dsp::processChannelLanes<Lanes>(
        audio, frame_count, frame_count, states,
        [&ramp](double input, dsp::BiquadDf1State &state, std::uint32_t frame) noexcept {
          return dsp::processBiquadDf1Sample(input, ramp.value(frame), state);
        });
  }
}

// Applies the active bands in order to every planar channel. States are indexed
// band * state_stride + channel.
template <std::size_t Bands>
inline void processBandChain(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                             const std::array<CoefficientRamp, Bands> &ramps,
                             dsp::BiquadDf1State *states, std::uint32_t state_stride) noexcept {
  for (std::uint32_t channel = 0u; channel < channel_count; channel += 2u) {
    float *const channel_audio = audio + static_cast<std::size_t>(channel) * frame_count;
    const bool pair = channel + 1u < channel_count;
    for (std::size_t band = 0u; band < Bands; ++band) {
      if (!ramps[band].processingRequired())
        continue;
      dsp::BiquadDf1State *const band_states = states + band * state_stride + channel;
      if (pair)
        filterBandLanes<2u>(channel_audio, frame_count, ramps[band], band_states);
      else
        filterBandLanes<1u>(channel_audio, frame_count, ramps[band], band_states);
    }
  }
}

} // namespace effetune::plugins::eq::detail

#endif
