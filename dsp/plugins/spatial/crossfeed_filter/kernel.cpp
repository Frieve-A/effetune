#include "effetune/kernel.h"
#include "CrossfeedFilterPluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::spatial {
namespace {

constexpr double kTwoPi = 6.283185307179586;

} // namespace

class CrossfeedFilterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::CrossfeedFilterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = info.sampleRate;
    const double requested = std::ceil(static_cast<double>(sample_rate_) * 0.001) + 1.0;
    const std::size_t delay_size = requested > 2.0 ? static_cast<std::size_t>(requested) : 2u;
    delay_left_.resize(delay_size);
    delay_right_.resize(delay_size);
    reset();
  }

  void reset() noexcept override {
    std::fill(delay_left_.begin(), delay_left_.end(), 0.0F);
    std::fill(delay_right_.begin(), delay_right_.end(), 0.0F);
    delay_position_ = 0u;
    low_pass_left_ = 0.0;
    low_pass_right_ = 0.0;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count != 2u || frame_count == 0u || delay_left_.empty() ||
        sample_rate_ <= 0.0F) {
      return;
    }

    const double level_gain = std::pow(10.0, static_cast<double>(params_.level) / 20.0);
    const double requested_delay =
        std::floor(static_cast<double>(params_.delay) * static_cast<double>(sample_rate_) / 1000.0);
    std::size_t delay_samples =
        requested_delay > 0.0 ? static_cast<std::size_t>(requested_delay) : 0u;
    if (delay_samples >= delay_left_.size()) {
      delay_samples = delay_left_.size() - 1u;
    }
    const double low_pass_coefficient =
        std::exp(-kTwoPi * static_cast<double>(params_.lowPassFrequency) /
                 static_cast<double>(sample_rate_));
    const double low_pass_input = 1.0 - low_pass_coefficient;
    const double normalize_gain = 1.0 / (1.0 + level_gain);
    float *left = audio;
    float *right = audio + frame_count;
    const std::size_t size = delay_left_.size();

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const float left_input = left[frame];
      const float right_input = right[frame];
      delay_left_[delay_position_] = left_input;
      delay_right_[delay_position_] = right_input;
      const std::size_t read_position = (delay_position_ + size - delay_samples) % size;
      const float delayed_left = delay_left_[read_position];
      const float delayed_right = delay_right_[read_position];
      delay_position_ = (delay_position_ + 1u) % size;

      low_pass_left_ = low_pass_input * delayed_left + low_pass_coefficient * low_pass_left_;
      low_pass_right_ = low_pass_input * delayed_right + low_pass_coefficient * low_pass_right_;
      const double left_output =
          (static_cast<double>(left_input) + low_pass_right_ * level_gain) * normalize_gain;
      const double right_output =
          (static_cast<double>(right_input) + low_pass_left_ * level_gain) * normalize_gain;
      left[frame] = static_cast<float>(left_output);
      right[frame] = static_cast<float>(right_output);
    }
  }

private:
  std::vector<float> delay_left_;
  std::vector<float> delay_right_;
  float sample_rate_ = 0.0F;
  std::size_t delay_position_ = 0u;
  double low_pass_left_ = 0.0;
  double low_pass_right_ = 0.0;
};

} // namespace effetune::plugins::spatial

EFFETUNE_REGISTER_KERNEL(CrossfeedFilterPlugin, effetune::plugins::spatial::CrossfeedFilterKernel)
