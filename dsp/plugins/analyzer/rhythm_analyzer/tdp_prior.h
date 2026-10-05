// The TD tempo prior's per-tick chain inside TcFrontEnd: frame spectra feed the tick stage
// (tdp_tick.h: P, gate, eps0); each completed tick then runs the base-feature stages in order and
// the statistics bank over their concatenation, and the TCN beat activation feeds the ACF stage.
// Once per second of ticks since the reset (a row tick) the model's used-feature row is gathered:
// the statistics rounded to binary16 as the training features were stored (saturating at the
// binary16 maximum as the export clipped them) and the ACF values, and the model (tdp_trees.h)
// turns it into the prior once 2 active ticks were seen since the reset. The tonal stage reads G2's
// chroma (setChroma). A cold-reset restart starts every stage's history and the prior afresh at
// that tick, unless no tick passed the statistics gate since the reset or the last restart (leading
// digital silence): then the prior continues, as fx computes such a track continuously.
// Real-time safe: fixed-size members only, no allocation, no exceptions, no locks.
#pragma once
#include <cstdint>

#include "rhythm_d.h"
#include "tc_v0.h"
#include "tdp_acf.h"
#include "tdp_spectral.h"
#include "tdp_stats.h"
#include "tdp_temporal.h"
#include "tdp_tick.h"
#include "tdp_tonal.h"
#include "tdp_trees.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class TdpPrior {
public:
  // size: the analysis frame size; the caller resets afterwards.
  void prepare(std::uint32_t size) noexcept { tick_.prepare(size); }

  void reset() noexcept {
    tick_.reset();
    spectral_.reset();
    temporal_.reset();
    tonal_.reset();
    stats_.reset();
    acf_.reset();
    startRows();
  }

  // The chroma source of the tonal stage (A3Clock's G2Chroma, fed ahead of the ticks).
  void setChroma(const G2Chroma *chroma) noexcept { chroma_ = chroma; }

  void pushFrame(const double *magnitude) noexcept { tick_.pushFrame(magnitude); }

  // Tick v0.k, after its 4 frames were pushed; act: its TCN softmax (beat, off, none).
  void tick(const TcTickV0 &v0, const float *act) noexcept {
    const bool restart = v0.restart && stats_.activeTicks() > 0;
    tick_.tick(v0, restart);
    spectral_.tick(tick_.power(), tick_.eps0(), restart);
    temporal_.tick(tick_.power(), tick_.eps0(), spectral_.melPower(), spectral_.logPower(),
                   tick_.active(), restart);
    tonal_.tick(v0.k, chroma_, restart);
    // Base vector: spectral (with hf_limit), tonal, temporal (tdp_tables::kStatBases).
    double *b = base_;
    for (std::uint32_t i = 0u; i < TdpSpectral::kFeatures; ++i)
      *b++ = spectral_.features()[i];
    for (std::uint32_t i = 0u; i < TdpTonal::kFeatures; ++i)
      *b++ = tonal_.features()[i];
    for (std::uint32_t i = 0u; i < TdpTemporal::kFeatures; ++i)
      *b++ = temporal_.features()[i];
    stats_.tick(v0.k, base_, temporal_.shortTermDb(), tick_.active() && tonal_.ready(), restart);
    acf_.push(act, restart);
    if (restart)
      startRows();
    ++ticks_;
    rowTick_ = ticks_ == nextRow_ * tdp_tables::kRowTicksNum / tdp_tables::kRowTicksDen;
    if (rowTick_) {
      ++nextRow_;
      gatherRow();
      ready_ = stats_.activeTicks() >= 2;
      if (ready_)
        trees_.evaluate(row_);
    }
  }

  // Whether the last tick was a row tick; row(): the model's used features at the last row tick.
  bool rowTick() const noexcept { return rowTick_; }
  const float *row() const noexcept { return row_; }
  // Whether the last row had 2 active ticks since the reset; only then p() and grid() hold the
  // prior of that row (the calibrated class probabilities and the grid row), otherwise both are 0.
  bool ready() const noexcept { return ready_; }
  const double *p() const noexcept { return trees_.p(); }
  const float *grid() const noexcept { return trees_.grid(); }

  const TdpTick &tickStage() const noexcept { return tick_; }
  const TdpSpectral &spectral() const noexcept { return spectral_; }
  const TdpTemporal &temporal() const noexcept { return temporal_; }
  const TdpTonal &tonal() const noexcept { return tonal_; }
  const TdpStats &stats() const noexcept { return stats_; }
  const TdpAcf &acf() const noexcept { return acf_; }

private:
  // numpy astype(float16) of a float64 feature, then the export's clip to the binary16 maximum.
  static float storedFeature(double v) noexcept {
    constexpr double kHalfMax = 65504.0;
    const double h = rhythm_d::roundHalf(v);
    return static_cast<float>(h > kHalfMax ? kHalfMax : h < -kHalfMax ? -kHalfMax : h);
  }

  // The row cadence and the prior start afresh (a reset, or a restart after its stages took it).
  void startRows() noexcept {
    trees_.reset();
    ticks_ = 0u;
    nextRow_ = 1u;
    rowTick_ = ready_ = false;
  }

  void gatherRow() noexcept {
    const double *s = stats_.features();
    for (std::uint32_t c = 0u; c < TdpStats::kCols; ++c)
      row_[tdp_tables::kStatUsed[c]] = storedFeature(s[c]);
    acf_.evaluate();
    for (std::uint32_t a = 0u; a < tdp_tables::kAcfCols; ++a)
      row_[tdp_tables::kAcfUsed[a]] = acf_.values()[tdp_tables::kAcfSlot[a]];
  }

  TdpTick tick_;
  TdpSpectral spectral_;
  TdpTemporal temporal_;
  TdpTonal tonal_;
  TdpStats stats_;
  TdpAcf acf_;
  TdpTrees trees_;
  static_assert(TdpStats::kCols + tdp_tables::kAcfCols == tdp_tables::kUsedCols);
  static_assert(static_cast<std::uint32_t>(TdpSpectral::kFeatures) + TdpTonal::kFeatures +
                    TdpTemporal::kFeatures ==
                TdpStats::kBases);
  double base_[TdpStats::kBases] = {};
  float row_[tdp_tables::kUsedCols] = {};
  std::uint64_t ticks_ = 0u, nextRow_ = 1u; // ticks since the reset; the next row's number
  bool rowTick_ = false, ready_ = false;
  const G2Chroma *chroma_ = nullptr;
};

} // namespace effetune::plugins::analyzer::rhythm_a3
