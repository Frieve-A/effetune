#include "effetune/kernel.h"
#include "DelayPluginParams.h"
#include "effetune/dsp/delay_line.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::delay {
namespace {

constexpr double kPi = 3.141592653589793;
constexpr double kTwoPi = 6.283185307179586;

double clampValue(double value, double lower, double upper) noexcept {
  if (value < lower) {
    return lower;
  }
  return value > upper ? upper : value;
}

} // namespace

class DelayKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::DelayPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    const std::uint32_t max_pre_delay = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.1));
    const std::uint32_t max_delay = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 5.0));
    static_cast<void>(pre_delay_.prepare(max_channels_, max_pre_delay));
    static_cast<void>(delay_.prepare(max_channels_, max_delay));
    low_damp_states_.resize(max_channels_);
    high_damp_states_.resize(max_channels_);
  }

  void reset() noexcept override {
    pre_delay_.reset();
    delay_.reset();
    for (float &state : low_damp_states_) {
      state = 0.0F;
    }
    for (float &state : high_damp_states_) {
      state = 0.0F;
    }
    configured_ = false;
    last_channel_count_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }
    if (!configured_ || last_channel_count_ != channel_count) {
      resetForChannels(channel_count);
    }

    std::uint32_t pre_delay_samples =
        static_cast<std::uint32_t>(static_cast<double>(params_.preDelay) * sample_rate_ * 0.001);
    const std::uint32_t max_pre_delay = pre_delay_.maxDelaySamples();
    if (pre_delay_samples > max_pre_delay) {
      pre_delay_samples = max_pre_delay;
    }

    std::uint32_t delay_samples =
        static_cast<std::uint32_t>(static_cast<double>(params_.delaySize) * sample_rate_ * 0.001);
    if (delay_samples < 1u) {
      delay_samples = 1u;
    }
    const std::uint32_t max_delay = delay_.maxDelaySamples();
    if (delay_samples > max_delay) {
      delay_samples = max_delay;
    }

    const double damp_amount = clampValue(static_cast<double>(params_.damping) * 0.01, 0.0, 1.0);
    const double one_minus_damp = 1.0 - damp_amount;
    const double nyquist = 0.5 * sample_rate_;
    double high_cutoff = clampValue(static_cast<double>(params_.highDamp), 20.0, nyquist - 1.0);
    double low_cutoff = clampValue(static_cast<double>(params_.lowDamp), 20.0, nyquist - 1.0);
    if (low_cutoff > high_cutoff) {
      const double temporary = low_cutoff;
      low_cutoff = high_cutoff;
      high_cutoff = temporary;
    }
    const double high_pole = std::exp(-kTwoPi * high_cutoff / sample_rate_);
    const double low_pole = std::exp(-kTwoPi * low_cutoff / sample_rate_);
    const double feedback = clampValue(static_cast<double>(params_.feedback) * 0.01, 0.0, 0.99);
    const double wet_mix = clampValue(static_cast<double>(params_.mix) * 0.01, 0.0, 1.0);
    const double angle = wet_mix * (kPi * 0.5);
    const double dry_gain = std::cos(angle);
    const double wet_gain = std::sin(angle);
    const double ping_pong = clampValue(static_cast<double>(params_.pingPong) * 0.01, 0.0, 1.0);
    const bool stereo = channel_count == 2u;

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      double stereo_delayed_left = 0.0;
      double stereo_delayed_right = 0.0;
      double stereo_damped_left = 0.0;
      double stereo_damped_right = 0.0;
      if (stereo) {
        stereo_delayed_left = static_cast<double>(delay_.read(0u, delay_samples - 1u));
        stereo_delayed_right = static_cast<double>(delay_.read(1u, delay_samples - 1u));
        const double mono = 0.5 * (stereo_delayed_left + stereo_delayed_right);
        double feedback_left;
        double feedback_right;
        if (ping_pong <= 0.5) {
          const double amount = ping_pong * 2.0;
          const double inverse = 1.0 - amount;
          feedback_left = stereo_delayed_left * inverse + mono * amount;
          feedback_right = stereo_delayed_right * inverse + mono * amount;
        } else {
          const double amount = (ping_pong - 0.5) * 2.0;
          const double inverse = 1.0 - amount;
          feedback_left = mono * inverse + stereo_delayed_right * amount;
          feedback_right = mono * inverse + stereo_delayed_left * amount;
        }
        stereo_damped_left =
            dampFeedback(0u, feedback_left, low_pole, high_pole, damp_amount, one_minus_damp);
        stereo_damped_right =
            dampFeedback(1u, feedback_right, low_pole, high_pole, damp_amount, one_minus_damp);
      }

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::uint32_t index = channel * frame_count + frame;
        const double input = static_cast<double>(audio[index]);
        double pre_delayed;
        if (pre_delay_samples == 0u) {
          pre_delayed = input;
        } else {
          pre_delayed = static_cast<double>(pre_delay_.read(channel, pre_delay_samples - 1u));
        }
        pre_delay_.push(channel, static_cast<float>(input));

        double wet;
        double damped;
        if (stereo) {
          wet = channel == 0u ? stereo_delayed_left : stereo_delayed_right;
          damped = channel == 0u ? stereo_damped_left : stereo_damped_right;
        } else {
          wet = static_cast<double>(delay_.read(channel, delay_samples - 1u));
          damped = dampFeedback(channel, wet, low_pole, high_pole, damp_amount, one_minus_damp);
        }
        delay_.push(channel, static_cast<float>(pre_delayed + damped * feedback));
        audio[index] = static_cast<float>(input * dry_gain + wet * wet_gain);
      }
    }
  }

private:
  void resetForChannels(std::uint32_t channel_count) noexcept {
    pre_delay_.reset();
    delay_.reset();
    for (float &state : low_damp_states_) {
      state = 0.0F;
    }
    for (float &state : high_damp_states_) {
      state = 0.0F;
    }
    last_channel_count_ = channel_count;
    configured_ = true;
  }

  double dampFeedback(std::uint32_t channel, double input, double low_pole, double high_pole,
                      double damp_amount, double one_minus_damp) noexcept {
    double low_pass = static_cast<double>(low_damp_states_[channel]);
    low_pass = (1.0 - low_pole) * input + low_pole * low_pass;
    const double high_pass = input - low_pass;
    double band_pass = static_cast<double>(high_damp_states_[channel]);
    band_pass = (1.0 - high_pole) * high_pass + high_pole * band_pass;
    low_damp_states_[channel] = static_cast<float>(low_pass);
    high_damp_states_[channel] = static_cast<float>(band_pass);
    return input * one_minus_damp + band_pass * damp_amount;
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool configured_ = false;
  dsp::DelayLine pre_delay_;
  dsp::DelayLine delay_;
  std::vector<float> low_damp_states_;
  std::vector<float> high_damp_states_;
};

} // namespace effetune::plugins::delay

EFFETUNE_REGISTER_KERNEL(DelayPlugin, effetune::plugins::delay::DelayKernel)
