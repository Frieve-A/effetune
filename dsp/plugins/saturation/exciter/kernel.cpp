#include "effetune/kernel.h"
#include "ExciterPluginParams.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::saturation {
namespace {

constexpr double kPi = 3.141592653589793;
constexpr double kSqrtTwo = 1.4142135623730951;

struct ExciterFilterState final {
  double x1 = 0.0;
  double y1 = 0.0;
  double x2 = 0.0;
  double y2 = 0.0;
};

} // namespace

class ExciterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::ExciterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    states_.resize(max_channels_);
  }

  void reset() noexcept override {
    clearState();
    initialized_ = false;
    last_channel_count_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }
    if (!initialized_ || last_channel_count_ != channel_count) {
      clearState();
      initialized_ = true;
      last_channel_count_ = channel_count;
    }

    std::uint32_t slope = static_cast<std::uint32_t>(params_.highPassSlope);
    if (slope > 2u) {
      slope = 2u;
    }
    const double omega =
        std::tan(kPi * static_cast<double>(params_.highPassFrequency) / sample_rate_);
    double b0 = 0.0;
    double b1 = 0.0;
    double b2 = 0.0;
    double a1 = 0.0;
    double a2 = 0.0;
    if (slope == 1u) {
      const double normalization = 1.0 / (1.0 + omega);
      b0 = normalization;
      b1 = -normalization;
      a1 = (omega - 1.0) * normalization;
    } else if (slope == 2u) {
      const double omega_squared = omega * omega;
      const double normalization = 1.0 / (1.0 + kSqrtTwo * omega + omega_squared);
      b0 = normalization;
      b1 = -2.0 * normalization;
      b2 = normalization;
      a1 = 2.0 * (omega_squared - 1.0) * normalization;
      a2 = (1.0 - kSqrtTwo * omega + omega_squared) * normalization;
    }
    const double drive = static_cast<double>(params_.drive);
    const double bias = static_cast<double>(params_.bias);
    const double mix = static_cast<double>(params_.mix) * 0.01;
    const double bias_offset = std::tanh(drive * bias);

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      ExciterFilterState &state = states_[channel];
      double x1 = state.x1;
      double y1 = state.y1;
      double x2 = state.x2;
      double y2 = state.y2;
      if (slope == 1u) {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const double dry = static_cast<double>(audio[offset + frame]);
          const double filtered = b0 * dry + b1 * x1 - a1 * y1;
          x1 = dry;
          const double magnitude = filtered >= 0.0 ? filtered : -filtered;
          y1 = magnitude < 1.0e-25 ? 0.0 : filtered;
          const double wet = std::tanh(drive * (y1 + bias)) - bias_offset;
          audio[offset + frame] = static_cast<float>(dry + wet * mix);
        }
      } else if (slope == 2u) {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const double dry = static_cast<double>(audio[offset + frame]);
          const double filtered = b0 * dry + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1;
          x1 = dry;
          y2 = y1;
          const double magnitude = filtered >= 0.0 ? filtered : -filtered;
          y1 = magnitude < 1.0e-25 ? 0.0 : filtered;
          const double wet = std::tanh(drive * (y1 + bias)) - bias_offset;
          audio[offset + frame] = static_cast<float>(dry + wet * mix);
        }
      } else {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const double dry = static_cast<double>(audio[offset + frame]);
          const double wet = std::tanh(drive * (dry + bias)) - bias_offset;
          audio[offset + frame] = static_cast<float>(dry + wet * mix);
        }
      }
      state.x1 = x1;
      state.y1 = y1;
      state.x2 = x2;
      state.y2 = y2;
    }
  }

private:
  void clearState() noexcept {
    for (ExciterFilterState &state : states_) {
      state = {};
    }
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool initialized_ = false;
  std::vector<ExciterFilterState> states_;
};

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(ExciterPlugin, effetune::plugins::saturation::ExciterKernel)
