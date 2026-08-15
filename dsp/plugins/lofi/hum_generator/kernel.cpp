#include "effetune/kernel.h"
#include "HumGeneratorPluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr double kTwoPi = 6.283185307179586;
constexpr double kInversePi = 0.3183098861837907;
constexpr double kDenormalOffset = 1.0e-25;

struct FilterCoefficients final {
  double b0 = 0.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
};

struct FilterState final {
  double x1 = 0.0;
  double x2 = 0.0;
  double y1 = 0.0;
  double y2 = 0.0;
};

FilterCoefficients lowpass(double frequency, double q, double inverse_sample_rate) noexcept {
  const double omega = kTwoPi * frequency * inverse_sample_rate;
  const double cosine = std::cos(omega);
  const double alpha = std::sin(omega) / (2.0 * q);
  const double inverse_a0 = 1.0 / (1.0 + alpha);
  return {(1.0 - cosine) * 0.5 * inverse_a0, (1.0 - cosine) * inverse_a0,
          (1.0 - cosine) * 0.5 * inverse_a0, -2.0 * cosine * inverse_a0,
          (1.0 - alpha) * inverse_a0};
}

double processFilter(double input, FilterState &state,
                     const FilterCoefficients &coefficients) noexcept {
  double output = coefficients.b0 * input + coefficients.b1 * state.x1 +
                  coefficients.b2 * state.x2 - coefficients.a1 * state.y1 -
                  coefficients.a2 * state.y2;
  output += kDenormalOffset;
  if (output > 10.0) {
    output = 10.0;
  } else if (output < -10.0) {
    output = -10.0;
  }
  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = output;
  return output;
}

} // namespace

class HumGeneratorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::HumGeneratorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    delay_length_ = static_cast<std::uint32_t>(std::ceil(sample_rate_ / 20.0)) + 1u;
    delay_buffers_.resize(static_cast<std::size_t>(max_channels_) * delay_length_);
    delay_positions_.resize(max_channels_);
    harmonic_states_.resize(max_channels_);
    tone_states_.resize(max_channels_);
  }

  void reset() noexcept override {
    clearState();
    initialized_ = false;
    controls_initialized_ = false;
    last_channel_count_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        sample_rate_ <= 0.0) {
      return;
    }
    if (!initialized_ || last_channel_count_ != channel_count) {
      clearState();
      initialized_ = true;
      last_channel_count_ = channel_count;
    }

    const double inverse_sample_rate = 1.0 / sample_rate_;
    const double lfo_increment1 = kTwoPi * 0.3 * inverse_sample_rate;
    const double lfo_increment2 = kTwoPi * 0.7 * inverse_sample_rate;
    const double instability = static_cast<double>(params_.instability) * 0.01;
    const double frequency_modulation_depth = instability * 0.02;
    const double amplitude_modulation_depth = instability * 0.1;
    prepareControls(inverse_sample_rate);
    const double final_gain = std::pow(10.0, static_cast<double>(params_.level) / 20.0);
    std::uint32_t hum_type = static_cast<std::uint32_t>(params_.humType);
    if (hum_type > 2u) {
      hum_type = 1u;
    }

    double lfo_phase1 = lfo_phase1_;
    double lfo_phase2 = lfo_phase2_;
    double oscillator_phase = oscillator_phase_;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      lfo_phase1 = std::fmod(lfo_phase1 + lfo_increment1, kTwoPi);
      lfo_phase2 = std::fmod(lfo_phase2 + lfo_increment2, kTwoPi);
      const double combined_lfo = (std::sin(lfo_phase1) + std::sin(lfo_phase2)) * 0.5;
      const double base_frequency = frequency_ramp_.value(frame);
      const double harmonics = harmonics_ramp_.value(frame);
      const double dirty_drive = 1.0 + harmonics * 0.03;
      const double comb_delay = 0.5 / base_frequency * sample_rate_;
      const FilterCoefficients harmonic_coefficients = harmonic_filter_ramp_.value(frame);
      const FilterCoefficients tone_coefficients = tone_filter_ramp_.value(frame);
      const double modulated_frequency =
          base_frequency * (1.0 + combined_lfo * frequency_modulation_depth);
      const double phase_increment = kTwoPi * modulated_frequency * inverse_sample_rate;
      oscillator_phase = std::fmod(oscillator_phase + phase_increment, kTwoPi);
      const double oscillator_output = oscillator_phase * kInversePi - 1.0;
      const double amplitude_modulation = 1.0 + combined_lfo * amplitude_modulation_depth;

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        double wet = oscillator_output;
        if (hum_type == 0u) {
          const std::size_t delay_offset = static_cast<std::size_t>(channel) * delay_length_;
          const std::uint32_t position = delay_positions_[channel];
          if (comb_delay > 0.0 && comb_delay < static_cast<double>(delay_length_ - 1u)) {
            const auto newer_delay = static_cast<std::uint32_t>(comb_delay);
            const double fraction = comb_delay - static_cast<double>(newer_delay);
            const std::uint32_t newer = (position + delay_length_ - newer_delay) % delay_length_;
            const std::uint32_t older = newer == 0u ? delay_length_ - 1u : newer - 1u;
            const double newer_sample = static_cast<double>(delay_buffers_[delay_offset + newer]);
            const double delayed =
                newer_sample +
                (static_cast<double>(delay_buffers_[delay_offset + older]) - newer_sample) *
                    fraction;
            delay_buffers_[delay_offset + position] = static_cast<float>(wet);
            wet = (wet - delayed) * 0.5;
          }
          std::uint32_t next_position = position + 1u;
          if (next_position == delay_length_) {
            next_position = 0u;
          }
          delay_positions_[channel] = next_position;
        }

        wet = processFilter(wet, harmonic_states_[channel], harmonic_coefficients);
        if (hum_type == 2u) {
          wet = std::tanh(wet * dirty_drive);
        }
        wet = processFilter(wet, tone_states_[channel], tone_coefficients);

        const std::uint32_t index = channel * frame_count + frame;
        audio[index] = static_cast<float>(static_cast<double>(audio[index]) +
                                          wet * amplitude_modulation * final_gain);
      }
    }
    lfo_phase1_ = lfo_phase1;
    lfo_phase2_ = lfo_phase2;
    oscillator_phase_ = oscillator_phase;
    frequency_ramp_.advance(frame_count);
    harmonics_ramp_.advance(frame_count);
    harmonic_filter_ramp_.advance(frame_count);
    tone_filter_ramp_.advance(frame_count);
  }

private:
  struct ScalarRamp {
    double current = 0.0;
    double target = 0.0;
    double step = 0.0;
    std::uint32_t remaining = 0u;
    void snap(double value) noexcept {
      current = target = value;
      step = 0.0;
      remaining = 0u;
    }
    void retarget(double value, std::uint32_t frames) noexcept {
      if (value == target)
        return;
      target = value;
      remaining = frames;
      step = (target - current) / static_cast<double>(frames);
    }
    [[nodiscard]] double value(std::uint32_t frame) const noexcept {
      const std::uint32_t elapsed = frame + 1u;
      return elapsed >= remaining ? target : current + step * static_cast<double>(elapsed);
    }
    void advance(std::uint32_t frames) noexcept {
      if (frames >= remaining) {
        current = target;
        step = 0.0;
        remaining = 0u;
      } else {
        current += step * static_cast<double>(frames);
        remaining -= frames;
      }
    }
  };

  struct FilterRamp {
    FilterCoefficients current{};
    FilterCoefficients target{};
    FilterCoefficients step{};
    std::uint32_t remaining = 0u;
    void snap(const FilterCoefficients &value) noexcept {
      current = target = value;
      step = {};
      remaining = 0u;
    }
    void retarget(const FilterCoefficients &value, std::uint32_t frames) noexcept {
      target = value;
      const double denominator = static_cast<double>(frames);
      step = {(target.b0 - current.b0) / denominator, (target.b1 - current.b1) / denominator,
              (target.b2 - current.b2) / denominator, (target.a1 - current.a1) / denominator,
              (target.a2 - current.a2) / denominator};
      remaining = frames;
    }
    [[nodiscard]] FilterCoefficients value(std::uint32_t frame) const noexcept {
      const std::uint32_t elapsed = frame + 1u;
      if (elapsed >= remaining)
        return target;
      const double offset = static_cast<double>(elapsed);
      return {current.b0 + step.b0 * offset, current.b1 + step.b1 * offset,
              current.b2 + step.b2 * offset, current.a1 + step.a1 * offset,
              current.a2 + step.a2 * offset};
    }
    void advance(std::uint32_t frames) noexcept {
      if (frames >= remaining) {
        current = target;
        step = {};
        remaining = 0u;
      } else {
        const double offset = static_cast<double>(frames);
        current = {current.b0 + step.b0 * offset, current.b1 + step.b1 * offset,
                   current.b2 + step.b2 * offset, current.a1 + step.a1 * offset,
                   current.a2 + step.a2 * offset};
        remaining -= frames;
      }
    }
  };

  void prepareControls(double inverse_sample_rate) noexcept {
    const double frequency = static_cast<double>(params_.frequency);
    const double harmonics = static_cast<double>(params_.harmonics);
    const double harmonics_cutoff = 200.0 + (harmonics * 0.01) * (harmonics * 0.01) * 10000.0;
    const FilterCoefficients harmonic = lowpass(harmonics_cutoff, 0.707, inverse_sample_rate);
    const FilterCoefficients tone =
        lowpass(static_cast<double>(params_.tone) * 1000.0, 1.0, inverse_sample_rate);
    if (!controls_initialized_) {
      frequency_ramp_.snap(frequency);
      harmonics_ramp_.snap(harmonics);
      harmonic_filter_ramp_.snap(harmonic);
      tone_filter_ramp_.snap(tone);
      harmonics_target_ = harmonics;
      tone_target_ = params_.tone;
      controls_initialized_ = true;
      return;
    }
    const auto requested_frames = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));
    const auto frames = requested_frames == 0u ? 1u : requested_frames;
    frequency_ramp_.retarget(frequency, frames);
    harmonics_ramp_.retarget(harmonics, frames);
    if (harmonics != harmonics_target_)
      harmonic_filter_ramp_.retarget(harmonic, frames);
    if (params_.tone != tone_target_)
      tone_filter_ramp_.retarget(tone, frames);
    harmonics_target_ = harmonics;
    tone_target_ = params_.tone;
  }

  void clearState() noexcept {
    lfo_phase1_ = 0.0;
    lfo_phase2_ = 0.0;
    oscillator_phase_ = 0.0;
    for (float &sample : delay_buffers_) {
      sample = 0.0F;
    }
    for (std::uint32_t &position : delay_positions_) {
      position = 0u;
    }
    for (FilterState &state : harmonic_states_) {
      state = {};
    }
    for (FilterState &state : tone_states_) {
      state = {};
    }
  }

  double sample_rate_ = 0.0;
  double lfo_phase1_ = 0.0;
  double lfo_phase2_ = 0.0;
  double oscillator_phase_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t delay_length_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool initialized_ = false;
  bool controls_initialized_ = false;
  double harmonics_target_ = 0.0;
  float tone_target_ = 0.0F;
  ScalarRamp frequency_ramp_;
  ScalarRamp harmonics_ramp_;
  FilterRamp harmonic_filter_ramp_;
  FilterRamp tone_filter_ramp_;
  std::vector<float> delay_buffers_;
  std::vector<std::uint32_t> delay_positions_;
  std::vector<FilterState> harmonic_states_;
  std::vector<FilterState> tone_states_;
};

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(HumGeneratorPlugin, effetune::plugins::lofi::HumGeneratorKernel)
