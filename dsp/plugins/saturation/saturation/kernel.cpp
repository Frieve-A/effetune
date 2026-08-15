#include "effetune/kernel.h"
#include "SaturationPluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace effetune::plugins::saturation {

class SaturationKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::SaturationPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    ramp_frames_ = std::max(
        1u, static_cast<std::uint32_t>(std::ceil(static_cast<double>(info.sampleRate) * 0.005)));
  }

  void reset() noexcept override {
    initialized_ = false;
    ramp_remaining_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (paramsDirty()) {
      updateTargets();
    }

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      advanceTargets();
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        const double dry = static_cast<double>(audio[index]);
        const double shaped_input = static_cast<double>(static_cast<float>(drive_ * (dry + bias_)));
        const double wet =
            static_cast<double>(static_cast<float>(std::tanh(shaped_input))) - bias_offset_;
        audio[index] = static_cast<float>((dry * (1.0 - mix_ratio_) + wet * mix_ratio_) * gain_);
      }
    }
  }

private:
  void updateTargets() noexcept {
    const double next_drive = static_cast<double>(params_.drive);
    const double next_bias = static_cast<double>(params_.bias);
    const double next_mix = static_cast<double>(params_.mix) / 100.0;
    const double next_gain = std::pow(10.0, static_cast<double>(params_.gain) / 20.0);
    const double next_bias_offset =
        static_cast<double>(static_cast<float>(std::tanh(next_drive * next_bias)));
    if (!initialized_) {
      drive_ = target_drive_ = next_drive;
      bias_ = target_bias_ = next_bias;
      mix_ratio_ = target_mix_ = next_mix;
      gain_ = target_gain_ = next_gain;
      bias_offset_ = target_bias_offset_ = next_bias_offset;
      initialized_ = true;
      return;
    }
    if (next_drive == target_drive_ && next_bias == target_bias_ && next_mix == target_mix_ &&
        next_gain == target_gain_ && next_bias_offset == target_bias_offset_) {
      return;
    }
    target_drive_ = next_drive;
    target_bias_ = next_bias;
    target_mix_ = next_mix;
    target_gain_ = next_gain;
    target_bias_offset_ = next_bias_offset;
    const double divisor = static_cast<double>(ramp_frames_);
    drive_step_ = (target_drive_ - drive_) / divisor;
    bias_step_ = (target_bias_ - bias_) / divisor;
    mix_step_ = (target_mix_ - mix_ratio_) / divisor;
    gain_step_ = (target_gain_ - gain_) / divisor;
    bias_offset_step_ = (target_bias_offset_ - bias_offset_) / divisor;
    ramp_remaining_ = ramp_frames_;
  }

  void advanceTargets() noexcept {
    if (ramp_remaining_ == 0u)
      return;
    drive_ += drive_step_;
    bias_ += bias_step_;
    mix_ratio_ += mix_step_;
    gain_ += gain_step_;
    bias_offset_ += bias_offset_step_;
    if (--ramp_remaining_ == 0u) {
      drive_ = target_drive_;
      bias_ = target_bias_;
      mix_ratio_ = target_mix_;
      gain_ = target_gain_;
      bias_offset_ = target_bias_offset_;
    }
  }

  double drive_ = 0.0;
  double target_drive_ = 0.0;
  double drive_step_ = 0.0;
  double bias_ = 0.0;
  double target_bias_ = 0.0;
  double bias_step_ = 0.0;
  double mix_ratio_ = 0.0;
  double target_mix_ = 0.0;
  double mix_step_ = 0.0;
  double gain_ = 1.0;
  double target_gain_ = 1.0;
  double gain_step_ = 0.0;
  double bias_offset_ = 0.0;
  double target_bias_offset_ = 0.0;
  double bias_offset_step_ = 0.0;
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t ramp_remaining_ = 0u;
  bool initialized_ = false;
};

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(SaturationPlugin, effetune::plugins::saturation::SaturationKernel)
