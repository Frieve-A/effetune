#include "effetune/kernel.h"
#include "AutoFilterPluginParams.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::modulation {
namespace {

constexpr double kTwoPi = 6.283185307179586;

[[nodiscard]] double clampUnit(double value) noexcept {
  return value < 0.0 ? 0.0 : (value > 1.0 ? 1.0 : value);
}

} // namespace

class AutoFilterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::AutoFilterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    ic1_.resize(max_channels_);
    ic2_.resize(max_channels_);
    log_cutoff_.resize(max_channels_);
    controller_.resize(max_channels_);
    cutoff_ready_.resize(max_channels_);
    envelope_.resize((max_channels_ + 1u) / 2u);
    reset();
  }

  void reset() noexcept override {
    phase_ = 0.0;
    clearChannelState();
    last_channel_count_ = 0u;
    current_mode_ = 0u;
    current_filter_type_ = 0u;
    current_waveform_ = 0u;
    current_direction_ = 0u;
    pending_mode_ = 0u;
    pending_filter_type_ = 0u;
    pending_waveform_ = 0u;
    pending_direction_ = 0u;
    transition_position_ = -1;
    inverse_q_state_ = 1.0;
    mix_state_ = 0.0;
    controls_initialized_ = false;
    initialized_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || !(sample_rate_ > 0.0)) {
      return;
    }

    const std::uint32_t requested_mode = params_.mode >= 0.5F ? 1u : 0u;
    const std::uint32_t requested_filter_type =
        params_.filterType >= 1.5F ? 2u : (params_.filterType >= 0.5F ? 1u : 0u);
    const std::uint32_t requested_waveform = params_.waveform >= 0.5F ? 1u : 0u;
    const std::uint32_t requested_direction = params_.direction >= 0.5F ? 1u : 0u;
    if (!initialized_ || last_channel_count_ != channel_count) {
      clearChannelState();
      current_mode_ = requested_mode;
      current_filter_type_ = requested_filter_type;
      current_waveform_ = requested_waveform;
      current_direction_ = requested_direction;
      pending_mode_ = requested_mode;
      pending_filter_type_ = requested_filter_type;
      pending_waveform_ = requested_waveform;
      pending_direction_ = requested_direction;
      transition_position_ = -1;
      last_channel_count_ = channel_count;
      initialized_ = true;
    }

    if (!controls_initialized_) {
      inverse_q_state_ = 1.0 / static_cast<double>(params_.resonance);
      mix_state_ = static_cast<double>(params_.mix) * 0.01;
      controls_initialized_ = true;
    }

    if (transition_position_ < 0 && requested_mode == current_mode_) {
      if (current_mode_ == 0u) {
        current_direction_ = requested_direction;
        pending_direction_ = requested_direction;
      } else {
        current_waveform_ = requested_waveform;
        pending_waveform_ = requested_waveform;
      }
    }

    const bool pending_changed =
        requested_mode != pending_mode_ || requested_filter_type != pending_filter_type_ ||
        requested_waveform != pending_waveform_ || requested_direction != pending_direction_;
    if (pending_changed) {
      pending_mode_ = requested_mode;
      pending_filter_type_ = requested_filter_type;
      pending_waveform_ = requested_waveform;
      pending_direction_ = requested_direction;
    }
    const bool current_changed = requested_mode != current_mode_ ||
                                 requested_filter_type != current_filter_type_ ||
                                 (current_mode_ == 0u && requested_waveform != current_waveform_) ||
                                 (current_mode_ == 1u && requested_direction != current_direction_);
    if (current_changed && transition_position_ < 0) {
      transition_position_ = 0;
    }

    double low_frequency = static_cast<double>(params_.minimumFrequency);
    double high_frequency = static_cast<double>(params_.maximumFrequency);
    if (low_frequency > high_frequency) {
      const double temporary = low_frequency;
      low_frequency = high_frequency;
      high_frequency = temporary;
    }
    const double nyquist_guard = sample_rate_ * 0.45;
    high_frequency = high_frequency < nyquist_guard ? high_frequency : nyquist_guard;
    low_frequency = low_frequency < high_frequency ? low_frequency : high_frequency;
    low_frequency = low_frequency > 5.0 ? low_frequency : 5.0;
    high_frequency = high_frequency > low_frequency ? high_frequency : low_frequency;
    const double low_log = std::log(low_frequency);
    const double high_log = std::log(high_frequency);
    const double log_range = high_log - low_log;
    const double inverse_q = 1.0 / static_cast<double>(params_.resonance);
    const double mix = static_cast<double>(params_.mix) * 0.01;
    const double phase_increment = kTwoPi * static_cast<double>(params_.rate) / sample_rate_;
    const double stereo_phase = static_cast<double>(params_.stereoPhase) * (kTwoPi / 360.0);
    const double sensitivity_gain = std::pow(10.0, static_cast<double>(params_.sensitivity) / 20.0);
    const double attack_coefficient =
        1.0 - std::exp(-1.0 / (sample_rate_ * static_cast<double>(params_.attack) * 0.001));
    const double release_coefficient =
        1.0 - std::exp(-1.0 / (sample_rate_ * static_cast<double>(params_.release) * 0.001));
    const double cutoff_coefficient = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.004));
    const std::int32_t rounded_transition =
        static_cast<std::int32_t>(std::round(sample_rate_ * 0.0025));
    const std::int32_t transition_length = rounded_transition > 0 ? rounded_transition : 1;
    const std::uint32_t pair_count = (channel_count + 1u) / 2u;

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      inverse_q_state_ += cutoff_coefficient * (inverse_q - inverse_q_state_);
      mix_state_ += cutoff_coefficient * (mix - mix_state_);
      double gate = 1.0;
      if (transition_position_ >= 0) {
        const std::int32_t position = transition_position_;
        if (position < transition_length) {
          gate = 1.0 - static_cast<double>(position) / transition_length;
        } else {
          if (position == transition_length) {
            const bool mode_changed = current_mode_ != pending_mode_;
            current_mode_ = pending_mode_;
            current_filter_type_ = pending_filter_type_;
            current_waveform_ = pending_waveform_;
            current_direction_ = pending_direction_;
            if (mode_changed) {
              phase_ = 0.0;
              for (double &value : envelope_) {
                value = 0.0;
              }
              for (std::uint8_t &value : cutoff_ready_) {
                value = 0u;
              }
            }
          }
          gate = static_cast<double>(position - transition_length) / transition_length;
        }
        transition_position_ = position + 1;
        if (transition_position_ > transition_length * 2) {
          gate = 1.0;
          const bool topology_changed =
              pending_mode_ != current_mode_ || pending_filter_type_ != current_filter_type_ ||
              (current_mode_ == 0u && pending_waveform_ != current_waveform_) ||
              (current_mode_ == 1u && pending_direction_ != current_direction_);
          if (topology_changed) {
            transition_position_ = 0;
          } else {
            if (current_mode_ == 0u) {
              current_direction_ = pending_direction_;
            } else {
              current_waveform_ = pending_waveform_;
            }
            transition_position_ = -1;
          }
        }
      }

      if (current_mode_ == 1u) {
        for (std::uint32_t pair = 0u; pair < pair_count; ++pair) {
          const std::uint32_t left = pair * 2u;
          const std::uint32_t right = left + 1u;
          const double left_sample = audio[static_cast<std::size_t>(left) * frame_count + frame];
          double magnitude = left_sample < 0.0 ? -left_sample : left_sample;
          if (right < channel_count) {
            const double right_sample =
                audio[static_cast<std::size_t>(right) * frame_count + frame];
            magnitude = std::sqrt((left_sample * left_sample + right_sample * right_sample) * 0.5);
          }
          const double coefficient =
              magnitude > envelope_[pair] ? attack_coefficient : release_coefficient;
          envelope_[pair] += coefficient * (magnitude - envelope_[pair]);
          double control = clampUnit(envelope_[pair] * sensitivity_gain);
          if (current_direction_ == 1u) {
            control = 1.0 - control;
          }
          controller_[left] = control;
          if (right < channel_count) {
            controller_[right] = control;
          }
        }
      } else {
        for (std::uint32_t pair = 0u; pair < pair_count; ++pair) {
          const std::uint32_t left = pair * 2u;
          const std::uint32_t right = left + 1u;
          double right_phase = phase_ + stereo_phase;
          if (right_phase >= kTwoPi) {
            right_phase -= kTwoPi;
          }
          if (current_waveform_ == 1u) {
            const double left_distance = phase_ / kTwoPi - 0.5;
            const double right_distance = right_phase / kTwoPi - 0.5;
            controller_[left] = 1.0 - 2.0 * (left_distance < 0.0 ? -left_distance : left_distance);
            if (right < channel_count) {
              controller_[right] =
                  1.0 - 2.0 * (right_distance < 0.0 ? -right_distance : right_distance);
            }
          } else {
            controller_[left] = (std::sin(phase_) + 1.0) * 0.5;
            if (right < channel_count) {
              controller_[right] = (std::sin(right_phase) + 1.0) * 0.5;
            }
          }
        }
      }

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        const double input = static_cast<double>(audio[index]);
        const double target_log = low_log + log_range * controller_[channel];
        if (cutoff_ready_[channel] == 0u) {
          log_cutoff_[channel] = target_log;
          cutoff_ready_[channel] = 1u;
        } else {
          log_cutoff_[channel] += cutoff_coefficient * (target_log - log_cutoff_[channel]);
        }
        const double cutoff = std::exp(log_cutoff_[channel]);
        const double g = std::tan(0.5 * kTwoPi * cutoff / sample_rate_);
        const double a1 = 1.0 / (1.0 + g * (g + inverse_q_state_));
        const double a2 = g * a1;
        const double a3 = g * a2;
        const double v3 = input - ic2_[channel];
        const double band = a1 * ic1_[channel] + a2 * v3;
        const double low = ic2_[channel] + a2 * ic1_[channel] + a3 * v3;
        ic1_[channel] = 2.0 * band - ic1_[channel];
        ic2_[channel] = 2.0 * low - ic2_[channel];
        const double high = input - inverse_q_state_ * band - low;
        const double wet =
            current_filter_type_ == 1u ? band : (current_filter_type_ == 2u ? high : low);
        const double wet_mix = mix_state_ * gate;
        double output = input + wet_mix * (wet - input);
        if (!std::isfinite(output) || !std::isfinite(ic1_[channel]) ||
            !std::isfinite(ic2_[channel])) {
          ic1_[channel] = 0.0;
          ic2_[channel] = 0.0;
          cutoff_ready_[channel] = 0u;
          output = input;
        } else {
          if (ic1_[channel] < 1.0e-30 && ic1_[channel] > -1.0e-30) {
            ic1_[channel] = 0.0;
          }
          if (ic2_[channel] < 1.0e-30 && ic2_[channel] > -1.0e-30) {
            ic2_[channel] = 0.0;
          }
        }
        audio[index] = static_cast<float>(output);
      }
      if (current_mode_ == 0u) {
        phase_ += phase_increment;
        if (phase_ >= kTwoPi) {
          phase_ -= kTwoPi;
        }
      }
    }
  }

private:
  void clearChannelState() noexcept {
    for (double &value : ic1_)
      value = 0.0;
    for (double &value : ic2_)
      value = 0.0;
    for (double &value : log_cutoff_)
      value = 0.0;
    for (double &value : controller_)
      value = 0.0;
    for (double &value : envelope_)
      value = 0.0;
    for (std::uint8_t &value : cutoff_ready_)
      value = 0u;
  }

  std::vector<double> ic1_;
  std::vector<double> ic2_;
  std::vector<double> log_cutoff_;
  std::vector<double> controller_;
  std::vector<double> envelope_;
  std::vector<std::uint8_t> cutoff_ready_;
  double sample_rate_ = 0.0;
  double phase_ = 0.0;
  double inverse_q_state_ = 1.0;
  double mix_state_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t current_mode_ = 0u;
  std::uint32_t current_filter_type_ = 0u;
  std::uint32_t current_waveform_ = 0u;
  std::uint32_t current_direction_ = 0u;
  std::uint32_t pending_mode_ = 0u;
  std::uint32_t pending_filter_type_ = 0u;
  std::uint32_t pending_waveform_ = 0u;
  std::uint32_t pending_direction_ = 0u;
  std::int32_t transition_position_ = -1;
  bool controls_initialized_ = false;
  bool initialized_ = false;
};

static_assert(sizeof(AutoFilterKernel) <= 8192u);

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(AutoFilterPlugin, effetune::plugins::modulation::AutoFilterKernel)
