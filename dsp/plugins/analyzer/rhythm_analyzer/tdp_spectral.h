// The spectral base features of the TD tempo prior (rd5 fx g_spectral, plus hf_limit of
// g_dynamics), per tick from the tick power spectrum P and eps0 (tdp_tick.h): relative mel levels,
// MFCC and their 4-tick deltas, log-frequency moments, rolloff, spectral crest, flatness, octave
// contrast, level-group slopes, sharpness and the HF limit. Float64 in fx's order of operations
// where it is sequential; fx's matrix products (mel, DCT, centroid) are summed sequentially here.
// Real-time safe: fixed-size members only, no allocation.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

#include "portable_math.h"
#include "tc_v0.h"
#include "tdp_tables.generated.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class TdpSpectral {
public:
  static constexpr std::uint32_t kBins = tdp_tables::kBins, kMel = tdp_tables::kMel,
                                 kMfcc = tdp_tables::kMfcc;
  // Feature order: fx g_spectral's names, then hf_limit.
  enum Feature : std::uint32_t {
    kRelMel0 = 0u,               // mel00 .. mel23
    kMfcc0 = kRelMel0 + kMel,    // mfcc1 .. mfcc12
    kDmfcc0 = kMfcc0 + kMfcc,    // dmfcc1 .. dmfcc12
    kCentroid = kDmfcc0 + kMfcc, // then bandwidth, rolloff85, kurtosis, skewness, sp_crest
    kFlatFull = kCentroid + 6u,  // then flat_g0 .. flat_g3
    kContrast0 = kFlatFull + 5u, // contrast0 .. contrast6
    kBalLow = kContrast0 + 7u,   // then bal_high, slope_high
    kSharpness = kBalLow + 3u,
    kHfLimit,
    kFeatures
  };

  void reset() noexcept { n_ = 0; }

  // Tick from P (kBins bins) and eps0; restart starts the MFCC delta history afresh.
  void tick(const double *power, double eps0, bool restart) noexcept {
    namespace T = tdp_tables;
    using rhythm_d::portableExp;
    using rhythm_d::portableLog;
    using tc_detail::log10x10;
    using tc_detail::npSum;
    if (restart)
      n_ = 0;
    double *f = features_;

    // Mel levels: melP = P W + eps0 sum(W); rel = dB - mean dB; MFCC = DCT dB.
    double lmel[kMel];
    for (std::uint32_t i = 0u; i < kMel; ++i) {
      const double *w = T::kMelW + T::kMelOff[i];
      double s = 0.0;
      for (std::uint32_t b = T::kMelLo[i]; b < T::kMelHi[i]; ++b)
        s += power[b] * w[b - T::kMelLo[i]];
      melP_[i] = s + eps0 * T::kMelSum[i];
      lmel[i] = log10x10(melP_[i]);
    }
    const double lmean = npSum(lmel, kMel) / static_cast<double>(kMel);
    for (std::uint32_t i = 0u; i < kMel; ++i)
      f[kRelMel0 + i] = lmel[i] - lmean;
    double *mfcc = f + kMfcc0;
    for (std::uint32_t c = 0u; c < kMfcc; ++c) {
      double s = 0.0;
      for (std::uint32_t i = 0u; i < kMel; ++i)
        s += lmel[i] * T::kDct[c][i];
      mfcc[c] = s;
    }
    // dmfcc: mfcc minus mfcc 4 ticks earlier (the first tick's before that).
    if (n_ == 0)
      std::copy(mfcc, mfcc + kMfcc, first_);
    double *old = n_ < 4 ? first_ : hist_[n_ & 3];
    for (std::uint32_t c = 0u; c < kMfcc; ++c)
      f[kDmfcc0 + c] = mfcc[c] - old[c];
    std::copy(mfcc, mfcc + kMfcc, hist_[n_ & 3]);

    // Distribution over log2 frequency.
    for (std::uint32_t b = 0u; b < kBins; ++b)
      pe_[b] = power[b] + eps0;
    const double tot = npSum(pe_, kBins);
    double cen = 0.0, peak = pe_[0];
    for (std::uint32_t b = 0u; b < kBins; ++b) {
      p_[b] = pe_[b] / tot;
      cen += p_[b] * T::kLog2Freq[b];
      peak = pe_[b] > peak ? pe_[b] : peak;
    }
    for (std::uint32_t b = 0u; b < kBins; ++b) {
      const double d = T::kLog2Freq[b] - cen, d2 = d * d;
      a2_[b] = p_[b] * d2;
      a3_[b] = p_[b] * (d2 * d);
      a4_[b] = p_[b] * (d2 * d2);
    }
    const double var = npSum(a2_, kBins), bw = std::sqrt(var);
    std::uint32_t below = 0u;
    double cum = 0.0;
    for (std::uint32_t b = 0u; b < kBins; ++b) {
      cum += p_[b];
      below += cum < .85 ? 1u : 0u;
    }
    f[kCentroid] = cen;
    f[kCentroid + 1u] = bw;
    f[kCentroid + 2u] = T::kLog2Freq[below < kBins - 1u ? below : kBins - 1u];
    f[kCentroid + 3u] = npSum(a4_, kBins) / (var * var);
    f[kCentroid + 4u] = npSum(a3_, kBins) / ((bw * bw) * bw);
    f[kCentroid + 5u] = log10x10(peak / (tot / static_cast<double>(kBins)));

    // Flatness (full band, then the level groups) and group levels.
    for (std::uint32_t b = 0u; b < kBins; ++b)
      lp_[b] = portableLog(pe_[b]);
    f[kFlatFull] = flatness(0u, kBins);
    double gl[4];
    for (std::uint32_t g = 0u; g < 4u; ++g) {
      const std::uint32_t a = T::kGroups[g][0], n = T::kGroups[g][1] - a;
      f[kFlatFull + 1u + g] = flatness(a, n);
      gl[g] = log10x10(npSum(pe_ + a, n) / static_cast<double>(n));
    }
    // Octave contrast: mean of the top q over mean of the bottom q bins.
    for (std::uint32_t o = 0u; o < 7u; ++o) {
      const std::uint32_t a = T::kOct[o][0], n = T::kOct[o][1] - a, q = T::kOct[o][2];
      std::copy(pe_ + a, pe_ + a + n, sort_);
      std::sort(sort_, sort_ + n);
      const double hi = npSum(sort_ + (n - q), q) / static_cast<double>(q);
      const double lo = npSum(sort_, q) / static_cast<double>(q);
      f[kContrast0 + o] = log10x10(hi / lo);
    }
    f[kBalLow] = gl[0] - gl[1];
    f[kBalLow + 1u] = (gl[2] + gl[3]) / 2.0 - gl[1];
    f[kBalLow + 2u] = gl[3] - gl[2];

    // Sharpness: loudness-weighted Zwicker weight, N = melP^0.23.
    double nl[kMel], ng[kMel];
    for (std::uint32_t i = 0u; i < kMel; ++i) {
      nl[i] = portableExp(.23 * portableLog(melP_[i]));
      ng[i] = nl[i] * T::kSharpG[i];
    }
    f[kSharpness] = npSum(ng, kMel) / npSum(nl, kMel);

    // HF limit: the highest bin from bin 4 up within 30 dB of the median level.
    constexpr std::uint32_t kHf = kBins - 4u;
    for (std::uint32_t i = 0u; i < kHf; ++i)
      sort_[i] = a2_[i] = log10x10(pe_[4u + i]);
    std::nth_element(sort_, sort_ + kHf / 2u, sort_ + kHf);
    const double floorDb = sort_[kHf / 2u] - 30.0;
    std::uint32_t hi = 0u;
    for (std::uint32_t i = 0u; i < kHf; ++i)
      hi = a2_[i] > floorDb ? i : hi;
    f[kHfLimit] = T::kHfLog2[hi];
    ++n_;
  }

  const double *features() const noexcept { return features_; }
  // melP (with the eps0 floor) per mel band, and log(P + eps0) per bin.
  const double *melPower() const noexcept { return melP_; }
  const double *logPower() const noexcept { return lp_; }

private:
  // fx flatness in dB: geometric over arithmetic mean of Pe over bins [a, a + n).
  double flatness(std::uint32_t a, std::uint32_t n) const noexcept {
    const double geo = rhythm_d::portableExp(tc_detail::npSum(lp_ + a, n) / static_cast<double>(n));
    return tc_detail::log10x10(geo / (tc_detail::npSum(pe_ + a, n) / static_cast<double>(n)));
  }

  double features_[kFeatures] = {};
  double melP_[kMel] = {};
  double first_[kMfcc] = {}, hist_[4][kMfcc] = {};
  std::int64_t n_ = 0;
  // Per-tick scratch.
  double pe_[kBins] = {}, p_[kBins] = {}, lp_[kBins] = {}, a2_[kBins] = {}, a3_[kBins] = {},
         a4_[kBins] = {}, sort_[kBins] = {};
};

} // namespace effetune::plugins::analyzer::rhythm_a3
