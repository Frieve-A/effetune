#include "effetune/kernel.h"
#include "NetworkReceivePluginParams.h"

namespace effetune::plugins::control {

class NetworkReceivePluginKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::NetworkReceivePluginParams)

public:
  void prepare(const PrepareInfo &) override {}
  void reset() noexcept override {}
  void process(float *, std::uint32_t, std::uint32_t, const ProcessInfo &) noexcept override {}
};

} // namespace effetune::plugins::control

EFFETUNE_REGISTER_KERNEL(NetworkReceivePlugin,
                         effetune::plugins::control::NetworkReceivePluginKernel)
