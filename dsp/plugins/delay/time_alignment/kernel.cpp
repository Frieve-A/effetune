#include "effetune/kernel.h"
#include "TimeAlignmentPluginParams.h"
#include "effetune/dsp/delay_line.h"

#include <algorithm>
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
    const auto calculated_ramp = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));
    ramp_frames_ = calculated_ramp == 0u ? 1u : calculated_ramp;
  }

  void reset() noexcept override {
    delay_.reset();
    configured_ = false;
    delay_initialized_ = false;
    ramp_remaining_ = 0u;
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

    retargetDelay();

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::uint32_t offset = channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const float input = audio[offset + frame];
        const double delay_samples = delayAtFrame(frame);
        audio[offset + frame] = readFractional(channel, input, delay_samples);
        delay_.push(channel, input);
      }
    }
    advanceDelay(frame_count);
  }

private:
  void retargetDelay() noexcept {
    const double maximum = static_cast<double>(delay_.maxDelaySamples());
    const double target =
        std::clamp(static_cast<double>(params_.delay) * sample_rate_ / 1000.0, 0.0, maximum);
    if (!delay_initialized_) {
      current_delay_ = target_delay_ = target;
      delay_initialized_ = true;
      return;
    }
    if (target == target_delay_)
      return;
    target_delay_ = target;
    delay_step_ = (target_delay_ - current_delay_) / static_cast<double>(ramp_frames_);
    ramp_remaining_ = ramp_frames_;
  }

  double delayAtFrame(std::uint32_t frame) const noexcept {
    if (ramp_remaining_ == 0u)
      return current_delay_;
    const std::uint32_t elapsed = frame + 1u;
    const std::uint32_t progressed = elapsed < ramp_remaining_ ? elapsed : ramp_remaining_;
    return progressed == ramp_remaining_ && frame + 1u >= ramp_remaining_
               ? target_delay_
               : current_delay_ + delay_step_ * static_cast<double>(progressed);
  }

  float readFractional(std::uint32_t channel, float input, double delay_samples) const noexcept {
    if (delay_samples <= 0.0)
      return input;
    const std::uint32_t lower = static_cast<std::uint32_t>(delay_samples);
    const double fraction = delay_samples - static_cast<double>(lower);
    const float lower_sample = lower == 0u ? input : delay_.read(channel, lower - 1u);
    if (fraction == 0.0 || lower >= delay_.maxDelaySamples())
      return lower_sample;
    const float upper_sample = delay_.read(channel, lower);
    return static_cast<float>(static_cast<double>(lower_sample) +
                              (static_cast<double>(upper_sample) - lower_sample) * fraction);
  }

  void advanceDelay(std::uint32_t frames) noexcept {
    const std::uint32_t count = frames < ramp_remaining_ ? frames : ramp_remaining_;
    current_delay_ += delay_step_ * static_cast<double>(count);
    ramp_remaining_ -= count;
    if (ramp_remaining_ == 0u)
      current_delay_ = target_delay_;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool configured_ = false;
  bool delay_initialized_ = false;
  double current_delay_ = 0.0;
  double target_delay_ = 0.0;
  double delay_step_ = 0.0;
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t ramp_remaining_ = 0u;
  dsp::DelayLine delay_;
};

} // namespace effetune::plugins::delay

EFFETUNE_REGISTER_KERNEL(TimeAlignmentPlugin, effetune::plugins::delay::TimeAlignmentKernel)
