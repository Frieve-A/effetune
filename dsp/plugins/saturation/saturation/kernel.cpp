#include "effetune/kernel.h"
#include "SaturationPluginParams.h"

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace effetune::plugins::saturation {

class SaturationKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::SaturationPluginParams)

public:
  void prepare(const PrepareInfo &) override {}

  void reset() noexcept override { updateCoefficients(); }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (paramsDirty()) {
      updateCoefficients();
    }

    const std::size_t sample_count = static_cast<std::size_t>(channel_count) * frame_count;
    for (std::size_t index = 0; index < sample_count; ++index) {
      const double dry = static_cast<double>(audio[index]);
      const double wet = std::tanh(drive_ * (dry + bias_)) - bias_offset_;
      audio[index] = static_cast<float>((dry * dry_ratio_ + wet * mix_ratio_) * gain_);
    }
  }

private:
  void updateCoefficients() noexcept {
    drive_ = static_cast<double>(params_.drive);
    bias_ = static_cast<double>(params_.bias);
    mix_ratio_ = static_cast<double>(params_.mix) / 100.0;
    dry_ratio_ = 1.0 - mix_ratio_;
    gain_ = std::pow(10.0, static_cast<double>(params_.gain) / 20.0);
    bias_offset_ = std::tanh(drive_ * bias_);
  }

  double drive_ = 0.0;
  double bias_ = 0.0;
  double mix_ratio_ = 0.0;
  double dry_ratio_ = 1.0;
  double gain_ = 1.0;
  double bias_offset_ = 0.0;
};

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(SaturationPlugin, effetune::plugins::saturation::SaturationKernel)
