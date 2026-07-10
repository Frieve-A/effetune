#ifndef EFFETUNE_DSP_MATH_H
#define EFFETUNE_DSP_MATH_H

#include <cmath>

namespace effetune::dsp {

template <typename Value>
[[nodiscard]] constexpr Value clamp_value(Value value, Value lower, Value upper) noexcept {
  if (value < lower) {
    return lower;
  }
  return value > upper ? upper : value;
}

[[nodiscard]] inline double db_to_lin(double decibels) noexcept {
  return std::pow(10.0, decibels * 0.05);
}

[[nodiscard]] inline double lin_to_db(double linear, double floor_decibels = -240.0) noexcept {
  if (!(linear > 0.0)) {
    return floor_decibels;
  }
  const double decibels = 20.0 * std::log10(linear);
  return decibels < floor_decibels ? floor_decibels : decibels;
}

template <typename Value>
[[nodiscard]] constexpr Value flush_denorm(Value value,
                                           Value threshold = static_cast<Value>(1.0e-30)) noexcept {
  const Value magnitude = value < static_cast<Value>(0) ? -value : value;
  return magnitude < threshold ? static_cast<Value>(0) : value;
}

} // namespace effetune::dsp

#endif
