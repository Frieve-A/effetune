#include "effetune/kernel.h"
#include "MSMatrixPluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::spatial {

class MSMatrixKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MSMatrixPluginParams)

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
    if (channel_count != 2u) {
      return;
    }
    if (paramsDirty() || !initialized_)
      updateTargets();

    float *left = audio;
    float *right = audio + frame_count;
    const bool swap = params_.swap == 1.0F;

    if (params_.mode == 0.0F) {
      for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
        advanceGains();
        double left_sample = static_cast<double>(left[frame]);
        double right_sample = static_cast<double>(right[frame]);
        if (swap) {
          const double temporary = left_sample;
          left_sample = right_sample;
          right_sample = temporary;
        }
        const double mid = (left_sample + right_sample) * 0.5;
        const double side = (left_sample - right_sample) * 0.5;
        left[frame] = static_cast<float>(mid * mid_gain_);
        right[frame] = static_cast<float>(side * side_gain_);
      }
      return;
    }

    for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
      advanceGains();
      const double mid_output = static_cast<double>(left[frame]) * mid_gain_;
      const double side_output = static_cast<double>(right[frame]) * side_gain_;
      if (swap) {
        left[frame] = static_cast<float>(mid_output - side_output);
        right[frame] = static_cast<float>(mid_output + side_output);
      } else {
        left[frame] = static_cast<float>(mid_output + side_output);
        right[frame] = static_cast<float>(mid_output - side_output);
      }
    }
  }

private:
  void updateTargets() noexcept {
    const double mid = std::pow(10.0, static_cast<double>(params_.midGain) / 20.0);
    const double side = std::pow(10.0, static_cast<double>(params_.sideGain) / 20.0);
    if (!initialized_) {
      mid_gain_ = target_mid_gain_ = mid;
      side_gain_ = target_side_gain_ = side;
      initialized_ = true;
      return;
    }
    if (mid == target_mid_gain_ && side == target_side_gain_)
      return;
    target_mid_gain_ = mid;
    target_side_gain_ = side;
    mid_step_ = (target_mid_gain_ - mid_gain_) / static_cast<double>(ramp_frames_);
    side_step_ = (target_side_gain_ - side_gain_) / static_cast<double>(ramp_frames_);
    ramp_remaining_ = ramp_frames_;
  }

  void advanceGains() noexcept {
    if (ramp_remaining_ == 0u)
      return;
    mid_gain_ += mid_step_;
    side_gain_ += side_step_;
    if (--ramp_remaining_ == 0u) {
      mid_gain_ = target_mid_gain_;
      side_gain_ = target_side_gain_;
    }
  }

  double mid_gain_ = 1.0;
  double side_gain_ = 1.0;
  double target_mid_gain_ = 1.0;
  double target_side_gain_ = 1.0;
  double mid_step_ = 0.0;
  double side_step_ = 0.0;
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t ramp_remaining_ = 0u;
  bool initialized_ = false;
};

} // namespace effetune::plugins::spatial

EFFETUNE_REGISTER_KERNEL(MSMatrixPlugin, effetune::plugins::spatial::MSMatrixKernel)
