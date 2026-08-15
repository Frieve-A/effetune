#include "effetune/kernel.h"
#include "CombFilterPluginParams.h"

#include <algorithm>
#include <cmath>
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
    delay_initialized_ = false;
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
    const double requested_delay = sample_rate_ / frequency;
    const double delay = requested_delay < 2.0 ? 2.0 : requested_delay;
    if (delay > static_cast<double>(max_delay_)) {
      return;
    }
    if (!configured_ || last_channel_count_ != channel_count) {
      clearDelay(channel_count);
    }
    if (!delay_initialized_) {
      delay_.snap(delay);
      delay_initialized_ = true;
    } else {
      const auto requested_frames = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));
      const auto transition_frames = requested_frames == 0u ? 1u : requested_frames;
      delay_.retarget(delay, transition_frames);
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
        const double delayed = readDelay(delay_offset, write_position, delay_.value(frame));
        const double wet = input + feedback * delayed;
        delay_buffer_[delay_offset + write_position] =
            feedforward ? static_cast<float>(input) : static_cast<float>(wet);
        ++write_position;
        if (write_position == max_delay_) {
          write_position = 0u;
        }
        audio[audio_offset + frame] = static_cast<float>((1.0 - mix) * input + mix * wet);
      }
      write_positions_[channel] = write_position;
    }
    delay_.advance(frame_count);
  }

private:
  struct DelayRamp {
    double current = 0.0;
    double target = 0.0;
    double step = 0.0;
    std::uint32_t remaining = 0u;
    void snap(double value) noexcept {
      current = target = value;
      step = 0.0;
      remaining = 0u;
    }
    void retarget(double value, std::uint32_t frames) noexcept {
      if (value == target)
        return;
      target = value;
      remaining = frames;
      step = (target - current) / static_cast<double>(frames);
    }
    [[nodiscard]] double value(std::uint32_t frame) const noexcept {
      const std::uint32_t elapsed = frame + 1u;
      return elapsed >= remaining ? target : current + step * static_cast<double>(elapsed);
    }
    void advance(std::uint32_t frames) noexcept {
      if (frames >= remaining) {
        current = target;
        remaining = 0u;
        step = 0.0;
      } else {
        current += step * static_cast<double>(frames);
        remaining -= frames;
      }
    }
  };

  [[nodiscard]] double readDelay(std::size_t offset, std::uint32_t write,
                                 double delay) const noexcept {
    const auto newer_delay = static_cast<std::uint32_t>(delay);
    const double fraction = delay - static_cast<double>(newer_delay);
    const std::uint32_t newer = (write + max_delay_ - newer_delay) % max_delay_;
    const std::uint32_t older = newer == 0u ? max_delay_ - 1u : newer - 1u;
    const double newer_sample = static_cast<double>(delay_buffer_[offset + newer]);
    const double older_sample = static_cast<double>(delay_buffer_[offset + older]);
    return newer_sample + (older_sample - newer_sample) * fraction;
  }

  void clearDelay(std::uint32_t channel_count) noexcept {
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t offset = static_cast<std::size_t>(channel) * max_delay_;
      for (std::uint32_t sample = 0u; sample < max_delay_; ++sample) {
        delay_buffer_[offset + sample] = 0.0F;
      }
      write_positions_[channel] = 0u;
    }
    last_channel_count_ = channel_count;
    configured_ = true;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_delay_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool configured_ = false;
  bool delay_initialized_ = false;
  DelayRamp delay_;
  std::vector<float> delay_buffer_;
  std::vector<std::uint32_t> write_positions_;
};

} // namespace effetune::plugins::eq

EFFETUNE_REGISTER_KERNEL(CombFilterPlugin, effetune::plugins::eq::CombFilterKernel)
