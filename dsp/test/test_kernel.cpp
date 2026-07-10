#include "effetune/kernel.h"

#include <cstdint>

namespace effetune::test {

struct TestGainParams {
  float gain;
  static constexpr std::uint32_t kHash = 0xa17e5eedu;
  static constexpr std::uint32_t kFloatCount = 1;
};

class TestGainKernel final : public PluginKernel {
  EFFETUNE_PARAMS(TestGainParams)

public:
  void prepare(const PrepareInfo &) override {}

  void reset() noexcept override {}

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    const std::uint32_t samples = channel_count * frame_count;
    for (std::uint32_t index = 0; index < samples; ++index) {
      audio[index] *= params_.gain;
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    writer.write(0x7fffu, 1u, &params_.gain, static_cast<std::uint16_t>(sizeof(params_.gain)));
  }
};

} // namespace effetune::test

EFFETUNE_REGISTER_KERNEL(TestGainPlugin, effetune::test::TestGainKernel)
