#include "effetune/kernel.h"
#include "StereoBlendPluginParams.h"

#include <cstdint>

namespace effetune::plugins::spatial {

class StereoBlendKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::StereoBlendPluginParams)

public:
  void prepare(const PrepareInfo &) override {}

  void reset() noexcept override {}

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (channel_count < 2u) {
      return;
    }

    float *left = audio;
    float *right = audio + frame_count;
    const double side_gain = static_cast<double>(params_.stereo) / 100.0;
    for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
      const double left_sample = static_cast<double>(left[frame]);
      const double right_sample = static_cast<double>(right[frame]);
      const double mid = (left_sample + right_sample) * 0.5;
      const double side = (left_sample - right_sample) * 0.5;
      const double scaled_side = side * side_gain;
      left[frame] = static_cast<float>(mid + scaled_side);
      right[frame] = static_cast<float>(mid - scaled_side);
    }
  }
};

} // namespace effetune::plugins::spatial

EFFETUNE_REGISTER_KERNEL(StereoBlendPlugin, effetune::plugins::spatial::StereoBlendKernel)
