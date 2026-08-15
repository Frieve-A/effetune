#include "effetune/kernel.h"
#include "TapeArtifactsPluginParams.h"
#include "effetune/dsp/math.h"
#include "effetune/dsp/xorshift_rng.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

// Every constant below is transcribed from plugins/lofi/tape_artifacts.js. The
// JavaScript reference is the golden source, so the arithmetic here follows its
// expression shapes literally rather than an algebraically equivalent form.
constexpr double kPi = 3.141592653589793;
constexpr double kTwoPi = 6.283185307179586;

constexpr double kRecordPreCornerHz = 3000.0;
constexpr double kRecordPreGain = 3.1622776601683795;
constexpr double kEqReferenceHz = 1000.0;
constexpr double kPlayGapMeters = 3.0e-6;
constexpr double kSpacingMeters = 0.25e-6;
constexpr double kContactLengthMeters = 4.8e-3;
constexpr double kHeadBumpQ = 0.72;
constexpr double kRecordBandwidthHz = 20000.0;
constexpr double kTrimMaxGain = 7.943282347242816;
constexpr double kThicknessThreeDb = 0.742;
constexpr double kGapThreeDb = 1.3916;
constexpr double kSpacingThreeDb = 0.3454;
constexpr double kSaturationReferenceDbfs = -18.0;
constexpr double kSaturationReferenceT = 0.1157;
constexpr double kHissOffDb = -89.0;
constexpr double kSaturationAsymmetry = 0.12;
constexpr double kMemoryDepth = 0.25;
constexpr double kMemoryAttackSeconds = 0.002;
constexpr double kMemoryReleaseSeconds = 0.015;
constexpr double kDcBlockHz = 5.0;
constexpr double kBiasCornerHz = 60000.0;
constexpr double kBiasCornerExponent = 1.1;
constexpr double kBiasShelfHz = 12000.0;
constexpr double kBiasPeakCurvature = 0.2;
constexpr double kBiasPeakWidthDb = 0.5;
constexpr double kBiasShelfLimitDb = 40.0;
constexpr double kBiasProbeHz = 10000.0;
constexpr double kWowFlutterReferencePercent = 0.04;
constexpr double kWowRateHz = 0.55;
constexpr double kWowSeconds = 59.741e-6;
constexpr double kFlutterCornerHz = 10.0;
constexpr double kFlutterSeconds = 2.8676e-6;
constexpr double kTransportDepthExponent = 1.318;
constexpr double kTransportBaseSeconds = 0.005;
constexpr std::int32_t kDelayLength = 4096;
constexpr std::int32_t kDelayMask = 4095;
constexpr double kOsH1 = 0.31238803284111993;
constexpr double kOsH3 = -0.089587837502923581;
constexpr double kOsH5 = 0.039210420871375766;
constexpr double kOsH7 = -0.016676371213684291;
constexpr double kOsH9 = 0.0057277622021075980;
constexpr double kOsH11 = -0.0010620071979954024;
constexpr std::int32_t kOsHistory = 16;
constexpr std::int32_t kOsMask = 15;
constexpr std::int32_t kOsLatency = 11;
constexpr double kHissHighPassHz = 60.0;
constexpr double kHissLowPassHz = 12000.0;
constexpr double kModulationLengthMeters = 180.0e-6;
constexpr double kNoiseSpeedReference = 0.381;
constexpr double kAWeightingF1 = 20.598997;
constexpr double kAWeightingF2 = 107.65265;
constexpr double kAWeightingF3 = 737.86223;
constexpr double kAWeightingF4 = 12194.217;
constexpr double kAWeightingReferenceHz = 1000.0;
constexpr int kNoiseIntegrationPoints = 4096;
constexpr double kRngScale = 4.656612873077393e-10;
constexpr double kDenormalThreshold = 1.0e-30;
constexpr std::int32_t kSeedFallback = 0x1a2b3c4d;

constexpr int kSectionRecordEq = 0;
constexpr int kSectionBias = 1;
constexpr int kSectionBiasShelf = 2;
constexpr int kSectionLossA = 3;
constexpr int kSectionLossB = 4;
constexpr int kSectionReproduceEq = 5;
constexpr int kSectionHissHp = 6;
constexpr int kSectionHissLp = 7;
constexpr int kSectionModulation = 8;
constexpr int kSectionCount = 9;

constexpr int kBiquadRecordAmp = 0;
constexpr int kBiquadHeadBump = 1;
constexpr int kBiquadCount = 2;

struct SpeedEntry final {
  double v;
  double bumpDb;
};

struct TapeEntry final {
  double coating;
  double headroomDb;
  double bniecDb[3];
  double dcnDb[3];
  double deltaS10Db[3];
};

constexpr SpeedEntry kSpeeds[3] = {{0.1905, 1.5}, {0.381, 0.8}, {0.762, 0.43}};

constexpr TapeEntry kTapes[2] = {
    {14.5e-6, 0.0, {-64.0, -62.5, -64.5}, {-56.0, -57.0, -60.0}, {5.0, 4.0, 1.5}},
    {17.5e-6, 3.0, {-63.0, -62.0, -66.0}, {-58.0, -59.0, -59.5}, {6.5, 4.0, 1.5}}};

// The reference-configuration hiss flux, read out of the same table the
// JavaScript reads it from: Standard tape at 15 ips.
constexpr double kHissReferenceDb = -62.5;

struct SectionCoefficients final {
  double b0[kSectionCount]{};
  double b1[kSectionCount]{};
  double a1[kSectionCount]{};
};

void firstOrder(double tau_zero, double tau_pole, double two_fs, SectionCoefficients &out,
                int index) noexcept {
  const double nyquist = two_fs * 0.25;
  const double zero_ratio = tau_zero > 0.0 ? kTwoPi * nyquist * tau_zero : 0.0;
  const double pole_ratio = tau_pole > 0.0 ? kTwoPi * nyquist * tau_pole : 0.0;
  const double nyquist_magnitude =
      std::sqrt((1.0 + zero_ratio * zero_ratio) / (1.0 + pole_ratio * pole_ratio));
  const double pole = tau_pole > 0.0 ? std::exp(-2.0 / (tau_pole * two_fs)) : 0.0;
  const double low = 1.0 - pole;
  const double high = (1.0 + pole) * nyquist_magnitude;
  out.b0[index] = (low + high) * 0.5;
  out.b1[index] = (low - high) * 0.5;
  out.a1[index] = -pole;
}

void scaleSection(SectionCoefficients &out, int index, double gain) noexcept {
  out.b0[index] *= gain;
  out.b1[index] *= gain;
}

void invertSection(SectionCoefficients &out, int source, int target) noexcept {
  const double inverse_b0 = 1.0 / out.b0[source];
  out.b0[target] = inverse_b0;
  out.b1[target] = out.a1[source] * inverse_b0;
  out.a1[target] = out.b1[source] * inverse_b0;
}

double sectionMagnitude(const SectionCoefficients &out, int index, double omega) noexcept {
  const double cosine = std::cos(omega);
  const double sine = std::sin(omega);
  const double b0 = out.b0[index];
  const double b1 = out.b1[index];
  const double a1 = out.a1[index];
  const double numerator_real = b0 + b1 * cosine;
  const double numerator_imag = -b1 * sine;
  const double denominator_real = 1.0 + a1 * cosine;
  const double denominator_imag = -a1 * sine;
  const double numerator_sq = numerator_real * numerator_real + numerator_imag * numerator_imag;
  const double denominator_sq =
      denominator_real * denominator_real + denominator_imag * denominator_imag;
  return std::sqrt(numerator_sq / (denominator_sq > 1.0e-300 ? denominator_sq : 1.0e-300));
}

double aWeighting(double frequency) noexcept {
  const double squared = frequency * frequency;
  const double top_squared = kAWeightingF4 * kAWeightingF4;
  return (top_squared * squared * squared) / ((squared + kAWeightingF1 * kAWeightingF1) *
                                              std::sqrt((squared + kAWeightingF2 * kAWeightingF2) *
                                                        (squared + kAWeightingF3 * kAWeightingF3)) *
                                              (squared + top_squared));
}

double cascadeNoiseGain(const SectionCoefficients &out, const int *indices, int index_count,
                        int points, double rate, bool weighted) noexcept {
  // The curve is defined up to a constant; 1 kHz is its unity point.
  const double a_weighting_unity = 1.0 / aWeighting(kAWeightingReferenceHz);
  double total = 0.0;
  for (int k = 0; k < points; k++) {
    const double omega = kPi * (static_cast<double>(k) + 0.5) / static_cast<double>(points);
    double magnitude = 1.0;
    for (int s = 0; s < index_count; s++) {
      magnitude *= sectionMagnitude(out, indices[s], omega);
    }
    if (weighted) {
      magnitude *= aWeighting(omega * rate / kTwoPi) * a_weighting_unity;
    }
    total += magnitude * magnitude;
  }
  const double mean = total / static_cast<double>(points);
  return mean > 1.0e-30 ? std::sqrt(mean) : 1.0e-15;
}

void lowPassBiquad(double *out, int index, double frequency, double quality, double rate) noexcept {
  const int base = index * 5;
  const double omega = kTwoPi * frequency / rate;
  const double cosine = std::cos(omega);
  const double alpha = std::sin(omega) / (2.0 * quality);
  const double a0 = 1.0 + alpha;
  const double inverse = 1.0 / a0;
  const double one_minus_cos = 1.0 - cosine;
  out[base] = (one_minus_cos * 0.5) * inverse;
  out[base + 1] = one_minus_cos * inverse;
  out[base + 2] = out[base];
  out[base + 3] = (-2.0 * cosine) * inverse;
  out[base + 4] = (1.0 - alpha) * inverse;
}

void peakingBiquad(double *out, int index, double frequency, double quality, double gain_db,
                   double rate) noexcept {
  const int base = index * 5;
  const double amplitude = std::pow(10.0, gain_db / 40.0);
  const double omega = kTwoPi * frequency / rate;
  const double cosine = std::cos(omega);
  const double alpha = std::sin(omega) / (2.0 * quality);
  const double a0 = 1.0 + alpha / amplitude;
  const double inverse = 1.0 / a0;
  out[base] = (1.0 + alpha * amplitude) * inverse;
  out[base + 1] = (-2.0 * cosine) * inverse;
  out[base + 2] = (1.0 - alpha * amplitude) * inverse;
  out[base + 3] = (-2.0 * cosine) * inverse;
  out[base + 4] = (1.0 - alpha / amplitude) * inverse;
}

void flushDenormals(double *values, std::size_t count) noexcept {
  for (std::size_t i = 0u; i < count; i++) {
    values[i] = dsp::flush_denorm(values[i], kDenormalThreshold);
  }
}

} // namespace

class TapeArtifactsKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::TapeArtifactsPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    const std::size_t channels = static_cast<std::size_t>(max_channels_);
    section_state_.assign(static_cast<std::size_t>(kSectionCount) * channels, 0.0);
    biquad_state_.assign(static_cast<std::size_t>(kBiquadCount) * 2u * channels, 0.0);
    envelope_.assign(channels, 0.0);
    dc_input_.assign(channels, 0.0);
    dc_output_.assign(channels, 0.0);
    oversample_input_.assign(static_cast<std::size_t>(kOsHistory) * channels, 0.0);
    oversample_even_.assign(static_cast<std::size_t>(kOsHistory) * channels, 0.0);
    oversample_odd_.assign(static_cast<std::size_t>(kOsHistory) * channels, 0.0);
    delay_buffers_.assign(static_cast<std::size_t>(kDelayLength) * channels, 0.0F);
    dry_buffers_.assign(static_cast<std::size_t>(kDelayLength) * channels, 0.0F);
    automation_ramp_frames_ =
        std::max(1u, static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005)));
  }

  void reset() noexcept override {
    clearState();
    configured_ = false;
    last_channel_count_ = 0u;
    random_.seed(selected_seed_low_, selected_seed_high_);
    automation_initialized_ = false;
    mix_ramp_remaining_ = 0u;
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    random_.seed(seed_low, seed_high);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u) {
      return;
    }

    // mx = 0 must be a bit-for-bit dry path, and the JavaScript takes that exit
    // before any state - the seed included - is drawn.
    const double target_mix = static_cast<double>(params_.mix) * 0.01;
    if (!(target_mix > 0.0) && (!automation_initialized_ || (mix_ == 0.0 && mix_target_ == 0.0))) {
      return;
    }

    if (!configured_ || last_channel_count_ != channel_count) {
      createState(channel_count);
    }

    const int channels = static_cast<int>(channel_count);
    int speed_index = static_cast<int>(params_.speed);
    if (speed_index < 0 || speed_index > 2) {
      speed_index = 1;
    }
    const int tape_index = static_cast<int>(params_.tape) == 1 ? 1 : 0;
    const double bias_db = static_cast<double>(params_.bias);
    const double hiss_db = static_cast<double>(params_.hiss);
    if (!has_configuration_ || configuration_speed_ != speed_index ||
        configuration_tape_ != tape_index || configuration_bias_ != bias_db ||
        configuration_hiss_ != hiss_db) {
      updateConfiguration(speed_index, tape_index, bias_db, hiss_db);
      has_configuration_ = true;
      configuration_speed_ = speed_index;
      configuration_tape_ = tape_index;
      configuration_bias_ = bias_db;
      configuration_hiss_ = hiss_db;
    }

    const double *section_b0 = coefficients_.b0;
    const double *section_b1 = coefficients_.b1;
    const double *section_a1 = coefficients_.a1;
    double *section_state = section_state_.data();
    const double *biquad_coefficients = biquad_coefficients_;
    double *biquad_state = biquad_state_.data();
    double *envelope = envelope_.data();
    double *dc_input = dc_input_.data();
    double *dc_output = dc_output_.data();
    float *delay_buffers = delay_buffers_.data();
    float *dry_buffers = dry_buffers_.data();
    double *oversample_input = oversample_input_.data();
    double *oversample_even = oversample_even_.data();
    double *oversample_odd = oversample_odd_.data();

    const double target_input_trim_gain = std::pow(
        10.0, (kSaturationReferenceDbfs + static_cast<double>(params_.recordLevel)) / 20.0);
    const double target_output_gain = std::pow(10.0, static_cast<double>(params_.output) / 20.0);
    const double target_flutter_scale =
        static_cast<double>(params_.wowFlutter) / kWowFlutterReferencePercent;
    if (!automation_initialized_) {
      input_trim_gain_ = target_input_trim_gain;
      output_gain_ = target_output_gain;
      flutter_scale_ = target_flutter_scale;
      mix_ = target_mix;
      input_trim_gain_target_ = target_input_trim_gain;
      output_gain_target_ = target_output_gain;
      flutter_scale_target_ = target_flutter_scale;
      mix_target_ = target_mix;
      mix_ramp_remaining_ = 0u;
      automation_initialized_ = true;
    } else if (target_input_trim_gain != input_trim_gain_target_ ||
               target_output_gain != output_gain_target_ ||
               target_flutter_scale != flutter_scale_target_ || target_mix != mix_target_) {
      input_trim_gain_target_ = target_input_trim_gain;
      output_gain_target_ = target_output_gain;
      flutter_scale_target_ = target_flutter_scale;
      mix_target_ = target_mix;
      mix_ramp_remaining_ = automation_ramp_frames_;
    }
    double input_trim_gain = input_trim_gain_;
    double output_gain = output_gain_;
    double flutter_scale = flutter_scale_;
    double mix_ratio = mix_;
    std::uint32_t mix_ramp_remaining = mix_ramp_remaining_;
    const double saturation_base = saturation_base_;
    const double memory_scale = memory_scale_;
    const double attack_coefficient = attack_coefficient_;
    const double release_coefficient = release_coefficient_;
    const double dc_coefficient = dc_coefficient_;
    const double negative_ceiling_scale = 1.0 + kSaturationAsymmetry;
    const double modulation_gain = modulation_gain_;
    const bool noise_active = hiss_gain_ > 0.0 || modulation_gain > 0.0;
    const double wow_increment = wow_increment_;
    const double flutter_coefficient = flutter_coefficient_;
    const double flutter_normalisation = flutter_normalisation_;
    const double base_delay_samples = base_delay_samples_;
    const double maximum_deviation = base_delay_samples > 8.0 ? base_delay_samples - 4.0 : 1.0;
    const std::int32_t dry_delay_samples =
        (static_cast<std::int32_t>(base_delay_samples) + kOsLatency) & kDelayMask;

    std::int32_t delay_position = delay_position_;
    std::int32_t oversample_position = oversample_position_;
    double wow_phase = wow_phase_;
    double flutter_a = flutter_a_;
    double flutter_b = flutter_b_;
    std::int32_t rng_state = rng_state_;

    for (std::uint32_t i = 0u; i < frame_count; i++) {
      if (mix_ramp_remaining != 0u) {
        const double ramp_scale = 1.0 / static_cast<double>(mix_ramp_remaining);
        input_trim_gain += (target_input_trim_gain - input_trim_gain) * ramp_scale;
        output_gain += (target_output_gain - output_gain) * ramp_scale;
        flutter_scale += (target_flutter_scale - flutter_scale) * ramp_scale;
        mix_ratio += (target_mix - mix_ratio) * ramp_scale;
        if (--mix_ramp_remaining == 0u) {
          input_trim_gain = target_input_trim_gain;
          output_gain = target_output_gain;
          flutter_scale = target_flutter_scale;
          mix_ratio = target_mix;
        }
      }
      const double makeup_gain = 1.0 / input_trim_gain;
      const double hiss_gain = hiss_gain_ * makeup_gain;
      const double wow_samples = wow_samples_ * flutter_scale;
      const double flutter_samples = flutter_samples_ * flutter_scale;
      // The transport trajectory is shared by every channel; only the delay
      // line state is per channel.
      wow_phase += wow_increment;
      if (wow_phase >= kTwoPi) {
        wow_phase -= kTwoPi;
      }
      rng_state = nextRandom(rng_state);
      const double flutter_draw =
          static_cast<double>(static_cast<std::uint32_t>(rng_state)) * kRngScale - 1.0;
      flutter_a += flutter_coefficient * (flutter_draw - flutter_a);
      flutter_b += flutter_coefficient * (flutter_a - flutter_b);
      double deviation =
          std::sin(wow_phase) * wow_samples + flutter_b * flutter_normalisation * flutter_samples;
      if (deviation > maximum_deviation) {
        deviation = maximum_deviation;
      } else if (deviation < -maximum_deviation) {
        deviation = -maximum_deviation;
      }
      const double read_position =
          static_cast<double>(delay_position) - base_delay_samples - deviation;
      const double read_floor = std::floor(read_position);
      const double fraction = read_position - read_floor;
      const std::int32_t read_floor_index = static_cast<std::int32_t>(read_floor);
      const std::int32_t index1 = read_floor_index & kDelayMask;
      const std::int32_t index0 = (read_floor_index - 1) & kDelayMask;
      const std::int32_t index2 = (read_floor_index + 1) & kDelayMask;
      const std::int32_t index3 = (read_floor_index + 2) & kDelayMask;

      for (int ch = 0; ch < channels; ch++) {
        const std::size_t offset = static_cast<std::size_t>(ch) * frame_count;
        // Sanitise before the sample can reach any state: NaN fails both
        // comparisons, each infinity fails one, and every finite value passes
        // through bit for bit.
        const double raw = static_cast<double>(audio[offset + i]);
        const double input = raw > -std::numeric_limits<double>::infinity() &&
                                     raw < std::numeric_limits<double>::infinity()
                                 ? raw
                                 : 0.0;
        float *dry_line = dry_buffers + static_cast<std::size_t>(ch) * kDelayLength;
        dry_line[delay_position] = static_cast<float>(input);
        const double dry =
            static_cast<double>(dry_line[(delay_position - dry_delay_samples) & kDelayMask]);
        double x = input * input_trim_gain;

        // Record chain.
        std::size_t index = static_cast<std::size_t>(kSectionRecordEq) * channels + ch;
        double y = section_b0[kSectionRecordEq] * x + section_state[index];
        section_state[index] = section_b1[kSectionRecordEq] * x - section_a1[kSectionRecordEq] * y;
        x = y;

        int base = kBiquadRecordAmp * 5;
        std::size_t state_base = (static_cast<std::size_t>(kBiquadRecordAmp) * channels + ch) * 2u;
        y = biquad_coefficients[base] * x + biquad_state[state_base];
        biquad_state[state_base] = biquad_coefficients[base + 1] * x -
                                   biquad_coefficients[base + 3] * y + biquad_state[state_base + 1];
        biquad_state[state_base + 1] =
            biquad_coefficients[base + 2] * x - biquad_coefficients[base + 4] * y;
        x = y;

        // --- 2x oversampled tape saturation --------------------------------
        const std::size_t os_base = static_cast<std::size_t>(ch) * kOsHistory;
        oversample_input[os_base + oversample_position] = x;
        const double g0 = x;
        const double g1 = oversample_input[os_base + ((oversample_position - 1) & kOsMask)];
        const double g2 = oversample_input[os_base + ((oversample_position - 2) & kOsMask)];
        const double g3 = oversample_input[os_base + ((oversample_position - 3) & kOsMask)];
        const double g4 = oversample_input[os_base + ((oversample_position - 4) & kOsMask)];
        const double g5 = oversample_input[os_base + ((oversample_position - 5) & kOsMask)];
        const double g6 = oversample_input[os_base + ((oversample_position - 6) & kOsMask)];
        const double g7 = oversample_input[os_base + ((oversample_position - 7) & kOsMask)];
        const double g8 = oversample_input[os_base + ((oversample_position - 8) & kOsMask)];
        const double g9 = oversample_input[os_base + ((oversample_position - 9) & kOsMask)];
        const double g10 = oversample_input[os_base + ((oversample_position - 10) & kOsMask)];
        const double g11 = oversample_input[os_base + ((oversample_position - 11) & kOsMask)];
        const double upper_even =
            2.0 * (kOsH11 * (g0 + g11) + kOsH9 * (g1 + g10) + kOsH7 * (g2 + g9) +
                   kOsH5 * (g3 + g8) + kOsH3 * (g4 + g7) + kOsH1 * (g5 + g6));
        const double upper_odd = g5;

        double level = envelope[ch];
        double magnitude = upper_even < 0.0 ? -upper_even : upper_even;
        level +=
            (magnitude > level ? attack_coefficient : release_coefficient) * (magnitude - level);
        double memory = level * memory_scale;
        if (memory > 1.0) {
          memory = 1.0;
        }
        double ceiling = saturation_base / (1.0 + memory);
        if (upper_even < 0.0) {
          ceiling *= negative_ceiling_scale;
        }
        double t = upper_even / ceiling;
        const double saturated_even = upper_even / std::sqrt(1.0 + t * t);

        magnitude = upper_odd < 0.0 ? -upper_odd : upper_odd;
        level +=
            (magnitude > level ? attack_coefficient : release_coefficient) * (magnitude - level);
        envelope[ch] = level;
        memory = level * memory_scale;
        if (memory > 1.0) {
          memory = 1.0;
        }
        ceiling = saturation_base / (1.0 + memory);
        if (upper_odd < 0.0) {
          ceiling *= negative_ceiling_scale;
        }
        t = upper_odd / ceiling;
        const double saturated_odd = upper_odd / std::sqrt(1.0 + t * t);

        // Decimate.
        oversample_even[os_base + oversample_position] = saturated_even;
        oversample_odd[os_base + oversample_position] = saturated_odd;
        const double e1 = oversample_even[os_base + ((oversample_position - 1) & kOsMask)];
        const double e2 = oversample_even[os_base + ((oversample_position - 2) & kOsMask)];
        const double e3 = oversample_even[os_base + ((oversample_position - 3) & kOsMask)];
        const double e4 = oversample_even[os_base + ((oversample_position - 4) & kOsMask)];
        const double e5 = oversample_even[os_base + ((oversample_position - 5) & kOsMask)];
        const double e6 = oversample_even[os_base + ((oversample_position - 6) & kOsMask)];
        const double e7 = oversample_even[os_base + ((oversample_position - 7) & kOsMask)];
        const double e8 = oversample_even[os_base + ((oversample_position - 8) & kOsMask)];
        const double e9 = oversample_even[os_base + ((oversample_position - 9) & kOsMask)];
        const double e10 = oversample_even[os_base + ((oversample_position - 10) & kOsMask)];
        const double e11 = oversample_even[os_base + ((oversample_position - 11) & kOsMask)];
        x = 0.5 * oversample_odd[os_base + ((oversample_position - 6) & kOsMask)] +
            kOsH11 * (saturated_even + e11) + kOsH9 * (e1 + e10) + kOsH7 * (e2 + e9) +
            kOsH5 * (e3 + e8) + kOsH3 * (e4 + e7) + kOsH1 * (e5 + e6);

        x *= makeup_gain;

        index = static_cast<std::size_t>(kSectionBias) * channels + ch;
        y = section_b0[kSectionBias] * x + section_state[index];
        section_state[index] = section_b1[kSectionBias] * x - section_a1[kSectionBias] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionBiasShelf) * channels + ch;
        y = section_b0[kSectionBiasShelf] * x + section_state[index];
        section_state[index] =
            section_b1[kSectionBiasShelf] * x - section_a1[kSectionBiasShelf] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionLossA) * channels + ch;
        y = section_b0[kSectionLossA] * x + section_state[index];
        section_state[index] = section_b1[kSectionLossA] * x - section_a1[kSectionLossA] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionLossB) * channels + ch;
        y = section_b0[kSectionLossB] * x + section_state[index];
        section_state[index] = section_b1[kSectionLossB] * x - section_a1[kSectionLossB] * y;
        x = y;

        // Transport modulation.
        float *line = delay_buffers + static_cast<std::size_t>(ch) * kDelayLength;
        line[delay_position] = static_cast<float>(x);
        const double y0 = static_cast<double>(line[index0]);
        const double y1 = static_cast<double>(line[index1]);
        const double y2 = static_cast<double>(line[index2]);
        const double y3 = static_cast<double>(line[index3]);
        const double c1 = 0.5 * (y2 - y0);
        const double c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        const double c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        x = ((c3 * fraction + c2) * fraction + c1) * fraction + y1;

        base = kBiquadHeadBump * 5;
        state_base = (static_cast<std::size_t>(kBiquadHeadBump) * channels + ch) * 2u;
        y = biquad_coefficients[base] * x + biquad_state[state_base];
        biquad_state[state_base] = biquad_coefficients[base + 1] * x -
                                   biquad_coefficients[base + 3] * y + biquad_state[state_base + 1];
        biquad_state[state_base + 1] =
            biquad_coefficients[base + 2] * x - biquad_coefficients[base + 4] * y;
        x = y;

        index = static_cast<std::size_t>(kSectionReproduceEq) * channels + ch;
        y = section_b0[kSectionReproduceEq] * x + section_state[index];
        section_state[index] =
            section_b1[kSectionReproduceEq] * x - section_a1[kSectionReproduceEq] * y;
        x = y;

        // DC block.
        const double blocked = x - dc_input[ch] + dc_coefficient * dc_output[ch];
        dc_input[ch] = x;
        dc_output[ch] = blocked;
        x = blocked;

        if (noise_active) {
          rng_state = nextRandom(rng_state);
          const double hiss_draw =
              static_cast<double>(static_cast<std::uint32_t>(rng_state)) * kRngScale - 1.0;
          index = static_cast<std::size_t>(kSectionHissHp) * channels + ch;
          y = section_b0[kSectionHissHp] * hiss_draw + section_state[index];
          section_state[index] =
              section_b1[kSectionHissHp] * hiss_draw - section_a1[kSectionHissHp] * y;
          double hiss = y;
          index = static_cast<std::size_t>(kSectionHissLp) * channels + ch;
          y = section_b0[kSectionHissLp] * hiss + section_state[index];
          section_state[index] = section_b1[kSectionHissLp] * hiss - section_a1[kSectionHissLp] * y;
          hiss = y * hiss_gain;

          rng_state = nextRandom(rng_state);
          const double modulation_draw =
              static_cast<double>(static_cast<std::uint32_t>(rng_state)) * kRngScale - 1.0;
          index = static_cast<std::size_t>(kSectionModulation) * channels + ch;
          y = section_b0[kSectionModulation] * modulation_draw + section_state[index];
          section_state[index] =
              section_b1[kSectionModulation] * modulation_draw - section_a1[kSectionModulation] * y;
          double modulation = y * modulation_gain;
          if (modulation > 0.5) {
            modulation = 0.5;
          } else if (modulation < -0.5) {
            modulation = -0.5;
          }
          x = (x + hiss) * (1.0 + modulation);
        }

        x *= output_gain;
        if (!(x > -16.0 && x < 16.0)) {
          x = x > 0.0 ? 16.0 : (x < 0.0 ? -16.0 : 0.0);
        }
        audio[offset + i] = static_cast<float>(dry + mix_ratio * (x - dry));
      }

      delay_position = (delay_position + 1) & kDelayMask;
      oversample_position = (oversample_position + 1) & kOsMask;
    }

    const std::size_t channel_span = static_cast<std::size_t>(channels);
    flushDenormals(section_state, static_cast<std::size_t>(kSectionCount) * channel_span);
    flushDenormals(biquad_state, static_cast<std::size_t>(kBiquadCount) * 2u * channel_span);
    flushDenormals(dc_input, channel_span);
    flushDenormals(dc_output, channel_span);
    flushDenormals(envelope, channel_span);
    flushDenormals(oversample_input, static_cast<std::size_t>(kOsHistory) * channel_span);
    flushDenormals(oversample_even, static_cast<std::size_t>(kOsHistory) * channel_span);
    flushDenormals(oversample_odd, static_cast<std::size_t>(kOsHistory) * channel_span);

    delay_position_ = delay_position;
    oversample_position_ = oversample_position;
    wow_phase_ = wow_phase;
    flutter_a_ = flutter_a;
    flutter_b_ = flutter_b;
    rng_state_ = rng_state;
    input_trim_gain_ = input_trim_gain;
    output_gain_ = output_gain;
    flutter_scale_ = flutter_scale;
    mix_ = mix_ratio;
    mix_ramp_remaining_ = mix_ramp_remaining;
  }

private:
  // 32 bit xorshift, written so that the JavaScript `| 0` wraparound and the
  // logical `>>> 17` are reproduced exactly.
  static std::int32_t nextRandom(std::int32_t state) noexcept {
    std::uint32_t value = static_cast<std::uint32_t>(state);
    value ^= value << 13U;
    value ^= value >> 17U;
    value ^= value << 5U;
    return static_cast<std::int32_t>(value);
  }

  void clearState() noexcept {
    for (double &value : section_state_) {
      value = 0.0;
    }
    for (double &value : biquad_state_) {
      value = 0.0;
    }
    for (double &value : envelope_) {
      value = 0.0;
    }
    for (double &value : dc_input_) {
      value = 0.0;
    }
    for (double &value : dc_output_) {
      value = 0.0;
    }
    for (double &value : oversample_input_) {
      value = 0.0;
    }
    for (double &value : oversample_even_) {
      value = 0.0;
    }
    for (double &value : oversample_odd_) {
      value = 0.0;
    }
    for (float &value : delay_buffers_) {
      value = 0.0F;
    }
    for (float &value : dry_buffers_) {
      value = 0.0F;
    }
    coefficients_ = {};
    for (double &value : biquad_coefficients_) {
      value = 0.0;
    }
    delay_position_ = 0;
    oversample_position_ = 0;
    wow_phase_ = 0.0;
    flutter_a_ = 0.0;
    flutter_b_ = 0.0;
    rng_state_ = 0;
    hiss_gain_ = 0.0;
    modulation_gain_ = 0.0;
    saturation_base_ = 1.0;
    memory_scale_ = 0.0;
    attack_coefficient_ = 0.0;
    release_coefficient_ = 0.0;
    dc_coefficient_ = 0.0;
    wow_increment_ = 0.0;
    wow_samples_ = 0.0;
    flutter_samples_ = 0.0;
    flutter_coefficient_ = 0.0;
    flutter_normalisation_ = 0.0;
    base_delay_samples_ = 0.0;
    has_configuration_ = false;
  }

  // Mirrors the JavaScript state block, which is rebuilt whenever the host rate
  // or the channel count changes and draws one seed from the seeded source as
  // it is built.
  void createState(std::uint32_t channel_count) noexcept {
    clearState();
    const double draw = random_.nextFloat01();
    std::int32_t seed =
        static_cast<std::int32_t>(static_cast<std::uint32_t>(std::floor(draw * 4294967296.0)));
    if (seed == 0) {
      seed = kSeedFallback;
    }
    rng_state_ = seed;
    configured_ = true;
    last_channel_count_ = channel_count;
  }

  void updateConfiguration(int speed_index, int tape_index, double bias_db,
                           double hiss_db) noexcept {
    const SpeedEntry &speed_entry = kSpeeds[speed_index];
    const TapeEntry &tape_entry = kTapes[tape_index];
    SectionCoefficients &coefficients = coefficients_;
    const double two_fs = 2.0 * sample_rate_;
    const double velocity = speed_entry.v;
    const double bias = std::pow(10.0, bias_db / 20.0);

    // Record pre-emphasis, normalised to 0 dB at 1 kHz.
    const double record_pre_tau_zero = 1.0 / (kTwoPi * kRecordPreCornerHz);
    firstOrder(record_pre_tau_zero, record_pre_tau_zero / kRecordPreGain, two_fs, coefficients,
               kSectionRecordEq);
    const double reference_omega = kTwoPi * kEqReferenceHz / sample_rate_;
    const double reference_magnitude =
        sectionMagnitude(coefficients, kSectionRecordEq, reference_omega);
    scaleSection(coefficients, kSectionRecordEq,
                 reference_magnitude > 1.0e-30 ? 1.0 / reference_magnitude : 1.0);
    invertSection(coefficients, kSectionRecordEq, kSectionReproduceEq);

    // Playback wavelength loss, each already multiplied by its bounded trim.
    const double thickness_hz = kThicknessThreeDb * velocity / (kTwoPi * tape_entry.coating);
    const double gap_hz = kGapThreeDb * velocity / (kPi * kPlayGapMeters);
    const double spacing_hz = kSpacingThreeDb * velocity / (kTwoPi * kSpacingMeters);
    const double short_hz =
        1.0 / std::sqrt(1.0 / (gap_hz * gap_hz) + 1.0 / (spacing_hz * spacing_hz));
    firstOrder(0.0, 1.0 / (kTwoPi * thickness_hz * kTrimMaxGain), two_fs, coefficients,
               kSectionLossA);
    firstOrder(0.0, 1.0 / (kTwoPi * short_hz * kTrimMaxGain), two_fs, coefficients, kSectionLossB);

    // Bias erasure.
    const double bias_hz =
        kBiasCornerHz * (velocity / kNoiseSpeedReference) / std::pow(bias, kBiasCornerExponent);
    firstOrder(0.0, 1.0 / (kTwoPi * bias_hz), two_fs, coefficients, kSectionBias);

    // Short-wavelength sensitivity shelf, solved so that the drop from the
    // sensitivity peak to bs = 0 is the published dS10.
    const double delta_s10_db = tape_entry.deltaS10Db[speed_index];
    const double shelf_omega = kTwoPi * kBiasShelfHz * (velocity / kNoiseSpeedReference);
    const double probe_hz = kBiasProbeHz < sample_rate_ * 0.45 ? kBiasProbeHz : sample_rate_ * 0.45;
    const double probe_omega = kTwoPi * probe_hz / sample_rate_;
    const double peak_bs = -std::sqrt(delta_s10_db / kBiasPeakCurvature);
    const double erasure_tau = 1.0 / (kTwoPi * kBiasCornerHz * (velocity / kNoiseSpeedReference));
    firstOrder(0.0, erasure_tau * std::pow(std::pow(10.0, peak_bs / 20.0), kBiasCornerExponent),
               two_fs, coefficients, kSectionBiasShelf);
    const double peak_erasure = sectionMagnitude(coefficients, kSectionBiasShelf, probe_omega);
    firstOrder(0.0, erasure_tau, two_fs, coefficients, kSectionBiasShelf);
    const double shelf_target = std::pow(10.0, delta_s10_db / 20.0) *
                                sectionMagnitude(coefficients, kSectionBiasShelf, probe_omega) /
                                peak_erasure;
    double shelf_low = 1.0;
    double shelf_high = 1.0e6;
    for (int i = 0; i < 30; i++) {
      const double trial = std::sqrt(shelf_low * shelf_high);
      const double trial_root = std::sqrt(trial);
      firstOrder(trial_root / shelf_omega, 1.0 / (trial_root * shelf_omega), two_fs, coefficients,
                 kSectionBiasShelf);
      if (sectionMagnitude(coefficients, kSectionBiasShelf, probe_omega) < shelf_target) {
        shelf_low = trial;
      } else {
        shelf_high = trial;
      }
    }
    const double peak_radius = std::sqrt(peak_bs * peak_bs + kBiasPeakWidthDb * kBiasPeakWidthDb);
    const double shelf_slope =
        20.0 * std::log10(std::sqrt(shelf_low * shelf_high)) / (peak_radius - kBiasPeakWidthDb);
    const double bias_offset = bias_db - peak_bs;
    double shelf_gain_db =
        shelf_slope *
        (peak_radius - std::sqrt(bias_offset * bias_offset + kBiasPeakWidthDb * kBiasPeakWidthDb));
    if (shelf_gain_db > kBiasShelfLimitDb) {
      shelf_gain_db = kBiasShelfLimitDb;
    }
    if (shelf_gain_db < -kBiasShelfLimitDb) {
      shelf_gain_db = -kBiasShelfLimitDb;
    }
    const double bias_shelf_gain = std::pow(10.0, shelf_gain_db / 20.0);
    if (bias_shelf_gain == 1.0) {
      coefficients.b0[kSectionBiasShelf] = 1.0;
      coefficients.b1[kSectionBiasShelf] = 0.0;
      coefficients.a1[kSectionBiasShelf] = 0.0;
    } else {
      const double shelf_root = std::sqrt(bias_shelf_gain);
      firstOrder(shelf_root / shelf_omega, 1.0 / (shelf_root * shelf_omega), two_fs, coefficients,
                 kSectionBiasShelf);
    }

    // Noise shaping.
    const double hiss_high_tau = 1.0 / (kTwoPi * kHissHighPassHz);
    firstOrder(hiss_high_tau, hiss_high_tau, two_fs, coefficients, kSectionHissHp);
    coefficients.b0[kSectionHissHp] = (1.0 - coefficients.a1[kSectionHissHp]) * 0.5;
    coefficients.b1[kSectionHissHp] = -coefficients.b0[kSectionHissHp];
    const double hiss_low_hz =
        kHissLowPassHz < sample_rate_ * 0.45 ? kHissLowPassHz : sample_rate_ * 0.45;
    firstOrder(0.0, 1.0 / (kTwoPi * hiss_low_hz), two_fs, coefficients, kSectionHissLp);
    const double modulation_hz = velocity / (kTwoPi * kModulationLengthMeters);
    firstOrder(0.0, 1.0 / (kTwoPi * modulation_hz), two_fs, coefficients, kSectionModulation);

    // Band limits.
    const double record_hz =
        kRecordBandwidthHz < sample_rate_ * 0.45 ? kRecordBandwidthHz : sample_rate_ * 0.45;
    lowPassBiquad(biquad_coefficients_, kBiquadRecordAmp, record_hz, 0.7071067811865476,
                  sample_rate_);
    const double bump_hz = velocity / kContactLengthMeters;
    peakingBiquad(biquad_coefficients_, kBiquadHeadBump, bump_hz, kHeadBumpQ, speed_entry.bumpDb,
                  sample_rate_);

    // Saturation operating point.
    const double saturation_reference_peak = std::pow(10.0, kSaturationReferenceDbfs / 20.0);
    saturation_base_ = (saturation_reference_peak / kSaturationReferenceT) *
                       std::pow(10.0, tape_entry.headroomDb / 20.0) * std::pow(bias, 0.7);
    memory_scale_ = kMemoryDepth / saturation_base_;
    attack_coefficient_ = 1.0 - std::exp(-1.0 / (kMemoryAttackSeconds * sample_rate_ * 2.0));
    release_coefficient_ = 1.0 - std::exp(-1.0 / (kMemoryReleaseSeconds * sample_rate_ * 2.0));
    dc_coefficient_ = std::exp(-kTwoPi * kDcBlockHz / sample_rate_);

    // Noise levels.
    const double operating_level_rms_dbfs =
        kSaturationReferenceDbfs - 20.0 * std::log10(std::sqrt(2.0));
    const bool hiss_enabled = hiss_db > kHissOffDb;
    const double noise_user_gain =
        hiss_enabled ? std::pow(10.0, (hiss_db - kHissReferenceDb) / 20.0) : 0.0;
    const double hiss_rms =
        std::pow(10.0, (tape_entry.bniecDb[speed_index] + operating_level_rms_dbfs) / 20.0) *
        noise_user_gain;
    const double modulation_depth =
        std::pow(10.0, tape_entry.dcnDb[speed_index] / 20.0) * noise_user_gain;
    const double uniform_rms = 0.5773502691896258;
    const int hiss_indices[2] = {kSectionHissHp, kSectionHissLp};
    const int modulation_indices[1] = {kSectionModulation};
    const double hiss_shape_gain = cascadeNoiseGain(coefficients, hiss_indices, 2,
                                                    kNoiseIntegrationPoints, sample_rate_, true);
    const double modulation_shape_gain = cascadeNoiseGain(
        coefficients, modulation_indices, 1, kNoiseIntegrationPoints, sample_rate_, false);
    hiss_gain_ = hiss_rms / (uniform_rms * hiss_shape_gain);
    modulation_gain_ = modulation_depth / (uniform_rms * modulation_shape_gain);

    // Transport.
    const double speed_ratio = velocity / kNoiseSpeedReference;
    wow_increment_ = kTwoPi * kWowRateHz * speed_ratio / sample_rate_;
    flutter_coefficient_ = 1.0 - std::exp(-kTwoPi * kFlutterCornerHz * speed_ratio / sample_rate_);
    const double pole = 1.0 - flutter_coefficient_;
    const double pole_sq = pole * pole;
    const double flutter_variance =
        std::pow(flutter_coefficient_, 4.0) * (1.0 + pole_sq) / std::pow(1.0 - pole_sq, 3.0);
    flutter_normalisation_ =
        1.0 / (uniform_rms * std::sqrt(flutter_variance > 1.0e-30 ? flutter_variance : 1.0e-30));
    const double transport_depth =
        std::pow(kNoiseSpeedReference / velocity, kTransportDepthExponent);
    wow_samples_ = kWowSeconds * sample_rate_ * transport_depth;
    flutter_samples_ = kFlutterSeconds * sample_rate_ * transport_depth;
    // Math.round rounds halves towards positive infinity.
    base_delay_samples_ = std::floor(kTransportBaseSeconds * sample_rate_ + 0.5);
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool configured_ = false;
  bool has_configuration_ = false;
  int configuration_speed_ = -1;
  int configuration_tape_ = -1;
  double configuration_bias_ = 0.0;
  double configuration_hiss_ = 0.0;
  SectionCoefficients coefficients_{};
  double biquad_coefficients_[kBiquadCount * 5]{};
  std::vector<double> section_state_;
  std::vector<double> biquad_state_;
  std::vector<double> envelope_;
  std::vector<double> dc_input_;
  std::vector<double> dc_output_;
  std::vector<double> oversample_input_;
  std::vector<double> oversample_even_;
  std::vector<double> oversample_odd_;
  std::vector<float> delay_buffers_;
  std::vector<float> dry_buffers_;
  std::int32_t delay_position_ = 0;
  std::int32_t oversample_position_ = 0;
  double wow_phase_ = 0.0;
  double flutter_a_ = 0.0;
  double flutter_b_ = 0.0;
  std::int32_t rng_state_ = 0;
  double hiss_gain_ = 0.0;
  double modulation_gain_ = 0.0;
  double saturation_base_ = 1.0;
  double memory_scale_ = 0.0;
  double attack_coefficient_ = 0.0;
  double release_coefficient_ = 0.0;
  double dc_coefficient_ = 0.0;
  double wow_increment_ = 0.0;
  double wow_samples_ = 0.0;
  double flutter_samples_ = 0.0;
  double flutter_coefficient_ = 0.0;
  double flutter_normalisation_ = 0.0;
  double base_delay_samples_ = 0.0;
  std::uint32_t automation_ramp_frames_ = 240u;
  std::uint32_t mix_ramp_remaining_ = 0u;
  double input_trim_gain_ = 1.0;
  double output_gain_ = 1.0;
  double flutter_scale_ = 1.0;
  double input_trim_gain_target_ = 1.0;
  double output_gain_target_ = 1.0;
  double flutter_scale_target_ = 1.0;
  double mix_ = 1.0;
  double mix_target_ = 1.0;
  bool automation_initialized_ = false;
  dsp::XorShiftRng random_{};
};

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(TapeArtifactsPlugin, effetune::plugins::lofi::TapeArtifactsKernel)
