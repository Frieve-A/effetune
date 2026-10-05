// The temporal base features of the TD tempo prior (rd5 fx g_temporal), plus the short-term
// loudness of g_dynamics, per tick: modulation shape and centroid of 4 log-envelope groups,
// per-group positive log-spectral flux and the past-only HPSS ratio. fx fills inactive ticks with
// the last active value; leading inactive ticks take the first active value, which contributes
// nothing here (zero envelope deltas and flux) except to the short-term loudness, which starts at
// the first active tick (NaN before). scipy lfilter is replicated as DF2T in its operation order.
// Real-time safe: fixed-size members only, no allocation.
#pragma once
#include <cstdint>
#include <limits>

#include "tc_v0.h"
#include "tdp_tables.generated.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class TdpTemporal {
public:
  static constexpr std::uint32_t kBins = tdp_tables::kBins, kMel = tdp_tables::kMel,
                                 kRates = tdp_tables::kModRates, kGroups = 4u, kMedian = 9u;
  // Feature order: fx g_temporal's names.
  enum Feature : std::uint32_t {
    kMod0 = 0u,                          // mod_g{g}_{fc} at kMod0 + g * kRates + rate
    kModCen0 = kMod0 + kGroups * kRates, // mod_cen_g0 .. g3
    kFlux0 = kModCen0 + kGroups,         // flux_g0 .. g3
    kHpss = kFlux0 + kGroups,
    kFeatures
  };

  void reset() noexcept {
    n_ = 0;
    held_ = false;
    stHeld_ = false;
    for (auto &g : bq_)
      for (auto &r : g)
        r[0] = r[1] = 0.0;
    for (auto &g : env_)
      for (double &z : g)
        z = 0.0;
  }

  // Tick from P, eps0, melP and log(P + eps0) (tdp_spectral.h) and the gate; restart starts afresh.
  void tick(const double *power, double eps0, const double *melP, const double *logPower,
            bool active, bool restart) noexcept {
    namespace T = tdp_tables;
    using tc_detail::log10x10;
    using tc_detail::npSum;
    if (restart)
      reset();
    double *f = features_;

    // Envelope deltas d = ge - prev(ge) of the filled group levels; 0 on held ticks.
    double d[kGroups] = {};
    if (active) {
      for (std::uint32_t g = 0u; g < kGroups; ++g) {
        const double ge = log10x10(npSum(melP + 6u * g, 6u));
        d[g] = held_ ? ge - ge_[g] : 0.0;
        ge_[g] = ge;
      }
    }
    // Modulation energy: band-pass, square, 1 s EMA (zero initial state, as fx's first d is 0).
    for (std::uint32_t g = 0u; g < kGroups; ++g) {
      double e[kRates];
      for (std::uint32_t r = 0u; r < kRates; ++r) {
        double *z = bq_[g][r];
        const double y = z[0] + T::kModB0[r] * d[g];
        z[0] = z[1] - y * T::kModA1[r];
        z[1] = d[g] * T::kModB2[r] - y * T::kModA2[r];
        const double v = env_[g][r] + T::kModEmaA * (y * y);
        env_[g][r] = T::kModEmaZ * v;
        e[r] = v + 1e-12;
      }
      const double sum = npSum(e, kRates);
      double cen = 0.0;
      for (std::uint32_t r = 0u; r < kRates; ++r) {
        const double s = e[r] / sum;
        f[kMod0 + g * kRates + r] = s;
        cen += s * T::kModLog2Fc[r];
      }
      f[kModCen0 + g] = cen;
    }

    // Flux: mean positive log-power rise per level group; 0 on held ticks.
    for (std::uint32_t b = 0u; b < kBins; ++b) {
      const double pos = active && held_ ? logPower[b] - lp_[b] : 0.0;
      scratch_[b] = pos > 0.0 ? pos : 0.0;
      lp_[b] = active ? logPower[b] : lp_[b];
    }
    for (std::uint32_t g = 0u; g < kGroups; ++g) {
      const std::uint32_t a = T::kGroups[g][0], n = T::kGroups[g][1] - a;
      f[kFlux0 + g] = npSum(scratch_ + a, n) / static_cast<double>(n);
    }

    // HPSS: 9-tick time median (the segment's first P repeated before it) over the 9-bin frequency
    // median (edge padded), both summed over the bins with an eps0 floor.
    double *slot = hist_[n_ % kMedian];
    for (std::uint32_t b = 0u; b < kBins; ++b)
      slot[b] = power[b];
    if (n_ == 0)
      for (std::uint32_t i = 1u; i < kMedian; ++i)
        for (std::uint32_t b = 0u; b < kBins; ++b)
          hist_[i][b] = power[b];
    double v[kMedian];
    for (std::uint32_t b = 0u; b < kBins; ++b) {
      for (std::uint32_t i = 0u; i < kMedian; ++i)
        v[i] = hist_[i][b];
      scratch_[b] = median9(v);
    }
    const double harmonic = npSum(scratch_, kBins);
    for (std::uint32_t b = 0u; b < kBins; ++b) {
      for (std::uint32_t i = 0u; i < kMedian; ++i) {
        const std::int32_t j = static_cast<std::int32_t>(b + i) - 4;
        v[i] = power[j < 0 ? 0 : j >= static_cast<std::int32_t>(kBins) ? kBins - 1u : j];
      }
      scratch_[b] = median9(v);
    }
    const double e0 = eps0 * static_cast<double>(kBins);
    f[kHpss] = log10x10((harmonic + e0) / (npSum(scratch_, kBins) + e0));

    // Short-term loudness: dB of the 3 s EMA of the filled K-weighted mel power.
    if (active) {
      for (std::uint32_t i = 0u; i < kMel; ++i)
        v24_[i] = melP[i] * T::kKWeight[i];
      stIn_ = npSum(v24_, kMel);
      if (!stHeld_)
        stZ_ = T::kStEmaZ * stIn_;
      stHeld_ = true;
    }
    if (stHeld_) {
      const double y = stZ_ + T::kStEmaA * stIn_;
      stZ_ = T::kStEmaZ * y;
      st_ = log10x10(y);
    } else {
      st_ = std::numeric_limits<double>::quiet_NaN();
    }
    held_ = held_ || active;
    ++n_;
  }

  const double *features() const noexcept { return features_; }
  // Short-term loudness in dB (fx g_dynamics st), NaN before the segment's first active tick.
  double shortTermDb() const noexcept { return st_; }

private:
  // Median of 9 by a 19-exchange sorting network (Devillard); exact, permutes v.
  static double median9(double *v) noexcept {
    constexpr std::uint8_t kNet[19][2] = {{1, 2}, {4, 5}, {7, 8}, {0, 1}, {3, 4}, {6, 7}, {1, 2},
                                          {4, 5}, {7, 8}, {0, 3}, {5, 8}, {4, 7}, {3, 6}, {1, 4},
                                          {2, 5}, {4, 7}, {4, 2}, {6, 4}, {4, 2}};
    for (const auto &p : kNet) {
      const double a = v[p[0]], b = v[p[1]];
      v[p[0]] = a > b ? b : a;
      v[p[1]] = a > b ? a : b;
    }
    return v[4];
  }

  double features_[kFeatures] = {};
  double st_ = 0.0;
  std::int64_t n_ = 0;
  // held_: an active tick was seen this segment; ge_/lp_: the last active group dB and log power.
  bool held_ = false, stHeld_ = false;
  double ge_[kGroups] = {}, lp_[kBins] = {};
  // DF2T states of the band-pass biquads and of the energy EMAs.
  double bq_[kGroups][kRates][2] = {}, env_[kGroups][kRates] = {};
  // Short-term loudness: the last active EMA input and the EMA state.
  double stIn_ = 0.0, stZ_ = 0.0;
  // The last kMedian tick spectra (ring by tick count).
  double hist_[kMedian][kBins] = {};
  // Per-tick scratch.
  double scratch_[kBins] = {}, v24_[kMel] = {};
};

} // namespace effetune::plugins::analyzer::rhythm_a3
