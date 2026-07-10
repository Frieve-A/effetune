#include "effetune/kernel.h"
#include "VolumePluginParams.h"

#include <cmath>
#include <cstdint>

namespace effetune::plugins::basics {

class VolumeKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::VolumePluginParams)

public:
  void prepare(const PrepareInfo &) override {}

  void reset() noexcept override { updateGain(); }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (paramsDirty()) {
      updateGain();
    }

    const std::uint32_t sample_count = channel_count * frame_count;
    for (std::uint32_t index = 0; index < sample_count; ++index) {
      audio[index] = static_cast<float>(static_cast<double>(audio[index]) * gain_);
    }
  }

private:
  void updateGain() noexcept { gain_ = std::pow(10.0, static_cast<double>(params_.volume) / 20.0); }

  double gain_ = 1.0;
};

} // namespace effetune::plugins::basics

EFFETUNE_REGISTER_KERNEL(VolumePlugin, effetune::plugins::basics::VolumeKernel)
