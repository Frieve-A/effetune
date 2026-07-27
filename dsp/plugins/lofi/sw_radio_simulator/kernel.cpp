#include "effetune/kernel.h"
#include "SWRadioSimulatorPluginParams.h"
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
constexpr double kTransitionTime = 0.020;
constexpr double kMaximumDigitalTuningHz = 15000.0;
constexpr std::uint32_t kStaticRandomSalt = 0xa511e9b3u;
constexpr std::uint32_t kStaticZeroFallback = 0xeffe7a5eu;
constexpr double kStaticCarrierAreaSeconds = 20.0e-6;
// The salted static stream starts from a low-entropy neighbour of the base seed; 16 idle
// xorshift draws decorrelate it before the first Poisson interval is drawn.
constexpr std::uint32_t kStaticRandomWarmupDraws = 16u;
// One-sided ENBW of the complex-baseband IF cascade - the 6th-order Butterworth low-pass that
// runs on each quadrature - measured as 3033.599 Hz at a 3000 Hz cutoff (a 6 kHz IF bandwidth)
// and 96 kHz. It is neither the AM default nor the shortwave default bandwidth. The ENBW is
// proportional to the cutoff, so the same measurement also sizes the in-band noise the AGC is
// seeded with.
constexpr double kIfCascadeEnbwRatio = 3033.599 / 3000.0;
// Modulation depth of the co-channel interferer, whose programme is a 4.5 kHz shaped
// unit-variance noise. The sidebands it produces are what the IF still passes once the
// interferer carrier itself sits outside the passband.
constexpr double kInterfererModulationDepth = 0.35;
// Per-quadrature thermal noise density, calibrated against that ENBW.
constexpr double kThermalNoiseCalibration = 0.9944467442996018;
// Ionospheric tap geometry: tau1 = 0.4375*ds, tau2 = tau1 + ds. ITU-R F.1487 defines ds as the
// differential delay between the two sky modes; the 0.4375 ratio reproduces the shipped AM
// geometry (0.7 ms / 2.3 ms) exactly at ds = 1.6 ms.
constexpr double kSkyFirstDelayRatio = 0.4375;
constexpr double kMaximumDelaySpreadSeconds = 0.008;
constexpr double kMinimumIfCutoffHz = 1000.0;
constexpr double kSyncPllCaptureNaturalHz = 60.0;
constexpr double kSyncPllTrackNaturalHz = 1.5;
constexpr double kSyncPllCaptureDamping = 0.7;
constexpr double kSyncPllTrackDamping = 1.0;
constexpr double kSyncPllFrequencyLimitHz = 1000.0;
constexpr double kSyncPllTotalFrequencyTau = 0.200;
constexpr double kSyncPllQualifySeconds = 0.100;
constexpr double kSyncPllOutsideSeconds = 0.200;
constexpr double kSyncPllQualifyDeltaHz = 5.0;
constexpr double kSyncPllQualifyResidualHz = 5.0;
constexpr double kSyncPllInsideRatio = 0.96;
constexpr double kSyncPllOutsideRatio = 1.04;
constexpr double kSyncEpsilonAbsolute = 1.0e-6;
constexpr std::uint16_t kTelemetryFrameType = 18u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::size_t kTelemetryPayloadBytes = 24u;
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

// The five sub-sample detector phases share one interpolation/decimation chain. Two instances
// exist so the 20 ms detector crossfade can run both detectors from the same IF stream.
struct DetectorChain final {
  std::array<Biquad, 3u> interpI{};
  std::array<Biquad, 3u> interpQ{};
  std::array<Biquad, 2u> decimation{};
  double capacitor = 0.0;
  bool clipping = false;
};

struct Controls final {
  double txBandwidth = 4.5;
  double preEmphasis = 50.0;
  double modDepth = 90.0;
  double compression = 6.0;
  double signal = -15.0;
  double skywave = 70.0;
  double fadingSpeed = 0.5;
  double delaySpread = 2.0;
  double interference = -35.0;
  double interferenceOffset = 1.0;
  double tuning = 0.0;
  double ifBandwidth = 5.0;
  double detectorRc = 50.0;
  double hum = -70.0;
  double outputGain = 0.0;
  double mix = 100.0;
  double humFrequency = 50.0;
};

} // namespace

class SWRadioSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::SWRadioSimulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    initializeSampleRateCoefficients();
    // Worst-case ionospheric geometry: tau2 = (1 + kSkyFirstDelayRatio) * ds_max.
    const double required =
        std::ceil(sample_rate_ * (1.0 + kSkyFirstDelayRatio) * kMaximumDelaySpreadSeconds) + 4.0;
    delay_.resize(required > 4.0 ? static_cast<std::size_t>(required) : 4u);
    sync_pll_frequency_warmup_samples_ = syncWarmupSamples();
    const double qualify_samples = std::round(sample_rate_ * kSyncPllQualifySeconds);
    sync_pll_frequency_history_.resize(
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
    int detector = static_cast<int>(params_.detector + 0.5F);
    if (detector < 0) {
      detector = 0;
    } else if (detector > 1) {
      detector = 1;
    }
    if (!initialized_ || pair_channels != pair_channels_) {
      resetSimulation(pair_channels, speaker, detector);
    } else {
      if (speaker_transition_remaining_ == 0u && speaker != speaker_) {
        startSpeakerTransition(speaker);
      }
      if (detector_transition_remaining_ == 0u && detector != detector_) {
        startDetectorTransition(detector);
      }
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

      const double high_passed = tx_high_pass_.process(mono);
      pre_emphasis_low_ =
          pre_emphasis_pole_ * pre_emphasis_low_ + (1.0 - pre_emphasis_pole_) * high_passed;
      const double emphasized =
          high_passed + pre_emphasis_shelf_gain_ * (high_passed - pre_emphasis_low_);
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

      double tx = 0.0;
      for (std::size_t phase = 0u; phase < 3u; ++phase) {
        const double interpolated = processBank(tx_interp_, phase == 0u ? compressed * 3.0 : 0.0);
        tx = processBank(tx_filters_, asymmetricLimit(interpolated));
      }
      const double transmitted = 1.0 + modulation_ * tx;
      const double absolute_tx = tx < 0.0 ? -tx : tx;
      const double modulation_deviation = absolute_tx * modulation_ * 100.0;
      if (modulation_deviation > block_mod_peak) {
        block_mod_peak = modulation_deviation;
      }

      delay_[delay_position_] = transmitted;
      const std::size_t size = delay_.size();
      const std::size_t position1 = delay_position_ >= delay1_samples_
                                        ? delay_position_ - delay1_samples_
                                        : size + delay_position_ - delay1_samples_;
      const std::size_t position2 = delay_position_ >= delay2_samples_
                                        ? delay_position_ - delay2_samples_
                                        : size + delay_position_ - delay2_samples_;
      const double delayed1 = delay_[position1];
      const double delayed2 = delay_[position2];
      ++delay_position_;
      if (delay_position_ == size) {
        delay_position_ = 0u;
      }
      const double station_i =
          signal_gain_ *
          (ground_gain_ * transmitted + sky_gain_ * (fade1_.i * delayed1 + fade2_.i * delayed2));
      const double station_q =
          signal_gain_ * sky_gain_ * (fade1_.q * delayed1 + fade2_.q * delayed2);

      const double tuning_cosine = std::cos(tuning_phase_);
      const double tuning_sine = std::sin(tuning_phase_);
      advancePhase(tuning_phase_, station_tuning_phase_increment_);

      interferer_program_ =
          processBank(interferer_filters_, gaussian()) * interferer_program_normalizer_;
      const double interferer_envelope = interferer_tuning_gain_ * interferer_gain_ *
                                         (1.0 + kInterfererModulationDepth * interferer_program_);
      const double interferer_i = interferer_envelope * std::cos(interferer_phase_);
      const double interferer_q = interferer_envelope * std::sin(interferer_phase_);
      advancePhase(interferer_phase_, interferer_tuning_phase_increment_);

      const double thermal_i = gaussian() * thermal_noise_std_;
      const double thermal_q = gaussian() * thermal_noise_std_;

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

      double i = station_tuning_gain_ * (station_i * tuning_cosine - station_q * tuning_sine);
      double q = station_tuning_gain_ * (station_i * tuning_sine + station_q * tuning_cosine);
      i += interferer_i + thermal_i;
      q += interferer_q + thermal_q;
      if (static_event) {
        i += static_i;
        q += static_q;
      }
      const double radio_gain = agc_linear_gain_ * (1.0 + hum_amount_ * hum);
      const double if_output_i = processBank(if_i_, i * radio_gain);
      const double if_output_q = processBank(if_q_, q * radio_gain);
      const double if_envelope = std::sqrt(if_output_i * if_output_i + if_output_q * if_output_q);
      const double pre_agc_magnitude = if_envelope * inverse_agc_linear_gain_;
      agc_detector_stage1_ +=
          agc_detector_attack_coefficient_ * (pre_agc_magnitude - agc_detector_stage1_);
      const double stage2_coefficient = agc_detector_stage1_ > agc_detector_stage2_
                                            ? agc_detector_attack_coefficient_
                                            : agc_detector_release_coefficient_;
      agc_detector_stage2_ += stage2_coefficient * (agc_detector_stage1_ - agc_detector_stage2_);
      last_if_envelope_ = if_envelope;

      const bool detector_transitioning = detector_transition_remaining_ > 0u;
      if (detector_ == kSynchronousDetector ||
          (detector_transitioning && detector_target_ == kSynchronousDetector)) {
        stepSyncPll(if_output_i, if_output_q);
      }
      double detected = runDetector(detector_, detector_primary_, if_output_i, if_output_q);
      bool detector_clipping = detector_primary_.clipping;
      if (detector_transitioning) {
        const double next_detected =
            runDetector(detector_target_, detector_secondary_, if_output_i, if_output_q);
        const double progress =
            static_cast<double>(detector_transition_total_ - detector_transition_remaining_) /
            static_cast<double>(detector_transition_total_);
        const double blend = 0.5 - 0.5 * std::cos(kPi * progress);
        detected += blend * (next_detected - detected);
        detector_clipping = detector_clipping || detector_secondary_.clipping;
        --detector_transition_remaining_;
        if (detector_transition_remaining_ == 0u) {
          std::swap(detector_primary_, detector_secondary_);
          detector_ = detector_target_;
        }
      }

      const double receiver_audio =
          detected - dc_previous_input_ + dc_coefficient_ * dc_previous_output_;
      dc_previous_input_ = detected;
      dc_previous_output_ = receiver_audio;
      double wet = (receiver_audio + hum_amount_ * 0.2 * hum) * 1.4142135623730951;
      const double current_speaker_wet =
          processSpeakerPath(speaker_, speaker_high_pass_, speaker_peak_, speaker_low_pass_, wet);
      if (speaker_transition_remaining_ > 0u) {
        const double next_speaker_wet =
            processSpeakerPath(speaker_target_, next_speaker_high_pass_, next_speaker_peak_,
                               next_speaker_low_pass_, wet);
        const double progress =
            static_cast<double>(speaker_transition_total_ - speaker_transition_remaining_) /
            static_cast<double>(speaker_transition_total_);
        const double blend = 0.5 - 0.5 * std::cos(kPi * progress);
        wet = current_speaker_wet + blend * (next_speaker_wet - current_speaker_wet);
        --speaker_transition_remaining_;
        if (speaker_transition_remaining_ == 0u) {
          std::swap(speaker_high_pass_, next_speaker_high_pass_);
          std::swap(speaker_peak_, next_speaker_peak_);
          std::swap(speaker_low_pass_, next_speaker_low_pass_);
          speaker_ = speaker_target_;
        }
      } else {
        wet = current_speaker_wet;
      }
      wet *= output_gain_;

      audio[left_index] = static_cast<float>(dry_mix_ * input_left + mix_ * wet);
      if (pair_channels == 2u) {
        audio[right_index] = static_cast<float>(dry_mix_ * input_right + mix_ * wet);
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
      // Negative-peak (over-modulation) clipping is detector independent; the diagonal clipping
      // term only exists in the envelope detector.
      const bool clip_now = transmitted < 0.0 || detector_clipping;
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
    writeU32(payload.data() + 16u, static_count_);
    writeU32(payload.data() + 20u, clip_count_);
    writer.write(kTelemetryFrameType, kTelemetryVersion, payload.data(),
                 static_cast<std::uint16_t>(payload.size()));
  }

  [[nodiscard]] double debugInterfererProgramPower(double frequency) const noexcept {
    const double omega = kTwoPi * frequency / sample_rate_;
    return bankResponsePower(interferer_filters_, omega);
  }

  [[nodiscard]] double debugDelayCapacity() const noexcept {
    return static_cast<double>(delay_.size());
  }

  [[nodiscard]] double debugDelayTap(int index) const noexcept {
    return static_cast<double>(index == 0 ? delay1_samples_ : delay2_samples_);
  }

  [[nodiscard]] double debugSyncPllState() const noexcept {
    return static_cast<double>(sync_pll_state_);
  }

  [[nodiscard]] double debugSyncPllFrequencyHz() const noexcept {
    return sync_pll_frequency_ * sample_rate_ / kTwoPi;
  }

private:
  static constexpr int kEnvelopeDetector = 0;
  static constexpr int kSynchronousDetector = 1;
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

  // The synchronous detector only needs the IF cascade to settle; there is no transmit-side
  // mask in the SW chain, so the warm-up is the pole-decay time of the narrowest IF setting.
  [[nodiscard]] std::uint32_t syncWarmupSamples() const noexcept {
    double maximum_pole_radius = 0.0;
    for (double q : kButterworth6Q) {
      Biquad filter;
      filter.configureLowPass(kMinimumIfCutoffHz, q, sample_rate_);
      const double pole_radius = std::sqrt(filter.a2 > 0.0 ? filter.a2 : 0.0);
      if (pole_radius > maximum_pole_radius) {
        maximum_pole_radius = pole_radius;
      }
    }
    const double settling_samples =
        maximum_pole_radius > 0.0 && maximum_pole_radius < 1.0
            ? std::ceil(std::log(kSyncEpsilonAbsolute) / std::log(maximum_pole_radius))
            : 0.0;
    return static_cast<std::uint32_t>(settling_samples);
  }

  void deriveBaseRandomState() noexcept {
    dsp::XorShiftRng master(selected_seed_low_, selected_seed_high_);
    base_random_state_ = static_cast<std::uint32_t>(master.nextU64() >> 32u);
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
    for (std::uint32_t index = 0u; index < kStaticRandomWarmupDraws; ++index) {
      static_cast<void>(nextStaticRandom());
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
    sync_pll_frequency_limit_ = kTwoPi * kSyncPllFrequencyLimitHz / sample_rate_;
    sync_pll_total_frequency_alpha_ =
        1.0 - std::exp(-1.0 / (sample_rate_ * kSyncPllTotalFrequencyTau));
    const double outside_samples = std::round(sample_rate_ * kSyncPllOutsideSeconds);
    sync_pll_outside_samples_ =
        outside_samples >= 1.0 ? static_cast<std::uint32_t>(outside_samples) : 1u;
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

  void resetSimulation(std::uint32_t pair_channels, int speaker, int detector) noexcept {
    std::fill(delay_.begin(), delay_.end(), 0.0);
    delay_position_ = 0u;
    sample_counter_ = 0u;
    control_remaining_ = 0u;
    controls_ = {
        static_cast<double>(params_.txBandwidth),  static_cast<double>(params_.preEmphasis),
        static_cast<double>(params_.modDepth),     static_cast<double>(params_.compression),
        static_cast<double>(params_.signal),       static_cast<double>(params_.skywave),
        static_cast<double>(params_.fadingSpeed),  static_cast<double>(params_.delaySpread),
        static_cast<double>(params_.interference), static_cast<double>(params_.interferenceOffset),
        static_cast<double>(params_.tuning),       static_cast<double>(params_.ifBandwidth),
        static_cast<double>(params_.detectorRc),   static_cast<double>(params_.hum),
        static_cast<double>(params_.outputGain),   static_cast<double>(params_.mix),
        params_.humFrequency < 0.5F ? 50.0 : 60.0};
    updateTuningModel();
    updateDelayGeometry();
    random_state_ = base_random_state_;
    resetStaticRandomState();
    gaussian_has_spare_ = false;
    gaussian_spare_ = 0.0;
    pre_emphasis_low_ = 0.0;
    limiter_envelope_ = 0.0;
    limiter_gain_ = 1.0;
    const double initial_fade_pole = fadeFilterPole();
    const double initial_fade_normalizer = fadeTapNormalizer(initial_fade_pole);
    seedFadeTap(fade1_, initial_fade_pole, initial_fade_normalizer);
    seedFadeTap(fade2_, initial_fade_pole, initial_fade_normalizer);
    interferer_program_ = 0.0;
    interferer_phase_ = 0.0;
    tuning_phase_ = 0.0;
    hum_phase_ = 0.0;
    configureBank(interferer_filters_, 4500.0, kButterworth4Q, sample_rate_);
    interferer_program_normalizer_ = bankNoiseNormalizer(interferer_filters_);
    // AGC cold start from the stationary expectation of the pre-AGC IF magnitude. Ground wave
    // and sky wave form an equal-power mixture by construction (ground^2 + sky^2 = 1 with
    // E[|tap|^2] = 1 per mode), so the propagation factor is unity whatever the skywave share;
    // the co-channel station and the in-band noise then add in RSS.
    const double initial_if_cutoff_hz = controls_.ifBandwidth * 500.0;
    const double initial_station_offset_hz =
        station_tuning_offset_hz_ < 0.0 ? -station_tuning_offset_hz_ : station_tuning_offset_hz_;
    const double initial_interferer_offset_hz = interferer_tuning_offset_hz_ < 0.0
                                                    ? -interferer_tuning_offset_hz_
                                                    : interferer_tuning_offset_hz_;
    const double initial_station =
        std::pow(10.0, controls_.signal / 20.0) * station_tuning_gain_ *
        butterworth6Magnitude(initial_station_offset_hz, initial_if_cutoff_hz);
    const double initial_interferer_level =
        std::pow(10.0, controls_.interference / 20.0) * interferer_tuning_gain_;
    const double initial_interferer_carrier =
        initial_interferer_level *
        butterworth6Magnitude(initial_interferer_offset_hz, initial_if_cutoff_hz);
    // The interferer is an AM station, not a bare carrier: its programme sidebands sit around
    // the offset and are 4.5 kHz wide, so once the offset moves the carrier out of the IF the
    // sidebands are what the receiver still hears. Their two-sided density is not flat across
    // the IF passband - across a wide IF the 4th-order programme shaping makes the density
    // itself vary by ~40 dB at 96 kHz (~51 dB at 48 kHz), and a single sample taken at the
    // offset then underestimates the passband average by up to ~17 dB at 96 kHz. The density
    // that multiplies the complex IF noise bandwidth is therefore approximated numerically as
    // the power mean of five samples spanning that bandwidth, at the offset and at +/-B/2 and
    // +/-B with B = ENBW ratio * IF cutoff. The programme filter is real, so a probe that
    // crosses zero folds back onto its mirror frequency.
    const double initial_sideband_span_hz = kIfCascadeEnbwRatio * initial_if_cutoff_hz;
    double initial_sideband_power = 0.0;
    for (int probe = -2; probe <= 2; ++probe) {
      const double probe_hz = initial_interferer_offset_hz +
                              static_cast<double>(probe) * 0.5 * initial_sideband_span_hz;
      const double folded_hz = probe_hz < 0.0 ? -probe_hz : probe_hz;
      initial_sideband_power +=
          bankResponsePower(interferer_filters_, kTwoPi * folded_hz / sample_rate_);
    }
    initial_sideband_power *= 0.2;
    const double initial_interferer_sideband_density =
        kInterfererModulationDepth * initial_interferer_level * interferer_program_normalizer_ *
        std::sqrt(initial_sideband_power);
    const double initial_interferer_sideband =
        initial_interferer_sideband_density *
        std::sqrt(2.0 * kIfCascadeEnbwRatio * initial_if_cutoff_hz / sample_rate_);
    const double initial_interferer =
        std::sqrt(initial_interferer_carrier * initial_interferer_carrier +
                  initial_interferer_sideband * initial_interferer_sideband);
    // Both quadratures carry the shaped thermal noise, so the magnitude the carrier detector
    // sees is sqrt(2) above the per-quadrature RMS the IF cascade passes.
    const double initial_noise =
        thermal_noise_std_ *
        std::sqrt(4.0 * kIfCascadeEnbwRatio * initial_if_cutoff_hz / sample_rate_);
    double initial_carrier =
        std::sqrt(initial_station * initial_station + initial_interferer * initial_interferer +
                  initial_noise * initial_noise);
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
    resetBank(tx_interp_);
    resetBank(tx_filters_);
    configureBank(tx_interp_, 14000.0, kButterworth4Q, sample_rate_ * 3.0);
    configureBank(tx_filters_, controls_.txBandwidth * 1000.0, kButterworth8Q, sample_rate_ * 3.0);
    resetBank(if_i_);
    resetBank(if_q_);
    configureBank(if_i_, controls_.ifBandwidth * 500.0, kButterworth6Q, sample_rate_);
    configureBank(if_q_, controls_.ifBandwidth * 500.0, kButterworth6Q, sample_rate_);
    resetBank(interferer_filters_);
    configureDetectorChain(detector_primary_);
    configureDetectorChain(detector_secondary_);
    interpolator_delay_host_samples_ = filterGroupDelayAtDc(detector_primary_.interpI) / 5.0;
    resetSyncPll();
    last_if_envelope_ = 0.0;
    updateDetectorCoefficients();
    configureSpeakerPath(speaker, speaker_high_pass_, speaker_peak_, speaker_low_pass_);
    next_speaker_high_pass_ = {};
    next_speaker_peak_ = {};
    next_speaker_low_pass_ = {};
    speaker_target_ = speaker;
    speaker_transition_total_ = 0u;
    speaker_transition_remaining_ = 0u;
    detector_ = detector;
    detector_target_ = detector;
    detector_transition_total_ = 0u;
    detector_transition_remaining_ = 0u;
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

  [[nodiscard]] std::uint32_t transitionSamples() const noexcept {
    const double samples = std::floor(sample_rate_ * kTransitionTime + 0.5);
    return samples >= 1.0 ? static_cast<std::uint32_t>(samples) : 1u;
  }

  void startSpeakerTransition(int speaker) noexcept {
    configureSpeakerPath(speaker, next_speaker_high_pass_, next_speaker_peak_,
                         next_speaker_low_pass_);
    speaker_target_ = speaker;
    speaker_transition_total_ = transitionSamples();
    speaker_transition_remaining_ = speaker_transition_total_;
  }

  // Engaging the synchronous detector restarts carrier acquisition, exactly as a real receiver
  // does; the 20 ms crossfade only covers the detector level step.
  void startDetectorTransition(int detector) noexcept {
    configureDetectorChain(detector_secondary_);
    if (detector == kEnvelopeDetector) {
      detector_secondary_.capacitor = std::isfinite(last_if_envelope_) ? last_if_envelope_ : 0.0;
    } else {
      resetSyncPll();
    }
    detector_target_ = detector;
    detector_transition_total_ = transitionSamples();
    detector_transition_remaining_ = detector_transition_total_;
  }

  void configureDetectorChain(DetectorChain &chain) noexcept {
    configureBank(chain.interpI, 14000.0, kButterworth6Q, sample_rate_ * 5.0);
    configureBank(chain.interpQ, 14000.0, kButterworth6Q, sample_rate_ * 5.0);
    configureBank(chain.decimation, 10000.0, kButterworth4Q, sample_rate_ * 5.0);
    resetBank(chain.interpI);
    resetBank(chain.interpQ);
    resetBank(chain.decimation);
    chain.capacitor = 0.0;
    chain.clipping = false;
  }

  void resetSyncPll() noexcept {
    sync_pll_phase_ = 0.0;
    sync_pll_frequency_ = 0.0;
    sync_pll_corrected_phase_ = 0.0;
    sync_pll_total_frequency_hz_ = 0.0;
    sync_pll_total_frequency_valid_ = false;
    sync_pll_frequency_warmup_remaining_ = sync_pll_frequency_warmup_samples_;
    sync_pll_previous_i_ = 0.0;
    sync_pll_previous_q_ = 0.0;
    sync_pll_previous_valid_ = false;
    sync_pll_residual_frequency_hz_ = 0.0;
    sync_pll_state_ = kPllCapture;
    sync_pll_qualify_hold_ = 0u;
    sync_pll_outside_hold_ = 0u;
    sync_pll_history_position_ = 0u;
    std::fill(sync_pll_frequency_history_.begin(), sync_pll_frequency_history_.end(), 0.0);
  }

  void stepSyncPll(double i, double q) noexcept {
    const double magnitude = std::sqrt(i * i + q * q);
    const bool valid = magnitude >= kSyncEpsilonAbsolute;
    if (sync_pll_frequency_warmup_remaining_ > 0u) {
      --sync_pll_frequency_warmup_remaining_;
      sync_pll_previous_valid_ = false;
    } else {
      if (valid && sync_pll_previous_valid_) {
        const double product_real = i * sync_pll_previous_i_ + q * sync_pll_previous_q_;
        const double product_imaginary = q * sync_pll_previous_i_ - i * sync_pll_previous_q_;
        const double instantaneous_hz =
            std::atan2(product_imaginary, product_real) * sample_rate_ / kTwoPi;
        if (!sync_pll_total_frequency_valid_) {
          sync_pll_total_frequency_hz_ = instantaneous_hz;
          sync_pll_total_frequency_valid_ = true;
        } else {
          sync_pll_total_frequency_hz_ +=
              sync_pll_total_frequency_alpha_ * (instantaneous_hz - sync_pll_total_frequency_hz_);
        }
      }
      sync_pll_previous_i_ = i;
      sync_pll_previous_q_ = q;
      sync_pll_previous_valid_ = valid;
    }

    const double cosine = std::cos(sync_pll_phase_);
    const double sine = std::sin(sync_pll_phase_);
    const double rotated_q = q * cosine - i * sine;
    const double inverse =
        1.0 / (magnitude > kSyncEpsilonAbsolute ? magnitude : kSyncEpsilonAbsolute);
    const double error = rotated_q * inverse;
    const double natural_frequency =
        sync_pll_state_ == kPllTrack ? kSyncPllTrackNaturalHz : kSyncPllCaptureNaturalHz;
    const double damping =
        sync_pll_state_ == kPllTrack ? kSyncPllTrackDamping : kSyncPllCaptureDamping;
    const double normalized = kTwoPi * natural_frequency / sample_rate_;
    double frequency = sync_pll_frequency_ + normalized * normalized * error;
    if (frequency < -sync_pll_frequency_limit_) {
      frequency = -sync_pll_frequency_limit_;
    } else if (frequency > sync_pll_frequency_limit_) {
      frequency = sync_pll_frequency_limit_;
    }
    sync_pll_frequency_ = frequency;
    const double corrected_phase = sync_pll_phase_ + 2.0 * damping * normalized * error;
    sync_pll_phase_ = corrected_phase + frequency;
    if (sync_pll_phase_ >= kTwoPi) {
      sync_pll_phase_ -= kTwoPi;
    } else if (sync_pll_phase_ < 0.0) {
      sync_pll_phase_ += kTwoPi;
    }

    const double estimated_frequency_hz = frequency * sample_rate_ / kTwoPi;
    sync_pll_residual_frequency_hz_ = sync_pll_total_frequency_hz_ - estimated_frequency_hz;
    const double old_frequency_hz = sync_pll_frequency_history_[sync_pll_history_position_];
    sync_pll_frequency_history_[sync_pll_history_position_] = estimated_frequency_hz;
    ++sync_pll_history_position_;
    if (sync_pll_history_position_ == sync_pll_frequency_history_.size()) {
      sync_pll_history_position_ = 0u;
    }
    const double frequency_delta = estimated_frequency_hz - old_frequency_hz;
    const double absolute_frequency_delta =
        frequency_delta < 0.0 ? -frequency_delta : frequency_delta;
    const double absolute_residual = sync_pll_residual_frequency_hz_ < 0.0
                                         ? -sync_pll_residual_frequency_hz_
                                         : sync_pll_residual_frequency_hz_;
    const double absolute_total = sync_pll_total_frequency_hz_ < 0.0 ? -sync_pll_total_frequency_hz_
                                                                     : sync_pll_total_frequency_hz_;
    if (sync_pll_state_ == kPllCapture) {
      const bool eligible = sync_pll_total_frequency_valid_ &&
                            absolute_frequency_delta < kSyncPllQualifyDeltaHz &&
                            absolute_residual < kSyncPllQualifyResidualHz &&
                            absolute_total <= kSyncPllFrequencyLimitHz * kSyncPllInsideRatio;
      sync_pll_qualify_hold_ = eligible ? sync_pll_qualify_hold_ + 1u : 0u;
      if (sync_pll_qualify_hold_ >= sync_pll_frequency_history_.size()) {
        sync_pll_state_ = kPllTrack;
        sync_pll_qualify_hold_ = 0u;
        sync_pll_outside_hold_ = 0u;
      }
    } else {
      sync_pll_outside_hold_ = absolute_total >= kSyncPllFrequencyLimitHz * kSyncPllOutsideRatio
                                   ? sync_pll_outside_hold_ + 1u
                                   : 0u;
      if (sync_pll_outside_hold_ >= sync_pll_outside_samples_) {
        sync_pll_state_ = kPllCapture;
        sync_pll_qualify_hold_ = 0u;
        sync_pll_outside_hold_ = 0u;
      }
    }
    sync_pll_corrected_phase_ = corrected_phase;
  }

  [[nodiscard]] double runDetector(int mode, DetectorChain &chain, double input_i,
                                   double input_q) noexcept {
    double detected = 0.0;
    if (mode == kSynchronousDetector) {
      // One sin/cos pair per host sample; the five sub-sample phases advance by a constant small
      // angle handled with a truncated series (|delta| <= 0.0131 rad at 96 kHz with the 1000 Hz
      // clamp, series error < 1e-12). The JavaScript reference uses this exact recurrence -
      // parity depends on it.
      const double delay_compensation = sync_pll_frequency_ * interpolator_delay_host_samples_;
      const double base = sync_pll_corrected_phase_ - delay_compensation;
      double cosine_used = std::cos(base);
      double sine_used = std::sin(base);
      const double delta = sync_pll_frequency_ * 0.2;
      const double delta_squared = delta * delta;
      const double cosine_step = 1.0 - delta_squared * 0.5 + delta_squared * delta_squared / 24.0;
      const double sine_step =
          delta * (1.0 - delta_squared / 6.0 + delta_squared * delta_squared / 120.0);
      for (std::size_t phase = 0u; phase < 5u; ++phase) {
        const double interpolated_i = processBank(chain.interpI, phase == 0u ? input_i * 5.0 : 0.0);
        const double interpolated_q = processBank(chain.interpQ, phase == 0u ? input_q * 5.0 : 0.0);
        const double rotated_i = interpolated_i * cosine_used + interpolated_q * sine_used;
        detected = processBank(chain.decimation, rotated_i);
        const double next_cosine = cosine_used * cosine_step - sine_used * sine_step;
        sine_used = cosine_used * sine_step + sine_used * cosine_step;
        cosine_used = next_cosine;
      }
      chain.clipping = false;
      return detected;
    }
    for (std::size_t phase = 0u; phase < 5u; ++phase) {
      const double interpolated_i = processBank(chain.interpI, phase == 0u ? input_i * 5.0 : 0.0);
      const double interpolated_q = processBank(chain.interpQ, phase == 0u ? input_q * 5.0 : 0.0);
      const double magnitude =
          std::sqrt(interpolated_i * interpolated_i + interpolated_q * interpolated_q);
      chain.clipping = magnitude < chain.capacitor && chain.capacitor > magnitude * 1.05;
      const double coefficient = magnitude > chain.capacitor ? detector_charge_ : detector_release_;
      chain.capacitor = magnitude + coefficient * (chain.capacitor - magnitude);
      detected = processBank(chain.decimation, chain.capacitor);
    }
    return detected;
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

  [[nodiscard]] double fadeFilterPole() const noexcept {
    const double control_rate = sample_rate_ / static_cast<double>(kControlInterval);
    return std::exp(-kTwoPi * controls_.fadingSpeed / control_rate);
  }

  [[nodiscard]] static double fadeTapNormalizer(double pole) noexcept {
    const double one_minus = 1.0 - pole;
    const double pole_squared = pole * pole;
    const double denominator = 1.0 - pole_squared;
    const double variance_gain = one_minus * one_minus * one_minus * one_minus *
                                 (1.0 + pole_squared) / (denominator * denominator * denominator);
    return variance_gain > 1.0e-20 ? 1.0 / std::sqrt(variance_gain) : 0.0;
  }

  // Cold start for the two-pole Doppler shaping filters. Leaving them at zero would place every
  // sky mode in a simultaneous null, a state no real path presents, and the receiver would then
  // have to chase the recovery from a level the channel never actually delivers. Driven by
  // w ~ N(0, 1/2) the stationary covariance of the pair (x1, x2) is known in closed form, so its
  // Cholesky factor turns two standard normals per quadrature into an exactly settled draw:
  // Rayleigh taps with E[|tap|^2] = 1 at every sample rate, RNG consumption fixed at four draws
  // per tap, and the cost paid once per reset.
  void seedFadeTap(FadeTap &tap, double pole, double normalizer) noexcept {
    const double feed = 1.0 - pole;
    const double denominator = 1.0 - pole * pole;
    const bool usable = denominator > 1.0e-20;
    const double first_scale = usable ? kSqrtHalf * feed / std::sqrt(denominator) : 0.0;
    const double second_scale =
        usable ? kSqrtHalf * feed * feed / (denominator * std::sqrt(denominator)) : 0.0;
    const double inphase_first = gaussian();
    const double inphase_second = gaussian();
    const double quadrature_first = gaussian();
    const double quadrature_second = gaussian();
    tap.i1 = first_scale * inphase_first;
    tap.i2 = second_scale * (inphase_first + pole * inphase_second);
    tap.q1 = first_scale * quadrature_first;
    tap.q2 = second_scale * (quadrature_first + pole * quadrature_second);
    tap.i = tap.i2 * normalizer;
    tap.q = tap.q2 * normalizer;
    tap.stepI = 0.0;
    tap.stepQ = 0.0;
  }

  void updateControl() noexcept {
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
    smooth(controls_.delaySpread, params_.delaySpread);
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
    configureBank(if_i_, controls_.ifBandwidth * 500.0, kButterworth6Q, sample_rate_);
    configureBank(if_q_, controls_.ifBandwidth * 500.0, kButterworth6Q, sample_rate_);
    updateTuningModel();
    updateDetectorCoefficients();
    updateDelayGeometry();

    const double pole = fadeFilterPole();
    const double normalizer = fadeTapNormalizer(pole);
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

  void updateDelayGeometry() noexcept {
    const double spread_seconds = controls_.delaySpread * 1.0e-3;
    const double first = spread_seconds * kSkyFirstDelayRatio;
    const double second = first + spread_seconds;
    delay1_samples_ = static_cast<std::size_t>(std::floor(sample_rate_ * first + 0.5));
    delay2_samples_ = static_cast<std::size_t>(std::floor(sample_rate_ * second + 0.5));
    if (delay2_samples_ >= delay_.size()) {
      delay2_samples_ = delay_.size() - 1u;
    }
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::vector<double> delay_{};
  std::size_t delay_position_ = 0u;
  std::size_t delay1_samples_ = 0u;
  std::size_t delay2_samples_ = 0u;
  std::uint64_t sample_counter_ = 0u;
  std::uint32_t control_remaining_ = 0u;
  double control_smoothing_ = 0.0;
  Controls controls_{};
  Biquad tx_high_pass_{};
  double pre_emphasis_pole_ = 0.0;
  double pre_emphasis_shelf_gain_ = 0.0;
  double pre_emphasis_low_ = 0.0;
  double limiter_attack_coefficient_ = 0.0;
  double limiter_release_coefficient_ = 0.0;
  double limiter_threshold_ = 1.0;
  double limiter_depth_ = 0.0;
  double limiter_envelope_ = 0.0;
  double limiter_gain_ = 1.0;
  double modulation_ = 0.0;
  std::array<Biquad, 2u> tx_interp_{};
  std::array<Biquad, 4u> tx_filters_{};
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
  std::uint32_t static_random_state_ = kStaticZeroFallback;
  double static_next_event_deadline_seconds_ = -1.0;
  double static_scheduled_rate_ = 0.0;
  bool static_schedule_active_ = false;
  double hum_phase_ = 0.0;
  double hum_amount_ = 0.0;
  double hum_phase_increment_ = 0.0;
  std::array<Biquad, 3u> if_i_{};
  std::array<Biquad, 3u> if_q_{};
  DetectorChain detector_primary_{};
  DetectorChain detector_secondary_{};
  double detector_charge_ = 0.0;
  double detector_release_ = 0.0;
  double interpolator_delay_host_samples_ = 0.0;
  double sync_pll_phase_ = 0.0;
  double sync_pll_frequency_ = 0.0;
  double sync_pll_corrected_phase_ = 0.0;
  double sync_pll_frequency_limit_ = 0.0;
  double sync_pll_total_frequency_hz_ = 0.0;
  bool sync_pll_total_frequency_valid_ = false;
  double sync_pll_total_frequency_alpha_ = 0.0;
  std::uint32_t sync_pll_frequency_warmup_samples_ = 0u;
  std::uint32_t sync_pll_frequency_warmup_remaining_ = 0u;
  double sync_pll_previous_i_ = 0.0;
  double sync_pll_previous_q_ = 0.0;
  bool sync_pll_previous_valid_ = false;
  double sync_pll_residual_frequency_hz_ = 0.0;
  int sync_pll_state_ = kPllCapture;
  std::uint32_t sync_pll_qualify_hold_ = 0u;
  std::uint32_t sync_pll_outside_hold_ = 0u;
  std::uint32_t sync_pll_outside_samples_ = 1u;
  std::vector<double> sync_pll_frequency_history_{};
  std::size_t sync_pll_history_position_ = 0u;
  double agc_detector_stage1_ = 1.0;
  double agc_detector_stage2_ = 1.0;
  double agc_detector_attack_coefficient_ = 0.0;
  double agc_detector_release_coefficient_ = 0.0;
  double agc_gain_db_ = 0.0;
  double agc_linear_gain_ = 1.0;
  double inverse_agc_linear_gain_ = 1.0;
  double dc_previous_input_ = 0.0;
  double dc_previous_output_ = 0.0;
  double dc_coefficient_ = 0.0;
  double last_if_envelope_ = 0.0;
  Biquad speaker_high_pass_{};
  Biquad speaker_peak_{};
  Biquad speaker_low_pass_{};
  Biquad next_speaker_high_pass_{};
  Biquad next_speaker_peak_{};
  Biquad next_speaker_low_pass_{};
  double output_gain_ = 1.0;
  double mix_ = 1.0;
  double dry_mix_ = 0.0;
  double carrier_pre_agc_db_ = -20.0;
  double mod_percent_ = 0.0;
  double fade_db_ = 0.0;
  std::uint32_t static_count_ = 0u;
  std::uint32_t clip_count_ = 0u;
  bool clip_active_ = false;
  bool telemetry_available_ = false;
  bool initialized_ = false;
  std::uint32_t pair_channels_ = 0u;
  int speaker_ = -1;
  int speaker_target_ = -1;
  std::uint32_t speaker_transition_total_ = 0u;
  std::uint32_t speaker_transition_remaining_ = 0u;
  int detector_ = kEnvelopeDetector;
  int detector_target_ = kEnvelopeDetector;
  std::uint32_t detector_transition_total_ = 0u;
  std::uint32_t detector_transition_remaining_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  std::uint32_t base_random_state_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t random_state_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  bool gaussian_has_spare_ = false;
  double gaussian_spare_ = 0.0;
};

static_assert(sizeof(SWRadioSimulatorKernel) <= 8192u);

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(SWRadioSimulatorPlugin, effetune::plugins::lofi::SWRadioSimulatorKernel)

extern "C" double et_sw_debug_interferer_program_power(effetune::PluginKernel *kernel,
                                                       double frequency) noexcept {
  return static_cast<effetune::plugins::lofi::SWRadioSimulatorKernel *>(kernel)
      ->debugInterfererProgramPower(frequency);
}

extern "C" double et_sw_debug_delay_capacity(effetune::PluginKernel *kernel) noexcept {
  return static_cast<effetune::plugins::lofi::SWRadioSimulatorKernel *>(kernel)
      ->debugDelayCapacity();
}

extern "C" double et_sw_debug_delay_tap(effetune::PluginKernel *kernel, int index) noexcept {
  return static_cast<effetune::plugins::lofi::SWRadioSimulatorKernel *>(kernel)->debugDelayTap(
      index);
}

extern "C" double et_sw_debug_sync_pll_state(effetune::PluginKernel *kernel) noexcept {
  return static_cast<effetune::plugins::lofi::SWRadioSimulatorKernel *>(kernel)
      ->debugSyncPllState();
}

extern "C" double et_sw_debug_sync_pll_frequency_hz(effetune::PluginKernel *kernel) noexcept {
  return static_cast<effetune::plugins::lofi::SWRadioSimulatorKernel *>(kernel)
      ->debugSyncPllFrequencyHz();
}
