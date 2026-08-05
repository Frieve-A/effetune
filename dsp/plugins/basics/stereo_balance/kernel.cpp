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

    // Channels are stereo pairs: even index = left, odd index = right.
    for (std::uint32_t channel = 0; channel < channel_count; ++channel) {
      const double gain = (channel & 1u) == 0u ? left_gain : right_gain;
      float *samples = audio + static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
        samples[frame] = static_cast<float>(static_cast<double>(samples[frame]) * gain);
      }
    }
  }
};

} // namespace effetune::plugins::basics

EFFETUNE_REGISTER_KERNEL(StereoBalancePlugin, effetune::plugins::basics::StereoBalanceKernel)
