#include "effetune/kernel.h"
#include "TimeAlignmentPluginParams.h"
#include "effetune/dsp/delay_line.h"

#include <cmath>
#include <cstdint>

namespace effetune::plugins::delay {

class TimeAlignmentKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::TimeAlignmentPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    const std::uint32_t max_delay = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.1));
    static_cast<void>(delay_.prepare(max_channels_, max_delay));
  }

  void reset() noexcept override {
    delay_.reset();
    configured_ = false;
    last_channel_count_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }
    if (!configured_ || last_channel_count_ != channel_count) {
      delay_.reset();
      last_channel_count_ = channel_count;
      configured_ = true;
    }

    std::uint32_t delay_samples =
        static_cast<std::uint32_t>(static_cast<double>(params_.delay) * sample_rate_ / 1000.0);
    const std::uint32_t maximum = delay_.maxDelaySamples();
    if (delay_samples > maximum) {
      delay_samples = maximum;
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      if (delay_samples == 0u) {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          delay_.push(channel, audio[offset + frame]);
        }
      } else {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const float input = audio[offset + frame];
          audio[offset + frame] = delay_.read(channel, delay_samples - 1u);
          delay_.push(channel, input);
        }
      }
    }
  }

private:
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool configured_ = false;
  dsp::DelayLine delay_;
};

} // namespace effetune::plugins::delay

EFFETUNE_REGISTER_KERNEL(TimeAlignmentPlugin, effetune::plugins::delay::TimeAlignmentKernel)
