#ifndef EFFETUNE_PLUGINS_EQ_PEQ_COEFFICIENTS_H
#define EFFETUNE_PLUGINS_EQ_PEQ_COEFFICIENTS_H

#include "effetune/dsp/biquad.h"

#include <cmath>

namespace effetune::plugins::eq::detail {

inline bool makePeqCoefficients(float gain_db_value, float type_value, float frequency_value,
                                float q_value, float enabled_value, float sample_rate,
                                dsp::BiquadCoefficients &output) noexcept {
  constexpr double kPi = 3.141592653589793;
  constexpr double kTwoPi = 6.283185307179586;
  constexpr double kBypassThreshold = 0.01;
  constexpr double kA0Threshold = 1.0e-8;
  const int type = static_cast<int>(type_value);
  if (enabled_value < 0.5F) {
    return false;
  }

  const double gain_db = gain_db_value;
  const double gain_abs = gain_db < 0.0 ? -gain_db : gain_db;
  const bool response_without_gain = type == 1 || type == 2 || type == 5 || type == 6 || type == 7;
  if (gain_abs < kBypassThreshold && !response_without_gain) {
    return false;
  }

  double q = q_value;
  if ((type == 3 || type == 4) && q > 2.0) {
    q = 2.0;
  }
  if (q < 0.1) {
    q = 0.1;
  }

  const double a = std::pow(10.0, 0.025 * gain_db);
  const double w0 =
      static_cast<double>(frequency_value) * kTwoPi / static_cast<double>(sample_rate);
  const double clamped_w0 = w0 < 1.0e-6 ? 1.0e-6 : (w0 > kPi - 1.0e-6 ? kPi - 1.0e-6 : w0);
  const double cosine = std::cos(clamped_w0);
  const double sine = std::sin(clamped_w0);
  const double alpha = sine / (2.0 * q);
  const double negative_two_cosine = -2.0 * cosine;
  double b0 = 0.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a0 = 1.0;
  double a1 = 0.0;
  double a2 = 0.0;

  switch (type) {
  case 0: {
    const double alpha_times_a = alpha * a;
    const double alpha_over_a = alpha / a;
    b0 = 1.0 + alpha_times_a;
    b1 = negative_two_cosine;
    b2 = 1.0 - alpha_times_a;
    a0 = 1.0 + alpha_over_a;
    a1 = negative_two_cosine;
    a2 = 1.0 - alpha_over_a;
    break;
  }
  case 1: {
    const double one_minus_cosine = 1.0 - cosine;
    b0 = one_minus_cosine * 0.5;
    b1 = one_minus_cosine;
    b2 = b0;
    a0 = 1.0 + alpha;
    a1 = negative_two_cosine;
    a2 = 1.0 - alpha;
    break;
  }
  case 2: {
    const double one_plus_cosine = 1.0 + cosine;
    b0 = one_plus_cosine * 0.5;
    b1 = -one_plus_cosine;
    b2 = b0;
    a0 = 1.0 + alpha;
    a1 = negative_two_cosine;
    a2 = 1.0 - alpha;
    break;
  }
  case 3: {
    const double sqrt_a = std::sqrt(a < 0.0 ? 0.0 : a);
    const double twice_sqrt_a_alpha = 2.0 * sqrt_a * alpha;
    const double a_plus_one = a + 1.0;
    const double a_minus_one = a - 1.0;
    const double common_one = a_plus_one - a_minus_one * cosine;
    const double common_two = a_plus_one + a_minus_one * cosine;
    b0 = a * (common_one + twice_sqrt_a_alpha);
    b1 = 2.0 * a * (a_minus_one - a_plus_one * cosine);
    b2 = a * (common_one - twice_sqrt_a_alpha);
    a0 = common_two + twice_sqrt_a_alpha;
    a1 = -2.0 * (a_minus_one + a_plus_one * cosine);
    a2 = common_two - twice_sqrt_a_alpha;
    break;
  }
  case 4: {
    const double sqrt_a = std::sqrt(a < 0.0 ? 0.0 : a);
    const double twice_sqrt_a_alpha = 2.0 * sqrt_a * alpha;
    const double a_plus_one = a + 1.0;
    const double a_minus_one = a - 1.0;
    const double common_one = a_plus_one + a_minus_one * cosine;
    const double common_two = a_plus_one - a_minus_one * cosine;
    b0 = a * (common_one + twice_sqrt_a_alpha);
    b1 = -2.0 * a * (a_minus_one + a_plus_one * cosine);
    b2 = a * (common_one - twice_sqrt_a_alpha);
    a0 = common_two + twice_sqrt_a_alpha;
    a1 = 2.0 * (a_minus_one - a_plus_one * cosine);
    a2 = common_two - twice_sqrt_a_alpha;
    break;
  }
  case 5:
    b0 = alpha;
    b1 = 0.0;
    b2 = -alpha;
    a0 = 1.0 + alpha;
    a1 = negative_two_cosine;
    a2 = 1.0 - alpha;
    break;
  case 6:
    b0 = 1.0;
    b1 = negative_two_cosine;
    b2 = 1.0;
    a0 = 1.0 + alpha;
    a1 = negative_two_cosine;
    a2 = 1.0 - alpha;
    break;
  case 7:
    b0 = 1.0 - alpha;
    b1 = negative_two_cosine;
    b2 = 1.0 + alpha;
    a0 = 1.0 + alpha;
    a1 = negative_two_cosine;
    a2 = 1.0 - alpha;
    break;
  default:
    return false;
  }

  const double a0_abs = a0 < 0.0 ? -a0 : a0;
  if (a0_abs < kA0Threshold) {
    return false;
  }
  const double inverse_a0 = 1.0 / a0;
  output = {b0 * inverse_a0, b1 * inverse_a0, b2 * inverse_a0, a1 * inverse_a0, a2 * inverse_a0};
  return true;
}

} // namespace effetune::plugins::eq::detail

#endif
