// A3 clock under the frozen configuration: IMM over M = 2 K models (dynamics j / K,
// noise mode j % K), noise 'modes' (X = 0, no online learning). P is symmetric at all times (seed,
// beat and update write P10 = P01), so each model stores P00, P01, P11. Sums run in the reference
// order; exp and log use the portable functions and (sd * xt) ** 2 is (sd * xt) * (sd * xt) (avoids
// the C runtime's pow drift).
#pragma once
#include <cmath>
#include <cstdint>

#include "dec_const.h"
#include "dec_math.h"

namespace effetune::plugins::analyzer::rhythm_a3::dec {

static_assert(kClK == 2 && kClM == 4, "the clock port assumes noise 'modes' with K = 2");

struct DecClock {
  double x0[kClM];  // beat time of the next beat
  double x1[kClM];  // period
  double p00[kClM]; // covariance
  double p01[kClM];
  double p11[kClM];
  double mu[kClM]; // model probabilities
  double keep[kClK];
  bool on;
  int64_t ops;

  void reset() noexcept {
    for (int32_t j = 0; j < kClM; ++j) {
      x0[j] = x1[j] = p00[j] = p01[j] = p11[j] = 0.0;
      mu[j] = kClMu0[j];
    }
    for (int32_t k = 0; k < kClK; ++k)
      keep[k] = kClPriorK[k];
    on = false;
    ops = 0;
  }

  // Marginal of mu over the noise modes (noise true) or the dynamics.
  void marg(bool noise, double out[2]) const noexcept {
    out[0] = out[1] = 0.0;
    for (int32_t j = 0; j < kClM; ++j)
      out[noise ? j % kClK : j / kClK] += mu[j];
  }

  [[nodiscard]] double stiff() const noexcept {
    double d[2];
    marg(false, d);
    return d[0];
  }

  // Noise prior of a new song: modes at their prior, dynamics marginal kept.
  void renew() noexcept {
    double d[2];
    marg(false, d);
    for (int32_t j = 0; j < kClM; ++j)
      mu[j] = d[j / kClK] * kClPriorK[j % kClK];
  }

  void settle() noexcept {
    for (int32_t j = 0; j < kClM; ++j)
      mu[j] = .5 * keep[j % kClK];
  }

  void seed(double a, double T, double c00, double c01, double c11) noexcept {
    if (on) {
      marg(true, keep);
    } else {
      for (int32_t k = 0; k < kClK; ++k)
        keep[k] = kClPriorK[k];
    }
    for (int32_t j = 0; j < kClM; ++j) {
      x0[j] = a;
      x1[j] = T;
      p00[j] = c00;
      p01[j] = c01;
      p11[j] = c11;
    }
    settle();
    on = true;
  }

  void comb(double &a, double &T) const noexcept {
    a = T = 0.0;
    for (int32_t j = 0; j < kClM; ++j) {
      a += mu[j] * x0[j];
      T += mu[j] * x1[j];
    }
  }

  // IMM mixing, then one beat of prediction in each model.
  void beat() noexcept {
    double c[kClM];
    for (int32_t j = 0; j < kClM; ++j) {
      double s = 0.0;
      for (int32_t i = 0; i < kClM; ++i)
        s += kClPi[i * kClM + j] * mu[i];
      c[j] = s;
    }
    double nx0[kClM], nx1[kClM], n00[kClM], n01[kClM], n11[kClM];
    for (int32_t j = 0; j < kClM; ++j) {
      double w[kClM];
      for (int32_t i = 0; i < kClM; ++i)
        w[i] = (kClPi[i * kClM + j] * mu[i]) / c[j];
      double xa = 0.0, xt = 0.0;
      for (int32_t i = 0; i < kClM; ++i) {
        xa += w[i] * x0[i];
        xt += w[i] * x1[i];
      }
      double q00 = 0.0, q01 = 0.0, q11 = 0.0;
      for (int32_t i = 0; i < kClM; ++i) {
        const double da = x0[i] - xa;
        const double dt = x1[i] - xt;
        q00 += w[i] * (p00[i] + da * da);
        q01 += w[i] * (p01[i] + da * dt);
        q11 += w[i] * (p11[i] + dt * dt);
      }
      const double sx = kClSd[j] * xt;
      const double q = sx * sx;
      nx0[j] = xa + xt;
      nx1[j] = xt;
      n00[j] = (q00 + 2.0 * q01) + q11;
      n01[j] = q01 + q11;
      n11[j] = q11 + q;
    }
    for (int32_t j = 0; j < kClM; ++j) {
      x0[j] = nx0[j];
      x1[j] = nx1[j];
      p00[j] = n00[j];
      p01[j] = n01[j];
      p11[j] = n11[j];
      mu[j] = c[j];
    }
    ops += 40 * kClM;
  }

  // PDA update with one measurement b of variance R[k] per noise mode; returns whether any model
  // gated it.
  bool update(double b, const double *R, double PD, double rho, double lr) noexcept {
    double a, T;
    comb(a, T);
    const double m = rintEven((b - a) / T); // Python round() to an int, used as a float
    const double clutter = (1.0 - PD * kPG) * rho;
    double lam[kClM];
    bool gated = false;
    for (int32_t j = 0; j < kClM; ++j) {
      const double nu = b - (x0[j] + m * x1[j]);
      const double ph0 = p00[j] + m * p01[j];
      const double ph1 = p01[j] + m * p11[j];
      const double S = (ph0 + m * ph1) + R[j % kClK]; // + X, X = 0 under noise 'modes'
      const double d2 = (nu * nu) / S;
      if (d2 <= kChi2_99) {
        gated = true;
        const double lik = ((PD * lr) * portableExp(-.5 * d2)) / std::sqrt(kTwoPi * S);
        const double beta = lik / (lik + clutter);
        const double k0 = ph0 / S;
        const double k1 = ph1 / S;
        x0[j] += (k0 * beta) * nu;
        x1[j] += (k1 * beta) * nu;
        const double g = (((beta * (1.0 - beta)) * nu) * nu) - beta * S;
        double q00 = p00[j] + (g * k0) * k0;
        double q01 = p01[j] + (g * k0) * k1;
        double q11 = p11[j] + (g * k1) * k1;
        q00 = pyMax(q00, 1e-12);
        q11 = pyMax(q11, 1e-14);
        const double lim = std::sqrt(q00 * q11) * .999;
        q01 = pyMax(-lim, pyMin(lim, q01));
        p00[j] = q00;
        p01[j] = q01;
        p11[j] = q11;
        lam[j] = clutter + lik;
      } else {
        lam[j] = clutter;
      }
    }
    if (gated) {
      double s = 0.0;
      for (int32_t j = 0; j < kClM; ++j)
        s += lam[j] * mu[j];
      for (int32_t j = 0; j < kClM; ++j)
        mu[j] = (lam[j] * mu[j]) / s;
    }
    ops += 60 * kClM;
    return gated;
  }

  // Variance of the combined beat time a.
  [[nodiscard]] double varA(double a) const noexcept {
    double v = 0.0;
    for (int32_t j = 0; j < kClM; ++j) {
      const double d = x0[j] - a;
      v += mu[j] * (p00[j] + d * d);
    }
    return v;
  }
};

} // namespace effetune::plugins::analyzer::rhythm_a3::dec
