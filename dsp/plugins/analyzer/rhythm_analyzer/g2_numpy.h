// The numpy 2.2.4 evaluation orders the G2 feature path and the boundary hooks depend on: pairwise
// summation (8 accumulators, blocks of 128), the complex pairwise sum (4 complex accumulators),
// reductions that start from the identity 0.0, nanmean, median, np.mod and np.interp. No
// allocation; bounded recursion depth (log2(n / 128)).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace effetune::plugins::analyzer::rhythm_a3::g2np {

// numpy DOUBLE_pairwise_sum (loops_utils.h.src).
[[nodiscard]] inline double pairwise(const double *a, std::int64_t n) noexcept {
  if (n < 8) {
    double r = -0.0;
    for (std::int64_t i = 0; i < n; ++i)
      r += a[i];
    return r;
  }
  if (n <= 128) {
    double r[8];
    for (int j = 0; j < 8; ++j)
      r[j] = a[j];
    std::int64_t i = 8;
    for (; i < n - (n % 8); i += 8)
      for (int j = 0; j < 8; ++j)
        r[j] += a[i + j];
    double res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; ++i)
      res += a[i];
    return res;
  }
  std::int64_t n2 = n / 2;
  n2 -= n2 % 8;
  return pairwise(a, n2) + pairwise(a + n2, n - n2);
}

// a.sum() / a.sum(axis) along a contiguous axis: the reduction starts from the identity 0.0.
[[nodiscard]] inline double sum(const double *a, std::int64_t n) noexcept {
  return 0.0 + pairwise(a, n);
}

// a.mean() along a contiguous axis (float64).
[[nodiscard]] inline double mean(const double *a, std::int64_t n) noexcept {
  return sum(a, n) / static_cast<double>(n);
}

// numpy CDOUBLE_pairwise_sum; count complex values given as separate real and imaginary arrays. The
// caller adds the identity (0.0 + sr, 0.0 + si) for a reduction.
inline void cpairwise(const double *re, const double *im, std::int64_t count, double &sr,
                      double &si) noexcept {
  const std::int64_t n = 2 * count; // numpy counts real units
  if (n < 8) {
    double rr = -0.0, ri = -0.0;
    for (std::int64_t k = 0; k < count; ++k) {
      rr += re[k];
      ri += im[k];
    }
    sr = rr;
    si = ri;
    return;
  }
  if (n <= 128) {
    double r[8] = {re[0], im[0], re[1], im[1], re[2], im[2], re[3], im[3]};
    std::int64_t i = 8;
    for (; i < n - (n % 8); i += 8) {
      const std::int64_t k = i / 2;
      for (int j = 0; j < 4; ++j) {
        r[2 * j] += re[k + j];
        r[2 * j + 1] += im[k + j];
      }
    }
    double rr = (r[0] + r[2]) + (r[4] + r[6]);
    double ri = (r[1] + r[3]) + (r[5] + r[7]);
    for (std::int64_t k = i / 2; k < count; ++k) {
      rr += re[k];
      ri += im[k];
    }
    sr = rr;
    si = ri;
    return;
  }
  std::int64_t n2 = n / 2;
  n2 -= n2 % 8;
  const std::int64_t half = n2 / 2;
  double r1 = 0.0, i1 = 0.0, r2 = 0.0, i2 = 0.0;
  cpairwise(re, im, half, r1, i1);
  cpairwise(re + half, im + half, count - half, r2, i2);
  sr = r1 + r2;
  si = i1 + i2;
}

// np.nanmean of n values: NaN replaced by 0 (copied to scratch), pairwise sum / count of non-NaN;
// NaN if none.
[[nodiscard]] inline double nanmean(const double *a, std::int64_t n, double *scratch) noexcept {
  std::int64_t count = 0;
  for (std::int64_t i = 0; i < n; ++i) {
    const bool finite = a[i] == a[i];
    scratch[i] = finite ? a[i] : 0.0;
    count += finite ? 1 : 0;
  }
  if (count == 0)
    return std::numeric_limits<double>::quiet_NaN();
  return sum(scratch, n) / static_cast<double>(count);
}

// True if any of the n values is finite (np.isfinite(a).any()).
[[nodiscard]] inline bool anyFinite(const double *a, std::int64_t n) noexcept {
  for (std::int64_t i = 0; i < n; ++i)
    if (a[i] - a[i] == 0.0)
      return true;
  return false;
}

// np.median of n >= 1 values without NaN; sorts a in place. Even n: (lo + hi) / 2.0 (mean of the
// two middles).
[[nodiscard]] inline double median(double *a, std::int64_t n) noexcept {
  std::sort(a, a + n);
  if (n % 2 == 1)
    return a[n / 2];
  return (a[n / 2 - 1] + a[n / 2]) / 2.0;
}

// np.mod / np.remainder (npy_divmod's modulus) for b > 0.
[[nodiscard]] inline double mod(double a, double b) noexcept {
  double m = std::fmod(a, b);
  if (m != 0.0) {
    if ((b < 0.0) != (m < 0.0))
      m += b;
  } else {
    m = std::copysign(0.0, b);
  }
  return m;
}

// np.interp(x, xp, fp) for a non-decreasing xp of n >= 2 points (compiled_base.c arr_interp).
[[nodiscard]] inline double interp(double x, const double *xp, const double *fp, int n) noexcept {
  if (x != x)
    return x;
  if (x > xp[n - 1])
    return fp[n - 1];
  if (x < xp[0])
    return fp[0];
  int lo = 0, hi = n; // first index with xp > x
  while (lo < hi) {
    const int mid = lo + (hi - lo) / 2;
    if (x >= xp[mid])
      lo = mid + 1;
    else
      hi = mid;
  }
  const int j = lo - 1;
  if (j == n - 1 || xp[j] == x)
    return fp[j];
  const double slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]);
  double r = slope * (x - xp[j]) + fp[j];
  if (r != r) {
    r = slope * (x - xp[j + 1]) + fp[j + 1];
    if (r != r && fp[j] == fp[j + 1])
      r = fp[j];
  }
  return r;
}

// A feature stored into the float32 row: RNE cast; values that round to +-inf become NaN (X[isinf]
// = NaN).
[[nodiscard]] inline float feature(double v) noexcept {
  const double a = v < 0.0 ? -v : v;
  if (a >= 0x1.ffffffp+127)
    return std::numeric_limits<float>::quiet_NaN();
  return static_cast<float>(v);
}

// ---- OpenBLAS 0.3.28 (Haswell kernels, 1 thread) products the boundary hooks use.

// a @ x for 1-D float64 vectors (cblas_ddot; also np.linalg.norm = sqrt(ddot(a, a))).
[[nodiscard]] inline double ddot(const double *a, const double *x, std::int64_t n) noexcept {
  const std::int64_t n1 = n & ~std::int64_t{15};
  double dot = 0.0;
  if (n1 != 0) {
    double acc[4][4] = {};
    for (std::int64_t i = 0; i < n1; i += 16)
      for (int r = 0; r < 4; ++r)
        for (int l = 0; l < 4; ++l) {
          const std::int64_t j = i + 4 * r + l;
          acc[r][l] = std::fma(a[j], x[j], acc[r][l]);
        }
    double u[4][2];
    for (int r = 0; r < 4; ++r) {
      u[r][0] = acc[r][0] + acc[r][2];
      u[r][1] = acc[r][1] + acc[r][3];
    }
    const double v0 = (u[0][0] + u[1][0]) + (u[2][0] + u[3][0]);
    const double v1 = (u[0][1] + u[1][1]) + (u[2][1] + u[3][1]);
    dot = v0 + v1;
  }
  for (std::int64_t j = n1; j < n; ++j)
    dot = dot + a[j] * x[j];
  return dot;
}

// A[3, n] @ x (dgemv_t): rows 0 and 1 through dgemv_kernel_4x2, row 2 through dgemv_kernel_4x1,
// then the n & 3 tail.
inline void gemvT3(const double *const a[3], const double *x, std::int64_t n,
                   double y[3]) noexcept {
  const std::int64_t m1 = n & ~std::int64_t{3};
  for (int row = 0; row < 3; ++row) {
    const double *r = a[row];
    double s = 0.0;
    if (m1 != 0) {
      if (row < 2) {
        double l0 = 0.0, l1 = 0.0;
        for (std::int64_t i = 0; i < m1; i += 2) {
          l0 = l0 + r[i] * x[i];
          l1 = l1 + r[i + 1] * x[i + 1];
        }
        s = l0 + l1;
      } else {
        double p0 = 0.0, p1 = 0.0, q0 = 0.0, q1 = 0.0;
        for (std::int64_t i = 0; i < m1; i += 4) {
          p0 = p0 + r[i] * x[i];
          p1 = p1 + r[i + 1] * x[i + 1];
          q0 = q0 + r[i + 2] * x[i + 2];
          q1 = q1 + r[i + 3] * x[i + 3];
        }
        s = (p0 + q0) + (p1 + q1);
      }
    }
    const std::int64_t left = n - m1;
    if (left == 1) {
      s = std::fma(r[m1], x[m1], s);
    } else if (left >= 2) {
      double e = std::fma(r[m1], x[m1], r[m1 + 1] * x[m1 + 1]);
      if (left == 3)
        e = std::fma(r[m1 + 2], x[m1 + 2], e);
      s = s + e;
    }
    y[row] = s;
  }
}

// w[m] @ V[m, 12] (dgemv_n), V given as m row pointers: per column, 4-row blocks, then 2 and 1
// left.
inline void gemvN12(const double *const *v, const double *w, std::int64_t m,
                    double y[12]) noexcept {
  for (int c = 0; c < 12; ++c) {
    double s = 0.0;
    std::int64_t i = 0;
    for (; m - i >= 4; i += 4)
      s = s + (std::fma(v[i + 2][c], w[i + 2], v[i][c] * w[i]) +
               std::fma(v[i + 3][c], w[i + 3], v[i + 1][c] * w[i + 1]));
    if (m - i >= 2) {
      s = s + (v[i][c] * w[i] + v[i + 1][c] * w[i + 1]);
      i += 2;
    }
    if (m - i == 1)
      s = s + v[i][c] * w[i];
    y[c] = s;
  }
}

} // namespace effetune::plugins::analyzer::rhythm_a3::g2np
