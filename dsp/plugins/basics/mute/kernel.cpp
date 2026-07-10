#include "effetune/kernel.h"
#include "MutePluginParams.h"

#include <cstdint>

namespace effetune::plugins::basics {

class MuteKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MutePluginParams)

public:
  void prepare(const PrepareInfo &) override {}

  void reset() noexcept override {}

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    const std::uint32_t sample_count = channel_count * frame_count;
    for (std::uint32_t index = 0; index < sample_count; ++index) {
      audio[index] = 0.0f;
    }
  }
};

} // namespace effetune::plugins::basics

EFFETUNE_REGISTER_KERNEL(MutePlugin, effetune::plugins::basics::MuteKernel)
