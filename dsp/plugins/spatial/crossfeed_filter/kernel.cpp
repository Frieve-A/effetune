#include "effetune/kernel.h"
#include "CrossfeedFilterPluginParams.h"
#include "effetune/dsp/denormal_noise.h"

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
    delay_initialized_ = false;
    denormal_noise_.reset();
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
    double delay_samples = requested_delay > 0.0 ? requested_delay : 0.0;
    if (delay_samples >= static_cast<double>(delay_left_.size())) {
      delay_samples = static_cast<double>(delay_left_.size() - 1u);
    }
    if (!delay_initialized_) {
      delay_.snap(delay_samples);
      delay_initialized_ = true;
    } else {
      const auto transition_frames = static_cast<std::uint32_t>(
          std::max(1.0, std::ceil(static_cast<double>(sample_rate_) * 0.005)));
      delay_.retarget(delay_samples, transition_frames);
    }
    const double low_pass_coefficient =
        std::exp(-kTwoPi * static_cast<double>(params_.lowPassFrequency) /
                 static_cast<double>(sample_rate_));
    const double low_pass_input = 1.0 - low_pass_coefficient;
    const double normalize_gain = 1.0 / std::sqrt(1.0 + level_gain * level_gain);
    float *left = audio;
    float *right = audio + frame_count;
    const std::size_t size = delay_left_.size();

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const float left_input = left[frame];
      const float right_input = right[frame];
      delay_left_[delay_position_] = left_input;
      delay_right_[delay_position_] = right_input;
      const double current_delay = delay_.value(frame);
      const double delayed_left = readDelay(delay_left_, delay_position_, current_delay);
      const double delayed_right = readDelay(delay_right_, delay_position_, current_delay);
      delay_position_ = (delay_position_ + 1u) % size;

      const double noise = denormal_noise_.sample(frame);
      low_pass_left_ =
          low_pass_input * delayed_left + low_pass_coefficient * low_pass_left_ + noise;
      low_pass_right_ =
          low_pass_input * delayed_right + low_pass_coefficient * low_pass_right_ + noise;
      const double left_output =
          (static_cast<double>(left_input) + low_pass_right_ * level_gain) * normalize_gain;
      const double right_output =
          (static_cast<double>(right_input) + low_pass_left_ * level_gain) * normalize_gain;
      left[frame] = static_cast<float>(left_output);
      right[frame] = static_cast<float>(right_output);
    }
    delay_.advance(frame_count);
    denormal_noise_.advance(frame_count);
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

  static double readDelay(const std::vector<float> &buffer, std::size_t write,
                          double delay) noexcept {
    const std::size_t size = buffer.size();
    const auto newer_delay = static_cast<std::size_t>(delay);
    const double fraction = delay - static_cast<double>(newer_delay);
    const std::size_t newer = (write + size - newer_delay) % size;
    const std::size_t older = newer == 0u ? size - 1u : newer - 1u;
    const double newer_sample = static_cast<double>(buffer[newer]);
    return newer_sample + (static_cast<double>(buffer[older]) - newer_sample) * fraction;
  }

  std::vector<float> delay_left_;
  std::vector<float> delay_right_;
  float sample_rate_ = 0.0F;
  std::size_t delay_position_ = 0u;
  double low_pass_left_ = 0.0;
  double low_pass_right_ = 0.0;
  bool delay_initialized_ = false;
  DelayRamp delay_;
  dsp::NyquistDenormalNoise denormal_noise_;
};

} // namespace effetune::plugins::spatial

EFFETUNE_REGISTER_KERNEL(CrossfeedFilterPlugin, effetune::plugins::spatial::CrossfeedFilterKernel)
