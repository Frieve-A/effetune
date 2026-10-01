// Tonal Balance EQ native tests: plan P1 checks C1-C7 (C8 is the build itself).
// The kernel is read only through its parameters, audio and telemetry frame 29;
// band spectra are computed with the shared analysis header. Release judges every
// check (statistical ones at 44.1 and 96 kHz stereo, two seeds); Debug runs a short
// full-matrix smoke and judges each deterministic check at 48 kHz, stereo, 480 frames.
// Optional argument: a comma-separated subset of c1,c1a,c1t,c2,c3,c5,c6,c7,preview (C4 rides on
// C1).
//
// CTest wall time (WSL GCC 11): Release 110.0 s, Debug 66.4 s (limit 375 s each).

#include "../five_band_peq/peq_coefficients.h"
#include "AutomationCatalog.h"
#include "TonalBalanceEQPluginParams.h"
#include "allocation_guard.h"
#include "calibration_tables.h"
#include "effetune/kernel.h"
#include "effetune/telemetry.h"
#include "engine.h"
#include "target_tables.h"

#include <pffft.h>

#include <array>
#include <chrono>
#include <cmath>
#include <complex>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <new>
#include <string_view>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_TonalBalanceEQPlugin() noexcept;

namespace {

namespace tb = effetune::plugins::eq::tonal_balance;
namespace gen = effetune::generated;
using Params = gen::TonalBalanceEQPluginParams;
using tb::kBandCount;
using tb::kGridCount;
using Bands = std::array<double, kBandCount>;

#ifdef NDEBUG
constexpr bool kRelease = true;
#else
constexpr bool kRelease = false;
#endif

constexpr double kPi = 3.14159265358979323846;
constexpr std::uint32_t kPayloadBytes = 1564u;
constexpr double kJnd = 0.5;                    // dB, level limen of broadband noise
constexpr double kEpsL = 0.1;                   // LU, EBU Tech 3341 meter tolerance
constexpr double kRisk = 0.0026997960632601866; // p = 2 Phi(-3), the design's per-decision risk
constexpr std::uint8_t kFlagFloor = 0x02u;
constexpr std::uint8_t kFlagHasTarget = 0x04u;
constexpr std::uint8_t kFlagHasLevel = 0x08u;
constexpr std::uint8_t kFlagInRange = 0x10u;
constexpr std::uint32_t kAll = 0u;                     // S-27: only Target index 0 (All) is stable
constexpr std::uint32_t kTilt = tb::kTargetStyleCount; // S-7: Target Tilt follows the styles
constexpr std::uint32_t kAdjustBands = 5u;

// ---------------------------------------------------------------------------
// eps_fit (Q-1, impl/p1k/q-decisions.md): in-range max error in dB of the adopted
// form (one hold point per side, plain sections) per case family, sample rate
// (44.1/48/96/192 kHz) and High. Unqualified: the largest entry at the sample
// rate and High; High <= 16 kHz uses the 16 kHz column.
// Q-1 decision: kHoldPointsPerSide = 1. Worst in-range error / outside rise (dB):
//   hold 0: 1.054 / +2.629 (rejected); hold 1: 1.110 / +1.015 (adopted);
//   hold 2, 3: 1.110 / +1.015; Nyquist-section forms: 1.442..1.490 / +0.182..+0.709.
//   Error: max |cascade - 41-band curve| on an 800-point log grid 20 Hz..High; rise:
//   max rise at 5-16 Hz re 20 Hz and at >= 25 kHz (21 kHz at 44.1/48 kHz) up to
//   min(40 kHz, 0.499 fs) re 20 kHz. Rule: a form passes when its worst rise on the
//   tilt, hold and random rows is <= its own worst in-range error (dips report only).
// Q-3 decision: the Nyquist-gain form was not adopted (worse in every cell: random
//   set 0.634 vs 0.521 at 44.1 kHz, equal 0.521 at 96 kHz; tilt -1.5 at 44.1 kHz /
//   20 kHz 1.490 vs 1.110). High's default stays 16 kHz; the code was removed (S-28).
// ---------------------------------------------------------------------------
struct EpsFitRow {
  const char *family;
  std::array<double, 4> high16k;
  std::array<double, 4> high20k;
};
constexpr std::array<EpsFitRow, 8> kEpsFit = {{
    {"tilt -1.5 dB/oct", {0.327, 0.432, 0.316, 0.277}, {1.110, 0.730, 0.407, 0.368}},
    {"tilt +1.5 dB/oct", {0.270, 0.270, 0.270, 0.270}, {0.270, 0.270, 0.270, 0.270}},
    {"LF hold -6 dB < 60 Hz", {0.089, 0.089, 0.089, 0.089}, {0.089, 0.089, 0.089, 0.089}},
    {"HF hold -6 dB > 8 kHz", {0.121, 0.157, 0.083, 0.069}, {0.435, 0.306, 0.136, 0.120}},
    {"dip 25 Hz 1/3 oct (report)", {0.208, 0.208, 0.208, 0.208}, {0.211, 0.211, 0.211, 0.211}},
    {"dip 16 kHz 1/3 oct (report)", {0.193, 0.221, 0.313, 0.324}, {0.287, 0.278, 0.431, 0.451}},
    {"random 1/2 oct", {0.347, 0.347, 0.347, 0.347}, {0.521, 0.364, 0.351, 0.351}},
    {"random 1/3 oct", {0.513, 0.513, 0.513, 0.513}, {0.521, 0.521, 0.521, 0.521}},
}};

double epsFit(double fs, double high, std::uint32_t first = 0u, std::uint32_t last = 7u) {
  const std::uint32_t rate = fs < 46000.0 ? 0u : (fs < 72000.0 ? 1u : (fs < 144000.0 ? 2u : 3u));
  double eps = 0.0;
  for (std::uint32_t row = first; row <= last; ++row) {
    const double value = high > 16000.0 ? kEpsFit[row].high20k[rate] : kEpsFit[row].high16k[rate];
    eps = value > eps ? value : eps;
  }
  return eps;
}
double epsTilt(double fs, double high) { return epsFit(fs, high, 0u, 1u); }

// z_m = Phi^-1(1 - p / (2 m)).
double zFor(double m) {
  const double tail = kRisk / (2.0 * m);
  double lo = 0.0;
  double hi = 12.0;
  for (int i = 0; i < 200; ++i) {
    const double mid = 0.5 * (lo + hi);
    (0.5 * std::erfc(mid / std::sqrt(2.0)) > tail ? lo : hi) = mid;
  }
  return 0.5 * (lo + hi);
}

// Upper p-quantile of Bin(n, p): min{k : P(X > k) <= p}.
std::uint32_t binomialBound(std::uint32_t n) {
  double cdf = 0.0;
  for (std::uint32_t k = 0; k <= n; ++k) {
    const double log_pmf = std::lgamma(n + 1.0) - std::lgamma(k + 1.0) - std::lgamma(n - k + 1.0) +
                           k * std::log(kRisk) + (n - k) * std::log1p(-kRisk);
    cdf += std::exp(log_pmf);
    if (1.0 - cdf <= kRisk) {
      return k;
    }
  }
  return n;
}

int failures = 0;

void report(bool ok, const char *check, const char *format, ...) {
  std::printf("%s %-4s ", ok ? "PASS" : "FAIL", check);
  va_list args;
  va_start(args, format);
  std::vprintf(format, args);
  va_end(args);
  std::printf("\n");
  std::fflush(stdout);
  failures += ok ? 0 : 1;
}

struct Config {
  double fs;
  std::uint32_t channels;
  std::uint32_t block;
};

double dbPower(double power) { return 10.0 * std::log10(power); }

Params defaults() {
  Params p{};
  p.target = static_cast<float>(kAll);
  p.amount = 100.0F;
  p.range = 6.0F;
  p.smoothing = 0.5F;
  p.averagingTime = 3.0F;
  p.low = 20.0F;
  p.high = 16000.0F;
  p.averageSpl = 83.0F;
  constexpr std::array<float, kAdjustBands> kFrequencies = {100.0F, 316.0F, 1000.0F, 3160.0F,
                                                            10000.0F};
  for (std::uint32_t i = 0; i < kAdjustBands; ++i) {
    p.adjustEnabled[i] = 1.0F;
    p.adjustFrequency[i] = kFrequencies[i];
    p.adjustQ[i] = 0.7F;
  }
  p.tiltSlope = -6.0F;
  p.tiltCorner = 250.0F;
  return p;
}

const gen::AutomationParameterDescriptor *findParameter(std::string_view key) {
  for (const gen::AutomationEffectDescriptor &effect : gen::kAutomationEffects) {
    if (effect.type != "TonalBalanceEQPlugin") {
      continue;
    }
    for (std::uint32_t i = 0; i < effect.parameterCount; ++i) {
      if (gen::kAutomationParameters[effect.firstParameter + i].key == key) {
        return &gen::kAutomationParameters[effect.firstParameter + i];
      }
    }
  }
  return nullptr;
}

// The Averaging Time value automation and pack/unpack treat as the infinite position.
float averagingTimeInfinity() {
  const gen::AutomationParameterDescriptor *at_param = findParameter("at");
  return at_param != nullptr ? at_param->maximum : 100.0F;
}

// ---------------------------------------------------------------------------
// FFT, band meter and frame 29
// ---------------------------------------------------------------------------
class Fft final {
public:
  explicit Fft(std::uint32_t n)
      : n_(n), setup_(pffft_new_setup(static_cast<int>(n), PFFFT_REAL)), in_(alloc(n)),
        out_(alloc(n)), work_(alloc(n)) {}
  ~Fft() {
    pffft_aligned_free(in_);
    pffft_aligned_free(out_);
    pffft_aligned_free(work_);
    pffft_destroy_setup(setup_);
  }
  Fft(const Fft &) = delete;
  Fft &operator=(const Fft &) = delete;
  // Ordered spectrum [DC, Nyquist, re/im 1..]; unscaled.
  const float *forward(const float *x) { return run(x, PFFFT_FORWARD); }
  const float *backward(const float *spectrum) { return run(spectrum, PFFFT_BACKWARD); }
  static std::complex<double> bin(const float *spectrum, std::uint32_t k) {
    return {static_cast<double>(spectrum[2u * k]), static_cast<double>(spectrum[2u * k + 1u])};
  }

private:
  static float *alloc(std::uint32_t n) {
    return static_cast<float *>(pffft_aligned_malloc(sizeof(float) * n));
  }
  const float *run(const float *x, pffft_direction_t direction) {
    std::memcpy(in_, x, sizeof(float) * n_);
    pffft_transform_ordered(setup_, in_, out_, work_, direction);
    return out_;
  }
  std::uint32_t n_;
  PFFFT_Setup *setup_;
  float *in_;
  float *out_;
  float *work_;
};

// Band powers of one analysis frame per channel, exactly as the kernel measures them.
class BandMeter final {
public:
  explicit BandMeter(double fs) : observation_(std::make_unique<tb::HopObservation>()) {
    analyzer_.prepare(fs);
    fft_ = std::make_unique<Fft>(analyzer_.fftSize());
    windowed_.assign(analyzer_.fftSize(), 0.0F);
  }
  [[nodiscard]] const tb::FrameAnalyzer &analyzer() const { return analyzer_; }
  [[nodiscard]] std::uint32_t size() const { return analyzer_.fftSize(); }
  [[nodiscard]] double binHz() const { return analyzer_.sampleRate() / analyzer_.fftSize(); }
  Bands power(const std::vector<const float *> &frames) {
    analyzer_.beginHop(*observation_);
    const auto count = static_cast<std::uint32_t>(frames.size());
    for (std::uint32_t c = 0; c < count; ++c) {
      analyzer_.applyWindow(frames[c], windowed_.data(), 0u, analyzer_.fftSize());
      analyzer_.accumulateChannel(fft_->forward(windowed_.data()),
                                  effetune::dsp::k_weighting::channelWeight(c, count), c,
                                  *observation_);
    }
    analyzer_.finishHop(*observation_);
    return observation_->own;
  }
  [[nodiscard]] int bandOf(std::uint32_t bin) const {
    for (std::uint32_t b = 0; b < analyzer_.measuredBandCount(); ++b) {
      if (bin >= analyzer_.bandBinBegin(b) && bin < analyzer_.bandBinEnd(b)) {
        return static_cast<int>(b);
      }
    }
    return -1;
  }

private:
  tb::FrameAnalyzer analyzer_;
  std::unique_ptr<tb::HopObservation> observation_;
  std::unique_ptr<Fft> fft_;
  std::vector<float> windowed_;
};

float readF32(const std::uint8_t *p) {
  float value;
  std::memcpy(&value, p, sizeof(value));
  return value;
}

struct Frame {
  std::uint8_t state = 0u;
  float loudness = 0.0F;
  float makeup = 0.0F;
  std::uint32_t gated = 0u;
  std::array<float, kBandCount> level{}, persistence{}, presence{}, command{}, mu{}, sigma{};
  std::array<std::uint8_t, kBandCount> flags{};
  std::array<float, kGridCount> response{};

  static Frame parse(const std::uint8_t *p) {
    Frame f;
    f.state = p[8];
    f.loudness = readF32(p + 12);
    f.makeup = readF32(p + 16);
    std::memcpy(&f.gated, p + 20, sizeof(f.gated));
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      f.level[b] = readF32(p + 24 + 4 * b);
      f.persistence[b] = readF32(p + 188 + 4 * b);
      f.presence[b] = readF32(p + 352 + 4 * b);
      f.command[b] = readF32(p + 516 + 4 * b);
      f.mu[b] = readF32(p + 680 + 4 * b);
      f.sigma[b] = readF32(p + 844 + 4 * b);
      f.flags[b] = p[1008 + b];
    }
    for (std::uint32_t i = 0; i < kGridCount; ++i) {
      f.response[i] = readF32(p + 1052 + 4 * i);
    }
    return f;
  }
  [[nodiscard]] bool has(std::uint32_t b, std::uint8_t mask) const {
    return (flags[b] & mask) == mask;
  }
  // levelDb_b of the kernel (Averaging-Time-integrated band power in dB).
  [[nodiscard]] double levelDb(std::uint32_t b, const Params &p) const {
    return static_cast<double>(level[b]) + loudness - p.averageSpl;
  }
  // Largest pre-shift command over the corrected range (the cut-only shift).
  [[nodiscard]] double shift() const {
    double maximum = -1e30;
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      if (has(b, kFlagInRange)) {
        maximum = command[b] > maximum ? command[b] : maximum;
      }
    }
    return maximum > -1e29 ? maximum : 0.0;
  }
  // Frame response (makeup included) at frequency f, linear on the log grid.
  [[nodiscard]] double responseAt(double f) const {
    double x = std::log(f / 20.0) / std::log(1000.0) * 127.0;
    x = x < 0.0 ? 0.0 : (x > 127.0 ? 127.0 : x);
    const auto i = static_cast<std::uint32_t>(x >= 127.0 ? 126.0 : x);
    const double t = x - i;
    return response[i] + t * (response[i + 1u] - response[i]);
  }
  // Realised curve handed to the designer: shifted command with edge hold, sampled
  // linearly in log2 f between band centres.
  [[nodiscard]] double curveAt(double f) const {
    std::uint32_t first = kBandCount;
    std::uint32_t last = 0u;
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      if (has(b, kFlagInRange)) {
        first = first == kBandCount ? b : first;
        last = b;
      }
    }
    Bands curve{};
    const double top = shift();
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      const std::uint32_t source = b < first ? first : (b > last ? last : b);
      curve[b] = first == kBandCount ? 0.0 : command[source] - top;
    }
    const double x = std::log2(f);
    if (x <= std::log2(tb::bandCentreHz(0u))) {
      return curve[0];
    }
    for (std::uint32_t b = 0; b + 1u < kBandCount; ++b) {
      const double x0 = std::log2(tb::bandCentreHz(b));
      const double x1 = std::log2(tb::bandCentreHz(b + 1u));
      if (x < x1) {
        return curve[b] + (x - x0) / (x1 - x0) * (curve[b + 1u] - curve[b]);
      }
    }
    return curve[kBandCount - 1u];
  }
};

// ---------------------------------------------------------------------------
// Kernel harness and streaming run
// ---------------------------------------------------------------------------
class Plugin final {
public:
  explicit Plugin(const Config &config)
      : descriptor_(et_kernel_descriptor_TonalBalanceEQPlugin()), ring_storage_(65536u),
        buffer_(65536u) {
    storage_ =
        ::operator new(descriptor_->objectSize, std::align_val_t(descriptor_->objectAlignment));
    kernel_ = descriptor_->construct(storage_);
    kernel_->prepare({static_cast<float>(config.fs), config.channels, config.block});
    ok_ = kernel_->preparedSuccessfully() && descriptor_->paramsHash == Params::kHash &&
          kernel_->latencySamples() == 0u;
    ring_.adopt(ring_storage_.data(), static_cast<std::uint32_t>(ring_storage_.size()));
  }
  ~Plugin() {
    descriptor_->destroy(kernel_);
    ::operator delete(storage_, std::align_val_t(descriptor_->objectAlignment));
  }
  Plugin(const Plugin &) = delete;
  Plugin &operator=(const Plugin &) = delete;

  [[nodiscard]] bool ok() const { return ok_; }
  bool stage(const Params &p) {
    return kernel_->stageParameters(&p.target, Params::kFloatCount, Params::kHash) == ET_OK;
  }
  // Processes one planar block; returns the frames published during it.
  const std::vector<Frame> &process(float *audio, std::uint32_t channels, std::uint32_t frames) {
    kernel_->applyPendingParameters();
    {
      effetune::allocation_guard::Scope guard;
      kernel_->process(audio, channels, frames, {0.0});
    }
    fresh_.clear();
    std::uint32_t sequence = 0u;
    effetune::TelemetryWriter writer(ring_, 1u, sequence);
    kernel_->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring_.read(buffer_.data(), static_cast<std::uint32_t>(buffer_.size()), &dropped);
    for (std::uint32_t offset = 0u; offset + 16u <= bytes;) {
      std::uint16_t type = 0u;
      std::uint16_t length = 0u;
      std::memcpy(&type, buffer_.data() + offset, 2u);
      std::memcpy(&length, buffer_.data() + offset + 12u, 2u);
      bad_frames_ += (type == 29u && length == kPayloadBytes) ? 0u : 1u;
      if (length == kPayloadBytes) {
        std::memcpy(payload_.data(), buffer_.data() + offset + 16u, kPayloadBytes);
        fresh_.push_back(Frame::parse(payload_.data()));
        latest_ = fresh_.back();
        ++frame_count_;
      }
      offset += (16u + length + 3u) & ~3u;
    }
    return fresh_;
  }
  [[nodiscard]] const Frame &latest() const { return latest_; }
  [[nodiscard]] const std::array<std::uint8_t, kPayloadBytes> &payload() const { return payload_; }
  [[nodiscard]] std::uint32_t frameCount() const { return frame_count_; }
  [[nodiscard]] std::uint32_t badFrames() const { return bad_frames_; }

private:
  const effetune::KernelDescriptor *descriptor_;
  void *storage_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
  effetune::TelemetryRing ring_;
  std::vector<std::uint8_t> ring_storage_;
  std::vector<std::uint8_t> buffer_;
  std::array<std::uint8_t, kPayloadBytes> payload_{};
  std::vector<Frame> fresh_;
  Frame latest_;
  std::uint32_t frame_count_ = 0u;
  std::uint32_t bad_frames_ = 0u;
  bool ok_ = false;
};

// Independent BS.1770-4 integrated loudness (K filter, 400 ms blocks, 75 % overlap).
class Loudness final {
public:
  void prepare(double fs, std::uint32_t channels) {
    highpass_ = effetune::dsp::k_weighting::designHighpass(fs);
    shelf_ = effetune::dsp::k_weighting::designShelf(fs);
    states_.assign(2u * channels, {});
    sub_length_ = static_cast<std::uint32_t>(std::lround(0.1 * fs));
    channels_ = channels;
  }
  void add(const float *planar, std::uint32_t frames) {
    scratch_.assign(frames, 0.0);
    for (std::uint32_t c = 0; c < channels_; ++c) {
      const double weight = effetune::dsp::k_weighting::channelWeight(c, channels_);
      for (std::uint32_t i = 0; i < frames; ++i) {
        const double y = effetune::dsp::processBiquadTdf2Sample(
            effetune::dsp::processBiquadTdf2Sample(planar[c * frames + i], shelf_, states_[2u * c]),
            highpass_, states_[2u * c + 1u]);
        scratch_[i] += weight * y * y;
      }
    }
    for (std::uint32_t i = 0; i < frames; ++i) {
      sum_ += scratch_[i];
      if (++count_ == sub_length_) {
        sub_.push_back(sum_ / sub_length_);
        sum_ = 0.0;
        count_ = 0u;
      }
    }
  }
  [[nodiscard]] double integrated() const {
    std::vector<double> blocks;
    for (std::size_t j = 3; j < sub_.size(); ++j) {
      blocks.push_back(0.25 * (sub_[j - 3] + sub_[j - 2] + sub_[j - 1] + sub_[j]));
    }
    const auto gatedMean = [&blocks](double threshold) {
      double sum = 0.0;
      double n = 0.0;
      for (const double b : blocks) {
        if (b > threshold) {
          sum += b;
          n += 1.0;
        }
      }
      return n > 0.0 ? sum / n : 0.0;
    };
    const double absolute = std::pow(10.0, (-70.0 + 0.691) / 10.0);
    return -0.691 +
           dbPower(gatedMean(gatedMean(absolute) * 0.1 > absolute ? gatedMean(absolute) * 0.1
                                                                  : absolute));
  }

private:
  effetune::dsp::BiquadCoefficients highpass_, shelf_;
  std::vector<effetune::dsp::BiquadTdf2State> states_;
  std::vector<double> scratch_, sub_;
  double sum_ = 0.0;
  std::uint32_t count_ = 0u, sub_length_ = 1u, channels_ = 1u;
};

class Run final {
public:
  Run(const Config &config, const Params &params, std::uint32_t tail, bool loudness = false)
      : config_(config), plugin_(config), tail_(tail), loudness_on_(loudness) {
    report(plugin_.ok(), "C8", "prepare/hash/latency fs=%g ch=%u blk=%u", config.fs,
           config.channels, config.block);
    stage(params);
    input_.resize(static_cast<std::size_t>(config.channels) * config.block);
    output_.resize(input_.size());
    out_ring_.assign(config.channels, std::vector<float>(tail, 0.0F));
    in_ring_.assign(tail, 0.0F);
    if (loudness) {
      in_meter_.prepare(config.fs, config.channels);
      out_meter_.prepare(config.fs, config.channels);
    }
  }
  void stage(const Params &params) {
    if (!plugin_.stage(params)) {
      report(false, "C8", "stageParameters rejected");
    }
  }
  // fill(planar, channels, frames, position); onFrame(frame, position at block end).
  template <class Fill, class OnFrame>
  void advance(double seconds, Fill &&fill, OnFrame &&onFrame) {
    const std::uint64_t end =
        position_ + static_cast<std::uint64_t>(std::llround(seconds * config_.fs));
    const std::uint32_t channels = config_.channels;
    while (position_ < end) {
      const std::uint64_t left = end - position_;
      const std::uint32_t frames =
          left < config_.block ? static_cast<std::uint32_t>(left) : config_.block;
      fill(input_.data(), channels, frames, position_);
      std::memcpy(output_.data(), input_.data(), sizeof(float) * channels * frames);
      for (const Frame &frame : plugin_.process(output_.data(), channels, frames)) {
        onFrame(frame, position_ + frames);
      }
      for (std::uint32_t c = 0; c < channels; ++c) {
        const float *out = output_.data() + static_cast<std::size_t>(c) * frames;
        for (std::uint32_t i = 0; i < frames; ++i) {
          const std::uint64_t n = position_ + i;
          out_ring_[c][n % tail_] = out[i];
          if (c == 0u) {
            in_ring_[n % tail_] = input_[i];
            if (n >= capture_start_ && n < capture_start_ + capture_length_) {
              captured_.push_back(out[i]);
            }
          }
          non_finite_ += std::isfinite(out[i]) ? 0u : 1u;
          subnormal_ += std::fpclassify(out[i]) == FP_SUBNORMAL ? 1u : 0u;
        }
      }
      if (loudness_on_) {
        in_meter_.add(input_.data(), frames);
        out_meter_.add(output_.data(), frames);
      }
      position_ += frames;
    }
  }
  template <class Fill> void advance(double seconds, Fill &&fill) {
    advance(seconds, fill, [](const Frame &, std::uint64_t) {});
  }
  void capture(std::uint64_t start, std::uint64_t length) {
    capture_start_ = start;
    capture_length_ = length;
    captured_.clear();
  }
  // Last `tail` samples, oldest first.
  [[nodiscard]] std::vector<float> outputTail(std::uint32_t c) const {
    return unroll(out_ring_[c]);
  }
  [[nodiscard]] std::vector<float> inputTail() const { return unroll(in_ring_); }
  // Smoke (C8): finite output, no subnormals, well-formed frames present.
  void smoke(const char *label) const {
    report(non_finite_ == 0u && subnormal_ == 0u && plugin_.frameCount() > 0u &&
               plugin_.badFrames() == 0u,
           "C8", "%s fs=%g ch=%u blk=%u non-finite %u subnormal %u frames %u malformed %u", label,
           config_.fs, config_.channels, config_.block, non_finite_, subnormal_,
           plugin_.frameCount(), plugin_.badFrames());
  }
  [[nodiscard]] const Plugin &plugin() const { return plugin_; }
  [[nodiscard]] const std::vector<float> &captured() const { return captured_; }
  [[nodiscard]] double loudnessIn() const { return in_meter_.integrated(); }
  [[nodiscard]] double loudnessOut() const { return out_meter_.integrated(); }

private:
  [[nodiscard]] std::vector<float> unroll(const std::vector<float> &ring) const {
    std::vector<float> out(tail_);
    for (std::uint32_t i = 0; i < tail_; ++i) {
      out[i] = ring[(position_ + i) % tail_];
    }
    return out;
  }
  Config config_;
  Plugin plugin_;
  std::uint32_t tail_;
  bool loudness_on_;
  std::vector<float> input_, output_, in_ring_, captured_;
  std::vector<std::vector<float>> out_ring_;
  std::uint64_t position_ = 0u, capture_start_ = 0u, capture_length_ = 0u;
  std::uint32_t non_finite_ = 0u, subnormal_ = 0u;
  Loudness in_meter_, out_meter_;
};

// ---------------------------------------------------------------------------
// Stimuli
// ---------------------------------------------------------------------------
class Random final {
public:
  explicit Random(std::uint64_t seed) : state_(seed * 0x9E3779B97F4A7C15ull + 1u) {}
  double uniform() {
    state_ ^= state_ << 13;
    state_ ^= state_ >> 7;
    state_ ^= state_ << 17;
    return (static_cast<double>(state_ >> 11) + 0.5) * (1.0 / 9007199254740992.0);
  }
  double gauss() { return std::sqrt(-2.0 * std::log(uniform())) * std::cos(2.0 * kPi * uniform()); }

private:
  std::uint64_t state_;
};

// Pink noise (Kellet's 7-pole approximation).
class Pink final {
public:
  explicit Pink(std::uint64_t seed) : random_(seed) {}
  double next() {
    const double white = random_.gauss();
    b_[0] = 0.99886 * b_[0] + white * 0.0555179;
    b_[1] = 0.99332 * b_[1] + white * 0.0750759;
    b_[2] = 0.96900 * b_[2] + white * 0.1538520;
    b_[3] = 0.86650 * b_[3] + white * 0.3104856;
    b_[4] = 0.55000 * b_[4] + white * 0.5329522;
    b_[5] = -0.7616 * b_[5] - white * 0.0168980;
    const double pink = b_[0] + b_[1] + b_[2] + b_[3] + b_[4] + b_[5] + b_[6] + white * 0.5362;
    b_[6] = white * 0.115926;
    return pink;
  }

private:
  Random random_;
  std::array<double, 7> b_{};
};

// Period-N multisine on integer bins 3 apart (Hann leakage never overlaps), so every
// analysis frame has the same band powers; per-band line levels are solved so the
// kernel-measured band spectrum equals the requested shape; -20 dBFS rms.
struct Multisine {
  std::uint32_t n = 0u;
  double bin_hz = 0.0;
  std::vector<std::uint32_t> bins;
  std::vector<int> bands; // -1: probe line
  std::vector<double> amplitude, phase;
  std::vector<float> table;

  [[nodiscard]] std::vector<float> synthesize(Fft &fft, int only_band = -2) const {
    std::vector<float> spectrum(n, 0.0F);
    for (std::size_t l = 0; l < bins.size(); ++l) {
      if (only_band != -2 && bands[l] != only_band) {
        continue;
      }
      spectrum[2u * bins[l]] = static_cast<float>(amplitude[l] * std::cos(phase[l]));
      spectrum[2u * bins[l] + 1u] = static_cast<float>(amplitude[l] * std::sin(phase[l]));
    }
    const float *x = fft.backward(spectrum.data());
    return std::vector<float>(x, x + n);
  }
  [[nodiscard]] double frequency(std::size_t l) const { return bins[l] * bin_hz; }
  [[nodiscard]] Multisine without(Fft &fft, bool (*drop)(double f, int band, const void *),
                                  const void *context) const {
    Multisine m = *this;
    m.bins.clear();
    m.bands.clear();
    m.amplitude.clear();
    m.phase.clear();
    for (std::size_t l = 0; l < bins.size(); ++l) {
      if (!drop(frequency(l), bands[l], context)) {
        m.bins.push_back(bins[l]);
        m.bands.push_back(bands[l]);
        m.amplitude.push_back(amplitude[l]);
        m.phase.push_back(phase[l]);
      }
    }
    m.table = m.synthesize(fft);
    return m;
  }
};

struct Probe {
  std::uint32_t bin;
  double db; // power re the mean line power
};

Multisine buildMultisine(BandMeter &meter, const Bands &shape_db, double max_hz, std::uint64_t seed,
                         const std::vector<Probe> &probes = {}) {
  Multisine m;
  m.n = meter.size();
  m.bin_hz = meter.binHz();
  Fft fft(m.n);
  Random random(seed);
  for (std::uint32_t k = 2u; k < m.n / 2u; k += 3u) {
    const int band = meter.bandOf(k);
    if (k * m.bin_hz > max_hz) {
      break;
    }
    if (band >= 0) {
      m.bins.push_back(k);
      m.bands.push_back(band);
      m.amplitude.push_back(1.0);
      m.phase.push_back(2.0 * kPi * random.uniform());
    }
  }
  Bands level;
  level.fill(1.0);
  for (int iteration = 0; iteration < 12; ++iteration) {
    for (std::size_t l = 0; l < m.bins.size(); ++l) {
      m.amplitude[l] = std::sqrt(level[static_cast<std::size_t>(m.bands[l])]);
    }
    const std::vector<float> table = m.synthesize(fft);
    const Bands power = meter.power({table.data()});
    for (std::size_t l = 0; l < m.bins.size(); ++l) {
      const auto b = static_cast<std::size_t>(m.bands[l]);
      if (l == 0u || m.bands[l - 1u] != m.bands[l]) {
        level[b] *= std::pow(10.0, shape_db[b] / 10.0) / power[b];
      }
    }
  }
  double mean_power = 0.0;
  for (const double a : m.amplitude) {
    mean_power += a * a / static_cast<double>(m.amplitude.size());
  }
  for (const Probe &probe : probes) {
    m.bins.push_back(probe.bin);
    m.bands.push_back(-1);
    m.amplitude.push_back(std::sqrt(mean_power * std::pow(10.0, probe.db / 10.0)));
    m.phase.push_back(2.0 * kPi * random.uniform());
  }
  m.table = m.synthesize(fft);
  double energy = 0.0;
  for (const float v : m.table) {
    energy += static_cast<double>(v) * v;
  }
  const double scale = 0.1 / std::sqrt(energy / m.n); // -20 dBFS rms
  for (double &a : m.amplitude) {
    a *= scale;
  }
  m.table = m.synthesize(fft);
  return m;
}

// Band shape mu_All + delta; delta is a log-frequency tilt of `span` dB over the
// measured bands, centred.
Bands tiltShape(const BandMeter &meter, double span) {
  const std::uint32_t measured = meter.analyzer().measuredBandCount();
  const double x0 = std::log2(tb::bandCentreHz(0u));
  const double x1 = std::log2(tb::bandCentreHz(measured - 1u));
  Bands shape{};
  for (std::uint32_t b = 0; b < kBandCount; ++b) {
    const double x = (std::log2(tb::bandCentreHz(b)) - x0) / (x1 - x0);
    shape[b] = tb::kTargetMuDb[kAll][b] + span * (x - 0.5);
  }
  return shape;
}

auto toneFill(const Multisine &m) {
  return [&m](float *planar, std::uint32_t channels, std::uint32_t frames, std::uint64_t pos) {
    for (std::uint32_t i = 0; i < frames; ++i) {
      const float v = m.table[(pos + i) % m.n];
      for (std::uint32_t c = 0; c < channels; ++c) {
        planar[c * frames + i] = v;
      }
    }
  };
}

// Line responses Y_k / X_k of the periodic steady state (unwindowed N-point DFTs).
std::vector<std::complex<double>> lineResponses(const Multisine &m, const std::vector<float> &in,
                                                const std::vector<float> &out) {
  Fft fft(m.n);
  const std::vector<float> x(fft.forward(in.data()), fft.forward(in.data()) + m.n);
  const float *y = fft.forward(out.data());
  std::vector<std::complex<double>> h(m.bins.size());
  for (std::size_t l = 0; l < m.bins.size(); ++l) {
    h[l] = Fft::bin(y, m.bins[l]) / Fft::bin(x.data(), m.bins[l]);
  }
  return h;
}

// A converged run of a periodic multisine: last frame, input/output band spectra,
// line responses and loudness.
struct Converged {
  Frame frame;
  Bands in_db{}, out_db{};
  std::vector<std::complex<double>> h;
  double loudness_in = 0.0, loudness_out = 0.0;
};

Converged converge(const Config &c, const Params &p, BandMeter &meter, const Multisine &m,
                   double seconds) {
  Run run(c, p, m.n, true);
  run.advance(seconds, toneFill(m));
  run.smoke("converge");
  Converged r;
  r.frame = run.plugin().latest();
  std::vector<std::vector<float>> tails(c.channels);
  std::vector<const float *> outs, ins;
  for (std::uint32_t ch = 0; ch < c.channels; ++ch) {
    tails[ch] = run.outputTail(ch);
    outs.push_back(tails[ch].data());
    ins.push_back(m.table.data());
  }
  const Bands out = meter.power(outs);
  const Bands in = meter.power(ins);
  for (std::uint32_t b = 0; b < kBandCount; ++b) {
    r.out_db[b] = dbPower(out[b]);
    r.in_db[b] = dbPower(in[b]);
  }
  r.h = lineResponses(m, run.inputTail(), tails[0]);
  r.loudness_in = run.loudnessIn();
  r.loudness_out = run.loudnessOut();
  return r;
}

// ---------------------------------------------------------------------------
// C1 convergence + C4 loudness
// ---------------------------------------------------------------------------
// C1's rule: the band residual out - mu is level within eps plus each band's
// shrinkage residual |d - c|, with the deficit d recomputed from the frame
// (alignment offset, clip at Range); bands within Smoothing of the edges are skipped.
void judgeConvergence(const char *check, const char *label, const Config &c, const Params &p,
                      std::uint32_t measured, const Frame &f, const Bands &out_db, double eps) {
  std::uint32_t first = kBandCount, last = 0u;
  double presence = 0.0, persistence = 0.0;
  std::array<bool, kBandCount> set{};
  for (std::uint32_t b = 0; b < measured; ++b) {
    set[b] = f.has(b, kFlagHasLevel | kFlagHasTarget | kFlagInRange);
    if (set[b]) {
      first = first == kBandCount ? b : first;
      last = b;
      presence += f.presence[b];
      persistence += f.persistence[b];
    }
  }
  const bool unit = !(persistence > 0.0);
  const double coverage = unit ? 0.0 : presence / persistence;
  double weighted = 0.0, weights = 0.0;
  for (std::uint32_t b = 0; b < measured; ++b) {
    if (set[b]) {
      const double w = unit ? 1.0 : f.presence[b] + (1.0 - coverage) * f.persistence[b];
      weighted += w * (f.mu[b] - f.levelDb(b, p));
      weights += w;
    }
  }
  const double offset = weights > 0.0 ? weighted / weights : 0.0;
  double upper = -1e30, lower = 1e30, shrink = 0.0;
  std::uint32_t judged = 0u;
  for (std::uint32_t b = first; b <= last && first < kBandCount; ++b) {
    const double x = std::log2(tb::bandCentreHz(b));
    if (!set[b] || x - std::log2(tb::bandCentreHz(first)) <= p.smoothing ||
        std::log2(tb::bandCentreHz(last)) - x <= p.smoothing) {
      continue;
    }
    double d = f.mu[b] - f.levelDb(b, p) - offset;
    d = d > p.range ? p.range : (d < -p.range ? -p.range : d);
    const double residual = out_db[b] - f.mu[b];
    const double tolerance = eps + std::fabs(d - f.command[b]);
    upper = residual - tolerance > upper ? residual - tolerance : upper;
    lower = residual + tolerance < lower ? residual + tolerance : lower;
    shrink = std::fabs(d - f.command[b]) > shrink ? std::fabs(d - f.command[b]) : shrink;
    ++judged;
  }
  report(judged > 0u && upper <= lower, check,
         "%sfs=%g ch=%u blk=%u: %u bands, margin %.3f dB (eps %.3f, max |d-c| %.3f)", label, c.fs,
         c.channels, c.block, judged, lower - upper, eps, shrink);
}

// Correction magnitude bound: the realised band correction without makeup and cut-only
// shift stays within Range + eps.
void judgeRangeBound(const char *check, const char *label, const Config &c, const Params &p,
                     std::uint32_t measured, const Converged &r, double eps) {
  double worst = 0.0;
  for (std::uint32_t b = 0; b < measured; ++b) {
    const double correction = r.out_db[b] - r.in_db[b] - r.frame.makeup + r.frame.shift();
    worst = std::fabs(correction) > worst ? std::fabs(correction) : worst;
  }
  report(worst <= p.range + eps, check, "%sfs=%g ch=%u blk=%u: max |correction| %.3f <= %.3f",
         label, c.fs, c.channels, c.block, worst, p.range + eps);
}

void testC1(const Config &c) {
  BandMeter meter(c.fs);
  const std::uint32_t measured = meter.analyzer().measuredBandCount();
  Params p = defaults();
  p.averagingTime = 1.0F;
  const double eps_tilt = epsTilt(c.fs, p.high);
  const double eps = epsFit(c.fs, p.high);
  for (const double span : {5.0, 18.0}) {
    const Multisine m = buildMultisine(meter, tiltShape(meter, span), 1e9, 1u);
    const Converged r = converge(c, p, meter, m, 10.0);
    report(std::fabs(r.loudness_out - r.loudness_in) <= kEpsL, "C4",
           "fs=%g ch=%u blk=%u span %g: |L_out - L_in| = %.4f LU (L_in %.2f)", c.fs, c.channels,
           c.block, span, std::fabs(r.loudness_out - r.loudness_in), r.loudness_in);
    if (span > p.range) {
      judgeRangeBound("C1", "span 18 ", c, p, measured, r, eps);
    } else {
      judgeConvergence("C1", "", c, p, measured, r.frame, r.out_db, eps_tilt);
    }
  }
}

// ---------------------------------------------------------------------------
// C1A Target Adjust and C1T Tilt (D-2, S-7)
// ---------------------------------------------------------------------------
// The target offset recomputed independently: complex H of the active adjust sections
// over the test meter's band bins.  D-2 takes the bin mean of |H|^2; Tilt (S-7) sums
// T(f_k) |H|^2 with T = (f / corner)^(slope / 3) above the corner.
double offsetDb(const BandMeter &meter, const Params &p, std::uint32_t band, bool tilt) {
  constexpr std::array<float, 3> kTypeCodes = {0.0F, 3.0F, 4.0F}; // pk, ls, hs
  std::vector<effetune::dsp::BiquadCoefficients> sections;
  for (std::uint32_t i = 0; i < kAdjustBands; ++i) {
    effetune::dsp::BiquadCoefficients section;
    if (effetune::plugins::eq::detail::makePeqCoefficients(
            p.adjustGain[i], kTypeCodes[static_cast<std::size_t>(p.adjustType[i])],
            p.adjustFrequency[i], p.adjustQ[i], p.adjustEnabled[i],
            static_cast<float>(meter.analyzer().sampleRate()), section)) {
      sections.push_back(section);
    }
  }
  const std::uint32_t begin = meter.analyzer().bandBinBegin(band);
  const std::uint32_t end = meter.analyzer().bandBinEnd(band);
  double sum = 0.0;
  for (std::uint32_t k = begin; k < end; ++k) {
    const double f = k * meter.binHz();
    const std::complex<double> z1 = std::polar(1.0, -2.0 * kPi * k / meter.size());
    const std::complex<double> z2 = z1 * z1;
    double power = tilt && f > p.tiltCorner ? std::pow(f / p.tiltCorner, p.tiltSlope / 3.0) : 1.0;
    for (const effetune::dsp::BiquadCoefficients &h : sections) {
      power *= std::norm((h.b0 + h.b1 * z1 + h.b2 * z2) / (1.0 + h.a1 * z1 + h.a2 * z2));
    }
    sum += power;
  }
  return dbPower(tilt ? sum : sum / (end - begin));
}

// Frame mu' equals the base plus the recomputed offset within float32 telemetry
// precision; under Tilt every measured band has a target and frame sigma is 0.
void judgeOffsetPin(const char *check, const Config &c, const Params &p, const BandMeter &meter,
                    const Frame &f) {
  const bool tilt = std::lround(p.target) == kTilt;
  double worst = 0.0;
  bool tilt_terms = true;
  for (std::uint32_t b = 0; b < meter.analyzer().measuredBandCount(); ++b) {
    tilt_terms = tilt_terms && (!tilt || (f.has(b, kFlagHasTarget) && f.sigma[b] == 0.0F));
    if (!f.has(b, kFlagHasTarget)) {
      continue;
    }
    const double expected = (tilt ? 0.0 : tb::kTargetMuDb[kAll][b]) + offsetDb(meter, p, b, tilt);
    const double scale = std::fabs(expected) > 1.0 ? std::fabs(expected) : 1.0;
    const double error = std::fabs(f.mu[b] - expected) / scale;
    worst = error > worst ? error : worst;
  }
  report(worst <= 0x1p-22 && tilt_terms, check,
         "fs=%g ch=%u blk=%u formula pin%s: max |mu - expected| / max(1, |expected|) %.2e <= "
         "2^-22%s",
         c.fs, c.channels, c.block, tilt ? " (Tilt)" : "", worst,
         tilt ? ", has_target and sigma 0" : "");
}

// The broad adjustment: low shelf, Q <= 1 peak and high shelf with mixed signs.
Params broadAdjust(Params p, float shelf_db) {
  p.adjustType[0] = 1.0F; // ls
  p.adjustFrequency[0] = 150.0F;
  p.adjustGain[0] = shelf_db;
  p.adjustQ[0] = 0.7F;
  p.adjustFrequency[2] = 1000.0F;
  p.adjustGain[2] = -2.0F;
  p.adjustQ[2] = 0.7F;
  p.adjustType[4] = 2.0F; // hs
  p.adjustFrequency[4] = 5000.0F;
  p.adjustGain[4] = -shelf_db;
  p.adjustQ[4] = 0.7F;
  return p;
}

// Defaults (S-4): frame mu equals the style table exactly, and the audio is bit-identical
// to a run with the new fields zeroed, both at the defaults (enabled, 0 dB) and with
// every band disabled at a non-zero gain.
void testDefaults(const Config &c) {
  BandMeter meter(c.fs);
  const Multisine m = buildMultisine(meter, tiltShape(meter, 5.0), 1e9, 1u);
  const auto output = [&](const Params &p, Frame &frame) {
    Run run(c, p, m.n);
    run.capture(0u, static_cast<std::uint64_t>(4.0 * c.fs));
    run.advance(4.0, toneFill(m));
    frame = run.plugin().latest();
    return run.captured();
  };
  Params base = defaults();
  base.averagingTime = 1.0F;
  Params zeroed{};
  std::memcpy(&zeroed, &base, offsetof(Params, adjustEnabled));
  Params disabled = base;
  for (std::uint32_t i = 0; i < kAdjustBands; ++i) {
    disabled.adjustEnabled[i] = 0.0F;
    disabled.adjustGain[i] = i % 2u == 0u ? 6.0F : -6.0F;
  }
  Frame frame;
  const std::vector<float> reference = output(zeroed, frame);
  const auto same = [&reference](const std::vector<float> &x) {
    return x.size() == reference.size() &&
           std::memcmp(x.data(), reference.data(), sizeof(float) * x.size()) == 0;
  };
  const bool identical = same(output(base, frame)) && same(output(disabled, frame));
  bool mu_exact = true;
  for (std::uint32_t b = 0; b < kBandCount; ++b) {
    mu_exact = mu_exact && (!frame.has(b, kFlagHasTarget) ||
                            frame.mu[b] == static_cast<float>(tb::kTargetMuDb[kAll][b]));
  }
  report(identical && mu_exact && !reference.empty(), "C1A",
         "defaults fs=%g ch=%u blk=%u: audio bit-identical (zeroed / 0 dB / disabled) %s, "
         "mu == table %s",
         c.fs, c.channels, c.block, identical ? "yes" : "no", mu_exact ? "yes" : "no");
}

// C1A: C1's programme and rule with the broad adjustment (combined excursion within
// Range), its formula pin, and an adjustment beyond Range against the magnitude bound.
void testC1A(const Config &c) {
  BandMeter meter(c.fs);
  const std::uint32_t measured = meter.analyzer().measuredBandCount();
  Params p = broadAdjust(defaults(), 2.0F);
  p.averagingTime = 1.0F;
  const double eps = epsFit(c.fs, p.high);
  const Multisine m = buildMultisine(meter, tiltShape(meter, 5.0), 1e9, 1u);
  const Converged r = converge(c, p, meter, m, 10.0);
  judgeConvergence("C1A", "", c, p, measured, r.frame, r.out_db, eps);
  judgeOffsetPin("C1A", c, p, meter, r.frame);
  const Params beyond = broadAdjust(p, 10.0F);
  judgeRangeBound("C1A", "beyond Range ", c, beyond, measured, converge(c, beyond, meter, m, 10.0),
                  eps);
}

// C1T stimulus.  Low sits at the 20 Hz corner so the pink slope holds over the whole
// judged range; Hann leakage at Low = 20 Hz stays at the noise level (band 0 within
// about +-0.4 dB, and edge bands are not judged).  Recorded noise of the 15 s average:
// max |correction| 0.249 dB (44.1 kHz), 0.201 (48), 0.194 (96), 0.094 (192), all
// within eps, so no extra residual is allowed.
constexpr double kC1TLowHz = 20.0;
constexpr double kC1TPinkScale = 0.02;
constexpr double kC1TSettleSeconds = 15.0;
constexpr double kC1TMeasureSeconds = 15.0;
constexpr double kC1TNoiseResidualDb = 0.0;

// C1T slope -3 against pink: the realised correction (out - in without makeup and the
// cut-only shift) is ~0 in every in-range band away from the edges, within eps plus
// the recorded noise residual.
void judgeTiltInvariant(const Config &c, const Params &p, std::uint32_t measured, const Frame &f,
                        const Bands &in_db, const Bands &out_db, double eps) {
  std::uint32_t first = kBandCount, last = 0u;
  for (std::uint32_t b = 0; b < measured; ++b) {
    if (f.has(b, kFlagHasLevel | kFlagHasTarget | kFlagInRange)) {
      first = first == kBandCount ? b : first;
      last = b;
    }
  }
  double worst = 0.0;
  std::uint32_t judged = 0u;
  for (std::uint32_t b = first; b <= last && first < kBandCount; ++b) {
    const double x = std::log2(tb::bandCentreHz(b));
    if (!f.has(b, kFlagHasLevel | kFlagHasTarget | kFlagInRange) ||
        x - std::log2(tb::bandCentreHz(first)) <= p.smoothing ||
        std::log2(tb::bandCentreHz(last)) - x <= p.smoothing) {
      continue;
    }
    const double realised = std::fabs(out_db[b] - in_db[b] - f.makeup + f.shift());
    worst = realised > worst ? realised : worst;
    ++judged;
  }
  report(judged > 0u && worst <= eps + kC1TNoiseResidualDb, "C1T",
         "pink slope -3 fs=%g ch=%u blk=%u: %u bands, max |correction| %.3f <= %.3f (eps %.3f + "
         "noise %.3f)",
         c.fs, c.channels, c.block, judged, worst, eps + kC1TNoiseResidualDb, eps,
         kC1TNoiseResidualDb);
}

// C1T (S-7): the test's own pink noise against Target Tilt.  Long-term input and output
// band spectra are averaged with the test meter over non-overlapping frames.
void testC1T(const Config &c) {
  BandMeter meter(c.fs);
  const std::uint32_t measured = meter.analyzer().measuredBandCount();
  const double frame_seconds = meter.size() / c.fs;
  Params p = defaults();
  p.target = static_cast<float>(kTilt);
  p.low = kC1TLowHz;
  p.tiltCorner = kC1TLowHz;
  const double eps = epsFit(c.fs, p.high);
  for (const float slope : {-3.0F, -2.0F}) {
    p.tiltSlope = slope;
    Run run(c, p, meter.size());
    Pink pink(3u);
    const auto fill = [&pink](float *planar, std::uint32_t channels, std::uint32_t frames,
                              std::uint64_t) {
      for (std::uint32_t i = 0; i < frames; ++i) {
        const auto v = static_cast<float>(kC1TPinkScale * pink.next());
        for (std::uint32_t ch = 0; ch < channels; ++ch) {
          planar[ch * frames + i] = v;
        }
      }
    };
    run.advance(kC1TSettleSeconds, fill);
    Bands in{}, out{};
    for (std::uint32_t j = 0; j * frame_seconds < kC1TMeasureSeconds; ++j) {
      run.advance(frame_seconds, fill);
      const std::vector<float> x = run.inputTail();
      const std::vector<float> y = run.outputTail(0u);
      const Bands frame_in = meter.power({x.data()});
      const Bands frame_out = meter.power({y.data()});
      for (std::uint32_t b = 0; b < kBandCount; ++b) {
        in[b] += frame_in[b];
        out[b] += frame_out[b];
      }
    }
    run.smoke("C1T");
    const Frame &f = run.plugin().latest();
    Bands in_db{}, out_db{};
    for (std::uint32_t b = 0; b < measured; ++b) {
      in_db[b] = dbPower(in[b]);
      out_db[b] = dbPower(out[b]);
    }
    if (slope == -3.0F) {
      judgeTiltInvariant(c, p, measured, f, in_db, out_db, eps);
    } else {
      judgeConvergence("C1T", "slope -2 ", c, p, measured, f, out_db, eps);
    }
  }
  // The steepest Tilt at the lowest corner: the widest offset span the range allows.
  Params pin = broadAdjust(p, 2.0F);
  pin.tiltSlope = -18.0F;
  pin.tiltCorner = 20.0F;
  const Multisine m = buildMultisine(meter, tiltShape(meter, 5.0), 1e9, 1u);
  Run run(c, pin, m.n);
  run.advance(1.0, toneFill(m));
  judgeOffsetPin("C1T", c, pin, meter, run.plugin().latest());
}

// ---------------------------------------------------------------------------
// C2 absent content (statistical). Q-2: the audibility threshold is ISO 226:2003
// extended with ISO 389-7 at 14 kHz (18.4 dB) and 16 kHz (40.2 dB), held beyond;
// adopted as specified. Content-free bands are defined from the stimulus: no line
// (or its +-1-bin Hann leakage) of the filtered programme reaches the band.
// ---------------------------------------------------------------------------
struct C2Row {
  const char *name;
  double low_cut, high_cut; // lines outside [low_cut, high_cut] removed
  double gap_hz;            // > 0: the band holding gap_hz and its neighbours removed
  double noise_dbfs;        // white noise per channel (hiss or floor); < -200: none
};

void testC2() {
  const std::array<C2Row, 4> rows = {{{"HPF 80 Hz", 80.0, 1e9, 0.0, -300.0},
                                      {"LPF 8 kHz + hiss -70", 0.0, 8000.0, 0.0, -70.0},
                                      {"LPF 8 kHz + hiss -50", 0.0, 8000.0, 0.0, -50.0},
                                      {"gap 500 Hz + floor -60", 0.0, 1e9, 500.0, -60.0}}};
  double presence_sum = 0.0;
  std::uint32_t content_free = 0u;
  for (const double fs : {44100.0, 96000.0}) {
    const Config c{fs, 2u, 128u};
    BandMeter meter(fs);
    const std::uint32_t measured = meter.analyzer().measuredBandCount();
    const tb::CalibrationFamily &family = tb::kCalibrationFamilies[meter.analyzer().family()];
    Params p = defaults();
    const double tau_noise =
        p.averagingTime > family.evidence_seconds ? p.averagingTime : family.evidence_seconds;
    const double t_s = 2.0 * tau_noise + 5.0 * p.averagingTime;
    const double eps = epsFit(fs, p.high);
    int gap_band = meter.bandOf(static_cast<std::uint32_t>(std::lround(500.0 / meter.binHz())));
    for (const C2Row &row : rows) {
      for (const float spl : {83.0F, 96.0F}) {
        for (const std::uint64_t seed : {1u, 2u}) {
          p.averageSpl = spl;
          const Multisine full = buildMultisine(meter, tiltShape(meter, 5.0), 1e9, seed);
          struct Context {
            const C2Row *row;
            int gap;
          } context{&row, row.gap_hz > 0.0 ? gap_band : -100};
          const Multisine m = full.without(
              *std::make_unique<Fft>(full.n),
              [](double f, int band, const void *ctx) {
                const auto *x = static_cast<const Context *>(ctx);
                return f < x->row->low_cut || f > x->row->high_cut ||
                       (band >= x->gap - 1 && band <= x->gap + 1);
              },
              &context);
          const double noise_rms = std::pow(10.0, row.noise_dbfs / 20.0);
          std::vector<Random> noise;
          for (std::uint32_t ch = 0; ch < c.channels; ++ch) {
            noise.emplace_back(seed * 100u + ch);
          }
          Run run(c, p, m.n);
          run.advance(t_s, [&](float *planar, std::uint32_t channels, std::uint32_t frames,
                               std::uint64_t pos) {
            for (std::uint32_t ch = 0; ch < channels; ++ch) {
              for (std::uint32_t i = 0; i < frames; ++i) {
                planar[ch * frames + i] =
                    static_cast<float>(m.table[(pos + i) % m.n] + noise_rms * noise[ch].gauss());
              }
            }
          });
          run.smoke("C2");
          const Frame &f = run.plugin().latest();
          const double top = f.shift();
          double worst = -1e30; // max (lift or command) - bound
          std::uint32_t rows_free = 0u;
          double rows_presence = 0.0;
          for (std::uint32_t b = 0; b < measured; ++b) {
            bool free = true;
            for (const std::uint32_t k : m.bins) {
              free = free && !(k + 1u >= meter.analyzer().bandBinBegin(b) &&
                               k <= meter.analyzer().bandBinEnd(b));
            }
            if (!free) {
              continue;
            }
            ++rows_free;
            rows_presence += f.presence[b];
            if (!f.has(b, kFlagInRange)) {
              continue;
            }
            double spill = 0.0, total = 0.0;
            for (std::uint32_t k = 0; k < kBandCount; ++k) {
              if (f.has(k, kFlagInRange)) {
                const double z =
                    (std::log2(tb::bandCentreHz(b)) - std::log2(tb::bandCentreHz(k))) / p.smoothing;
                const double weight = std::exp(-0.5 * z * z);
                spill += weight * f.presence[k];
                total += weight;
              }
            }
            const double bound = p.amount / 100.0 * p.range * spill / total + eps;
            const double lift = f.responseAt(tb::bandCentreHz(b)) - f.makeup + top;
            const double excess = (f.command[b] > lift ? f.command[b] : lift) - bound;
            worst = excess > worst ? excess : worst;
          }
          presence_sum += rows_presence;
          content_free += rows_free;
          report(worst <= 0.0, "C2",
                 "fs=%g %s SPL %g seed %u: %u content-free bands, sum presence %.4f, "
                 "max (lift - bound) %.3f dB",
                 fs, row.name, static_cast<double>(spl), static_cast<unsigned>(seed), rows_free,
                 rows_presence, rows_free > 0u && worst > -1e29 ? worst : 0.0);
        }
      }
    }
  }
  const std::uint32_t bound = binomialBound(content_free);
  report(presence_sum <= bound, "C2",
         "pooled: sum presence %.4f over n = %u content-free bands <= q(n) = %u", presence_sum,
         content_free, bound);
}

// ---------------------------------------------------------------------------
// C3 gating (bit identity) and the full-matrix smoke
// ---------------------------------------------------------------------------
void testC3(const Config &c, float averaging_time, bool judge) {
  BandMeter meter(c.fs);
  const Multisine m = buildMultisine(meter, tiltShape(meter, 5.0), 1e9, 3u);
  Params p = defaults();
  p.averagingTime = averaging_time;
  const double programme = judge ? 3.0 : 1.0;
  const double early = judge ? 1.0 : 0.6;
  const double late = judge ? 10.0 : 1.2;
  Run run(c, p, 64u);
  const auto tone = toneFill(m);
  const auto silence = [](float *planar, std::uint32_t channels, std::uint32_t frames,
                          std::uint64_t) {
    std::memset(planar, 0, sizeof(float) * channels * frames);
  };
  std::vector<Random> noise;
  for (std::uint32_t ch = 0; ch < c.channels; ++ch) {
    noise.emplace_back(700u + ch);
  }
  const double x_rms = 0.1 * std::pow(10.0, -30.0 / 20.0); // X: 30 dB below the programme
  const auto quiet = [&](float *planar, std::uint32_t channels, std::uint32_t frames,
                         std::uint64_t) {
    for (std::uint32_t ch = 0; ch < channels; ++ch) {
      for (std::uint32_t i = 0; i < frames; ++i) {
        planar[ch * frames + i] = static_cast<float>(x_rms * noise[ch].gauss());
      }
    }
  };
  run.advance(programme, tone);
  run.advance(early, silence);
  const auto silence_early = run.plugin().payload();
  std::uint32_t frames = run.plugin().frameCount();
  run.advance(late - early, silence);
  // Frames keep flowing and report the frame as not passing the gate (bit 0x02 clear).
  bool live = run.plugin().frameCount() > frames && (run.plugin().latest().state & 0x02u) == 0u;
  const bool silence_same = silence_early == run.plugin().payload();
  run.advance(programme, tone);
  run.advance(early, quiet);
  auto noise_early = run.plugin().payload();
  frames = run.plugin().frameCount();
  run.advance(late - early, quiet);
  live = live && run.plugin().frameCount() > frames && (run.plugin().latest().state & 0x02u) == 0u;
  auto noise_late = run.plugin().payload();
  // Between-gate frames may move only the gate state and the floor flags.
  noise_early[8] &= 0xFCu;
  noise_late[8] &= 0xFCu;
  for (std::uint32_t b = 0; b < kBandCount; ++b) {
    noise_early[1008u + b] &= static_cast<std::uint8_t>(~kFlagFloor);
    noise_late[1008u + b] &= static_cast<std::uint8_t>(~kFlagFloor);
  }
  run.smoke(averaging_time >= averagingTimeInfinity() ? "C3 Averaging Time inf"
                                                      : "C3 Averaging Time 3");
  if (judge) {
    report(live, "C3", "fs=%g ch=%u blk=%u: frames published, reported gated", c.fs, c.channels,
           c.block);
    report(silence_same, "C3",
           "fs=%g ch=%u blk=%u Averaging Time %s: silence +1 s == +10 s bit-identical", c.fs,
           c.channels, c.block, averaging_time >= averagingTimeInfinity() ? "inf" : "3");
    report(noise_early == noise_late, "C3",
           "fs=%g ch=%u blk=%u Averaging Time %s: between-gate noise +1 s == +10 s (except "
           "gate/floor bits)",
           c.fs, c.channels, c.block, averaging_time >= averagingTimeInfinity() ? "inf" : "3");
  }
}

// ---------------------------------------------------------------------------
// C5 range edges, Q-1's rule, group delay
// ---------------------------------------------------------------------------
double responseDb(const std::complex<double> &h) { return 20.0 * std::log10(std::abs(h)); }

// Realised line response in dB interpolated linearly in log f at frequency f.
double lineResponseAt(const Multisine &m, const Converged &r, double f) {
  std::size_t below = 0u;
  for (std::size_t l = 0; l < m.bins.size(); ++l) {
    if (m.bands[l] >= 0 && m.frequency(l) <= f) {
      below = l;
    }
  }
  std::size_t above = below;
  for (std::size_t l = below + 1u; l < m.bins.size(); ++l) {
    if (m.bands[l] >= 0) {
      above = l;
      break;
    }
  }
  const double r0 = responseDb(r.h[below]);
  if (above == below) {
    return r0;
  }
  const double t =
      std::log(f / m.frequency(below)) / std::log(m.frequency(above) / m.frequency(below));
  return r0 + t * (responseDb(r.h[above]) - r0);
}

void testC5Edges(const Config &c) {
  BandMeter meter(c.fs);
  Params p = defaults();
  p.averagingTime = 1.0F;
  p.low = 40.0F;
  p.high = 8000.0F;
  const double eps = epsFit(c.fs, p.high);
  const Multisine m = buildMultisine(meter, tiltShape(meter, 5.0), 1e9, 4u);
  const Converged r = converge(c, p, meter, m, 10.0);
  const double edge_low = lineResponseAt(m, r, p.low);
  const double edge_high = lineResponseAt(m, r, p.high);
  double excess = -1e30;
  for (std::size_t l = 0; l < m.bins.size(); ++l) {
    const double f = m.frequency(l);
    if (f < p.low || f > p.high) {
      const double e = responseDb(r.h[l]) - (f < p.low ? edge_low : edge_high);
      excess = e > excess ? e : excess;
    }
  }
  report(excess <= eps, "C5",
         "fs=%g ch=%u blk=%u Low 40/High 8k: max outside rise over edge %.3f <= %.3f", c.fs,
         c.channels, c.block, excess, eps);
}

// Q-1's rule through the public surface on the E1d set (tilt, hold and random rows,
// Range 12): worst outside rise <= worst in-range error of the realised cascade,
// both taken over the whole set (all sample rates and Highs), as Q-1 applied it.
struct RuleWorst {
  double error = 0.0;
  double rise = -1e30;
};
void testC5Rule(double fs, double high, std::uint32_t draws, RuleWorst &worst) {
  const Config c{fs, 2u, 128u};
  BandMeter meter(fs);
  const std::uint32_t measured = meter.analyzer().measuredBandCount();
  const double bin_hz = meter.binHz();
  const auto binAt = [bin_hz](double f) {
    return static_cast<std::uint32_t>(std::lround(f / bin_hz));
  };
  const double top = 40000.0 < 0.499 * fs ? 40000.0 : 0.499 * fs;
  const double first_above = 25000.0 < top ? 25000.0 : 21000.0;
  std::vector<Probe> probes = {{1u, -30.0}, {binAt(20000.0), -30.0}};
  for (std::uint32_t k = binAt(first_above); k * bin_hz <= top;
       k += (binAt(top) - binAt(first_above)) / 8u + 3u) {
    probes.push_back({k, -30.0});
  }
  struct Row {
    const char *name;
    double smoothing;
    Bands correction;
  };
  std::vector<Row> rows;
  const auto fromFn = [](double (*fn)(double)) {
    Bands v{};
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      v[b] = fn(tb::bandCentreHz(b));
    }
    return v;
  };
  rows.push_back({"tilt -1.5", 0.5, fromFn([](double f) { return -1.5 * std::log2(f / 20.0); })});
  rows.push_back(
      {"tilt +1.5", 0.5, fromFn([](double f) { return -1.5 * std::log2(20000.0 / f); })});
  rows.push_back(
      {"LF hold", 0.5, fromFn([](double f) { return -6.0 / (1.0 + std::pow(f / 60.0, 4.0)); })});
  rows.push_back(
      {"HF hold", 0.5, fromFn([](double f) { return -6.0 / (1.0 + std::pow(8000.0 / f, 4.0)); })});
  for (const double width : {0.5, 1.0 / 3.0}) {
    Random random(6u);
    for (std::uint32_t n = 0; n < draws; ++n) {
      Bands d{};
      for (double &v : d) {
        const double g = 3.0 * random.gauss();
        v = g < -6.0 ? -6.0 : (g > 6.0 ? 6.0 : g);
      }
      rows.push_back({width > 0.4 ? "random 1/2" : "random 1/3", width, d});
    }
  }
  for (const Row &row : rows) {
    Params p = defaults();
    p.averagingTime = 1.0F;
    p.range = 12.0F;
    p.high = static_cast<float>(high);
    p.smoothing = static_cast<float>(row.smoothing);
    Bands shape{};
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      shape[b] = tb::kTargetMuDb[kAll][b] - row.correction[b];
    }
    const Multisine m = buildMultisine(meter, shape, 1e9, 5u, probes);
    const Converged r = converge(c, p, meter, m, 10.0);
    double error = 0.0;
    for (std::size_t l = 0; l < m.bins.size(); ++l) {
      const double f = m.frequency(l);
      if (m.bands[l] >= 0 && f >= 20.0 && f <= high && m.bands[l] < static_cast<int>(measured)) {
        const double e = std::fabs(responseDb(r.h[l]) - r.frame.curveAt(f) - r.frame.makeup);
        error = e > error ? e : error;
      }
    }
    double at20 = 0.0;
    for (std::size_t l = 0; l < m.bins.size(); ++l) {
      if (m.bands[l] >= 0 && m.frequency(l) >= 20.0) {
        at20 = responseDb(r.h[l]);
        break;
      }
    }
    const std::size_t lines = m.bins.size() - probes.size();
    const double at20k = responseDb(r.h[lines + 1u]);
    double rise = responseDb(r.h[lines]) - at20;
    for (std::size_t l = lines + 2u; l < m.bins.size(); ++l) {
      rise = responseDb(r.h[l]) - at20k > rise ? responseDb(r.h[l]) - at20k : rise;
    }
    std::printf("INFO C5   Q-1 row fs=%g High %g %s: in-range err %.3f, outside rise %+.3f\n", fs,
                high, row.name, error, rise);
    worst.error = error > worst.error ? error : worst.error;
    worst.rise = rise > worst.rise ? rise : worst.rise;
  }
}

// E2 single dip (500 Hz, FWHM 1/2 oct, 6 dB) at Smoothing 1/6 oct: group delay of the
// realised cascade from per-line phases within Liski's -0.56/+0.64 ms plus the
// line-spacing quantisation q (half the largest step between neighbouring estimates).
void testC5GroupDelay(const Config &c) {
  BandMeter meter(c.fs);
  Params p = defaults();
  p.averagingTime = 1.0F;
  p.smoothing = findParameter("sm") != nullptr ? findParameter("sm")->minimum : 0.1667F;
  const double s = 0.5 / (2.0 * std::sqrt(2.0 * std::log(2.0)));
  Bands shape{};
  for (std::uint32_t b = 0; b < kBandCount; ++b) {
    const double z = std::log2(tb::bandCentreHz(b) / 500.0) / s;
    shape[b] = tb::kTargetMuDb[kAll][b] + 6.0 * std::exp(-0.5 * z * z);
  }
  const Multisine m = buildMultisine(meter, shape, 1e9, 7u);
  const Converged r = converge(c, p, meter, m, 10.0);
  std::vector<double> delay;
  for (std::size_t l = 0; l + 1u < m.bins.size(); ++l) {
    if (m.frequency(l) >= 250.0 && m.frequency(l + 1u) <= 1000.0) {
      const double dphi = std::arg(r.h[l + 1u] / r.h[l]);
      delay.push_back(-dphi / (2.0 * kPi * (m.frequency(l + 1u) - m.frequency(l))) * 1000.0);
    }
  }
  double lo = 1e30, hi = -1e30, q = 0.0;
  for (std::size_t i = 0; i < delay.size(); ++i) {
    lo = delay[i] < lo ? delay[i] : lo;
    hi = delay[i] > hi ? delay[i] : hi;
    if (i > 0u) {
      const double step = 0.5 * std::fabs(delay[i] - delay[i - 1u]);
      q = step > q ? step : q;
    }
  }
  report(
      !delay.empty() && lo >= -0.56 - q && hi <= 0.64 + q, "C5",
      "fs=%g ch=%u blk=%u dip GD [%.3f, %.3f] ms within [-0.56, +0.64] +- q %.3f (shift %.2f dB)",
      c.fs, c.channels, c.block, lo, hi, q, r.frame.shift());
}

// ---------------------------------------------------------------------------
// C6 modulation at Averaging Time 0.1 s
// ---------------------------------------------------------------------------
// Q-11 decision: no tau floor; Averaging Time's minimum 0.1 s stands (S-25). Measured: pink
// -20 dBFS, Averaging Time 0.1, 30 s settle then 60 s: worst command std 0.107 dB (bands
// 28-31); near-zero-command bands 0.003-0.054 dB. tau_b = Averaging Time here.
void testC6Statistical() {
  const double averaging_time = 0.1;
  const double z = zFor(static_cast<double>(kBandCount) * 2.0 * 2.0); // bands x configs x seeds
  const double t_window = 4.0 * z * z * averaging_time;
  for (const double fs : {44100.0, 96000.0}) {
    const Config c{fs, 2u, 128u};
    BandMeter meter(fs);
    const tb::CalibrationFamily &family = tb::kCalibrationFamilies[meter.analyzer().family()];
    const double tau_noise =
        averaging_time > family.evidence_seconds ? averaging_time : family.evidence_seconds;
    const double t_s = 2.0 * tau_noise + 5.0 * averaging_time;
    for (const std::uint64_t seed : {1u, 2u}) {
      Params p = defaults();
      p.averagingTime = static_cast<float>(averaging_time);
      std::vector<Pink> pink;
      for (std::uint32_t ch = 0; ch < c.channels; ++ch) {
        pink.emplace_back(seed * 10u + ch);
      }
      double gain = 0.0;
      {
        Pink probe(seed * 10u);
        double e = 0.0;
        for (int i = 0; i < 1 << 20; ++i) {
          const double v = probe.next();
          e += v * v;
        }
        gain = 0.1 / std::sqrt(e / (1 << 20));
      }
      std::vector<std::array<float, kBandCount>> history;
      std::vector<std::array<std::uint8_t, kBandCount>> flags;
      const std::uint64_t window_start = static_cast<std::uint64_t>(std::llround(t_s * fs));
      Run run(c, p, 64u);
      run.advance(
          t_s + t_window,
          [&](float *planar, std::uint32_t channels, std::uint32_t frames, std::uint64_t) {
            for (std::uint32_t ch = 0; ch < channels; ++ch) {
              for (std::uint32_t i = 0; i < frames; ++i) {
                planar[ch * frames + i] = static_cast<float>(gain * pink[ch].next());
              }
            }
          },
          [&](const Frame &f, std::uint64_t pos) {
            if (pos >= window_start) {
              history.push_back(f.command);
              flags.push_back(f.flags);
            }
          });
      run.smoke("C6(i)");
      const double limit = kJnd * (1.0 + z * std::sqrt(averaging_time / t_window));
      double worst = 0.0;
      std::uint32_t judged = 0u, worst_band = 0u;
      for (std::uint32_t b = 0; b < meter.analyzer().measuredBandCount(); ++b) {
        double mean = 0.0, square = 0.0;
        bool in_range = true;
        for (std::size_t i = 0; i < history.size(); ++i) {
          mean += history[i][b];
          square += static_cast<double>(history[i][b]) * history[i][b];
          in_range = in_range && (flags[i][b] & kFlagInRange) != 0u;
        }
        const double n = static_cast<double>(history.size());
        mean /= n;
        if (!in_range || !(mean < 0.0)) {
          continue;
        }
        const double deviation =
            std::sqrt(square / n - mean * mean > 0.0 ? square / n - mean * mean : 0.0);
        ++judged;
        if (deviation > worst) {
          worst = deviation;
          worst_band = b;
        }
      }
      report(judged > 0u && worst <= limit, "C6",
             "(i) fs=%g seed %u: %u cut bands, %zu frames over T=%.2f s, max std %.3f dB (band %u) "
             "<= %.3f",
             fs, static_cast<unsigned>(seed), judged, history.size(), t_window, worst, worst_band,
             limit);
    }
  }
}

// Output energy at or above `cutoff` relative to the whole segment (Hann, zero-padded FFT).
double energyAboveDb(const std::vector<float> &x, double fs, double cutoff) {
  std::uint32_t n = 32u;
  while (n < x.size()) {
    n *= 2u;
  }
  std::vector<float> padded(n, 0.0F);
  for (std::size_t i = 0; i < x.size(); ++i) {
    const double w =
        0.5 - 0.5 * std::cos(2.0 * kPi * static_cast<double>(i) / static_cast<double>(x.size()));
    padded[i] = static_cast<float>(w * x[i]);
  }
  Fft fft(n);
  const float *s = fft.forward(padded.data());
  double above = 0.0, total = 0.0;
  for (std::uint32_t k = 1; k < n / 2u; ++k) {
    const double e = std::norm(Fft::bin(s, k));
    total += e;
    above += k * fs / n >= cutoff ? e : 0.0;
  }
  return dbPower(above / total);
}

// Q-10 decision: the design moves once per analysis hop with a per-sample linear
// interpolation (no sub-hop). Error energy above 8 kHz (dB), jump vs lerp at hop
// 1024/256/128: 50 ms ramp -74.3/-84.7, -82.7/-103.5, -85.8/-108.8; 200 ms -83.1/-99.8,
// -91.3/-118.6, -94.8/-123.9; 1000 ms -95.3/-119.3, -103.8/-138.1, -107.4/-143.1 (E3's
// Python rows for the same cases: -68.7/-76.7 at 1024, -85.0/-101.3 at 128). Public
// surface: -137.8 dB at 48 kHz, -136.7 dB at 96 kHz (input -139.0/-137.5). At Averaging Time 0.1
// a 1 kHz step moved the command -2.57 -> -1.98 dB, 10 % at 0.27 s, 90 % at 0.44 s
// (onset ~ T_evidence 0.22-0.24 s, by design). Bound: E3's -76.7 dB row for the ~21 ms
// hop + 20 log10 31 (every section may move; amplitude sum) = -46.9 dB.
void testC6Step(const Config &c) {
  const double bound = -76.7 + 20.0 * std::log10(31.0);
  BandMeter meter(c.fs);
  const Multisine m = buildMultisine(meter, tiltShape(meter, 5.0), 8000.0 - meter.binHz(), 8u);
  Fft fft(m.n);
  const int band = meter.bandOf(static_cast<std::uint32_t>(std::lround(1000.0 / m.bin_hz)));
  const std::vector<float> step = m.synthesize(fft, band);
  Params p = defaults();
  p.averagingTime = 0.1F;
  Run run(c, p, 64u);
  const std::uint64_t t0 = (static_cast<std::uint64_t>(3.0 * c.fs) / m.n + 1u) * m.n;
  const auto length = static_cast<std::uint64_t>(std::llround(c.fs));
  run.capture(t0, length);
  run.advance(static_cast<double>(t0 + length) / c.fs,
              [&](float *planar, std::uint32_t channels, std::uint32_t frames, std::uint64_t pos) {
                for (std::uint32_t i = 0; i < frames; ++i) {
                  const std::uint64_t n = pos + i;
                  double g = 1.0;
                  if (n >= t0) {
                    const double t = n - t0 < m.n ? static_cast<double>(n - t0) / m.n : 1.0;
                    g = 1.0 - 0.25 * (1.0 - std::cos(kPi * t)); // raised cosine 1 -> 0.5 (-6 dB)
                  }
                  const auto v = static_cast<float>(m.table[n % m.n] + (g - 1.0) * step[n % m.n]);
                  for (std::uint32_t ch = 0; ch < channels; ++ch) {
                    planar[ch * frames + i] = v;
                  }
                }
              });
  run.smoke("C6(ii)");
  const double energy = energyAboveDb(run.captured(), c.fs, 8000.0);
  report(energy <= bound, "C6", "(ii) fs=%g ch=%u blk=%u: energy >= 8 kHz %.1f dB <= %.1f dB", c.fs,
         c.channels, c.block, energy, bound);
}

// ---------------------------------------------------------------------------
// C7 Averaging Time infinity: the band level is the plain mean over gated frames.
// ---------------------------------------------------------------------------
void testC7(const Config &c, double a_seconds, double b_seconds) {
  const gen::AutomationParameterDescriptor *at_param = findParameter("at");
  const float infinity = averagingTimeInfinity();
  Params p = defaults();
  p.averagingTime = infinity;
  report(
      at_param != nullptr && at_param->normalization == gen::AutomationNormalization::Logarithmic &&
          at_param->packedOffset == 4u && infinity == 100.0F,
      "C7", "Averaging Time top value %.1f is the packed/automation infinity position (offset %u)",
      static_cast<double>(infinity), at_param != nullptr ? at_param->packedOffset : 0u);
  BandMeter meter(c.fs);
  const Multisine ma = buildMultisine(meter, tiltShape(meter, 5.0), 1e9, 9u);
  const Multisine mb = buildMultisine(meter, tiltShape(meter, -5.0), 1e9, 10u);
  std::vector<const float *> fa(c.channels, ma.table.data()), fb(c.channels, mb.table.data());
  const Bands pa = meter.power(fa);
  const Bands pb = meter.power(fb);
  Run run(c, p, 64u);
  run.advance(a_seconds, toneFill(ma));
  const double n_a = run.plugin().latest().gated;
  run.advance(b_seconds, toneFill(mb));
  run.smoke("C7");
  const Frame &f = run.plugin().latest();
  const double n = f.gated;
  const double hops = static_cast<double>(meter.analyzer().hopSize());
  const double n_t = 2.0 * (meter.size() / hops - 1.0) + std::ceil(std::ceil(c.fs / 15.0) / hops) +
                     std::ceil(0.2 * c.fs / hops) + 1.0;
  double worst = 0.0;
  for (std::uint32_t b = 0; b < meter.analyzer().measuredBandCount(); ++b) {
    const double expected = (n_a * pa[b] + (n - n_a) * pb[b]) / n;
    const double tolerance =
        n_t * (std::sqrt(pa[b]) + std::sqrt(pb[b])) * (std::sqrt(pa[b]) + std::sqrt(pb[b])) / n;
    const double level = std::pow(10.0, f.levelDb(b, p) / 10.0);
    const double ratio = std::fabs(level - expected) / tolerance;
    worst = ratio > worst ? ratio : worst;
  }
  report(n > n_a && n_a > 0.0 && worst <= 1.0, "C7",
         "fs=%g ch=%u blk=%u: n_A %.0f n %.0f n_t %.0f, max |P - E| / tol %.3f", c.fs, c.channels,
         c.block, n_a, n, n_t, worst);
}

void testPreviewPause(const Config &c) {
  BandMeter meter(c.fs);
  const Multisine programme = buildMultisine(meter, tiltShape(meter, 5.0), 8000.0, 31u);
  const Multisine resumed = buildMultisine(meter, tiltShape(meter, -5.0), 8000.0, 32u);
  Params p = defaults();
  p.averagingTime = 0.1F;
  Run preview(c, p, 128u), silent(c, p, 128u);
  preview.advance(2.0, toneFill(programme));
  silent.advance(2.0, toneFill(programme));
  p.measurementPaused = 1.0F;
  preview.stage(p);
  silent.stage(p);
  const auto tone = [&c](float *audio, std::uint32_t channels, std::uint32_t frames,
                         std::uint64_t position) {
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t n = 0u; n < frames; ++n) {
        audio[channel * frames + n] = static_cast<float>(
            0.25 * std::sin(2.0 * kPi * 1000.0 * static_cast<double>(position + n) / c.fs));
      }
    }
  };
  const auto silence = [](float *audio, std::uint32_t channels, std::uint32_t frames,
                          std::uint64_t) {
    std::memset(audio, 0, sizeof(float) * channels * frames);
  };
  preview.advance(0.2, tone);
  silent.advance(0.2, silence);
  const Frame frozen = preview.plugin().latest();
  preview.advance(1.0, tone);
  silent.advance(1.0, silence);
  const Frame paused = preview.plugin().latest();
  report(frozen.gated > 0u && paused.gated == frozen.gated && paused.level == frozen.level &&
             paused.presence == frozen.presence && paused.persistence == frozen.persistence &&
             paused.loudness == frozen.loudness,
         "preview", "measurement statistics stay frozen while preview audio is processed");
  double energy = 0.0;
  for (const float value : preview.outputTail(0u)) {
    energy += static_cast<double>(value) * value;
  }
  report(energy > 0.0 && std::isfinite(energy), "preview", "filtered preview output stays audible");
  p.measurementPaused = 0.0F;
  preview.stage(p);
  silent.stage(p);
  preview.advance(1.0, toneFill(resumed));
  silent.advance(1.0, toneFill(resumed));
  const Frame after = preview.plugin().latest();
  const Frame control = silent.plugin().latest();
  report(
      after.gated > paused.gated && after.level != paused.level && after.level == control.level &&
          after.presence == control.presence && after.persistence == control.persistence &&
          after.loudness == control.loudness && after.command == control.command,
      "preview", "measurement resumes without retained preview samples influencing the correction");
  preview.smoke("preview");
}

bool selected(const char *filter, std::string_view name) {
  if (filter == nullptr) {
    return true;
  }
  for (std::string_view rest = filter;;) {
    const std::size_t comma = rest.find(',');
    if (rest.substr(0, comma) == name) {
      return true;
    }
    if (comma == std::string_view::npos) {
      return false;
    }
    rest.remove_prefix(comma + 1u);
  }
}

} // namespace

int main(int argc, char **argv) {
  const auto start = std::chrono::steady_clock::now();
  const char *filter = argc > 1 ? argv[1] : nullptr;
  std::vector<Config> matrix;
  for (const double fs : {44100.0, 48000.0, 96000.0, 192000.0}) {
    for (const std::uint32_t channels : {1u, 2u, 16u}) {
      for (const std::uint32_t block : {128u, 480u}) {
        matrix.push_back({fs, channels, block});
      }
    }
  }
  const Config debug{48000.0, 2u, 480u};
  const std::vector<Config> judged = kRelease ? matrix : std::vector<Config>{debug};
  const float infinity = averagingTimeInfinity();
  if (selected(filter, "preview")) {
    testPreviewPause(debug);
  }
  const std::uint32_t object_size = et_kernel_descriptor_TonalBalanceEQPlugin()->objectSize;
  report(object_size <= effetune::Engine::kKernelStorageBytes, "C8",
         "kernel object %u B fits the engine's %u B slot", object_size,
         effetune::Engine::kKernelStorageBytes);
  if (selected(filter, "c1")) {
    for (const Config &c : judged) {
      testC1(c);
    }
  }
  const std::vector<Config> adjust = kRelease ? std::vector<Config>{{44100.0, 2u, 128u},
                                                                    {48000.0, 2u, 480u},
                                                                    {96000.0, 2u, 128u},
                                                                    {192000.0, 2u, 480u}}
                                              : std::vector<Config>{debug};
  if (selected(filter, "c1a")) {
    for (const Config &c : adjust) {
      testDefaults(c);
      testC1A(c);
    }
  }
  if (selected(filter, "c1t")) {
    for (const Config &c : adjust) {
      testC1T(c);
    }
  }
  if constexpr (kRelease) {
    if (selected(filter, "c2")) {
      testC2();
    }
  }
  if (selected(filter, "c3")) {
    if constexpr (!kRelease) {
      for (const Config &c : matrix) {
        testC3(c, 3.0F, false); // short full-matrix smoke
      }
    }
    for (const Config &c : judged) {
      testC3(c, 3.0F, true);
      testC3(c, infinity, true);
    }
  }
  if (selected(filter, "c5")) {
    for (const Config &c : judged) {
      testC5Edges(c);
    }
    RuleWorst worst;
    for (const double fs : kRelease ? std::vector<double>{44100.0, 48000.0, 96000.0, 192000.0}
                                    : std::vector<double>{48000.0}) {
      for (const double high : {16000.0, 20000.0}) {
        testC5Rule(fs, high, kRelease ? 3u : 1u, worst);
      }
    }
    report(worst.rise <= worst.error, "C5",
           "Q-1 rule over the E1d set: worst rise %+.3f <= worst err %.3f", worst.rise,
           worst.error);
    testC5GroupDelay(kRelease ? Config{44100.0, 2u, 128u} : debug);
    if constexpr (kRelease) {
      testC5GroupDelay({96000.0, 2u, 480u});
    }
  }
  if (selected(filter, "c6")) {
    if constexpr (kRelease) {
      testC6Statistical();
    }
    for (const Config &c : judged) {
      testC6Step(c);
    }
  }
  if (selected(filter, "c7")) {
    if constexpr (kRelease) {
      testC7({44100.0, 2u, 128u}, 60.0, 10.0);
      testC7({96000.0, 2u, 128u}, 60.0, 10.0);
    } else {
      testC7(debug, 60.0, 10.0);
    }
  }
  report(effetune::allocation_guard::violationCount() == 0u, "C8", "allocation guard violations %u",
         effetune::allocation_guard::violationCount());
  const double seconds =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
  std::printf("tonal_balance_eq native test: %d failure(s), %.1f s (%s)\n", failures, seconds,
              kRelease ? "Release" : "Debug");
  return failures == 0 ? 0 : 1;
}
