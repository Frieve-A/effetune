#include "effetune/kernel.h"
#include "HornResonatorPluginParams.h"

#include "../horn_waveguide_common.h"

namespace effetune::plugins::resonator {

class HornResonatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::HornResonatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override { processor_.prepare(info); }

  void reset() noexcept override { processor_.reset(); }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    processor_.process<horn_waveguide::Variant::Base>(audio, channel_count, frame_count,
                                                      horn_waveguide::fromGeneratedParams(params_));
  }

private:
  horn_waveguide::Processor processor_;
};

static_assert(sizeof(HornResonatorKernel) <= 8192u);

} // namespace effetune::plugins::resonator

EFFETUNE_REGISTER_KERNEL(HornResonatorPlugin, effetune::plugins::resonator::HornResonatorKernel)
