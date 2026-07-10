#ifndef EFFETUNE_DSP_BIQUAD_H
#define EFFETUNE_DSP_BIQUAD_H

#include <cmath>
#include <cstddef>
#include <span>

namespace effetune::dsp {

// Coefficients are normalized by a0 and use the denominator
// 1 + a1*z^-1 + a2*z^-2.
struct BiquadCoefficients final {
  double b0 = 1.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;

  [[nodiscard]] bool isFinite() const noexcept {
    return std::isfinite(b0) && std::isfinite(b1) && std::isfinite(b2) && std::isfinite(a1) &&
           std::isfinite(a2);
  }
};

struct BiquadDf1State final {
  double x1 = 0.0;
  double x2 = 0.0;
  double y1 = 0.0;
  double y2 = 0.0;

  constexpr void reset() noexcept {
    x1 = 0.0;
    x2 = 0.0;
    y1 = 0.0;
    y2 = 0.0;
  }

  [[nodiscard]] bool isFinite() const noexcept {
    return std::isfinite(x1) && std::isfinite(x2) && std::isfinite(y1) && std::isfinite(y2);
  }
};

struct BiquadTdf2State final {
  double s1 = 0.0;
  double s2 = 0.0;

  constexpr void reset() noexcept {
    s1 = 0.0;
    s2 = 0.0;
  }

  [[nodiscard]] bool isFinite() const noexcept { return std::isfinite(s1) && std::isfinite(s2); }
};

[[nodiscard]] inline double processBiquadDf1Sample(double input,
                                                   const BiquadCoefficients &coefficients,
                                                   BiquadDf1State &state) noexcept {
  const double output = coefficients.b0 * input + coefficients.b1 * state.x1 +
                        coefficients.b2 * state.x2 - coefficients.a1 * state.y1 -
                        coefficients.a2 * state.y2;

  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = output;
  return output;
}

[[nodiscard]] inline double processBiquadTdf2Sample(double input,
                                                    const BiquadCoefficients &coefficients,
                                                    BiquadTdf2State &state) noexcept {
  const double output = coefficients.b0 * input + state.s1;
  const double next_s1 = coefficients.b1 * input - coefficients.a1 * output + state.s2;
  const double next_s2 = coefficients.b2 * input - coefficients.a2 * output;

  state.s1 = next_s1;
  state.s2 = next_s2;
  return output;
}

// Reproduce a write to legacy Float32 state storage at its persistence point.
inline void quantizeBiquadStateToFloat(BiquadDf1State &state) noexcept {
  state.x1 = static_cast<double>(static_cast<float>(state.x1));
  state.x2 = static_cast<double>(static_cast<float>(state.x2));
  state.y1 = static_cast<double>(static_cast<float>(state.y1));
  state.y2 = static_cast<double>(static_cast<float>(state.y2));
}

inline void quantizeBiquadStateToFloat(BiquadTdf2State &state) noexcept {
  state.s1 = static_cast<double>(static_cast<float>(state.s1));
  state.s2 = static_cast<double>(static_cast<float>(state.s2));
}

template <typename State, std::size_t Extent>
inline void resetBiquadStates(std::span<State, Extent> states) noexcept {
  for (State &state : states) {
    state.reset();
  }
}

template <typename State, std::size_t Extent>
inline void quantizeBiquadStatesToFloatAtBlockBoundary(std::span<State, Extent> states) noexcept {
  for (State &state : states) {
    quantizeBiquadStateToFloat(state);
  }
}

} // namespace effetune::dsp

#endif
