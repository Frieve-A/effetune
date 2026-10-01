// The v0 accumulator of the A3 front end.
// Per analysis frame it computes, from the deterministic spectrum |X_k| (k in [1, 342)), exactly
// what the reference front end stores: the band flux, the band events of the production picker and,
// per tick of 4 frames, env (running statistics, novelty and pool mean), band_db, lvl, flat and
// rms_db. Everything is float64 in numpy's own order of operations (pairwise sums, DF2T lfilter,
// the log-domain running peak) and rounded once where the reference stores the field (float16 or
// float32). Real-time safe after prepare(): fixed-size members only, no allocation, no exceptions,
// no locks.
#pragma once
#include <cmath>
#include <cstdint>
#include <limits>

#include "portable_math.h"
#include "rhythm_d.h"
#include "rhythm_d_tables.h"
#include "tc_constants.h"

namespace effetune::plugins::analyzer::rhythm_a3 {

// One analysis frame; frame j ends at analysis-stream sample (j + 1) hop.
struct TcFrame {
  std::int64_t j = 0;
  float flux[3] = {};    // v0 flux: binary16 value (f64 -> f16)
  double flux64[3] = {}; // the same before rounding (diagnostics)
};

// One band event of the production picker.
struct TcEvent {
  double t = 0.0;         // ev_t: onset (s), interpolation and kernel bias included
  double avail = 0.0;     // ev_avail = (frame + 2) hop / rate
  float strength = 0.0f;  // ev_strength = candidate / peak (f64 -> f32)
  std::int32_t frame = 0; // ev_frame: the candidate frame (the detecting frame - 1)
  std::uint8_t band = 0;  // ev_band
};

// The v0 fields of tick k (frames 4k .. 4k+3): binary16 values in float, env float32, plus float64
// values before rounding (diagnostics) and the tick's frame fluxes (binary16 values), tcn_g's flux
// input.
struct TcTickV0 {
  std::int64_t k = 0;
  float env = 0.0f, bandDb[3] = {}, rmsDb = 0.0f, lvl[3] = {}, flat = 0.0f;
  float flux[4][3] = {};
  double env64 = 0.0, bandDb64[3] = {}, rmsDb64 = 0.0, lvl64[3] = {}, flat64 = 0.0;
};

namespace tc_detail {

// numpy's pairwise_sum (numpy/_core/src/umath/loops_utils.h): sequential below 8, eight
// accumulators up to 128, otherwise split at n / 2 rounded down to a multiple of 8. Depth <= 3 for
// n <= 1024.
inline double pairwise(const double *a, std::uint32_t n) noexcept {
  if (n < 8u) {
    double res = -0.0;
    for (std::uint32_t i = 0u; i < n; ++i)
      res += a[i];
    return res;
  }
  if (n <= 128u) {
    double r0 = a[0], r1 = a[1], r2 = a[2], r3 = a[3], r4 = a[4], r5 = a[5], r6 = a[6], r7 = a[7];
    std::uint32_t i = 8u;
    for (; i < n - n % 8u; i += 8u) {
      r0 += a[i];
      r1 += a[i + 1u];
      r2 += a[i + 2u];
      r3 += a[i + 3u];
      r4 += a[i + 4u];
      r5 += a[i + 5u];
      r6 += a[i + 6u];
      r7 += a[i + 7u];
    }
    double res = ((r0 + r1) + (r2 + r3)) + ((r4 + r5) + (r6 + r7));
    for (; i < n; ++i)
      res += a[i];
    return res;
  }
  std::uint32_t n2 = n / 2u;
  n2 -= n2 % 8u;
  return pairwise(a, n2) + pairwise(a + n2, n - n2);
}

// np.add.reduce over a contiguous row (verified against numpy when the constants are generated).
inline double npSum(const double *a, std::uint32_t n) noexcept { return 0.0 + pairwise(a, n); }

// fe pool_mean over one tick's 4 values.
inline double npPool4(const double *r) noexcept { return (((r[0] + r[1]) + r[2]) + r[3]) / 4.0; }

// 10 log10(v), the lanes' formula (rhythm_d.h Detector::log10x10).
inline double log10x10(double v) noexcept {
  return 10.0 * (rhythm_d::portableLog(v) / 2.30258509299404568402);
}

} // namespace tc_detail

class TcV0 {
public:
  static constexpr std::uint32_t kBins = tc::kBinHi - tc::kBinLo; // 341
  static constexpr std::uint32_t kBlock = 128u;                   // numpy's pairwise block

  // rate: 48000, 96000 or 192000. Returns false otherwise.
  bool prepare(double rate) noexcept {
    rc_ = nullptr;
    for (const tc::RateConstants &r : tc::kRates)
      if (r.rate == rate)
        rc_ = &r;
    if (rc_ == nullptr)
      return false;
    norm_ = rc_->size == 1024u   ? rhythm_d::kNorm1024
            : rc_->size == 2048u ? rhythm_d::kNorm2048
                                 : rhythm_d::kNorm4096;
    parseval_ = rc_->size == 1024u   ? rhythm_d::kParseval1024
                : rc_->size == 2048u ? rhythm_d::kParseval2048
                                     : rhythm_d::kParseval4096;
    reset();
    return true;
  }

  void reset() noexcept {
    for (std::uint32_t c = 0u; c < 3u; ++c) {
      Pick &p = pick_[c];
      p.h0 = p.h1 = p.h2 = 0.0;
      for (double &r : p.ring)
        r = 0.0;
      p.mean = p.var = 0.0;
      p.peak = tc::kFePeakStart;
      p.last = -1.0;
      meanZ_[c] = 0.0;
      peakM_[c] = -std::numeric_limits<double>::infinity(); // np.maximum.accumulate starts at the
                                                            // first value
    }
    for (auto &row : y_)
      for (double &v : row)
        v = 0.0;
    cur_ = 0u;
    frame_ = 0;
    hop_ = 0;
    blockFill_ = 0u;
    depth_ = 0u;
    blocksInTick_ = 0u;
    rmsMs_ = 0.0;
    rmsTick_ = -1;
  }

  // H0: the newest hop of the analysis stream, ring[(first + i) & mask] for i in [0, hop). Tick
  // level: the squares (exact in double) of each 128-sample block summed with numpy's eight
  // accumulators, a tick's blocks joined in numpy's balanced order (binary counter), mean = sum /
  // span.
  void pushHop(const float *ring, std::uint32_t mask, std::uint32_t first) noexcept {
    const std::uint32_t hop = rc_->hop;
    for (std::uint32_t i = 0u; i < hop; ++i) {
      const double s = static_cast<double>(ring[(first + i) & mask]);
      const double q = s * s;
      const std::uint32_t lane = blockFill_ % 8u;
      if (blockFill_ < 8u)
        block_[lane] = q;
      else
        block_[lane] += q;
      if (++blockFill_ == kBlock) {
        blockFill_ = 0u;
        double sum = ((block_[0] + block_[1]) + (block_[2] + block_[3])) +
                     ((block_[4] + block_[5]) + (block_[6] + block_[7]));
        std::uint32_t level = 0u;
        while (depth_ > 0u && stackLevel_[depth_ - 1u] == level) {
          sum = stackSum_[depth_ - 1u] + sum;
          --depth_;
          ++level;
        }
        stackSum_[depth_] = sum;
        stackLevel_[depth_] = level;
        ++depth_;
        if (++blocksInTick_ == 4u * hop / kBlock) {
          rmsMs_ = (0.0 + stackSum_[0]) / static_cast<double>(4u * hop);
          rmsTick_ = hop_ / 4;
          blocksInTick_ = 0u;
          depth_ = 0u;
        }
      }
    }
    ++hop_;
  }

  // H1: frame j's spectrum, magnitude[k - 1] = |X_k|, k in [1, 342). Writes the frame record and
  // its events (0 to 3, band order) and returns the event count; on the tick's last frame also
  // closes the tick (tickClosed).
  std::uint32_t pushFrame(const double *magnitude, TcFrame &frame, TcEvent *events,
                          bool &tickClosed, TcTickV0 &tick) noexcept {
    using tc_detail::npSum;
    const std::int64_t j = frame_++;
    const double *prev = y_[cur_];
    cur_ ^= 1u;
    double *y = y_[cur_];
    for (std::uint32_t k = 0u; k < kBins; ++k)
      y[k] = rhythm_d::portableLog1p(norm_ * magnitude[k]);

    const std::uint32_t slot = static_cast<std::uint32_t>(j % 4);
    std::uint32_t count = 0u;
    double novelty = 0.0;
    frame.j = j;
    for (std::uint32_t c = 0u; c < 3u; ++c) {
      const std::uint32_t b = tc::kBandBins[c][0] - tc::kBinLo,
                          n = tc::kBandBins[c][1] - tc::kBandBins[c][0];
      // Band flux: max3 reference of the previous frame (edges replicated within the band).
      double f = 0.0;
      if (j > 0) {
        for (std::uint32_t i = 0u; i < n; ++i) {
          const double left = prev[b + (i > 0u ? i - 1u : 0u)], mid = prev[b + i];
          const double right = prev[b + (i + 1u < n ? i + 1u : n - 1u)];
          const double m1 = left >= mid ? left : mid;
          const double reference = m1 >= right ? m1 : right;
          const double d = y[b + i] - reference;
          scratch_[i] = d > 0.0 ? d : 0.0;
        }
        f = npSum(scratch_, n) / static_cast<double>(n);
      }
      frame.flux64[c] = f;
      frame.flux[c] = static_cast<float>(rhythm_d::roundHalf(f));
      fluxPool_[slot][c] = frame.flux[c];

      // spectral_pass: band_ms and lvl.
      for (std::uint32_t i = 0u; i < n; ++i)
        scratch_[i] = magnitude[b + i] * magnitude[b + i];
      bandMsPool_[c][slot] = parseval_ * npSum(scratch_, n);
      lvlPool_[c][slot] = npSum(y + b, n) / static_cast<double>(n);

      // running_stats (lfilter DF2T mean, log-domain peak) and novelty, after frame j's update.
      const double mean = meanZ_[c] + tc::kFeAMean * f;
      meanZ_[c] = f * 0.0 - mean * -tc::kFeOneMinusAMean;
      const double jd = static_cast<double>(j) * tc::kFePeakLd;
      const double x = rhythm_d::portableLog(f) - jd;
      if (x > peakM_[c])
        peakM_[c] = x;
      const double m = peakM_[c] > tc::kFePeakInit ? peakM_[c] : tc::kFePeakInit;
      const double peak = rhythm_d::portableExp(m + jd);
      const double v = f - mean;
      const double term =
          v > 0.0 ? v / (peak > tc::kFeNoveltyFloor ? peak : tc::kFeNoveltyFloor) : 0.0;
      novelty = c == 0u ? term : novelty + term;

      if (pickStep(c, j, f, events[count]))
        ++count;
    }
    novPool_[slot] = novelty;

    // spectral_pass: flatness over the Mid and High bins.
    const std::uint32_t fb = tc::kFlatBegin - tc::kBinLo, fn = kBins - fb;
    const double nn = norm_ * norm_;
    for (std::uint32_t i = 0u; i < fn; ++i) {
      const double p = nn * (magnitude[fb + i] * magnitude[fb + i]) + 1e-12;
      scratch_[i] = rhythm_d::portableLog(p);
      scratch2_[i] = p;
    }
    flatPool_[slot] = rhythm_d::portableExp(npSum(scratch_, fn) / static_cast<double>(fn)) /
                      (npSum(scratch2_, fn) / static_cast<double>(fn));

    tickClosed = slot == 3u;
    if (tickClosed)
      closeTick(j / 4, tick);
    return count;
  }

  // log1p(norm |X_k|) of the newest frame, index k - 1 (the kernel's own picker reads it).
  const double *y64() const noexcept { return y_[cur_]; }
  const tc::RateConstants &rate() const noexcept { return *rc_; }

private:
  struct Pick {
    double h0, h1, h2, ring[tc::kRingLength], mean, var, peak, last;
  };

  // The picker, one frame of band c (float64, the reference order of operations).
  bool pickStep(std::uint32_t c, std::int64_t j, double f, TcEvent &event) noexcept {
    Pick &p = pick_[c];
    const double hop = static_cast<double>(rc_->hop), rate = rc_->rate;
    const double end = static_cast<double>((j + 1) * static_cast<std::int64_t>(rc_->hop)) / rate;
    p.h0 = p.h1;
    p.h1 = p.h2;
    p.h2 = f;
    for (std::uint32_t i = 0u; i + 1u < tc::kRingLength; ++i)
      p.ring[i] = p.ring[i + 1u];
    p.ring[tc::kRingLength - 1u] = f;
    const double candidate = p.h1;
    double threshold = p.mean + tc::kFeThresholdSd * std::sqrt(p.var);
    threshold = threshold > tc::kFeThresholdAbs * 1.0 ? threshold : tc::kFeThresholdAbs * 1.0;
    const double relative = tc::kFeThresholdPeak * p.peak;
    threshold = threshold > relative ? threshold : relative;
    bool ok = candidate > p.h0 && candidate >= p.h2 && candidate > threshold;
    for (std::uint32_t i = 0u; ok && i + 1u < tc::kRingLength; ++i)
      ok = candidate >= p.ring[i];
    bool emitted = false;
    if (ok) {
      const double curvature = p.h0 - 2.0 * candidate + p.h2;
      const double delta = curvature < 0.0 ? .5 * (p.h0 - p.h2) / curvature : 0.0;
      const double onset = end - rc_->hopOverRate + delta * hop / rate - rc_->bias[c];
      if (p.last < 0.0 || onset - p.last > tc::kFeRefractory) {
        p.last = onset;
        if (onset >= 0.0) {
          event.t = onset;
          event.strength = static_cast<float>(candidate / p.peak);
          event.frame = static_cast<std::int32_t>(j - 1);
          event.band = static_cast<std::uint8_t>(c);
          event.avail = (static_cast<double>(event.frame) + 2.0) * hop / rate;
          emitted = true;
        }
      }
    }
    const double dm = f - p.mean;
    p.mean += tc::kFeAMean * dm;
    p.var = (1.0 - tc::kFeAMean) * (p.var + tc::kFeAMean * dm * dm);
    const double decayed = p.peak * tc::kFeDPeak;
    p.peak = decayed > f ? decayed : f;
    return emitted;
  }

  void closeTick(std::int64_t k, TcTickV0 &tick) noexcept {
    using tc_detail::log10x10;
    using tc_detail::npPool4;
    tick.k = k;
    tick.env64 = npPool4(novPool_);
    tick.env = static_cast<float>(tick.env64);
    for (std::uint32_t c = 0u; c < 3u; ++c) {
      tick.bandDb64[c] = log10x10(npPool4(bandMsPool_[c]) + tc::kFeDbFloor);
      tick.bandDb[c] = static_cast<float>(rhythm_d::roundHalf(tick.bandDb64[c]));
      tick.lvl64[c] = npPool4(lvlPool_[c]);
      tick.lvl[c] = static_cast<float>(rhythm_d::roundHalf(tick.lvl64[c]));
    }
    tick.flat64 = npPool4(flatPool_);
    tick.flat = static_cast<float>(rhythm_d::roundHalf(tick.flat64));
    // H0 of hop 4k + 3 precedes H1 of frame 4k + 3 in the kernel; NaN marks a caller that broke
    // that order.
    tick.rmsDb64 = rmsTick_ == k ? log10x10(rmsMs_ + tc::kFeDbFloor)
                                 : std::numeric_limits<double>::quiet_NaN();
    tick.rmsDb = static_cast<float>(rhythm_d::roundHalf(tick.rmsDb64));
    for (std::uint32_t s = 0u; s < 4u; ++s)
      for (std::uint32_t c = 0u; c < 3u; ++c)
        tick.flux[s][c] = fluxPool_[s][c];
  }

  const tc::RateConstants *rc_ = nullptr;
  double norm_ = 0.0, parseval_ = 0.0;
  double y_[2][kBins] = {};
  std::uint32_t cur_ = 0u;
  double scratch_[kBins] = {}, scratch2_[kBins] = {};
  Pick pick_[3] = {};
  double meanZ_[3] = {}, peakM_[3] = {};
  double bandMsPool_[3][4] = {}, lvlPool_[3][4] = {}, flatPool_[4] = {}, novPool_[4] = {};
  float fluxPool_[4][3] = {};
  double block_[8] = {}, stackSum_[8] = {};
  std::uint32_t stackLevel_[8] = {}, blockFill_ = 0u, depth_ = 0u, blocksInTick_ = 0u;
  double rmsMs_ = 0.0;
  std::int64_t rmsTick_ = -1, frame_ = 0, hop_ = 0;
};

} // namespace effetune::plugins::analyzer::rhythm_a3
