#include "effetune/kernel.h"
#include "StereoBalancePluginParams.h"

#include <cstdint>

namespace effetune::plugins::basics {

class StereoBalanceKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::StereoBalancePluginParams)

public:
  void prepare(const PrepareInfo &) override {}

  void reset() noexcept override {}

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (channel_count < 2u) {
      return;
    }

    const double balance = static_cast<double>(params_.balance);
    const double left_gain = balance <= 0.0 ? 1.0 : 1.0 - balance;
    const double right_gain = balance >= 0.0 ? 1.0 : 1.0 + balance;

    for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
      audio[frame] = static_cast<float>(static_cast<double>(audio[frame]) * left_gain);
    }

    const std::uint32_t sample_count = channel_count * frame_count;
    for (std::uint32_t index = frame_count; index < sample_count; ++index) {
      audio[index] = static_cast<float>(static_cast<double>(audio[index]) * right_gain);
    }
  }
};

} // namespace effetune::plugins::basics

EFFETUNE_REGISTER_KERNEL(StereoBalancePlugin, effetune::plugins::basics::StereoBalanceKernel)
