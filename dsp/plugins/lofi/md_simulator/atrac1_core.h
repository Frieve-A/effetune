// MD Simulator (ATRAC1 SP) codec core.
//
// Everything in this header is written from the algorithm description in the
// implementation plan (section 3.1) and from the closed-form derivations recorded
// in tables.h.  No code or coefficient array is taken from the LGPL reference
// implementations (atracdenc, FFmpeg); see the provenance policy in tables.h.
//
// The transform layer (Dct4 / Mdct / Qmf*) is exercised directly by the in-repo
// oracles of verification plan section 7.2, so it is written with explicit,
// separately testable entry points.
//
#ifndef EFFETUNE_MD_SIMULATOR_ATRAC1_CORE_H
#define EFFETUNE_MD_SIMULATOR_ATRAC1_CORE_H

#include "tables.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::md_simulator {

inline constexpr double kPi = 3.14159265358979323846;

// Largest complex FFT used by the transform layer: the 256-coefficient high band
// MDCT runs a 128-point complex FFT.
inline constexpr std::size_t kMaxFftSize = 128u;
// Largest MDCT block (high band, long mode).
inline constexpr std::size_t kMaxBlockSize = 256u;

// ---------------------------------------------------------------------------
// DCT-IV of length N through a single complex FFT of length M = N/2
// ---------------------------------------------------------------------------
//   y[k] = sum_{n=0}^{N-1} u[n] * cos(pi/N * (n + 1/2) * (k + 1/2))
//
// With   c[n] = (u[2n] + i*u[N-1-2n]) * exp(-i*pi*(4n+1)/(4N)),  C = FFT_M(c):
//   y[2k]     =  Re{ C[k] * exp(-i*pi*k/N) }
//   y[N-1-2k] = -Im{ C[k] * exp(-i*pi*k/N) }
//
// The post twiddle angle is -pi*k/N rather than the -pi*(4k+1)/(4N) that a naive
// split suggests, because
//   (4n+1)(4k+1)/(4N) = 4nk/N + (4n+1)/(4N) + (4k+1)/(4N) - 1/(4N),
// and the leftover exp(+i*pi/(4N)) is folded into the post twiddle.  Verified
// numerically against the direct O(N^2) sum to better than 4e-14 for N = 8..256.
class Dct4 {
public:
  void prepare(std::size_t n) {
    n_ = n;
    m_ = n / 2u;
    preRe_.assign(m_, 0.0);
    preIm_.assign(m_, 0.0);
    postRe_.assign(m_, 0.0);
    postIm_.assign(m_, 0.0);
    twRe_.assign(m_ / 2u, 0.0);
    twIm_.assign(m_ / 2u, 0.0);
    rev_.assign(m_, 0u);

    const double nd = static_cast<double>(n_);
    for (std::size_t i = 0; i < m_; ++i) {
      const double a = -kPi * (4.0 * static_cast<double>(i) + 1.0) / (4.0 * nd);
      preRe_[i] = std::cos(a);
      preIm_[i] = std::sin(a);
      const double b = -kPi * static_cast<double>(i) / nd;
      postRe_[i] = std::cos(b);
      postIm_[i] = std::sin(b);
    }
    for (std::size_t i = 0; i < m_ / 2u; ++i) {
      const double a = -2.0 * kPi * static_cast<double>(i) / static_cast<double>(m_);
      twRe_[i] = std::cos(a);
      twIm_[i] = std::sin(a);
    }
    std::size_t bits = 0;
    while ((static_cast<std::size_t>(1u) << bits) < m_) {
      ++bits;
    }
    for (std::size_t i = 0; i < m_; ++i) {
      std::size_t r = 0;
      for (std::size_t b = 0; b < bits; ++b) {
        if ((i & (static_cast<std::size_t>(1u) << b)) != 0u) {
          r |= static_cast<std::size_t>(1u) << (bits - 1u - b);
        }
      }
      rev_[i] = static_cast<std::uint16_t>(r);
    }
  }

  std::size_t size() const noexcept { return n_; }

  void transform(const double *u, double *y) const noexcept {
    std::array<double, kMaxFftSize> ar{};
    std::array<double, kMaxFftSize> ai{};
    std::array<double, kMaxFftSize> re{};
    std::array<double, kMaxFftSize> im{};

    for (std::size_t i = 0; i < m_; ++i) {
      const double p = u[2u * i];
      const double q = u[n_ - 1u - 2u * i];
      ar[i] = p * preRe_[i] - q * preIm_[i];
      ai[i] = p * preIm_[i] + q * preRe_[i];
    }
    for (std::size_t i = 0; i < m_; ++i) {
      const std::size_t j = rev_[i];
      re[i] = ar[j];
      im[i] = ai[j];
    }
    for (std::size_t len = 2u; len <= m_; len <<= 1u) {
      const std::size_t half = len >> 1u;
      const std::size_t step = m_ / len;
      for (std::size_t i = 0; i < m_; i += len) {
        for (std::size_t k = 0; k < half; ++k) {
          const double wr = twRe_[k * step];
          const double wi = twIm_[k * step];
          const double xr = re[i + half + k];
          const double xi = im[i + half + k];
          const double tr = xr * wr - xi * wi;
          const double ti = xr * wi + xi * wr;
          re[i + half + k] = re[i + k] - tr;
          im[i + half + k] = im[i + k] - ti;
          re[i + k] = re[i + k] + tr;
          im[i + k] = im[i + k] + ti;
        }
      }
    }
    for (std::size_t k = 0; k < m_; ++k) {
      const double rr = re[k] * postRe_[k] - im[k] * postIm_[k];
      const double ii = re[k] * postIm_[k] + im[k] * postRe_[k];
      y[2u * k] = rr;
      y[n_ - 1u - 2u * k] = -ii;
    }
  }

private:
  std::size_t n_ = 0;
  std::size_t m_ = 0;
  std::vector<double> preRe_;
  std::vector<double> preIm_;
  std::vector<double> postRe_;
  std::vector<double> postIm_;
  std::vector<double> twRe_;
  std::vector<double> twIm_;
  std::vector<std::uint16_t> rev_;
};

// ---------------------------------------------------------------------------
// Low-overlap MDCT window (fixed 32-sample sine edges, plan section 3.1)
// ---------------------------------------------------------------------------
inline double mdctWindow(std::size_t blockSize, std::size_t n) noexcept {
  const std::size_t half = blockSize / 2u;
  const std::size_t h = kOverlapSamples / 2u; // 16
  const std::size_t r0 = half - h;
  const std::size_t r1 = half + h;
  const std::size_t r2 = 3u * half - h;
  const std::size_t r3 = 3u * half + h;
  if (n < r0) {
    return 0.0;
  }
  if (n < r1) {
    return kOverlapRamp[n - r0];
  }
  if (n < r2) {
    return 1.0;
  }
  if (n < r3) {
    return kOverlapRamp[kOverlapSamples - 1u - (n - r2)];
  }
  return 0.0;
}

// ---------------------------------------------------------------------------
// MDCT / IMDCT
// ---------------------------------------------------------------------------
// forward(): 2B windowed input samples -> B coefficients.
//   with H = B/2 the input folds to
//     v[i]   = -x[B+H-1-i] - x[3H+i]
//     v[H+i] =  x[i]       - x[B-1-i]
//   and X = DCT-IV(v).
// inverse(): B coefficients -> 2B samples, y = unfold((2/B) * DCT-IV(X)).
// Together with the window above these satisfy TDAC exactly (verified to 6e-14).
class Mdct {
public:
  void prepare() {
    plans_[0].prepare(kShortBlockSize); // 32
    plans_[1].prepare(kBandSamples[0]); // 128
    plans_[2].prepare(kBandSamples[2]); // 256
  }

  static std::size_t planIndex(std::size_t blockSize) noexcept {
    if (blockSize == kShortBlockSize) {
      return 0u;
    }
    return (blockSize == kBandSamples[0]) ? 1u : 2u;
  }

  void forward(std::size_t blockSize, const double *in, double *out) const noexcept {
    const std::size_t b = blockSize;
    const std::size_t h = b / 2u;
    std::array<double, kMaxBlockSize> v{};
    for (std::size_t i = 0; i < h; ++i) {
      v[i] = -in[b + h - 1u - i] - in[3u * h + i];
      v[h + i] = in[i] - in[b - 1u - i];
    }
    plans_[planIndex(b)].transform(v.data(), out);
  }

  void inverse(std::size_t blockSize, const double *in, double *out) const noexcept {
    const std::size_t b = blockSize;
    const std::size_t h = b / 2u;
    std::array<double, kMaxBlockSize> v{};
    plans_[planIndex(b)].transform(in, v.data());
    const double scale = 2.0 / static_cast<double>(b);
    for (std::size_t i = 0; i < b; ++i) {
      v[i] *= scale;
    }
    for (std::size_t i = 0; i < h; ++i) {
      out[i] = v[h + i];
      out[h + i] = -v[b - 1u - i];
      out[b + i] = -v[h - 1u - i];
      out[3u * h + i] = -v[i];
    }
  }

private:
  std::array<Dct4, 3> plans_{};
};

// ---------------------------------------------------------------------------
// Two-band QMF (one stage of the tree)
// ---------------------------------------------------------------------------
// Analysis uses the polyphase identity low = E + O, high = E - O where E and O
// are the even and the odd tap partial sums, which follows from
// h1[n] = (-1)^n h0[n].  Synthesis uses f0 = 2*h0, f1 = -2*h1, so with
// s[m] = low[m] - high[m] and d[m] = low[m] + high[m]
//     y[2m]   = sum_j f0[2j]   * s[m-j]
//     y[2m+1] = sum_j f0[2j+1] * d[m-j].
// The cascade is therefore alias free by construction and the residual transfer
// is (A(w)^2 + A(w+pi)^2) * z^-47.
class QmfAnalysis {
public:
  void prepare(std::size_t maxInput) {
    scratch_.assign(kQmfDelay + maxInput, 0.0);
    reset();
  }

  void reset() noexcept {
    hist_.fill(0.0);
    std::fill(scratch_.begin(), scratch_.end(), 0.0);
  }

  void process(const double *in, std::size_t count, double *low, double *high) noexcept {
    std::copy(hist_.begin(), hist_.end(), scratch_.begin());
    std::copy(in, in + count, scratch_.begin() + static_cast<std::ptrdiff_t>(kQmfDelay));
    const std::size_t half = count / 2u;
    for (std::size_t m = 0; m < half; ++m) {
      const std::size_t base = kQmfDelay + 2u * m;
      double even = 0.0;
      double odd = 0.0;
      for (std::size_t n = 0; n < kQmfTaps; n += 2u) {
        even += kQmfPrototype[n] * scratch_[base - n];
        odd += kQmfPrototype[n + 1u] * scratch_[base - n - 1u];
      }
      low[m] = even + odd;
      high[m] = even - odd;
    }
    const std::size_t tail = kQmfDelay + count - kQmfDelay;
    for (std::size_t i = 0; i < kQmfDelay; ++i) {
      hist_[i] = scratch_[tail + i];
    }
  }

private:
  std::array<double, kQmfDelay> hist_{};
  std::vector<double> scratch_;
};

class QmfSynthesis {
public:
  static constexpr std::size_t kHalfTaps = kQmfTaps / 2u; // 24
  static constexpr std::size_t kHistory = kHalfTaps - 1u; // 23

  void prepare(std::size_t maxHalf) {
    sbuf_.assign(kHistory + maxHalf, 0.0);
    dbuf_.assign(kHistory + maxHalf, 0.0);
    reset();
  }

  void reset() noexcept {
    std::fill(sbuf_.begin(), sbuf_.end(), 0.0);
    std::fill(dbuf_.begin(), dbuf_.end(), 0.0);
  }

  void process(const double *low, const double *high, std::size_t half, double *out) noexcept {
    for (std::size_t m = 0; m < half; ++m) {
      sbuf_[kHistory + m] = low[m] - high[m];
      dbuf_[kHistory + m] = low[m] + high[m];
    }
    for (std::size_t m = 0; m < half; ++m) {
      double even = 0.0;
      double odd = 0.0;
      for (std::size_t j = 0; j < kHalfTaps; ++j) {
        even += 2.0 * kQmfPrototype[2u * j] * sbuf_[kHistory + m - j];
        odd += 2.0 * kQmfPrototype[2u * j + 1u] * dbuf_[kHistory + m - j];
      }
      out[2u * m] = even;
      out[2u * m + 1u] = odd;
    }
    for (std::size_t i = 0; i < kHistory; ++i) {
      sbuf_[i] = sbuf_[half + i];
      dbuf_[i] = dbuf_[half + i];
    }
  }

private:
  std::vector<double> sbuf_;
  std::vector<double> dbuf_;
};

// Plain integer delay line used to equalise the high band against the extra
// stage-2 round trip of the low/mid path.  `count` must be >= the delay length.
class DelayLine {
public:
  void prepare(std::size_t length) { buf_.assign(length, 0.0); }

  void reset() noexcept { std::fill(buf_.begin(), buf_.end(), 0.0); }

  void process(const double *in, std::size_t count, double *out) noexcept {
    const std::size_t d = buf_.size();
    for (std::size_t i = 0; i < count; ++i) {
      out[i] = (i < d) ? buf_[i] : in[i - d];
    }
    for (std::size_t i = 0; i < d; ++i) {
      buf_[i] = in[count - d + i];
    }
  }

private:
  std::vector<double> buf_;
};

// ---------------------------------------------------------------------------
// Logical sound unit
// ---------------------------------------------------------------------------
// These are exactly the fields an ATRAC1 SP sound unit carries.  The decoder is
// only allowed to look at this structure, never at encoder internals, so the
// test-only bitstream adapter (test_adapter.h) can round trip it through the
// real 212 byte packing without changing the decoded result.
struct SoundUnit {
  std::array<std::uint8_t, kBandCount> blockMode{}; // 0 = long, 1 = short
  std::uint8_t bfuAmountIndex = 0;
  std::uint16_t bfuCount = 0;
  std::array<std::uint8_t, kBfuCount> wordLength{};       // 0 or 2..16
  std::array<std::uint8_t, kBfuCount> scaleFactorIndex{}; // 0..63
  std::array<std::int32_t, kSoundUnitSamples> quantized{};
  std::uint32_t usedBits = 0;

  void clear() noexcept {
    blockMode.fill(0u);
    bfuAmountIndex = 0u;
    bfuCount = 0u;
    wordLength.fill(0u);
    scaleFactorIndex.fill(0u);
    quantized.fill(0);
    usedBits = 0u;
  }
};

inline std::size_t bfuBand(std::size_t bfu) noexcept {
  for (std::size_t b = 0; b + 1u < kBandCount; ++b) {
    if (bfu < kBandBfuStart[b + 1u]) {
      return b;
    }
  }
  return kBandCount - 1u;
}

inline std::size_t bfuStart(std::size_t bfu, bool shortMode) noexcept {
  return shortMode ? kBfuStartShort[bfu] : kBfuStartLong[bfu];
}

// IDWL -> word length.  IDWL 0 means "this BFU is not transmitted"; every other
// IDWL carries IDWL+1 bits, so the smallest non-zero word length is 2 and the
// dequantiser never divides by zero.
inline int wordLengthForIdwl(int idwl) noexcept { return (idwl <= 0) ? 0 : (idwl + 1); }

// ---------------------------------------------------------------------------
// Psychoacoustic / allocation tuning constants
// ---------------------------------------------------------------------------
// Transient detection.  Deliberately conservative: a sub block has to exceed the
// smoothed running peak by 12 dB before short blocks are selected, so gentle
// attacks stay in long blocks and produce the pre-echo that real MiniDisc
// hardware produces.  Reproducing that artefact is the point of the plugin.
inline constexpr double kTransientRatio = 4.0;
inline constexpr double kTransientFloor = 1.0e-4;
inline constexpr double kTransientDecay = 0.75;

// Bit allocation.  btot_i = T * bvar_i + (1 - T) * bfix_i + offset with T the
// tonality (1 - spectral flatness).  bvar is the log2 amplitude of the BFU
// relative to the unit mean, bfix is a fixed 6 -> 1 bit ramp across the spectrum.
inline constexpr double kEnergyFloor = 1.0e-30;
inline constexpr double kFixedProfileTop = 6.0;
inline constexpr double kFixedProfileSlope = 5.0;
inline constexpr int kMaxIdwl = 15;
inline constexpr double kAllocSearchSpan = 128.0;
inline constexpr std::size_t kAllocSearchIterations = 24u;
// A BFU is considered occupied when its peak is within 80 dB of the unit peak.
inline constexpr double kBfuActivityFloor = 1.0e-4;

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------
// One channel.  encodeUnit() consumes one sound unit (512 samples at 44.1 kHz)
// and emits the sound unit of the *previous* call, because an MDCT frame needs
// the first samples of the following unit.  That is one sound unit of
// algorithmic delay.
class Atrac1Encoder {
public:
  void prepare(const Mdct *mdct) {
    mdct_ = mdct;
    qmf1_.prepare(kSoundUnitSamples);
    qmf2_.prepare(kSoundUnitSamples / 2u);
    highDelay_.prepare(kHighAnalysisDelay);
    for (std::size_t b = 0; b < kBandCount; ++b) {
      hist_[b].assign(3u * kBandSamples[b], 0.0);
    }
    lo0_.assign(kSoundUnitSamples / 2u, 0.0);
    hi_.assign(kSoundUnitSamples / 2u, 0.0);
    hiDelayed_.assign(kSoundUnitSamples / 2u, 0.0);
    band_[0].assign(kBandSamples[0], 0.0);
    band_[1].assign(kBandSamples[1], 0.0);
    band_[2].assign(kBandSamples[2], 0.0);
    frameIn_.assign(2u * kMaxBlockSize, 0.0);
    frameOut_.assign(kMaxBlockSize, 0.0);
    spectrum_.assign(kSoundUnitSamples, 0.0);
    bfuPeak_.assign(kBfuCount, 0.0);
    bfuEnergy_.assign(kBfuCount, 0.0);
    bfuBits_.assign(kBfuCount, 0.0);
    reset();
  }

  void reset() noexcept {
    qmf1_.reset();
    qmf2_.reset();
    highDelay_.reset();
    for (std::size_t b = 0; b < kBandCount; ++b) {
      std::fill(hist_[b].begin(), hist_[b].end(), 0.0);
      trackPeak_[b] = 0.0;
      shortHold_[b] = 0u;
    }
    std::fill(spectrum_.begin(), spectrum_.end(), 0.0);
  }

  // Test-only oracle hook (plan 7.2 item 1).  In transparent mode the allocation
  // loop is skipped and every BFU is coded with the longest word length, which
  // turns the coding loss into a 16 bit rounding error and lets native_test.cpp
  // observe the QMF alias cancellation and the MDCT time domain alias
  // cancellation on their own.  Production never enables it; the resulting unit
  // deliberately exceeds the 1,696 bit budget and is never serialised.
  void setTransparent(bool transparent) noexcept { transparent_ = transparent; }

  void encodeUnit(const double *pcm, SoundUnit &unit) noexcept {
    // --- QMF analysis -------------------------------------------------------
    qmf1_.process(pcm, kSoundUnitSamples, lo0_.data(), hi_.data());
    qmf2_.process(lo0_.data(), kSoundUnitSamples / 2u, band_[0].data(), band_[1].data());
    highDelay_.process(hi_.data(), kSoundUnitSamples / 2u, hiDelayed_.data());
    std::copy(hiDelayed_.begin(), hiDelayed_.end(), band_[2].begin());

    // --- append to the per band history (3 units) ---------------------------
    for (std::size_t b = 0; b < kBandCount; ++b) {
      const std::size_t n = kBandSamples[b];
      double *h = hist_[b].data();
      std::copy(h + n, h + 3u * n, h);
      std::copy(band_[b].begin(), band_[b].end(), h + 2u * n);
    }

    // --- transform the middle unit -----------------------------------------
    unit.clear();
    std::fill(spectrum_.begin(), spectrum_.end(), 0.0);
    for (std::size_t b = 0; b < kBandCount; ++b) {
      const std::size_t n = kBandSamples[b];
      const double *h = hist_[b].data();
      const bool shortMode = detectShort(b, h + n, n);
      unit.blockMode[b] = shortMode ? 1u : 0u;
      double *spec = spectrum_.data() + kBandBase[b];
      if (!shortMode) {
        for (std::size_t i = 0; i < 2u * n; ++i) {
          frameIn_[i] = h[n / 2u + i] * mdctWindow(n, i);
        }
        mdct_->forward(n, frameIn_.data(), frameOut_.data());
        storeBlock(b, frameOut_.data(), n, spec);
      } else {
        const std::size_t sub = kShortBlockSize;
        const std::size_t nsub = kShortBlocks[b];
        for (std::size_t j = 0; j < nsub; ++j) {
          const std::size_t origin = n + sub * j - kOverlapSamples / 2u;
          for (std::size_t i = 0; i < 2u * sub; ++i) {
            frameIn_[i] = h[origin + i] * mdctWindow(sub, i);
          }
          mdct_->forward(sub, frameIn_.data(), frameOut_.data());
          storeBlock(b, frameOut_.data(), sub, spec + sub * j);
        }
      }
    }
    for (std::size_t i = 0; i < kSoundUnitSamples; ++i) {
      spectrum_[i] *= kSpectrumScale;
    }

    quantize(unit);
  }

private:
  // Mid and high band subband signals are frequency reversed by the QMF
  // decimation, so their MDCT coefficients are stored in reverse order.  This is
  // a pure bookkeeping permutation (undone bit exactly on decode) whose only
  // effect is to make the BFU index monotone in real frequency.
  static void storeBlock(std::size_t band, const double *src, std::size_t count,
                         double *dst) noexcept {
    if (band == 0u) {
      std::copy(src, src + count, dst);
    } else {
      for (std::size_t i = 0; i < count; ++i) {
        dst[i] = src[count - 1u - i];
      }
    }
  }

  bool detectShort(std::size_t band, const double *x, std::size_t count) noexcept {
    const std::size_t nsub = kShortBlocks[band];
    const std::size_t seg = count / nsub;
    bool attack = false;
    double running = trackPeak_[band];
    for (std::size_t s = 0; s < nsub; ++s) {
      double peak = 0.0;
      for (std::size_t i = 0; i < seg; ++i) {
        peak = std::max(peak, std::fabs(x[s * seg + i]));
      }
      if (peak > kTransientFloor && peak > kTransientRatio * running) {
        attack = true;
      }
      running = kTransientDecay * running + (1.0 - kTransientDecay) * peak;
    }
    trackPeak_[band] = running;
    const bool shortMode = attack || (shortHold_[band] != 0u);
    shortHold_[band] = attack ? 1u : 0u;
    return shortMode;
  }

  std::size_t bitsForOffset(const SoundUnit &unit, double offset) const noexcept {
    std::size_t total = kFixedOverheadBits + kSideInfoBitsPerBfu * unit.bfuCount;
    for (std::size_t i = 0; i < unit.bfuCount; ++i) {
      const int wl = wordLengthForIdwl(idwlForOffset(i, offset));
      if (wl > 0) {
        total += static_cast<std::size_t>(wl) * kSpecsPerBfu[i];
      }
    }
    return total;
  }

  int idwlForOffset(std::size_t bfu, double offset) const noexcept {
    const double v = std::floor(bfuBits_[bfu] + offset + 0.5);
    if (v <= 0.0) {
      return 0;
    }
    if (v >= static_cast<double>(kMaxIdwl)) {
      return kMaxIdwl;
    }
    return static_cast<int>(v);
  }

  void quantize(SoundUnit &unit) noexcept {
    if (transparent_) {
      quantizeTransparent(unit);
      return;
    }
    // --- per BFU statistics -------------------------------------------------
    double globalPeak = 0.0;
    for (std::size_t i = 0; i < kBfuCount; ++i) {
      const std::size_t band = bfuBand(i);
      const std::size_t start = bfuStart(i, unit.blockMode[band] != 0u);
      const std::size_t width = kSpecsPerBfu[i];
      double peak = 0.0;
      double energy = 0.0;
      for (std::size_t k = 0; k < width; ++k) {
        const double v = spectrum_[start + k];
        peak = std::max(peak, std::fabs(v));
        energy += v * v;
      }
      bfuPeak_[i] = peak;
      bfuEnergy_[i] = energy / static_cast<double>(width);
      globalPeak = std::max(globalPeak, peak);
    }

    // --- active BFU count ---------------------------------------------------
    const double activity = globalPeak * kBfuActivityFloor;
    std::size_t need = 0;
    for (std::size_t i = 0; i < kBfuCount; ++i) {
      if (bfuPeak_[i] > activity && bfuPeak_[i] > 0.0) {
        need = i + 1u;
      }
    }
    if (need < kBfuAmountTable[0]) {
      need = kBfuAmountTable[0];
    }
    std::uint8_t amountIndex = static_cast<std::uint8_t>(kBfuAmountTable.size() - 1u);
    for (std::size_t j = 0; j < kBfuAmountTable.size(); ++j) {
      if (kBfuAmountTable[j] >= need) {
        amountIndex = static_cast<std::uint8_t>(j);
        break;
      }
    }
    unit.bfuAmountIndex = amountIndex;
    unit.bfuCount = kBfuAmountTable[amountIndex];

    // --- tonality (1 - spectral flatness over the active BFUs) --------------
    double logSum = 0.0;
    double linSum = 0.0;
    for (std::size_t i = 0; i < unit.bfuCount; ++i) {
      const double e = bfuEnergy_[i] + kEnergyFloor;
      logSum += std::log(e);
      linSum += e;
    }
    const double count = static_cast<double>(unit.bfuCount);
    const double geo = std::exp(logSum / count);
    const double arith = linSum / count;
    double tonality = 1.0 - ((arith > 0.0) ? (geo / arith) : 1.0);
    tonality = std::min(1.0, std::max(0.0, tonality));

    // --- per BFU target bits ------------------------------------------------
    double lgMean = 0.0;
    for (std::size_t i = 0; i < unit.bfuCount; ++i) {
      bfuBits_[i] = 0.5 * std::log2(bfuEnergy_[i] + kEnergyFloor);
      lgMean += bfuBits_[i];
    }
    lgMean /= count;
    double maxBits = 0.0;
    for (std::size_t i = 0; i < unit.bfuCount; ++i) {
      const std::size_t band = bfuBand(i);
      double fc;
      if (unit.blockMode[band] == 0u) {
        // Long mode: kBfuStartLong is a genuine spectral offset (see tables.h for
        // the caveat that it is only monotone with frequency inside each band, not
        // across the low/mid/high boundary), so the ramp is evaluated directly
        // against it.
        fc = (static_cast<double>(kBfuStartLong[i]) + 0.5 * static_cast<double>(kSpecsPerBfu[i])) /
             static_cast<double>(kSoundUnitSamples);
      } else {
        // Short mode: kBfuStartShort folds the sub-block (time) index together
        // with the intra sub-block frequency offset, so it cannot be read as a
        // frequency position directly -- every BFU group repeats once per
        // sub-block at the same intra offset. Recover that intra offset and
        // rescale it from the 32-sample sub-block to the band's full spectral
        // width so all BFUs that describe the same frequency slice (one per
        // sub-block) get the same fc regardless of which sub-block produced them.
        const std::size_t intra = (kBfuStartShort[i] - kBandBase[band]) % kShortBlockSize;
        fc = (static_cast<double>(kBandBase[band]) +
              (static_cast<double>(intra) + 0.5 * static_cast<double>(kSpecsPerBfu[i])) *
                  static_cast<double>(kBandSamples[band]) / static_cast<double>(kShortBlockSize)) /
             static_cast<double>(kSoundUnitSamples);
      }
      const double bfix = kFixedProfileTop - kFixedProfileSlope * fc;
      const double bvar = bfuBits_[i] - lgMean;
      bfuBits_[i] = tonality * bvar + (1.0 - tonality) * bfix;
      maxBits = std::max(maxBits, bfuBits_[i]);
    }
    for (std::size_t i = unit.bfuCount; i < kBfuCount; ++i) {
      bfuBits_[i] = 0.0;
    }

    // --- bounded deterministic search for the allocation offset -------------
    // lo starts at an offset that forces every IDWL to 0, which costs
    // 40 + 10*52 = 560 bits and therefore always fits; the loop keeps lo
    // feasible, so the search can never fail.
    double lo = -(maxBits + 1.0);
    double hi = lo + kAllocSearchSpan;
    for (std::size_t it = 0; it < kAllocSearchIterations; ++it) {
      const double mid = 0.5 * (lo + hi);
      if (bitsForOffset(unit, mid) <= kSoundUnitBits) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    // --- scale factors and quantisation ------------------------------------
    for (std::size_t i = 0; i < kBfuCount; ++i) {
      const std::size_t band = bfuBand(i);
      const std::size_t start = bfuStart(i, unit.blockMode[band] != 0u);
      const std::size_t width = kSpecsPerBfu[i];
      const int wl = (i < unit.bfuCount) ? wordLengthForIdwl(idwlForOffset(i, lo)) : 0;
      unit.wordLength[i] = static_cast<std::uint8_t>(wl);
      if (wl == 0) {
        unit.scaleFactorIndex[i] = 0u;
        for (std::size_t k = 0; k < width; ++k) {
          unit.quantized[start + k] = 0;
        }
        continue;
      }
      std::size_t sfi = 0;
      while (sfi + 1u < kScaleFactor.size() && kScaleFactor[sfi] < bfuPeak_[i]) {
        ++sfi;
      }
      unit.scaleFactorIndex[i] = static_cast<std::uint8_t>(sfi);
      const double sf = kScaleFactor[sfi];
      const int maxq = (1 << (wl - 1)) - 1;
      const int minq = -(1 << (wl - 1));
      const double gain = static_cast<double>(maxq) / sf;
      for (std::size_t k = 0; k < width; ++k) {
        // Clamp in double precision before narrowing to int32_t: std::lround
        // returns a `long`, whose width (32 bit on MSVC/wasm32, 64 bit on
        // Linux/macOS x86-64/arm64) makes the post-round overflow behaviour
        // platform dependent once |spectrum_ * gain| exceeds 2^31. Rounding and
        // clamping in double avoids that divergence entirely.
        const double scaled = spectrum_[start + k] * gain;
        const std::int32_t q = static_cast<std::int32_t>(std::max(
            static_cast<double>(minq), std::min(static_cast<double>(maxq), std::round(scaled))));
        unit.quantized[start + k] = q;
      }
    }
    unit.usedBits = static_cast<std::uint32_t>(bitsForOffset(unit, lo));
  }

  void quantizeTransparent(SoundUnit &unit) noexcept {
    unit.bfuAmountIndex = static_cast<std::uint8_t>(kBfuAmountTable.size() - 1u);
    unit.bfuCount = kBfuAmountTable[unit.bfuAmountIndex];
    constexpr int kTransparentWordLength = 16;
    for (std::size_t i = 0; i < kBfuCount; ++i) {
      const std::size_t band = bfuBand(i);
      const std::size_t start = bfuStart(i, unit.blockMode[band] != 0u);
      const std::size_t width = kSpecsPerBfu[i];
      double peak = 0.0;
      for (std::size_t k = 0; k < width; ++k) {
        peak = std::max(peak, std::fabs(spectrum_[start + k]));
      }
      std::size_t sfi = 0;
      while (sfi + 1u < kScaleFactor.size() && kScaleFactor[sfi] < peak) {
        ++sfi;
      }
      unit.wordLength[i] = static_cast<std::uint8_t>(kTransparentWordLength);
      unit.scaleFactorIndex[i] = static_cast<std::uint8_t>(sfi);
      const int maxq = (1 << (kTransparentWordLength - 1)) - 1;
      const int minq = -(1 << (kTransparentWordLength - 1));
      const double gain = static_cast<double>(maxq) / kScaleFactor[sfi];
      for (std::size_t k = 0; k < width; ++k) {
        // See the matching comment in quantize(): clamp in double before
        // narrowing so the result does not depend on the platform width of
        // `long`.
        const double scaled = spectrum_[start + k] * gain;
        const std::int32_t q = static_cast<std::int32_t>(std::max(
            static_cast<double>(minq), std::min(static_cast<double>(maxq), std::round(scaled))));
        unit.quantized[start + k] = q;
      }
    }
    std::size_t bits = kFixedOverheadBits + kSideInfoBitsPerBfu * unit.bfuCount;
    for (std::size_t i = 0; i < unit.bfuCount; ++i) {
      bits += static_cast<std::size_t>(kTransparentWordLength) * kSpecsPerBfu[i];
    }
    unit.usedBits = static_cast<std::uint32_t>(bits);
  }

  bool transparent_ = false;
  const Mdct *mdct_ = nullptr;
  QmfAnalysis qmf1_;
  QmfAnalysis qmf2_;
  DelayLine highDelay_;
  std::array<std::vector<double>, kBandCount> hist_{};
  std::array<std::vector<double>, kBandCount> band_{};
  std::vector<double> lo0_;
  std::vector<double> hi_;
  std::vector<double> hiDelayed_;
  std::vector<double> frameIn_;
  std::vector<double> frameOut_;
  std::vector<double> spectrum_;
  std::vector<double> bfuPeak_;
  std::vector<double> bfuEnergy_;
  std::vector<double> bfuBits_;
  std::array<double, kBandCount> trackPeak_{};
  std::array<std::uint8_t, kBandCount> shortHold_{};
};

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------
// decodeUnit() consumes the sound unit of frame t and emits the band block
// [(t-1)B, tB), which is fully overlap-added at that point.  That is a second
// sound unit of algorithmic delay; emitting the natural block of frame t would
// need the first 16 samples of frame t+1 and, because the -16 sample offset is a
// different number of host samples in the fs/4 and fs/2 bands, would also
// de-register the three bands from each other.
class Atrac1Decoder {
public:
  void prepare(const Mdct *mdct) {
    mdct_ = mdct;
    qmf1_.prepare(kSoundUnitSamples / 2u);
    qmf2_.prepare(kSoundUnitSamples / 4u);
    highDelay_.prepare(kHighSynthesisDelay);
    for (std::size_t b = 0; b < kBandCount; ++b) {
      acc_[b].assign(kBandSamples[b] + kOverlapSamples, 0.0);
      emitHold_[b].assign(kBandSamples[b], 0.0);
      band_[b].assign(kBandSamples[b], 0.0);
    }
    frameOut_.assign(2u * kMaxBlockSize, 0.0);
    coeff_.assign(kMaxBlockSize, 0.0);
    spectrum_.assign(kSoundUnitSamples, 0.0);
    hiDelayed_.assign(kSoundUnitSamples / 2u, 0.0);
    lo0_.assign(kSoundUnitSamples / 2u, 0.0);
    reset();
  }

  void reset() noexcept {
    qmf1_.reset();
    qmf2_.reset();
    highDelay_.reset();
    for (std::size_t b = 0; b < kBandCount; ++b) {
      std::fill(acc_[b].begin(), acc_[b].end(), 0.0);
      std::fill(emitHold_[b].begin(), emitHold_[b].end(), 0.0);
      std::fill(band_[b].begin(), band_[b].end(), 0.0);
    }
    std::fill(spectrum_.begin(), spectrum_.end(), 0.0);
  }

  void decodeUnit(const SoundUnit &unit, double *pcm) noexcept {
    dequantize(unit);
    for (std::size_t b = 0; b < kBandCount; ++b) {
      const std::size_t n = kBandSamples[b];
      double *acc = acc_[b].data();
      // slide the accumulator by one band block
      std::copy(acc + n, acc + n + kOverlapSamples, acc);
      std::fill(acc + kOverlapSamples, acc + n + kOverlapSamples, 0.0);

      const bool shortMode = unit.blockMode[b] != 0u;
      const double *spec = spectrum_.data() + kBandBase[b];
      if (!shortMode) {
        loadBlock(b, spec, n, coeff_.data());
        mdct_->inverse(n, coeff_.data(), frameOut_.data());
        const std::size_t lo = n / 2u - kOverlapSamples / 2u;
        const std::size_t hi = 3u * (n / 2u) + kOverlapSamples / 2u;
        for (std::size_t i = lo; i < hi; ++i) {
          acc[i - lo] += frameOut_[i] * mdctWindow(n, i);
        }
      } else {
        const std::size_t sub = kShortBlockSize;
        const std::size_t nsub = kShortBlocks[b];
        for (std::size_t j = 0; j < nsub; ++j) {
          loadBlock(b, spec + sub * j, sub, coeff_.data());
          mdct_->inverse(sub, coeff_.data(), frameOut_.data());
          for (std::size_t i = 0; i < 2u * sub; ++i) {
            acc[sub * j + i] += frameOut_[i] * mdctWindow(sub, i);
          }
        }
      }

      // emit [(t-1)B, tB) = emitHold[16..B) followed by acc[0..16)
      double *out = band_[b].data();
      const std::size_t h = kOverlapSamples / 2u;
      std::copy(emitHold_[b].begin() + static_cast<std::ptrdiff_t>(h), emitHold_[b].end(), out);
      std::copy(acc, acc + h, out + (n - h));
      std::copy(acc, acc + n, emitHold_[b].begin());
    }

    highDelay_.process(band_[2].data(), kSoundUnitSamples / 2u, hiDelayed_.data());
    qmf2_.process(band_[0].data(), band_[1].data(), kSoundUnitSamples / 4u, lo0_.data());
    qmf1_.process(lo0_.data(), hiDelayed_.data(), kSoundUnitSamples / 2u, pcm);
  }

private:
  static void loadBlock(std::size_t band, const double *src, std::size_t count,
                        double *dst) noexcept {
    if (band == 0u) {
      std::copy(src, src + count, dst);
    } else {
      for (std::size_t i = 0; i < count; ++i) {
        dst[i] = src[count - 1u - i];
      }
    }
  }

  void dequantize(const SoundUnit &unit) noexcept {
    std::fill(spectrum_.begin(), spectrum_.end(), 0.0);
    const double inv = 1.0 / kSpectrumScale;
    for (std::size_t i = 0; i < unit.bfuCount && i < kBfuCount; ++i) {
      const int wl = static_cast<int>(unit.wordLength[i]);
      if (wl <= 0) {
        continue;
      }
      const std::size_t band = bfuBand(i);
      const std::size_t start = bfuStart(i, unit.blockMode[band] != 0u);
      const std::size_t width = kSpecsPerBfu[i];
      const double sf = kScaleFactor[unit.scaleFactorIndex[i]];
      const int maxq = (1 << (wl - 1)) - 1;
      const double gain = sf / static_cast<double>(maxq) * inv;
      for (std::size_t k = 0; k < width; ++k) {
        spectrum_[start + k] = static_cast<double>(unit.quantized[start + k]) * gain;
      }
    }
  }

  const Mdct *mdct_ = nullptr;
  QmfSynthesis qmf1_;
  QmfSynthesis qmf2_;
  DelayLine highDelay_;
  std::array<std::vector<double>, kBandCount> acc_{};
  std::array<std::vector<double>, kBandCount> emitHold_{};
  std::array<std::vector<double>, kBandCount> band_{};
  std::vector<double> frameOut_;
  std::vector<double> coeff_;
  std::vector<double> spectrum_;
  std::vector<double> hiDelayed_;
  std::vector<double> lo0_;
};

// ---------------------------------------------------------------------------
// One codec channel (encoder immediately followed by decoder)
// ---------------------------------------------------------------------------
// Total algorithmic delay, in samples at the codec rate:
//   stage 1 QMF round trip                                47
//   stage 2 QMF round trip (47 at fs/2)                   94
//   MDCT pipeline (encoder 1 unit + decoder 1 unit)     1024
//                                                      -----
//                                                       1165
// native_test.cpp measures this with an impulse and asserts the constant.
inline constexpr std::size_t kCodecDelaySamples =
    kQmfDelay + 2u * kQmfDelay + 2u * kSoundUnitSamples;

// Test-only kernel inspection payload (see et_md_copy_diagnostic in kernel.cpp).
struct KernelDiagnostic {
  std::array<SoundUnit, 2u> unit{};
  std::uint32_t completedUnits = 0u;
  std::uint32_t outputUnderflows = 0u;
  std::uint32_t outputOverflows = 0u;
  std::uint32_t latencySamples = 0u;
  std::uint32_t baseRate = 0u;
  std::uint32_t halfbandStages = 0u;
  std::uint32_t primeSamples = 0u;
  std::uint32_t activeChannels = 0u;
  std::uint32_t rationalStages = 0u;
  // 0 = SP (ATRAC1), 1 = LP2, 2 = LP4 (both ATRAC3).
  std::uint32_t activeMode = 0u;
  std::uint32_t lpFrameBits = 0u;
  std::uint32_t lpBudgetBits = 0u;
  std::uint32_t kernelObjectBytes = 0u;
};

class Atrac1Channel {
public:
  void prepare(const Mdct *mdct) {
    encoder_.prepare(mdct);
    decoder_.prepare(mdct);
    unit_.clear();
  }

  void reset() noexcept {
    encoder_.reset();
    decoder_.reset();
    unit_.clear();
  }

  void processUnit(const double *in, double *out) noexcept {
    encoder_.encodeUnit(in, unit_);
    decoder_.decodeUnit(unit_, out);
  }

  const SoundUnit &lastUnit() const noexcept { return unit_; }
  SoundUnit &lastUnit() noexcept { return unit_; }

  Atrac1Encoder &encoder() noexcept { return encoder_; }
  Atrac1Decoder &decoder() noexcept { return decoder_; }

private:
  Atrac1Encoder encoder_;
  Atrac1Decoder decoder_;
  SoundUnit unit_;
};

} // namespace effetune::md_simulator

#endif
