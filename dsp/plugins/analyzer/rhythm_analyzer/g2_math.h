// ====================================================
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice
// is preserved.
// ====================================================
//
// atan and atan2 below are derived from fdlibm 5.3 (s_atan.c, e_atan2.c) under the notice above.

// Portable math for the G2 path. Only IEEE basic operations, frexp/ldexp/nearbyint and the
// rhythm_d portable functions, so native and WASM agree bit for bit (build with -ffp-contract=off
// on Clang).
#pragma once
#include <bit>
#include <cmath>
#include <cstdint>

#include "portable_math.h"

namespace effetune::plugins::analyzer::rhythm_a3::g2m {

namespace rd = effetune::plugins::analyzer::rhythm_d;

// IEEE binary16 bit pattern of a value that rhythm_d::roundHalf() returned (normal, subnormal or
// zero; no overflow).
[[nodiscard]] inline std::uint16_t halfBits(double h) noexcept {
  std::uint16_t sign = 0u;
  if (h < 0.0 || (h == 0.0 && std::signbit(h))) {
    sign = 0x8000u;
    h = -h;
  }
  if (h == 0.0)
    return sign;
  int e = 0;
  const double m = std::frexp(h, &e); // h = m 2^e, m in [.5, 1)
  if (e < -13)                        // subnormal: h = f 2^-24
    return static_cast<std::uint16_t>(sign | static_cast<std::uint16_t>(std::ldexp(h, 24)));
  const auto frac = static_cast<std::uint16_t>(std::ldexp(m, 11) - 1024.0);
  return static_cast<std::uint16_t>(sign | static_cast<std::uint16_t>((e + 14) << 10) | frac);
}

[[nodiscard]] inline double log10(double v) noexcept {
  return rd::portableLog(v) / 2.30258509299404568402;
}
[[nodiscard]] inline double log2(double v) noexcept {
  return rd::portableLog(v) / 0.69314718055994530942;
}

struct SinCos {
  double s = 0.0;
  double c = 0.0;
};

// sin and cos with one reduction: bit-identical to rhythm_d portableSin / portableCos.
// reduceQuarterTurn's split of pi/2 (31, 32 and 28 significant bits) keeps index * part exact for
// |index| < 2^20, i.e. |x| < 1.6e6 rad (the G2 reference phase reaches ~1e4..1e5 rad on real
// audio); beyond that the reduction loses exactness gracefully and stays deterministic.
[[nodiscard]] inline SinCos sinCos(double x) noexcept {
  const rd::QuarterTurn r = rd::reduceQuarterTurn(x);
  const double s = rd::quarterTurnSine(r.remainder), c = rd::quarterTurnCosine(r.remainder);
  switch (r.quadrant) {
  case 0:
    return {s, c};
  case 1:
    return {c, -s};
  case 2:
    return {-s, -c};
  default:
    return {-c, s};
  }
}

namespace detail {
[[nodiscard]] constexpr double word(std::uint64_t bits) noexcept {
  return std::bit_cast<double>(bits);
}
} // namespace detail

// fdlibm 5.3 s_atan.c, operation for operation (IEEE words from its source). numpy's arctan2 calls
// the C runtime; both stay within 1 ulp.
[[nodiscard]] inline double atan(double x) noexcept {
  using detail::word;
  static constexpr double kHi[4] = {word(0x3FDDAC670561BB4FULL), word(0x3FE921FB54442D18ULL),
                                    word(0x3FEF730BD281F69BULL), word(0x3FF921FB54442D18ULL)};
  static constexpr double kLo[4] = {word(0x3C7A2B7F222F65E2ULL), word(0x3C81A62633145C07ULL),
                                    word(0x3C7007887AF0CBBDULL), word(0x3C91A62633145C07ULL)};
  static constexpr double kT[11] = {
      word(0x3FD555555555550DULL), word(0xBFC999999998EBC4ULL), word(0x3FC24924920083FFULL),
      word(0xBFBC71C6FE231671ULL), word(0x3FB745CDC54C206EULL), word(0xBFB3B0F2AF749A6DULL),
      word(0x3FB10D66A0D03D51ULL), word(0xBFADDE2D52DEFD9AULL), word(0x3FA97B4B24760DEBULL),
      word(0xBFA2B4442C6A6C2FULL), word(0x3F90AD3AE322DA11ULL)};
  const std::uint64_t bits = std::bit_cast<std::uint64_t>(x);
  const auto hx = static_cast<std::int32_t>(bits >> 32);
  const std::int32_t ix = hx & 0x7fffffff;
  int id = -1;
  if (ix >= 0x44100000) { // |x| >= 2^66 or NaN
    if (ix > 0x7ff00000 || (ix == 0x7ff00000 && (bits & 0xffffffffULL) != 0))
      return x + x;
    return hx > 0 ? kHi[3] + kLo[3] : -kHi[3] - kLo[3];
  }
  if (ix < 0x3fdc0000) { // |x| < 0.4375
    if (ix < 0x3e200000)
      return x;
  } else {
    x = hx < 0 ? -x : x;
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2.0 * x - 1.0) / (2.0 + x);
      } else {
        id = 1;
        x = (x - 1.0) / (x + 1.0);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1.0 + 1.5 * x);
    } else {
      id = 3;
      x = -1.0 / x;
    }
  }
  const double z = x * x;
  const double w = z * z;
  const double s1 =
      z * (kT[0] + w * (kT[2] + w * (kT[4] + w * (kT[6] + w * (kT[8] + w * kT[10])))));
  const double s2 = w * (kT[1] + w * (kT[3] + w * (kT[5] + w * (kT[7] + w * kT[9]))));
  if (id < 0)
    return x - x * (s1 + s2);
  const double r = kHi[id] - ((x * (s1 + s2) - kLo[id]) - x);
  return hx < 0 ? -r : r;
}

// fdlibm 5.3 e_atan2.c (numpy angle(z) = arctan2(imag, real)).
[[nodiscard]] inline double atan2(double y, double x) noexcept {
  using detail::word;
  constexpr double kPiO4 = word(0x3FE921FB54442D18ULL), kPiO2 = word(0x3FF921FB54442D18ULL),
                   kPi = word(0x400921FB54442D18ULL), kPiLo = word(0x3CA1A62633145C07ULL);
  const std::uint64_t bx = std::bit_cast<std::uint64_t>(x), by = std::bit_cast<std::uint64_t>(y);
  const auto hx = static_cast<std::int32_t>(bx >> 32), hy = static_cast<std::int32_t>(by >> 32);
  const std::int32_t ix = hx & 0x7fffffff, iy = hy & 0x7fffffff;
  const auto lx = static_cast<std::uint32_t>(bx), ly = static_cast<std::uint32_t>(by);
  if (x != x || y != y)
    return x + y;
  if (bx == 0x3FF0000000000000ULL)
    return atan(y);
  const int m = (hy < 0 ? 1 : 0) | (hx < 0 ? 2 : 0);
  if ((iy | static_cast<std::int32_t>(ly)) == 0) {
    switch (m) {
    case 0:
    case 1:
      return y;
    case 2:
      return kPi;
    default:
      return -kPi;
    }
  }
  if ((ix | static_cast<std::int32_t>(lx)) == 0)
    return hy < 0 ? -kPiO2 : kPiO2;
  if (ix == 0x7ff00000) {
    if (iy == 0x7ff00000) {
      switch (m) {
      case 0:
        return kPiO4;
      case 1:
        return -kPiO4;
      case 2:
        return 3.0 * kPiO4;
      default:
        return -3.0 * kPiO4;
      }
    }
    switch (m) {
    case 0:
      return 0.0;
    case 1:
      return -0.0;
    case 2:
      return kPi;
    default:
      return -kPi;
    }
  }
  if (iy == 0x7ff00000)
    return hy < 0 ? -kPiO2 : kPiO2;
  const std::int32_t k = (iy - ix) >> 20;
  double z;
  if (k > 60)
    z = kPiO2 + 0.5 * kPiLo;
  else if (hx < 0 && k < -60)
    z = 0.0;
  else
    z = atan(std::fabs(y / x));
  switch (m) {
  case 0:
    return z;
  case 1:
    return -z;
  case 2:
    return kPi - (z - kPiLo);
  default:
    return (z - kPiLo) - kPi;
  }
}

} // namespace effetune::plugins::analyzer::rhythm_a3::g2m
