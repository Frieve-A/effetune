#include "effetune/kernel.h"
#include "AMRadioSimulatorPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace effetune::plugins::lofi {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTwoPi = 6.28318530717958647692;
constexpr double kSqrtHalf = 0.70710678118654752440;
constexpr double kFloat32Scale = 4294967296.0;
constexpr std::uint32_t kControlInterval = 32u;
constexpr double kAgcTargetDb = -6.0;
constexpr double kMinimumAgcGainDb = -12.0;
constexpr double kMaximumAgcGainDb = 42.0;
constexpr double kDetectorDiodeToLoadResistanceRatio = 0.02;
constexpr double kSpeakerTransitionTime = 0.020;
constexpr double kMaximumDigitalTuningHz = 15000.0;
constexpr double kCquamPilotFrequency = 25.0;
constexpr double kCquamPilotAmplitude = 0.05;
constexpr double kCquamInternalPhaseLimit = 1.15;
constexpr double kCquamEpsilonRelative = 0.2;
constexpr double kCquamEpsilonAbsolute = 1.0e-6;
constexpr std::size_t kMaximumCquamMaskTaps = 256u;
constexpr double kMinimumIfCutoffHz = 1000.0;
constexpr std::uint32_t kStaticRandomSalt = 0xa511e9b3u;
constexpr std::uint32_t kStaticZeroFallback = 0xeffe7a5eu;
constexpr double kStaticCarrierAreaSeconds = 20.0e-6;
constexpr double kQualityProgramAllowanceRatio = 0.91727593538977958;
constexpr double kQualityExcessRatioOffset = 0.04;
constexpr double kQualityFullRatio = 0.94406087628592339;
constexpr double kQualityMonoRatio = 0.53088444423098835;
constexpr double kThermalNoiseCalibration = 0.9944467442996018;
constexpr std::uint16_t kTelemetryFrameType = 17u;
constexpr std::uint16_t kTelemetryVersion = 2u;
constexpr std::size_t kTelemetryPayloadBytes = 28u;
constexpr std::array<double, 2u> kButterworth4Q = {0.541196100146197, 1.306562964876377};
constexpr std::array<double, 3u> kButterworth6Q = {0.517638090205042, 0.707106781186548,
                                                   1.931851652578137};
constexpr std::array<double, 4u> kButterworth8Q = {0.509795579104159, 0.601344886935045,
                                                   0.899976223136416, 2.562915447741506};
constexpr std::array<double, 3u> kAgcAttackTimes = {0.150, 0.050, 0.015};
constexpr std::array<double, 3u> kAgcReleaseTimes = {3.0, 1.5, 0.750};

void writeU32(std::uint8_t *output, std::uint32_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>((value >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((value >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>((value >> 24u) & 0xffu);
}

void writeF32(std::uint8_t *output, float value) noexcept {
  std::uint32_t bits = 0u;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&bits, &value, sizeof(bits));
  writeU32(output, bits);
}

struct Biquad final {
  double b0 = 1.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
  double z1 = 0.0;
  double z2 = 0.0;

  void reset() noexcept {
    z1 = 0.0;
    z2 = 0.0;
  }

  void configureLowPass(double frequency, double q, double sample_rate) noexcept {
    const double limit = sample_rate * 0.45;
    const double bounded = frequency > limit ? limit : (frequency < 1.0 ? 1.0 : frequency);
    const double omega = kTwoPi * bounded / sample_rate;
    const double cosine = std::cos(omega);
    const double sine = std::sin(omega);
    const double alpha = sine / (2.0 * q);
    const double inverse_a0 = 1.0 / (1.0 + alpha);
    const double half = (1.0 - cosine) * 0.5;
    b0 = half * inverse_a0;
    b1 = (1.0 - cosine) * inverse_a0;
    b2 = b0;
    a1 = -2.0 * cosine * inverse_a0;
    a2 = (1.0 - alpha) * inverse_a0;
  }

  void configureHighPass(double frequency, double q, double sample_rate) noexcept {
    const double omega = kTwoPi * frequency / sample_rate;
    const double cosine = std::cos(omega);
    const double sine = std::sin(omega);
    const double alpha = sine / (2.0 * q);
    const double inverse_a0 = 1.0 / (1.0 + alpha);
    const double half = (1.0 + cosine) * 0.5;
    b0 = half * inverse_a0;
    b1 = -(1.0 + cosine) * inverse_a0;
    b2 = b0;
    a1 = -2.0 * cosine * inverse_a0;
    a2 = (1.0 - alpha) * inverse_a0;
  }

  void configureNotch(double frequency, double q, double sample_rate) noexcept {
    const double omega = kTwoPi * frequency / sample_rate;
    const double cosine = std::cos(omega);
    const double sine = std::sin(omega);
    const double alpha = sine / (2.0 * q);
    const double inverse_a0 = 1.0 / (1.0 + alpha);
    b0 = inverse_a0;
    b1 = -2.0 * cosine * inverse_a0;
    b2 = inverse_a0;
    a1 = b1;
    a2 = (1.0 - alpha) * inverse_a0;
  }

  void configureBandPass(double frequency, double q, double sample_rate) noexcept {
    const double omega = kTwoPi * frequency / sample_rate;
    const double cosine = std::cos(omega);
    const double sine = std::sin(omega);
    const double alpha = sine / (2.0 * q);
    const double inverse_a0 = 1.0 / (1.0 + alpha);
    b0 = alpha * inverse_a0;
    b1 = 0.0;
    b2 = -b0;
    a1 = -2.0 * cosine * inverse_a0;
    a2 = (1.0 - alpha) * inverse_a0;
  }

  void configurePeak(double frequency, double q, double gain_db, double sample_rate) noexcept {
    const double amplitude = std::pow(10.0, gain_db / 40.0);
    const double omega = kTwoPi * frequency / sample_rate;
    const double cosine = std::cos(omega);
    const double sine = std::sin(omega);
    const double alpha = sine / (2.0 * q);
    const double inverse_a0 = 1.0 / (1.0 + alpha / amplitude);
    b0 = (1.0 + alpha * amplitude) * inverse_a0;
    b1 = -2.0 * cosine * inverse_a0;
    b2 = (1.0 - alpha * amplitude) * inverse_a0;
    a1 = b1;
    a2 = (1.0 - alpha / amplitude) * inverse_a0;
  }

  [[nodiscard]] double process(double input) noexcept {
    const double output = b0 * input + z1;
    z1 = b1 * input - a1 * output + z2;
    z2 = b2 * input - a2 * output;
    return output;
  }
};

template <std::size_t Size>
double processBank(std::array<Biquad, Size> &bank, double input) noexcept {
  double output = input;
  for (Biquad &filter : bank) {
    output = filter.process(output);
  }
  return output;
}

template <std::size_t Size> void resetBank(std::array<Biquad, Size> &bank) noexcept {
  for (Biquad &filter : bank) {
    filter.reset();
  }
}

template <std::size_t Size>
void configureBank(std::array<Biquad, Size> &bank, double frequency,
                   const std::array<double, Size> &q_values, double sample_rate) noexcept {
  for (std::size_t index = 0u; index < Size; ++index) {
    bank[index].configureLowPass(frequency, q_values[index], sample_rate);
  }
}

template <std::size_t Size>
double bankNoiseNormalizer(const std::array<Biquad, Size> &bank) noexcept {
  std::array<Biquad, Size> probe = bank;
  resetBank(probe);
  double energy = 0.0;
  for (std::uint32_t index = 0u; index < 4096u; ++index) {
    const double output = processBank(probe, index == 0u ? 1.0 : 0.0);
    energy += output * output;
  }
  return energy > 1.0e-20 ? 1.0 / std::sqrt(energy) : 1.0;
}

template <std::size_t Size>
double bankResponsePower(const std::array<Biquad, Size> &bank, double omega) noexcept {
  const double cosine1 = std::cos(omega);
  const double sine1 = -std::sin(omega);
  const double cosine2 = std::cos(2.0 * omega);
  const double sine2 = -std::sin(2.0 * omega);
  double power = 1.0;
  for (const Biquad &filter : bank) {
    const double numerator_real = filter.b0 + filter.b1 * cosine1 + filter.b2 * cosine2;
    const double numerator_imaginary = filter.b1 * sine1 + filter.b2 * sine2;
    const double denominator_real = 1.0 + filter.a1 * cosine1 + filter.a2 * cosine2;
    const double denominator_imaginary = filter.a1 * sine1 + filter.a2 * sine2;
    power *= (numerator_real * numerator_real + numerator_imaginary * numerator_imaginary) /
             (denominator_real * denominator_real + denominator_imaginary * denominator_imaginary);
  }
  return power;
}

template <std::size_t Size>
double filterGroupDelayAtDc(const std::array<Biquad, Size> &bank) noexcept {
  constexpr double omega = 1.0e-6;
  double real = 1.0;
  double imaginary = 0.0;
  for (const Biquad &filter : bank) {
    const double cosine1 = std::cos(omega);
    const double sine1 = -std::sin(omega);
    const double cosine2 = std::cos(2.0 * omega);
    const double sine2 = -std::sin(2.0 * omega);
    const double numerator_real = filter.b0 + filter.b1 * cosine1 + filter.b2 * cosine2;
    const double numerator_imaginary = filter.b1 * sine1 + filter.b2 * sine2;
    const double denominator_real = 1.0 + filter.a1 * cosine1 + filter.a2 * cosine2;
    const double denominator_imaginary = filter.a1 * sine1 + filter.a2 * sine2;
    const double denominator_power =
        denominator_real * denominator_real + denominator_imaginary * denominator_imaginary;
    const double section_real =
        (numerator_real * denominator_real + numerator_imaginary * denominator_imaginary) /
        denominator_power;
    const double section_imaginary =
        (numerator_imaginary * denominator_real - numerator_real * denominator_imaginary) /
        denominator_power;
    const double next_real = real * section_real - imaginary * section_imaginary;
    imaginary = real * section_imaginary + imaginary * section_real;
    real = next_real;
  }
  return -std::atan2(imaginary, real) / omega;
}

double besselI0(double value) noexcept {
  const double half = value * 0.5;
  double term = 1.0;
  double sum = 1.0;
  for (std::uint32_t order = 1u; order < 32u; ++order) {
    term *= (half / static_cast<double>(order)) * (half / static_cast<double>(order));
    sum += term;
    if (term < sum * 1.0e-16) {
      break;
    }
  }
  return sum;
}

double sinc(double value) noexcept {
  if (value == 0.0) {
    return 1.0;
  }
  const double argument = kPi * value;
  return std::sin(argument) / argument;
}

struct FadeTap final {
  double i1 = 0.0;
  double i2 = 0.0;
  double q1 = 0.0;
  double q2 = 0.0;
  double i = 0.0;
  double q = 0.0;
  double stepI = 0.0;
  double stepQ = 0.0;
};

struct Controls final {
  double txBandwidth = 6.0;
  double preEmphasis = 50.0;
  double modDepth = 90.0;
  double compression = 6.0;
  double signal = -12.0;
  double skywave = 1.0;
  double fadingSpeed = 0.15;
  double staticRate = 0.3;
  double interference = -65.0;
  double interferenceOffset = 9.0;
  double tuning = 0.0;
  double ifBandwidth = 12.0;
  double detectorRc = 50.0;
  double hum = -70.0;
  double outputGain = 0.0;
  double mix = 100.0;
  double humFrequency = 50.0;
};

} // namespace

class AMRadioSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::AMRadioSimulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    initializeSampleRateCoefficients();
    const double required = std::ceil(sample_rate_ * 0.003) + 4.0;
    delay_.resize(required > 4.0 ? static_cast<std::size_t>(required) : 4u);
    delay_q_.resize(delay_.size());
    transition_delay_.resize(delay_.size());
    transition_delay_q_.resize(delay_.size());
    cquam_mask_coefficients_.resize(kMaximumCquamMaskTaps);
    cquam_mask_i_.resize(kMaximumCquamMaskTaps);
    cquam_mask_q_.resize(kMaximumCquamMaskTaps);
    cquam_mask_supported_ = requiredCquamMaskTaps() <= kMaximumCquamMaskTaps;
    cquam_mask_designed_ = false;
    cquam_mask_taps_ = 0u;
    cquam_pll_frequency_warmup_samples_ = cquamFrequencyWarmupSamples();
    const double qualify_samples = std::round(sample_rate_ * 0.100);
    cquam_pll_frequency_history_.resize(
        qualify_samples >= 1.0 ? static_cast<std::size_t>(qualify_samples) : 1u);
    deriveBaseRandomState();
    reset();
  }

  void reset() noexcept override { initialized_ = false; }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    deriveBaseRandomState();
    random_state_ = base_random_state_;
    resetStaticRandomState();
    gaussian_has_spare_ = false;
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override { return 0u; }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    const std::uint32_t pair_channels = channel_count >= 2u ? 2u : 1u;
    int speaker = static_cast<int>(params_.speaker + 0.5F);
    if (speaker < 0) {
      speaker = 0;
    } else if (speaker > 2) {
      speaker = 2;
    }
    if (!initialized_ || pair_channels != pair_channels_) {
      resetSimulation(pair_channels, speaker);
    } else if (stereo_mode_ == kCquamMode) {
      if (cquam_speaker_transition_remaining_ == 0u && speaker != cquam_speaker_) {
        startCquamSpeakerTransition(speaker);
      }
    } else if (speaker_transition_remaining_ == 0u && speaker != speaker_) {
      startSpeakerTransition(speaker);
    }

    double block_mod_peak = 0.0;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      if (control_remaining_ == 0u) {
        updateControl();
      }
      --control_remaining_;
      fade1_.i += fade1_.stepI;
      fade1_.q += fade1_.stepQ;
      fade2_.i += fade2_.stepI;
      fade2_.q += fade2_.stepQ;

      const std::size_t left_index = frame;
      const std::size_t right_index = pair_channels == 2u ? frame_count + frame : frame;
      const double input_left = static_cast<double>(audio[left_index]);
      const double input_right = static_cast<double>(audio[right_index]);
      const double mono = pair_channels == 2u ? (input_left + input_right) * 0.5 : input_left;
      const double difference = pair_channels == 2u ? (input_left - input_right) * 0.5 : 0.0;
      const bool need_mono_path = stereo_mode_ == kMonoMode || previous_stereo_mode_ == kMonoMode;
      const bool need_cquam_path =
          stereo_mode_ == kCquamMode || previous_stereo_mode_ == kCquamMode;

      const double high_passed = tx_high_pass_.process(mono);
      pre_emphasis_low_ =
          pre_emphasis_pole_ * pre_emphasis_low_ + (1.0 - pre_emphasis_pole_) * high_passed;
      const double emphasized =
          high_passed + pre_emphasis_shelf_gain_ * (high_passed - pre_emphasis_low_);
      double emphasized_difference = 0.0;
      if (need_cquam_path) {
        const double difference_high_passed = tx_difference_high_pass_.process(difference);
        difference_pre_emphasis_low_ = pre_emphasis_pole_ * difference_pre_emphasis_low_ +
                                       (1.0 - pre_emphasis_pole_) * difference_high_passed;
        emphasized_difference =
            difference_high_passed +
            pre_emphasis_shelf_gain_ * (difference_high_passed - difference_pre_emphasis_low_);
      }
      const double absolute_input = emphasized < 0.0 ? -emphasized : emphasized;
      const double envelope_coefficient = absolute_input > limiter_envelope_
                                              ? limiter_attack_coefficient_
                                              : limiter_release_coefficient_;
      limiter_envelope_ =
          absolute_input + envelope_coefficient * (limiter_envelope_ - absolute_input);
      double target_gain = 1.0;
      if (limiter_envelope_ > limiter_threshold_ && limiter_envelope_ > 1.0e-12) {
        const double ratio = limiter_threshold_ / limiter_envelope_;
        target_gain = 1.0 + limiter_depth_ * (ratio - 1.0);
      }
      const double gain_coefficient =
          target_gain < limiter_gain_ ? limiter_attack_coefficient_ : limiter_release_coefficient_;
      limiter_gain_ = target_gain + gain_coefficient * (limiter_gain_ - target_gain);
      const double compressed = emphasized * limiter_gain_;
      const double compressed_difference = emphasized_difference * limiter_gain_;

      double tx = 0.0;
      double tx_difference = 0.0;
      double transmitted_mono = 0.0;
      double transmitted_cquam_i = 0.0;
      double transmitted_cquam_q = 0.0;
      double transmitted_mono_i = 0.0;
      for (std::size_t phase = 0u; phase < 3u; ++phase) {
        const double interpolated = processBank(tx_interp_, phase == 0u ? compressed * 3.0 : 0.0);
        double difference_interpolated = 0.0;
        if (need_cquam_path) {
          difference_interpolated =
              processBank(tx_difference_interp_, phase == 0u ? compressed_difference * 3.0 : 0.0);
        }
        tx = processBank(tx_filters_, asymmetricLimit(interpolated));
        if (need_cquam_path) {
          tx_difference = processBank(tx_difference_filters_, difference_interpolated);
          const double pilot =
              kCquamPilotAmplitude *
              std::sin(kTwoPi * kCquamPilotFrequency *
                       static_cast<double>(cquam_oversampled_counter_) / (sample_rate_ * 3.0));
          const double in_phase = 1.0 + modulation_ * tx;
          const double quadrature_audio = modulation_ * tx_difference;
          double normalized_i = 0.0;
          double normalized_q = 0.0;
          if (in_phase <= 0.0) {
            normalized_i = in_phase;
          } else {
            const double limit = cquam_tan_internal_phase_limit_ * in_phase;
            double limited_pilot = pilot;
            if (limited_pilot < -limit) {
              limited_pilot = -limit;
            } else if (limited_pilot > limit) {
              limited_pilot = limit;
            }
            double limited_audio = quadrature_audio;
            const double audio_minimum = -limit - limited_pilot;
            const double audio_maximum = limit - limited_pilot;
            if (limited_audio < audio_minimum) {
              limited_audio = audio_minimum;
            } else if (limited_audio > audio_maximum) {
              limited_audio = audio_maximum;
            }
            const double quadrature = limited_audio + limited_pilot;
            double magnitude = std::sqrt(in_phase * in_phase + quadrature * quadrature);
            if (magnitude < kCquamEpsilonAbsolute) {
              magnitude = kCquamEpsilonAbsolute;
            }
            normalized_i = in_phase * in_phase / magnitude;
            normalized_q = in_phase * quadrature / magnitude;
          }
          processCquamMask(normalized_i, normalized_q, phase == 2u, transmitted_cquam_i,
                           transmitted_cquam_q);
          if (phase == 2u) {
            transmitted_mono_i = in_phase;
          }
          ++cquam_oversampled_counter_;
        }
        if (phase == 2u) {
          transmitted_mono = 1.0 + modulation_ * tx;
          if (!need_cquam_path) {
            transmitted_mono_i = transmitted_mono;
          }
        }
      }
      const double absolute_tx = tx < 0.0 ? -tx : tx;
      const double modulation_deviation = absolute_tx * modulation_ * 100.0;
      if (modulation_deviation > block_mod_peak) {
        block_mod_peak = modulation_deviation;
      }
      auto propagate = [&](int mode, std::vector<double> &path_delay,
                           std::vector<double> &path_delay_q, std::size_t &path_position,
                           double &station_i, double &station_q) noexcept {
        const double transmitted_i = mode == kCquamMode ? transmitted_cquam_i : transmitted_mono;
        const double transmitted_q = mode == kCquamMode ? transmitted_cquam_q : 0.0;
        path_delay[path_position] = transmitted_i;
        if (mode == kCquamMode) {
          path_delay_q[path_position] = transmitted_q;
        }
        const std::size_t position1 = path_position >= delay1_samples_
                                          ? path_position - delay1_samples_
                                          : path_delay.size() + path_position - delay1_samples_;
        const std::size_t position2 = path_position >= delay2_samples_
                                          ? path_position - delay2_samples_
                                          : path_delay.size() + path_position - delay2_samples_;
        const double delayed1 = path_delay[position1];
        const double delayed2 = path_delay[position2];
        const double delayed1_q = mode == kCquamMode ? path_delay_q[position1] : 0.0;
        const double delayed2_q = mode == kCquamMode ? path_delay_q[position2] : 0.0;
        ++path_position;
        if (path_position == path_delay.size()) {
          path_position = 0u;
        }
        if (mode == kCquamMode) {
          const double sky1_i = fade1_.i * delayed1 - fade1_.q * delayed1_q;
          const double sky1_q = fade1_.i * delayed1_q + fade1_.q * delayed1;
          const double sky2_i = fade2_.i * delayed2 - fade2_.q * delayed2_q;
          const double sky2_q = fade2_.i * delayed2_q + fade2_.q * delayed2;
          station_i = signal_gain_ * (ground_gain_ * transmitted_i + sky_gain_ * (sky1_i + sky2_i));
          station_q = signal_gain_ * (ground_gain_ * transmitted_q + sky_gain_ * (sky1_q + sky2_q));
        } else {
          station_i = signal_gain_ * (ground_gain_ * transmitted_i +
                                      sky_gain_ * (fade1_.i * delayed1 + fade2_.i * delayed2));
          station_q = signal_gain_ * sky_gain_ * (fade1_.q * delayed1 + fade2_.q * delayed2);
        }
      };

      double station_i = 0.0;
      double station_q = 0.0;
      const int main_path_mode =
          previous_stereo_mode_ != kNoPreviousMode ? previous_stereo_mode_ : stereo_mode_;
      propagate(main_path_mode, delay_, delay_q_, delay_position_, station_i, station_q);
      double transition_station_i = 0.0;
      double transition_station_q = 0.0;
      if (previous_stereo_mode_ != kNoPreviousMode) {
        propagate(stereo_mode_, transition_delay_, transition_delay_q_, transition_delay_position_,
                  transition_station_i, transition_station_q);
      }
      const double tuning_cosine = std::cos(tuning_phase_);
      const double tuning_sine = std::sin(tuning_phase_);
      advancePhase(tuning_phase_, station_tuning_phase_increment_);

      interferer_program_ =
          processBank(interferer_filters_, gaussian()) * interferer_program_normalizer_;
      const double interferer_envelope =
          interferer_tuning_gain_ * interferer_gain_ * (1.0 + 0.35 * interferer_program_);
      const double interferer_i = interferer_envelope * std::cos(interferer_phase_);
      const double interferer_q = interferer_envelope * std::sin(interferer_phase_);
      advancePhase(interferer_phase_, interferer_tuning_phase_increment_);

      const double thermal_i = gaussian() * thermal_noise_std_;
      const double thermal_q = gaussian() * thermal_noise_std_;
      const bool legacy_static_event = random01() < static_probability_;
      if (legacy_static_event) {
        static_cast<void>(random01());
        static_cast<void>(random01());
      }
      bool static_event = false;
      double static_i = 0.0;
      double static_q = 0.0;
      const double static_rate = static_cast<double>(params_.staticRate);
      const double static_sample_end_seconds =
          static_cast<double>(sample_counter_ + 1u) / sample_rate_;
      if (static_rate > 0.0) {
        if (!static_schedule_active_) {
          static_schedule_active_ = true;
          static_next_event_deadline_seconds_ =
              static_cast<double>(sample_counter_) / sample_rate_ +
              staticIntervalSeconds(static_rate);
        } else if (static_scheduled_rate_ != static_rate) {
          // Exponential inter-arrival times are memoryless, so a pending
          // deadline drawn at the previous rate stays statistically valid when
          // its remaining time is rescaled by the rate ratio. This keeps a
          // rate increase audible immediately without consuming extra RNG
          // draws (parity and determinism depend on the RNG stream).
          const double now_seconds = static_cast<double>(sample_counter_) / sample_rate_;
          const double remaining_seconds = static_next_event_deadline_seconds_ - now_seconds;
          if (remaining_seconds > 0.0) {
            static_next_event_deadline_seconds_ =
                now_seconds + remaining_seconds * (static_scheduled_rate_ / static_rate);
          }
        }
        static_scheduled_rate_ = static_rate;
        while (static_next_event_deadline_seconds_ <= static_sample_end_seconds) {
          static_event = true;
          const double next_interval_seconds = staticIntervalSeconds(static_rate);
          const double static_phase = kTwoPi * nextStaticRandom();
          const double static_area_seconds =
              kStaticCarrierAreaSeconds * signal_gain_ * (0.5 + nextStaticRandom());
          const double event_area = static_area_seconds * sample_rate_;
          static_i += event_area * std::cos(static_phase);
          static_q += event_area * std::sin(static_phase);
          ++static_count_;
          static_next_event_deadline_seconds_ += next_interval_seconds;
        }
      } else {
        static_schedule_active_ = false;
        static_next_event_deadline_seconds_ = -1.0;
        static_scheduled_rate_ = 0.0;
      }

      const double hum = std::sin(hum_phase_);
      hum_phase_ += hum_phase_increment_;
      if (hum_phase_ >= kTwoPi) {
        hum_phase_ -= kTwoPi;
      }
      auto receive = [&](double path_station_i, double path_station_q,
                         std::array<Biquad, 3u> &path_if_i, std::array<Biquad, 3u> &path_if_q,
                         double path_agc_linear_gain, double path_inverse_agc_linear_gain,
                         double &path_agc_stage1, double &path_agc_stage2,
                         double &path_last_if_envelope, double &if_output_i,
                         double &if_output_q) noexcept {
        double i =
            station_tuning_gain_ * (path_station_i * tuning_cosine - path_station_q * tuning_sine);
        double q =
            station_tuning_gain_ * (path_station_i * tuning_sine + path_station_q * tuning_cosine);
        i += interferer_i;
        q += interferer_q;
        i += thermal_i;
        q += thermal_q;
        if (static_event) {
          i += static_i;
          q += static_q;
        }
        const double radio_gain = path_agc_linear_gain * (1.0 + hum_amount_ * hum);
        if_output_i = processBank(path_if_i, i * radio_gain);
        if_output_q = processBank(path_if_q, q * radio_gain);
        const double pre_agc_magnitude =
            std::sqrt(if_output_i * if_output_i + if_output_q * if_output_q) *
            path_inverse_agc_linear_gain;
        path_agc_stage1 += agc_detector_attack_coefficient_ * (pre_agc_magnitude - path_agc_stage1);
        const double detector_stage2_coefficient = path_agc_stage1 > path_agc_stage2
                                                       ? agc_detector_attack_coefficient_
                                                       : agc_detector_release_coefficient_;
        path_agc_stage2 += detector_stage2_coefficient * (path_agc_stage1 - path_agc_stage2);
        path_last_if_envelope = std::sqrt(if_output_i * if_output_i + if_output_q * if_output_q);
      };

      double main_if_output_i = 0.0;
      double main_if_output_q = 0.0;
      receive(station_i, station_q, if_i_, if_q_, agc_linear_gain_, inverse_agc_linear_gain_,
              agc_detector_stage1_, agc_detector_stage2_, last_if_envelope_, main_if_output_i,
              main_if_output_q);
      double mono_if_output_i = 0.0;
      double mono_if_output_q = 0.0;
      double cquam_if_output_i = 0.0;
      double cquam_if_output_q = 0.0;
      if (main_path_mode == kCquamMode) {
        cquam_if_output_i = main_if_output_i;
        cquam_if_output_q = main_if_output_q;
      } else {
        mono_if_output_i = main_if_output_i;
        mono_if_output_q = main_if_output_q;
      }
      if (previous_stereo_mode_ != kNoPreviousMode) {
        double transition_if_output_i = 0.0;
        double transition_if_output_q = 0.0;
        receive(transition_station_i, transition_station_q, transition_if_i_, transition_if_q_,
                transition_agc_linear_gain_, transition_inverse_agc_linear_gain_,
                transition_agc_detector_stage1_, transition_agc_detector_stage2_,
                transition_last_if_envelope_, transition_if_output_i, transition_if_output_q);
        if (stereo_mode_ == kCquamMode) {
          cquam_if_output_i = transition_if_output_i;
          cquam_if_output_q = transition_if_output_q;
        } else {
          mono_if_output_i = transition_if_output_i;
          mono_if_output_q = transition_if_output_q;
        }
      }
      double mono_wet = 0.0;
      if (need_mono_path) {
        double detected = 0.0;
        for (std::size_t phase = 0u; phase < 5u; ++phase) {
          const double interpolated_i =
              processBank(detector_interp_i_, phase == 0u ? mono_if_output_i * 5.0 : 0.0);
          const double interpolated_q =
              processBank(detector_interp_q_, phase == 0u ? mono_if_output_q * 5.0 : 0.0);
          detected =
              processBank(detector_decimation_, detectorStep(interpolated_i, interpolated_q));
        }

        const double receiver_audio =
            detected - dc_previous_input_ + dc_coefficient_ * dc_previous_output_;
        dc_previous_input_ = detected;
        dc_previous_output_ = receiver_audio;
        mono_wet = (receiver_audio + hum_amount_ * 0.2 * hum) * 1.4142135623730951;
        const double current_speaker_wet = processSpeakerPath(
            speaker_, speaker_high_pass_, speaker_peak_, speaker_low_pass_, mono_wet);
        if (speaker_transition_remaining_ > 0u) {
          const double next_speaker_wet =
              processSpeakerPath(speaker_target_, next_speaker_high_pass_, next_speaker_peak_,
                                 next_speaker_low_pass_, mono_wet);
          const double progress =
              static_cast<double>(speaker_transition_total_ - speaker_transition_remaining_) /
              static_cast<double>(speaker_transition_total_);
          const double blend = 0.5 - 0.5 * std::cos(kPi * progress);
          mono_wet = current_speaker_wet + blend * (next_speaker_wet - current_speaker_wet);
          --speaker_transition_remaining_;
          if (speaker_transition_remaining_ == 0u) {
            speaker_high_pass_ = next_speaker_high_pass_;
            speaker_peak_ = next_speaker_peak_;
            speaker_low_pass_ = next_speaker_low_pass_;
            speaker_ = speaker_target_;
          }
        } else {
          mono_wet = current_speaker_wet;
        }
        mono_wet *= output_gain_;
      }

      double cquam_wet_left = 0.0;
      double cquam_wet_right = 0.0;
      if (need_cquam_path) {
        const double cquam_inverse_agc = main_path_mode == kCquamMode
                                             ? inverse_agc_linear_gain_
                                             : transition_inverse_agc_linear_gain_;
        processCquamDecoder(cquam_if_output_i, cquam_if_output_q, cquam_inverse_agc);
        const double cquam_hum = hum_amount_ * 0.2 * hum;
        processCquamSpeakers(cquam_decoded_left_ + cquam_hum, cquam_decoded_right_ + cquam_hum);
        cquam_wet_left = cquam_speaker_output_left_ * output_gain_;
        cquam_wet_right = cquam_speaker_output_right_ * output_gain_;
      }

      double wet_left = 0.0;
      double wet_right = 0.0;
      if (previous_stereo_mode_ != kNoPreviousMode) {
        const double transition_progress =
            mode_transition_total_ <= 1u ? 1.0
                                         : static_cast<double>(mode_transition_position_) /
                                               static_cast<double>(mode_transition_total_ - 1u);
        const double next_weight = 0.5 - 0.5 * std::cos(kPi * transition_progress);
        const double previous_weight = 1.0 - next_weight;
        if (stereo_mode_ == kCquamMode) {
          wet_left = previous_weight * mono_wet + next_weight * cquam_wet_left;
          wet_right = previous_weight * mono_wet + next_weight * cquam_wet_right;
          stereo_blend_ = next_weight * cquam_blend_;
        } else {
          wet_left = previous_weight * cquam_wet_left + next_weight * mono_wet;
          wet_right = previous_weight * cquam_wet_right + next_weight * mono_wet;
          stereo_blend_ = previous_weight * cquam_blend_;
        }
        ++mode_transition_position_;
        if (mode_transition_position_ == mode_transition_total_) {
          finishModeTransition();
        }
      } else if (stereo_mode_ == kCquamMode) {
        wet_left = cquam_wet_left;
        wet_right = cquam_wet_right;
        stereo_blend_ = cquam_blend_;
      } else {
        wet_left = mono_wet;
        wet_right = mono_wet;
        stereo_blend_ = 0.0;
      }

      audio[left_index] = static_cast<float>(dry_mix_ * input_left + mix_ * wet_left);
      if (pair_channels == 2u) {
        audio[right_index] = static_cast<float>(dry_mix_ * input_right + mix_ * wet_right);
      }

      const double path_i = ground_gain_ + sky_gain_ * (fade1_.i + fade2_.i);
      const double path_q = sky_gain_ * (fade1_.q + fade2_.q);
      const double path_magnitude = std::sqrt(path_i * path_i + path_q * path_q);
      double fade_db = 20.0 * std::log10(path_magnitude > 1.0e-4 ? path_magnitude : 1.0e-4);
      if (fade_db < -80.0) {
        fade_db = -80.0;
      } else if (fade_db > 6.0) {
        fade_db = 6.0;
      }
      fade_db_ = fade_db;
      const bool clip_now =
          transmitted_mono_i < 0.0 || (stereo_mode_ == kMonoMode && detector_clipping_);
      if (clip_now && !clip_active_) {
        ++clip_count_;
      }
      clip_active_ = clip_now;
      ++sample_counter_;
    }

    mod_percent_ += 0.2 * (block_mod_peak - mod_percent_);
    if (mod_percent_ < 0.0) {
      mod_percent_ = 0.0;
    } else if (mod_percent_ > 160.0) {
      mod_percent_ = 160.0;
    }
    telemetry_available_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!telemetry_available_) {
      return;
    }
    std::array<std::uint8_t, kTelemetryPayloadBytes> payload{};
    writeF32(payload.data(), finiteFloat(carrier_pre_agc_db_, -80.0));
    writeF32(payload.data() + 4u, finiteFloat(agc_gain_db_, 0.0));
    writeF32(payload.data() + 8u, finiteFloat(mod_percent_, 0.0));
    writeF32(payload.data() + 12u, finiteFloat(fade_db_, 0.0));
    writeF32(payload.data() + 16u, finiteFloat(stereo_blend_, 0.0));
    writeU32(payload.data() + 20u, static_count_);
    writeU32(payload.data() + 24u, clip_count_);
    writer.write(kTelemetryFrameType, kTelemetryVersion, payload.data(),
                 static_cast<std::uint16_t>(payload.size()));
  }

  [[nodiscard]] double debugInterfererProgramPower(double frequency) const noexcept {
    const double omega = kTwoPi * frequency / sample_rate_;
    return bankResponsePower(interferer_filters_, omega);
  }

  [[nodiscard]] double debugTuningReceptionGain(double offset_hz, double program_bandwidth_hz,
                                                double if_bandwidth_hz) const noexcept {
    return tuningReceptionGain(offset_hz, clampTuningOffset(offset_hz), program_bandwidth_hz,
                               if_bandwidth_hz * 0.5);
  }

  [[nodiscard]] double debugModeledTuningOffset(double offset_hz) const noexcept {
    return clampTuningOffset(offset_hz);
  }

  [[nodiscard]] double debugDelayQChecksum() const noexcept {
    double checksum = 0.0;
    for (std::size_t index = 0u; index < delay_q_.size(); ++index) {
      checksum += static_cast<double>(index + 1u) * delay_q_[index];
      checksum += static_cast<double>(delay_q_.size() + index + 1u) * transition_delay_q_[index];
    }
    return checksum;
  }

private:
  static constexpr int kNoPreviousMode = -1;
  static constexpr int kMonoMode = 0;
  static constexpr int kCquamMode = 1;
  static constexpr int kPllCapture = 0;
  static constexpr int kPllTrack = 1;

  [[nodiscard]] static float finiteFloat(double value, double fallback) noexcept {
    return static_cast<float>(std::isfinite(value) ? value : fallback);
  }

  [[nodiscard]] static double fastTanh(double value) noexcept {
    if (value >= 3.0) {
      return 1.0;
    }
    if (value <= -3.0) {
      return -1.0;
    }
    const double squared = value * value;
    return value * (27.0 + squared) / (27.0 + 9.0 * squared);
  }

  [[nodiscard]] static double asymmetricLimit(double value) noexcept {
    if (value > 0.95) {
      return 0.95 + 0.30 * fastTanh((value - 0.95) / 0.30);
    }
    if (value < -0.75) {
      return -0.75 - 0.25 * fastTanh((-value - 0.75) / 0.25);
    }
    return value;
  }

  [[nodiscard]] static double clampTuningOffset(double offset_hz) noexcept {
    if (offset_hz < -kMaximumDigitalTuningHz) {
      return -kMaximumDigitalTuningHz;
    }
    if (offset_hz > kMaximumDigitalTuningHz) {
      return kMaximumDigitalTuningHz;
    }
    return offset_hz;
  }

  [[nodiscard]] static double butterworth6Magnitude(double frequency_hz,
                                                    double cutoff_hz) noexcept {
    if (frequency_hz <= 0.0) {
      return 1.0;
    }
    const double ratio = frequency_hz / cutoff_hz;
    const double squared = ratio * ratio;
    const double sixth = squared * squared * squared;
    return 1.0 / std::sqrt(1.0 + sixth * sixth);
  }

  [[nodiscard]] static double tuningReceptionGain(double offset_hz, double modeled_offset_hz,
                                                  double program_bandwidth_hz,
                                                  double if_cutoff_hz) noexcept {
    const double absolute_offset = offset_hz < 0.0 ? -offset_hz : offset_hz;
    const double absolute_modeled =
        modeled_offset_hz < 0.0 ? -modeled_offset_hz : modeled_offset_hz;
    double true_edge = absolute_offset - program_bandwidth_hz;
    double modeled_edge = absolute_modeled - program_bandwidth_hz;
    if (true_edge < 0.0) {
      true_edge = 0.0;
    }
    if (modeled_edge < 0.0) {
      modeled_edge = 0.0;
    }
    const double modeled_response = butterworth6Magnitude(modeled_edge, if_cutoff_hz);
    const double true_response = butterworth6Magnitude(true_edge, if_cutoff_hz);
    const double gain = true_response / modeled_response;
    return gain < 1.0 ? gain : 1.0;
  }

  static void advancePhase(double &phase, double increment) noexcept {
    phase += increment;
    if (phase >= kTwoPi) {
      phase -= kTwoPi;
    } else if (phase < 0.0) {
      phase += kTwoPi;
    }
  }

  [[nodiscard]] std::size_t requiredCquamMaskTaps() const noexcept {
    constexpr double attenuation_db = 90.0;
    const double oversampled_rate = sample_rate_ * 3.0;
    constexpr double passband_hz = 11000.0;
    constexpr double stopband_hz = 24000.0;
    const double transition_radians = kTwoPi * (stopband_hz - passband_hz) / oversampled_rate;
    std::size_t taps =
        static_cast<std::size_t>(std::ceil((attenuation_db - 8.0) / (2.285 * transition_radians))) +
        1u;
    if ((taps & 1u) == 0u) {
      ++taps;
    }
    return taps;
  }

  [[nodiscard]] std::uint32_t cquamFrequencyWarmupSamples() const noexcept {
    double maximum_pole_radius = 0.0;
    for (double q : kButterworth6Q) {
      Biquad filter;
      filter.configureLowPass(kMinimumIfCutoffHz, q, sample_rate_);
      const double pole_radius = std::sqrt(filter.a2 > 0.0 ? filter.a2 : 0.0);
      if (pole_radius > maximum_pole_radius) {
        maximum_pole_radius = pole_radius;
      }
    }
    const double if_settling_samples =
        maximum_pole_radius > 0.0 && maximum_pole_radius < 1.0
            ? std::ceil(std::log(kCquamEpsilonAbsolute) / std::log(maximum_pole_radius))
            : 0.0;
    const double mask_group_delay_samples =
        std::ceil(static_cast<double>(requiredCquamMaskTaps() - 1u) / 6.0);
    return static_cast<std::uint32_t>(mask_group_delay_samples + if_settling_samples);
  }

  void designCquamMask() noexcept {
    if (cquam_mask_designed_ || !cquam_mask_supported_) {
      return;
    }
    constexpr double attenuation_db = 90.0;
    const double oversampled_rate = sample_rate_ * 3.0;
    constexpr double passband_hz = 11000.0;
    constexpr double stopband_hz = 24000.0;
    cquam_mask_taps_ = requiredCquamMaskTaps();
    const double beta = 0.1102 * (attenuation_db - 8.7);
    const double cutoff_hz = (passband_hz + stopband_hz) * 0.5;
    const double middle = static_cast<double>(cquam_mask_taps_ - 1u) * 0.5;
    const double denominator = besselI0(beta);
    double sum = 0.0;
    for (std::size_t tap = 0u; tap < cquam_mask_taps_; ++tap) {
      const double offset = static_cast<double>(tap) - middle;
      const double normalized = offset / middle;
      const double remaining = 1.0 - normalized * normalized;
      const double window =
          besselI0(beta * std::sqrt(remaining > 0.0 ? remaining : 0.0)) / denominator;
      const double low_pass =
          2.0 * cutoff_hz / oversampled_rate * sinc(2.0 * cutoff_hz * offset / oversampled_rate);
      cquam_mask_coefficients_[tap] = low_pass * window;
      sum += cquam_mask_coefficients_[tap];
    }
    for (std::size_t tap = 0u; tap < cquam_mask_taps_; ++tap) {
      cquam_mask_coefficients_[tap] /= sum;
    }
    cquam_mask_designed_ = true;
  }

  void processCquamMask(double input_i, double input_q, bool emit, double &output_i,
                        double &output_q) noexcept {
    cquam_mask_i_[cquam_mask_position_] = input_i;
    cquam_mask_q_[cquam_mask_position_] = input_q;
    ++cquam_mask_position_;
    if (cquam_mask_position_ == cquam_mask_taps_) {
      cquam_mask_position_ = 0u;
    }
    if (!emit) {
      return;
    }
    output_i = 0.0;
    output_q = 0.0;
    std::size_t position = cquam_mask_position_;
    for (std::size_t tap = 0u; tap < cquam_mask_taps_; ++tap) {
      if (position == 0u) {
        position = cquam_mask_taps_;
      }
      --position;
      const double coefficient = cquam_mask_coefficients_[tap];
      output_i += coefficient * cquam_mask_i_[position];
      output_q += coefficient * cquam_mask_q_[position];
    }
  }

  void deriveBaseRandomState() noexcept {
    dsp::XorShiftRng master(selected_seed_low_, selected_seed_high_);
    base_random_state_ = static_cast<std::uint32_t>(master.nextU64() >> 11u);
    if (base_random_state_ == 0u) {
      base_random_state_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
    }
  }

  [[nodiscard]] double random01() noexcept {
    std::uint32_t value = random_state_;
    value ^= value << 13u;
    value ^= value >> 17u;
    value ^= value << 5u;
    random_state_ = value;
    return static_cast<double>(value) / kFloat32Scale;
  }

  void resetStaticRandomState() noexcept {
    const std::uint32_t normalized_base =
        base_random_state_ == 0u ? kStaticZeroFallback : base_random_state_;
    static_random_state_ = normalized_base ^ kStaticRandomSalt;
    if (static_random_state_ == 0u) {
      static_random_state_ = kStaticZeroFallback;
    }
    static_next_event_deadline_seconds_ = -1.0;
    static_schedule_active_ = false;
    static_scheduled_rate_ = 0.0;
  }

  [[nodiscard]] double nextStaticRandom() noexcept {
    std::uint32_t value = static_random_state_;
    value ^= value << 13u;
    value ^= value >> 17u;
    value ^= value << 5u;
    static_random_state_ = value;
    return static_cast<double>(value) / kFloat32Scale;
  }

  [[nodiscard]] double staticIntervalSeconds(double rate) noexcept {
    double draw = nextStaticRandom();
    if (draw > 1.0 - 1.0e-12) {
      draw = 1.0 - 1.0e-12;
    }
    return -std::log(1.0 - draw) / rate;
  }

  [[nodiscard]] double gaussian() noexcept {
    if (gaussian_has_spare_) {
      gaussian_has_spare_ = false;
      return gaussian_spare_;
    }
    double first = random01();
    if (first < 1.0e-12) {
      first = 1.0e-12;
    }
    const double second = random01();
    const double radius = std::sqrt(-2.0 * std::log(first));
    const double phase = kTwoPi * second;
    gaussian_spare_ = radius * std::sin(phase);
    gaussian_has_spare_ = true;
    return radius * std::cos(phase);
  }

  void initializeSampleRateCoefficients() noexcept {
    control_smoothing_ =
        1.0 - std::exp(-static_cast<double>(kControlInterval) / (sample_rate_ * 0.020));
    pre_emphasis_pole_ = std::exp(-kTwoPi * 2100.0 / sample_rate_);
    limiter_attack_coefficient_ = std::exp(-1.0 / (sample_rate_ * 0.002));
    limiter_release_coefficient_ = std::exp(-1.0 / (sample_rate_ * 0.080));
    dc_coefficient_ = std::exp(-kTwoPi * 20.0 / sample_rate_);
    thermal_noise_std_ = 0.001 * kThermalNoiseCalibration * std::sqrt(sample_rate_ / 12000.0);
    delay1_samples_ = static_cast<std::size_t>(std::floor(sample_rate_ * 0.0007 + 0.5));
    delay2_samples_ = static_cast<std::size_t>(std::floor(sample_rate_ * 0.0023 + 0.5));
    cquam_tan_internal_phase_limit_ = std::tan(kCquamInternalPhaseLimit);
    cquam_pll_frequency_limit_ = kTwoPi * 500.0 / sample_rate_;
    cquam_pll_total_frequency_alpha_ = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.200));
    cquam_pll_outside_samples_ = static_cast<std::uint32_t>(std::round(sample_rate_ * 0.200));
    cquam_pll_pilot_loss_samples_ = static_cast<std::uint32_t>(std::round(sample_rate_ * 1.000));
    cquam_pilot_level_alpha_ = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.200));
    cquam_nominal_pilot_at_agc_target_ = kCquamPilotAmplitude * std::pow(10.0, -6.0 / 20.0);
    const double quality_window_samples = std::round(sample_rate_ * 0.100);
    quality_window_samples_ =
        quality_window_samples >= 1.0 ? static_cast<std::uint32_t>(quality_window_samples) : 1u;
    quality_strength_alpha_ = 1.0 - std::exp(-0.100 / 0.200);
    quality_pilot_strength_alpha_ = 1.0 - std::exp(-0.100 / 0.050);
    quality_reference_rise_alpha_ = 1.0 - std::exp(-0.100 / 0.500);
    quality_reference_fall_alpha_ = 1.0 - std::exp(-0.100 / 60.000);
    cquam_blend_alpha_ = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.100));
  }

  void updateControlCoefficients(std::size_t agc_speed) noexcept {
    pre_emphasis_shelf_gain_ = std::pow(10.0, controls_.preEmphasis / 200.0) - 1.0;
    limiter_threshold_ = std::pow(10.0, -controls_.compression / 20.0);
    limiter_depth_ = controls_.compression / 20.0;
    modulation_ = controls_.modDepth * 0.01;
    const double sky = controls_.skywave * 0.01;
    ground_gain_ = std::sqrt(1.0 - sky);
    sky_gain_ = std::sqrt(sky * 0.5);
    signal_gain_ = std::pow(10.0, controls_.signal / 20.0);
    interferer_gain_ = std::pow(10.0, controls_.interference / 20.0);
    static_probability_ = 1.0 - std::exp(-controls_.staticRate / sample_rate_);
    hum_amount_ = std::pow(10.0, controls_.hum / 20.0);
    hum_phase_increment_ = kTwoPi * controls_.humFrequency / sample_rate_;
    agc_linear_gain_ = std::pow(10.0, agc_gain_db_ / 20.0);
    inverse_agc_linear_gain_ = 1.0 / agc_linear_gain_;
    output_gain_ = std::pow(10.0, controls_.outputGain / 20.0);
    mix_ = controls_.mix * 0.01;
    dry_mix_ = 1.0 - mix_;
    agc_detector_attack_coefficient_ =
        1.0 - std::exp(-1.0 / (sample_rate_ * kAgcAttackTimes[agc_speed]));
    agc_detector_release_coefficient_ =
        1.0 - std::exp(-1.0 / (sample_rate_ * kAgcReleaseTimes[agc_speed]));
  }

  void resetSimulation(std::uint32_t pair_channels, int speaker) noexcept {
    std::fill(delay_.begin(), delay_.end(), 0.0);
    std::fill(delay_q_.begin(), delay_q_.end(), 0.0);
    std::fill(transition_delay_.begin(), transition_delay_.end(), 0.0);
    std::fill(transition_delay_q_.begin(), transition_delay_q_.end(), 0.0);
    delay_position_ = 0u;
    transition_delay_position_ = 0u;
    sample_counter_ = 0u;
    control_remaining_ = 0u;
    controls_ = {
        static_cast<double>(params_.txBandwidth),  static_cast<double>(params_.preEmphasis),
        static_cast<double>(params_.modDepth),     static_cast<double>(params_.compression),
        static_cast<double>(params_.signal),       static_cast<double>(params_.skywave),
        static_cast<double>(params_.fadingSpeed),  static_cast<double>(params_.staticRate),
        static_cast<double>(params_.interference), static_cast<double>(params_.interferenceOffset),
        static_cast<double>(params_.tuning),       static_cast<double>(params_.ifBandwidth),
        static_cast<double>(params_.detectorRc),   static_cast<double>(params_.hum),
        static_cast<double>(params_.outputGain),   static_cast<double>(params_.mix),
        params_.humFrequency < 0.5F ? 50.0 : 60.0};
    updateTuningModel();
    random_state_ = base_random_state_;
    resetStaticRandomState();
    gaussian_has_spare_ = false;
    gaussian_spare_ = 0.0;
    stereo_mode_ = params_.stereoMode >= 0.5F && cquam_mask_supported_ ? kCquamMode : kMonoMode;
    if (stereo_mode_ == kCquamMode) {
      designCquamMask();
    }
    previous_stereo_mode_ = kNoPreviousMode;
    mode_transition_total_ = 0u;
    mode_transition_position_ = 0u;
    pre_emphasis_low_ = 0.0;
    difference_pre_emphasis_low_ = 0.0;
    limiter_envelope_ = 0.0;
    limiter_gain_ = 1.0;
    fade1_ = {};
    fade2_ = {};
    interferer_program_ = 0.0;
    interferer_program_normalizer_ = 1.0;
    interferer_phase_ = 0.0;
    tuning_phase_ = 0.0;
    hum_phase_ = 0.0;
    detector_capacitor_ = 0.0;
    detector_clipping_ = false;
    const double initial_sky = controls_.skywave * 0.01;
    const double initial_path = std::sqrt(1.0 - initial_sky);
    const double initial_if_response = butterworth6Magnitude(
        station_tuning_offset_hz_ < 0.0 ? -station_tuning_offset_hz_ : station_tuning_offset_hz_,
        controls_.ifBandwidth * 500.0);
    const double initial_station = std::pow(10.0, controls_.signal / 20.0) * initial_path *
                                   station_tuning_gain_ * initial_if_response;
    const double initial_noise = 0.001 * std::sqrt(controls_.ifBandwidth / 12.0);
    double initial_carrier =
        std::sqrt(initial_station * initial_station + initial_noise * initial_noise);
    if (initial_carrier < 1.0e-6) {
      initial_carrier = 1.0e-6;
    }
    agc_detector_stage1_ = initial_carrier;
    agc_detector_stage2_ = initial_carrier;
    carrier_pre_agc_db_ = 20.0 * std::log10(initial_carrier);
    agc_gain_db_ = kAgcTargetDb - carrier_pre_agc_db_;
    if (agc_gain_db_ < kMinimumAgcGainDb) {
      agc_gain_db_ = kMinimumAgcGainDb;
    } else if (agc_gain_db_ > kMaximumAgcGainDb) {
      agc_gain_db_ = kMaximumAgcGainDb;
    }
    transition_agc_detector_stage1_ = agc_detector_stage1_;
    transition_agc_detector_stage2_ = agc_detector_stage2_;
    transition_agc_gain_db_ = agc_gain_db_;
    int agc_speed = static_cast<int>(params_.agcSpeed + 0.5F);
    if (agc_speed < 0) {
      agc_speed = 0;
    } else if (agc_speed > 2) {
      agc_speed = 2;
    }
    updateControlCoefficients(static_cast<std::size_t>(agc_speed));
    dc_previous_input_ = 0.0;
    dc_previous_output_ = 0.0;
    mod_percent_ = 0.0;
    fade_db_ = 0.0;
    static_count_ = 0u;
    clip_count_ = 0u;
    clip_active_ = false;
    telemetry_available_ = false;

    tx_high_pass_.reset();
    tx_high_pass_.configureHighPass(50.0, kSqrtHalf, sample_rate_);
    tx_difference_high_pass_.reset();
    tx_difference_high_pass_.configureHighPass(50.0, kSqrtHalf, sample_rate_);
    resetBank(tx_interp_);
    resetBank(tx_filters_);
    resetBank(tx_difference_interp_);
    resetBank(tx_difference_filters_);
    configureBank(tx_interp_, 14000.0, kButterworth4Q, sample_rate_ * 3.0);
    configureBank(tx_filters_, controls_.txBandwidth * 1000.0, kButterworth8Q, sample_rate_ * 3.0);
    configureBank(tx_difference_interp_, 14000.0, kButterworth4Q, sample_rate_ * 3.0);
    configureBank(tx_difference_filters_, controls_.txBandwidth * 1000.0, kButterworth8Q,
                  sample_rate_ * 3.0);
    std::fill(cquam_mask_i_.begin(), cquam_mask_i_.end(), 0.0);
    std::fill(cquam_mask_q_.begin(), cquam_mask_q_.end(), 0.0);
    cquam_mask_position_ = 0u;
    cquam_oversampled_counter_ = 0u;
    resetBank(if_i_);
    resetBank(if_q_);
    configureBank(if_i_, controls_.ifBandwidth * 500.0, kButterworth6Q, sample_rate_);
    configureBank(if_q_, controls_.ifBandwidth * 500.0, kButterworth6Q, sample_rate_);
    transition_if_i_ = if_i_;
    transition_if_q_ = if_q_;
    resetBank(interferer_filters_);
    configureBank(interferer_filters_, 4500.0, kButterworth4Q, sample_rate_);
    interferer_program_normalizer_ = bankNoiseNormalizer(interferer_filters_);
    resetBank(detector_interp_i_);
    resetBank(detector_interp_q_);
    resetBank(detector_decimation_);
    configureBank(detector_interp_i_, 14000.0, kButterworth6Q, sample_rate_ * 5.0);
    configureBank(detector_interp_q_, 14000.0, kButterworth6Q, sample_rate_ * 5.0);
    configureBank(detector_decimation_, 10000.0, kButterworth4Q, sample_rate_ * 5.0);
    resetBank(cquam_interp_i_);
    resetBank(cquam_interp_q_);
    resetBank(cquam_sum_decimation_);
    resetBank(cquam_difference_decimation_);
    configureBank(cquam_interp_i_, 14000.0, kButterworth6Q, sample_rate_ * 5.0);
    configureBank(cquam_interp_q_, 14000.0, kButterworth6Q, sample_rate_ * 5.0);
    configureBank(cquam_sum_decimation_, 10000.0, kButterworth4Q, sample_rate_ * 5.0);
    configureBank(cquam_difference_decimation_, 10000.0, kButterworth4Q, sample_rate_ * 5.0);
    cquam_interpolator_delay_host_samples_ = filterGroupDelayAtDc(cquam_interp_i_) / 5.0;
    resetCquamPll();
    cquam_pilot_band_pass_ = {};
    cquam_pilot_band_pass_.configureBandPass(kCquamPilotFrequency, 8.0, sample_rate_);
    quality_pilot_band_pass_ = {};
    quality_pilot_band_pass_.configureBandPass(kCquamPilotFrequency, 4.0, sample_rate_);
    cquam_left_pilot_notch_ = {};
    cquam_left_pilot_notch_.configureNotch(kCquamPilotFrequency, 2.5, sample_rate_);
    cquam_right_pilot_notch_ = {};
    cquam_right_pilot_notch_.configureNotch(kCquamPilotFrequency, 2.5, sample_rate_);
    cquam_pilot_level_ = 0.0;
    cquam_pilot_detected_ = false;
    cquam_blend_ = 0.0;
    quality_term_ = 1.0;
    quality_sum_strength_ = 0.0;
    quality_pilot_strength_ = 0.0;
    quality_sum_reference_ = 0.0;
    quality_pilot_reference_ = 0.0;
    quality_detected_sum_ = 0.0;
    quality_pilot_power_sum_ = 0.0;
    quality_detected_count_ = 0u;
    quality_observation_valid_ = false;
    cquam_dc_left_input_ = 0.0;
    cquam_dc_left_output_ = 0.0;
    cquam_dc_right_input_ = 0.0;
    cquam_dc_right_output_ = 0.0;
    cquam_decoded_left_ = 0.0;
    cquam_decoded_right_ = 0.0;
    last_if_envelope_ = 0.0;
    updateDetectorCoefficients();
    configureSpeakerPath(speaker, speaker_high_pass_, speaker_peak_, speaker_low_pass_);
    next_speaker_high_pass_ = {};
    next_speaker_peak_ = {};
    next_speaker_low_pass_ = {};
    speaker_target_ = speaker;
    speaker_transition_total_ = 0u;
    speaker_transition_remaining_ = 0u;
    configureSpeakerPath(speaker, cquam_speaker_high_pass_left_, cquam_speaker_peak_left_,
                         cquam_speaker_low_pass_left_);
    configureSpeakerPath(speaker, cquam_speaker_high_pass_right_, cquam_speaker_peak_right_,
                         cquam_speaker_low_pass_right_);
    next_cquam_speaker_high_pass_left_ = {};
    next_cquam_speaker_peak_left_ = {};
    next_cquam_speaker_low_pass_left_ = {};
    next_cquam_speaker_high_pass_right_ = {};
    next_cquam_speaker_peak_right_ = {};
    next_cquam_speaker_low_pass_right_ = {};
    cquam_speaker_ = speaker;
    cquam_speaker_target_ = speaker;
    cquam_speaker_transition_total_ = 0u;
    cquam_speaker_transition_remaining_ = 0u;
    cquam_speaker_output_left_ = 0.0;
    cquam_speaker_output_right_ = 0.0;
    stereo_blend_ = 0.0;
    transition_agc_linear_gain_ = agc_linear_gain_;
    transition_inverse_agc_linear_gain_ = inverse_agc_linear_gain_;
    transition_carrier_pre_agc_db_ = carrier_pre_agc_db_;
    transition_last_if_envelope_ = last_if_envelope_;
    pair_channels_ = pair_channels;
    speaker_ = speaker;
    initialized_ = true;
  }

  void configureSpeakerPath(int speaker, Biquad &high_pass, Biquad &peak,
                            Biquad &low_pass) const noexcept {
    high_pass = {};
    peak = {};
    low_pass = {};
    if (speaker == 0) {
      return;
    }
    const double high_frequency = speaker == 1 ? 220.0 : 120.0;
    const double high_q = speaker == 1 ? 0.9 : 0.8;
    const double peak_frequency = speaker == 1 ? 1900.0 : 2600.0;
    const double peak_q = speaker == 1 ? 2.0 : 1.6;
    const double peak_gain = speaker == 1 ? 4.5 : 3.0;
    const double low_frequency = speaker == 1 ? 3800.0 : 5500.0;
    high_pass.configureHighPass(high_frequency, high_q, sample_rate_);
    peak.configurePeak(peak_frequency, peak_q, peak_gain, sample_rate_);
    low_pass.configureLowPass(low_frequency, kSqrtHalf, sample_rate_);
  }

  static double processSpeakerPath(int speaker, Biquad &high_pass, Biquad &peak, Biquad &low_pass,
                                   double input) noexcept {
    if (speaker == 0) {
      return input;
    }
    return low_pass.process(peak.process(high_pass.process(input)));
  }

  void startSpeakerTransition(int speaker) noexcept {
    configureSpeakerPath(speaker, next_speaker_high_pass_, next_speaker_peak_,
                         next_speaker_low_pass_);
    speaker_target_ = speaker;
    const double samples = std::floor(sample_rate_ * kSpeakerTransitionTime + 0.5);
    speaker_transition_total_ = samples >= 1.0 ? static_cast<std::uint32_t>(samples) : 1u;
    speaker_transition_remaining_ = speaker_transition_total_;
  }

  void startCquamSpeakerTransition(int speaker) noexcept {
    configureSpeakerPath(speaker, next_cquam_speaker_high_pass_left_, next_cquam_speaker_peak_left_,
                         next_cquam_speaker_low_pass_left_);
    configureSpeakerPath(speaker, next_cquam_speaker_high_pass_right_,
                         next_cquam_speaker_peak_right_, next_cquam_speaker_low_pass_right_);
    cquam_speaker_target_ = speaker;
    const double samples = std::floor(sample_rate_ * kSpeakerTransitionTime + 0.5);
    cquam_speaker_transition_total_ = samples >= 1.0 ? static_cast<std::uint32_t>(samples) : 1u;
    cquam_speaker_transition_remaining_ = cquam_speaker_transition_total_;
  }

  void resetCquamPll() noexcept {
    cquam_pll_phase_ = 0.0;
    cquam_pll_frequency_ = 0.0;
    cquam_pll_total_frequency_hz_ = 0.0;
    cquam_pll_total_frequency_valid_ = false;
    cquam_pll_frequency_warmup_remaining_ = cquam_pll_frequency_warmup_samples_;
    cquam_pll_previous_i_ = 0.0;
    cquam_pll_previous_q_ = 0.0;
    cquam_pll_previous_valid_ = false;
    cquam_pll_residual_frequency_hz_ = 0.0;
    cquam_pll_state_ = kPllCapture;
    cquam_pll_qualify_hold_ = 0u;
    cquam_pll_outside_hold_ = 0u;
    cquam_pll_pilot_loss_hold_ = 0u;
    cquam_pll_history_position_ = 0u;
    std::fill(cquam_pll_frequency_history_.begin(), cquam_pll_frequency_history_.end(), 0.0);
    cquam_pll_corrected_phase_ = 0.0;
  }

  void resetCquamState() noexcept {
    std::fill(delay_q_.begin(), delay_q_.end(), 0.0);
    std::fill(transition_delay_q_.begin(), transition_delay_q_.end(), 0.0);
    tx_difference_high_pass_.reset();
    difference_pre_emphasis_low_ = 0.0;
    resetBank(tx_difference_interp_);
    resetBank(tx_difference_filters_);
    std::fill(cquam_mask_i_.begin(), cquam_mask_i_.end(), 0.0);
    std::fill(cquam_mask_q_.begin(), cquam_mask_q_.end(), 0.0);
    cquam_mask_position_ = 0u;
    cquam_oversampled_counter_ = 0u;
    resetBank(cquam_interp_i_);
    resetBank(cquam_interp_q_);
    resetBank(cquam_sum_decimation_);
    resetBank(cquam_difference_decimation_);
    resetCquamPll();
    cquam_pilot_band_pass_.reset();
    quality_pilot_band_pass_.reset();
    cquam_left_pilot_notch_.reset();
    cquam_right_pilot_notch_.reset();
    cquam_pilot_level_ = 0.0;
    cquam_pilot_detected_ = false;
    cquam_blend_ = 0.0;
    quality_term_ = 1.0;
    quality_sum_strength_ = 0.0;
    quality_pilot_strength_ = 0.0;
    quality_sum_reference_ = 0.0;
    quality_pilot_reference_ = 0.0;
    quality_detected_sum_ = 0.0;
    quality_pilot_power_sum_ = 0.0;
    quality_detected_count_ = 0u;
    quality_observation_valid_ = false;
    cquam_dc_left_input_ = 0.0;
    cquam_dc_left_output_ = 0.0;
    cquam_dc_right_input_ = 0.0;
    cquam_dc_right_output_ = 0.0;
    stereo_blend_ = 0.0;
  }

  void startModeTransition(int next_mode) noexcept {
    previous_stereo_mode_ = stereo_mode_;
    stereo_mode_ = next_mode;
    std::fill(transition_delay_.begin(), transition_delay_.end(), 0.0);
    std::fill(transition_delay_q_.begin(), transition_delay_q_.end(), 0.0);
    transition_delay_position_ = delay_position_;
    transition_if_i_ = if_i_;
    transition_if_q_ = if_q_;
    transition_agc_detector_stage1_ = agc_detector_stage1_;
    transition_agc_detector_stage2_ = agc_detector_stage2_;
    transition_agc_gain_db_ = agc_gain_db_;
    transition_agc_linear_gain_ = agc_linear_gain_;
    transition_inverse_agc_linear_gain_ = inverse_agc_linear_gain_;
    transition_carrier_pre_agc_db_ = carrier_pre_agc_db_;
    transition_last_if_envelope_ = last_if_envelope_;
    if (next_mode == kCquamMode) {
      designCquamMask();
      resetCquamState();
      cquam_speaker_high_pass_left_ = speaker_high_pass_;
      cquam_speaker_peak_left_ = speaker_peak_;
      cquam_speaker_low_pass_left_ = speaker_low_pass_;
      cquam_speaker_high_pass_right_ = speaker_high_pass_;
      cquam_speaker_peak_right_ = speaker_peak_;
      cquam_speaker_low_pass_right_ = speaker_low_pass_;
      cquam_speaker_ = speaker_;
      cquam_speaker_target_ = speaker_;
      cquam_speaker_transition_remaining_ = 0u;
    } else {
      detector_capacitor_ = std::isfinite(last_if_envelope_) ? last_if_envelope_ : 0.0;
      speaker_high_pass_ = cquam_speaker_high_pass_left_;
      speaker_peak_ = cquam_speaker_peak_left_;
      speaker_low_pass_ = cquam_speaker_low_pass_left_;
      speaker_ = cquam_speaker_;
      speaker_target_ = cquam_speaker_;
      speaker_transition_remaining_ = 0u;
    }
    const double samples = std::round(sample_rate_ * kSpeakerTransitionTime);
    mode_transition_total_ = samples >= 1.0 ? static_cast<std::uint32_t>(samples) : 1u;
    mode_transition_position_ = 0u;
  }

  void finishModeTransition() noexcept {
    delay_.swap(transition_delay_);
    delay_q_.swap(transition_delay_q_);
    delay_position_ = transition_delay_position_;
    std::swap(if_i_, transition_if_i_);
    std::swap(if_q_, transition_if_q_);
    std::swap(agc_detector_stage1_, transition_agc_detector_stage1_);
    std::swap(agc_detector_stage2_, transition_agc_detector_stage2_);
    std::swap(agc_gain_db_, transition_agc_gain_db_);
    std::swap(agc_linear_gain_, transition_agc_linear_gain_);
    std::swap(inverse_agc_linear_gain_, transition_inverse_agc_linear_gain_);
    std::swap(carrier_pre_agc_db_, transition_carrier_pre_agc_db_);
    std::swap(last_if_envelope_, transition_last_if_envelope_);
    previous_stereo_mode_ = kNoPreviousMode;
  }

  void stepCquamPll(double i, double q) noexcept {
    const double magnitude = std::sqrt(i * i + q * q);
    const bool valid = magnitude >= kCquamEpsilonAbsolute;
    if (cquam_pll_frequency_warmup_remaining_ > 0u) {
      --cquam_pll_frequency_warmup_remaining_;
      cquam_pll_previous_valid_ = false;
    } else {
      if (valid && cquam_pll_previous_valid_) {
        const double product_real = i * cquam_pll_previous_i_ + q * cquam_pll_previous_q_;
        const double product_imaginary = q * cquam_pll_previous_i_ - i * cquam_pll_previous_q_;
        const double instantaneous_hz =
            std::atan2(product_imaginary, product_real) * sample_rate_ / kTwoPi;
        if (!cquam_pll_total_frequency_valid_) {
          cquam_pll_total_frequency_hz_ = instantaneous_hz;
          cquam_pll_total_frequency_valid_ = true;
        } else {
          cquam_pll_total_frequency_hz_ +=
              cquam_pll_total_frequency_alpha_ * (instantaneous_hz - cquam_pll_total_frequency_hz_);
        }
      }
      cquam_pll_previous_i_ = i;
      cquam_pll_previous_q_ = q;
      cquam_pll_previous_valid_ = valid;
    }

    const double cosine = std::cos(cquam_pll_phase_);
    const double sine = std::sin(cquam_pll_phase_);
    const double rotated_q = q * cosine - i * sine;
    const double inverse =
        1.0 / (magnitude > kCquamEpsilonAbsolute ? magnitude : kCquamEpsilonAbsolute);
    const double error = rotated_q * inverse;
    const double natural_frequency = cquam_pll_state_ == kPllTrack ? 1.5 : 60.0;
    const double damping = cquam_pll_state_ == kPllTrack ? 1.0 : 0.7;
    const double normalized = kTwoPi * natural_frequency / sample_rate_;
    double frequency = cquam_pll_frequency_ + normalized * normalized * error;
    if (frequency < -cquam_pll_frequency_limit_) {
      frequency = -cquam_pll_frequency_limit_;
    } else if (frequency > cquam_pll_frequency_limit_) {
      frequency = cquam_pll_frequency_limit_;
    }
    cquam_pll_frequency_ = frequency;
    const double corrected_phase = cquam_pll_phase_ + 2.0 * damping * normalized * error;
    cquam_pll_phase_ = corrected_phase + frequency;
    if (cquam_pll_phase_ >= kTwoPi) {
      cquam_pll_phase_ -= kTwoPi;
    } else if (cquam_pll_phase_ < 0.0) {
      cquam_pll_phase_ += kTwoPi;
    }

    const double estimated_frequency_hz = frequency * sample_rate_ / kTwoPi;
    cquam_pll_residual_frequency_hz_ = cquam_pll_total_frequency_hz_ - estimated_frequency_hz;
    const double old_frequency_hz = cquam_pll_frequency_history_[cquam_pll_history_position_];
    cquam_pll_frequency_history_[cquam_pll_history_position_] = estimated_frequency_hz;
    ++cquam_pll_history_position_;
    if (cquam_pll_history_position_ == cquam_pll_frequency_history_.size()) {
      cquam_pll_history_position_ = 0u;
    }
    const double frequency_delta = estimated_frequency_hz - old_frequency_hz;
    const double absolute_frequency_delta =
        frequency_delta < 0.0 ? -frequency_delta : frequency_delta;
    const double absolute_residual = cquam_pll_residual_frequency_hz_ < 0.0
                                         ? -cquam_pll_residual_frequency_hz_
                                         : cquam_pll_residual_frequency_hz_;
    const double absolute_total = cquam_pll_total_frequency_hz_ < 0.0
                                      ? -cquam_pll_total_frequency_hz_
                                      : cquam_pll_total_frequency_hz_;
    if (cquam_pll_state_ == kPllCapture) {
      const bool eligible = cquam_pll_total_frequency_valid_ && absolute_frequency_delta < 5.0 &&
                            absolute_residual < 5.0 && absolute_total <= 480.0;
      cquam_pll_qualify_hold_ = eligible ? cquam_pll_qualify_hold_ + 1u : 0u;
      if (cquam_pll_qualify_hold_ >= cquam_pll_frequency_history_.size()) {
        cquam_pll_state_ = kPllTrack;
        cquam_pll_qualify_hold_ = 0u;
        cquam_pll_outside_hold_ = 0u;
        cquam_pll_pilot_loss_hold_ = 0u;
      }
    } else {
      cquam_pll_outside_hold_ = absolute_total >= 520.0 ? cquam_pll_outside_hold_ + 1u : 0u;
      cquam_pll_pilot_loss_hold_ = cquam_pilot_detected_ ? 0u : cquam_pll_pilot_loss_hold_ + 1u;
      if (cquam_pll_outside_hold_ >= cquam_pll_outside_samples_ ||
          cquam_pll_pilot_loss_hold_ >= cquam_pll_pilot_loss_samples_) {
        cquam_pll_state_ = kPllCapture;
        cquam_pll_qualify_hold_ = 0u;
        cquam_pll_outside_hold_ = 0u;
        cquam_pll_pilot_loss_hold_ = 0u;
      }
    }
    cquam_pll_corrected_phase_ = corrected_phase;
  }

  void processCquamDecoder(double i, double q, double inverse_agc_linear_gain) noexcept {
    stepCquamPll(i, q);
    double detected = 0.0;
    double decoded_difference = 0.0;
    for (std::size_t phase = 0u; phase < 5u; ++phase) {
      const double interpolated_i = processBank(cquam_interp_i_, phase == 0u ? i * 5.0 : 0.0);
      const double interpolated_q = processBank(cquam_interp_q_, phase == 0u ? q * 5.0 : 0.0);
      const double magnitude =
          std::sqrt(interpolated_i * interpolated_i + interpolated_q * interpolated_q);
      detected = processBank(cquam_sum_decimation_, magnitude);
      if (magnitude < kCquamEpsilonAbsolute) {
        decoded_difference = processBank(cquam_difference_decimation_, 0.0);
      } else {
        const double sub_sample_phase = cquam_pll_frequency_ * static_cast<double>(phase) / 5.0;
        const double delay_compensation =
            cquam_pll_frequency_ * cquam_interpolator_delay_host_samples_;
        const double used_phase =
            cquam_pll_corrected_phase_ + sub_sample_phase - delay_compensation;
        const double cosine = std::cos(used_phase);
        const double sine = std::sin(used_phase);
        const double rotated_i = interpolated_i * cosine + interpolated_q * sine;
        const double rotated_q = interpolated_q * cosine - interpolated_i * sine;
        const double relative_floor = kCquamEpsilonRelative * magnitude;
        const double first_floor = rotated_i > relative_floor ? rotated_i : relative_floor;
        const double denominator =
            first_floor > kCquamEpsilonAbsolute ? first_floor : kCquamEpsilonAbsolute;
        decoded_difference =
            processBank(cquam_difference_decimation_, magnitude * rotated_q / denominator);
      }
    }
    const double pilot_band = cquam_pilot_band_pass_.process(decoded_difference);
    const double quality_pilot_band =
        quality_pilot_band_pass_.process(decoded_difference * inverse_agc_linear_gain);
    cquam_pilot_level_ +=
        cquam_pilot_level_alpha_ * (2.0 * pilot_band * pilot_band - cquam_pilot_level_);
    const double pilot_power = cquam_pilot_level_ > 0.0 ? cquam_pilot_level_ : 0.0;
    const double pilot_amplitude = std::sqrt(pilot_power);
    if (!cquam_pilot_detected_ && pilot_amplitude > cquam_nominal_pilot_at_agc_target_ * 0.5) {
      cquam_pilot_detected_ = true;
    } else if (cquam_pilot_detected_ &&
               pilot_amplitude < cquam_nominal_pilot_at_agc_target_ * 0.25) {
      cquam_pilot_detected_ = false;
    }
    if (cquam_pll_state_ == kPllTrack && cquam_pilot_detected_) {
      quality_detected_sum_ += detected * inverse_agc_linear_gain;
      quality_pilot_power_sum_ += 2.0 * quality_pilot_band * quality_pilot_band;
      ++quality_detected_count_;
      if (quality_detected_count_ == quality_window_samples_) {
        const double sum_observation =
            quality_detected_sum_ / static_cast<double>(quality_detected_count_);
        const double pilot_mean_power =
            quality_pilot_power_sum_ / static_cast<double>(quality_detected_count_);
        const double pilot_observation = std::sqrt(pilot_mean_power > 0.0 ? pilot_mean_power : 0.0);
        quality_detected_sum_ = 0.0;
        quality_pilot_power_sum_ = 0.0;
        quality_detected_count_ = 0u;
        if (!quality_observation_valid_) {
          quality_sum_strength_ = sum_observation;
          quality_pilot_strength_ = pilot_observation;
          quality_sum_reference_ = sum_observation;
          quality_pilot_reference_ = pilot_observation;
          quality_observation_valid_ = true;
          quality_term_ = 1.0;
        } else {
          quality_sum_strength_ +=
              quality_strength_alpha_ * (sum_observation - quality_sum_strength_);
          quality_pilot_strength_ +=
              quality_pilot_strength_alpha_ * (pilot_observation - quality_pilot_strength_);
          const double sum_reference_alpha = quality_sum_strength_ > quality_sum_reference_
                                                 ? quality_reference_rise_alpha_
                                                 : quality_reference_fall_alpha_;
          const double pilot_reference_alpha = quality_pilot_strength_ > quality_pilot_reference_
                                                   ? quality_reference_rise_alpha_
                                                   : quality_reference_fall_alpha_;
          quality_sum_reference_ +=
              sum_reference_alpha * (quality_sum_strength_ - quality_sum_reference_);
          quality_pilot_reference_ +=
              pilot_reference_alpha * (quality_pilot_strength_ - quality_pilot_reference_);
          const double sum_reference =
              quality_sum_reference_ > 1.0e-12 ? quality_sum_reference_ : 1.0e-12;
          const double pilot_reference =
              quality_pilot_reference_ > 1.0e-12 ? quality_pilot_reference_ : 1.0e-12;
          const double sum_ratio = quality_sum_strength_ / sum_reference;
          const double pilot_ratio = quality_pilot_strength_ / pilot_reference;
          double sum_bounded_ratio = sum_ratio / kQualityProgramAllowanceRatio;
          if (sum_bounded_ratio > 1.0) {
            sum_bounded_ratio = 1.0;
          }
          double pilot_bounded_ratio = pilot_ratio / kQualityProgramAllowanceRatio;
          if (pilot_bounded_ratio > 1.0) {
            pilot_bounded_ratio = 1.0;
          }
          double sum_effective_ratio = sum_bounded_ratio - kQualityExcessRatioOffset;
          if (sum_effective_ratio < 0.0) {
            sum_effective_ratio = 0.0;
          }
          double pilot_effective_ratio = pilot_bounded_ratio - kQualityExcessRatioOffset;
          if (pilot_effective_ratio < 0.0) {
            pilot_effective_ratio = 0.0;
          }
          double sum_quality_term = 0.0;
          if (sum_effective_ratio >= kQualityFullRatio) {
            sum_quality_term = 1.0;
          } else if (sum_effective_ratio <= kQualityMonoRatio) {
            sum_quality_term = 0.0;
          } else {
            sum_quality_term =
                (sum_effective_ratio - kQualityMonoRatio) / (kQualityFullRatio - kQualityMonoRatio);
          }
          double pilot_quality_term = 0.0;
          if (pilot_effective_ratio >= kQualityFullRatio) {
            pilot_quality_term = 1.0;
          } else if (pilot_effective_ratio <= kQualityMonoRatio) {
            pilot_quality_term = 0.0;
          } else {
            pilot_quality_term = (pilot_effective_ratio - kQualityMonoRatio) /
                                 (kQualityFullRatio - kQualityMonoRatio);
          }
          quality_term_ = 1.0 - std::sqrt((1.0 - sum_quality_term) * (1.0 - pilot_quality_term));
        }
      }
    } else {
      quality_detected_sum_ = 0.0;
      quality_pilot_power_sum_ = 0.0;
      quality_detected_count_ = 0u;
      quality_observation_valid_ = false;
      quality_term_ = 1.0;
    }
    double carrier_term = (carrier_pre_agc_db_ + 50.0) / 20.0;
    if (carrier_term < 0.0) {
      carrier_term = 0.0;
    } else if (carrier_term > 1.0) {
      carrier_term = 1.0;
    }
    const double blend_target =
        cquam_pll_state_ == kPllTrack && cquam_pilot_detected_ ? carrier_term * quality_term_ : 0.0;
    cquam_blend_ += cquam_blend_alpha_ * (blend_target - cquam_blend_);
    const double left_matrix = detected + cquam_blend_ * decoded_difference;
    const double right_matrix = detected - cquam_blend_ * decoded_difference;
    const double left_notched = cquam_left_pilot_notch_.process(left_matrix);
    const double right_notched = cquam_right_pilot_notch_.process(right_matrix);
    const double left =
        left_notched - cquam_dc_left_input_ + dc_coefficient_ * cquam_dc_left_output_;
    cquam_dc_left_input_ = left_notched;
    cquam_dc_left_output_ = left;
    const double right =
        right_notched - cquam_dc_right_input_ + dc_coefficient_ * cquam_dc_right_output_;
    cquam_dc_right_input_ = right_notched;
    cquam_dc_right_output_ = right;
    cquam_decoded_left_ = left * 1.4142135623730951;
    cquam_decoded_right_ = right * 1.4142135623730951;
  }

  void processCquamSpeakers(double left, double right) noexcept {
    const double current_left =
        processSpeakerPath(cquam_speaker_, cquam_speaker_high_pass_left_, cquam_speaker_peak_left_,
                           cquam_speaker_low_pass_left_, left);
    const double current_right =
        processSpeakerPath(cquam_speaker_, cquam_speaker_high_pass_right_,
                           cquam_speaker_peak_right_, cquam_speaker_low_pass_right_, right);
    if (cquam_speaker_transition_remaining_ > 0u) {
      const double next_left = processSpeakerPath(
          cquam_speaker_target_, next_cquam_speaker_high_pass_left_, next_cquam_speaker_peak_left_,
          next_cquam_speaker_low_pass_left_, left);
      const double next_right = processSpeakerPath(
          cquam_speaker_target_, next_cquam_speaker_high_pass_right_,
          next_cquam_speaker_peak_right_, next_cquam_speaker_low_pass_right_, right);
      const double progress = static_cast<double>(cquam_speaker_transition_total_ -
                                                  cquam_speaker_transition_remaining_) /
                              static_cast<double>(cquam_speaker_transition_total_);
      const double blend = 0.5 - 0.5 * std::cos(kPi * progress);
      cquam_speaker_output_left_ = current_left + blend * (next_left - current_left);
      cquam_speaker_output_right_ = current_right + blend * (next_right - current_right);
      --cquam_speaker_transition_remaining_;
      if (cquam_speaker_transition_remaining_ == 0u) {
        cquam_speaker_high_pass_left_ = next_cquam_speaker_high_pass_left_;
        cquam_speaker_peak_left_ = next_cquam_speaker_peak_left_;
        cquam_speaker_low_pass_left_ = next_cquam_speaker_low_pass_left_;
        cquam_speaker_high_pass_right_ = next_cquam_speaker_high_pass_right_;
        cquam_speaker_peak_right_ = next_cquam_speaker_peak_right_;
        cquam_speaker_low_pass_right_ = next_cquam_speaker_low_pass_right_;
        cquam_speaker_ = cquam_speaker_target_;
      }
    } else {
      cquam_speaker_output_left_ = current_left;
      cquam_speaker_output_right_ = current_right;
    }
  }

  void updateFadeTap(FadeTap &tap, double pole, double normalizer) noexcept {
    const double input_i = gaussian() * kSqrtHalf;
    const double input_q = gaussian() * kSqrtHalf;
    const double feed = 1.0 - pole;
    tap.i1 = pole * tap.i1 + feed * input_i;
    tap.i2 = pole * tap.i2 + feed * tap.i1;
    tap.q1 = pole * tap.q1 + feed * input_q;
    tap.q2 = pole * tap.q2 + feed * tap.q1;
    const double target_i = tap.i2 * normalizer;
    const double target_q = tap.q2 * normalizer;
    tap.stepI = (target_i - tap.i) / static_cast<double>(kControlInterval);
    tap.stepQ = (target_q - tap.q) / static_cast<double>(kControlInterval);
  }

  void updateControl() noexcept {
    const int requested_mode =
        params_.stereoMode >= 0.5F && cquam_mask_supported_ ? kCquamMode : kMonoMode;
    if (requested_mode != stereo_mode_ && previous_stereo_mode_ == kNoPreviousMode) {
      startModeTransition(requested_mode);
    }
    auto smooth = [this](double &current, float target) noexcept {
      current += control_smoothing_ * (static_cast<double>(target) - current);
    };
    smooth(controls_.txBandwidth, params_.txBandwidth);
    smooth(controls_.preEmphasis, params_.preEmphasis);
    smooth(controls_.modDepth, params_.modDepth);
    smooth(controls_.compression, params_.compression);
    smooth(controls_.signal, params_.signal);
    smooth(controls_.skywave, params_.skywave);
    smooth(controls_.fadingSpeed, params_.fadingSpeed);
    smooth(controls_.staticRate, params_.staticRate);
    smooth(controls_.interference, params_.interference);
    smooth(controls_.interferenceOffset, params_.interferenceOffset);
    smooth(controls_.tuning, params_.tuning);
    smooth(controls_.ifBandwidth, params_.ifBandwidth);
    smooth(controls_.detectorRc, params_.detectorRc);
    smooth(controls_.hum, params_.hum);
    smooth(controls_.outputGain, params_.outputGain);
    smooth(controls_.mix, params_.mix);
    const double hum_frequency = params_.humFrequency < 0.5F ? 50.0 : 60.0;
    controls_.humFrequency += control_smoothing_ * (hum_frequency - controls_.humFrequency);
    configureBank(tx_filters_, controls_.txBandwidth * 1000.0, kButterworth8Q, sample_rate_ * 3.0);
    configureBank(tx_difference_filters_, controls_.txBandwidth * 1000.0, kButterworth8Q,
                  sample_rate_ * 3.0);
    configureBank(if_i_, controls_.ifBandwidth * 500.0, kButterworth6Q, sample_rate_);
    configureBank(if_q_, controls_.ifBandwidth * 500.0, kButterworth6Q, sample_rate_);
    if (previous_stereo_mode_ != kNoPreviousMode) {
      configureBank(transition_if_i_, controls_.ifBandwidth * 500.0, kButterworth6Q, sample_rate_);
      configureBank(transition_if_q_, controls_.ifBandwidth * 500.0, kButterworth6Q, sample_rate_);
    }
    updateTuningModel();
    updateDetectorCoefficients();

    const double control_rate = sample_rate_ / static_cast<double>(kControlInterval);
    const double pole = std::exp(-kTwoPi * controls_.fadingSpeed / control_rate);
    const double one_minus = 1.0 - pole;
    const double pole_squared = pole * pole;
    const double denominator = 1.0 - pole_squared;
    const double variance_gain = one_minus * one_minus * one_minus * one_minus *
                                 (1.0 + pole_squared) / (denominator * denominator * denominator);
    const double normalizer = variance_gain > 1.0e-20 ? 1.0 / std::sqrt(variance_gain) : 0.0;
    updateFadeTap(fade1_, pole, normalizer);
    updateFadeTap(fade2_, pole, normalizer);

    const double detected = agc_detector_stage2_ > 1.0e-12 ? agc_detector_stage2_ : 1.0e-12;
    const double detected_db = 20.0 * std::log10(detected);
    double target_gain = kAgcTargetDb - detected_db;
    if (target_gain < kMinimumAgcGainDb) {
      target_gain = kMinimumAgcGainDb;
    } else if (target_gain > kMaximumAgcGainDb) {
      target_gain = kMaximumAgcGainDb;
    }
    int speed = static_cast<int>(params_.agcSpeed + 0.5F);
    if (speed < 0) {
      speed = 0;
    } else if (speed > 2) {
      speed = 2;
    }
    const std::size_t agc_speed = static_cast<std::size_t>(speed);
    const double time =
        target_gain < agc_gain_db_ ? kAgcAttackTimes[agc_speed] : kAgcReleaseTimes[agc_speed];
    const double coefficient =
        1.0 - std::exp(-static_cast<double>(kControlInterval) / (sample_rate_ * time));
    agc_gain_db_ += coefficient * (target_gain - agc_gain_db_);
    double pre_agc = detected_db;
    if (pre_agc < -80.0) {
      pre_agc = -80.0;
    } else if (pre_agc > 6.0) {
      pre_agc = 6.0;
    }
    carrier_pre_agc_db_ = pre_agc;
    updateControlCoefficients(agc_speed);
    if (previous_stereo_mode_ != kNoPreviousMode) {
      const double transition_detected =
          transition_agc_detector_stage2_ > 1.0e-12 ? transition_agc_detector_stage2_ : 1.0e-12;
      const double transition_detected_db = 20.0 * std::log10(transition_detected);
      double transition_target_gain = kAgcTargetDb - transition_detected_db;
      if (transition_target_gain < kMinimumAgcGainDb) {
        transition_target_gain = kMinimumAgcGainDb;
      } else if (transition_target_gain > kMaximumAgcGainDb) {
        transition_target_gain = kMaximumAgcGainDb;
      }
      const double transition_time = transition_target_gain < transition_agc_gain_db_
                                         ? kAgcAttackTimes[agc_speed]
                                         : kAgcReleaseTimes[agc_speed];
      const double transition_coefficient =
          1.0 - std::exp(-static_cast<double>(kControlInterval) / (sample_rate_ * transition_time));
      transition_agc_gain_db_ +=
          transition_coefficient * (transition_target_gain - transition_agc_gain_db_);
      double transition_pre_agc = transition_detected_db;
      if (transition_pre_agc < -80.0) {
        transition_pre_agc = -80.0;
      } else if (transition_pre_agc > 6.0) {
        transition_pre_agc = 6.0;
      }
      transition_carrier_pre_agc_db_ = transition_pre_agc;
      transition_agc_linear_gain_ = std::pow(10.0, transition_agc_gain_db_ / 20.0);
      transition_inverse_agc_linear_gain_ = 1.0 / transition_agc_linear_gain_;
    }
    control_remaining_ = kControlInterval;
  }

  void updateDetectorCoefficients() noexcept {
    const double release_seconds = controls_.detectorRc * 1.0e-6;
    // The single Detector RC control represents RL*C. A fixed Rd/RL ratio keeps the reduced
    // model physical while the parallel combination supplies the diode-on time constant.
    const double charge_seconds = release_seconds * kDetectorDiodeToLoadResistanceRatio /
                                  (1.0 + kDetectorDiodeToLoadResistanceRatio);
    detector_charge_ = std::exp(-1.0 / (sample_rate_ * 5.0 * charge_seconds));
    detector_release_ = std::exp(-1.0 / (sample_rate_ * 5.0 * release_seconds));
  }

  void updateTuningModel() noexcept {
    const double tuning_hz = controls_.tuning * 1000.0;
    const double interferer_hz = tuning_hz + controls_.interferenceOffset * 1000.0;
    const double if_cutoff_hz = controls_.ifBandwidth * 500.0;
    station_tuning_offset_hz_ = clampTuningOffset(tuning_hz);
    interferer_tuning_offset_hz_ = clampTuningOffset(interferer_hz);
    station_tuning_phase_increment_ = kTwoPi * station_tuning_offset_hz_ / sample_rate_;
    interferer_tuning_phase_increment_ = kTwoPi * interferer_tuning_offset_hz_ / sample_rate_;
    station_tuning_gain_ = tuningReceptionGain(tuning_hz, station_tuning_offset_hz_,
                                               controls_.txBandwidth * 1000.0, if_cutoff_hz);
    interferer_tuning_gain_ =
        tuningReceptionGain(interferer_hz, interferer_tuning_offset_hz_, 4500.0, if_cutoff_hz);
  }

  [[nodiscard]] double detectorStep(double i, double q) noexcept {
    const double magnitude = std::sqrt(i * i + q * q);
    detector_clipping_ = magnitude < detector_capacitor_ && detector_capacitor_ > magnitude * 1.05;
    const double coefficient =
        magnitude > detector_capacitor_ ? detector_charge_ : detector_release_;
    detector_capacitor_ = magnitude + coefficient * (detector_capacitor_ - magnitude);
    return detector_capacitor_;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::vector<double> delay_{};
  std::vector<double> delay_q_{};
  std::vector<double> transition_delay_{};
  std::vector<double> transition_delay_q_{};
  std::size_t delay_position_ = 0u;
  std::size_t transition_delay_position_ = 0u;
  std::size_t delay1_samples_ = 0u;
  std::size_t delay2_samples_ = 0u;
  std::uint64_t sample_counter_ = 0u;
  std::uint32_t control_remaining_ = 0u;
  double control_smoothing_ = 0.0;
  Controls controls_{};
  Biquad tx_high_pass_{};
  Biquad tx_difference_high_pass_{};
  double pre_emphasis_pole_ = 0.0;
  double pre_emphasis_shelf_gain_ = 0.0;
  double pre_emphasis_low_ = 0.0;
  double difference_pre_emphasis_low_ = 0.0;
  double limiter_attack_coefficient_ = 0.0;
  double limiter_release_coefficient_ = 0.0;
  double limiter_threshold_ = 1.0;
  double limiter_depth_ = 0.0;
  double limiter_envelope_ = 0.0;
  double limiter_gain_ = 1.0;
  double modulation_ = 0.0;
  std::array<Biquad, 2u> tx_interp_{};
  std::array<Biquad, 4u> tx_filters_{};
  std::array<Biquad, 2u> tx_difference_interp_{};
  std::array<Biquad, 4u> tx_difference_filters_{};
  std::vector<double> cquam_mask_coefficients_{};
  std::vector<double> cquam_mask_i_{};
  std::vector<double> cquam_mask_q_{};
  std::size_t cquam_mask_taps_ = 0u;
  std::size_t cquam_mask_position_ = 0u;
  bool cquam_mask_supported_ = false;
  bool cquam_mask_designed_ = false;
  std::uint64_t cquam_oversampled_counter_ = 0u;
  double cquam_tan_internal_phase_limit_ = 0.0;
  FadeTap fade1_{};
  FadeTap fade2_{};
  double ground_gain_ = 1.0;
  double sky_gain_ = 0.0;
  double signal_gain_ = 1.0;
  std::array<Biquad, 2u> interferer_filters_{};
  double interferer_program_ = 0.0;
  double interferer_program_normalizer_ = 1.0;
  double interferer_gain_ = 0.0;
  double interferer_phase_ = 0.0;
  double tuning_phase_ = 0.0;
  double station_tuning_offset_hz_ = 0.0;
  double interferer_tuning_offset_hz_ = 0.0;
  double station_tuning_phase_increment_ = 0.0;
  double interferer_tuning_phase_increment_ = 0.0;
  double station_tuning_gain_ = 1.0;
  double interferer_tuning_gain_ = 1.0;
  double thermal_noise_std_ = 0.0;
  double static_probability_ = 0.0;
  std::uint32_t static_random_state_ = kStaticZeroFallback;
  double static_next_event_deadline_seconds_ = -1.0;
  double static_scheduled_rate_ = 0.0;
  bool static_schedule_active_ = false;
  double hum_phase_ = 0.0;
  double hum_amount_ = 0.0;
  double hum_phase_increment_ = 0.0;
  std::array<Biquad, 3u> if_i_{};
  std::array<Biquad, 3u> if_q_{};
  std::array<Biquad, 3u> transition_if_i_{};
  std::array<Biquad, 3u> transition_if_q_{};
  std::array<Biquad, 3u> detector_interp_i_{};
  std::array<Biquad, 3u> detector_interp_q_{};
  std::array<Biquad, 2u> detector_decimation_{};
  double detector_capacitor_ = 0.0;
  double detector_charge_ = 0.0;
  double detector_release_ = 0.0;
  bool detector_clipping_ = false;
  double agc_detector_stage1_ = 1.0;
  double agc_detector_stage2_ = 1.0;
  double agc_detector_attack_coefficient_ = 0.0;
  double agc_detector_release_coefficient_ = 0.0;
  double agc_gain_db_ = 0.0;
  double agc_linear_gain_ = 1.0;
  double inverse_agc_linear_gain_ = 1.0;
  double transition_agc_detector_stage1_ = 1.0;
  double transition_agc_detector_stage2_ = 1.0;
  double transition_agc_gain_db_ = 0.0;
  double transition_agc_linear_gain_ = 1.0;
  double transition_inverse_agc_linear_gain_ = 1.0;
  double dc_previous_input_ = 0.0;
  double dc_previous_output_ = 0.0;
  double dc_coefficient_ = 0.0;
  std::array<Biquad, 3u> cquam_interp_i_{};
  std::array<Biquad, 3u> cquam_interp_q_{};
  std::array<Biquad, 2u> cquam_sum_decimation_{};
  std::array<Biquad, 2u> cquam_difference_decimation_{};
  double cquam_interpolator_delay_host_samples_ = 0.0;
  double cquam_pll_phase_ = 0.0;
  double cquam_pll_frequency_ = 0.0;
  double cquam_pll_frequency_limit_ = 0.0;
  double cquam_pll_total_frequency_hz_ = 0.0;
  bool cquam_pll_total_frequency_valid_ = false;
  double cquam_pll_total_frequency_alpha_ = 0.0;
  std::uint32_t cquam_pll_frequency_warmup_samples_ = 0u;
  std::uint32_t cquam_pll_frequency_warmup_remaining_ = 0u;
  double cquam_pll_previous_i_ = 0.0;
  double cquam_pll_previous_q_ = 0.0;
  bool cquam_pll_previous_valid_ = false;
  double cquam_pll_residual_frequency_hz_ = 0.0;
  int cquam_pll_state_ = kPllCapture;
  std::uint32_t cquam_pll_qualify_hold_ = 0u;
  std::uint32_t cquam_pll_outside_hold_ = 0u;
  std::uint32_t cquam_pll_pilot_loss_hold_ = 0u;
  std::uint32_t cquam_pll_outside_samples_ = 1u;
  std::uint32_t cquam_pll_pilot_loss_samples_ = 1u;
  std::vector<double> cquam_pll_frequency_history_{};
  std::size_t cquam_pll_history_position_ = 0u;
  double cquam_pll_corrected_phase_ = 0.0;
  Biquad cquam_pilot_band_pass_{};
  double cquam_pilot_level_ = 0.0;
  double cquam_pilot_level_alpha_ = 0.0;
  double cquam_nominal_pilot_at_agc_target_ = 0.0;
  bool cquam_pilot_detected_ = false;
  double cquam_blend_ = 0.0;
  double quality_term_ = 1.0;
  Biquad quality_pilot_band_pass_{};
  double quality_sum_strength_ = 0.0;
  double quality_pilot_strength_ = 0.0;
  double quality_sum_reference_ = 0.0;
  double quality_pilot_reference_ = 0.0;
  double quality_detected_sum_ = 0.0;
  double quality_pilot_power_sum_ = 0.0;
  std::uint32_t quality_detected_count_ = 0u;
  std::uint32_t quality_window_samples_ = 1u;
  bool quality_observation_valid_ = false;
  double quality_strength_alpha_ = 0.0;
  double quality_pilot_strength_alpha_ = 0.0;
  double quality_reference_rise_alpha_ = 0.0;
  double quality_reference_fall_alpha_ = 0.0;
  double cquam_blend_alpha_ = 0.0;
  Biquad cquam_left_pilot_notch_{};
  Biquad cquam_right_pilot_notch_{};
  double cquam_dc_left_input_ = 0.0;
  double cquam_dc_left_output_ = 0.0;
  double cquam_dc_right_input_ = 0.0;
  double cquam_dc_right_output_ = 0.0;
  double cquam_decoded_left_ = 0.0;
  double cquam_decoded_right_ = 0.0;
  double last_if_envelope_ = 0.0;
  double transition_last_if_envelope_ = 0.0;
  Biquad speaker_high_pass_{};
  Biquad speaker_peak_{};
  Biquad speaker_low_pass_{};
  Biquad next_speaker_high_pass_{};
  Biquad next_speaker_peak_{};
  Biquad next_speaker_low_pass_{};
  Biquad cquam_speaker_high_pass_left_{};
  Biquad cquam_speaker_peak_left_{};
  Biquad cquam_speaker_low_pass_left_{};
  Biquad cquam_speaker_high_pass_right_{};
  Biquad cquam_speaker_peak_right_{};
  Biquad cquam_speaker_low_pass_right_{};
  Biquad next_cquam_speaker_high_pass_left_{};
  Biquad next_cquam_speaker_peak_left_{};
  Biquad next_cquam_speaker_low_pass_left_{};
  Biquad next_cquam_speaker_high_pass_right_{};
  Biquad next_cquam_speaker_peak_right_{};
  Biquad next_cquam_speaker_low_pass_right_{};
  double cquam_speaker_output_left_ = 0.0;
  double cquam_speaker_output_right_ = 0.0;
  double output_gain_ = 1.0;
  double mix_ = 1.0;
  double dry_mix_ = 0.0;
  double carrier_pre_agc_db_ = -20.0;
  double transition_carrier_pre_agc_db_ = -20.0;
  double mod_percent_ = 0.0;
  double fade_db_ = 0.0;
  std::uint32_t static_count_ = 0u;
  std::uint32_t clip_count_ = 0u;
  bool clip_active_ = false;
  double stereo_blend_ = 0.0;
  bool telemetry_available_ = false;
  bool initialized_ = false;
  std::uint32_t pair_channels_ = 0u;
  int stereo_mode_ = kMonoMode;
  int previous_stereo_mode_ = kNoPreviousMode;
  std::uint32_t mode_transition_total_ = 0u;
  std::uint32_t mode_transition_position_ = 0u;
  int speaker_ = -1;
  int speaker_target_ = -1;
  std::uint32_t speaker_transition_total_ = 0u;
  std::uint32_t speaker_transition_remaining_ = 0u;
  int cquam_speaker_ = -1;
  int cquam_speaker_target_ = -1;
  std::uint32_t cquam_speaker_transition_total_ = 0u;
  std::uint32_t cquam_speaker_transition_remaining_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  std::uint32_t base_random_state_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t random_state_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  bool gaussian_has_spare_ = false;
  double gaussian_spare_ = 0.0;
};

static_assert(sizeof(AMRadioSimulatorKernel) <= 8192u);

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(AMRadioSimulatorPlugin, effetune::plugins::lofi::AMRadioSimulatorKernel)

extern "C" double et_am_debug_interferer_program_power(effetune::PluginKernel *kernel,
                                                       double frequency) noexcept {
  return static_cast<effetune::plugins::lofi::AMRadioSimulatorKernel *>(kernel)
      ->debugInterfererProgramPower(frequency);
}

extern "C" double et_am_debug_tuning_reception_gain(effetune::PluginKernel *kernel,
                                                    double offset_hz, double program_bandwidth_hz,
                                                    double if_bandwidth_hz) noexcept {
  return static_cast<effetune::plugins::lofi::AMRadioSimulatorKernel *>(kernel)
      ->debugTuningReceptionGain(offset_hz, program_bandwidth_hz, if_bandwidth_hz);
}

extern "C" double et_am_debug_modeled_tuning_offset(effetune::PluginKernel *kernel,
                                                    double offset_hz) noexcept {
  return static_cast<effetune::plugins::lofi::AMRadioSimulatorKernel *>(kernel)
      ->debugModeledTuningOffset(offset_hz);
}

extern "C" double et_am_debug_delay_q_checksum(effetune::PluginKernel *kernel) noexcept {
  return static_cast<effetune::plugins::lofi::AMRadioSimulatorKernel *>(kernel)
      ->debugDelayQChecksum();
}
