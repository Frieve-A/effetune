#include "effetune/kernel.h"
#include "HarmonicDistortionPluginParams.h"
#include "effetune/dsp/oversampled_shaper.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace effetune::plugins::saturation {

class HarmonicDistortionKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::HarmonicDistortionPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    shaper_.prepare(info.maxChannels * 1u);
    max_channels_ = info.maxChannels;
    ramp_frames_ = std::max(
        1u, static_cast<std::uint32_t>(std::ceil(static_cast<double>(info.sampleRate) * 0.005)));
  }

  void reset() noexcept override {
    shaper_.reset();
    initialized_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    shaper_.configure(dsp::OversampledShaper::factor(params_.oversampling, 8u), channel_count * 1u);
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }
    const std::array<double, 5u> target{-static_cast<double>(params_.secondHarmonic) * 0.01,
                                        -static_cast<double>(params_.thirdHarmonic) * 0.01,
                                        -static_cast<double>(params_.fourthHarmonic) * 0.01,
                                        -static_cast<double>(params_.fifthHarmonic) * 0.01,
                                        static_cast<double>(params_.sensitivity)};
    if (!initialized_) {
      current_ = target;
      target_ = target;
      initialized_ = true;
    } else if (target != target_) {
      target_ = target;
      for (std::size_t index = 0u; index < current_.size(); ++index) {
        step_[index] = (target_[index] - current_[index]) / static_cast<double>(ramp_frames_);
      }
      ramp_remaining_ = ramp_frames_;
    }

    // Coefficients change per frame only while ramping; the remaining frames use one constant set
    // and run channel by channel so the memoryless shaper vectorizes.
    const std::uint32_t ramp_count = ramp_remaining_ < frame_count ? ramp_remaining_ : frame_count;
    for (std::uint32_t frame = 0u; frame < ramp_count; ++frame) {
      for (std::size_t index = 0u; index < current_.size(); ++index)
        current_[index] += step_[index];
      if (--ramp_remaining_ == 0u)
        current_ = target_;
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        audio[index] = processSample(channel, audio[index], current_);
      }
    }
    if (ramp_count == frame_count)
      return;
    const std::array<double, 5u> coefficients = current_;
    const double inverse_sensitivity = inverseSensitivity(coefficients);
    const bool oversampled = dsp::OversampledShaper::factor(params_.oversampling, 8u) != 1u;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *const data = audio + static_cast<std::size_t>(channel) * frame_count;
      if (oversampled) {
        for (std::uint32_t frame = ramp_count; frame < frame_count; ++frame)
          data[frame] = processSample(channel, data[frame], coefficients);
      } else {
        for (std::uint32_t frame = ramp_count; frame < frame_count; ++frame)
          data[frame] = static_cast<float>(shape(data[frame], coefficients, inverse_sensitivity));
      }
    }
  }

  [[nodiscard]] LatencyRange latencyRange() const noexcept override {
    return {0u, dsp::OversampledShaper::kLatency};
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    const auto &parameters = params_pending_ ? staged_params_ : params_;
    return dsp::OversampledShaper::factor(parameters.oversampling, 8u) == 1u
               ? 0u
               : dsp::OversampledShaper::kLatency;
  }

private:
  static double shape(double input, const std::array<double, 5u> &coefficients,
                      double inverse_sensitivity) noexcept {
    const double scaled = input * coefficients[4];
    const double squared = scaled * scaled;
    const double cubed = squared * scaled;
    const double fourth_power = squared * squared;
    const double fifth_power = fourth_power * scaled;
    const double nonlinear = scaled + coefficients[0] * squared + coefficients[1] * cubed +
                             coefficients[2] * fourth_power + coefficients[3] * fifth_power;
    return nonlinear * inverse_sensitivity;
  }

  static double inverseSensitivity(const std::array<double, 5u> &coefficients) noexcept {
    return 1.0 / (coefficients[4] + 1.0e-9);
  }

  float processSample(std::uint32_t channel, float input,
                      const std::array<double, 5u> &coefficients) noexcept {
    const double inverse_sensitivity = inverseSensitivity(coefficients);
    return static_cast<float>(shaper_.process(channel, input, [&](double value) noexcept {
      return shape(value, coefficients, inverse_sensitivity);
    }));
  }

  dsp::OversampledShaper shaper_;
  std::uint32_t max_channels_ = 0u;
  std::array<double, 5u> current_{};
  std::array<double, 5u> target_{};
  std::array<double, 5u> step_{};
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t ramp_remaining_ = 0u;
  bool initialized_ = false;
};

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(HarmonicDistortionPlugin,
                         effetune::plugins::saturation::HarmonicDistortionKernel)
