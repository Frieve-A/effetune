#include "effetune/kernel.h"
#include "StereoBlendPluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::spatial {

class StereoBlendKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::StereoBlendPluginParams)

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
    if (channel_count < 2u) {
      return;
    }

    float *left = audio;
    float *right = audio + frame_count;
    const double target = static_cast<double>(params_.stereo) / 100.0;
    if (!initialized_) {
      current_gain_ = target;
      target_gain_ = target;
      initialized_ = true;
    } else if (target != target_gain_) {
      target_gain_ = target;
      gain_step_ = (target_gain_ - current_gain_) / static_cast<double>(ramp_frames_);
      ramp_remaining_ = ramp_frames_;
    }
    for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
      if (ramp_remaining_ != 0u) {
        current_gain_ += gain_step_;
        if (--ramp_remaining_ == 0u)
          current_gain_ = target_gain_;
      }
      const double left_sample = static_cast<double>(left[frame]);
      const double right_sample = static_cast<double>(right[frame]);
      const double mid = (left_sample + right_sample) * 0.5;
      const double side = (left_sample - right_sample) * 0.5;
      const double scaled_side = side * current_gain_;
      left[frame] = static_cast<float>(mid + scaled_side);
      right[frame] = static_cast<float>(mid - scaled_side);
    }
  }

private:
  double current_gain_ = 1.0;
  double target_gain_ = 1.0;
  double gain_step_ = 0.0;
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t ramp_remaining_ = 0u;
  bool initialized_ = false;
};

} // namespace effetune::plugins::spatial

EFFETUNE_REGISTER_KERNEL(StereoBlendPlugin, effetune::plugins::spatial::StereoBlendKernel)
