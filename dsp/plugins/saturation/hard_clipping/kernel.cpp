#include "effetune/kernel.h"
#include "HardClippingPluginParams.h"
#include "effetune/dsp/denormal_noise.h"
#include "effetune/dsp/oversampled_shaper.h"

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
    shaper_.prepare(info.maxChannels * 1u);
    // Two channel lanes each own one oversampled block.
    oversampled_.resize(static_cast<std::size_t>(info.maxFrames) * kOversampleFactor * 2u);
    low_pass_previous_.resize(info.maxChannels);
    interpolation_previous_.resize(info.maxChannels);
  }

  void reset() noexcept override {
    shaper_.reset();
    for (double &previous : low_pass_previous_) {
      previous = 0.0;
    }
    for (double &previous : interpolation_previous_) {
      previous = 0.0;
    }
    active_channel_count_ = 0u;
    updateThreshold();
    denormal_noise_.reset();
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    shaper_.configure(dsp::OversampledShaper::factor(params_.oversampling, 16u),
                      channel_count * 1u);
    const std::size_t oversampled_count = static_cast<std::size_t>(frame_count) * kOversampleFactor;
    if (channel_count == 0u || frame_count == 0u || channel_count > low_pass_previous_.size() ||
        oversampled_count > oversampled_.size() / 2u) {
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
    if (dsp::OversampledShaper::factor(params_.oversampling, 16u) > 1u) {
      for (std::uint32_t channel = 0; channel < channel_count; ++channel) {
        low_pass_previous_[channel] = 0.0;
        interpolation_previous_[channel] = 0.0;
        for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
          const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
          audio[index] =
              static_cast<float>(shaper_.process(channel, audio[index], [&](double sample) {
                if (mode != 2u && sample > threshold_)
                  return threshold_;
                if (mode != 1u && sample < negative_threshold)
                  return negative_threshold;
                return sample;
              }));
        }
      }
      return;
    }
    // Channel pairs share one low-pass loop so their independent recursions overlap.
    for (std::uint32_t channel = 0; channel < channel_count; channel += 2u) {
      if (channel + 1u < channel_count)
        processLanes<2u>(audio, channel, frame_count, mode, negative_threshold);
      else
        processLanes<1u>(audio, channel, frame_count, mode, negative_threshold);
    }
    denormal_noise_.advance(frame_count);
  }

  [[nodiscard]] LatencyRange latencyRange() const noexcept override {
    return {0u, dsp::OversampledShaper::kLatency};
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    const auto &parameters = params_pending_ ? staged_params_ : params_;
    return dsp::OversampledShaper::factor(parameters.oversampling, 16u) == 1u
               ? 0u
               : dsp::OversampledShaper::kLatency;
  }

private:
  // Linearly upsamples one channel by four and clips it in place.
  void upsampleAndClip(const float *input, float *oversampled, std::uint32_t channel,
                       std::uint32_t frame_count, std::uint32_t mode,
                       double negative_threshold) noexcept {
    const std::size_t oversampled_count = static_cast<std::size_t>(frame_count) * kOversampleFactor;
    double interpolation_previous = interpolation_previous_[channel];
    for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
      const double first = interpolation_previous;
      const double second = static_cast<double>(input[frame]);
      const double delta = second - first;
      const std::size_t output_index = static_cast<std::size_t>(frame) * kOversampleFactor;
      oversampled[output_index] = static_cast<float>(first);
      oversampled[output_index + 1u] = static_cast<float>(first + 0.25 * delta);
      oversampled[output_index + 2u] = static_cast<float>(first + 0.5 * delta);
      oversampled[output_index + 3u] = static_cast<float>(first + 0.75 * delta);
      interpolation_previous = second;
    }
    interpolation_previous_[channel] = interpolation_previous;

    if (mode == 0u) {
      for (std::size_t index = 0; index < oversampled_count; ++index) {
        const double sample = static_cast<double>(oversampled[index]);
        if (sample > threshold_) {
          oversampled[index] = static_cast<float>(threshold_);
        } else if (sample < negative_threshold) {
          oversampled[index] = static_cast<float>(negative_threshold);
        }
      }
    } else if (mode == 1u) {
      for (std::size_t index = 0; index < oversampled_count; ++index) {
        if (static_cast<double>(oversampled[index]) > threshold_) {
          oversampled[index] = static_cast<float>(threshold_);
        }
      }
    } else {
      for (std::size_t index = 0; index < oversampled_count; ++index) {
        if (static_cast<double>(oversampled[index]) < negative_threshold) {
          oversampled[index] = static_cast<float>(negative_threshold);
        }
      }
    }
  }

  template <std::uint32_t Lanes>
  void processLanes(float *audio, std::uint32_t channel, std::uint32_t frame_count,
                    std::uint32_t mode, double negative_threshold) noexcept {
    const std::size_t stride = oversampled_.size() / 2u;
    float *data[Lanes];
    const float *oversampled[Lanes];
    double previous[Lanes];
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
      data[lane] = audio + static_cast<std::size_t>(channel + lane) * frame_count;
      float *const buffer = oversampled_.data() + lane * stride;
      upsampleAndClip(data[lane], buffer, channel + lane, frame_count, mode, negative_threshold);
      oversampled[lane] = buffer;
      previous[lane] = low_pass_previous_[channel + lane];
    }
    for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
      const std::size_t index = static_cast<std::size_t>(frame) * kOversampleFactor;
      const double noise = denormal_noise_.sample(frame);
      for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
        const float *const block = oversampled[lane] + index;
        const double fir_output =
            static_cast<double>(block[0]) * 0.125 + static_cast<double>(block[1]) * 0.375 +
            static_cast<double>(block[2]) * 0.375 + static_cast<double>(block[3]) * 0.125;
        previous[lane] =
            kLowPassCoefficient * fir_output + kLowPassComplement * previous[lane] + noise;
        data[lane][frame] = static_cast<float>(previous[lane]);
      }
    }
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane)
      low_pass_previous_[channel + lane] = previous[lane];
  }

  void updateThreshold() noexcept {
    threshold_ = params_.threshold == 0.0F
                     ? 1.0
                     : std::pow(10.0, static_cast<double>(params_.threshold) / 20.0);
  }

  dsp::OversampledShaper shaper_;
  std::vector<float> oversampled_;
  std::vector<double> low_pass_previous_;
  std::vector<double> interpolation_previous_;
  double threshold_ = 1.0;
  std::uint32_t active_channel_count_ = 0u;
  dsp::NyquistDenormalNoise denormal_noise_;
};

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(HardClippingPlugin, effetune::plugins::saturation::HardClippingKernel)
