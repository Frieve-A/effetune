#include "effetune/kernel.h"
#include "AnalogMeterPluginParams.h"
#include "binary_io.h"
#include "effetune/dsp/biquad.h"
#include "effetune/dsp/denormal_noise.h"
#include "effetune/dsp/k_weighting.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numbers>
#include <vector>

namespace effetune::plugins::analyzer {
namespace {

enum Mode : std::uint32_t { Vu, Ppm, Rms, SamplePeak, TruePeak, Loudness };

constexpr std::uint32_t kModeCount = 6u;
constexpr std::uint16_t kTelemetryType = 27u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kMaxTelemetryChannels = 16u;
constexpr std::uint32_t kProgramBytes = 24u;
constexpr double kFloorDb = -240.0;
// Values below this (-400 dB) are flushed so decaying detectors never go subnormal.
constexpr double kFlush = 1.0e-20;

// VU: a second-order needle whose step response reaches 99% at 300 ms with 1.25% overshoot
// (IEC 60268-17). The damping ratio gives the overshoot; the normalized 99% settling time of
// that second-order system sets the natural frequency.
constexpr double kVuDamping = 0.81271698642867751;
constexpr double kVuNormalized99Time = 4.0535737687598132;
constexpr double kVuRiseTime = 0.3;
// Full-wave rectified average times the sine form factor pi/2 reads a sine at its peak level.
constexpr double kVuRectifierGain = std::numbers::pi / 2.0;

// PPM (IEC 60268-10 quasi-peak): an instant-attack rectifier hold that decays with a time
// constant of kPpmHoldRatio * at, followed by a needle that rises toward it with
// kPpmNeedleRatio * at. Scaling both with the integration time `at` makes an `at`-long 5 kHz
// burst read -2 dB of the steady tone at every `at`, and with at = 5 ms a 10 ms burst reads
// -1 dB, the second Type I point that a single first-order stage misses.
constexpr double kPpmHoldRatio = 5.0;
constexpr double kPpmNeedleRatio = 1.0222396;

// RMS window: a ring of bucket sums, summed for every reading (no running sum drift).
constexpr std::uint32_t kRmsBuckets = 128u;

// True-peak interpolator: Kaiser-windowed sinc, taps per phase and window shape.
constexpr std::uint32_t kTruePeakTaps = 16u;
constexpr double kTruePeakBeta = 6.0;

// Loudness: 100 ms blocks, Momentary = 4 blocks, Short-term = 30 blocks (EBU R128). The
// windows slide every 10 ms sub-block so the readings move smoothly; the gating blocks for
// Integrated and LRA still complete on the 100 ms hop.
constexpr std::uint32_t kMomentaryBlocks = 4u;
constexpr std::uint32_t kShortTermBlocks = 30u;
constexpr std::uint32_t kSubBlocksPerBlock = 10u;
constexpr std::uint32_t kMomentarySubBlocks = kMomentaryBlocks * kSubBlocksPerBlock;
constexpr std::uint32_t kShortTermSubBlocks = kShortTermBlocks * kSubBlocksPerBlock;
constexpr double kAbsoluteGate = -70.0;
constexpr double kIntegratedRelativeGate = -10.0;
constexpr double kLraRelativeGate = -20.0;
// Histogram over -70..+30 LUFS in 0.01 LU bins; each bin keeps its count and exact power sum.
constexpr double kBinsPerLu = 100.0;
constexpr std::uint32_t kHistogramBins = 10000u;

double besselI0(double x) noexcept {
  double sum = 1.0;
  double term = 1.0;
  for (int k = 1; k < 40; ++k) {
    const double ratio = x / (2.0 * k);
    term *= ratio * ratio;
    sum += term;
  }
  return sum;
}

float linearToDb(double value) noexcept {
  if (!(value > 0.0)) {
    return static_cast<float>(kFloorDb);
  }
  const double db = 20.0 * std::log10(value);
  return static_cast<float>(db < kFloorDb ? kFloorDb : db);
}

double powerToLufs(double power) noexcept {
  if (!(power > 0.0)) {
    return kFloorDb;
  }
  const double lufs = 10.0 * std::log10(power) - dsp::k_weighting::kLufsOffset;
  return lufs < kFloorDb ? kFloorDb : lufs;
}

struct Histogram {
  std::vector<std::uint32_t> count;
  std::vector<double> power;

  void allocate() {
    count.assign(kHistogramBins, 0u);
    power.assign(kHistogramBins, 0.0);
  }
  void clear() noexcept {
    for (std::uint32_t bin = 0u; bin < kHistogramBins; ++bin) {
      count[bin] = 0u;
      power[bin] = 0.0;
    }
  }
  static std::uint32_t binOf(double lufs) noexcept {
    const double position = (lufs - kAbsoluteGate) * kBinsPerLu;
    if (position <= 0.0) {
      return 0u;
    }
    return position >= kHistogramBins - 1.0 ? kHistogramBins - 1u
                                            : static_cast<std::uint32_t>(position);
  }
  void add(double block_power) noexcept {
    const double lufs = powerToLufs(block_power);
    if (lufs < kAbsoluteGate) {
      return;
    }
    const std::uint32_t bin = binOf(lufs);
    ++count[bin];
    power[bin] += block_power;
  }
  // First bin at or above the relative gate derived from the power mean of every stored block.
  // Returns false when nothing passed the absolute gate.
  bool relativeGateBin(double relative_gate, std::uint32_t &gate_bin) const noexcept {
    double total_power = 0.0;
    double total_count = 0.0;
    for (std::uint32_t bin = 0u; bin < kHistogramBins; ++bin) {
      total_power += power[bin];
      total_count += count[bin];
    }
    if (total_count == 0.0) {
      return false;
    }
    const double gate = powerToLufs(total_power / total_count) + relative_gate;
    gate_bin = gate < kAbsoluteGate ? 0u : binOf(gate);
    return true;
  }
};

} // namespace

// Analog-style level meter. The detectors follow IEC 60268-17 (VU), IEC 60268-10 (PPM),
// ITU-R BS.1770-4 (true peak and loudness), and EBU Tech 3341/3342 (loudness range).
// Audio passes through unchanged; readings leave through telemetry frame type 27.
class AnalogMeterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::AnalogMeterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    rate_ = std::isfinite(info.sampleRate) && info.sampleRate > 0.0F
                ? static_cast<double>(info.sampleRate)
                : 48000.0;
    max_channels_ =
        info.maxChannels < kMaxTelemetryChannels ? info.maxChannels : kMaxTelemetryChannels;
    const std::size_t channels = max_channels_;

    const double period = 1.0 / rate_;
    const double natural = kVuNormalized99Time / kVuRiseTime;
    const double radius = std::exp(-kVuDamping * natural * period);
    vu_a1_ = -2.0 * radius * std::cos(natural * std::sqrt(1.0 - kVuDamping * kVuDamping) * period);
    vu_a2_ = radius * radius;
    vu_gain_ = 1.0 + vu_a1_ + vu_a2_;

    designTruePeak();
    k_highpass_ = dsp::k_weighting::designHighpass(rate_);
    k_shelf_ = dsp::k_weighting::designShelf(rate_);
    const double block = std::round(rate_ * 0.1);
    block_length_ = block > 1.0 ? static_cast<std::uint32_t>(block) : 1u;

    level_.assign(channels, 0.0);
    level_state_.assign(channels, 0.0);
    interval_max_.assign(channels, 0.0);
    peak_history_.assign(channels * 2u * kTruePeakTaps, 0.0F);
    rms_ring_.assign(channels * kRmsBuckets, 0.0);
    rms_bucket_.assign(channels, 0.0);
    k_highpass_states_.assign(channels, {});
    k_shelf_states_.assign(channels, {});
    sub_block_sum_.assign(channels, 0.0);
    sub_block_ring_.assign(channels * kShortTermSubBlocks, 0.0);
    momentary_.assign(channels, 0.0);
    short_term_.assign(channels, 0.0);
    integrated_histogram_.allocate();
    lra_histogram_.allocate();
    reset();
  }

  void reset() noexcept override {
    active_channels_ = 0u;
    denormal_noise_.reset();
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u) {
      return;
    }
    synchronize(channel_count);
    switch (mode_) {
    case Vu:
      processVu(audio, frame_count);
      break;
    case Ppm:
      processPpm(audio, frame_count);
      break;
    case Rms:
      processRms(audio, frame_count);
      break;
    case SamplePeak:
    case TruePeak:
      processPeak(audio, frame_count, mode_ == TruePeak);
      break;
    default:
      processLoudness(audio, frame_count);
      break;
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (active_channels_ == 0u) {
      return;
    }
    std::array<std::uint8_t, 4u + 8u * kMaxTelemetryChannels + kProgramBytes> payload{};
    const bool loudness = mode_ == Loudness;
    std::uint16_t flags = 0u;
    payload[0] = static_cast<std::uint8_t>(mode_);
    payload[1] = static_cast<std::uint8_t>(active_channels_);
    std::uint8_t *record = payload.data() + 4u;
    for (std::uint32_t channel = 0u; channel < active_channels_; ++channel, record += 8u) {
      if (loudness) {
        binary_io::writeF32(record, static_cast<float>(powerToLufs(momentary_[channel])));
        binary_io::writeF32(record + 4u, static_cast<float>(powerToLufs(short_term_[channel])));
      } else {
        binary_io::writeF32(record, linearToDb(level_[channel]));
        binary_io::writeF32(record + 4u, linearToDb(interval_max_[channel]));
      }
    }
    std::uint32_t bytes = 4u + 8u * active_channels_;
    if (loudness) {
      flags = static_cast<std::uint16_t>((integrated_valid_ ? 1u : 0u) | (lra_valid_ ? 2u : 0u));
      binary_io::writeF32(record, static_cast<float>(powerToLufs(program_momentary_)));
      binary_io::writeF32(record + 4u, static_cast<float>(powerToLufs(program_short_term_)));
      binary_io::writeF32(record + 8u, integrated_valid_ ? static_cast<float>(integrated_) : 0.0F);
      binary_io::writeF32(record + 12u, lra_valid_ ? static_cast<float>(lra_) : 0.0F);
      binary_io::writeF32(record + 16u, linearToDb(max_true_peak_));
      binary_io::writeF32(record + 20u, static_cast<float>(block_count_ * 0.1));
      bytes += kProgramBytes;
    }
    binary_io::writeU16(payload.data() + 2u, flags);
    if (!writer.write(kTelemetryType, kTelemetryVersion, payload.data(),
                      static_cast<std::uint16_t>(bytes))) {
      return; // keep the interval maxima for the next accepted frame
    }
    for (std::uint32_t channel = 0u; channel < active_channels_; ++channel) {
      interval_max_[channel] = level_[channel];
    }
  }

private:
  void designTruePeak() noexcept {
    // Smallest factor that brings the interpolated rate to 176.4 kHz or above, at most 4.
    true_peak_factor_ = rate_ >= 176400.0 ? 1u : (rate_ >= 88200.0 ? 2u : 4u);
    const double half = kTruePeakTaps / 2.0;
    const double window_norm = besselI0(kTruePeakBeta);
    // Phase 0 is the delayed input sample itself; phases 1..L-1 interpolate between samples.
    for (std::uint32_t phase = 1u; phase < true_peak_factor_; ++phase) {
      double sum = 0.0;
      std::array<double, kTruePeakTaps> taps{};
      for (std::uint32_t tap = 0u; tap < kTruePeakTaps; ++tap) {
        // Tap k weights x[n - k]; the interpolated instant is n - half + phase / L.
        const double u = tap - half + static_cast<double>(phase) / true_peak_factor_;
        const double r = u / half;
        const double window = besselI0(kTruePeakBeta * std::sqrt(1.0 - r * r)) / window_norm;
        const double sinc = std::sin(std::numbers::pi * u) / (std::numbers::pi * u);
        taps[tap] = sinc * window;
        sum += taps[tap];
      }
      // Unity DC gain per phase; stored oldest-first to match the history layout.
      for (std::uint32_t tap = 0u; tap < kTruePeakTaps; ++tap) {
        true_peak_taps_[phase - 1u][kTruePeakTaps - 1u - tap] = taps[tap] / sum;
      }
    }
  }

  // Release falls 20 dB in `rt` seconds (linear in dB); PPM time constants follow `at`.
  void updateBallistics() noexcept {
    release_ = params_.release;
    attack_ = params_.attack;
    const double release = release_ > 0.1F ? release_ : 0.1;
    release_factor_ = std::pow(10.0, -1.0 / (release * rate_));
    const double attack = (attack_ > 1.0F ? attack_ : 1.0) * 0.001;
    ppm_hold_decay_ = std::exp(-1.0 / (kPpmHoldRatio * attack * rate_));
    ppm_needle_rise_ = 1.0 - std::exp(-1.0 / (kPpmNeedleRatio * attack * rate_));
  }

  void synchronize(std::uint32_t channel_count) noexcept {
    const float requested_mode = params_.mode + 0.5F;
    const auto mode = static_cast<Mode>(requested_mode < 0.0F
                                            ? 0u
                                            : (requested_mode >= static_cast<float>(kModeCount)
                                                   ? kModeCount - 1u
                                                   : static_cast<std::uint32_t>(requested_mode)));
    if (channel_count != active_channels_ || mode != mode_) {
      mode_ = mode;
      active_channels_ = channel_count;
      clearDetectors();
      clearRms();
      clearLoudness();
    } else if (params_.integration != integration_) {
      clearRms();
    }
    if (params_.release != release_ || params_.attack != attack_) {
      updateBallistics();
    }
  }

  void clearDetectors() noexcept {
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      level_[channel] = 0.0;
      level_state_[channel] = 0.0;
      interval_max_[channel] = 0.0;
    }
    for (float &sample : peak_history_) {
      sample = 0.0F;
    }
    peak_position_ = 0u;
    updateBallistics();
  }

  void clearRms() noexcept {
    integration_ = params_.integration;
    const double bucket = std::round(static_cast<double>(integration_) * rate_ / kRmsBuckets);
    rms_bucket_length_ = bucket > 1.0 ? static_cast<std::uint32_t>(bucket) : 1u;
    rms_bucket_position_ = 0u;
    rms_bucket_index_ = 0u;
    for (double &sum : rms_ring_) {
      sum = 0.0;
    }
    for (double &sum : rms_bucket_) {
      sum = 0.0;
    }
  }

  void clearLoudness() noexcept {
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      k_highpass_states_[channel].reset();
      k_shelf_states_[channel].reset();
      sub_block_sum_[channel] = 0.0;
      momentary_[channel] = 0.0;
      short_term_[channel] = 0.0;
    }
    for (double &sub_block : sub_block_ring_) {
      sub_block = 0.0;
    }
    integrated_histogram_.clear();
    lra_histogram_.clear();
    block_position_ = 0u;
    sub_block_ = 0u;
    sub_block_index_ = 0u;
    block_count_ = 0u;
    program_momentary_ = 0.0;
    program_short_term_ = 0.0;
    integrated_ = 0.0;
    lra_ = 0.0;
    max_true_peak_ = 0.0;
    integrated_valid_ = false;
    lra_valid_ = false;
  }

  void holdMax(std::uint32_t channel, double value) noexcept {
    level_[channel] = value;
    if (value > interval_max_[channel]) {
      interval_max_[channel] = value;
    }
  }

  void processVu(const float *audio, std::uint32_t frame_count) noexcept {
    for (std::uint32_t channel = 0u; channel < active_channels_; ++channel) {
      const float *input = audio + static_cast<std::size_t>(channel) * frame_count;
      double y1 = level_[channel];
      double y2 = level_state_[channel];
      double peak = interval_max_[channel];
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double sample = input[frame];
        const double rectified = (sample < 0.0 ? -sample : sample) * kVuRectifierGain;
        const double y = vu_gain_ * rectified - vu_a1_ * y1 - vu_a2_ * y2;
        y2 = y1;
        y1 = y;
        peak = y > peak ? y : peak;
      }
      if ((y1 < 0.0 ? -y1 : y1) < kFlush && (y2 < 0.0 ? -y2 : y2) < kFlush) {
        y1 = 0.0;
        y2 = 0.0;
      }
      level_[channel] = y1;
      level_state_[channel] = y2;
      interval_max_[channel] = peak;
    }
  }

  void processPpm(const float *audio, std::uint32_t frame_count) noexcept {
    for (std::uint32_t channel = 0u; channel < active_channels_; ++channel) {
      const float *input = audio + static_cast<std::size_t>(channel) * frame_count;
      double hold = level_state_[channel];
      double needle = level_[channel];
      double peak = interval_max_[channel];
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double sample = input[frame];
        const double rectified = sample < 0.0 ? -sample : sample;
        const double decayed = hold * ppm_hold_decay_;
        hold = rectified > decayed ? rectified : decayed;
        if (hold > needle) {
          needle += ppm_needle_rise_ * (hold - needle);
        } else {
          const double fallen = needle * release_factor_;
          needle = fallen > hold ? fallen : hold;
        }
        peak = needle > peak ? needle : peak;
      }
      level_state_[channel] = hold < kFlush ? 0.0 : hold;
      level_[channel] = needle < kFlush ? 0.0 : needle;
      interval_max_[channel] = peak;
    }
  }

  void processRms(const float *audio, std::uint32_t frame_count) noexcept {
    const double scale = 2.0 / (static_cast<double>(kRmsBuckets) * rms_bucket_length_);
    std::uint32_t offset = 0u;
    while (offset < frame_count) {
      const std::uint32_t remaining = rms_bucket_length_ - rms_bucket_position_;
      const std::uint32_t count =
          remaining < frame_count - offset ? remaining : frame_count - offset;
      for (std::uint32_t channel = 0u; channel < active_channels_; ++channel) {
        const float *input = audio + static_cast<std::size_t>(channel) * frame_count + offset;
        double sum = rms_bucket_[channel];
        for (std::uint32_t frame = 0u; frame < count; ++frame) {
          const double sample = input[frame];
          sum += sample * sample;
        }
        rms_bucket_[channel] = sum;
      }
      offset += count;
      rms_bucket_position_ += count;
      if (rms_bucket_position_ < rms_bucket_length_) {
        break;
      }
      rms_bucket_position_ = 0u;
      for (std::uint32_t channel = 0u; channel < active_channels_; ++channel) {
        double *ring = rms_ring_.data() + static_cast<std::size_t>(channel) * kRmsBuckets;
        ring[rms_bucket_index_] = rms_bucket_[channel];
        rms_bucket_[channel] = 0.0;
        double window = 0.0;
        for (std::uint32_t bucket = 0u; bucket < kRmsBuckets; ++bucket) {
          window += ring[bucket];
        }
        // sqrt(2 * mean square) reads a sine at its peak level (+3.01 dB over RMS).
        holdMax(channel, std::sqrt(window * scale));
      }
      rms_bucket_index_ = rms_bucket_index_ + 1u == kRmsBuckets ? 0u : rms_bucket_index_ + 1u;
    }
  }

  // Pushes one sample into the channel history and returns the oversampled absolute peak.
  double truePeakSample(std::uint32_t channel, float sample) noexcept {
    if (true_peak_factor_ == 1u) {
      return sample < 0.0F ? -static_cast<double>(sample) : static_cast<double>(sample);
    }
    float *history = peak_history_.data() + static_cast<std::size_t>(channel) * 2u * kTruePeakTaps;
    history[peak_position_] = sample;
    history[peak_position_ + kTruePeakTaps] = sample;
    // After the write, history[position + 1 .. position + taps] is the window, oldest first.
    const float *window = history + peak_position_ + 1u;
    const double center = window[kTruePeakTaps - 1u - kTruePeakTaps / 2u];
    double peak = center < 0.0 ? -center : center;
    for (std::uint32_t phase = 0u; phase + 1u < true_peak_factor_; ++phase) {
      const double *taps = true_peak_taps_[phase].data();
      double value = 0.0;
      for (std::uint32_t tap = 0u; tap < kTruePeakTaps; ++tap) {
        value += taps[tap] * window[tap];
      }
      value = value < 0.0 ? -value : value;
      peak = value > peak ? value : peak;
    }
    return peak;
  }

  void advancePeakPosition(std::uint32_t frames) noexcept {
    peak_position_ = (peak_position_ + frames) % kTruePeakTaps;
  }

  void processPeak(const float *audio, std::uint32_t frame_count, bool true_peak) noexcept {
    const std::uint32_t start = peak_position_;
    for (std::uint32_t channel = 0u; channel < active_channels_; ++channel) {
      const float *input = audio + static_cast<std::size_t>(channel) * frame_count;
      double y = level_[channel];
      double peak = interval_max_[channel];
      peak_position_ = start;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        double rectified;
        if (true_peak) {
          rectified = truePeakSample(channel, input[frame]);
          advancePeakPosition(1u);
        } else {
          rectified = input[frame] < 0.0F ? -static_cast<double>(input[frame]) : input[frame];
        }
        const double decayed = y * release_factor_;
        y = rectified > decayed ? rectified : decayed;
        peak = y > peak ? y : peak;
      }
      level_[channel] = y < kFlush ? 0.0 : y;
      interval_max_[channel] = peak;
    }
    peak_position_ = start;
    advancePeakPosition(frame_count % kTruePeakTaps);
  }

  void processLoudness(const float *audio, std::uint32_t frame_count) noexcept {
    const std::uint32_t peak_start = peak_position_;
    std::uint32_t offset = 0u;
    while (offset < frame_count) {
      // Sub-block boundaries depend only on the position inside the 100 ms block, so every
      // 10 consecutive sub-blocks hold exactly block_length_ samples.
      const std::uint32_t sub_block_end = static_cast<std::uint32_t>(
          static_cast<std::uint64_t>(sub_block_ + 1u) * block_length_ / kSubBlocksPerBlock);
      const std::uint32_t remaining = sub_block_end - block_position_;
      const std::uint32_t count =
          remaining < frame_count - offset ? remaining : frame_count - offset;
      for (std::uint32_t channel = 0u; channel < active_channels_; ++channel) {
        const float *input = audio + static_cast<std::size_t>(channel) * frame_count + offset;
        double sum = sub_block_sum_[channel];
        double peak = max_true_peak_;
        peak_position_ = (peak_start + offset) % kTruePeakTaps;
        for (std::uint32_t frame = 0u; frame < count; ++frame) {
          const double noise = denormal_noise_.sample(offset + frame);
          const double stage = dsp::processBiquadDf1SampleWithDenormalNoise(
              static_cast<double>(input[frame]), k_highpass_, k_highpass_states_[channel], noise);
          const double weighted = dsp::processBiquadDf1SampleWithDenormalNoise(
              stage, k_shelf_, k_shelf_states_[channel], noise);
          sum += weighted * weighted;
          const double sample_peak = truePeakSample(channel, input[frame]);
          advancePeakPosition(1u);
          peak = sample_peak > peak ? sample_peak : peak;
        }
        sub_block_sum_[channel] = sum;
        max_true_peak_ = peak;
      }
      offset += count;
      block_position_ += count;
      if (block_position_ == sub_block_end) {
        completeSubBlock();
      }
    }
    peak_position_ = peak_start;
    advancePeakPosition(frame_count % kTruePeakTaps);
    denormal_noise_.advance(frame_count);
  }

  // Slides Momentary and Short-term by one 10 ms sub-block; the gating statistics only advance
  // when the 100 ms block completes.
  void completeSubBlock() noexcept {
    const double momentary_scale = 1.0 / (static_cast<double>(block_length_) * kMomentaryBlocks);
    const double short_term_scale = 1.0 / (static_cast<double>(block_length_) * kShortTermBlocks);
    double program_momentary = 0.0;
    double program_short_term = 0.0;
    for (std::uint32_t channel = 0u; channel < active_channels_; ++channel) {
      double *ring =
          sub_block_ring_.data() + static_cast<std::size_t>(channel) * kShortTermSubBlocks;
      ring[sub_block_index_] = sub_block_sum_[channel];
      sub_block_sum_[channel] = 0.0;
      // Re-summed every time (no running sum); missing sub-blocks before the window fills
      // count as silence.
      double momentary = 0.0;
      for (std::uint32_t back = 0u; back < kMomentarySubBlocks; ++back) {
        const std::uint32_t index = sub_block_index_ >= back
                                        ? sub_block_index_ - back
                                        : sub_block_index_ + kShortTermSubBlocks - back;
        momentary += ring[index];
      }
      double short_term = 0.0;
      for (std::uint32_t index = 0u; index < kShortTermSubBlocks; ++index) {
        short_term += ring[index];
      }
      momentary_[channel] = momentary * momentary_scale;
      short_term_[channel] = short_term * short_term_scale;
      const double weight = dsp::k_weighting::channelWeight(channel, active_channels_);
      program_momentary += weight * momentary_[channel];
      program_short_term += weight * short_term_[channel];
    }
    program_momentary_ = program_momentary;
    program_short_term_ = program_short_term;
    sub_block_index_ = sub_block_index_ + 1u == kShortTermSubBlocks ? 0u : sub_block_index_ + 1u;
    if (++sub_block_ < kSubBlocksPerBlock) {
      return;
    }
    sub_block_ = 0u;
    block_position_ = 0u;
    ++block_count_;
    if (block_count_ >= kMomentaryBlocks) {
      integrated_histogram_.add(program_momentary);
      updateIntegrated();
    }
    if (block_count_ >= kShortTermBlocks) {
      lra_histogram_.add(program_short_term);
      updateLra();
    }
  }

  // BS.1770-4 gated integration of the 400 ms blocks (75% overlap).
  void updateIntegrated() noexcept {
    std::uint32_t gate_bin = 0u;
    integrated_valid_ = false;
    if (!integrated_histogram_.relativeGateBin(kIntegratedRelativeGate, gate_bin)) {
      return;
    }
    double power = 0.0;
    double count = 0.0;
    for (std::uint32_t bin = gate_bin; bin < kHistogramBins; ++bin) {
      power += integrated_histogram_.power[bin];
      count += integrated_histogram_.count[bin];
    }
    if (count > 0.0) {
      integrated_ = powerToLufs(power / count);
      integrated_valid_ = true;
    }
  }

  // EBU Tech 3342: 10th to 95th percentile spread of the gated short-term loudness values.
  void updateLra() noexcept {
    std::uint32_t gate_bin = 0u;
    lra_valid_ = false;
    if (!lra_histogram_.relativeGateBin(kLraRelativeGate, gate_bin)) {
      return;
    }
    std::uint64_t total = 0u;
    for (std::uint32_t bin = gate_bin; bin < kHistogramBins; ++bin) {
      total += lra_histogram_.count[bin];
    }
    if (total == 0u) {
      return;
    }
    const auto low_rank = static_cast<std::uint64_t>(std::round((total - 1u) * 0.10));
    const auto high_rank = static_cast<std::uint64_t>(std::round((total - 1u) * 0.95));
    std::uint64_t seen = 0u;
    double low = 0.0;
    double high = 0.0;
    bool low_found = false;
    for (std::uint32_t bin = gate_bin; bin < kHistogramBins; ++bin) {
      seen += lra_histogram_.count[bin];
      const double center = kAbsoluteGate + (bin + 0.5) / kBinsPerLu;
      if (!low_found && seen > low_rank) {
        low = center;
        low_found = true;
      }
      if (seen > high_rank) {
        high = center;
        break;
      }
    }
    lra_ = high - low;
    lra_valid_ = true;
  }

  std::vector<double> level_;
  std::vector<double> level_state_;
  std::vector<double> interval_max_;
  std::vector<float> peak_history_;
  std::vector<double> rms_ring_;
  std::vector<double> rms_bucket_;
  std::vector<dsp::BiquadDf1State> k_highpass_states_;
  std::vector<dsp::BiquadDf1State> k_shelf_states_;
  std::vector<double> sub_block_sum_;
  std::vector<double> sub_block_ring_;
  std::vector<double> momentary_;
  std::vector<double> short_term_;
  Histogram integrated_histogram_;
  Histogram lra_histogram_;
  std::array<std::array<double, kTruePeakTaps>, 3u> true_peak_taps_{};
  dsp::BiquadCoefficients k_highpass_{};
  dsp::BiquadCoefficients k_shelf_{};
  dsp::NyquistDenormalNoise denormal_noise_;
  double rate_ = 48000.0;
  double vu_a1_ = 0.0;
  double vu_a2_ = 0.0;
  double vu_gain_ = 1.0;
  double ppm_hold_decay_ = 0.0;
  double ppm_needle_rise_ = 1.0;
  double release_factor_ = 1.0;
  double program_momentary_ = 0.0;
  double program_short_term_ = 0.0;
  double integrated_ = 0.0;
  double lra_ = 0.0;
  double max_true_peak_ = 0.0;
  std::uint64_t block_count_ = 0u;
  float release_ = 0.0F;
  float attack_ = 0.0F;
  float integration_ = 0.0F;
  Mode mode_ = Vu;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t active_channels_ = 0u;
  std::uint32_t true_peak_factor_ = 1u;
  std::uint32_t peak_position_ = 0u;
  std::uint32_t rms_bucket_length_ = 1u;
  std::uint32_t rms_bucket_position_ = 0u;
  std::uint32_t rms_bucket_index_ = 0u;
  std::uint32_t block_length_ = 1u;
  std::uint32_t block_position_ = 0u;
  std::uint32_t sub_block_ = 0u;
  std::uint32_t sub_block_index_ = 0u;
  bool integrated_valid_ = false;
  bool lra_valid_ = false;
};

static_assert(sizeof(AnalogMeterKernel) <= 8192u);

} // namespace effetune::plugins::analyzer

EFFETUNE_REGISTER_KERNEL(AnalogMeterPlugin, effetune::plugins::analyzer::AnalogMeterKernel)
