#include "effetune/kernel.h"
#include "DSD64IMDSimulatorPluginParams.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <numbers>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr std::uint32_t kHilbertLength = 127u;
constexpr std::uint32_t kHilbertDelay = 63u;
constexpr std::uint32_t kHilbertTapCount = 64u;
constexpr std::uint32_t kRingLength = 256u;
constexpr std::uint32_t kRingMask = kRingLength - 1u;
constexpr std::uint32_t kPrewarmSamples = 8192u;
constexpr double kMinimumSampleRate = 88200.0;
constexpr double kSqrt2 = 1.4142135623730951;
constexpr double kSqrt3 = 1.7320508075688772;
constexpr double kInverse2Pow31 = 4.656612873077393e-10;
constexpr double kLowPassQ1 = 0.5411961;
constexpr double kLowPassQ2 = 1.3065630;
constexpr std::uint16_t kTelemetryFrameType = 11u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::uint32_t kTelemetryPayloadBytes = 32u;
constexpr std::uint32_t kTelemetryValid = 1u;

struct BiquadCoefficients final {
  double b0 = 0.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
};

void writeU32(std::uint8_t *output, std::uint32_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>((value >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((value >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(value >> 24u);
}

void writeF32(std::uint8_t *output, float value) noexcept {
  std::uint32_t bits = 0u;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&bits, &value, sizeof(bits));
  writeU32(output, bits);
}

} // namespace

class DSD64IMDSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::DSD64IMDSimulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;

    const std::size_t channels = max_channels_;
    buf_u_.resize(channels * kRingLength);
    buf_x_audio_.resize(channels * kRingLength);
    buf_x_raw_.resize(channels * kRingLength);
    hu_state_.resize(channels * 12u);
    input_low_pass_state_.resize(channels * 4u);
    input_high_pass_state_.resize(channels * 4u);
    output_high_pass_state_.resize(channels * 4u);
    difference_state_.resize(channels * 4u);
    attached_state_.resize(channels * 4u);
    cross_state_.resize(channels * 4u);
    post_state_.resize(channels * 6u);
    post_add_state_.resize(channels * 6u);
    post_attached_state_.resize(channels * 6u);
    meter_add_high_pass_state_.resize(channels * 4u);
    meter_attached_high_pass_state_.resize(channels * 4u);
    power_mean_.resize(channels);
    rng_state_.resize(channels);

    buildHilbertTaps();
    reset();
  }

  void reset() noexcept override {
    clearProcessingState();
    coefficients_valid_ = false;
    initialized_ = false;
    active_channels_ = 0u;
    buf_position_ = 0u;
    normalization_ = 0.0;
    amount_smoothed_ = 0.0;
    dry_wet_smoothed_ = 0.0;
    output_gain_smoothed_ = 0.0;
    ultrasonic_gain_smoothed_ = 0.0;
    second_harmonic_smoothed_ = 0.0;
    third_harmonic_smoothed_ = 0.0;
    attached_gain_smoothed_ = 0.0;
    cross_gain_smoothed_ = 0.0;
    meter_add_power_ = 0.0;
    meter_attached_power_ = 0.0;
    meter_cross_power_ = 0.0;
    meter_total_power_ = 0.0;
    meter_output_power_ = 0.0;
    latest_channels_ = 0u;
    latest_valid_ = false;
    telemetry_available_ = false;
    latest_meter_add_ = -140.0F;
    latest_meter_attached_ = -140.0F;
    latest_meter_cross_ = -140.0F;
    latest_meter_total_ = -140.0F;
    latest_meter_output_ = -140.0F;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    latest_channels_ = channel_count;
    latest_valid_ = false;
    telemetry_available_ = true;
    if (sample_rate_ < kMinimumSampleRate) {
      return;
    }

    updateCoefficients();

    const double amount_target = std::pow(10.0, static_cast<double>(params_.amount) / 20.0);
    const double dry_wet_target = static_cast<double>(params_.dryWet) / 100.0;
    const double output_gain_target =
        std::pow(10.0, static_cast<double>(params_.outputTrim) / 20.0);
    const double ultrasonic_sigma =
        std::pow(10.0, static_cast<double>(params_.ultrasonicLevel) / 20.0);
    const double nonlinearity = static_cast<double>(params_.analogNonlinearity) / 100.0;
    const double even_bias = static_cast<double>(params_.evenBias) / 100.0;
    const double second_harmonic_target =
        2.0 * nonlinearity * std::sin(std::numbers::pi_v<double> * even_bias * 0.5);
    const double third_harmonic_target =
        4.0 * nonlinearity * std::cos(std::numbers::pi_v<double> * even_bias * 0.5);
    const double attached_gain_target = static_cast<double>(params_.signalCoupling) / 100.0;
    const double cross_gain_target =
        attached_gain_target * (static_cast<double>(params_.crossSideband) / 100.0);
    const double alpha_power = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.25));
    const double smoothing = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.02));
    const double alpha_meter = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.3));

    if (!initialized_ || active_channels_ != channel_count) {
      initializeChannels(channel_count, amount_target, dry_wet_target, output_gain_target,
                         ultrasonic_sigma, second_harmonic_target, third_harmonic_target,
                         attached_gain_target, cross_gain_target, alpha_power);
    }

    const double normalization_floor = normalization_ > 1.0e-12 ? normalization_ : 1.0e-12;
    const double ultrasonic_gain_target = ultrasonic_sigma / normalization_floor;
    const bool high_pass_on = high_pass_stage_count_ != 0u;
    const double inverse_channels = 1.0 / static_cast<double>(channel_count);

    std::uint32_t position = buf_position_;
    double amount_smoothed = amount_smoothed_;
    double dry_wet_smoothed = dry_wet_smoothed_;
    double output_gain_smoothed = output_gain_smoothed_;
    double ultrasonic_gain_smoothed = ultrasonic_gain_smoothed_;
    double second_harmonic_smoothed = second_harmonic_smoothed_;
    double third_harmonic_smoothed = third_harmonic_smoothed_;
    double attached_gain_smoothed = attached_gain_smoothed_;
    double cross_gain_smoothed = cross_gain_smoothed_;
    double meter_add_power = meter_add_power_;
    double meter_attached_power = meter_attached_power_;
    double meter_cross_power = meter_cross_power_;
    double meter_total_power = meter_total_power_;
    double meter_output_power = meter_output_power_;

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      amount_smoothed += smoothing * (amount_target - amount_smoothed);
      dry_wet_smoothed += smoothing * (dry_wet_target - dry_wet_smoothed);
      output_gain_smoothed += smoothing * (output_gain_target - output_gain_smoothed);
      ultrasonic_gain_smoothed += smoothing * (ultrasonic_gain_target - ultrasonic_gain_smoothed);
      second_harmonic_smoothed += smoothing * (second_harmonic_target - second_harmonic_smoothed);
      third_harmonic_smoothed += smoothing * (third_harmonic_target - third_harmonic_smoothed);
      attached_gain_smoothed += smoothing * (attached_gain_target - attached_gain_smoothed);
      cross_gain_smoothed += smoothing * (cross_gain_target - cross_gain_smoothed);

      const std::uint32_t write_position = position & kRingMask;
      const std::uint32_t delay_position = (position - kHilbertDelay) & kRingMask;
      const double wet_twice = 2.0 * dry_wet_smoothed;
      const double wet_gain = wet_twice < 1.0 ? wet_twice : 1.0;
      const double dry_twice = 2.0 - 2.0 * dry_wet_smoothed;
      const double dry_gain = dry_twice < 1.0 ? dry_twice : 1.0;
      const bool wet_audible = dry_wet_smoothed > 1.0e-5;
      const double second_abs =
          second_harmonic_smoothed < 0.0 ? -second_harmonic_smoothed : second_harmonic_smoothed;
      const bool add_active = second_abs > 1.0e-10;
      const double attached_amount = third_harmonic_smoothed * attached_gain_smoothed;
      const double attached_abs = attached_amount < 0.0 ? -attached_amount : attached_amount;
      const bool attached_active = attached_abs > 1.0e-10;
      const double cross_amount = second_harmonic_smoothed * cross_gain_smoothed;
      const double cross_abs = cross_amount < 0.0 ? -cross_amount : cross_amount;
      const bool cross_active = cross_abs > 1.0e-10;
      const bool difference_needed = add_active || attached_active;
      const bool skip_imd = !wet_audible || !(add_active || attached_active || cross_active);

      double square_add = 0.0;
      double square_attached = 0.0;
      double square_cross = 0.0;
      double square_total = 0.0;
      double square_output = 0.0;

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::uint32_t ring_base = channel * kRingLength;
        const std::size_t audio_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const double input = static_cast<double>(audio[audio_index]);
        buf_x_raw_[ring_base + write_position] = static_cast<float>(input);

        if (skip_imd) {
          const double output = output_gain_smoothed * dry_gain *
                                static_cast<double>(buf_x_raw_[ring_base + delay_position]);
          audio[audio_index] = static_cast<float>(output);
          square_output += output * output;
          continue;
        }

        const std::uint32_t hu_base = channel * 12u;
        const std::uint32_t four_state_base = channel * 4u;
        const std::uint32_t post_base = channel * 6u;

        std::uint32_t random = rng_state_[channel];
        random ^= random << 13u;
        random ^= random >> 17u;
        random ^= random << 5u;
        rng_state_[channel] = random;
        const double white = kSqrt3 * (static_cast<double>(random) * kInverse2Pow31 - 1.0);
        const double ultrasonic =
            ultrasonic_gain_smoothed * cascade(white, hu_state_, hu_base, hu_coefficients_.data(),
                                               static_cast<std::uint32_t>(hu_coefficients_.size()));
        buf_u_[ring_base + write_position] = static_cast<float>(ultrasonic);

        const double low_passed =
            cascade(input, input_low_pass_state_, four_state_base, low_pass_coefficients_.data(),
                    static_cast<std::uint32_t>(low_pass_coefficients_.size()));
        const double audible = high_pass_on
                                   ? cascade(low_passed, input_high_pass_state_, four_state_base,
                                             high_pass_coefficients_.data(), high_pass_stage_count_)
                                   : low_passed;
        buf_x_audio_[ring_base + write_position] = static_cast<float>(audible);

        const double delayed_ultrasonic = static_cast<double>(buf_u_[ring_base + delay_position]);
        const double delayed_audio = static_cast<double>(buf_x_audio_[ring_base + delay_position]);
        const double delayed_dry = static_cast<double>(buf_x_raw_[ring_base + delay_position]);

        double residual_add = 0.0;
        double residual_attached = 0.0;
        if (difference_needed) {
          double hilbert = 0.0;
          for (std::uint32_t tap = 0u; tap < kHilbertTapCount; ++tap) {
            const std::uint32_t tap_position = (write_position - tap * 2u) & kRingMask;
            hilbert += static_cast<double>(hilbert_coefficients_[tap]) *
                       static_cast<double>(buf_u_[ring_base + tap_position]);
          }
          const double instantaneous_power =
              delayed_ultrasonic * delayed_ultrasonic + hilbert * hilbert;
          double mean = static_cast<double>(power_mean_[channel]);
          mean += alpha_power * (instantaneous_power - mean);
          power_mean_[channel] = static_cast<float>(mean);
          const double difference =
              cascade(0.5 * (instantaneous_power - mean), difference_state_, four_state_base,
                      low_pass_coefficients_.data(),
                      static_cast<std::uint32_t>(low_pass_coefficients_.size()));
          if (add_active) {
            residual_add = second_harmonic_smoothed * difference;
          }
          if (attached_active) {
            residual_attached = 3.0 * third_harmonic_smoothed * attached_gain_smoothed *
                                cascade(delayed_audio * difference, attached_state_,
                                        four_state_base, low_pass_coefficients_.data(),
                                        static_cast<std::uint32_t>(low_pass_coefficients_.size()));
          }
        }

        double residual_cross = 0.0;
        if (cross_active) {
          residual_cross = 2.0 * second_harmonic_smoothed * cross_gain_smoothed *
                           cascade(delayed_ultrasonic * delayed_audio, cross_state_,
                                   four_state_base, low_pass_coefficients_.data(),
                                   static_cast<std::uint32_t>(low_pass_coefficients_.size()));
        }

        double physical_residual = residual_add + residual_attached + residual_cross;
        if (high_pass_on) {
          physical_residual = cascade(physical_residual, output_high_pass_state_, four_state_base,
                                      high_pass_coefficients_.data(), high_pass_stage_count_);
        }
        const double residual = cascade(amount_smoothed * physical_residual, post_state_, post_base,
                                        post_coefficients_.data(),
                                        static_cast<std::uint32_t>(post_coefficients_.size()));
        const double output = output_gain_smoothed * (dry_gain * delayed_dry + wet_gain * residual);
        audio[audio_index] = static_cast<float>(output);

        double meter_add = 0.0;
        if (add_active) {
          const double filtered_add =
              high_pass_on ? cascade(residual_add, meter_add_high_pass_state_, four_state_base,
                                     high_pass_coefficients_.data(), high_pass_stage_count_)
                           : residual_add;
          meter_add = cascade(amount_smoothed * filtered_add, post_add_state_, post_base,
                              post_coefficients_.data(),
                              static_cast<std::uint32_t>(post_coefficients_.size()));
        }
        double meter_attached = 0.0;
        if (attached_active) {
          const double filtered_attached =
              high_pass_on
                  ? cascade(residual_attached, meter_attached_high_pass_state_, four_state_base,
                            high_pass_coefficients_.data(), high_pass_stage_count_)
                  : residual_attached;
          meter_attached = cascade(amount_smoothed * filtered_attached, post_attached_state_,
                                   post_base, post_coefficients_.data(),
                                   static_cast<std::uint32_t>(post_coefficients_.size()));
        }
        const double meter_cross = residual - meter_add - meter_attached;
        square_add += meter_add * meter_add;
        square_attached += meter_attached * meter_attached;
        square_cross += meter_cross * meter_cross;
        square_total += residual * residual;
        square_output += output * output;
      }

      meter_add_power += alpha_meter * (square_add * inverse_channels - meter_add_power);
      meter_attached_power +=
          alpha_meter * (square_attached * inverse_channels - meter_attached_power);
      meter_cross_power += alpha_meter * (square_cross * inverse_channels - meter_cross_power);
      meter_total_power += alpha_meter * (square_total * inverse_channels - meter_total_power);
      meter_output_power += alpha_meter * (square_output * inverse_channels - meter_output_power);
      position = position + 1u;
    }

    buf_position_ = position;
    amount_smoothed_ = amount_smoothed;
    dry_wet_smoothed_ = dry_wet_smoothed;
    output_gain_smoothed_ = output_gain_smoothed;
    ultrasonic_gain_smoothed_ = ultrasonic_gain_smoothed;
    second_harmonic_smoothed_ = second_harmonic_smoothed;
    third_harmonic_smoothed_ = third_harmonic_smoothed;
    attached_gain_smoothed_ = attached_gain_smoothed;
    cross_gain_smoothed_ = cross_gain_smoothed;
    meter_add_power_ = meter_add_power;
    meter_attached_power_ = meter_attached_power;
    meter_cross_power_ = meter_cross_power;
    meter_total_power_ = meter_total_power;
    meter_output_power_ = meter_output_power;
    latest_meter_add_ = meterToDb(meter_add_power);
    latest_meter_attached_ = meterToDb(meter_attached_power);
    latest_meter_cross_ = meterToDb(meter_cross_power);
    latest_meter_total_ = meterToDb(meter_total_power);
    latest_meter_output_ = meterToDb(meter_output_power);
    latest_valid_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (!telemetry_available_) {
      return;
    }
    std::array<std::uint8_t, kTelemetryPayloadBytes> payload{};
    writeU32(payload.data(), latest_channels_);
    writeF32(payload.data() + 4u, static_cast<float>(sample_rate_));
    writeU32(payload.data() + 8u, latest_valid_ ? kTelemetryValid : 0u);
    writeF32(payload.data() + 12u, latest_meter_add_);
    writeF32(payload.data() + 16u, latest_meter_attached_);
    writeF32(payload.data() + 20u, latest_meter_cross_);
    writeF32(payload.data() + 24u, latest_meter_total_);
    writeF32(payload.data() + 28u, latest_meter_output_);
    writer.write(kTelemetryFrameType, kTelemetryVersion, payload.data(),
                 static_cast<std::uint16_t>(payload.size()));
  }

private:
  static BiquadCoefficients lowPass(double frequency, double q, double sample_rate) noexcept {
    const double omega = 2.0 * std::numbers::pi_v<double> * frequency / sample_rate;
    const double cosine = std::cos(omega);
    const double sine = std::sin(omega);
    const double alpha = sine / (2.0 * q);
    const double a0 = 1.0 + alpha;
    const double k = (1.0 - cosine) * 0.5;
    return {k / a0, (1.0 - cosine) / a0, k / a0, (-2.0 * cosine) / a0, (1.0 - alpha) / a0};
  }

  static BiquadCoefficients highPass(double frequency, double q, double sample_rate) noexcept {
    const double omega = 2.0 * std::numbers::pi_v<double> * frequency / sample_rate;
    const double cosine = std::cos(omega);
    const double sine = std::sin(omega);
    const double alpha = sine / (2.0 * q);
    const double a0 = 1.0 + alpha;
    const double k = (1.0 + cosine) * 0.5;
    return {k / a0, (-(1.0 + cosine)) / a0, k / a0, (-2.0 * cosine) / a0, (1.0 - alpha) / a0};
  }

  static BiquadCoefficients peak(double frequency, double q, double gain_db,
                                 double sample_rate) noexcept {
    const double gain = std::pow(10.0, gain_db / 40.0);
    const double omega = 2.0 * std::numbers::pi_v<double> * frequency / sample_rate;
    const double cosine = std::cos(omega);
    const double sine = std::sin(omega);
    const double alpha = sine / (2.0 * q);
    const double a0 = 1.0 + alpha / gain;
    return {(1.0 + alpha * gain) / a0, (-2.0 * cosine) / a0, (1.0 - alpha * gain) / a0,
            (-2.0 * cosine) / a0, (1.0 - alpha / gain) / a0};
  }

  static BiquadCoefficients highShelf(double frequency, double gain_db,
                                      double sample_rate) noexcept {
    const double gain = std::pow(10.0, gain_db / 40.0);
    const double omega = 2.0 * std::numbers::pi_v<double> * frequency / sample_rate;
    const double cosine = std::cos(omega);
    const double sine = std::sin(omega);
    const double alpha = sine * 0.5 * kSqrt2;
    const double beta = 2.0 * std::sqrt(gain) * alpha;
    const double gain_plus_one = gain + 1.0;
    const double gain_minus_one = gain - 1.0;
    const double a0 = gain_plus_one - gain_minus_one * cosine + beta;
    return {gain * (gain_plus_one + gain_minus_one * cosine + beta) / a0,
            -2.0 * gain * (gain_minus_one + gain_plus_one * cosine) / a0,
            gain * (gain_plus_one + gain_minus_one * cosine - beta) / a0,
            2.0 * (gain_minus_one - gain_plus_one * cosine) / a0,
            (gain_plus_one - gain_minus_one * cosine - beta) / a0};
  }

  static double cascade(double input, std::vector<float> &state, std::uint32_t state_base,
                        const BiquadCoefficients *coefficients,
                        std::uint32_t stage_count) noexcept {
    double output = input;
    for (std::uint32_t stage = 0u; stage < stage_count; ++stage) {
      const std::uint32_t offset = state_base + stage * 2u;
      const BiquadCoefficients &coefficient = coefficients[stage];
      const double next = coefficient.b0 * output + static_cast<double>(state[offset]) + 1.0e-30;
      state[offset] = static_cast<float>(coefficient.b1 * output - coefficient.a1 * next +
                                         static_cast<double>(state[offset + 1u]));
      state[offset + 1u] = static_cast<float>(coefficient.b2 * output - coefficient.a2 * next);
      output = next;
    }
    return output;
  }

  static float meterToDb(double power) noexcept {
    return static_cast<float>(10.0 * std::log10(power + 1.0e-24));
  }

  void buildHilbertTaps() noexcept {
    std::uint32_t tap = 0u;
    for (std::uint32_t index = 0u; index < kHilbertLength; ++index) {
      const std::int32_t offset =
          static_cast<std::int32_t>(index) - static_cast<std::int32_t>(kHilbertDelay);
      if (offset == 0 || (offset % 2) == 0) {
        continue;
      }
      const double phase = 2.0 * std::numbers::pi_v<double> * static_cast<double>(index) /
                           static_cast<double>(kHilbertLength - 1u);
      const double window = 0.42 - 0.5 * std::cos(phase) + 0.08 * std::cos(2.0 * phase);
      hilbert_coefficients_[tap++] = static_cast<float>(
          (2.0 / (std::numbers::pi_v<double> * static_cast<double>(offset))) * window);
    }
  }

  void updateCoefficients() noexcept {
    const bool hu_changed = !coefficients_valid_ ||
                            params_.noiseColor != coefficient_noise_color_ ||
                            params_.noiseTexture != coefficient_noise_texture_;
    const bool all_changed = hu_changed || params_.scratchTone != coefficient_scratch_tone_ ||
                             params_.imdPathHpf != coefficient_high_pass_;
    if (!all_changed) {
      return;
    }

    const double color = static_cast<double>(params_.noiseColor) / 100.0;
    const double start_frequency = 24000.0 + 3000.0 * color;
    const double end_cap = 0.92 * sample_rate_ * 0.5;
    const double end_raw = 42000.0 + 2000.0 * color;
    const double end_frequency = end_raw < end_cap ? end_raw : end_cap;
    const double tilt = 18.0 + 6.0 * color;
    const double resonance = 12.0 * static_cast<double>(params_.noiseTexture) / 100.0;
    const double tilt_frequency = std::sqrt(start_frequency * end_frequency);
    const double width = end_frequency - start_frequency;
    const double first_peak = start_frequency + 0.23 * width;
    const double second_peak = start_frequency + 0.51 * width;
    const double third_peak = start_frequency + 0.78 * width;
    const double scratch_frequency = 1000.0 * static_cast<double>(params_.scratchTone);
    const double low_raw = 0.15 * scratch_frequency;
    const double high_raw = 2.2 * scratch_frequency;
    const double low_frequency = low_raw < 500.0 ? 500.0 : (low_raw > 2500.0 ? 2500.0 : low_raw);
    const double high_frequency =
        high_raw < 12000.0 ? 12000.0 : (high_raw > 20000.0 ? 20000.0 : high_raw);

    hu_coefficients_[0] = highPass(start_frequency, 0.707, sample_rate_);
    hu_coefficients_[1] = highShelf(tilt_frequency, tilt, sample_rate_);
    hu_coefficients_[2] = peak(first_peak, 5.0, 0.6 * resonance, sample_rate_);
    hu_coefficients_[3] = peak(second_peak, 7.0, resonance, sample_rate_);
    hu_coefficients_[4] = peak(third_peak, 6.0, 0.8 * resonance, sample_rate_);
    hu_coefficients_[5] = lowPass(end_frequency, 0.707, sample_rate_);
    low_pass_coefficients_[0] = lowPass(20000.0, kLowPassQ1, sample_rate_);
    low_pass_coefficients_[1] = lowPass(20000.0, kLowPassQ2, sample_rate_);
    post_coefficients_[0] = highPass(low_frequency, 0.707, sample_rate_);
    post_coefficients_[1] = peak(scratch_frequency, 0.9, 6.0, sample_rate_);
    post_coefficients_[2] = lowPass(high_frequency, 0.707, sample_rate_);

    const double high_pass_frequency = 1000.0 * static_cast<double>(params_.imdPathHpf);
    if (high_pass_frequency > 0.0) {
      high_pass_coefficients_[0] = highPass(high_pass_frequency, kLowPassQ1, sample_rate_);
      high_pass_coefficients_[1] = highPass(high_pass_frequency, kLowPassQ2, sample_rate_);
      high_pass_stage_count_ = 2u;
    } else {
      high_pass_stage_count_ = 0u;
    }

    if (hu_changed) {
      normalization_ = computeNormalization();
    }
    coefficient_noise_color_ = params_.noiseColor;
    coefficient_noise_texture_ = params_.noiseTexture;
    coefficient_scratch_tone_ = params_.scratchTone;
    coefficient_high_pass_ = params_.imdPathHpf;
    coefficients_valid_ = true;
  }

  double computeNormalization() const noexcept {
    constexpr std::uint32_t bins = 1024u;
    double accumulator = 0.0;
    for (std::uint32_t bin = 0u; bin < bins; ++bin) {
      const double omega =
          std::numbers::pi_v<double> * (static_cast<double>(bin) + 0.5) / static_cast<double>(bins);
      const double cosine = std::cos(omega);
      const double sine = std::sin(omega);
      const double cosine_two = std::cos(2.0 * omega);
      const double sine_two = std::sin(2.0 * omega);
      double magnitude_squared = 1.0;
      for (const BiquadCoefficients &coefficient : hu_coefficients_) {
        const double numerator_real =
            coefficient.b0 + coefficient.b1 * cosine + coefficient.b2 * cosine_two;
        const double numerator_imaginary = -(coefficient.b1 * sine + coefficient.b2 * sine_two);
        const double denominator_real = 1.0 + coefficient.a1 * cosine + coefficient.a2 * cosine_two;
        const double denominator_imaginary = -(coefficient.a1 * sine + coefficient.a2 * sine_two);
        magnitude_squared *=
            (numerator_real * numerator_real + numerator_imaginary * numerator_imaginary) /
            (denominator_real * denominator_real + denominator_imaginary * denominator_imaginary);
      }
      accumulator += magnitude_squared;
    }
    return std::sqrt(accumulator / static_cast<double>(bins));
  }

  void initializeChannels(std::uint32_t channel_count, double amount_target, double dry_wet_target,
                          double output_gain_target, double ultrasonic_sigma,
                          double second_harmonic_target, double third_harmonic_target,
                          double attached_gain_target, double cross_gain_target,
                          double alpha_power) noexcept {
    clearProcessingState();
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint64_t seed = static_cast<std::uint64_t>(0x9E3779B1u) * (channel + 1u) +
                                 static_cast<std::uint64_t>(0x6D2B79F5u);
      const std::uint32_t folded = static_cast<std::uint32_t>(seed);
      rng_state_[channel] = folded != 0u ? folded : 1u;
      power_mean_[channel] = static_cast<float>(2.0 * ultrasonic_sigma * ultrasonic_sigma);
    }

    buf_position_ = 0u;
    amount_smoothed_ = amount_target;
    dry_wet_smoothed_ = dry_wet_target;
    output_gain_smoothed_ = output_gain_target;
    second_harmonic_smoothed_ = second_harmonic_target;
    third_harmonic_smoothed_ = third_harmonic_target;
    attached_gain_smoothed_ = attached_gain_target;
    cross_gain_smoothed_ = cross_gain_target;
    const double normalization_floor = normalization_ > 1.0e-12 ? normalization_ : 1.0e-12;
    ultrasonic_gain_smoothed_ = ultrasonic_sigma / normalization_floor;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t ring_base = channel * kRingLength;
      const std::uint32_t hu_base = channel * 12u;
      const std::uint32_t four_state_base = channel * 4u;
      std::uint32_t position = 0u;
      double mean = static_cast<double>(power_mean_[channel]);
      std::uint32_t random = rng_state_[channel];
      for (std::uint32_t sample = 0u; sample < kPrewarmSamples; ++sample) {
        random ^= random << 13u;
        random ^= random >> 17u;
        random ^= random << 5u;
        const double white = kSqrt3 * (static_cast<double>(random) * kInverse2Pow31 - 1.0);
        const double ultrasonic = ultrasonic_gain_smoothed_ *
                                  cascade(white, hu_state_, hu_base, hu_coefficients_.data(),
                                          static_cast<std::uint32_t>(hu_coefficients_.size()));
        buf_u_[ring_base + (position & kRingMask)] = static_cast<float>(ultrasonic);
        const double delayed =
            static_cast<double>(buf_u_[ring_base + ((position - kHilbertDelay) & kRingMask)]);
        double hilbert = 0.0;
        for (std::uint32_t tap = 0u; tap < kHilbertTapCount; ++tap) {
          const std::uint32_t tap_position = (position - tap * 2u) & kRingMask;
          hilbert += static_cast<double>(hilbert_coefficients_[tap]) *
                     static_cast<double>(buf_u_[ring_base + tap_position]);
        }
        const double instantaneous_power = delayed * delayed + hilbert * hilbert;
        mean += alpha_power * (instantaneous_power - mean);
        static_cast<void>(cascade(0.5 * (instantaneous_power - mean), difference_state_,
                                  four_state_base, low_pass_coefficients_.data(),
                                  static_cast<std::uint32_t>(low_pass_coefficients_.size())));
        ++position;
      }
      power_mean_[channel] = static_cast<float>(mean);
      rng_state_[channel] = random;
    }
    buf_position_ = kPrewarmSamples;
    meter_add_power_ = 0.0;
    meter_attached_power_ = 0.0;
    meter_cross_power_ = 0.0;
    meter_total_power_ = 0.0;
    meter_output_power_ = 0.0;
    active_channels_ = channel_count;
    initialized_ = true;
  }

  void clearProcessingState() noexcept {
    std::fill(buf_u_.begin(), buf_u_.end(), 0.0F);
    std::fill(buf_x_audio_.begin(), buf_x_audio_.end(), 0.0F);
    std::fill(buf_x_raw_.begin(), buf_x_raw_.end(), 0.0F);
    std::fill(hu_state_.begin(), hu_state_.end(), 0.0F);
    std::fill(input_low_pass_state_.begin(), input_low_pass_state_.end(), 0.0F);
    std::fill(input_high_pass_state_.begin(), input_high_pass_state_.end(), 0.0F);
    std::fill(output_high_pass_state_.begin(), output_high_pass_state_.end(), 0.0F);
    std::fill(difference_state_.begin(), difference_state_.end(), 0.0F);
    std::fill(attached_state_.begin(), attached_state_.end(), 0.0F);
    std::fill(cross_state_.begin(), cross_state_.end(), 0.0F);
    std::fill(post_state_.begin(), post_state_.end(), 0.0F);
    std::fill(post_add_state_.begin(), post_add_state_.end(), 0.0F);
    std::fill(post_attached_state_.begin(), post_attached_state_.end(), 0.0F);
    std::fill(meter_add_high_pass_state_.begin(), meter_add_high_pass_state_.end(), 0.0F);
    std::fill(meter_attached_high_pass_state_.begin(), meter_attached_high_pass_state_.end(), 0.0F);
    std::fill(power_mean_.begin(), power_mean_.end(), 0.0F);
    std::fill(rng_state_.begin(), rng_state_.end(), 0u);
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t active_channels_ = 0u;
  std::uint32_t buf_position_ = 0u;
  std::uint32_t high_pass_stage_count_ = 0u;
  std::array<float, kHilbertTapCount> hilbert_coefficients_{};
  std::array<BiquadCoefficients, 6u> hu_coefficients_{};
  std::array<BiquadCoefficients, 2u> low_pass_coefficients_{};
  std::array<BiquadCoefficients, 3u> post_coefficients_{};
  std::array<BiquadCoefficients, 2u> high_pass_coefficients_{};
  std::vector<float> buf_u_;
  std::vector<float> buf_x_audio_;
  std::vector<float> buf_x_raw_;
  std::vector<float> hu_state_;
  std::vector<float> input_low_pass_state_;
  std::vector<float> input_high_pass_state_;
  std::vector<float> output_high_pass_state_;
  std::vector<float> difference_state_;
  std::vector<float> attached_state_;
  std::vector<float> cross_state_;
  std::vector<float> post_state_;
  std::vector<float> post_add_state_;
  std::vector<float> post_attached_state_;
  std::vector<float> meter_add_high_pass_state_;
  std::vector<float> meter_attached_high_pass_state_;
  std::vector<float> power_mean_;
  std::vector<std::uint32_t> rng_state_;
  double normalization_ = 0.0;
  double amount_smoothed_ = 0.0;
  double dry_wet_smoothed_ = 0.0;
  double output_gain_smoothed_ = 0.0;
  double ultrasonic_gain_smoothed_ = 0.0;
  double second_harmonic_smoothed_ = 0.0;
  double third_harmonic_smoothed_ = 0.0;
  double attached_gain_smoothed_ = 0.0;
  double cross_gain_smoothed_ = 0.0;
  double meter_add_power_ = 0.0;
  double meter_attached_power_ = 0.0;
  double meter_cross_power_ = 0.0;
  double meter_total_power_ = 0.0;
  double meter_output_power_ = 0.0;
  float coefficient_noise_color_ = 0.0F;
  float coefficient_noise_texture_ = 0.0F;
  float coefficient_scratch_tone_ = 0.0F;
  float coefficient_high_pass_ = 0.0F;
  std::uint32_t latest_channels_ = 0u;
  float latest_meter_add_ = -140.0F;
  float latest_meter_attached_ = -140.0F;
  float latest_meter_cross_ = -140.0F;
  float latest_meter_total_ = -140.0F;
  float latest_meter_output_ = -140.0F;
  bool coefficients_valid_ = false;
  bool initialized_ = false;
  bool latest_valid_ = false;
  bool telemetry_available_ = false;
};

static_assert(sizeof(DSD64IMDSimulatorKernel) <= 8192u);

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(DSD64IMDSimulatorPlugin, effetune::plugins::lofi::DSD64IMDSimulatorKernel)
