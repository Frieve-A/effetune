// A3 tempo lattice and the G2 log-weights on the generated tables of dec_const.h.
// Operations follow the reference dtypes and evaluation order; the f32 matrix-vector product (numpy
// sgemv) and the f64 dot products of moments (numpy ddot) use a fixed ascending order instead of
// BLAS's (ulp-level drift).
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>

#include "dec_const.h"
#include "dec_math.h"

namespace effetune::plugins::analyzer::rhythm_a3::dec {

// A contiguous range of tempo bins [begin, end) (half-open).
struct BinRange {
  int32_t begin;
  int32_t end;
};

// Largest class of moments(): a bin contributes at most floor(P / 2) + 1 phases (hi - lo + 1 <= P /
// 2 + 1).
[[nodiscard]] constexpr int32_t momentsCapacity() noexcept {
  int32_t n = 0;
  for (int32_t i = 0; i < kN; ++i)
    n += kP[i] / 2 + 1;
  return n;
}
inline constexpr int32_t kMomentsCap = momentsCapacity();

// Scratch of one predict: ex = a[last] and the tempo-jump sums.
struct PredictScratch {
  float ex[kN];
  float acc[kN];
};

// a3 Lattice.predict in place: ex = a[last]; a[1:] = a[:-1]; a[off] = ex @ T; a[half] += p_phase *
// ex (all f32).
inline void latticePredict(float *a, PredictScratch &s) noexcept {
  for (int32_t i = 0; i < kN; ++i) {
    s.ex[i] = a[kLast[i]];
    s.acc[i] = 0.0f;
  }
  // acc[j] = sum_i ex[i] T[i][j], i ascending (one f32 rounding per product and per sum).
  for (int32_t i = 0; i < kN; ++i) {
    const float e = s.ex[i];
    const float *row = kT + static_cast<int64_t>(i) * kN;
    for (int32_t j = 0; j < kN; ++j)
      s.acc[j] += e * row[j];
  }
  std::memmove(a + 1, a, sizeof(float) * static_cast<size_t>(kS - 1));
  for (int32_t j = 0; j < kN; ++j)
    a[kOff[j]] = s.acc[j];
  for (int32_t i = 0; i < kN; ++i)
    a[kHalf[i]] += kPPhase * s.ex[i];
}

// a3 Lattice.rotate in place (Z step): a[1:] = a[:-1]; a[off] = ex.
inline void latticeRotate(float *a, PredictScratch &s) noexcept {
  for (int32_t i = 0; i < kN; ++i)
    s.ex[i] = a[kLast[i]];
  std::memmove(a + 1, a, sizeof(float) * static_cast<size_t>(kS - 1));
  for (int32_t i = 0; i < kN; ++i)
    a[kOff[i]] = s.ex[i];
}

// a3 Lattice.state: tempo bin and phase fraction of state s.
inline void latticeState(int32_t s, int32_t &bin, double &f) noexcept {
  bin = kBlk[s];
  f = static_cast<double>(kPhi[s]) / static_cast<double>(kP[bin]);
}

// Tempo of bin j in BPM: 60 FPS / P_j, except that the grid's end bins count as the limits they
// were rounded from.
static_assert(kP[0] == 23 && kP[kN - 1] == 141, "the end bins stand for 240 and 40 BPM");
[[nodiscard]] inline double latticeBpm(int32_t j) noexcept {
  return j == 0 ? 240.0 : (j == kN - 1 ? 40.0 : (60.0 * kFps) / static_cast<double>(kP[j]));
}

// a3 Lattice.near: tempo bins within +-1 of bin i.
[[nodiscard]] inline BinRange latticeNear(int32_t i) noexcept {
  return {i - 1 > 0 ? i - 1 : 0, i + 2 < kN ? i + 2 : kN};
}

// a3 Lattice.level: bins with |ln(P_j DT / T)| <= TOL_LEVEL (math.log -> portableLog, drift).
[[nodiscard]] inline BinRange latticeLevel(double T) noexcept {
  const double lt = portableLog(T / kDt);
  return {searchLeft(kLogP, kN, lt - kTolLevel), searchRight(kLogP, kN, lt + kTolLevel)};
}

// a3 Lattice.ranges for one bin: unwrapped phases lo..hi within 1/4 beat of f.
inline void latticeRange(int32_t j, double f, int64_t &lo, int64_t &hi) noexcept {
  const double P = static_cast<double>(kP[j]);
  lo = static_cast<int64_t>(std::ceil((f - .25) * P - 1e-9));
  const int64_t h = static_cast<int64_t>(std::floor((f + .25) * P + 1e-9));
  const int64_t cap = lo + kP[j] - 1;
  hi = cap < h ? cap : h;
}

// a3 Lattice.mass: class mass, slice sums in numpy's pairwise order (f32 values summed as f64).
[[nodiscard]] inline double latticeMass(const float *a, BinRange bins, double f) noexcept {
  double tot = 0.0;
  for (int32_t j = bins.begin; j < bins.end; ++j) {
    int64_t lo, hi;
    latticeRange(j, f, lo, hi);
    const int64_t P = kP[j];
    const float *o = a + kOff[j];
    const int64_t a0 = pyMod(lo, P);
    const int64_t a1 = a0 + hi - lo + 1;
    if (a1 <= P)
      tot += pairwiseSum(o + a0, a1 - a0);
    else
      tot += (pairwiseSum(o + a0, P - a0) + pairwiseSum(o, a1 - P));
  }
  return tot;
}

// a3 Lattice.moments: posterior mean and covariance of (last beat time l, period T) over class
// (bins, f).
struct Moments {
  double l;
  double T;
  double vl;
  double c;
  double vt;
};

// w: scratch of kMomentsCap doubles. The dot products run in ascending order (numpy ddot: drift).
[[nodiscard]] inline Moments latticeMoments(const float *a, BinRange bins, double f, double tau,
                                            double *w) noexcept {
  int64_t n = 0;
  for (int32_t j = bins.begin; j < bins.end; ++j) {
    int64_t lo, hi;
    latticeRange(j, f, lo, hi);
    const int64_t P = kP[j];
    const float *o = a + kOff[j];
    for (int64_t ph = lo; ph <= hi; ++ph)
      w[n++] = static_cast<double>(o[pyMod(ph, P)]);
  }
  const double sw = pairwiseSum(w, n);
  for (int64_t k = 0; k < n; ++k)
    w[k] = w[k] / sw;
  double ml = 0.0, mt = 0.0;
  int64_t k = 0;
  for (int32_t j = bins.begin; j < bins.end; ++j) {
    int64_t lo, hi;
    latticeRange(j, f, lo, hi);
    const double t = static_cast<double>(kP[j]) * kDt;
    for (int64_t ph = lo; ph <= hi; ++ph, ++k) {
      const double l = tau - static_cast<double>(ph) * kDt;
      ml += w[k] * l;
      mt += w[k] * t;
    }
  }
  double sll = 0.0, stt = 0.0, slt = 0.0;
  k = 0;
  for (int32_t j = bins.begin; j < bins.end; ++j) {
    int64_t lo, hi;
    latticeRange(j, f, lo, hi);
    const double dt = static_cast<double>(kP[j]) * kDt - mt;
    for (int64_t ph = lo; ph <= hi; ++ph, ++k) {
      const double dl = (tau - static_cast<double>(ph) * kDt) - ml;
      sll += w[k] * (dl * dl);
      stt += w[k] * (dt * dt);
      slt += w[k] * (dl * dt);
    }
  }
  Moments m;
  m.l = ml;
  m.T = mt;
  m.vl = pyMax(sll, kHalfDtSq);
  m.vt = pyMax(stt, kDtSq12);
  const double lim = std::sqrt(m.vl * m.vt) * .999;
  m.c = pyMax(-lim, pyMin(lim, slt));
  return m;
}

// a3 Lattice.nearest: first bin minimising |logP - log(period)|.
[[nodiscard]] inline int32_t latticeNearest(double periodTicks) noexcept {
  const double lp = portableLog(periodTicks);
  int32_t best = 0;
  double bv = std::fabs(kLogP[0] - lp);
  for (int32_t i = 1; i < kN; ++i) {
    const double v = std::fabs(kLogP[i] - lp);
    if (v < bv) {
      bv = v;
      best = i;
    }
  }
  return best;
}

// a3 g2_logw: adds one G2 row's log-weights to lw (zeroed by the caller) at the newest activation
// time tau; returns the matched phase count n_ph. Row members as G2Update's: count, period[],
// ref[], p[][3].
template <class Update>
[[nodiscard]] inline int32_t g2Logw(const Update &u, double tau, float kappaF, float *lw) noexcept {
  int32_t nph = 0;
  for (int32_t c = 0; c < u.count; ++c) {
    const float per = u.period[c];
    const float *pc = u.p[c];
    if (!(per > 0.0f) || !(pc[0] >= 0.0f && pc[1] >= 0.0f && pc[2] >= 0.0f))
      continue;
    double lr[3];
    for (int32_t k = 0; k < 3; ++k) {
      const double x = static_cast<double>(pc[k]);
      lr[k] = portableLog(x >= 1e-6 ? x : 1e-6) - kG2LogPrior[k];
    }
    const double on = lr[0] - lr[2];
    const double off = lr[1] - lr[2];
    const double lc = portableLog(static_cast<double>(per) / kDt);
    const int32_t j0 = searchLeft(kLogP, kN, lc - kLevelTolG2);
    const int32_t j1 = searchRight(kLogP, kN, lc + kLevelTolG2);
    const double ref = u.ref[c];
    for (int32_t j = j0; j < j1; ++j) {
      const int32_t P = kP[j];
      float *o = lw + kOff[j];
      const double x = (ref - tau) / (static_cast<double>(P) * kDt);
      const double dP = static_cast<double>(P);
      for (int32_t i = 0; i < P; ++i) {
        double e = x + static_cast<double>(i) / dP;
        e -= rintEven(e);
        const float v = static_cast<float>(std::fabs(e) < .25 ? on : off);
        o[i] += kappaF * v;
      }
      nph += P;
    }
  }
  return nph;
}

} // namespace effetune::plugins::analyzer::rhythm_a3::dec
