// The tonal base features of the TD tempo prior (rd5 fx g_tonal, without the tuning pair): per G2
// chroma frame (12 kHz, Hann 4096, hop 1024, 80 Hz - 4 kHz; G2Chroma's linear taps) the chroma
// normalised with a -80 dB floor relative to the 20-frame-tau decaying max of the frame power, its
// clarity and entropy, tonnetz, key strength, major/minor, chord correlation and chord change.
// Timing: fx holds frame j from tick 8 (j + 1) - 1 on, NaN before the first frame. Tick k ends at
// analysis sample 512 (k + 1) (48 kHz) and G2Chroma completes frame j after 4096 (j + 1) + 37
// samples (decimator look-ahead); the kernel runs a tick's runTick one hop after the tick's last
// frame, by which time G2 has the hop's 128 further samples, so frame (k + 1) / 8 - 1 is G2's
// latest frame when tick k = 8 (j + 1) - 1 runs (likewise at 96 and 192 kHz). A cold-reset
// restart (a multiple of 8 ticks) starts afresh, as fx does per segment. Real-time safe:
// fixed-size members only, no allocation.
#pragma once
#include <cmath>
#include <cstdint>
#include <limits>

#include "g2_chroma.h"
#include "portable_math.h"
#include "tc_v0.h"
#include "tdp_tables.generated.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

class TdpTonal {
public:
  static constexpr std::uint32_t kClasses = 12u, kTemplates = 24u, kTicksPerFrame = 8u;
  // Feature order: fx g_tonal's names.
  enum Feature : std::uint32_t {
    kChroma0 = 0u, // chroma00 .. chroma11
    kClarity = kChroma0 + kClasses,
    kEntropy,
    kTonnetz0, // tonnetz0 .. tonnetz5
    kKeyStrength = kTonnetz0 + 6u,
    kMajorMinor,
    kChordCorr,
    kChordChange,
    kFeatures
  };

  void reset() noexcept {
    for (double &v : f_)
      v = std::numeric_limits<double>::quiet_NaN();
    frames_ = 0;
    logMax_ = 0.0;
    best_ = -1;
  }

  // Tick k (counted from reset, like G2Chroma's frames); chroma is null when no G2 is attached.
  void tick(std::int64_t k, const G2Chroma *chroma, bool restart) noexcept {
    if (restart)
      reset();
    if (chroma != nullptr && (k + 1) % kTicksPerFrame == 0 &&
        chroma->frames() == (k + 1) / kTicksPerFrame)
      frame(chroma->power(), chroma->classPower());
  }

  // The held values (NaN before the segment's first frame).
  const double *features() const noexcept { return f_; }
  // A frame was taken this segment (the features are defined).
  bool ready() const noexcept { return frames_ > 0; }

private:
  static constexpr double kTiny = 1e-300;
  static constexpr double kRelEps = 1e-8;                    // fx REL_EPS
  static constexpr double kLogDecay = (1.0 / 93.75) / 160.0; // fx DT / tau per frame, tau = 160

  // One frame: power of G2's chroma bins and its per-class sums (both scaled by G2's norm squared,
  // which cancels in the normalised chroma).
  void frame(const double *power, const double *classPower) noexcept {
    using tc_detail::npSum;
    const double shift = static_cast<double>(frames_) * kLogDecay;
    const double lx = rhythm_d::portableLog(npSum(power, G2Chroma::kBins) + kTiny) + shift;
    logMax_ = frames_ == 0 || lx > logMax_ ? lx : logMax_;
    const double peak = rhythm_d::portableExp(logMax_ - shift);
    // Scale the same normalization by its peak when the per-class floor would be subnormal.
    // The kTiny power floor keeps peak normal even during leading digital silence.
    const bool rescale = peak < std::numeric_limits<double>::min() * (12.0 / kRelEps);
    const double eps = kRelEps * (rescale ? 1.0 : peak);
    ++frames_;

    double ch[kClasses], t[kClasses], cz[kClasses];
    for (std::uint32_t i = 0u; i < kClasses; ++i)
      ch[i] = (rescale ? classPower[i] / peak : classPower[i]) + eps / 12.0;
    const double sum = npSum(ch, kClasses);
    double *c = f_ + kChroma0;
    for (std::uint32_t i = 0u; i < kClasses; ++i)
      c[i] = ch[i] / sum;
    double clarity = c[0];
    for (std::uint32_t i = 1u; i < kClasses; ++i)
      clarity = c[i] > clarity ? c[i] : clarity;
    f_[kClarity] = clarity;
    for (std::uint32_t i = 0u; i < kClasses; ++i)
      t[i] = c[i] * rhythm_d::portableLog(c[i]);
    f_[kEntropy] = -npSum(t, kClasses) / tdp_tables::kLog12;
    for (std::uint32_t r = 0u; r < 6u; ++r)
      f_[kTonnetz0 + r] = dot(c, tdp_tables::kTonnetz[r]);

    const double mean = npSum(c, kClasses) / 12.0;
    for (std::uint32_t i = 0u; i < kClasses; ++i) {
      cz[i] = c[i] - mean;
      t[i] = cz[i] * cz[i];
    }
    const double norm = std::sqrt(npSum(t, kClasses)) + 1e-12;
    for (std::uint32_t i = 0u; i < kClasses; ++i)
      cz[i] = cz[i] / norm;
    double major = dot(cz, tdp_tables::kKeys[0]), minor = dot(cz, tdp_tables::kKeys[12]);
    for (std::uint32_t i = 1u; i < 12u; ++i) {
      const double a = dot(cz, tdp_tables::kKeys[i]), b = dot(cz, tdp_tables::kKeys[12u + i]);
      major = a > major ? a : major;
      minor = b > minor ? b : minor;
    }
    f_[kKeyStrength] = minor > major ? minor : major;
    f_[kMajorMinor] = major - minor;
    int best = 0;
    double corr = dot(cz, tdp_tables::kChords[0]);
    for (std::uint32_t i = 1u; i < kTemplates; ++i) {
      const double v = dot(cz, tdp_tables::kChords[i]);
      if (v > corr) { // first maximum, as argmax
        corr = v;
        best = static_cast<int>(i);
      }
    }
    f_[kChordCorr] = corr;
    f_[kChordChange] = best_ >= 0 && best != best_ ? 1.0 : 0.0;
    best_ = best;
  }

  static double dot(const double *x, const double *row) noexcept {
    double acc = 0.0;
    for (std::uint32_t i = 0u; i < kClasses; ++i)
      acc += x[i] * row[i];
    return acc;
  }

  double f_[kFeatures] = {};
  std::int64_t frames_ = 0;
  double logMax_ = 0.0;
  int best_ = -1;
};

} // namespace effetune::plugins::analyzer::rhythm_a3
