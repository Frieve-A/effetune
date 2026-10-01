// numpy / CPython arithmetic semantics the A3 decoder reproduces.
// Every function is a fixed sequence of IEEE operations: no fast-math, no FMA (the build disables
// contraction), no allocation, no exceptions.
#pragma once
#include <cmath>
#include <cstdint>

#include "portable_math.h"

namespace effetune::plugins::analyzer::rhythm_a3::dec {

using effetune::plugins::analyzer::rhythm_d::portableExp;
using effetune::plugins::analyzer::rhythm_d::portableLog;

// numpy's pairwise summation of n values cast to double (DOUBLE_pairwise_sum): below 8 values a
// plain loop from -0.0; up to 128 values eight accumulators then ((r0 + r1) + (r2 + r3)) + ((r4 +
// r5) + (r6 + r7)) and the remainder in order; above 128 the halves split at n / 2 rounded down to
// a multiple of 8. np.sum(dtype=float64) of a float32 array of up to 8192 values (one cast buffer)
// and np.sum of a float64 array both reduce to this; the reduction's initial 0 leaves a nonzero
// result unchanged.
template <class T> [[nodiscard]] inline double pairwiseSum(const T *a, int64_t n) noexcept {
  if (n < 8) {
    double res = -0.0;
    for (int64_t i = 0; i < n; ++i)
      res += static_cast<double>(a[i]);
    return res;
  }
  if (n <= 128) {
    double r[8];
    for (int j = 0; j < 8; ++j)
      r[j] = static_cast<double>(a[j]);
    int64_t i = 8;
    for (; i < n - (n % 8); i += 8)
      for (int j = 0; j < 8; ++j)
        r[j] += static_cast<double>(a[i + j]);
    double res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; ++i)
      res += static_cast<double>(a[i]);
    return res;
  }
  int64_t n2 = n / 2;
  n2 -= n2 % 8;
  return pairwiseSum(a, n2) + pairwiseSum(a + n2, n - n2);
}

// Round half to even (CPython round(x), np.round, np.rint) in the default rounding mode, as a
// double.
[[nodiscard]] inline double rintEven(double x) noexcept { return std::nearbyint(x); }

// CPython round(x) of a float, as an integer.
[[nodiscard]] inline int64_t pyRound(double x) noexcept {
  return static_cast<int64_t>(std::nearbyint(x));
}

// CPython float x % 1.0: fmod, shifted into [0, 1) for a negative remainder (the shift may round up
// to 1.0), +0.0 for a zero remainder.
[[nodiscard]] inline double pyModOne(double x) noexcept {
  double m = std::fmod(x, 1.0);
  if (m != 0.0) {
    if (m < 0.0)
      m += 1.0;
  } else {
    m = 0.0;
  }
  return m;
}

// CPython integer floor division and modulo (the result of % has the divisor's sign).
[[nodiscard]] inline int64_t pyFloorDiv(int64_t a, int64_t b) noexcept {
  int64_t q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0)))
    --q;
  return q;
}
[[nodiscard]] inline int64_t pyMod(int64_t a, int64_t b) noexcept {
  int64_t r = a % b;
  if (r != 0 && ((r < 0) != (b < 0)))
    r += b;
  return r;
}

// a3.circ: circular distance of a phase-fraction difference, in [0, .5].
[[nodiscard]] inline double circ(double d) noexcept {
  d = d - std::floor(d);
  return d <= .5 ? d : 1.0 - d;
}

// np.searchsorted on an ascending array: 'left' is the first i with a[i] >= v, 'right' the first i
// with a[i] > v.
[[nodiscard]] inline int32_t searchLeft(const double *a, int32_t n, double v) noexcept {
  int32_t lo = 0, hi = n;
  while (lo < hi) {
    const int32_t mid = (lo + hi) >> 1;
    if (a[mid] < v)
      lo = mid + 1;
    else
      hi = mid;
  }
  return lo;
}
[[nodiscard]] inline int32_t searchRight(const double *a, int32_t n, double v) noexcept {
  int32_t lo = 0, hi = n;
  while (lo < hi) {
    const int32_t mid = (lo + hi) >> 1;
    if (v < a[mid])
      hi = mid;
    else
      lo = mid + 1;
  }
  return lo;
}

// np.argmax: the first index of the maximum.
template <class T> [[nodiscard]] inline int32_t argmaxFirst(const T *a, int32_t n) noexcept {
  int32_t best = 0;
  T v = a[0];
  for (int32_t i = 1; i < n; ++i)
    if (a[i] > v) {
      v = a[i];
      best = i;
    }
  return best;
}

// float32 exp through the double portable exponential (numpy's float32 exp is a SIMD kernel; the
// difference is ulp-level drift).
[[nodiscard]] inline float expF(float x) noexcept {
  return static_cast<float>(portableExp(static_cast<double>(x)));
}

// CPython max(a, b) / min(a, b) of two floats: the first argument unless the second is strictly
// greater / smaller.
[[nodiscard]] inline double pyMax(double a, double b) noexcept { return b > a ? b : a; }
[[nodiscard]] inline double pyMin(double a, double b) noexcept { return b < a ? b : a; }

} // namespace effetune::plugins::analyzer::rhythm_a3::dec
