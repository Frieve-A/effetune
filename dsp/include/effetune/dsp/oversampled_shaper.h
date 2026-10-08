#ifndef EFFETUNE_DSP_OVERSAMPLED_SHAPER_H
#define EFFETUNE_DSP_OVERSAMPLED_SHAPER_H

#include "effetune/dsp/fir.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::dsp {

// Polyphase interpolation and full-band decimation around a memoryless shaper.
// Both FIRs have 32 input-frame group delay; phase zero gives integer latency.
class OversampledShaper {
public:
  static constexpr std::uint32_t kLatency = 64u;
  static std::uint32_t factor(float value, std::uint32_t maximum = 8u) noexcept {
    return value == 2.0F                      ? 2u
           : value == 4.0F                    ? 4u
           : value == 8.0F                    ? 8u
           : value == 16.0F && maximum == 16u ? 16u
                                              : 1u;
  }
  void prepare(std::uint32_t channels) {
    states_.resize(channels);
    for (std::uint32_t level = 0u; level < 4u; ++level) {
      const std::uint32_t rate = 2u << level;
      const std::uint32_t length = kLatency * rate + 1u;
      auto &coefficients = coefficients_[level];
      coefficients.resize(length);
      double sum = 0.0;
      constexpr double pi = 3.14159265358979323846;
      for (std::uint32_t tap = 0; tap < length; ++tap) {
        const double offset = static_cast<double>(tap) - 32.0 * rate;
        const double angle = 2.0 * pi * tap / (length - 1u);
        const double window = 0.42 - 0.5 * std::cos(angle) + 0.08 * std::cos(2.0 * angle);
        const double cutoff = 0.475 / rate;
        const double sinc =
            offset == 0.0 ? 2.0 * cutoff : std::sin(2.0 * pi * cutoff * offset) / (pi * offset);
        coefficients[tap] = sinc * window;
        sum += coefficients[tap];
      }
      for (double &coefficient : coefficients)
        coefficient /= sum;
      // The windowed sinc is symmetric; calculate each mirrored pair identically.
      for (std::uint32_t tap = 0u; tap < length / 2u; ++tap)
        coefficients[length - 1u - tap] = coefficients[tap];
      auto &phases = interpolation_[level];
      phases.resize(rate * 65u);
      for (std::uint32_t phase = 0u; phase < rate; ++phase) {
        const std::uint32_t taps = phase == 0u ? 65u : 64u;
        for (std::uint32_t tap = 0u; tap < taps; ++tap)
          phases[phase * 65u + tap] = coefficients[phase + (taps - 1u - tap) * rate];
      }
    }
    reset();
  }
  void reset() noexcept {
    for (auto &state : states_)
      state = {};
    active_factor_ = 1u;
    active_channels_ = 0u;
  }
  void configure(std::uint32_t rate, std::uint32_t channels) noexcept {
    if (rate != active_factor_ || channels != active_channels_) {
      reset();
      active_factor_ = rate;
      active_channels_ = channels;
    }
  }
  double delay(std::uint32_t channel, double input) noexcept {
    if (active_factor_ == 1u)
      return input;
    auto &state = states_[channel];
    const double output = state.dry[state.dry_position];
    state.dry[state.dry_position] = input;
    state.dry_position = (state.dry_position + 1u) & (kLatency - 1u);
    return output;
  }
  template <typename Shape>
  double process(std::uint32_t channel, double input, Shape shape) noexcept {
    if (active_factor_ == 1u)
      return shape(input);
    auto &state = states_[channel];
    const auto rate = active_factor_;
    const auto level = rate == 2u ? 0u : rate == 4u ? 1u : rate == 8u ? 2u : 3u;
    const auto &coefficients = coefficients_[level];
    const auto length = static_cast<std::uint32_t>(coefficients.size());
    state.input[state.input_position] = input;
    state.input[state.input_position + 65u] = input;
    double output = 0.0;
    for (std::uint32_t phase = 0u; phase < rate; ++phase) {
      const std::uint32_t taps = phase == 0u ? 65u : 64u;
      const double *history = state.input.data() + state.input_position + 66u - taps;
      const double *filter = interpolation_[level].data() + phase * 65u;
      const double interpolated = phase == 0u || phase * 2u == rate
                                      ? firSymmetric(filter, history, taps)
                                      : firDot(filter, history, taps);
      const double shaped = shape(interpolated * rate);
      state.output[state.output_position] = shaped;
      state.output[state.output_position + length] = shaped;
      if (phase == 0u)
        output = firSymmetric(coefficients.data(), state.output.data() + state.output_position + 1u,
                              length);
      if (++state.output_position == length)
        state.output_position = 0u;
    }
    if (++state.input_position == 65u)
      state.input_position = 0u;
    return output;
  }

private:
  struct State {
    // Mirrored rings expose the entire FIR history contiguously without per-tap wrapping.
    std::array<double, 130> input{};
    std::array<double, 2050> output{};
    std::array<double, kLatency> dry{};
    std::uint32_t input_position = 0u;
    std::uint32_t output_position = 0u;
    std::uint32_t dry_position = 0u;
  };
  std::vector<State> states_;
  std::array<std::vector<double>, 4> coefficients_;
  std::array<std::vector<double>, 4> interpolation_;
  std::uint32_t active_factor_ = 1u;
  std::uint32_t active_channels_ = 0u;
};
} // namespace effetune::dsp
#endif
