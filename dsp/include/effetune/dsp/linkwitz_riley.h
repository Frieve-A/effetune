#ifndef EFFETUNE_DSP_LINKWITZ_RILEY_H
#define EFFETUNE_DSP_LINKWITZ_RILEY_H

#include "effetune/dsp/biquad.h"

#include <cmath>
#include <numbers>

namespace effetune::dsp {

struct LinkwitzRiley24Coefficients final {
  BiquadCoefficients lowpass{};
  BiquadCoefficients highpass{};
};

struct LinkwitzRiley24State final {
  BiquadDf1State stage1{};
  BiquadDf1State stage2{};
};

enum class LinkwitzRileyStateStorage {
  Float32,
  Float64,
};

[[nodiscard]] inline LinkwitzRiley24Coefficients
designLinkwitzRiley24(double sample_rate, double requested_cutoff) noexcept {
  LinkwitzRiley24Coefficients result{};
  if (!std::isfinite(sample_rate) || sample_rate <= 0.0 || !std::isfinite(requested_cutoff)) {
    return result;
  }

  const double maximum_cutoff = sample_rate * 0.499;
  double cutoff = requested_cutoff > maximum_cutoff ? maximum_cutoff : requested_cutoff;
  if (cutoff < 10.0)
    cutoff = 10.0;
  if (cutoff <= 0.0 || cutoff >= sample_rate * 0.5)
    return result;

  const double k = 2.0 * sample_rate;
  const double warped =
      2.0 * sample_rate * std::tan(std::numbers::pi_v<double> * cutoff / sample_rate);
  const double q = kSecondOrderButterworthQ;
  const double k_squared = k * k;
  const double warped_squared = warped * warped;
  const double k_squared_q = k_squared * q;
  const double warped_squared_q = warped_squared * q;
  const double a0 = k_squared_q + k * warped + warped_squared_q;

  result.lowpass.b0 = warped_squared_q / a0;
  result.lowpass.b1 = 2.0 * warped_squared_q / a0;
  result.lowpass.b2 = warped_squared_q / a0;
  result.lowpass.a1 = (-2.0 * k_squared_q + 2.0 * warped_squared_q) / a0;
  result.lowpass.a2 = (k_squared_q - k * warped + warped_squared_q) / a0;

  result.highpass.b0 = k_squared_q / a0;
  result.highpass.b1 = -2.0 * k_squared_q / a0;
  result.highpass.b2 = k_squared_q / a0;
  result.highpass.a1 = result.lowpass.a1;
  result.highpass.a2 = result.lowpass.a2;
  return result;
}

inline void resetLinkwitzRiley24State(
    LinkwitzRiley24State &state,
    LinkwitzRileyStateStorage storage = LinkwitzRileyStateStorage::Float64) noexcept {
  const double exact_epsilon = 1.0e-25;
  const double epsilon = storage == LinkwitzRileyStateStorage::Float32
                             ? static_cast<double>(static_cast<float>(exact_epsilon))
                             : exact_epsilon;
  state.stage1 = {epsilon, -epsilon, epsilon, -epsilon};
  state.stage2 = {epsilon, -epsilon, epsilon, -epsilon};
}

[[nodiscard]] inline double processLinkwitzRiley24Sample(double input,
                                                         const BiquadCoefficients &coefficients,
                                                         LinkwitzRiley24State &state) noexcept {
  const double stage1 = processBiquadDf1Sample(input, coefficients, state.stage1);
  return processBiquadDf1Sample(stage1, coefficients, state.stage2);
}

inline void quantizeLinkwitzRiley24StateToFloat(LinkwitzRiley24State &state) noexcept {
  quantizeBiquadStateToFloat(state.stage1);
  quantizeBiquadStateToFloat(state.stage2);
}

} // namespace effetune::dsp

#endif
