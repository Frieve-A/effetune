#include "effetune/kernel.h"
#include "NetworkSendPluginParams.h"

namespace effetune::plugins::control {

class NetworkSendPluginKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::NetworkSendPluginParams)

public:
  void prepare(const PrepareInfo &) override {}
  void reset() noexcept override {}
  void process(float *, std::uint32_t, std::uint32_t, const ProcessInfo &) noexcept override {}
};

} // namespace effetune::plugins::control

EFFETUNE_REGISTER_KERNEL(NetworkSendPlugin, effetune::plugins::control::NetworkSendPluginKernel)
