#ifndef EFFETUNE_DSP_DENORMAL_H
#define EFFETUNE_DSP_DENORMAL_H

#include <bit>
#include <cstdint>

namespace effetune::dsp {

// Normalize only IEEE subnormals. Normal values, signed zero and nonfinite
// bit patterns are unchanged; no host floating-point mode is required.
[[nodiscard]] inline float flushSubnormal(float value) noexcept {
  const auto bits = std::bit_cast<std::uint32_t>(value);
  return (bits & 0x7f800000u) == 0u && (bits & 0x007fffffu) != 0u ? 0.0F : value;
}

[[nodiscard]] inline double flushSubnormal(double value) noexcept {
  const auto bits = std::bit_cast<std::uint64_t>(value);
  return (bits & 0x7ff0000000000000ull) == 0u && (bits & 0x000fffffffffffffull) != 0u ? 0.0 : value;
}

} // namespace effetune::dsp

#endif
