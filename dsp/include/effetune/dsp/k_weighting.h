#ifndef EFFETUNE_DSP_K_WEIGHTING_H
#define EFFETUNE_DSP_K_WEIGHTING_H

#include "effetune/dsp/biquad.h"

#include <cmath>
#include <cstdint>
#include <numbers>

// ITU-R BS.1770-4 K-weighting and channel weights shared by loudness kernels.
// Translation units that include this header must share the same floating-point
// contraction flags (see dsp/CMakeLists.txt), because the inline designs are COMDAT.
namespace effetune::dsp::k_weighting {

// Offset between the K-weighted power sum and the LUFS scale, ITU-R BS.1770-4 eq. (2).
inline constexpr double kLufsOffset = 0.691;
// K-weighting stage designs. Tables 1 and 2 of BS.1770-4 are the 48 kHz case of these, so
// deriving them from the prepared sample rate keeps the weighting curve in place at 44.1,
// 96 and 192 kHz instead of only at 48 kHz.
inline constexpr double kShelfFrequency = 1681.974450955533;
inline constexpr double kShelfGainDb = 3.999843853973347;
inline constexpr double kShelfQ = 0.7071752369554196;
inline constexpr double kShelfGainExponent = 0.4996667741545416;
inline constexpr double kHighpassFrequency = 38.13547087602444;
inline constexpr double kHighpassQ = 0.5003270373238773;

inline BiquadCoefficients designHighpass(double sample_rate) noexcept {
  const double k = std::tan(std::numbers::pi * kHighpassFrequency / sample_rate);
  const double a0 = 1.0 + k / kHighpassQ + k * k;
  return {1.0, -2.0, 1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / kHighpassQ + k * k) / a0};
}

inline BiquadCoefficients designShelf(double sample_rate) noexcept {
  const double k = std::tan(std::numbers::pi * kShelfFrequency / sample_rate);
  const double vh = std::pow(10.0, kShelfGainDb / 20.0);
  const double vb = std::pow(vh, kShelfGainExponent);
  const double a0 = 1.0 + k / kShelfQ + k * k;
  return {(vh + vb * k / kShelfQ + k * k) / a0, 2.0 * (k * k - vh) / a0,
          (vh - vb * k / kShelfQ + k * k) / a0, 2.0 * (k * k - 1.0) / a0,
          (1.0 - k / kShelfQ + k * k) / a0};
}

// BS.1770-4 table 3 weights. The Recommendation tabulates the 5.1 layout only, and Web Audio
// orders six channels L, R, C, LFE, Ls, Rs. Every other channel count is summed unweighted,
// which is the table's value for non-surround channels.
inline double channelWeight(std::uint32_t channel, std::uint32_t channel_count) noexcept {
  if (channel_count != 6u) {
    return 1.0;
  }
  if (channel == 3u) {
    return 0.0;
  }
  return channel >= 4u ? 1.41 : 1.0;
}

} // namespace effetune::dsp::k_weighting

#endif
