// The TD tempo prior's autocorrelation columns (rd5 u5a_diag act_acf): the TCN beat activation b =
// beat + off of each tick's softmax, and at a prior row its normalised autocorrelation over the
// trailing kAcfWin ticks (fewer right after a reset) at the 27 class-centre beat periods, linearly
// interpolated between the integer lags. Sums follow numpy's pairwise order, so the float64 values
// match the reference bit for bit before the cast to float32. Real-time safe: fixed-size members
// only, no allocation; the O(window x classes) work runs once per row (1 Hz).
#pragma once
#include <cstdint>

#include "tc_v0.h"
#include "tdp_tables.generated.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class TdpAcf {
public:
  static constexpr std::uint32_t kValues = tdp_tables::kAcfWindows * tdp_tables::kAcfClasses,
                                 kLen = tdp_tables::kAcfWin[tdp_tables::kAcfWindows - 1u];

  void reset() noexcept { head_ = count_ = 0u; }

  // act: the tick's TCN softmax (beat, off, none). A restart starts the history afresh.
  void push(const float *act, bool restart) noexcept {
    if (restart)
      reset();
    ring_[head_] = static_cast<double>(act[0]) + act[1];
    head_ = head_ + 1u == kLen ? 0u : head_ + 1u;
    count_ += count_ < kLen ? 1u : 0u;
  }

  // The autocorrelations over the windows ending at the last pushed tick, as w * kAcfClasses +
  // class (tdp_tables::kAcfSlot).
  void evaluate() noexcept {
    for (std::uint32_t w = 0u; w < tdp_tables::kAcfWindows; ++w) {
      const std::uint32_t n = count_ < tdp_tables::kAcfWin[w] ? count_ : tdp_tables::kAcfWin[w];
      std::uint32_t r = head_ >= n ? head_ - n : head_ + kLen - n;
      for (std::uint32_t i = 0u; i < n; ++i) {
        seg_[i] = ring_[r];
        r = r + 1u == kLen ? 0u : r + 1u;
      }
      const double mean = tc_detail::npSum(seg_, n) / static_cast<double>(n);
      for (std::uint32_t i = 0u; i < n; ++i) {
        seg_[i] -= mean;
        prod_[i] = seg_[i] * seg_[i];
      }
      const double e = tc_detail::npSum(prod_, n) + 1e-9;
      float *v = values_ + w * tdp_tables::kAcfClasses;
      for (std::uint32_t j = 0u; j < tdp_tables::kAcfClasses; ++j) {
        const std::uint32_t lag = tdp_tables::kAcfLagI[j];
        if (lag + 1u >= n) {
          v[j] = 0.0f;
          continue;
        }
        const double a0 = lagSum(lag, n), a1 = lagSum(lag + 1u, n);
        const double fr = tdp_tables::kAcfLagF[j];
        v[j] = static_cast<float>(((1.0 - fr) * a0 + fr * a1) / e);
      }
    }
  }

  const float *values() const noexcept { return values_; }

private:
  // sum_i seg[lag + i] seg[i] over the n - lag overlapping values.
  double lagSum(std::uint32_t lag, std::uint32_t n) noexcept {
    for (std::uint32_t i = 0u; i + lag < n; ++i)
      prod_[i] = seg_[lag + i] * seg_[i];
    return tc_detail::npSum(prod_, n - lag);
  }

  double ring_[kLen] = {};
  double seg_[kLen] = {}, prod_[kLen] = {};
  float values_[kValues] = {};
  std::uint32_t head_ = 0u, count_ = 0u;
};

} // namespace effetune::plugins::analyzer::rhythm_a3
