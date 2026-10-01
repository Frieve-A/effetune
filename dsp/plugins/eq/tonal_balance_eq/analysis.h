// Tonal Balance EQ: spectral analysis shared by the kernel and the calibration
// tool (calibrate_tables.cpp).
//
// Everything that decides a statistic lives here so that the calibration
// tables are measured through exactly the code the kernel runs:
//   * ERB band geometry (41 bands at Cam 1..41, rectangular 1-ERB bin sets),
//   * periodic Hann frame of N = 2^round(log2(0.085 fs)) samples, hop N / 4,
//   * per-channel FFT power, BS.1770 channel-weighted sum, K-weighting per bin,
//   * the gap statistic (10 log10 of the mean power minus 4.343 times the mean
//     log power) and the growing-mean / EMA update every integrator uses,
//   * the gate / integrator state machine (AnalysisEngine) that the kernel
//     drives once per hop.
// Design-time transcendentals go through portable_math.h (parity surface).
#ifndef EFFETUNE_TONAL_BALANCE_EQ_ANALYSIS_H
#define EFFETUNE_TONAL_BALANCE_EQ_ANALYSIS_H

#include "effetune/dsp/biquad.h"
#include "effetune/dsp/k_weighting.h"
#include "portable_math.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

namespace effetune::plugins::eq::tonal_balance {

inline constexpr std::uint32_t kBandCount = 41u;
inline constexpr std::uint32_t kMaximumChannels = 16u;
inline constexpr std::uint32_t kGridCount = 128u;
inline constexpr std::uint32_t kTauGridCount = 15u;
inline constexpr double kFrameSeconds = 0.085;
inline constexpr double kBlockSeconds = 0.4;
inline constexpr double kAbsoluteGateLkfs = -70.0;
inline constexpr double kRelativeGateLu = -10.0;
inline constexpr double kGateTauSeconds = 3.0;
inline constexpr double kMaximumNoiseTauSeconds = 60.0;
inline constexpr double kBandUpperRatio = 0.45;
inline constexpr double kEvidenceZ = 3.0;
inline constexpr double kDbPerNeper = 10.0 / kLn10; // 4.3429...
// Smallest positive normal double: the floor of every band power.
inline constexpr double kPowerFloor = std::numeric_limits<double>::min();

// Hearing threshold in the free field: ISO 226:2003 (20 Hz .. 12.5 kHz)
// extended verbatim with ISO 389-7:2005 Table 1 at 14 kHz and 16 kHz, held
// above 16 kHz, interpolated linearly in log frequency (Q-2).
inline constexpr std::uint32_t kThresholdPointCount = 31u;
inline constexpr std::array<double, kThresholdPointCount> kThresholdFrequencyHz = {
    20.0,   25.0,   31.5,   40.0,   50.0,   63.0,    80.0,    100.0,   125.0,  160.0,  200.0,
    250.0,  315.0,  400.0,  500.0,  630.0,  800.0,   1000.0,  1250.0,  1600.0, 2000.0, 2500.0,
    3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0, 14000.0, 16000.0};
inline constexpr std::array<double, kThresholdPointCount> kThresholdDb = {
    78.5, 68.7, 59.5, 51.1, 44.0, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4, 11.4, 8.6,  6.2,  4.4, 3.0,
    2.2,  2.4,  3.5,  1.7,  -1.3, -4.2, -6.0, -5.4, -1.5, 6.0,  12.6, 13.9, 12.3, 18.4, 40.2};

// Calibration table for one N / fs family (see calibrate_tables.cpp).
struct CalibrationFamily final {
  const char *name;
  double frame_seconds;    // N / fs of the family
  double evidence_seconds; // T_evidence: tau at which a steady tone is separated at z
  std::array<double, kTauGridCount> tau_seconds;
  std::array<double, kBandCount> nu;                 // equivalent degrees of freedom
  std::array<double, kBandCount> gap_zero_db;        // g0_b
  std::array<double, kBandCount> frame_variance_db2; // sigma^2_frame,b
  std::array<double, kBandCount> rho_sum;            // sum_j rho_b(j), j >= 1
  std::array<std::array<double, kTauGridCount>, kBandCount> gap_sigma_db; // s_b(tau_j)
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

[[nodiscard]] inline double erbWidthHz(double frequency_hz) noexcept {
  return 24.7 * (4.37 * frequency_hz / 1000.0 + 1.0);
}

[[nodiscard]] inline double camToHz(double cam) noexcept {
  return (portableDecadePower(cam / 21.4) - 1.0) * 1000.0 / 4.37;
}

[[nodiscard]] inline double bandCentreHz(std::uint32_t band) noexcept {
  return camToHz(static_cast<double>(band + 1u));
}

// Telemetry grid: f_i = 20 * 1000^(i / 127).
[[nodiscard]] inline double gridFrequencyHz(std::uint32_t index) noexcept {
  return 20.0 * portableDecadePower(3.0 * static_cast<double>(index) / 127.0);
}

// N = 2^round(log2(0.085 fs)), clamped to a sane range.
[[nodiscard]] inline std::uint32_t fftSizeForSampleRate(double sample_rate) noexcept {
  const double exponent = portableLog2(kFrameSeconds * sample_rate);
  int rounded = static_cast<int>(std::floor(exponent + 0.5));
  rounded = rounded < 6 ? 6 : (rounded > 16 ? 16 : rounded);
  return 1u << static_cast<unsigned>(rounded);
}

// Family 0 = 4096 / 44100 (92.9 ms), family 1 = 4096 / 48000 (85.3 ms): the
// nearer N / fs wins.
[[nodiscard]] inline std::uint32_t familyForSampleRate(double sample_rate) noexcept {
  const double frame_seconds = static_cast<double>(fftSizeForSampleRate(sample_rate)) / sample_rate;
  const double to_a = frame_seconds - 4096.0 / 44100.0;
  const double to_b = frame_seconds - 4096.0 / 48000.0;
  const double distance_a = to_a < 0.0 ? -to_a : to_a;
  const double distance_b = to_b < 0.0 ? -to_b : to_b;
  return distance_a <= distance_b ? 0u : 1u;
}

// Hearing threshold at frequency_hz (dB SPL), linear in log frequency.
class HearingThreshold final {
public:
  HearingThreshold() noexcept {
    for (std::uint32_t i = 0; i < kThresholdPointCount; ++i) {
      log_frequency_[i] = portableLog(kThresholdFrequencyHz[i]);
    }
  }

  [[nodiscard]] double thresholdDb(double frequency_hz) const noexcept {
    if (frequency_hz <= kThresholdFrequencyHz[0]) {
      return kThresholdDb[0];
    }
    if (frequency_hz >= kThresholdFrequencyHz[kThresholdPointCount - 1u]) {
      return kThresholdDb[kThresholdPointCount - 1u];
    }
    const double x = portableLog(frequency_hz);
    std::uint32_t upper = 1u;
    while (upper < kThresholdPointCount - 1u && kThresholdFrequencyHz[upper] <= frequency_hz) {
      ++upper;
    }
    const double x0 = log_frequency_[upper - 1u];
    const double x1 = log_frequency_[upper];
    const double t = (x - x0) / (x1 - x0);
    return kThresholdDb[upper - 1u] + t * (kThresholdDb[upper] - kThresholdDb[upper - 1u]);
  }

private:
  std::array<double, kThresholdPointCount> log_frequency_{};
};

// ---------------------------------------------------------------------------
// Integrators
// ---------------------------------------------------------------------------

// Rate of an integrator with time constant tau_seconds (finite, > 0) per hop.
[[nodiscard]] inline double hopAlpha(double tau_seconds, double hop_seconds) noexcept {
  return 1.0 - portableExp(-hop_seconds / tau_seconds);
}

// Growing-mean rate: max(alpha, 1 / count) for the count-th observation.
[[nodiscard]] inline double growingRate(double alpha, std::uint32_t count) noexcept {
  const double inverse = 1.0 / static_cast<double>(count);
  return alpha > inverse ? alpha : inverse;
}

// Since-reset mean and population variance of a scalar (Welford / West).
struct RunningLevel final {
  std::uint32_t count = 0u;
  double mean = 0.0;
  double variance = 0.0;

  void add(double value) noexcept {
    if (count == std::numeric_limits<std::uint32_t>::max()) {
      return;
    }
    ++count;
    const double rate = 1.0 / static_cast<double>(count);
    const double delta = value - mean;
    mean += rate * delta;
    variance = (1.0 - rate) * (variance + rate * delta * delta);
  }

  [[nodiscard]] double squaredStandardError() const noexcept {
    return count == 0u ? 0.0 : variance / static_cast<double>(count);
  }
};

// The two EMAs behind the gap statistic (power and ln power).
struct GapIntegrator final {
  std::uint32_t count = 0u;
  double power_mean = 0.0;
  double log_mean = 0.0;

  // power must be above kPowerFloor (frames at the floor value skip).
  void add(double power, double alpha) noexcept {
    if (count == std::numeric_limits<std::uint32_t>::max()) {
      return;
    }
    ++count;
    const double rate = growingRate(alpha, count);
    power_mean += rate * (power - power_mean);
    log_mean += rate * (portableLog(power) - log_mean);
  }

  [[nodiscard]] double gapDb() const noexcept {
    return portablePowerDb(power_mean) - kDbPerNeper * log_mean;
  }
};

// s_b(tau) interpolated linearly in log tau over the grid.  Returns false
// below the grid (no decision); above the grid the top entry is held (the
// kernel never asks above tau_max because tau_noise <= 60 s).
[[nodiscard]] inline bool gapSigmaAt(const CalibrationFamily &family, std::uint32_t band,
                                     double tau_seconds, double &sigma_db) noexcept {
  if (!(tau_seconds >= family.tau_seconds[0])) {
    return false;
  }
  if (tau_seconds >= family.tau_seconds[kTauGridCount - 1u]) {
    sigma_db = family.gap_sigma_db[band][kTauGridCount - 1u];
    return true;
  }
  std::uint32_t upper = 1u;
  while (upper < kTauGridCount - 1u && family.tau_seconds[upper] <= tau_seconds) {
    ++upper;
  }
  const double x0 = portableLog(family.tau_seconds[upper - 1u]);
  const double x1 = portableLog(family.tau_seconds[upper]);
  const double t = (portableLog(tau_seconds) - x0) / (x1 - x0);
  const double s0 = family.gap_sigma_db[band][upper - 1u];
  const double s1 = family.gap_sigma_db[band][upper];
  sigma_db = s0 + t * (s1 - s0);
  return true;
}

// ---------------------------------------------------------------------------
// Frame power
// ---------------------------------------------------------------------------

// One hop's spectral observation, produced by FrameAnalyzer.
struct HopObservation final {
  double kw_power = 0.0; // K-weighted power (all channels)
  std::uint32_t channel_count = 0u;
  std::array<double, kBandCount> own{};         // weighted own-band power (floored)
  std::array<double, kBandCount> centroid_hz{}; // band power centroid
  std::array<std::array<double, kBandCount>, kMaximumChannels> channel_own{}; // per channel
  std::array<double, kGridCount> cell_power{}; // K-weighted power per grid cell
};

// Band geometry, window, per-bin K-weighting and grid cells for one sample
// rate; accumulates per-channel spectra into a HopObservation.
class FrameAnalyzer final {
public:
  // Allocates.
  void prepare(double sample_rate) {
    sample_rate_ = sample_rate;
    fft_size_ = fftSizeForSampleRate(sample_rate);
    hop_size_ = fft_size_ / 4u;
    bin_count_ = fft_size_ / 2u + 1u;
    family_ = familyForSampleRate(sample_rate);
    const double bin_hz = sample_rate / static_cast<double>(fft_size_);

    window_.assign(fft_size_, 0.0F);
    double window_energy = 0.0;
    for (std::uint32_t n = 0; n < fft_size_; ++n) {
      const double w = 0.5 - 0.5 * portableCos(2.0 * kPi * static_cast<double>(n) /
                                               static_cast<double>(fft_size_));
      window_[n] = static_cast<float>(w);
      window_energy += static_cast<double>(window_[n]) * static_cast<double>(window_[n]);
    }
    power_scale_ = 2.0 / (static_cast<double>(fft_size_) * window_energy);

    measured_band_count_ = 0u;
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      const double centre = tonal_balance::bandCentreHz(b);
      const double half_width = 0.5 * erbWidthHz(centre);
      band_centre_hz_[b] = centre;
      // Rectangular band: f_k >= centre - w/2 and f_k < centre + w/2.
      const double begin = std::ceil((centre - half_width) / bin_hz);
      double end = std::ceil((centre + half_width) / bin_hz);
      const double limit = static_cast<double>(bin_count_);
      end = end > limit ? limit : end;
      band_bin_begin_[b] = static_cast<std::uint32_t>(begin);
      band_bin_end_[b] = end > begin ? static_cast<std::uint32_t>(end) : band_bin_begin_[b];
      if (centre < kBandUpperRatio * sample_rate && band_bin_end_[b] > band_bin_begin_[b]) {
        measured_band_count_ = b + 1u;
      }
    }

    // K-weighting per bin: |H_shelf(e^jw) H_hp(e^jw)|^2.
    const dsp::BiquadCoefficients highpass = dsp::k_weighting::designHighpass(sample_rate);
    const dsp::BiquadCoefficients shelf = dsp::k_weighting::designShelf(sample_rate);
    k_weight_.assign(bin_count_, 0.0);
    bin_cell_.assign(bin_count_, 0u);
    const double log_grid_step = kLn10 * 3.0 / 127.0; // ln(1000) / 127
    const double log_20 = portableLog(20.0);
    for (std::uint32_t k = 0; k < bin_count_; ++k) {
      const double omega = 2.0 * kPi * static_cast<double>(k) / static_cast<double>(fft_size_);
      k_weight_[k] = magnitudeSquared(highpass, omega) * magnitudeSquared(shelf, omega);
      const double frequency = static_cast<double>(k) * bin_hz;
      double cell = 0.0;
      if (frequency > 20.0) {
        cell = std::floor((portableLog(frequency) - log_20) / log_grid_step + 0.5);
      }
      cell =
          cell > static_cast<double>(kGridCount - 1u) ? static_cast<double>(kGridCount - 1u) : cell;
      bin_cell_[k] = static_cast<std::uint16_t>(cell);
    }
    channel_power_.assign(bin_count_, 0.0);
    total_power_.assign(bin_count_, 0.0);
  }

  [[nodiscard]] double sampleRate() const noexcept { return sample_rate_; }
  [[nodiscard]] std::uint32_t fftSize() const noexcept { return fft_size_; }
  [[nodiscard]] std::uint32_t hopSize() const noexcept { return hop_size_; }
  [[nodiscard]] std::uint32_t binCount() const noexcept { return bin_count_; }
  [[nodiscard]] std::uint32_t family() const noexcept { return family_; }
  [[nodiscard]] std::uint32_t measuredBandCount() const noexcept { return measured_band_count_; }
  [[nodiscard]] double hopSeconds() const noexcept {
    return static_cast<double>(hop_size_) / sample_rate_;
  }
  [[nodiscard]] double centreHz(std::uint32_t band) const noexcept { return band_centre_hz_[band]; }
  [[nodiscard]] std::uint32_t bandBinBegin(std::uint32_t band) const noexcept {
    return band_bin_begin_[band];
  }
  [[nodiscard]] std::uint32_t bandBinEnd(std::uint32_t band) const noexcept {
    return band_bin_end_[band];
  }
  [[nodiscard]] const float *window() const noexcept { return window_.data(); }

  // Multiplies the periodic Hann window into an FFT input frame.
  void applyWindow(const float *frame, float *windowed, std::uint32_t begin,
                   std::uint32_t end) const noexcept {
    for (std::uint32_t n = begin; n < end; ++n) {
      windowed[n] = frame[n] * window_[n];
    }
  }

  void beginHop(HopObservation &observation) noexcept {
    std::memset(total_power_.data(), 0, total_power_.size() * sizeof(double));
    observation.channel_count = 0u;
  }

  // Adds one channel's ordered pffft real spectrum (out[0] = DC, out[1] =
  // Nyquist, then re/im pairs).  channel_weight is the BS.1770 weight.
  void accumulateChannel(const float *spectrum, double channel_weight, std::uint32_t channel,
                         HopObservation &observation) noexcept {
    double *channel_power = channel_power_.data();
    double *total_power = total_power_.data();
    const double dc = static_cast<double>(spectrum[0]);
    const double nyquist = static_cast<double>(spectrum[1]);
    channel_power[0] = 0.5 * dc * dc * power_scale_;
    channel_power[bin_count_ - 1u] = 0.5 * nyquist * nyquist * power_scale_;
    for (std::uint32_t k = 1; k + 1u < bin_count_; ++k) {
      const double re = static_cast<double>(spectrum[2u * k]);
      const double im = static_cast<double>(spectrum[2u * k + 1u]);
      channel_power[k] = (re * re + im * im) * power_scale_;
    }
    for (std::uint32_t k = 0; k < bin_count_; ++k) {
      total_power[k] += channel_weight * channel_power[k];
    }
    if (channel < kMaximumChannels) {
      std::array<double, kBandCount> &own = observation.channel_own[channel];
      for (std::uint32_t b = 0; b < kBandCount; ++b) {
        double sum = 0.0;
        for (std::uint32_t k = band_bin_begin_[b]; k < band_bin_end_[b]; ++k) {
          sum += channel_power[k];
        }
        own[b] = sum < kPowerFloor ? kPowerFloor : sum;
      }
      if (channel + 1u > observation.channel_count) {
        observation.channel_count = channel + 1u;
      }
    }
  }

  // Band powers, centroids, K-weighted power and grid-cell powers of the
  // weighted sum.
  void finishHop(HopObservation &observation) noexcept {
    const double *total_power = total_power_.data();
    const double bin_hz = sample_rate_ / static_cast<double>(fft_size_);
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      double sum = 0.0;
      double moment = 0.0;
      for (std::uint32_t k = band_bin_begin_[b]; k < band_bin_end_[b]; ++k) {
        sum += total_power[k];
        moment += static_cast<double>(k) * total_power[k];
      }
      if (sum < kPowerFloor) {
        observation.own[b] = kPowerFloor;
        observation.centroid_hz[b] = band_centre_hz_[b];
      } else {
        observation.own[b] = sum;
        observation.centroid_hz[b] = moment / sum * bin_hz;
      }
    }
    std::array<double, kGridCount> &cells = observation.cell_power;
    cells.fill(0.0);
    double kw_power = 0.0;
    for (std::uint32_t k = 0; k < bin_count_; ++k) {
      const double weighted = k_weight_[k] * total_power[k];
      kw_power += weighted;
      cells[bin_cell_[k]] += weighted;
    }
    observation.kw_power = kw_power;
  }

private:
  [[nodiscard]] static double magnitudeSquared(const dsp::BiquadCoefficients &c,
                                               double omega) noexcept {
    const double c1 = portableCos(omega);
    const double s1 = portableSin(omega);
    const double c2 = portableCos(2.0 * omega);
    const double s2 = portableSin(2.0 * omega);
    const double num_re = c.b0 + c.b1 * c1 + c.b2 * c2;
    const double num_im = -(c.b1 * s1 + c.b2 * s2);
    const double den_re = 1.0 + c.a1 * c1 + c.a2 * c2;
    const double den_im = -(c.a1 * s1 + c.a2 * s2);
    return (num_re * num_re + num_im * num_im) / (den_re * den_re + den_im * den_im);
  }

  double sample_rate_ = 0.0;
  std::uint32_t fft_size_ = 0u;
  std::uint32_t hop_size_ = 0u;
  std::uint32_t bin_count_ = 0u;
  std::uint32_t family_ = 0u;
  std::uint32_t measured_band_count_ = 0u;
  double power_scale_ = 0.0;
  std::array<double, kBandCount> band_centre_hz_{};
  std::array<std::uint32_t, kBandCount> band_bin_begin_{};
  std::array<std::uint32_t, kBandCount> band_bin_end_{};
  std::vector<float> window_;
  std::vector<double> k_weight_;
  std::vector<std::uint16_t> bin_cell_;
  std::vector<double> channel_power_;
  std::vector<double> total_power_;
};

// ---------------------------------------------------------------------------
// Gate / integrator state machine (kernel side)
// ---------------------------------------------------------------------------

struct AnalysisSettings final {
  double alpha = 0.0;           // Averaging Time rate per hop (0 at Averaging Time infinity)
  double alpha_noise = 0.0;     // rate of the gap EMAs
  double tau_noise_seconds = 0; // tau behind alpha_noise
  double average_spl_db = 83.0;
};

struct BandStatistics final {
  double level_power = 0.0;    // Averaging-Time-integrated own-band power
  double level_mean_db = 0.0;  // EMA of the per-frame band level
  double level_variance = 0.0; // running variance v_b (starts at the table value)
  double persistence = 0.0;
  double content = 0.0;
  RunningLevel gated_in; // L_in,b
  RunningLevel quiet;    // L_q,b
  std::array<GapIntegrator, kMaximumChannels> gap{};
  bool stationary = false;
  bool floor = false;
  bool has_level = false;
};

class AnalysisEngine final {
public:
  void prepare(const FrameAnalyzer &analyzer, const CalibrationFamily &family) {
    hop_seconds_ = analyzer.hopSeconds();
    measured_band_count_ = analyzer.measuredBandCount();
    family_ = &family;
    double blocks = std::floor(kBlockSeconds / hop_seconds_ + 0.5);
    blocks = blocks < 1.0 ? 1.0 : blocks;
    block_hops_ = static_cast<std::uint32_t>(blocks);
    lag_hops_ = block_hops_ / 2u;
    block_ring_.assign(block_hops_, 0.0);
    pending_.assign(lag_hops_ + 1u, HopObservation{});
    alpha_gate_ = hopAlpha(kGateTauSeconds, hop_seconds_);
    reset();
  }

  void reset() noexcept {
    block_fill_ = 0u;
    block_write_ = 0u;
    pending_write_ = 0u;
    gate_reference_ = 0.0;
    gate_reference_valid_ = false;
    absolute_gate_ = false;
    relative_gate_ = false;
    gated_count_ = 0u;
    loudness_power_ = 0.0;
    loudness_count_ = 0u;
    integrated_.fill(0.0);
    for (BandStatistics &band : bands_) {
      band = BandStatistics{};
    }
    for (std::uint32_t b = 0; b < kBandCount; ++b) {
      bands_[b].level_variance = family_->frame_variance_db2[b];
    }
    for (double &value : block_ring_) {
      value = 0.0;
    }
  }

  void setSettings(const AnalysisSettings &settings) noexcept { settings_ = settings; }

  // Feeds one hop; the gate decision for the hop lag_hops_ earlier is taken
  // once the 400 ms block centred on it is complete.
  void submit(const HopObservation &observation) noexcept {
    // Block ring of K-weighted hop powers.
    block_ring_[block_write_] = observation.kw_power;
    block_write_ = block_write_ + 1u == block_hops_ ? 0u : block_write_ + 1u;
    if (block_fill_ < block_hops_) {
      ++block_fill_;
    }
    // Pending observation ring (the decided hop is lag_hops_ behind).
    pending_[pending_write_] = observation;
    const std::uint32_t decided = pending_write_ + 1u == pending_.size() ? 0u : pending_write_ + 1u;
    pending_write_ = decided;
    if (block_fill_ < block_hops_) {
      return;
    }
    double sum = 0.0;
    for (double value : block_ring_) {
      sum += value;
    }
    decide(pending_[decided], sum / static_cast<double>(block_hops_));
  }

  [[nodiscard]] bool absoluteGate() const noexcept { return absolute_gate_; }
  [[nodiscard]] bool relativeGate() const noexcept { return relative_gate_; }
  [[nodiscard]] bool loudnessValid() const noexcept { return loudness_count_ > 0u; }
  [[nodiscard]] double integratedLoudnessLkfs() const noexcept {
    return loudness_count_ == 0u ? 0.0
                                 : portablePowerDb(loudness_power_) - dsp::k_weighting::kLufsOffset;
  }
  [[nodiscard]] std::uint32_t gatedHopCount() const noexcept { return gated_count_; }
  [[nodiscard]] const BandStatistics &band(std::uint32_t index) const noexcept {
    return bands_[index];
  }
  [[nodiscard]] std::uint32_t measuredBandCount() const noexcept { return measured_band_count_; }
  [[nodiscard]] const std::array<double, kGridCount> &integratedCellPower() const noexcept {
    return integrated_;
  }

  // Effective independent count behind SE_b^2 = v_b / K_eff,b.
  [[nodiscard]] double effectiveCount(std::uint32_t band) const noexcept {
    const double count = static_cast<double>(gated_count_);
    double limit = count;
    if (settings_.alpha > 0.0) {
      const double window = (2.0 - settings_.alpha) / settings_.alpha;
      limit = count < window ? count : window;
    }
    return limit / (1.0 + 2.0 * family_->rho_sum[band]);
  }

  // Band level in dB of the Averaging-Time-integrated power (has_level required).
  [[nodiscard]] double levelDb(std::uint32_t band) const noexcept {
    return portablePowerDb(bands_[band].level_power);
  }

  // Measured band SPL of the integrated level (frame 29 level_db).
  [[nodiscard]] double levelSplDb(std::uint32_t band) const noexcept {
    return levelDb(band) - integratedLoudnessLkfs() + settings_.average_spl_db;
  }

private:
  void decide(const HopObservation &observation, double block_power) noexcept {
    const double absolute_threshold =
        portableDbPower(kAbsoluteGateLkfs + dsp::k_weighting::kLufsOffset);
    absolute_gate_ = block_power >= absolute_threshold;
    if (!absolute_gate_) {
      relative_gate_ = false;
      return;
    }
    if (!gate_reference_valid_) {
      gate_reference_ = block_power;
      gate_reference_valid_ = true;
    } else {
      gate_reference_ += alpha_gate_ * (block_power - gate_reference_);
    }
    relative_gate_ = block_power >= gate_reference_ * portableDbPower(kRelativeGateLu);
    if (!relative_gate_) {
      // Between-gate frame: quiet level means and the floor test only.
      for (std::uint32_t b = 0; b < measured_band_count_; ++b) {
        BandStatistics &band = bands_[b];
        if (observation.own[b] <= kPowerFloor) {
          continue; // frame at the power floor carries no spectral evidence (see gatedIn)
        }
        band.quiet.add(portablePowerDb(observation.own[b]));
        band.floor = floorTest(band);
      }
      return;
    }
    gatedIn(observation, block_power);
  }

  [[nodiscard]] static bool floorTest(const BandStatistics &band) noexcept {
    if (band.gated_in.count == 0u || band.quiet.count == 0u) {
      return false;
    }
    const double margin = kEvidenceZ * std::sqrt(band.gated_in.squaredStandardError() +
                                                 band.quiet.squaredStandardError());
    return (band.gated_in.mean - band.quiet.mean) <= margin;
  }

  void gatedIn(const HopObservation &observation, double block_power) noexcept {
    if (gated_count_ == std::numeric_limits<std::uint32_t>::max()) {
      return;
    }
    ++gated_count_;
    const double rate = growingRate(settings_.alpha, gated_count_);
    // Integrated loudness (alpha = 0) of the gated blocks.
    ++loudness_count_;
    loudness_power_ += (block_power - loudness_power_) / static_cast<double>(loudness_count_);
    const double loudness_lkfs = integratedLoudnessLkfs();
    // Averaging-Time-integrated K-weighted cell powers for the make-up gain.
    for (std::uint32_t i = 0; i < kGridCount; ++i) {
      integrated_[i] += rate * (observation.cell_power[i] - integrated_[i]);
    }
    const double variance_rate = growingRate(settings_.alpha, gated_count_ + 1u);
    for (std::uint32_t b = 0; b < measured_band_count_; ++b) {
      BandStatistics &band = bands_[b];
      const double own = observation.own[b];
      if (own <= kPowerFloor) {
        // A frame at the power floor (digital silence gated in around a pause) carries
        // no spectral evidence, so none of the band's integrators update (2.1, 2.4(b)).
        continue;
      }
      const double level_db = portablePowerDb(own);
      // Level and its running variance (the table variance counts as one observation).
      band.level_power += rate * (own - band.level_power);
      if (!band.has_level) {
        band.level_mean_db = level_db;
        band.has_level = true;
      } else {
        const double delta = level_db - band.level_mean_db;
        band.level_mean_db += variance_rate * delta;
        band.level_variance =
            (1.0 - variance_rate) * (band.level_variance + variance_rate * delta * delta);
      }
      band.gated_in.add(level_db);
      // (a) audibility at the band power centroid.
      const double centroid = observation.centroid_hz[b] < 20.0 ? 20.0 : observation.centroid_hz[b];
      const double spl_db = level_db - loudness_lkfs + settings_.average_spl_db;
      const double audible = spl_db >= threshold_.thresholdDb(centroid) ? 1.0 : 0.0;
      band.persistence += rate * (audible - band.persistence);
      // (b) per-channel gap EMAs over channels with non-zero BS.1770 weight.
      double gap_sum = 0.0;
      std::uint32_t gap_channels = 0u;
      std::uint32_t smallest_count = std::numeric_limits<std::uint32_t>::max();
      for (std::uint32_t c = 0; c < observation.channel_count; ++c) {
        if (dsp::k_weighting::channelWeight(c, observation.channel_count) <= 0.0) {
          continue;
        }
        GapIntegrator &gap = band.gap[c];
        const double channel_power = observation.channel_own[c][b];
        if (channel_power > kPowerFloor) {
          gap.add(channel_power, settings_.alpha_noise);
        }
        if (gap.count > 0u) {
          gap_sum += gap.gapDb();
          ++gap_channels;
          smallest_count = gap.count < smallest_count ? gap.count : smallest_count;
        }
      }
      bool decided = false;
      band.stationary = false;
      if (gap_channels > 0u) {
        const double gap_db = gap_sum / static_cast<double>(gap_channels);
        const double evidence = static_cast<double>(smallest_count) * hop_seconds_ * 0.5;
        const double tau_eff =
            evidence < settings_.tau_noise_seconds ? evidence : settings_.tau_noise_seconds;
        double sigma = 0.0;
        if (gapSigmaAt(*family_, b, tau_eff, sigma)) {
          decided = true;
          const double deviation = gap_db - family_->gap_zero_db[b];
          const double magnitude = deviation < 0.0 ? -deviation : deviation;
          band.stationary = magnitude < kEvidenceZ * sigma;
        }
      }
      // (c) floor test against the quiet statistics.
      band.floor = floorTest(band);
      const double content = (decided && !band.stationary && !band.floor) ? 1.0 : 0.0;
      band.content += rate * (content - band.content);
    }
  }

  AnalysisSettings settings_{};
  const CalibrationFamily *family_ = nullptr;
  HearingThreshold threshold_{};
  double hop_seconds_ = 0.0;
  std::uint32_t measured_band_count_ = 0u;
  std::uint32_t block_hops_ = 1u;
  std::uint32_t lag_hops_ = 0u;
  double alpha_gate_ = 0.0;
  std::vector<double> block_ring_;
  std::vector<HopObservation> pending_;
  std::uint32_t block_fill_ = 0u;
  std::uint32_t block_write_ = 0u;
  std::uint32_t pending_write_ = 0u;
  double gate_reference_ = 0.0;
  bool gate_reference_valid_ = false;
  bool absolute_gate_ = false;
  bool relative_gate_ = false;
  std::uint32_t gated_count_ = 0u;
  double loudness_power_ = 0.0;
  std::uint32_t loudness_count_ = 0u;
  std::array<double, kGridCount> integrated_{};
  std::array<BandStatistics, kBandCount> bands_{};
};

} // namespace effetune::plugins::eq::tonal_balance

#endif // EFFETUNE_TONAL_BALANCE_EQ_ANALYSIS_H
