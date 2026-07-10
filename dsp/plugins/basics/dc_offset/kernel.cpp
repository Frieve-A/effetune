#include "effetune/kernel.h"
#include "DCOffsetPluginParams.h"

#include <cstdint>

namespace effetune::plugins::basics {

class DCOffsetKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::DCOffsetPluginParams)

public:
  void prepare(const PrepareInfo &) override {}

  void reset() noexcept override {}

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    const double offset = static_cast<double>(params_.offset);
    const std::uint32_t sample_count = channel_count * frame_count;
    for (std::uint32_t index = 0; index < sample_count; ++index) {
      audio[index] = static_cast<float>(static_cast<double>(audio[index]) + offset);
    }
  }
};

} // namespace effetune::plugins::basics

EFFETUNE_REGISTER_KERNEL(DCOffsetPlugin, effetune::plugins::basics::DCOffsetKernel)
