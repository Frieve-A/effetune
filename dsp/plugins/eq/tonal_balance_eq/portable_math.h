// Tonal Balance EQ: toolchain-independent exp / log / sin / cos / tan.
//
// The analysis statistics and the cascade design are on the parity surface
// (native and WASM builds must produce the same filter coefficients).  libm
// results differ in the last bit between toolchains, so every design-time
// transcendental goes through these range reductions plus polynomials, which
// are built only from IEEE add, subtract, multiply, floor, frexp and ldexp.
// sqrt is correctly rounded everywhere and needs no replacement.
#ifndef EFFETUNE_TONAL_BALANCE_EQ_PORTABLE_MATH_H
#define EFFETUNE_TONAL_BALANCE_EQ_PORTABLE_MATH_H

#include <cmath>
#include <limits>

namespace effetune::plugins::eq::tonal_balance {

inline constexpr double kLn10 = 2.30258509299404568402;
inline constexpr double kPi = 3.14159265358979323846;

[[nodiscard]] inline double portableExp(double value) noexcept {
  constexpr double kInverseLn2 = 1.4426950408889634074;
  // ln(2) split so that the high part is exact in 33 bits and the product with
  // the reduction index therefore carries no rounding error.
  constexpr double kLn2High = 6.93147180369123816490e-01;
  constexpr double kLn2Low = 1.90821492927058770002e-10;
  if (value != value)
    return value;
  if (value < -745.2)
    return 0.0;
  if (value > 709.8)
    return std::numeric_limits<double>::infinity();
  const double index = std::floor(value * kInverseLn2 + 0.5);
  const double remainder = (value - index * kLn2High) - index * kLn2Low;
  // Taylor series through the thirteenth term.  With |remainder| <= ln(2) / 2
  // the first omitted term is below 5e-18.
  double series = 1.0 / 6227020800.0;
  series = series * remainder + 1.0 / 479001600.0;
  series = series * remainder + 1.0 / 39916800.0;
  series = series * remainder + 1.0 / 3628800.0;
  series = series * remainder + 1.0 / 362880.0;
  series = series * remainder + 1.0 / 40320.0;
  series = series * remainder + 1.0 / 5040.0;
  series = series * remainder + 1.0 / 720.0;
  series = series * remainder + 1.0 / 120.0;
  series = series * remainder + 1.0 / 24.0;
  series = series * remainder + 1.0 / 6.0;
  series = series * remainder + 0.5;
  series = series * remainder + 1.0;
  series = series * remainder + 1.0;
  return std::ldexp(series, static_cast<int>(index));
}

[[nodiscard]] inline double portableLog(double value) noexcept {
  constexpr double kLn2High = 6.93147180369123816490e-01;
  constexpr double kLn2Low = 1.90821492927058770002e-10;
  constexpr double kInverseSqrt2 = 0.70710678118654752440;
  if (value != value)
    return value;
  if (value < 0.0)
    return std::numeric_limits<double>::quiet_NaN();
  if (value == 0.0)
    return -std::numeric_limits<double>::infinity();
  int exponent = 0;
  double mantissa = std::frexp(value, &exponent);
  if (mantissa < kInverseSqrt2) {
    mantissa *= 2.0;
    --exponent;
  }
  // log(m) = 2 * atanh((m - 1) / (m + 1)).  With m in [sqrt(1/2), sqrt(2)) the
  // argument stays below 0.1716, so the term after s^25 is below 1e-22.
  const double s = (mantissa - 1.0) / (mantissa + 1.0);
  const double square = s * s;
  double series = 1.0 / 25.0;
  series = series * square + 1.0 / 23.0;
  series = series * square + 1.0 / 21.0;
  series = series * square + 1.0 / 19.0;
  series = series * square + 1.0 / 17.0;
  series = series * square + 1.0 / 15.0;
  series = series * square + 1.0 / 13.0;
  series = series * square + 1.0 / 11.0;
  series = series * square + 1.0 / 9.0;
  series = series * square + 1.0 / 7.0;
  series = series * square + 1.0 / 5.0;
  series = series * square + 1.0 / 3.0;
  series = series * square + 1.0;
  const double scaled = static_cast<double>(exponent);
  return (scaled * kLn2High + 2.0 * s * series) + scaled * kLn2Low;
}

struct QuarterTurn final {
  double remainder = 0.0;
  int quadrant = 0;
};

// Cody-Waite reduction against a three-way split of pi / 2.  Arguments stay
// below 2 * pi (digital frequencies), so the index stays tiny.
[[nodiscard]] inline QuarterTurn reduceQuarterTurn(double value) noexcept {
  constexpr double kTwoOverPi = 0.63661977236758134308;
  constexpr double kHalfPiHigh = 1.57079632673412561417e+00;
  constexpr double kHalfPiMid = 6.07710050650619224932e-11;
  constexpr double kHalfPiLow = 2.02226624879595063154e-21;
  const double index = std::floor(value * kTwoOverPi + 0.5);
  double remainder = value - index * kHalfPiHigh;
  remainder -= index * kHalfPiMid;
  remainder -= index * kHalfPiLow;
  const int quadrant = static_cast<int>(std::fmod(index, 4.0) + 4.0) & 3;
  return QuarterTurn{remainder, quadrant};
}

// Taylor series on |remainder| <= pi / 4.  The first omitted sine term is below
// 1e-19 and the first omitted cosine term is below 4e-21.
[[nodiscard]] inline double quarterTurnSine(double remainder) noexcept {
  const double square = remainder * remainder;
  double series = -1.0 / 355687428096000.0;
  series = series * square + 1.0 / 1307674368000.0;
  series = series * square - 1.0 / 6227020800.0;
  series = series * square + 1.0 / 39916800.0;
  series = series * square - 1.0 / 362880.0;
  series = series * square + 1.0 / 5040.0;
  series = series * square - 1.0 / 120.0;
  series = series * square + 1.0 / 6.0;
  return remainder - remainder * square * series;
}

[[nodiscard]] inline double quarterTurnCosine(double remainder) noexcept {
  const double square = remainder * remainder;
  double series = -1.0 / 6402373705728000.0;
  series = series * square + 1.0 / 20922789888000.0;
  series = series * square - 1.0 / 87178291200.0;
  series = series * square + 1.0 / 479001600.0;
  series = series * square - 1.0 / 3628800.0;
  series = series * square + 1.0 / 40320.0;
  series = series * square - 1.0 / 720.0;
  series = series * square + 1.0 / 24.0;
  series = series * square - 0.5;
  return 1.0 + square * series;
}

[[nodiscard]] inline double portableSin(double value) noexcept {
  if (value != value || value == std::numeric_limits<double>::infinity() ||
      value == -std::numeric_limits<double>::infinity())
    return std::numeric_limits<double>::quiet_NaN();
  const QuarterTurn reduced = reduceQuarterTurn(value);
  switch (reduced.quadrant) {
  case 0:
    return quarterTurnSine(reduced.remainder);
  case 1:
    return quarterTurnCosine(reduced.remainder);
  case 2:
    return -quarterTurnSine(reduced.remainder);
  default:
    return -quarterTurnCosine(reduced.remainder);
  }
}

[[nodiscard]] inline double portableCos(double value) noexcept {
  if (value != value || value == std::numeric_limits<double>::infinity() ||
      value == -std::numeric_limits<double>::infinity())
    return std::numeric_limits<double>::quiet_NaN();
  const QuarterTurn reduced = reduceQuarterTurn(value);
  switch (reduced.quadrant) {
  case 0:
    return quarterTurnCosine(reduced.remainder);
  case 1:
    return -quarterTurnSine(reduced.remainder);
  case 2:
    return -quarterTurnCosine(reduced.remainder);
  default:
    return quarterTurnSine(reduced.remainder);
  }
}

[[nodiscard]] inline double portableTan(double value) noexcept {
  return portableSin(value) / portableCos(value);
}

// 10^value through the portable exponential.
[[nodiscard]] inline double portableDecadePower(double value) noexcept {
  return portableExp(value * kLn10);
}

// 10 * log10(power); power must be positive.
[[nodiscard]] inline double portablePowerDb(double power) noexcept {
  return portableLog(power) * (10.0 / kLn10);
}

// 10^(db / 10)
[[nodiscard]] inline double portableDbPower(double db) noexcept {
  return portableDecadePower(db * 0.1);
}

// log2(value) for positive value.
[[nodiscard]] inline double portableLog2(double value) noexcept {
  constexpr double kInverseLn2 = 1.4426950408889634074;
  return portableLog(value) * kInverseLn2;
}

} // namespace effetune::plugins::eq::tonal_balance

#endif // EFFETUNE_TONAL_BALANCE_EQ_PORTABLE_MATH_H
