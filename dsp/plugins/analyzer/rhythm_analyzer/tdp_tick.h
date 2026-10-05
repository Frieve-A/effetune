// The tick stage of the TD tempo prior (rd5 fx base_features): per tick k (frames 4k .. 4k+3) the
// Parseval-scaled power spectrum P (bins 1 .. 341, power-pooled over the tick's 4 frames), the
// activity gate (tick mean square above -200 dBFS and within 50 dB of its 20 s decaying max) and
// eps0, the -80 dB floor relative to the 20 s decaying max of the total power. Everything is
// float64 in numpy's order of operations; the decaying maxima use fx's log-domain form with the
// tick index counted from reset() or the last cold-reset restart. Real-time safe: fixed-size
// members only, no allocation, no exceptions, no locks.
#pragma once
#include <cstdint>

#include "decaying_max.h"
#include "portable_math.h"
#include "rhythm_d_tables.h"
#include "tc_v0.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class TdpTick {
public:
  static constexpr std::uint32_t kBins = TcV0::kBins; // 341

  // size: the analysis frame size (1024, 2048 or 4096); the caller resets afterwards.
  void prepare(std::uint32_t size) noexcept {
    parseval_ = size == 1024u   ? rhythm_d::kParseval1024
                : size == 2048u ? rhythm_d::kParseval2048
                                : rhythm_d::kParseval4096;
  }

  void reset() noexcept {
    frame_ = 0u;
    n_ = 0;
    maxMs_.reset();
    maxSum_.reset();
    active_ = false;
    eps0_ = 0.0;
    for (std::uint32_t b = 0u; b < kBins; ++b)
      power_[b] = 0.0;
  }

  // Frame j's spectrum, magnitude[k - 1] = |X_k| for k in [1, 342) (TcFrontEnd::pushFrame).
  void pushFrame(const double *magnitude) noexcept {
    double *slot = pool_[frame_ & 3u];
    for (std::uint32_t b = 0u; b < kBins; ++b)
      slot[b] = magnitude[b] * magnitude[b];
    ++frame_;
  }

  // Tick v0.k, after its 4 frames were pushed. A restart starts the decaying maxima afresh.
  void tick(const TcTickV0 &v0, bool restart) noexcept {
    using tc_detail::log10x10;
    if (restart)
      n_ = 0;
    for (std::uint32_t b = 0u; b < kBins; ++b)
      power_[b] = ((((pool_[0][b] + pool_[1][b]) + pool_[2][b]) + pool_[3][b]) / 4.0) * parseval_;
    const double ms = v0.ms64;
    const double maxMs =
        rhythm_d::portableExp(maxMs_.update(rhythm_d::portableLog(ms + kTiny), n_));
    const double maxSum = rhythm_d::portableExp(
        maxSum_.update(rhythm_d::portableLog(tc_detail::npSum(power_, kBins) + kTiny), n_));
    active_ = ms > kAbsMs && log10x10(ms + kTiny) > log10x10(maxMs) - kGateDb;
    eps0_ = (kRelEps * maxSum) / static_cast<double>(kBins);
    ++n_;
  }

  const double *power() const noexcept { return power_; }
  bool active() const noexcept { return active_; }
  double eps0() const noexcept { return eps0_; }

private:
  // Keep eps0 and its mel-weighted floors normal under native FTZ/DAZ during digital silence.
  // This remains far below any nonzero float32 spectrum or the activity gate.
  static constexpr double kTiny = 1e-280;
  static constexpr double kAbsMs = 1e-20; // fx ABS_MS
  static constexpr double kGateDb = 50.0; // fx GATE_DB
  static constexpr double kRelEps = 1e-8; // fx REL_EPS

  double parseval_ = 0.0;
  double pool_[4][kBins] = {};
  double power_[kBins] = {};
  std::uint32_t frame_ = 0u;
  std::int64_t n_ = 0;
  DecayingLogMax maxMs_, maxSum_;
  bool active_ = false;
  double eps0_ = 0.0;
};

} // namespace effetune::plugins::analyzer::rhythm_a3
