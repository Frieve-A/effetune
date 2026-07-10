#include "effetune/kernel.h"
#include "HornResonatorPlusPluginParams.h"

#include "../horn_waveguide_common.h"

namespace effetune::plugins::resonator {

class HornResonatorPlusKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::HornResonatorPlusPluginParams)

public:
  void prepare(const PrepareInfo &info) override { processor_.prepare(info); }

  void reset() noexcept override { processor_.reset(); }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    processor_.process<horn_waveguide::Variant::Plus>(audio, channel_count, frame_count,
                                                      horn_waveguide::fromGeneratedParams(params_));
  }

private:
  horn_waveguide::Processor processor_;
};

static_assert(sizeof(HornResonatorPlusKernel) <= 8192u);

} // namespace effetune::plugins::resonator

EFFETUNE_REGISTER_KERNEL(HornResonatorPlusPlugin,
                         effetune::plugins::resonator::HornResonatorPlusKernel)
