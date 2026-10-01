// A3 existence gate, the display gate, under the frozen configuration (q 1e-5, lo0 2.5, no
// backfill: keep = 2 s, thr = log(pi / (1 - pi)), the frozen d_av). exp and log use the portable
// functions; every other operation follows the reference order.
#pragma once
#include <cmath>
#include <cstdint>
#include <limits>

#include "dec_const.h"
#include "dec_math.h"

namespace effetune::plugins::analyzer::rhythm_a3::dec {

// One judged beat (a3 rec t, s, lo, n, nc; bf is 0 without backfill). Full precision: the driver
// rounds t to 6 and lo to 4 decimals as a3 does.
struct DecExistJudge {
  double t;
  double s[3];
  double lo;
  int64_t n;
  int64_t nc;
};

struct DecExist {
  // Per-band event history. The band's events are > 45 ms apart (picker refractory) and the gate
  // keeps the 2 s after the oldest kept, so at most 45 are held; on overflow the oldest is dropped
  // (counted).
  static constexpr int32_t kBandCap = 48;

  double ev[3][kBandCap];
  int32_t head[3];
  int32_t count[3];
  double v[3];
  double lo;
  bool shown;
  bool pendOn;
  double pendA;
  double pendP;
  double pendEnd;
  double done;
  int64_t nc;
  int64_t late;
  int64_t dropped;
  int64_t ops;

  // a3 Exist.__init__: empty history, no record, then reset(None, None).
  void init() noexcept {
    for (int32_t c = 0; c < 3; ++c)
      head[c] = count[c] = 0;
    done = -std::numeric_limits<double>::infinity();
    nc = late = dropped = ops = 0;
    reset();
  }

  // a3 Exist.reset (the caller records reset, reset_n and reset_nc = nc).
  void reset() noexcept {
    for (int32_t c = 0; c < 3; ++c)
      v[c] = kExV0[c];
    lo = kExLo0;
    shown = false;
    pendOn = false;
  }

  // A candidate click (the caller records cand); returns whether it is shown.
  bool show() noexcept {
    ++nc;
    return shown;
  }

  void add(int32_t band, double b) noexcept {
    if (b <= done)
      ++late;
    double *e = ev[band];
    int32_t &h = head[band];
    int32_t &n = count[band];
    if (n == kBandCap) {
      h = h + 1 == kBandCap ? 0 : h + 1;
      --n;
      ++dropped;
    }
    const int32_t w = h + n;
    e[w < kBandCap ? w : w - kBandCap] = b;
    ++n;
    const double lim = b - kExKeep;
    while (e[h] < lim) { // stops at b itself at the latest
      h = h + 1 == kBandCap ? 0 : h + 1;
      --n;
    }
  }

  [[nodiscard]] static double half(double Paa) noexcept {
    return std::sqrt(kChi2_99 * (kExRmax + Paa));
  }

  // At a clock crossing (beat a, variance Paa): a becomes the pending beat if judged (outside Z).
  void cross(double a, double Paa, bool judged) noexcept {
    pendOn = judged;
    if (judged) {
      pendA = a;
      pendP = Paa;
      pendEnd = (a + half(Paa)) + kExDav;
    }
  }

  [[nodiscard]] bool due(double t) const noexcept { return pendOn && t >= pendEnd; }

  // Judge the pending beat; r: the clock's noise-mode marginal, n: tick index.
  void judge(const double r[2], int64_t n, DecExistJudge &rec) noexcept {
    const double ap = pendA;
    const double P = pendP;
    double L = 0.0;
    for (int32_t c = 0; c < 3; ++c) {
      double S[2], gate[2], norm[2];
      for (int32_t k = 0; k < 2; ++k) {
        S[k] = kEvR[c * 2 + k] + P;
        gate[k] = kChi2_99 * S[k];
        norm[k] = std::sqrt(kTwoPi * S[k]);
      }
      const double *e = ev[c];
      double s = 0.0;
      for (int32_t i = 0, j = head[c]; i < count[c]; ++i, j = j + 1 == kBandCap ? 0 : j + 1) {
        const double nu = e[j] - ap;
        for (int32_t k = 0; k < 2; ++k) {
          if (nu * nu <= gate[k])
            s += (r[k] * portableExp(((-.5 * nu) * nu) / S[k])) / norm[k];
        }
      }
      const double lam = (1.0 - kExPd[c] * kPG) + (kExPd[c] / kExRho[c]) * s;
      const double vv = v[c] * (1.0 - kExP10[c]) + (1.0 - v[c]) * kExP01[c];
      const double lc = ((vv * lam) + 1.0) - vv;
      v[c] = (vv * lam) / lc;
      L += portableLog(lc);
      rec.s[c] = s;
    }
    double pe = 1.0 / (1.0 + portableExp(-lo));
    pe = pe * (1.0 - kExQ) + (1.0 - pe) * kExQ;
    lo = portableLog(pe / (1.0 - pe)) + L;
    shown = shown ? lo > -kExThr : lo >= kExThr;
    done = pendEnd - kExDav;
    rec.t = ap;
    rec.lo = lo;
    rec.n = n;
    rec.nc = nc;
    ops += 120;
    pendOn = false;
  }
};

} // namespace effetune::plugins::analyzer::rhythm_a3::dec
