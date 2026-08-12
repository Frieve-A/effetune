#include "effetune/kernel.h"
#include "AutoPanPluginParams.h"

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace effetune::plugins::modulation {
namespace {

constexpr double kTwoPi = 6.283185307179586;
constexpr double kHalfPi = 1.5707963267948966;

[[nodiscard]] double clampPan(double value) noexcept {
  return value < -1.0 ? -1.0 : (value > 1.0 ? 1.0 : value);
}

} // namespace

class AutoPanKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::AutoPanPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    reset();
  }

  void reset() noexcept override {
    phase_ = 0.0;
    parameter_phase_ = 0.0;
    left_gain_ = 1.0;
    right_gain_ = 1.0;
    last_channel_count_ = 0u;
    current_waveform_ = 0u;
    pending_waveform_ = 0u;
    transition_position_ = -1;
    initialized_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || !(sample_rate_ > 0.0)) {
      return;
    }

    const std::uint32_t requested_waveform = params_.waveform >= 0.5F ? 1u : 0u;
    const double requested_phase = static_cast<double>(params_.phase) * (kTwoPi / 360.0);
    if (!initialized_) {
      phase_ = requested_phase;
      parameter_phase_ = requested_phase;
      current_waveform_ = requested_waveform;
      pending_waveform_ = requested_waveform;
      last_channel_count_ = channel_count;
      initialized_ = true;
    }
    if (last_channel_count_ != channel_count) {
      left_gain_ = 1.0;
      right_gain_ = 1.0;
      last_channel_count_ = channel_count;
    }
    if (requested_phase != parameter_phase_) {
      phase_ += requested_phase - parameter_phase_;
      if (phase_ >= kTwoPi) {
        phase_ -= kTwoPi;
      }
      if (phase_ < 0.0) {
        phase_ += kTwoPi;
      }
      parameter_phase_ = requested_phase;
    }
    if (requested_waveform != pending_waveform_) {
      pending_waveform_ = requested_waveform;
      if (transition_position_ < 0) {
        transition_position_ = 0;
      }
    } else if (requested_waveform != current_waveform_ && transition_position_ < 0) {
      transition_position_ = 0;
    }

    const double rate = static_cast<double>(params_.rate);
    const double depth = static_cast<double>(params_.depth) * 0.01;
    const double center = static_cast<double>(params_.center) * 0.01;
    const double width = static_cast<double>(params_.width) * 0.01;
    const double phase_increment = kTwoPi * rate / sample_rate_;
    const double smoothing_coefficient = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.003));
    const std::int32_t transition_length =
        static_cast<std::int32_t>(std::round(sample_rate_ * 0.0025)) > 0
            ? static_cast<std::int32_t>(std::round(sample_rate_ * 0.0025))
            : 1;

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      double gate = 1.0;
      if (transition_position_ >= 0) {
        const std::int32_t position = transition_position_;
        if (position < transition_length) {
          gate = 1.0 - static_cast<double>(position) / transition_length;
        } else {
          if (position == transition_length) {
            current_waveform_ = pending_waveform_;
          }
          gate = static_cast<double>(position - transition_length) / transition_length;
        }
        transition_position_ = position + 1;
        if (transition_position_ > transition_length * 2) {
          gate = 1.0;
          transition_position_ = current_waveform_ != pending_waveform_ ? 0 : -1;
        }
      }

      double lfo = 0.0;
      if (current_waveform_ == 1u) {
        const double cycle = phase_ / kTwoPi;
        const double distance = cycle - 0.5;
        lfo = 1.0 - 4.0 * (distance < 0.0 ? -distance : distance);
      } else {
        lfo = std::sin(phase_);
      }
      const double pan = clampPan(center + width * lfo);
      const double angle = (pan + 1.0) * (kHalfPi * 0.5);
      const double target_left = 1.0 + depth * (std::cos(angle) - 1.0);
      const double target_right = 1.0 + depth * (std::sin(angle) - 1.0);
      left_gain_ += smoothing_coefficient * (target_left - left_gain_);
      right_gain_ += smoothing_coefficient * (target_right - right_gain_);
      if (!std::isfinite(left_gain_) || !std::isfinite(right_gain_)) {
        left_gain_ = 1.0;
        right_gain_ = 1.0;
      }

      for (std::uint32_t channel = 0u; channel + 1u < channel_count; channel += 2u) {
        const std::size_t left_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const std::size_t right_index =
            static_cast<std::size_t>(channel + 1u) * frame_count + frame;
        const double output_left_gain = 1.0 + gate * (left_gain_ - 1.0);
        const double output_right_gain = 1.0 + gate * (right_gain_ - 1.0);
        audio[left_index] =
            static_cast<float>(static_cast<double>(audio[left_index]) * output_left_gain);
        audio[right_index] =
            static_cast<float>(static_cast<double>(audio[right_index]) * output_right_gain);
      }
      phase_ += phase_increment;
      if (phase_ >= kTwoPi) {
        phase_ -= kTwoPi;
      }
    }
  }

private:
  double sample_rate_ = 0.0;
  double phase_ = 0.0;
  double parameter_phase_ = 0.0;
  double left_gain_ = 1.0;
  double right_gain_ = 1.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t current_waveform_ = 0u;
  std::uint32_t pending_waveform_ = 0u;
  std::int32_t transition_position_ = -1;
  bool initialized_ = false;
};

static_assert(sizeof(AutoPanKernel) <= 8192u);

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(AutoPanPlugin, effetune::plugins::modulation::AutoPanKernel)
