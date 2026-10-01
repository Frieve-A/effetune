// Tonal Balance EQ calibration tool.
//
// Runs the shared analysis (analysis.h) on Gaussian white noise, identical on
// every channel (so one channel suffices), for the two N / fs families and
// emits calibration_tables.h plus calibration_tables.provenance.json.
//
// Per family and ERB band it measures
//   nu_b                : equivalent degrees of freedom of the per-frame band power,
//   g0_b                : 10 log10 E[P] - 4.343 E[ln P] (the gap of white noise),
//   sigma^2_frame,b     : variance of the per-frame band level in dB,
//   sum rho_b           : sum of the lag-1..3 autocorrelations of that level
//                         (frames four hops apart share no samples, so the sum
//                         over lags 1..3 is the complete sum),
//   s_b(tau_j)          : standard deviation of the gap statistic of the
//                         power / ln-power EMA pair at time constant tau_j on a
//                         log grid 0.1 .. 60 s,
// and T_evidence, the tau at which a steady tone (gap 0) is separated from
// white noise at z = 3 in every band.
//
// Precision (plan P1): the run is extended segment by segment until the
// realised standard error of g0_b is at most 0.2 s_b(tau_max) and the relative
// standard error of every s_b(tau_j) is at most 7 %.  Segment estimates are
// independent 20 tau_max windows; their spread gives the realised SEs.
//
// Not part of the core library or the WASM build (only plugins/*/kernel.cpp is
// globbed); built and run as a standalone tool:
//   calibrate_tables <source_dir> <output_dir> [--max-segments N] [--seed S]

#include "analysis.h"
#include "effetune/dsp/pffft_incremental.h"

#include <pffft.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace tb = effetune::plugins::eq::tonal_balance;

namespace {

constexpr std::uint32_t kFamilyCount = 2u;
constexpr std::array<double, kFamilyCount> kFamilySampleRates = {44100.0, 48000.0};
constexpr std::array<const char *, kFamilyCount> kFamilyNames = {"44100", "48000"};
constexpr double kTauMinSeconds = 0.1;
constexpr double kTauMaxSeconds = tb::kMaximumNoiseTauSeconds;
constexpr double kSettleTauMultiple = 10.0;
constexpr double kSegmentTauMultiple = 20.0;
constexpr std::uint32_t kMinimumSegments = 8u;
constexpr std::uint32_t kDefaultMaximumSegments = 64u;
constexpr double kTargetGapZeroSeRatio = 0.2;
constexpr double kTargetSigmaRelativeSe = 0.07;
constexpr double kNoiseStd = 0.1;
constexpr std::uint32_t kLagCount = 8u; // lags 1..8 recorded, 1..3 summed

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4) for the generator hash
// ---------------------------------------------------------------------------

class Sha256 final {
public:
  void update(const std::uint8_t *data, std::size_t length) {
    for (std::size_t i = 0; i < length; ++i) {
      buffer_[buffer_length_++] = data[i];
      if (buffer_length_ == 64u) {
        block();
        total_ += 64u;
        buffer_length_ = 0u;
      }
    }
  }

  std::string finish() {
    const std::uint64_t bits = (total_ + buffer_length_) * 8u;
    const std::uint8_t one = 0x80u;
    update(&one, 1u);
    const std::uint8_t zero = 0u;
    while (buffer_length_ != 56u) {
      update(&zero, 1u);
    }
    std::uint8_t length[8];
    for (int i = 0; i < 8; ++i) {
      length[i] = static_cast<std::uint8_t>(bits >> (56 - 8 * i));
    }
    update(length, 8u);
    char text[65];
    for (int i = 0; i < 8; ++i) {
      std::snprintf(text + 8 * i, 9, "%08x", state_[i]);
    }
    return std::string(text, 64u);
  }

private:
  static std::uint32_t rotr(std::uint32_t x, unsigned n) { return (x >> n) | (x << (32u - n)); }

  void block() {
    static constexpr std::uint32_t k[64] = {
        0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u,
        0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu,
        0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu,
        0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau, 0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
        0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu,
        0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
        0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u, 0x19a4c116u,
        0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
        0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u,
        0xc67178f2u};
    std::uint32_t w[64];
    for (int i = 0; i < 16; ++i) {
      w[i] = (static_cast<std::uint32_t>(buffer_[4 * i]) << 24) |
             (static_cast<std::uint32_t>(buffer_[4 * i + 1]) << 16) |
             (static_cast<std::uint32_t>(buffer_[4 * i + 2]) << 8) |
             static_cast<std::uint32_t>(buffer_[4 * i + 3]);
    }
    for (int i = 16; i < 64; ++i) {
      const std::uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      const std::uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    std::uint32_t a = state_[0], b = state_[1], c = state_[2], d = state_[3], e = state_[4],
                  f = state_[5], g = state_[6], h = state_[7];
    for (int i = 0; i < 64; ++i) {
      const std::uint32_t s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const std::uint32_t ch = (e & f) ^ (~e & g);
      const std::uint32_t t1 = h + s1 + ch + k[i] + w[i];
      const std::uint32_t s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const std::uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
      const std::uint32_t t2 = s0 + maj;
      h = g;
      g = f;
      f = e;
      e = d + t1;
      d = c;
      c = b;
      b = a;
      a = t1 + t2;
    }
    state_[0] += a;
    state_[1] += b;
    state_[2] += c;
    state_[3] += d;
    state_[4] += e;
    state_[5] += f;
    state_[6] += g;
    state_[7] += h;
  }

  std::uint32_t state_[8] = {0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
                             0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};
  std::uint8_t buffer_[64] = {};
  std::size_t buffer_length_ = 0u;
  std::uint64_t total_ = 0u;
};

std::string fileSha256(const std::string &path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    return std::string();
  }
  Sha256 sha;
  char chunk[4096];
  while (input.read(chunk, sizeof(chunk)) || input.gcount() > 0) {
    sha.update(reinterpret_cast<const std::uint8_t *>(chunk),
               static_cast<std::size_t>(input.gcount()));
  }
  return sha.finish();
}

// ---------------------------------------------------------------------------
// Noise source
// ---------------------------------------------------------------------------

class GaussianNoise final {
public:
  explicit GaussianNoise(std::uint64_t seed) : state_(seed == 0u ? 0x9e3779b97f4a7c15ULL : seed) {}

  float next() {
    if (has_spare_) {
      has_spare_ = false;
      return spare_;
    }
    // Box-Muller on two uniforms from xorshift64*.
    double u1 = uniform();
    while (u1 <= 1e-300) {
      u1 = uniform();
    }
    const double u2 = uniform();
    const double radius = std::sqrt(-2.0 * std::log(u1)) * kNoiseStd;
    const double angle = 2.0 * tb::kPi * u2;
    spare_ = static_cast<float>(radius * std::sin(angle));
    has_spare_ = true;
    return static_cast<float>(radius * std::cos(angle));
  }

private:
  double uniform() {
    state_ ^= state_ >> 12;
    state_ ^= state_ << 25;
    state_ ^= state_ >> 27;
    const std::uint64_t value = state_ * 2685821657736338717ULL;
    return static_cast<double>(value >> 11) * (1.0 / 9007199254740992.0);
  }

  std::uint64_t state_;
  bool has_spare_ = false;
  float spare_ = 0.0F;
};

// ---------------------------------------------------------------------------
// Statistics accumulators
// ---------------------------------------------------------------------------

struct Welford final {
  double count = 0.0;
  double mean = 0.0;
  double m2 = 0.0;

  void add(double x) {
    count += 1.0;
    const double delta = x - mean;
    mean += delta / count;
    m2 += delta * (x - mean);
  }

  [[nodiscard]] double variance() const { return count > 0.0 ? m2 / count : 0.0; }
};

struct SegmentBand final {
  Welford level_db;               // per-frame band level (dB)
  Welford power;                  // per-frame band power
  double log_power_sum = 0.0;     // sum ln P (for g0)
  double lag_sum[kLagCount] = {}; // sum x_t * x_{t-j}
  double lag_count[kLagCount] = {};
  std::array<double, tb::kTauGridCount> gap_sum{};
  std::array<double, tb::kTauGridCount> gap_square_sum{};
  double gap_count = 0.0;
};

struct Segment final {
  std::array<SegmentBand, tb::kBandCount> bands{};
};

struct FamilyResult final {
  double sample_rate = 0.0;
  std::uint32_t fft_size = 0u;
  std::uint32_t hop_size = 0u;
  double seconds_analysed = 0.0;
  std::uint32_t segments = 0u;
  bool converged = false;
  std::array<double, tb::kTauGridCount> tau{};
  std::array<double, tb::kBandCount> nu{};
  std::array<double, tb::kBandCount> gap_zero{};
  std::array<double, tb::kBandCount> gap_zero_se{};
  std::array<double, tb::kBandCount> frame_variance{};
  std::array<double, tb::kBandCount> rho_sum{};
  std::array<std::array<double, kLagCount>, tb::kBandCount> rho{};
  std::array<std::array<double, tb::kTauGridCount>, tb::kBandCount> sigma{};
  std::array<std::array<double, tb::kTauGridCount>, tb::kBandCount> sigma_relative_se{};
  std::array<std::array<double, tb::kTauGridCount>, tb::kBandCount> gap_mean_bias{};
  double evidence = 0.0;
  double worst_gap_zero_se_ratio = 0.0;
  double worst_sigma_relative_se = 0.0;
  double worst_tail_rho = 0.0;
};

double meanOf(const std::vector<double> &values) {
  double sum = 0.0;
  for (double v : values) {
    sum += v;
  }
  return values.empty() ? 0.0 : sum / static_cast<double>(values.size());
}

double standardErrorOf(const std::vector<double> &values) {
  if (values.size() < 2u) {
    return 0.0;
  }
  const double mean = meanOf(values);
  double sum = 0.0;
  for (double v : values) {
    sum += (v - mean) * (v - mean);
  }
  return std::sqrt(sum / static_cast<double>(values.size() - 1u) /
                   static_cast<double>(values.size()));
}

// ---------------------------------------------------------------------------
// One family run
// ---------------------------------------------------------------------------

class FamilyRun final {
public:
  FamilyRun(double sample_rate, std::uint64_t seed) : noise_(seed) {
    analyzer_.prepare(sample_rate);
    const std::uint32_t n = analyzer_.fftSize();
    setup_ = pffft_new_setup(static_cast<int>(n), PFFFT_REAL);
    forward_ = new effetune::dsp::PffftOrderedRealForward(setup_, 1 << 30);
    if (setup_ == nullptr || !forward_->valid()) {
      std::fprintf(stderr, "pffft setup failed for N = %u\n", n);
      std::exit(1);
    }
    frame_ = static_cast<float *>(pffft_aligned_malloc(n * sizeof(float)));
    windowed_ = static_cast<float *>(pffft_aligned_malloc(n * sizeof(float)));
    spectrum_ = static_cast<float *>(pffft_aligned_malloc(n * sizeof(float)));
    work_ = static_cast<float *>(pffft_aligned_malloc(n * sizeof(float)));
    std::memset(frame_, 0, n * sizeof(float));
    const double hop_seconds = analyzer_.hopSeconds();
    for (std::uint32_t j = 0; j < tb::kTauGridCount; ++j) {
      const double ratio = static_cast<double>(j) / static_cast<double>(tb::kTauGridCount - 1u);
      tau_[j] = kTauMinSeconds * std::exp(ratio * std::log(kTauMaxSeconds / kTauMinSeconds));
      alpha_[j] = tb::hopAlpha(tau_[j], hop_seconds);
    }
    tau_[tb::kTauGridCount - 1u] = kTauMaxSeconds;
    tau_[0] = kTauMinSeconds;
    // Prime the frame ring with three hops so that the first analysed hop
    // already sees a full frame (frames are N samples, hop N / 4).
    for (std::uint32_t i = 0; i < 3u; ++i) {
      pushHop();
    }
  }

  ~FamilyRun() {
    delete forward_;
    pffft_destroy_setup(setup_);
    pffft_aligned_free(frame_);
    pffft_aligned_free(windowed_);
    pffft_aligned_free(spectrum_);
    pffft_aligned_free(work_);
  }

  FamilyRun(const FamilyRun &) = delete;
  FamilyRun &operator=(const FamilyRun &) = delete;

  [[nodiscard]] const tb::FrameAnalyzer &analyzer() const { return analyzer_; }
  [[nodiscard]] const std::array<double, tb::kTauGridCount> &tau() const { return tau_; }

  // Runs hops without recording (EMA settling).
  void settle(double seconds) {
    const std::uint64_t hops = static_cast<std::uint64_t>(seconds / analyzer_.hopSeconds());
    for (std::uint64_t h = 0; h < hops; ++h) {
      analyseHop(nullptr);
    }
    seconds_ += static_cast<double>(hops) * analyzer_.hopSeconds();
  }

  Segment runSegment(double seconds) {
    Segment segment;
    const std::uint64_t hops = static_cast<std::uint64_t>(seconds / analyzer_.hopSeconds());
    for (std::uint64_t h = 0; h < hops; ++h) {
      analyseHop(&segment);
    }
    seconds_ += static_cast<double>(hops) * analyzer_.hopSeconds();
    return segment;
  }

  [[nodiscard]] double secondsAnalysed() const { return seconds_; }

private:
  void pushHop() {
    const std::uint32_t n = analyzer_.fftSize();
    const std::uint32_t hop = analyzer_.hopSize();
    std::memmove(frame_, frame_ + hop, (n - hop) * sizeof(float));
    for (std::uint32_t i = n - hop; i < n; ++i) {
      frame_[i] = noise_.next();
    }
  }

  void analyseHop(Segment *segment) {
    pushHop();
    const std::uint32_t n = analyzer_.fftSize();
    analyzer_.applyWindow(frame_, windowed_, 0u, n);
    if (!forward_->begin(windowed_, spectrum_, work_)) {
      std::fprintf(stderr, "fft begin failed\n");
      std::exit(1);
    }
    while (forward_->step() == 0) {
    }
    analyzer_.beginHop(observation_);
    analyzer_.accumulateChannel(spectrum_, 1.0, 0u, observation_);
    analyzer_.finishHop(observation_);

    for (std::uint32_t b = 0; b < tb::kBandCount; ++b) {
      const double power = observation_.own[b];
      const double level_db = tb::portablePowerDb(power);
      for (std::uint32_t j = 0; j < tb::kTauGridCount; ++j) {
        gap_[j][b].add(power, alpha_[j]);
      }
      if (segment != nullptr) {
        SegmentBand &band = segment->bands[b];
        band.level_db.add(level_db);
        band.power.add(power);
        band.log_power_sum += tb::portableLog(power);
        for (std::uint32_t lag = 0; lag < kLagCount; ++lag) {
          if (history_count_[b] > lag) {
            const double previous =
                history_[b][(history_write_[b] + kLagCount - 1u - lag) % kLagCount];
            band.lag_sum[lag] += level_db * previous;
            band.lag_count[lag] += 1.0;
          }
        }
        band.gap_count += 1.0;
        for (std::uint32_t j = 0; j < tb::kTauGridCount; ++j) {
          const double gap = gap_[j][b].gapDb();
          band.gap_sum[j] += gap;
          band.gap_square_sum[j] += gap * gap;
        }
      }
      history_[b][history_write_[b]] = level_db;
      history_write_[b] = (history_write_[b] + 1u) % kLagCount;
      if (history_count_[b] < kLagCount) {
        ++history_count_[b];
      }
    }
  }

  tb::FrameAnalyzer analyzer_;
  GaussianNoise noise_;
  PFFFT_Setup *setup_ = nullptr;
  effetune::dsp::PffftOrderedRealForward *forward_ = nullptr;
  float *frame_ = nullptr;
  float *windowed_ = nullptr;
  float *spectrum_ = nullptr;
  float *work_ = nullptr;
  tb::HopObservation observation_{};
  std::array<double, tb::kTauGridCount> tau_{};
  std::array<double, tb::kTauGridCount> alpha_{};
  std::array<std::array<tb::GapIntegrator, tb::kBandCount>, tb::kTauGridCount> gap_{};
  std::array<std::array<double, kLagCount>, tb::kBandCount> history_{};
  std::array<std::uint32_t, tb::kBandCount> history_write_{};
  std::array<std::uint32_t, tb::kBandCount> history_count_{};
  double seconds_ = 0.0;
};

// Pools the segments into point estimates and realised standard errors.
FamilyResult summarise(const FamilyRun &run, const std::vector<Segment> &segments) {
  FamilyResult result;
  result.sample_rate = run.analyzer().sampleRate();
  result.fft_size = run.analyzer().fftSize();
  result.hop_size = run.analyzer().hopSize();
  result.seconds_analysed = run.secondsAnalysed();
  result.segments = static_cast<std::uint32_t>(segments.size());
  result.tau = run.tau();
  const std::size_t m = segments.size();

  for (std::uint32_t b = 0; b < tb::kBandCount; ++b) {
    // Pooled per-frame statistics.
    Welford pooled_level;
    Welford pooled_power;
    double pooled_log = 0.0;
    double lag_sum[kLagCount] = {};
    double lag_count[kLagCount] = {};
    std::vector<double> segment_g0;
    for (const Segment &segment : segments) {
      const SegmentBand &band = segment.bands[b];
      // Merge Welford accumulators (Chan et al.).
      auto merge = [](Welford &into, const Welford &from) {
        if (from.count == 0.0) {
          return;
        }
        if (into.count == 0.0) {
          into = from;
          return;
        }
        const double delta = from.mean - into.mean;
        const double total = into.count + from.count;
        into.m2 += from.m2 + delta * delta * into.count * from.count / total;
        into.mean += delta * from.count / total;
        into.count = total;
      };
      merge(pooled_level, band.level_db);
      merge(pooled_power, band.power);
      pooled_log += band.log_power_sum;
      for (std::uint32_t lag = 0; lag < kLagCount; ++lag) {
        lag_sum[lag] += band.lag_sum[lag];
        lag_count[lag] += band.lag_count[lag];
      }
      segment_g0.push_back(10.0 * std::log10(band.power.mean) -
                           tb::kDbPerNeper * band.log_power_sum / band.power.count);
    }
    result.nu[b] = 2.0 * pooled_power.mean * pooled_power.mean / pooled_power.variance();
    result.gap_zero[b] =
        10.0 * std::log10(pooled_power.mean) - tb::kDbPerNeper * pooled_log / pooled_power.count;
    result.gap_zero_se[b] = standardErrorOf(segment_g0);
    result.frame_variance[b] = pooled_level.variance();
    double rho_sum = 0.0;
    for (std::uint32_t lag = 0; lag < kLagCount; ++lag) {
      const double covariance =
          lag_sum[lag] / lag_count[lag] - pooled_level.mean * pooled_level.mean;
      result.rho[b][lag] = covariance / pooled_level.variance();
      if (lag < 3u) {
        rho_sum += result.rho[b][lag];
      } else {
        const double magnitude = std::fabs(result.rho[b][lag]);
        result.worst_tail_rho = std::max(result.worst_tail_rho, magnitude);
      }
    }
    result.rho_sum[b] = rho_sum;

    // Gap standard deviation per tau about the pooled gap mean.
    for (std::uint32_t j = 0; j < tb::kTauGridCount; ++j) {
      double total_sum = 0.0;
      double total_count = 0.0;
      for (const Segment &segment : segments) {
        total_sum += segment.bands[b].gap_sum[j];
        total_count += segment.bands[b].gap_count;
      }
      const double gap_mean = total_sum / total_count;
      std::vector<double> segment_sigma;
      double variance_sum = 0.0;
      for (const Segment &segment : segments) {
        const SegmentBand &band = segment.bands[b];
        const double variance = (band.gap_square_sum[j] - 2.0 * gap_mean * band.gap_sum[j] +
                                 band.gap_count * gap_mean * gap_mean) /
                                band.gap_count;
        variance_sum += variance;
        segment_sigma.push_back(std::sqrt(variance < 0.0 ? 0.0 : variance));
      }
      const double sigma = std::sqrt(variance_sum / static_cast<double>(m));
      result.sigma[b][j] = sigma;
      result.sigma_relative_se[b][j] = standardErrorOf(segment_sigma) / sigma;
      result.gap_mean_bias[b][j] = gap_mean - result.gap_zero[b];
      result.worst_sigma_relative_se =
          std::max(result.worst_sigma_relative_se, result.sigma_relative_se[b][j]);
    }
    result.worst_gap_zero_se_ratio =
        std::max(result.worst_gap_zero_se_ratio,
                 result.gap_zero_se[b] / result.sigma[b][tb::kTauGridCount - 1u]);

    // T_evidence per band: smallest tau (log-interpolated) with z s_b(tau) <= g0_b.
    double evidence = kTauMaxSeconds;
    bool found = false;
    for (std::uint32_t j = 0; j < tb::kTauGridCount && !found; ++j) {
      if (tb::kEvidenceZ * result.sigma[b][j] <= result.gap_zero[b]) {
        if (j == 0u) {
          evidence = result.tau[0];
        } else {
          const double s0 = tb::kEvidenceZ * result.sigma[b][j - 1u] - result.gap_zero[b];
          const double s1 = tb::kEvidenceZ * result.sigma[b][j] - result.gap_zero[b];
          const double t = s0 / (s0 - s1);
          evidence = std::exp(std::log(result.tau[j - 1u]) +
                              t * (std::log(result.tau[j]) - std::log(result.tau[j - 1u])));
        }
        found = true;
      }
    }
    result.evidence = std::max(result.evidence, evidence);
  }
  result.converged = result.worst_gap_zero_se_ratio <= kTargetGapZeroSeRatio &&
                     result.worst_sigma_relative_se <= kTargetSigmaRelativeSe;
  return result;
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

std::string number(double value) {
  char text[64];
  std::snprintf(text, sizeof(text), "%.17g", value);
  std::string result(text);
  if (result.find_first_of(".eEn") == std::string::npos) {
    result += ".0";
  }
  return result;
}

void writeArray(std::ostringstream &out, const char *indent, const double *values,
                std::size_t count) {
  out << indent << "{";
  for (std::size_t i = 0; i < count; ++i) {
    if (i % 4u == 0u) {
      out << "\n" << indent << "    ";
    } else {
      out << " ";
    }
    out << number(values[i]) << ",";
  }
  out << "\n" << indent << "}";
}

void writeHeader(const std::string &path, const std::array<FamilyResult, kFamilyCount> &families,
                 const std::string &generator_sha, const std::string &analysis_sha) {
  std::ostringstream out;
  out << "// Generated by calibrate_tables.cpp -- do not edit.\n"
      << "// White-noise calibration of the Tonal Balance EQ gap statistic per N / fs family.\n"
      << "// calibrate_tables.cpp sha256: " << generator_sha << "\n"
      << "// analysis.h sha256: " << analysis_sha << "\n"
      << "#ifndef EFFETUNE_TONAL_BALANCE_EQ_CALIBRATION_TABLES_H\n"
      << "#define EFFETUNE_TONAL_BALANCE_EQ_CALIBRATION_TABLES_H\n\n"
      << "#include \"analysis.h\"\n\n"
      << "#include <array>\n\n"
      << "namespace effetune::plugins::eq::tonal_balance {\n\n"
      << "// clang-format off\n"
      << "inline constexpr const char *kCalibrationGeneratorSha256 = \"" << generator_sha
      << "\";\n\n"
      << "inline constexpr std::array<CalibrationFamily, " << kFamilyCount
      << "> kCalibrationFamilies = {{\n";
  for (std::uint32_t f = 0; f < kFamilyCount; ++f) {
    const FamilyResult &r = families[f];
    out << "    {\n        \"" << kFamilyNames[f] << "\",\n        "
        << number(static_cast<double>(r.fft_size) / r.sample_rate) << ", // frame seconds\n"
        << "        " << number(r.evidence) << ", // T_evidence\n";
    writeArray(out, "        ", r.tau.data(), tb::kTauGridCount);
    out << ", // tau grid (s)\n";
    writeArray(out, "        ", r.nu.data(), tb::kBandCount);
    out << ", // nu\n";
    writeArray(out, "        ", r.gap_zero.data(), tb::kBandCount);
    out << ", // g0 (dB)\n";
    writeArray(out, "        ", r.frame_variance.data(), tb::kBandCount);
    out << ", // sigma^2_frame (dB^2)\n";
    writeArray(out, "        ", r.rho_sum.data(), tb::kBandCount);
    out << ", // sum rho\n"
        << "        {{ // s_b(tau_j) (dB)\n";
    for (std::uint32_t b = 0; b < tb::kBandCount; ++b) {
      writeArray(out, "            ", r.sigma[b].data(), tb::kTauGridCount);
      out << ",\n";
    }
    out << "        }},\n    },\n";
  }
  out << "}};\n// clang-format on\n\n} // namespace effetune::plugins::eq::tonal_balance\n\n"
      << "#endif // EFFETUNE_TONAL_BALANCE_EQ_CALIBRATION_TABLES_H\n";
  std::ofstream file(path, std::ios::binary);
  file << out.str();
}

// Largest |mean gap - g0| over bands and tau (the Jensen bias of the gap
// integrator on the calibration noise); the per-band arrays stay in the tool.
double worstGapMeanBias(const FamilyResult &r) {
  double worst = 0.0;
  for (std::uint32_t b = 0; b < tb::kBandCount; ++b) {
    for (std::uint32_t t = 0; t < tb::kTauGridCount; ++t) {
      const double v = r.gap_mean_bias[b][t];
      const double m = v < 0.0 ? -v : v;
      worst = m > worst ? m : worst;
    }
  }
  return worst;
}

void writeProvenance(const std::string &path,
                     const std::array<FamilyResult, kFamilyCount> &families,
                     const std::string &generator_sha, const std::string &analysis_sha,
                     std::uint64_t seed, double elapsed_seconds) {
  std::ostringstream out;
  out << "{\n"
      << "  \"generator\": \"dsp/plugins/eq/tonal_balance_eq/calibrate_tables.cpp\",\n"
      << "  \"generator_sha256\": \"" << generator_sha << "\",\n"
      << "  \"analysis_sha256\": \"" << analysis_sha << "\",\n"
      << "  \"output\": \"calibration_tables.h\",\n"
      << "  \"signal\": {\"kind\": \"gaussian white noise\", \"std\": " << number(kNoiseStd)
      << ", \"channels\": 1, \"seed\": " << seed << "},\n"
      << "  \"precision_targets\": {\"gap_zero_se_over_sigma_tau_max\": "
      << number(kTargetGapZeroSeRatio)
      << ", \"sigma_relative_se\": " << number(kTargetSigmaRelativeSe)
      << ", \"minimum_segments\": " << kMinimumSegments
      << ", \"segment_seconds\": " << number(kSegmentTauMultiple * kTauMaxSeconds)
      << ", \"settle_seconds\": " << number(kSettleTauMultiple * kTauMaxSeconds) << "},\n"
      << "  \"length_rule\": \"segments of 20 tau_max are independent windows; the run is "
         "extended until the realised standard errors (spread of the segment estimates) meet "
         "the targets\",\n"
      << "  \"rho_lags_summed\": 3,\n"
      << "  \"evidence_z\": " << number(tb::kEvidenceZ) << ",\n"
      << "  \"elapsed_seconds\": " << number(elapsed_seconds) << ",\n"
      << "  \"families\": [\n";
  for (std::uint32_t f = 0; f < kFamilyCount; ++f) {
    const FamilyResult &r = families[f];
    out << "    {\n      \"name\": \"" << kFamilyNames[f] << "\",\n"
        << "      \"sample_rate\": " << number(r.sample_rate) << ",\n"
        << "      \"fft_size\": " << r.fft_size << ",\n"
        << "      \"hop_size\": " << r.hop_size << ",\n"
        << "      \"seconds_analysed\": " << number(r.seconds_analysed) << ",\n"
        << "      \"segments\": " << r.segments << ",\n"
        << "      \"converged\": " << (r.converged ? "true" : "false") << ",\n"
        << "      \"evidence_seconds\": " << number(r.evidence) << ",\n"
        << "      \"realised\": {\n"
        << "        \"worst_gap_zero_se_over_sigma_tau_max\": " << number(r.worst_gap_zero_se_ratio)
        << ",\n"
        << "        \"worst_sigma_relative_se\": " << number(r.worst_sigma_relative_se) << ",\n"
        << "        \"worst_abs_rho_lag4_to_8\": " << number(r.worst_tail_rho) << ",\n"
        << "        \"worst_abs_gap_mean_minus_gap_zero_db\": " << number(worstGapMeanBias(r))
        << "\n"
        << "      }\n    }" << (f + 1u < kFamilyCount ? ",\n" : "\n");
  }
  out << "  ]\n}\n";
  std::ofstream file(path, std::ios::binary);
  file << out.str();
}

} // namespace

int main(int argc, char **argv) {
  if (argc < 3) {
    std::fprintf(
        stderr,
        "usage: calibrate_tables <source_dir> <output_dir> [--max-segments N] [--seed S]\n");
    return 2;
  }
  const std::string source_dir = argv[1];
  const std::string output_dir = argv[2];
  std::uint32_t maximum_segments = kDefaultMaximumSegments;
  std::uint64_t seed = 12345u;
  for (int i = 3; i + 1 < argc; i += 2) {
    if (std::strcmp(argv[i], "--max-segments") == 0) {
      maximum_segments = static_cast<std::uint32_t>(std::strtoul(argv[i + 1], nullptr, 10));
    } else if (std::strcmp(argv[i], "--seed") == 0) {
      seed = std::strtoull(argv[i + 1], nullptr, 10);
    }
  }
  const std::string generator_sha = fileSha256(source_dir + "/calibrate_tables.cpp");
  const std::string analysis_sha = fileSha256(source_dir + "/analysis.h");
  if (generator_sha.empty() || analysis_sha.empty()) {
    std::fprintf(stderr, "cannot read the generator sources under %s\n", source_dir.c_str());
    return 2;
  }
  const auto started = std::chrono::steady_clock::now();
  std::array<FamilyResult, kFamilyCount> families{};
  for (std::uint32_t f = 0; f < kFamilyCount; ++f) {
    FamilyRun run(kFamilySampleRates[f], seed);
    std::printf("family %s: N = %u hop = %u, settling %.0f s\n", kFamilyNames[f],
                run.analyzer().fftSize(), run.analyzer().hopSize(),
                kSettleTauMultiple * kTauMaxSeconds);
    std::fflush(stdout);
    run.settle(kSettleTauMultiple * kTauMaxSeconds);
    std::vector<Segment> segments;
    while (segments.size() < maximum_segments) {
      segments.push_back(run.runSegment(kSegmentTauMultiple * kTauMaxSeconds));
      if (segments.size() < kMinimumSegments) {
        continue;
      }
      families[f] = summarise(run, segments);
      std::printf(
          "  segments %zu (%.0f s): g0 SE ratio %.3f, sigma rel SE %.3f, T_evidence %.3f s\n",
          segments.size(), run.secondsAnalysed(), families[f].worst_gap_zero_se_ratio,
          families[f].worst_sigma_relative_se, families[f].evidence);
      std::fflush(stdout);
      if (families[f].converged) {
        break;
      }
    }
    if (segments.size() < kMinimumSegments) {
      families[f] = summarise(run, segments);
    }
    if (!families[f].converged) {
      std::printf("  WARNING: precision targets not met within %u segments\n", maximum_segments);
    }
  }
  const double elapsed =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
  writeHeader(output_dir + "/calibration_tables.h", families, generator_sha, analysis_sha);
  writeProvenance(output_dir + "/calibration_tables.provenance.json", families, generator_sha,
                  analysis_sha, seed, elapsed);
  std::printf("wrote calibration_tables.h and calibration_tables.provenance.json (%.1f s)\n",
              elapsed);
  return 0;
}
