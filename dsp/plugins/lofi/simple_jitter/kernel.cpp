#include "effetune/kernel.h"
#include "SimpleJitterPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr double kMinimumJitterNanoseconds = 0.001;
constexpr double kNanosecondsPerSecond = 1.0e9;
constexpr double kSqrtThree = 1.7320508075688772;

} // namespace

class SimpleJitterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::SimpleJitterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    buffer_size_ = static_cast<std::uint32_t>(sample_rate_ * 0.02 + 0.999);
    if (buffer_size_ == 0u) {
      buffer_size_ = 1u;
    }
    sample_buffer_.resize(static_cast<std::size_t>(max_channels_) * buffer_size_);
  }

  void reset() noexcept override {
    clearBuffer();
    buffer_position_ = 0u;
    last_channel_count_ = 0u;
    initialized_ = false;
    random_.seed(selected_seed_low_, selected_seed_high_);
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    random_.seed(seed_low, seed_high);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }
    if (!initialized_ || last_channel_count_ != channel_count) {
      clearBuffer();
      if (!initialized_) {
        buffer_position_ = 0u;
      } else if (buffer_position_ >= buffer_size_) {
        buffer_position_ = 0u;
      }
      initialized_ = true;
      last_channel_count_ = channel_count;
    }

    double jitter_parameter = static_cast<double>(params_.rmsJitter);
    if (jitter_parameter < -200.0) {
      jitter_parameter = -200.0;
    } else if (jitter_parameter > 200.0) {
      jitter_parameter = 200.0;
    }
    const double rms_jitter = kMinimumJitterNanoseconds * std::pow(10.0, jitter_parameter / 20.0);
    const double jitter_scale = rms_jitter * kSqrtThree;
    const double nanoseconds_to_samples = sample_rate_ / kNanosecondsPerSecond;
    std::uint32_t position = buffer_position_;

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double random_value = random_.nextFloat01();
      const double positive_random = random_value >= 0.0 ? random_value : -random_value;
      const double jitter_samples = positive_random * jitter_scale * nanoseconds_to_samples;
      const double delay_position = std::fmod(static_cast<double>(position) - jitter_samples +
                                                  static_cast<double>(buffer_size_),
                                              static_cast<double>(buffer_size_));
      const std::uint32_t delay_index = static_cast<std::uint32_t>(delay_position);
      const double fraction = delay_position - static_cast<double>(delay_index);
      std::uint32_t next_index = delay_index + 1u;
      if (next_index == buffer_size_) {
        next_index = 0u;
      }

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::uint32_t audio_index = channel * frame_count + frame;
        const std::size_t buffer_offset = static_cast<std::size_t>(channel) * buffer_size_;
        const float input = audio[audio_index];
        sample_buffer_[buffer_offset + position] = input;
        const double first = static_cast<double>(sample_buffer_[buffer_offset + delay_index]);
        const double second = static_cast<double>(sample_buffer_[buffer_offset + next_index]);
        audio[audio_index] = static_cast<float>(first + fraction * (second - first));
      }

      ++position;
      if (position == buffer_size_) {
        position = 0u;
      }
    }
    buffer_position_ = position;
  }

private:
  void clearBuffer() noexcept {
    for (float &sample : sample_buffer_) {
      sample = 0.0F;
    }
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t buffer_size_ = 0u;
  std::uint32_t buffer_position_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool initialized_ = false;
  std::vector<float> sample_buffer_;
  dsp::XorShiftRng random_{};
};

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(SimpleJitterPlugin, effetune::plugins::lofi::SimpleJitterKernel)
