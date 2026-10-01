// tcn_g's 18 base channels, streaming.
// The reference input and base-channel expressions evaluated per tick in float64 with the same
// operation order: the batch recursions (np.maximum.accumulate, np.minimum.accumulate, scipy
// lfilter DF2T with and without zi, previous()) become running state. Output rounding as the
// reference: float64 -> float32 (base_channels)
// -> float16 (base.astype(f16)), the value held as float. numpy's log/exp/log10/power are replaced
// by the portable functions (ulp level, native = WASM).
#pragma once
#include <cmath>
#include <cstdint>
#include <limits>

#include "portable_math.h"
#include "rhythm_d.h"
#include "tc_constants.h"
#include "tc_v0.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class TcBase {
public:
  // Order = tcn_g provenance `inputs`: r_L r_M r_H, z_*, lr_*, ld_*, lf_*, bal_LM, bal_HM, flat.
  static constexpr std::uint32_t kChannels = 18u;

  TcBase() noexcept { reset(); }

  void reset() noexcept {
    k_ = 0;
    for (std::uint32_t c = 0u; c < 3u; ++c) {
      peakM_[c] = -std::numeric_limits<double>::infinity();
      peak_[c] = tc::kG1PeakFloor;
      mean_[c] = meanZ_[c] = var_[c] = varZ_[c] = 0.0;
      ema_[c] = emaZ_[c] = e_[c] = 0.0;
      floorM_[c] = std::numeric_limits<double>::infinity();
    }
  }

  // Tick k's v0 fields (ticks in order from k = 0). out64: the float64 channels; out: after f64 ->
  // f32 -> f16.
  void push(const TcTickV0 &tick, double out64[kChannels], float out[kChannels]) noexcept {
    using tc::kG1PeakLd;
    const double kd = static_cast<double>(k_);
    double e[3];
    for (std::uint32_t c = 0u; c < 3u; ++c) {
      // Inputs: the tick's four f16 frame fluxes averaged in float32, then float64 (base_channels).
      const float s = ((tick.flux[0][c] + tick.flux[1][c]) + tick.flux[2][c]) + tick.flux[3][c];
      const double f = static_cast<double>(s / 4.0f);
      // r: peak_prev = d * previous(decaying_peak(f, PEAK_TAU, PEAK_FLOOR), PEAK_FLOOR).
      const double peakPrev = tc::kG1PeakD * peak_[c];
      out64[c] = f / (peakPrev > tc::kG1PeakFloor ? peakPrev : tc::kG1PeakFloor);
      const double lf = rhythm_d::portableLog(f > tc::kG1PeakLogFloor ? f : tc::kG1PeakLogFloor);
      const double x = lf - kd * kG1PeakLd;
      peakM_[c] = x > peakM_[c] ? x : peakM_[c];
      peak_[c] = rhythm_d::portableExp((peakM_[c] > tc::kG1PeakInit ? peakM_[c] : tc::kG1PeakInit) +
                                       kd * kG1PeakLd);
      // zsc: dm = f - previous(mean, 0); zsc = dm / (sqrt(previous(var, 0)) + SD_FLOOR); lfilter
      // DF2T.
      const double dm = f - mean_[c];
      out64[3u + c] = dm / (std::sqrt(var_[c]) + tc::kG1SdFloor);
      mean_[c] = meanZ_[c] + tc::kG1MeanA * f;
      meanZ_[c] = f * 0.0 - mean_[c] * tc::kG1MeanA1;
      const double q = dm * dm;
      var_[c] = varZ_[c] + tc::kG1VarB0 * q;
      varZ_[c] = q * 0.0 - var_[c] * tc::kG1MeanA1;
      // e = 10 loge, loge = log10(10 ** (band_db / 10 + LOGE_C) + LOGE_FLOOR).
      const double power = rhythm_d::portableDecadePower(
          static_cast<double>(tick.bandDb[c]) / 10.0 + tc::kG1LogeC[c]);
      e[c] = 10.0 * (rhythm_d::portableLog(power + tc::kG1LogeFloor) / 2.30258509299404568402);
      // lr = e - previous(ema(e, LEVEL_TAU), e_0); ema: lfilter DF2T with zi = (1 - a) e_0.
      if (k_ == 0) {
        ema_[c] = e[c];
        emaZ_[c] = tc::kG1EmaZi * e[c];
        e_[c] = e[c];
      }
      out64[6u + c] = e[c] - ema_[c];
      ema_[c] = emaZ_[c] + tc::kG1EmaA * e[c];
      emaZ_[c] = e[c] * 0.0 - ema_[c] * tc::kG1EmaA1;
      // ld = e - previous(e, e_0).
      out64[9u + c] = e[c] - e_[c];
      e_[c] = e[c];
      // lf = e - (minimum.accumulate(e - rise) + rise), rise = (FLOOR_RISE DT) k.
      const double rise = tc::kG1RiseC * kd;
      const double lowered = e[c] - rise;
      floorM_[c] = lowered < floorM_[c] ? lowered : floorM_[c];
      out64[12u + c] = e[c] - (floorM_[c] + rise);
    }
    out64[15] = e[0] - e[1];
    out64[16] = e[2] - e[1];
    out64[17] = static_cast<double>(tick.flat);
    for (std::uint32_t i = 0u; i < kChannels; ++i)
      out[i] = static_cast<float>(
          rhythm_d::roundHalf(static_cast<double>(static_cast<float>(out64[i]))));
    ++k_;
  }

private:
  std::int64_t k_ = 0;
  // peak_: decaying_peak p_{k-1} (PEAK_FLOOR before the first tick); peakM_: its running log-domain
  // maximum.
  double peakM_[3] = {}, peak_[3] = {};
  // mean_/var_: the lfilter outputs of the previous tick (0 before the first); *Z_: their DF2T
  // states.
  double mean_[3] = {}, meanZ_[3] = {}, var_[3] = {}, varZ_[3] = {};
  // ema_: ema(e) of the previous tick (e_0 before the first); e_: e of the previous tick; floorM_:
  // running minimum.
  double ema_[3] = {}, emaZ_[3] = {}, e_[3] = {}, floorM_[3] = {};
};

} // namespace effetune::plugins::analyzer::rhythm_a3
