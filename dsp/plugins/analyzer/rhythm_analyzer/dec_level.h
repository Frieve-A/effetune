// A3 level layer over the clock under the frozen configuration (level prior, Bayesian reseed, pi
// .95, confirm 1.0). numpy's vector expressions are evaluated per hypothesis in the reference
// order; weighted bincount and maximum.at are sequential in hypothesis order, post.sum() and
// Pn.sum() are numpy pairwise sums, np.log / np.exp / math.log use the portable functions (drift,
// counted).
#pragma once
#include <cmath>
#include <cstdint>
#include <limits>
#include <type_traits>

#include "dec_const.h"
#include "dec_math.h"

namespace effetune::plugins::analyzer::rhythm_a3::dec {

inline constexpr int32_t kG2Slots = 28; // G2Update slots (the row length in the level op count)
inline constexpr int32_t kLvSwitchMaxSteps =
    64; // switch() alignment steps (a3 needs <= 2; guards T <= 0)

// A switch waiting for confirmation: target hypothesis h, proposed at time t.
struct DecPending {
  bool on;
  double t;
  int32_t h;
};

struct DecLevel {
  double post[kLvH];
  double ph[kLvH];
  double acc[kLvH];
  int64_t m;
  DecPending pend;
  int32_t cur;
  int64_t n; // index of the clock's next beat a
  int64_t u; // output position in 1 / LV_U clock beats
  double last;
  double kappa; // .5 / W as a Python float
  int64_t ops;
  int64_t switchCapped;
  int32_t lastRi;      // the last reseed's relation (-1: a restart)
  double lastPn[kLvG]; // the last carrying reseed's level mass

  // a3 Level.__init__.
  void init(double kappaIn) noexcept {
    kappa = kappaIn;
    cur = 0;
    n = u = 0;
    last = -std::numeric_limits<double>::infinity();
    ops = 0;
    switchCapped = 0;
    lastRi = -1;
    restart();
  }

  void restart() noexcept {
    for (int32_t h = 0; h < kLvH; ++h) {
      post[h] = kLvPi0[h];
      ph[h] = kLvPh0[h];
      acc[h] = 0.0;
    }
    m = 0;
    pend = {false, 0.0, 0};
  }

  [[nodiscard]] static double qOf(int32_t h) noexcept {
    return static_cast<double>(kLvQ12[h]) / kLvU;
  }
  [[nodiscard]] double q() const noexcept { return qOf(cur); }

  // First hypothesis of level g with the largest phase mass.
  [[nodiscard]] int32_t best(int32_t g) const noexcept {
    int32_t b = -1;
    for (int32_t h = 0; h < kLvH; ++h) {
      if (kLvGrp[h] == g && (b < 0 || ph[h] > ph[b]))
        b = h;
    }
    return b;
  }

  [[nodiscard]] double time(int64_t pos, double a, double T) const noexcept {
    return a + (static_cast<double>(pos - kLvU * n) / kLvU) * T;
  }

  // First position of hypothesis h after time t.
  [[nodiscard]] int64_t anchorAt(int32_t h, double a, double T, double t) const noexcept {
    const int64_t q12 = kLvQ12[h];
    const int64_t f = kLvPh12[h];
    const int64_t base = kLvU * n;
    int64_t x = f - pyFloorDiv(f - base, q12) * q12;
    while (x - q12 > base - kLvU && time(x - q12, a, T) > t) // at most (LV_U + q) / q steps
      x -= q12;
    return x;
  }

  void anchor(double a, double T, double t) noexcept { u = anchorAt(cur, a, T, t); }

  // One activation tick outside Z (lnr: the tick's ln ratio per class).
  void tick(const double *lnr, double tau, double a, double T) noexcept {
    const double perTick = T / (kLvU * kDt);
    const double x = static_cast<double>(kLvU * n) + ((tau - a) / T) * kLvU;
    for (int32_t h = 0; h < kLvH; ++h) {
      const double per = static_cast<double>(kLvQ12[h]) * perTick;
      double d = (x - static_cast<double>(kLvPh12[h])) / static_cast<double>(kLvQ12[h]);
      d = std::fabs(d - std::floor(d + .5)) * per;
      const int32_t cls = d < 1.5 ? 0 : (per * .5 - d < 1.5 ? 1 : 2);
      acc[h] += lnr[cls];
    }
    ++m;
    ops += 16 * kLvH;
  }

  // One G2 row (G2Update members count, period[], ref[], p[][3]), then both filters.
  template <class Update> void update(const Update &g2, double a, double T) noexcept {
    static_assert(std::extent_v<decltype(Update::period)> == kG2Slots,
                  "a3 counts the op cost over C_MAX slots");
    double Tq[kLvH], b[kLvH], lam[kLvH];
    for (int32_t h = 0; h < kLvH; ++h) {
      Tq[h] = (T * static_cast<double>(kLvQ12[h])) / kLvU;
      b[h] = a + (static_cast<double>(pyMod(kLvPh12[h] - kLvU * n, kLvQ12[h])) / kLvU) * T;
      lam[h] = 0.0;
    }
    for (int32_t c = 0; c < g2.count; ++c) {
      const float per = g2.period[c];
      const float *pc = g2.p[c];
      if (!(per > 0.0f) || !(pc[0] >= 0.0f && pc[1] >= 0.0f && pc[2] >= 0.0f))
        continue;
      const double perD = static_cast<double>(per);
      bool mt[kLvH];
      bool any = false;
      for (int32_t h = 0; h < kLvH; ++h) {
        mt[h] = std::fabs(portableLog(Tq[h] / perD)) <= kLevelTolG2;
        any = any || mt[h];
      }
      if (!any)
        continue;
      double lr[3];
      for (int32_t k = 0; k < 3; ++k) {
        const double x = static_cast<double>(pc[k]);
        lr[k] = portableLog(x >= 1e-6 ? x : 1e-6) - kG2LogPrior[k];
      }
      const double on = lr[0] - lr[2];
      const double off = lr[1] - lr[2];
      const double ref = g2.ref[c];
      for (int32_t h = 0; h < kLvH; ++h) {
        double e = (ref - b[h]) / Tq[h];
        e -= rintEven(e);
        lam[h] += mt[h] ? kappa * (std::fabs(e) < .25 ? on : off) : 0.0;
      }
    }
    const double pl = pyMin(kLvPl * static_cast<double>(m), .5);
    const double pp = pyMin(kLvPp * static_cast<double>(m), .5);
    double gs[kLvG];
    for (int32_t g = 0; g < kLvG; ++g)
      gs[g] = 0.0;
    for (int32_t h = 0; h < kLvH; ++h)
      gs[kLvGrp[h]] += post[h];
    double lmax = lam[0];
    for (int32_t h = 1; h < kLvH; ++h)
      lmax = lam[h] > lmax ? lam[h] : lmax;
    const double keepW = (1.0 - pl) - pp;
    double np[kLvH];
    for (int32_t h = 0; h < kLvH; ++h) {
      const double ng = static_cast<double>(kLvNg[kLvGrp[h]]);
      np[h] = ((keepW * post[h] + (pp * gs[kLvGrp[h]]) / ng) + pl * kLvPi0[h]) *
              portableExp(lam[h] - lmax);
    }
    const double sp = pairwiseSum(np, kLvH);
    for (int32_t h = 0; h < kLvH; ++h)
      post[h] = np[h] / sp;
    double ll[kLvH], gmax[kLvG];
    for (int32_t g = 0; g < kLvG; ++g)
      gmax[g] = -std::numeric_limits<double>::infinity();
    for (int32_t h = 0; h < kLvH; ++h) {
      ll[h] = acc[h] + lam[h];
      const int32_t g = kLvGrp[h];
      gmax[g] = ll[h] > gmax[g] ? ll[h] : gmax[g];
    }
    for (int32_t g = 0; g < kLvG; ++g)
      gs[g] = 0.0;
    for (int32_t h = 0; h < kLvH; ++h) {
      const int32_t g = kLvGrp[h];
      ph[h] =
          ((1.0 - pp) * ph[h] + pp / static_cast<double>(kLvNg[g])) * portableExp(ll[h] - gmax[g]);
      gs[g] += ph[h];
    }
    for (int32_t h = 0; h < kLvH; ++h) {
      ph[h] = ph[h] / gs[kLvGrp[h]];
      acc[h] = 0.0;
    }
    m = 0;
    ops += 30 * kLvH * (2 + kG2Slots);
  }

  // Posterior mass of each level.
  void groupMass(double *Pg) const noexcept {
    for (int32_t g = 0; g < kLvG; ++g)
      Pg[g] = 0.0;
    for (int32_t h = 0; h < kLvH; ++h)
      Pg[kLvGrp[h]] += post[h];
  }

  // First level with the largest mass among those allowed admits (null: all).
  [[nodiscard]] static int32_t heaviest(const double *Pg, const bool *allowed) noexcept {
    int32_t gb = -1;
    for (int32_t g = 0; g < kLvG; ++g) {
      if ((allowed == nullptr || allowed[g]) && (gb < 0 || Pg[g] > Pg[gb]))
        gb = g;
    }
    return gb;
  }

  // Hysteresis and confirmation of an output switch from hypothesis from at decoder time t, over
  // the level mass Pg and the levels that allowed admits (null: all), with the level-switch
  // thresholds hi (target) and lo (current); the phase rule keeps pi. Returns the new hypothesis
  // or -1.
  [[nodiscard]] int32_t decideMass(int32_t from, DecPending &pd, const double *Pg,
                                   const bool *allowed, double hi, double lo, double t,
                                   double T) const noexcept {
    const int32_t g = kLvGrp[from];
    const int32_t gb = heaviest(Pg, allowed);
    int32_t tgt = -1;
    if (gb != g && Pg[g] <= lo && Pg[gb] >= hi) {
      tgt = best(gb);
    } else {
      const int32_t hb = best(g);
      if (hb != from && ph[from] <= kOneMinusPi && ph[hb] >= kPi)
        tgt = hb;
    }
    if (pd.on) {
      const int32_t gh = kLvGrp[pd.h];
      const bool cond = (allowed == nullptr || allowed[gh]) &&
                        (gh != g ? (Pg[gh] > .5 && Pg[g] < .5) : ph[pd.h] > .5);
      if (cond) {
        if ((t - pd.t) + kEpsT >= (kConfirm * T) * qOf(pd.h)) {
          pd.on = false;
          return best(gh);
        }
        return -1;
      }
    }
    pd.on = false;
    if (tgt < 0 || kConfirm <= 0.0)
      return tgt;
    pd = {true, t, tgt};
    return -1;
  }

  [[nodiscard]] int32_t decide(double t, double T) noexcept {
    double Pg[kLvG];
    groupMass(Pg);
    return decideMass(cur, pend, Pg, nullptr, kPi, kOneMinusPi, t, T);
  }

  // Output position of hypothesis h switched in at time t: its first position after t, at least
  // half an output beat after the output beat at time lastBeat.
  [[nodiscard]] int64_t switchPos(int32_t h, double a, double T, double t,
                                  double lastBeat) noexcept {
    return spaced(h, anchorAt(h, a, T, t), a, T, lastBeat);
  }

  // Position x of hypothesis h, moved on to its first position at least half an output beat after
  // the output beat at time lastBeat.
  [[nodiscard]] int64_t spaced(int32_t h, int64_t x, double a, double T, double lastBeat) noexcept {
    const int64_t q12 = kLvQ12[h];
    const double lim = lastBeat + ((.5 * T) * static_cast<double>(q12)) / kLvU;
    int32_t steps = 0;
    while (time(x, a, T) < lim) {
      if (steps == kLvSwitchMaxSteps) {
        ++switchCapped;
        break;
      }
      x += q12;
      ++steps;
    }
    return x;
  }

  // The output takes hypothesis h at time t.
  void switchTo(int32_t h, double a, double T, double t) noexcept {
    cur = h;
    pend.on = false;
    u = switchPos(h, a, T, t, last);
  }

  // First hypothesis of level go whose phase is nearest the time tOb.
  [[nodiscard]] static int32_t nearest(int32_t go, double a, double T, double tOb) noexcept {
    int32_t bh = -1;
    double bd = 0.0;
    for (int32_t h = 0; h < kLvH; ++h) {
      if (kLvGrp[h] != go)
        continue;
      double e = (tOb - (a + (static_cast<double>(kLvPh12[h]) / kLvU) * T)) /
                 ((T * static_cast<double>(kLvQ12[h])) / kLvU);
      const double d = std::fabs(e - rintEven(e));
      if (bh < 0 || d < bd) {
        bh = h;
        bd = d;
      }
    }
    return bh;
  }

  // The clock was (re)seeded; restartKind: 'lock' or 'bank'.
  void reseed(bool restartKind, double Told, double a, double T, double t, double tOb,
              double w) noexcept {
    n = 0;
    int32_t ri = -1;
    if (!restartKind) {
      const double lr = portableLog(Told / T);
      ri = 0;
      double bv = std::fabs(lr - kLvLogNd[0]);
      for (int32_t k = 1; k < kLvG; ++k) {
        const double v = std::fabs(lr - kLvLogNd[k]);
        if (v < bv) {
          bv = v;
          ri = k;
        }
      }
      if (std::fabs(lr - kLvLogNd[ri]) > kLvTol)
        ri = -1;
    }
    lastRi = ri;
    if (ri < 0) {
      restart();
      cur = 0;
    } else {
      double Pg[kLvG];
      double *Pn = lastPn;
      groupMass(Pg);
      for (int32_t g = 0; g < kLvG; ++g)
        Pn[g] = 0.0;
      for (int32_t g = 0; g < kLvG; ++g) {
        const int32_t gn = kLvMap[g * kLvG + ri];
        if (gn >= 0)
          Pn[gn] += (Pg[g] * kLvP0g[gn]) / kLvP0g[g];
      }
      double s = pairwiseSum(Pn, kLvG);
      for (int32_t g = 0; g < kLvG; ++g) {
        Pn[g] = Pn[g] / s;
        Pn[g] = Pn[g] > kLvFloor[g] ? Pn[g] : kLvFloor[g]; // np.maximum
      }
      s = pairwiseSum(Pn, kLvG);
      for (int32_t g = 0; g < kLvG; ++g)
        Pn[g] = (1.0 - w) * (Pn[g] / s) + w * kLvP0g[g];
      for (int32_t h = 0; h < kLvH; ++h) {
        const int32_t g = kLvGrp[h];
        post[h] = Pn[g] / static_cast<double>(kLvNg[g]);
        ph[h] = kLvPh0[h];
        acc[h] = 0.0;
      }
      m = 0;
      pend.on = false;
      cur = nearest(argmaxFirst(Pn, kLvG), a, T, tOb);
    }
    anchor(a, T, t);
  }
};

} // namespace effetune::plugins::analyzer::rhythm_a3::dec
