#include "effetune/kernel.h"
#include "HardClippingPluginParams.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::saturation {
namespace {

constexpr std::size_t kOversampleFactor = 4u;
constexpr double kLowPassCoefficient = 0.3;
constexpr double kLowPassComplement = 1.0 - kLowPassCoefficient;

} // namespace

class HardClippingKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::HardClippingPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    oversampled_.resize(static_cast<std::size_t>(info.maxFrames) * kOversampleFactor);
    low_pass_previous_.resize(info.maxChannels);
    interpolation_previous_.resize(info.maxChannels);
  }

  void reset() noexcept override {
    for (double &previous : low_pass_previous_) {
      previous = 0.0;
    }
    for (double &previous : interpolation_previous_) {
      previous = 0.0;
    }
    active_channel_count_ = 0u;
    updateThreshold();
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    const std::size_t oversampled_count = static_cast<std::size_t>(frame_count) * kOversampleFactor;
    if (channel_count == 0u || frame_count == 0u || channel_count > low_pass_previous_.size() ||
        oversampled_count > oversampled_.size()) {
      return;
    }
    if (paramsDirty()) {
      updateThreshold();
    }
    if (active_channel_count_ != channel_count) {
      for (double &previous : low_pass_previous_) {
        previous = 0.0;
      }
      for (double &previous : interpolation_previous_) {
        previous = 0.0;
      }
      active_channel_count_ = channel_count;
    }

    const std::uint32_t mode = static_cast<std::uint32_t>(params_.mode);
    const double negative_threshold = -threshold_;
    for (std::uint32_t channel = 0; channel < channel_count; ++channel) {
      const std::size_t channel_offset = static_cast<std::size_t>(channel) * frame_count;
      double interpolation_previous = interpolation_previous_[channel];

      for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
        const std::size_t input_index = channel_offset + frame;
        const double first = interpolation_previous;
        const double second = static_cast<double>(audio[input_index]);
        const double delta = second - first;
        const std::size_t output_index = static_cast<std::size_t>(frame) * kOversampleFactor;
        oversampled_[output_index] = static_cast<float>(first);
        oversampled_[output_index + 1u] = static_cast<float>(first + 0.25 * delta);
        oversampled_[output_index + 2u] = static_cast<float>(first + 0.5 * delta);
        oversampled_[output_index + 3u] = static_cast<float>(first + 0.75 * delta);
        interpolation_previous = second;
      }
      interpolation_previous_[channel] = interpolation_previous;

      if (mode == 0u) {
        for (std::size_t index = 0; index < oversampled_count; ++index) {
          const double sample = static_cast<double>(oversampled_[index]);
          if (sample > threshold_) {
            oversampled_[index] = static_cast<float>(threshold_);
          } else if (sample < negative_threshold) {
            oversampled_[index] = static_cast<float>(negative_threshold);
          }
        }
      } else if (mode == 1u) {
        for (std::size_t index = 0; index < oversampled_count; ++index) {
          if (static_cast<double>(oversampled_[index]) > threshold_) {
            oversampled_[index] = static_cast<float>(threshold_);
          }
        }
      } else {
        for (std::size_t index = 0; index < oversampled_count; ++index) {
          if (static_cast<double>(oversampled_[index]) < negative_threshold) {
            oversampled_[index] = static_cast<float>(negative_threshold);
          }
        }
      }

      double previous = low_pass_previous_[channel];
      for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
        const std::size_t index = static_cast<std::size_t>(frame) * kOversampleFactor;
        const double fir_output = static_cast<double>(oversampled_[index]) * 0.125 +
                                  static_cast<double>(oversampled_[index + 1u]) * 0.375 +
                                  static_cast<double>(oversampled_[index + 2u]) * 0.375 +
                                  static_cast<double>(oversampled_[index + 3u]) * 0.125;
        const double filtered = kLowPassCoefficient * fir_output + kLowPassComplement * previous;
        previous = filtered;
        audio[channel_offset + frame] = static_cast<float>(filtered);
      }
      low_pass_previous_[channel] = previous;
    }
  }

private:
  void updateThreshold() noexcept {
    threshold_ = params_.threshold == 0.0F
                     ? 1.0
                     : std::pow(10.0, static_cast<double>(params_.threshold) / 20.0);
  }

  std::vector<float> oversampled_;
  std::vector<double> low_pass_previous_;
  std::vector<double> interpolation_previous_;
  double threshold_ = 1.0;
  std::uint32_t active_channel_count_ = 0u;
};

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(HardClippingPlugin, effetune::plugins::saturation::HardClippingKernel)
