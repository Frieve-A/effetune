#include "effetune/kernel.h"
#include "StereoBalancePluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::basics {

class StereoBalanceKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::StereoBalancePluginParams)

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

    const double target = static_cast<double>(params_.balance);
    if (!initialized_) {
      current_balance_ = target;
      target_balance_ = target;
      initialized_ = true;
    } else if (target != target_balance_) {
      target_balance_ = target;
      balance_step_ = (target_balance_ - current_balance_) / static_cast<double>(ramp_frames_);
      ramp_remaining_ = ramp_frames_;
    }

    // Channels are stereo pairs: even index = left, odd index = right.
    for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
      if (ramp_remaining_ != 0u) {
        current_balance_ += balance_step_;
        if (--ramp_remaining_ == 0u)
          current_balance_ = target_balance_;
      }
      const double left_gain = current_balance_ <= 0.0 ? 1.0 : 1.0 - current_balance_;
      const double right_gain = current_balance_ >= 0.0 ? 1.0 : 1.0 + current_balance_;
      for (std::uint32_t channel = 0; channel < channel_count; ++channel) {
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        const double gain = (channel & 1u) == 0u ? left_gain : right_gain;
        audio[index] = static_cast<float>(static_cast<double>(audio[index]) * gain);
      }
    }
  }

private:
  double current_balance_ = 0.0;
  double target_balance_ = 0.0;
  double balance_step_ = 0.0;
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t ramp_remaining_ = 0u;
  bool initialized_ = false;
};

} // namespace effetune::plugins::basics

EFFETUNE_REGISTER_KERNEL(StereoBalancePlugin, effetune::plugins::basics::StereoBalanceKernel)
