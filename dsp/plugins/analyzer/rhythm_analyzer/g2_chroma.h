// Streaming, causal chroma of the A3 front end at 48, 96 or 192 kHz analysis rate.
//
// Decimation to 12 kHz: scipy resample_poly (up 1, down d = 4/8/16, Kaiser 5.0, 20d + 1 taps) as
// its upfirdn loop computes it: x12[m] = sum over k = 20d .. 0 of h[k] x[d m + 10 d - k], float64,
// oldest sample first, the running sum starting at 0.0; zeros before the stream start; stored as
// float32. Frame j = x12[(j + 1) 1024 - 4096 .. (j + 1) 1024 - 1] (zeros before the start); float32
// window product (periodic Hann), float64 real FFT (rhythm_d radix-2), power (norm |X|)^2 of
// bins 28..1365 (80 Hz - 4 kHz), summed per pitch class in OpenBLAS dgemm's K-block order ([128 x9,
// 96, 90], running sums restarted per block, block sums added in order), log10(power + 1e-10),
// rounded to binary16 (nearest even) from float64. Frame j is complete after d 1024 (j + 1) + 9 d +
// 1 analysis samples (decimator look-ahead 10 d input samples).
#pragma once
#include <cstdint>

#include "g2_math.h"
#include "g2_tables.generated.h"
#include "rhythm_d.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class G2Chroma {
public:
  static constexpr std::uint32_t kN = 4096u, kHop = 1024u, kClasses = 12u;
  static constexpr std::uint32_t kBinLo = static_cast<std::uint32_t>(g2_tables::kChromaBinLo);
  static constexpr std::uint32_t kBins = static_cast<std::uint32_t>(g2_tables::kChromaBinCount);

  // rate in {48000, 96000, 192000}; false otherwise.
  bool prepare(int rate) noexcept {
    switch (rate) {
    case 48000:
      down_ = 4u;
      taps_ = g2_tables::kDecimTaps4;
      break;
    case 96000:
      down_ = 8u;
      taps_ = g2_tables::kDecimTaps8;
      break;
    case 192000:
      down_ = 16u;
      taps_ = g2_tables::kDecimTaps16;
      break;
    default:
      return false;
    }
    static_cast<void>(rhythm_d::fftTables());
    reset();
    return true;
  }

  void reset() noexcept {
    for (float &v : in_)
      v = 0.0f;
    for (float &v : x12_)
      v = 0.0f;
    inPos_ = 0u;
    inCount_ = 0u;
    x12Count_ = 0u;
    frames_ = 0;
    for (std::uint32_t c = 0u; c < kClasses; ++c)
      log10_[c] = chroma_[c] = 0.0;
    for (std::uint32_t c = 0u; c < kClasses; ++c)
      classPower_[c] = 0.0;
  }

  // One analysis-rate sample; true when chroma frame frames() - 1 has just completed.
  bool sample(float x) noexcept {
    in_[inPos_] = x;
    in_[inPos_ + kInRing] = x;
    inPos_ = (inPos_ + 1u) & (kInRing - 1u);
    ++inCount_;
    const std::uint64_t look = 10u * down_;
    if (inCount_ <= look || (inCount_ - look - 1u) % down_ != 0u)
      return false;
    // Newest sample at in_[inPos_ - 1 + kInRing]; the 20d + 1 taps end there, oldest first.
    const std::uint32_t taps = 20u * down_ + 1u;
    const float *w = in_ + (inPos_ + kInRing - taps);
    double sum = 0.0;
    for (std::uint32_t i = 0u; i < taps; ++i)
      sum += taps_[taps - 1u - i] * static_cast<double>(w[i]);
    x12_[x12Count_ & (kN - 1u)] = static_cast<float>(sum);
    ++x12Count_;
    if (x12Count_ % kHop != 0u)
      return false;
    frame();
    return true;
  }

  [[nodiscard]] std::int64_t frames() const noexcept { return frames_; }
  // Last completed frame: binary16-rounded values (as float64) and the float64 values before
  // rounding.
  [[nodiscard]] const double *chroma() const noexcept { return chroma_; }
  [[nodiscard]] const double *log10Values() const noexcept { return log10_; }
  [[nodiscard]] std::uint32_t down() const noexcept { return down_; }
  // Linear taps of the last completed frame (the TD prior's tonal stage): the power of bins
  // kBinLo .. kBinLo + kBins - 1 and the per-class sums before the floor and log10.
  [[nodiscard]] const double *power() const noexcept { return power_; }
  [[nodiscard]] const double *classPower() const noexcept { return classPower_; }

private:
  static constexpr std::uint32_t kInRing =
      512u; // >= 321 taps; mirrored so every window is contiguous

  void frame() noexcept {
    const std::uint64_t first =
        x12Count_ - kN; // wraps before the start: the ring holds zeros there
    const float *hann = rhythm_d::fftTables().hann;
    for (std::uint32_t n = 0u; n < kN / 2u; ++n) {
      re_[n] = static_cast<double>(x12_[(first + 2u * n) & (kN - 1u)] * hann[2u * n]);
      im_[n] = static_cast<double>(x12_[(first + 2u * n + 1u) & (kN - 1u)] * hann[2u * n + 1u]);
    }
    rhythm_d::complexFft(re_, im_, kN / 2u);
    for (std::uint32_t k = 0u; k < kBins; ++k) {
      const rhythm_d::Bin b = rhythm_d::realBin(re_, im_, kN / 2u, kBinLo + k);
      const double a = g2_tables::kChromaNorm * std::sqrt(b.re * b.re + b.im * b.im);
      power_[k] = a * a;
    }
    double out[kClasses] = {};
    std::uint32_t k = 0u;
    for (const int blockSize : g2_tables::kChromaSumBlocks) {
      double part[kClasses] = {};
      for (const std::uint32_t end = k + static_cast<std::uint32_t>(blockSize); k < end; ++k)
        part[g2_tables::kChromaPc[k]] += power_[k];
      for (std::uint32_t c = 0u; c < kClasses; ++c)
        out[c] += part[c];
    }
    for (std::uint32_t c = 0u; c < kClasses; ++c) {
      classPower_[c] = out[c];
      log10_[c] = g2m::log10(out[c] + g2_tables::kChromaFloor);
      chroma_[c] = rhythm_d::roundHalf(log10_[c]);
    }
    ++frames_;
  }

  const double *taps_ = g2_tables::kDecimTaps4;
  std::uint32_t down_ = 4u;
  float in_[2u * kInRing] = {};
  std::uint32_t inPos_ = 0u;
  std::uint64_t inCount_ = 0u;
  float x12_[kN] = {};
  std::uint64_t x12Count_ = 0u;
  std::int64_t frames_ = 0;
  double re_[kN / 2u] = {};
  double im_[kN / 2u] = {};
  double power_[kBins] = {};
  double log10_[kClasses] = {};
  double chroma_[kClasses] = {};
  double classPower_[kClasses] = {};
};

} // namespace effetune::plugins::analyzer::rhythm_a3
