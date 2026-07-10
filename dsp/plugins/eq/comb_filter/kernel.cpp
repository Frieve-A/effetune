#include "effetune/kernel.h"
#include "CombFilterPluginParams.h"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::eq {

class CombFilterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::CombFilterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    const std::uint32_t rounded_maximum = static_cast<std::uint32_t>(sample_rate_ / 20.0 + 0.5);
    max_delay_ = rounded_maximum < 2u ? 2u : rounded_maximum;
    delay_buffer_.resize(static_cast<std::size_t>(max_channels_) * max_delay_);
    write_positions_.resize(max_channels_);
  }

  void reset() noexcept override {
    configured_ = false;
    last_channel_count_ = 0u;
    last_delay_ = 0u;
    for (float &sample : delay_buffer_) {
      sample = 0.0F;
    }
    for (std::uint32_t &position : write_positions_) {
      position = 0u;
    }
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }

    const double frequency = static_cast<double>(params_.fundamentalFrequency);
    const std::uint32_t rounded_delay = static_cast<std::uint32_t>(sample_rate_ / frequency + 0.5);
    const std::uint32_t delay = rounded_delay < 2u ? 2u : rounded_delay;
    if (delay > max_delay_) {
      return;
    }
    if (!configured_ || last_channel_count_ != channel_count || last_delay_ != delay) {
      clearDelay(channel_count, delay);
    }

    const double feedback = static_cast<double>(params_.feedbackGain);
    const double mix = static_cast<double>(params_.dryWetMix) / 100.0;
    const bool feedforward = static_cast<int>(params_.combType) == 1;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t audio_offset = channel * frame_count;
      const std::size_t delay_offset = static_cast<std::size_t>(channel) * max_delay_;
      std::uint32_t write_position = write_positions_[channel];
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double input = static_cast<double>(audio[audio_offset + frame]);
        const double delayed = static_cast<double>(delay_buffer_[delay_offset + write_position]);
        const double wet = input + feedback * delayed;
        delay_buffer_[delay_offset + write_position] =
            feedforward ? static_cast<float>(input) : static_cast<float>(wet);
        ++write_position;
        if (write_position == delay) {
          write_position = 0u;
        }
        audio[audio_offset + frame] = static_cast<float>((1.0 - mix) * input + mix * wet);
      }
      write_positions_[channel] = write_position;
    }
  }

private:
  void clearDelay(std::uint32_t channel_count, std::uint32_t delay) noexcept {
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t offset = static_cast<std::size_t>(channel) * max_delay_;
      for (std::uint32_t sample = 0u; sample < delay; ++sample) {
        delay_buffer_[offset + sample] = 0.0F;
      }
      write_positions_[channel] = 0u;
    }
    last_channel_count_ = channel_count;
    last_delay_ = delay;
    configured_ = true;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_delay_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t last_delay_ = 0u;
  bool configured_ = false;
  std::vector<float> delay_buffer_;
  std::vector<std::uint32_t> write_positions_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(CombFilterPlugin, effetune::plugins::eq::CombFilterKernel)
