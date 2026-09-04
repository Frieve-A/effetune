#include "effetune/kernel.h"
#include "HumRemoverPluginParams.h"
#include "binary_io.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::restoration {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr std::uint32_t kMaximumHarmonics = 64u;
constexpr double kMinimumFrequencyHz = 45.0;
constexpr double kMaximumFrequencyHz = 65.0;
constexpr double kInitialFrequencyHz = 50.0;
constexpr double kFrequencyUpdateSeconds = 0.005;
constexpr double kFrequencyLoopRatio = 3.0;
constexpr double kTelemetrySmoothingTimeConstant = 0.1;
constexpr double kTelemetryPowerFloor = 1.0e-14;
constexpr double kDenormalFloor = 1.0e-20;
constexpr double kFrequencyEpsilon = 1.0e-12;
constexpr std::uint16_t kTelemetryFrameType = 23u;
constexpr std::uint16_t kTelemetryVersion = 1u;

void writeHumTelemetry(TelemetryWriter &writer, float fundamental_hz, float removed_dbfs) noexcept {
  std::array<std::uint8_t, 8u> payload{};
  binary_io::writeF32(payload.data(), fundamental_hz);
  binary_io::writeF32(payload.data() + 4u, removed_dbfs);
  writer.write(kTelemetryFrameType, kTelemetryVersion, payload.data(),
               static_cast<std::uint16_t>(payload.size()));
}

double bounded(double value, double lower, double upper, double fallback) noexcept {
  if (!std::isfinite(value)) {
    return fallback;
  }
  if (value < lower) {
    return lower;
  }
  return value > upper ? upper : value;
}

std::uint32_t boundedInteger(float value, std::uint32_t lower, std::uint32_t upper,
                             std::uint32_t fallback) noexcept {
  if (!std::isfinite(value)) {
    return fallback;
  }
  const long long rounded = std::llround(static_cast<double>(value));
  if (rounded < static_cast<long long>(lower)) {
    return lower;
  }
  return rounded > static_cast<long long>(upper) ? upper : static_cast<std::uint32_t>(rounded);
}

struct ChannelState {
  std::array<double, kMaximumHarmonics> cosine_weights{};
  std::array<double, kMaximumHarmonics> sine_weights{};
  std::array<double, kMaximumHarmonics> scratch_real{};
  std::array<double, kMaximumHarmonics> scratch_imaginary{};
  double phase_real = 1.0;
  double phase_imaginary = 0.0;
  double rotation_real = 1.0;
  double rotation_imaginary = 0.0;
  double frequency_hz = kInitialFrequencyHz;
  double previous_cosine_weight = 0.0;
  double previous_sine_weight = 0.0;
  std::uint32_t frequency_counter = 0u;
  std::uint32_t nyquist_harmonics = kMaximumHarmonics;
};

} // namespace

class HumRemoverKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::HumRemoverPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    prepared_ =
        std::isfinite(sample_rate_) && sample_rate_ > 0.0 && max_channels_ > 0u && max_frames_ > 0u;
    if (!prepared_) {
      channels_.clear();
      return;
    }

    channels_.resize(max_channels_);
    frequency_update_samples_ =
        static_cast<std::uint32_t>(std::llround(kFrequencyUpdateSeconds * sample_rate_));
    if (frequency_update_samples_ == 0u) {
      frequency_update_samples_ = 1u;
    }
    telemetry_smoothing_ = 1.0 - std::exp(-1.0 / (kTelemetrySmoothingTimeConstant * sample_rate_));
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  void reset() noexcept override {
    active_channel_count_ = 0u;
    active_harmonics_ = 0u;
    frequency_mode_ = 0u;
    tracking_time_constant_ = 1.0;
    adaptation_step_ = sample_rate_ > 0.0 ? 1.0 / sample_rate_ : 0.0;
    frequency_gain_ = 0.0;
    removed_power_smoothed_ = 0.0;
    for (ChannelState &state : channels_) {
      resetChannel(state, kInitialFrequencyHz);
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }

    if (active_channel_count_ != 0u && active_channel_count_ != channel_count) {
      reset();
    }
    active_channel_count_ = channel_count;
    updateControls();

    const std::uint32_t requested_harmonics = active_harmonics_;
    const double adaptation_step = adaptation_step_;
    double removed_power = removed_power_smoothed_;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      double frame_removed_power = 0.0;
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        ChannelState &state = channels_[channel];
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        const double input = std::isfinite(audio[index]) ? static_cast<double>(audio[index]) : 0.0;
        const std::uint32_t harmonics = requested_harmonics < state.nyquist_harmonics
                                            ? requested_harmonics
                                            : state.nyquist_harmonics;

        double harmonic_real = state.phase_real;
        double harmonic_imaginary = state.phase_imaginary;
        double removed = 0.0;
        for (std::uint32_t harmonic = 0u; harmonic < harmonics; ++harmonic) {
          state.scratch_real[harmonic] = harmonic_real;
          state.scratch_imaginary[harmonic] = harmonic_imaginary;
          removed += state.cosine_weights[harmonic] * harmonic_real +
                     state.sine_weights[harmonic] * harmonic_imaginary;
          const double next_real =
              harmonic_real * state.phase_real - harmonic_imaginary * state.phase_imaginary;
          harmonic_imaginary =
              harmonic_real * state.phase_imaginary + harmonic_imaginary * state.phase_real;
          harmonic_real = next_real;
        }

        double output = input - removed;
        if (!std::isfinite(output)) {
          clearWeights(state);
          removed = 0.0;
          output = input;
        }
        const double update_gain = 2.0 * adaptation_step * output;
        for (std::uint32_t harmonic = 0u; harmonic < harmonics; ++harmonic) {
          state.cosine_weights[harmonic] += update_gain * state.scratch_real[harmonic];
          state.sine_weights[harmonic] += update_gain * state.scratch_imaginary[harmonic];
        }
        audio[index] = static_cast<float>(output);
        frame_removed_power += removed * removed;

        const double next_phase_real = state.phase_real * state.rotation_real -
                                       state.phase_imaginary * state.rotation_imaginary;
        state.phase_imaginary = state.phase_real * state.rotation_imaginary +
                                state.phase_imaginary * state.rotation_real;
        state.phase_real = next_phase_real;
        ++state.frequency_counter;
        if (state.frequency_counter >= frequency_update_samples_) {
          updateFrequency(state);
        }
      }

      frame_removed_power /= static_cast<double>(channel_count);
      removed_power += (frame_removed_power - removed_power) * telemetry_smoothing_;
    }
    removed_power_smoothed_ =
        std::isfinite(removed_power) && removed_power > 0.0 ? removed_power : 0.0;
    flushDenormals(channel_count);
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    const double frequency =
        active_channel_count_ > 0u ? channels_[0].frequency_hz : kInitialFrequencyHz;
    const double removed_dbfs = removed_power_smoothed_ > kTelemetryPowerFloor
                                    ? 10.0 * std::log10(removed_power_smoothed_)
                                    : -140.0;
    writeHumTelemetry(writer, static_cast<float>(frequency), static_cast<float>(removed_dbfs));
  }

private:
  void clearWeights(ChannelState &state) noexcept {
    state.cosine_weights.fill(0.0);
    state.sine_weights.fill(0.0);
    state.previous_cosine_weight = 0.0;
    state.previous_sine_weight = 0.0;
  }

  void resetChannel(ChannelState &state, double frequency_hz) noexcept {
    clearWeights(state);
    state.scratch_real.fill(0.0);
    state.scratch_imaginary.fill(0.0);
    state.phase_real = 1.0;
    state.phase_imaginary = 0.0;
    state.frequency_counter = 0u;
    setFrequency(state, frequency_hz);
  }

  void setFrequency(ChannelState &state, double frequency_hz) noexcept {
    state.frequency_hz =
        bounded(frequency_hz, kMinimumFrequencyHz, kMaximumFrequencyHz, kInitialFrequencyHz);
    const double radians = 2.0 * kPi * state.frequency_hz / sample_rate_;
    state.rotation_real = std::cos(radians);
    state.rotation_imaginary = std::sin(radians);
    const double maximum_harmonic = 0.45 * sample_rate_ / state.frequency_hz;
    const std::uint32_t bounded_harmonic =
        maximum_harmonic < 1.0 ? 1u : static_cast<std::uint32_t>(maximum_harmonic);
    state.nyquist_harmonics =
        bounded_harmonic < kMaximumHarmonics ? bounded_harmonic : kMaximumHarmonics;
  }

  void updateControls() noexcept {
    const std::uint32_t new_mode = boundedInteger(params_.frequency, 0u, 2u, 0u);
    const std::uint32_t new_harmonics =
        boundedInteger(params_.harmonics, 1u, kMaximumHarmonics, 8u);
    const double tracking_speed =
        bounded(static_cast<double>(params_.trackingSpeed), 0.0, 100.0, 50.0);
    tracking_time_constant_ = std::pow(10.0, 0.7 - 0.014 * tracking_speed);
    adaptation_step_ = 1.0 / (tracking_time_constant_ * sample_rate_);
    frequency_gain_ = static_cast<double>(frequency_update_samples_) /
                      (kFrequencyLoopRatio * tracking_time_constant_ * sample_rate_);

    if (new_harmonics > active_harmonics_) {
      for (ChannelState &state : channels_) {
        for (std::uint32_t harmonic = active_harmonics_; harmonic < new_harmonics; ++harmonic) {
          state.cosine_weights[harmonic] = 0.0;
          state.sine_weights[harmonic] = 0.0;
        }
      }
    }
    active_harmonics_ = new_harmonics;

    if (new_mode != frequency_mode_) {
      frequency_mode_ = new_mode;
      if (frequency_mode_ != 0u) {
        const double fixed_frequency = frequency_mode_ == 1u ? 50.0 : 60.0;
        for (ChannelState &state : channels_) {
          setFrequency(state, fixed_frequency);
          state.previous_cosine_weight = state.cosine_weights[0];
          state.previous_sine_weight = state.sine_weights[0];
        }
      }
    } else if (frequency_mode_ != 0u) {
      const double fixed_frequency = frequency_mode_ == 1u ? 50.0 : 60.0;
      for (std::uint32_t channel = 0u; channel < active_channel_count_; ++channel) {
        ChannelState &state = channels_[channel];
        if (state.frequency_hz != fixed_frequency) {
          setFrequency(state, fixed_frequency);
        }
      }
    }
  }

  void updateFrequency(ChannelState &state) noexcept {
    state.frequency_counter = 0u;
    const double magnitude = std::sqrt(state.phase_real * state.phase_real +
                                       state.phase_imaginary * state.phase_imaginary);
    if (std::isfinite(magnitude) && magnitude > 0.0) {
      state.phase_real /= magnitude;
      state.phase_imaginary /= magnitude;
    } else {
      state.phase_real = 1.0;
      state.phase_imaginary = 0.0;
    }

    const double cosine_weight = state.cosine_weights[0];
    const double sine_weight = state.sine_weights[0];
    if (frequency_mode_ == 0u) {
      const double weight_power = cosine_weight * cosine_weight + sine_weight * sine_weight;
      const double phase_increment = (state.previous_cosine_weight * sine_weight -
                                      state.previous_sine_weight * cosine_weight) /
                                     (weight_power + kFrequencyEpsilon);
      const double correction = frequency_gain_ * phase_increment * sample_rate_ /
                                (2.0 * kPi * static_cast<double>(frequency_update_samples_));
      setFrequency(state, state.frequency_hz - correction);
    }
    state.previous_cosine_weight = cosine_weight;
    state.previous_sine_weight = sine_weight;
  }

  void flushDenormals(std::uint32_t channel_count) noexcept {
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      ChannelState &state = channels_[channel];
      for (std::uint32_t harmonic = 0u; harmonic < active_harmonics_; ++harmonic) {
        const double cosine = state.cosine_weights[harmonic];
        const double sine = state.sine_weights[harmonic];
        if (cosine > -kDenormalFloor && cosine < kDenormalFloor) {
          state.cosine_weights[harmonic] = 0.0;
        }
        if (sine > -kDenormalFloor && sine < kDenormalFloor) {
          state.sine_weights[harmonic] = 0.0;
        }
      }
      if (state.previous_cosine_weight > -kDenormalFloor &&
          state.previous_cosine_weight < kDenormalFloor) {
        state.previous_cosine_weight = 0.0;
      }
      if (state.previous_sine_weight > -kDenormalFloor &&
          state.previous_sine_weight < kDenormalFloor) {
        state.previous_sine_weight = 0.0;
      }
    }
    if (removed_power_smoothed_ < kDenormalFloor) {
      removed_power_smoothed_ = 0.0;
    }
  }

  std::vector<ChannelState> channels_;
  double sample_rate_ = 0.0;
  double tracking_time_constant_ = 1.0;
  double adaptation_step_ = 0.0;
  double frequency_gain_ = 0.0;
  double telemetry_smoothing_ = 0.0;
  double removed_power_smoothed_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t active_channel_count_ = 0u;
  std::uint32_t active_harmonics_ = 0u;
  std::uint32_t frequency_mode_ = 0u;
  std::uint32_t frequency_update_samples_ = 1u;
  bool prepared_ = false;
};

static_assert(sizeof(HumRemoverKernel) <= 8192u);

} // namespace effetune::plugins::restoration

EFFETUNE_REGISTER_KERNEL(HumRemoverPlugin, effetune::plugins::restoration::HumRemoverKernel)
