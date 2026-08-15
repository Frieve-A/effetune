#include "effetune/kernel.h"
#include "HarmonicDistortionPluginParams.h"

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
    max_channels_ = info.maxChannels;
    ramp_frames_ = std::max(
        1u, static_cast<std::uint32_t>(std::ceil(static_cast<double>(info.sampleRate) * 0.005)));
  }

  void reset() noexcept override { initialized_ = false; }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
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

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      if (ramp_remaining_ != 0u) {
        for (std::size_t index = 0u; index < current_.size(); ++index)
          current_[index] += step_[index];
        if (--ramp_remaining_ == 0u)
          current_ = target_;
      }
      const double inverse_sensitivity = 1.0 / (current_[4] + 1.0e-9);
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        const double scaled = static_cast<double>(audio[index]) * current_[4];
        const double squared = scaled * scaled;
        const double cubed = squared * scaled;
        const double fourth_power = squared * squared;
        const double fifth_power = fourth_power * scaled;
        const double nonlinear = scaled + current_[0] * squared + current_[1] * cubed +
                                 current_[2] * fourth_power + current_[3] * fifth_power;
        audio[index] = static_cast<float>(nonlinear * inverse_sensitivity);
      }
    }
  }

private:
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
