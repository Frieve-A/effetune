#pragma once

#include <cmath>

namespace effetune::plugins::modulation::detail {

[[nodiscard]] inline double barberWindow(double sweep_position) noexcept {
  constexpr double kPi = 3.14159265358979323846;
  const double sample = std::sin(kPi * sweep_position);
  return sample * sample;
}

} // namespace effetune::plugins::modulation::detail
