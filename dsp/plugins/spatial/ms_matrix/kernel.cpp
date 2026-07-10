#include "effetune/kernel.h"
#include "MSMatrixPluginParams.h"

#include <cmath>
#include <cstdint>

namespace effetune::plugins::spatial {

class MSMatrixKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MSMatrixPluginParams)

public:
  void prepare(const PrepareInfo &) override {}

  void reset() noexcept override { updateGains(); }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (channel_count != 2u) {
      return;
    }
    if (paramsDirty()) {
      updateGains();
    }

    float *left = audio;
    float *right = audio + frame_count;
    const bool swap = params_.swap == 1.0F;

    if (params_.mode == 0.0F) {
      for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
        double left_sample = static_cast<double>(left[frame]);
        double right_sample = static_cast<double>(right[frame]);
        if (swap) {
          const double temporary = left_sample;
          left_sample = right_sample;
          right_sample = temporary;
        }
        const double mid = (left_sample + right_sample) * 0.5;
        const double side = (left_sample - right_sample) * 0.5;
        left[frame] = static_cast<float>(mid * mid_gain_);
        right[frame] = static_cast<float>(side * side_gain_);
      }
      return;
    }

    for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
      const double mid_output = static_cast<double>(left[frame]) * mid_gain_;
      const double side_output = static_cast<double>(right[frame]) * side_gain_;
      if (swap) {
        left[frame] = static_cast<float>(mid_output - side_output);
        right[frame] = static_cast<float>(mid_output + side_output);
      } else {
        left[frame] = static_cast<float>(mid_output + side_output);
        right[frame] = static_cast<float>(mid_output - side_output);
      }
    }
  }

private:
  void updateGains() noexcept {
    mid_gain_ = std::pow(10.0, static_cast<double>(params_.midGain) / 20.0);
    side_gain_ = std::pow(10.0, static_cast<double>(params_.sideGain) / 20.0);
  }

  double mid_gain_ = 1.0;
  double side_gain_ = 1.0;
};

} // namespace effetune::plugins::spatial

EFFETUNE_REGISTER_KERNEL(MSMatrixPlugin, effetune::plugins::spatial::MSMatrixKernel)
