#include "effetune/kernel.h"
#include "VolumePluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::basics {

class VolumeKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::VolumePluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    ramp_frames_ = std::max(1u, static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005)));
    initialized_ = false;
  }

  void reset() noexcept override {
    current_gain_ = targetGain();
    target_gain_ = current_gain_;
    gain_step_ = 0.0;
    ramp_remaining_ = 0u;
    initialized_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (paramsDirty()) {
      if (initialized_) {
        retargetGain();
      } else {
        current_gain_ = targetGain();
        target_gain_ = current_gain_;
        gain_step_ = 0.0;
        ramp_remaining_ = 0u;
        initialized_ = true;
      }
    }

    for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
      const double gain = advanceGain();
      for (std::uint32_t channel = 0; channel < channel_count; ++channel) {
        const std::uint32_t index = channel * frame_count + frame;
        audio[index] = static_cast<float>(static_cast<double>(audio[index]) * gain);
      }
    }
  }

private:
  [[nodiscard]] double targetGain() const noexcept {
    return std::pow(10.0, static_cast<double>(params_.volume) / 20.0);
  }

  void retargetGain() noexcept {
    target_gain_ = targetGain();
    gain_step_ = (target_gain_ - current_gain_) / static_cast<double>(ramp_frames_);
    ramp_remaining_ = ramp_frames_;
  }

  [[nodiscard]] double advanceGain() noexcept {
    if (ramp_remaining_ != 0u) {
      current_gain_ += gain_step_;
      if (--ramp_remaining_ == 0u)
        current_gain_ = target_gain_;
    }
    return current_gain_;
  }

  double sample_rate_ = 48000.0;
  double current_gain_ = 1.0;
  double target_gain_ = 1.0;
  double gain_step_ = 0.0;
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t ramp_remaining_ = 0u;
  bool initialized_ = false;
};

} // namespace effetune::plugins::basics

EFFETUNE_REGISTER_KERNEL(VolumePlugin, effetune::plugins::basics::VolumeKernel)
