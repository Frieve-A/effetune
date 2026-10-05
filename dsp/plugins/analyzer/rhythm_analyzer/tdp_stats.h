// The statistics bank of the TD tempo prior (rd5 fx stats) over the active ticks, for the kn
// model's used columns (tdp_tables::kStatSlot): per base feature the EMAs (0.5, 3, 20 s), the
// cumulative mean and the 20 s and cumulative standard deviations; for fx's subset the cumulative
// skewness, speed, fast-minus-slow, decaying max/min and the quantile trackers (every 4th active
// tick); EMA-20 s cross correlations; the EMA-20 s and cumulative histogram of the short-term
// loudness relative to its cumulative mean; and the time since the last active tick. An active
// tick is a gated tick with every base feature available (fx: no NaN in the row). The statistics
// run on the active subsequence; inactive ticks hold them, NaN before the segment's first active
// tick. The quantiles are fx's stochastic-approximation trackers, so no order statistic over the
// song is kept. scipy lfilter is replicated as DF2T in its operation order; numpy's x**3 and
// x**1.5 (libm pow) are x*x*x and x*sqrt(x) here. Real-time safe: fixed-size members only, no
// allocation.
#pragma once
#include <cmath>
#include <cstdint>
#include <limits>

#include "tdp_tables.generated.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class TdpStats {
public:
  static constexpr std::uint32_t kBases = tdp_tables::kStatBases, kCols = tdp_tables::kStatCols,
                                 kLoudBins = tdp_tables::kLoudEdges + 1u;

  void reset() noexcept {
    n_ = 0;
    last_ = -1;
    for (double &v : out_)
      v = std::numeric_limits<double>::quiet_NaN();
  }

  // Tick k (counted from reset); base: the kBases base features (TdpPrior order), st: the
  // short-term loudness (dB), active: the statistics gate. A restart starts afresh.
  void tick(std::int64_t k, const double *base, double st, bool active, bool restart) noexcept {
    if (restart)
      reset();
    if (active) {
      update(base, st);
      last_ = k;
    }
    if (last_ >= 0)
      out_[tdp_tables::kStatSinceCol] = static_cast<double>(k - last_) * tdp_tables::kStatDt;
  }

  // The used columns in kStatSlot order.
  const double *features() const noexcept { return out_; }

  // The active ticks since the reset (fx gives no statistics row before the second).
  std::int64_t activeTicks() const noexcept { return n_; }

private:
  struct Moments {
    double ez[3], e[3]; // EMA states and values at tau 0.5, 3, 20 s
    double cz, cm;      // cumulative mean: running sum (then EMA state) and value
    double vz, v20; // 20 s variance about the previous 20 s mean: EMA state (zero-seeded), value
    double sz, vc;  // cumulative variance: running sum of squares (then EMA state) and value
    double d20, dc; // this tick's deviations from the previous 20 s and cumulative means
  };

  // One DF2T step of lfilter([a], [1, a - 1]); first seeds the state with (1 - a) x (fx ema_a).
  static double ema(double &z, std::uint32_t t, double x, bool first) noexcept {
    namespace T = tdp_tables;
    if (first)
      z = T::kStatEmaZ[t] * x;
    const double y = z + T::kStatEmaA[t] * x;
    z = T::kStatEmaZ[t] * y;
    return y;
  }

  // fx cum_avg step n_: the running mean (z: the running sum), then from kStatCumN on the EMA
  // seeded from it (z: its state).
  double cum(double &z, double x) const noexcept {
    namespace T = tdp_tables;
    if (n_ >= T::kStatCumN) {
      const double y = z + T::kStatCumA * x;
      z = T::kStatCumZ * y;
      return y;
    }
    z = n_ == 0 ? x : z + x;
    const double y = z / static_cast<double>(n_ + 1);
    if (n_ == T::kStatCumN - 1)
      z = T::kStatCumZ * y;
    return y;
  }

  void update(const double *x, double st) noexcept {
    namespace T = tdp_tables;
    const bool first = n_ == 0;
    for (std::uint32_t b = 0u; b < kBases; ++b) {
      Moments &m = m_[b];
      const double v = x[b], e20 = m.e[2], cm = m.cm;
      for (std::uint32_t t = 0u; t < 3u; ++t)
        m.e[t] = ema(m.ez[t], t, v, first);
      m.cm = cum(m.cz, v);
      m.d20 = v - (first ? m.e[2] : e20);
      m.dc = v - (first ? m.cm : cm);
      m.v20 = (first ? 0.0 : m.vz) + T::kStatEmaA[2] * (m.d20 * m.d20);
      m.vz = T::kStatEmaZ[2] * m.v20;
      if (n_ >= T::kStatCumN) {
        m.vc = m.sz + T::kStatCumA * (m.dc * m.dc);
        m.sz = T::kStatCumZ * m.vc;
      } else {
        m.sz = (first ? 0.0 : m.sz) + v * v;
        const double vc = m.sz / static_cast<double>(n_ + 1) - m.cm * m.cm;
        m.vc = vc > 0.0 ? vc : 0.0;
        if (n_ == T::kStatCumN - 1)
          m.sz = T::kStatCumZ * m.vc;
      }
    }

    // Subset statistics: cumulative skewness, speed (3 s EMA of |dx|), trackers.
    for (std::uint32_t i = 0u; i < T::kStatSkewN; ++i) {
      const Moments &m = m_[T::kStatSkewBase[i]];
      const double m3 = cum(m3z_[i], m.dc * m.dc * m.dc);
      const double vs = m.vc + 1e-12;
      const double s = m3 / (vs * std::sqrt(vs));
      skew_[i] = s < -20.0 ? -20.0 : s > 20.0 ? 20.0 : s;
    }
    for (std::uint32_t i = 0u; i < T::kStatSpeedN; ++i) {
      const double v = x[T::kStatSpeedBase[i]];
      const double d = first ? 0.0 : v - prev_[i];
      speed_[i] = ema(speedZ_[i], 1u, d < 0.0 ? -d : d, first);
      prev_[i] = v;
    }
    if (n_ % T::kStatDecim == 0)
      track(x, first);

    // Cross correlations about the previous 20 s means.
    for (std::uint32_t i = 0u; i < T::kStatXcorrN; ++i) {
      const Moments &a = m_[T::kStatXcorrBase[i][0]], &b = m_[T::kStatXcorrBase[i][1]];
      const double c = ema(xcZ_[i], 2u, a.d20 * b.d20, first);
      xcorr_[i] = c / (std::sqrt(a.v20 * b.v20) + 1e-9 * ((c < 0.0 ? -c : c) + 1e-30));
    }

    // Loudness relative to its cumulative mean: one-hot bin, EMA 20 s and cumulative.
    const double stc = st - cum(stZ_, st);
    std::uint32_t bin = 0u;
    while (bin < T::kLoudEdges && T::kLoudEdge[bin] <= stc)
      ++bin;
    for (std::uint32_t i = 0u; i < kLoudBins; ++i) {
      const double h = i == bin ? 1.0 : 0.0;
      loudE_[i] = ema(loudEZ_[i], 2u, h, first);
      loudC_[i] = cum(loudCZ_[i], h);
    }
    ++n_;
    output();
  }

  // Decaying max/min toward their midpoint and the quantile trackers q += eta (1[x > q] - tau),
  // eta = 0.05 (sd20 + 1e-6).
  void track(const double *x, bool first) noexcept {
    namespace T = tdp_tables;
    for (std::uint32_t i = 0u; i < T::kStatRangeN; ++i) {
      const double v = x[T::kStatRangeBase[i]];
      if (first)
        hi_[i] = lo_[i] = v;
      const double mid = (hi_[i] + lo_[i]) / 2.0;
      const double h = mid + (hi_[i] - mid) * T::kStatRangeR;
      const double l = mid + (lo_[i] - mid) * T::kStatRangeR;
      hi_[i] = v > h ? v : h;
      lo_[i] = v < l ? v : l;
    }
    for (std::uint32_t i = 0u; i < T::kStatQuantN; ++i) {
      const std::uint32_t b = T::kStatQuantBase[i][0];
      const double v = x[b];
      if (first)
        q_[i] = v;
      const double eta = 0.05 * (std::sqrt(m_[b].v20) + 1e-6);
      q_[i] = q_[i] + eta * ((v > q_[i] ? 1.0 : 0.0) - T::kStatQuantTau[T::kStatQuantBase[i][1]]);
    }
  }

  void output() noexcept {
    namespace T = tdp_tables;
    for (std::uint32_t c = 0u; c < kCols; ++c) {
      const std::uint32_t i = T::kStatSlot[c][1];
      const Moments &m = m_[i];
      double v = 0.0;
      switch (T::kStatSlot[c][0]) {
      case T::kStatE05:
      case T::kStatE3:
      case T::kStatE20:
        v = m.e[T::kStatSlot[c][0] - T::kStatE05];
        break;
      case T::kStatCum:
        v = m.cm;
        break;
      case T::kStatSd20:
        v = std::sqrt(m.v20);
        break;
      case T::kStatSdcum:
        v = std::sqrt(m.vc);
        break;
      case T::kStatFastSlow:
        v = m.e[0] - m.e[2];
        break;
      case T::kStatSkew:
        v = skew_[i];
        break;
      case T::kStatSpeed:
        v = speed_[i];
        break;
      case T::kStatDmax:
        v = hi_[i];
        break;
      case T::kStatDmin:
        v = lo_[i];
        break;
      case T::kStatQ:
        v = q_[i];
        break;
      case T::kStatXcorr:
        v = xcorr_[i];
        break;
      case T::kStatLoudE20:
        v = loudE_[i];
        break;
      case T::kStatLoudCum:
        v = loudC_[i];
        break;
      default: // kStatSince: per tick in tick()
        continue;
      }
      out_[c] = v;
    }
  }

  std::int64_t n_ = 0, last_ = -1; // active ticks this segment; the last active tick
  Moments m_[kBases] = {};
  double m3z_[tdp_tables::kStatSkewN] = {}, skew_[tdp_tables::kStatSkewN] = {};
  double prev_[tdp_tables::kStatSpeedN] = {}, speedZ_[tdp_tables::kStatSpeedN] = {},
         speed_[tdp_tables::kStatSpeedN] = {};
  double hi_[tdp_tables::kStatRangeN] = {}, lo_[tdp_tables::kStatRangeN] = {};
  double q_[tdp_tables::kStatQuantN] = {};
  double xcZ_[tdp_tables::kStatXcorrN] = {}, xcorr_[tdp_tables::kStatXcorrN] = {};
  double stZ_ = 0.0, loudEZ_[kLoudBins] = {}, loudE_[kLoudBins] = {}, loudCZ_[kLoudBins] = {},
         loudC_[kLoudBins] = {};
  double out_[kCols] = {};
};

} // namespace effetune::plugins::analyzer::rhythm_a3
