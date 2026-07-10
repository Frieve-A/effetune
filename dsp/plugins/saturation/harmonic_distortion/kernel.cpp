#include "effetune/kernel.h"
#include "HarmonicDistortionPluginParams.h"

#include <cstdint>

namespace effetune::plugins::saturation {

class HarmonicDistortionKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::HarmonicDistortionPluginParams)

public:
  void prepare(const PrepareInfo &info) override { max_channels_ = info.maxChannels; }

  void reset() noexcept override {}

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }
    const double second = -static_cast<double>(params_.secondHarmonic) * 0.01;
    const double third = -static_cast<double>(params_.thirdHarmonic) * 0.01;
    const double fourth = -static_cast<double>(params_.fourthHarmonic) * 0.01;
    const double fifth = -static_cast<double>(params_.fifthHarmonic) * 0.01;
    const double sensitivity = static_cast<double>(params_.sensitivity);
    const double inverse_sensitivity = 1.0 / (sensitivity + 1.0e-9);

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double scaled = static_cast<double>(audio[offset + frame]) * sensitivity;
        const double squared = scaled * scaled;
        const double cubed = squared * scaled;
        const double fourth_power = squared * squared;
        const double fifth_power = fourth_power * scaled;
        const double nonlinear =
            scaled + second * squared + third * cubed + fourth * fourth_power + fifth * fifth_power;
        audio[offset + frame] = static_cast<float>(nonlinear * inverse_sensitivity);
      }
    }
  }

private:
  std::uint32_t max_channels_ = 0u;
};

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(HarmonicDistortionPlugin,
                         effetune::plugins::saturation::HarmonicDistortionKernel)
