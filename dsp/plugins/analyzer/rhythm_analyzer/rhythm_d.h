// The telemetry lanes: the learned band detector (theta .42/.24/.44) with its rise stamp and common
// release, the Z silence flag, and the rate rule. Float semantics follow the reference front end
// and detector; every transcendental uses the portable functions so that native and WASM builds
// agree bit for bit. The rate rule allocates its filter in prepare(); nothing allocates after that.
#pragma once
#include <cstdint>
#include <cstring>
#include <vector>

#include "heap_tree_model.h"
#include "portable_math.h"
#include "rhythm_d_high.generated.h"
#include "rhythm_d_low.generated.h"
#include "rhythm_d_mid.generated.h"
#include "rhythm_d_tables.h"

namespace effetune::plugins::analyzer::rhythm_d {

// Rounds to the nearest IEEE binary16 value, ties to even (numpy's astype(float16) from float64).
// Zero and NaN pass through; every input stays far below the binary16 overflow (65504), so no
// rounding to infinity is needed.
[[nodiscard]] inline double roundHalf(double v) noexcept {
  if (v == 0.0 || v != v)
    return v;
  const double a = v < 0.0 ? -v : v;
  int e = 0;
  static_cast<void>(std::frexp(a, &e));
  const int shift = e >= -13 ? 11 - e : 24;
  const double r = std::ldexp(std::nearbyint(std::ldexp(a, shift)), -shift);
  return v < 0.0 ? -r : r;
}

// The periodic Hann window of 4096 points as the reference computes it, float(.5 - .5 cos(2 pi i /
// 4096)), and the FFT twiddles e^{-2 pi i k / 4096}, k < 2048. The window of N = 4096 / s points is
// every s-th value: for a power-of-two s, 2 pi i / N equals 2 pi (s i) / 4096 exactly.
struct FftTables {
  float hann[4096];
  double twiddleRe[2048], twiddleIm[2048];
  FftTables() noexcept {
    constexpr double kTwoPi = 6.283185307179586;
    for (std::uint32_t i = 0u; i < 4096u; ++i)
      hann[i] = static_cast<float>(.5 - .5 * portableCos(kTwoPi * i / 4096.0));
    for (std::uint32_t k = 0u; k < 2048u; ++k) {
      const double angle = kTwoPi * k / 4096.0;
      twiddleRe[k] = portableCos(angle);
      twiddleIm[k] = -portableSin(angle);
    }
  }
};

// Built on first use; every prepare() that needs the tables calls this, so the audio thread never
// builds them.
[[nodiscard]] inline const FftTables &fftTables() noexcept {
  static const FftTables tables;
  return tables;
}

// In-place radix-2 complex FFT of m points (m a power of two, 2 <= m <= 2048), twiddles e^{-2 pi i
// idx / 4096}.
inline void complexFft(double *re, double *im, std::uint32_t m) noexcept {
  const FftTables &tables = fftTables();
  for (std::uint32_t i = 1u, j = 0u; i < m; ++i) {
    std::uint32_t bit = m >> 1u;
    for (; j & bit; bit >>= 1u)
      j ^= bit;
    j ^= bit;
    if (i < j) {
      const double tr = re[i], ti = im[i];
      re[i] = re[j];
      im[i] = im[j];
      re[j] = tr;
      im[j] = ti;
    }
  }
  for (std::uint32_t len = 2u; len <= m; len <<= 1u) {
    const std::uint32_t halfLen = len / 2u, step = 4096u / len;
    for (std::uint32_t i = 0u; i < m; i += len)
      for (std::uint32_t k = 0u; k < halfLen; ++k) {
        const double wr = tables.twiddleRe[k * step], wi = tables.twiddleIm[k * step];
        const std::uint32_t a = i + k, b = a + halfLen;
        const double xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
  }
}

struct Bin {
  double re = 0.0;
  double im = 0.0;
};

// Bin k (1 <= k < m) of the real FFT of 2m samples x, after complexFft on z[n] = x[2n] + i x[2n +
// 1].
[[nodiscard]] inline Bin realBin(const double *re, const double *im, std::uint32_t m,
                                 std::uint32_t k) noexcept {
  const std::uint32_t twStep = 2048u / m; // 4096 / (2 m)
  const double zr = re[k], zi = im[k], cr = re[m - k], ci = -im[m - k];
  const double er = (zr + cr) * .5, ei = (zi + ci) * .5, orr = (zr - cr) * .5, oi = (zi - ci) * .5;
  const FftTables &tables = fftTables();
  const double wr = tables.twiddleRe[k * twStep], wi = tables.twiddleIm[k * twStep];
  return {er + (wr * oi + wi * orr), ei - (wr * orr - wi * oi)};
}

// Bins 0 and m (both real) of the same real FFT.
[[nodiscard]] inline double realBinZero(const double *re, const double *im) noexcept {
  return re[0] + im[0];
}
[[nodiscard]] inline double realBinNyquist(const double *re, const double *im) noexcept {
  return re[0] - im[0];
}

struct Candidate {
  std::int64_t frame;
  std::uint32_t band;
  double src, margin, probability, time;
  bool event;
  const float *features;
  std::uint32_t featureCount;
};

// Observers: event feeds the kernel's queue; candidate and tick serve the equivalence driver.
struct Sink {
  void *context = nullptr;
  void (*event)(void *, double time, float probability, std::uint32_t band) = nullptr;
  void (*candidate)(void *, const Candidate &) = nullptr;
  void (*tick)(void *, std::uint32_t tick, bool silent) = nullptr;
};

// Rate rule: 48, 96 and 192 kHz run natively; the rates of kRateFilters go
// through scipy resample_poly(up, down) with the reference anti-image filter, run causally. The
// filter is designed in prepare() as scipy firwin(taps, cutoff, window ('kaiser', beta)) times up.
// Output m is emitted as soon as input floor((m down + half) / up) exists; the stream equals the
// zero-phase reference stream sample for sample, so analysis-stream times need no shift. Any other
// rate has no path.
class RateRule {
public:
  // Analysis rate for a host rate, or 0 when the rate rule has no path for it.
  static std::uint32_t analysisRate(double rate) noexcept {
    if (rate == 48000.0 || rate == 96000.0 || rate == 192000.0)
      return static_cast<std::uint32_t>(rate);
    const RateFilter *filter = find(rate);
    return filter != nullptr ? filter->target : 0u;
  }
  // Seconds by which an analysis sample is emitted after its input time (the filter's half length),
  // 0 natively.
  static double delaySeconds(double rate) noexcept {
    const RateFilter *filter = find(rate);
    return filter != nullptr ? static_cast<double>((filter->taps - 1u) / 2u) / (filter->up * rate)
                             : 0.0;
  }
  // Allocates the active rate's filter taps.
  void prepare(double rate) {
    filter_ = find(rate);
    if (filter_ != nullptr)
      design(*filter_);
    else
      half_.clear();
    reset();
  }
  void reset() noexcept {
    std::memset(ring_, 0, sizeof(ring_));
    inputs_ = 0u;
    position_ = filter_ != nullptr ? (filter_->taps - 1u) / 2u : 0u;
  }
  template <typename Emit> void push(float x, Emit &&emit) noexcept {
    if (filter_ == nullptr) {
      emit(x);
      return;
    }
    const std::uint32_t up = filter_->up, taps = filter_->taps, half = (taps - 1u) / 2u;
    const double *h = half_.data();
    ring_[inputs_ & kRingMask] = x;
    while (position_ / up <= inputs_) {
      // Taps phase, phase + up, ... against inputs newest, newest - 1, ...; the taps past half come
      // from the mirror.
      const std::uint64_t newest = position_ / up;
      const std::uint32_t phase = static_cast<std::uint32_t>(position_ % up),
                          count = (taps - phase + up - 1u) / up;
      const std::uint32_t n = newest < count ? static_cast<std::uint32_t>(newest) + 1u : count;
      const std::uint32_t rising = phase <= half ? (half - phase) / up + 1u : 0u;
      const std::uint32_t split = rising < n ? rising : n;
      double acc = 0.0;
      std::uint32_t i = 0u;
      for (std::uint32_t tap = phase; i < split; ++i, tap += up)
        acc += h[tap] * static_cast<double>(ring_[(newest - i) & kRingMask]);
      for (std::uint32_t mirror = taps - 1u - (phase + i * up); i < n; ++i, mirror -= up)
        acc += h[mirror] * static_cast<double>(ring_[(newest - i) & kRingMask]);
      emit(static_cast<float>(acc));
      position_ += filter_->down;
    }
    ++inputs_;
  }

private:
  static constexpr std::uint64_t kRingMask =
      127u; // every phase fits (checked when the tables are generated)
  static const RateFilter *find(double rate) noexcept {
    for (const RateFilter &filter : kRateFilters)
      if (rate == static_cast<double>(filter.rate))
        return &filter;
    return nullptr;
  }
  // Modified Bessel function I0 by its power series, summed until the next term is negligible.
  static double besselI0(double x) noexcept {
    const double q = x * x / 4.0;
    double sum = 1.0, term = 1.0;
    for (double k = 1.0;; k += 1.0) {
      term *= q / (k * k);
      sum += term;
      if (term < sum * 1e-17)
        return sum;
    }
  }
  // Taps 0 .. (taps - 1) / 2: the sinc of the cutoff (a fraction of the upsampled Nyquist rate)
  // under the Kaiser window, normalized to unit DC gain, times up.
  void design(const RateFilter &filter) {
    constexpr double kPi = 3.141592653589793;
    const std::uint32_t half = (filter.taps - 1u) / 2u;
    const double alpha = static_cast<double>(half), c = filter.cutoff;
    const double i0Beta = besselI0(kRateFilterBeta);
    half_.resize(half + 1u);
    for (std::uint32_t k = 0u; k <= half; ++k) {
      const double m = static_cast<double>(k) - alpha, y = kPi * (c * m), r = m / alpha;
      const double sinc = k == half ? 1.0 : portableSin(y) / y;
      half_[k] = c * sinc * (besselI0(kRateFilterBeta * std::sqrt(1.0 - r * r)) / i0Beta);
    }
    double sum = half_[half];
    for (std::uint32_t k = 0u; k < half; ++k)
      sum += 2.0 * half_[k];
    const double up = static_cast<double>(filter.up);
    for (double &h : half_)
      h = h / sum * up;
  }
  const RateFilter *filter_ = nullptr;
  std::vector<double> half_;
  std::uint64_t inputs_ = 0u, position_ = 0u;
  float ring_[kRingMask + 1u] = {};
};

// Past quantile over the last kWf values (pandas rolling quantile, interpolation 'lower').
class SortedWindow {
public:
  void reset() noexcept { count_ = 0; }
  double lower(double q, double floor) const noexcept {
    if (count_ == 0)
      return floor;
    const double v = values_[static_cast<std::int32_t>(q * static_cast<double>(count_ - 1))];
    return v > floor ? v : floor;
  }
  void insert(double v) noexcept {
    std::int32_t i = count_;
    while (i > 0 && values_[i - 1] > v) {
      values_[i] = values_[i - 1];
      --i;
    }
    values_[i] = v;
    ++count_;
  }
  void remove(double v) noexcept {
    std::int32_t i = 0;
    while (values_[i] != v)
      ++i;
    for (--count_; i < count_; ++i)
      values_[i] = values_[i + 1];
  }

private:
  double values_[kWf + 1] = {};
  std::int32_t count_ = 0;
};

class Detector {
public:
  Sink sink;

  // False when the rate rule has no path for the rate: the lanes and Z then stay off.
  bool prepare(double sampleRate) {
    const std::uint32_t rate = RateRule::analysisRate(sampleRate);
    active_ = rate != 0u;
    if (active_) {
      size_ = 1024u * (rate / 48000u);
      hop_ = size_ / 8u;
      windowStep_ = 4096u / size_;
      norm_ = size_ == 1024u ? kNorm1024 : size_ == 2048u ? kNorm2048 : kNorm4096;
      parseval_ = size_ == 1024u ? kParseval1024 : size_ == 2048u ? kParseval2048 : kParseval4096;
    }
    static_cast<void>(fftTables());
    rateRule_.prepare(sampleRate);
    reset();
    return active_;
  }
  void reset() noexcept {
    rateRule_.reset();
    std::memset(samples_, 0, sizeof(samples_));
    std::memset(y_, 0, sizeof(y_));
    count_ = 0u;
    frames_ = 0;
    tickSum_ = 0.0;
    tickFill_ = 0u;
    ticks_ = 0u;
    quietRun_ = 0u;
    silent_ = false;
    for (Band &b : bands_) {
      b.winS.reset();
      b.winF.reset();
      b.winDb.reset();
      b.prevFrame = b.eventFrame = -1;
      b.prevLq = b.eventLq = 0.0;
      b.stackBegin = b.stackEnd = b.candBegin = b.candEnd = 0u;
      b.last = -(std::int64_t{1} << 40);
    }
  }
  bool active() const noexcept { return active_; }
  std::uint32_t analysisSamples() const noexcept { return count_; }
  bool silent() const noexcept { return silent_; }
  // Spectrum sharing: |X[k]| of the last frame, bins [kLo, kHi), and the analysis-stream samples.
  const double *magnitude() const noexcept { return mag_; }
  float sampleAt(std::uint32_t i) const noexcept { return samples_[i & kSampleMask]; }
  void push(float mono) noexcept {
    if (active_)
      rateRule_.push(mono, [this](float x) { sample(x); });
  }

private:
  static constexpr std::uint32_t kRing = 512u, kMask = kRing - 1u, kSampleMask = 4095u,
                                 kStack = 512u;
  static constexpr std::uint32_t kBins = kHi - kLo;

  struct Band {
    double s[kRing], f[kRing], db[kRing], scale[kRing], scaleF[kRing], f90[kRing], db10[kRing],
        db90[kRing], qn[kRing], lqn[kRing];
    SortedWindow winS, winF, winDb;
    std::int64_t prevFrame, eventFrame;
    double prevLq, eventLq;
    std::int64_t stackFrame[kStack], candFrame[kStack];
    double stackQn[kStack];
    std::uint32_t stackBegin, stackEnd, candBegin, candEnd;
    std::int64_t last;
  };

  static double maxOf(double a, double b) noexcept { return a > b ? a : b; }
  static double minOf(double a, double b) noexcept { return a < b ? a : b; }
  static double log10x10(double v) noexcept {
    return 10.0 * (portableLog(v) / 2.30258509299404568402);
  }
  static double at(const double *ring, std::int64_t frame) noexcept {
    return ring[static_cast<std::uint32_t>(frame < 0 ? 0 : frame) & kMask];
  }
  // max(x[p - k .. p - 1]) clipped at frame 0 (x[0] for p = 0).
  static double pastMax(const double *ring, std::int64_t p, std::int32_t k) noexcept {
    if (p == 0)
      return ring[0];
    double m = at(ring, p - 1);
    for (std::int64_t i = p - 2; i >= p - k && i >= 0; --i)
      m = maxOf(m, at(ring, i));
    return m;
  }

  void sample(float x) noexcept {
    samples_[count_ & kSampleMask] = x;
    ++count_;
    tickSum_ += static_cast<double>(x) * static_cast<double>(x);
    if (++tickFill_ == kPool * hop_) {
      const bool quiet =
          log10x10(tickSum_ / static_cast<double>(kPool * hop_) + kDbFloor) < kGateDb;
      quietRun_ = quiet ? quietRun_ + 1u : 0u;
      silent_ = quietRun_ >= kZStop;
      if (sink.tick != nullptr)
        sink.tick(sink.context, ticks_, silent_);
      ++ticks_;
      tickSum_ = 0.0;
      tickFill_ = 0u;
    }
    if (count_ % hop_ == 0u)
      frame();
  }

  void frame() noexcept {
    const std::int64_t j = frames_++;
    const std::uint32_t m = size_ / 2u, first = count_ - size_;
    const float *window = fftTables().hann;
    for (std::uint32_t n = 0u; n < m; ++n) {
      re_[n] = static_cast<double>(samples_[(first + 2u * n) & kSampleMask] *
                                   window[2u * n * windowStep_]);
      im_[n] = static_cast<double>(samples_[(first + 2u * n + 1u) & kSampleMask] *
                                   window[(2u * n + 1u) * windowStep_]);
    }
    complexFft(re_, im_, m);
    double *y = y_[j % 3];
    const double *ref = y_[(j + 1) % 3]; // frame j - 2
    for (std::uint32_t k = kLo; k < kHi; ++k) {
      const Bin x = realBin(re_, im_, m, k);
      const double mag = std::sqrt(x.re * x.re + x.im * x.im);
      mag_[k - kLo] = mag;
      power_[k - kLo] = mag * mag;
      y[k - kLo] = portableLog1p(norm_ * mag);
    }
    for (std::uint32_t k = 0u; k < kBins; ++k) {
      if (j < 2) {
        pos_[k] = 0.0;
        continue;
      }
      const double r0 = ref[k == 0u ? 0u : k - 1u], r2 = ref[k + 1u == kBins ? k : k + 1u];
      const double r = maxOf(maxOf(r0, ref[k]), r2), d = y[k] - r;
      pos_[k] = d > 0.0 ? d : 0.0;
    }
    double dstat[3] = {0.0, 0.0, 0.0};
    for (std::uint32_t sb = 0u; sb < kSubBands; ++sb) {
      double acc = 0.0;
      for (std::uint32_t k = kSubBandBins[2u * sb]; k < kSubBandBins[2u * sb + 1u]; ++k)
        acc += pos_[k - kLo] * kSubBandWeight[sb];
      const std::uint32_t c = kSubBandBand[sb];
      dstat[c] = acc > dstat[c] ? acc : dstat[c];
    }
    const std::uint32_t r = static_cast<std::uint32_t>(j) & kMask;
    for (std::uint32_t c = 0u; c < 3u; ++c) {
      const std::uint32_t b0 = kBandBins[2u * c], b1 = kBandBins[2u * c + 1u];
      double flux = 0.0, ms = 0.0;
      for (std::uint32_t k = b0; k < b1; ++k) {
        flux += pos_[k - kLo];
        ms += power_[k - kLo];
      }
      Band &b = bands_[c];
      const double s = roundHalf(dstat[c]), f = roundHalf(flux / static_cast<double>(b1 - b0));
      const double db = roundHalf(log10x10(parseval_ * ms + kDbFloor));
      b.s[r] = s;
      b.f[r] = f;
      b.db[r] = db;
      b.scale[r] = b.winS.lower(.5, kCFloor[c]);
      b.scaleF[r] = b.winF.lower(.5, kCFloorF[c]);
      b.f90[r] = b.winF.lower(.9, kCFloorF[c]);
      b.db10[r] = b.winDb.lower(.1, kLevelFloor);
      b.db90[r] = b.winDb.lower(.9, kLevelFloor);
      b.qn[r] = s / (b.scale[r] * kCC[c]);
      b.lqn[r] = portableLog(maxOf(b.qn[r], 1e-6));
      b.winS.insert(s);
      b.winF.insert(f);
      b.winDb.insert(db);
      if (j >= kWf) {
        const std::uint32_t old = static_cast<std::uint32_t>(j - kWf) & kMask;
        b.winS.remove(b.s[old]);
        b.winF.remove(b.f[old]);
        b.winDb.remove(b.db[old]);
      }
    }
    if (j >= 4) // candidate p = j - 3 >= 1: its features read frames up to p + 3, released at p + 4
      for (std::uint32_t c = 0u; c < 3u; ++c)
        evaluate(c, j - 3);
  }

  double refLevel(const Band &b, std::int64_t p) const noexcept {
    if (p < 8)
      return kLevelFloor;
    const std::int64_t a = p - 15 < 0 ? 0 : p - 15;
    const std::int32_t n = static_cast<std::int32_t>(p - 8 - a + 1);
    double v[8];
    for (std::int32_t i = 0; i < n; ++i) {
      const double x = at(b.db, a + i);
      std::int32_t k = i;
      for (; k > 0 && v[k - 1] > x; --k)
        v[k] = v[k - 1];
      v[k] = x;
    }
    return n % 2 ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2.0;
  }

  static double interp(double x, const double *xp, const double *fp) noexcept {
    constexpr std::int32_t n = 49;
    if (x < xp[0])
      return fp[0];
    if (x >= xp[n - 1])
      return fp[n - 1];
    std::int32_t j = 0;
    while (xp[j + 1] <= x)
      ++j;
    if (xp[j] == x)
      return fp[j];
    return (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]) * (x - xp[j]) + fp[j];
  }

  double riseStamp(const Band &b, std::uint32_t c, std::int64_t p) const noexcept {
    double w[15], pre[8];
    for (std::int32_t i = 0; i < 15; ++i)
      w[i] = portableDecadePower(at(b.db, p - 11 + i) / 10.0);
    for (std::int32_t i = 0; i < 8; ++i) {
      std::int32_t k = i;
      for (; k > 0 && pre[k - 1] > w[i]; --k)
        pre[k] = pre[k - 1];
      pre[k] = w[i];
    }
    const double base = (pre[3] + pre[4]) / 2.0;
    std::int32_t peak = 10;
    for (std::int32_t i = 11; i < 15; ++i)
      peak = w[i] > w[peak] ? i : peak;
    const double rise = w[peak] - base;
    if (!(rise > 0.0))
      return (static_cast<double>(p) + 1.0) * kFrameS - kCD[c];
    std::int32_t j = 5;
    for (std::int32_t i = peak - 1; i > 5; --i)
      if ((w[i] - base) / rise < kRiseAlpha) {
        j = i;
        break;
      }
    const double u0 = (w[j] - base) / rise, u1 = (w[j + 1] - base) / rise;
    const double lo = std::sqrt(std::sqrt(u0 > 0.0 ? u0 : 0.0)),
                 hi = std::sqrt(std::sqrt(u1 > 0.0 ? u1 : 0.0));
    double frac = 0.0;
    if (hi > lo) {
      frac = (kRiseAlphaQuarter - lo) / (hi - lo);
      frac = frac < 0.0 ? 0.0 : frac > 1.0 ? 1.0 : frac;
    }
    return (static_cast<double>(p - 11 + j + 1) + frac) * kFrameS - kRiseC;
  }

  void evaluate(std::uint32_t c, std::int64_t p) noexcept {
    Band &b = bands_[c];
    const double s = at(b.s, p), f = at(b.f, p), db = at(b.db, p);
    const bool gate = db >= kGateDb;
    const bool fromS = gate && s > at(b.s, p - 1) && s >= at(b.s, p + 1) &&
                       s / (at(b.scale, p) * kCC[c]) > kCandidateMin;
    const bool fromF = gate && kFChannel[c] != 0u && f > at(b.f, p - 1) && f >= at(b.f, p + 1) &&
                       f / (at(b.scaleF, p) * kCCF[c]) > kCandidateMin;
    if (!fromS && !fromF)
      return;
    const Band &o0 = bands_[c == 0u ? 1u : 0u], &o1 = bands_[c == 2u ? 1u : 2u];
    const double qn = at(b.qn, p), lq = portableLog(maxOf(qn, 1e-6));
    const double sp = maxOf(s, 1e-9), fp = maxOf(f, 1e-9), scale = at(b.scale, p);
    // Candidate history: stack of stronger-or-equal predecessors and the frames of the last CAP
    // frames.
    while (b.stackEnd != b.stackBegin && b.stackQn[(b.stackEnd - 1u) % kStack] < qn)
      --b.stackEnd;
    while (b.stackEnd != b.stackBegin && p - b.stackFrame[b.stackBegin % kStack] >= kCap)
      ++b.stackBegin;
    while (b.candEnd != b.candBegin && b.candFrame[b.candBegin % kStack] < p - kCap)
      ++b.candBegin;
    const auto since = [p](std::int64_t q) {
      return q < 0 ? static_cast<double>(kCap) : static_cast<double>(p - q < kCap ? p - q : kCap);
    };
    double oqa = at(o0.lqn, p - 2), oqb = at(o1.lqn, p - 2);
    for (std::int64_t i = p - 1; i <= p + 1; ++i) {
      oqa = maxOf(oqa, at(o0.lqn, i));
      oqb = maxOf(oqb, at(o1.lqn, i));
    }
    const double ref = refLevel(b, p);
    const double level = ref > kLMin ? ref : kLMin;
    const double *lg = c == 0u ? kStatLLow : c == 1u ? kStatLMid : kStatLHigh;
    const double ext = minOf(level - lg[0], 0.0) * kLn10Over20;
    const double ed = portableExp(interp(level, lg,
                                         c == 0u   ? kStatLogEdLow
                                         : c == 1u ? kStatLogEdMid
                                                   : kStatLogEdHigh) +
                                  ext);
    const double ef = portableExp(interp(level, lg,
                                         c == 0u   ? kStatLogEfLow
                                         : c == 1u ? kStatLogEfMid
                                                   : kStatLogEfHigh) +
                                  ext);
    double v[kFeatureSlots];
    v[kLq] = lq;
    v[kDd10] = db - pastMax(b.db, p, 10);
    v[kDd40] = db - pastMax(b.db, p, 40);
    v[kDd150] = db - pastMax(b.db, p, 150);
    v[kRise2] = db - at(b.db, p - 2);
    v[kRise4] = db - at(b.db, p - 4);
    v[kRiseNext] = at(b.db, p + 1) - at(b.db, p - 1);
    v[kSpread] = portableLog(fp / sp);
    v[kLqf] = portableLog(maxOf(f / at(b.scaleF, p), 1e-6));
    v[kSharpPrev] = at(b.s, p - 1) / sp;
    v[kSharpNext] = at(b.s, p + 1) / sp;
    v[kDtCand] = since(b.prevFrame);
    v[kLqCand] = b.prevFrame < 0 ? kLogMilli : b.prevLq;
    v[kDtEvent] = since(b.eventFrame);
    v[kLqEvent] = b.eventFrame < 0 ? kLogMilli : b.eventLq;
    v[kDtStronger] =
        since(b.stackEnd == b.stackBegin ? -1 : b.stackFrame[(b.stackEnd - 1u) % kStack]);
    v[kLqMax40] = pastMax(b.lqn, p, 40);
    v[kSRel40] = portableLog(sp / maxOf(pastMax(b.s, p, 40), 1e-9));
    v[kNCand1s] = static_cast<double>(b.candEnd - b.candBegin);
    v[kOqA] = oqa;
    v[kOqB] = oqb;
    v[kLaDb2] = at(b.db, p + 2) - db;
    v[kLaS2] = at(b.s, p + 2) / sp;
    v[kLaOq2] = maxOf(at(o0.lqn, p + 2), at(o1.lqn, p + 2));
    v[kLaDb3] = at(b.db, p + 3) - db;
    v[kLaS3] = at(b.s, p + 3) / sp;
    v[kLaOq3] = maxOf(at(o0.lqn, p + 3), at(o1.lqn, p + 3));
    v[kLf90] = portableLog(fp / at(b.f90, p));
    v[kDbr] = at(b.db90, p) - at(b.db10, p);
    v[kSrc] = (fromS ? 1.0 : 0.0) + (fromF ? 2.0 : 0.0);
    v[kFsharpPrev] = at(b.f, p - 1) / fp;
    v[kFsharpNext] = at(b.f, p + 1) / fp;
    v[kFRel40] = portableLog(fp / maxOf(pastMax(b.f, p, 40), 1e-9));
    v[kZs] = portableLog(sp / ed);
    v[kZf] = portableLog(fp / ef);
    v[kZscale] = portableLog(scale / ed);
    float x[kFeatureSlots];
    std::uint32_t n = kFeatureSlots;
    if (c == 2u) {
      n = sizeof(kHighColumns) / sizeof(kHighColumns[0]);
      for (std::uint32_t i = 0u; i < n; ++i)
        x[i] = static_cast<float>(v[kHighColumns[i]]);
    } else {
      for (std::uint32_t i = 0u; i < n; ++i)
        x[i] = static_cast<float>(v[i]);
    }
    const double margin = c == 0u   ? HeapTreeEvaluator::margin(rhythm_d_low::model(), x)
                          : c == 1u ? HeapTreeEvaluator::margin(rhythm_d_mid::model(), x)
                                    : HeapTreeEvaluator::margin(rhythm_d_high::model(), x);
    const double probability = 1.0 / (1.0 + portableExp(-margin));
    const bool event = margin > kLogitTheta[c] && p - b.last > kRefractory[c];
    const double time = event ? riseStamp(b, c, p) : 0.0;
    if (event) {
      b.last = p;
      if (sink.event != nullptr)
        sink.event(sink.context, time, static_cast<float>(probability), c);
    }
    if (sink.candidate != nullptr)
      sink.candidate(sink.context, {p, c, v[kSrc], margin, probability, time, event, x, n});
    b.prevFrame = p;
    b.prevLq = lq;
    if (qn > 1.0) {
      b.eventFrame = p;
      b.eventLq = lq;
    }
    b.stackFrame[b.stackEnd % kStack] = p;
    b.stackQn[b.stackEnd % kStack] = qn;
    ++b.stackEnd;
    b.candFrame[b.candEnd % kStack] = p;
    ++b.candEnd;
  }

  RateRule rateRule_;
  Band bands_[3];
  float samples_[kSampleMask + 1u] = {};
  double re_[2048] = {}, im_[2048] = {}, mag_[kBins] = {}, power_[kBins] = {}, pos_[kBins] = {},
         y_[3][kBins] = {};
  double norm_ = kNorm1024, parseval_ = kParseval1024, tickSum_ = 0.0;
  std::uint32_t size_ = 1024u, windowStep_ = 4u, hop_ = 128u, count_ = 0u, tickFill_ = 0u,
                ticks_ = 0u, quietRun_ = 0u;
  std::int64_t frames_ = 0;
  bool active_ = false, silent_ = false;
};

} // namespace effetune::plugins::analyzer::rhythm_d
