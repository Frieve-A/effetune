#include "effetune/kernel.h"
#include "RotarySpeakerPluginParams.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::modulation {
namespace {

constexpr double kTwoPi = 6.283185307179586;
constexpr double kHalfPi = 1.5707963267948966;
constexpr double kSqrtTwo = 1.4142135623730951;
constexpr double kButterworthQ = 0.7071067811865476;
constexpr double kDenormalThreshold = 1.0e-30;
constexpr double kMaximumDrumSpeed = 11.8;
constexpr double kMaximumHornSpeed = 13.6;

struct CrossoverCoefficients {
  double lp_b0 = 0.0;
  double lp_b1 = 0.0;
  double lp_b2 = 0.0;
  double hp_b0 = 0.0;
  double hp_b1 = 0.0;
  double hp_b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
};

CrossoverCoefficients designCrossover(double sample_rate, double crossover) noexcept {
  const double omega = kTwoPi * crossover / sample_rate;
  const double cosine = std::cos(omega);
  const double alpha = std::sin(omega) / (2.0 * kButterworthQ);
  const double inverse_a0 = 1.0 / (1.0 + alpha);
  const double one_minus_cosine = 1.0 - cosine;
  const double one_plus_cosine = 1.0 + cosine;
  CrossoverCoefficients coefficients{};
  coefficients.lp_b0 = 0.5 * one_minus_cosine * inverse_a0;
  coefficients.lp_b1 = one_minus_cosine * inverse_a0;
  coefficients.lp_b2 = coefficients.lp_b0;
  coefficients.hp_b0 = 0.5 * one_plus_cosine * inverse_a0;
  coefficients.hp_b1 = -one_plus_cosine * inverse_a0;
  coefficients.hp_b2 = coefficients.hp_b0;
  coefficients.a1 = -2.0 * cosine * inverse_a0;
  coefficients.a2 = (1.0 - alpha) * inverse_a0;
  return coefficients;
}

double moveTowards(double value, double target, double step) noexcept {
  if (value < target) {
    const double next = value + step;
    return next > target ? target : next;
  }
  if (value > target) {
    const double next = value - step;
    return next < target ? target : next;
  }
  return value;
}

double readCubic(const std::vector<float> &buffer, std::size_t base, std::uint32_t buffer_length,
                 std::uint32_t write_position, double delay_samples) noexcept {
  double position = static_cast<double>(write_position) - delay_samples;
  while (position < 0.0) {
    position += static_cast<double>(buffer_length);
  }
  const auto i1 = static_cast<std::uint32_t>(std::floor(position));
  const double fraction = position - static_cast<double>(i1);
  const std::uint32_t i0 = i1 == 0u ? buffer_length - 1u : i1 - 1u;
  const std::uint32_t i2 = i1 + 1u >= buffer_length ? 0u : i1 + 1u;
  const std::uint32_t i3 = i2 + 1u >= buffer_length ? 0u : i2 + 1u;
  const double y0 = static_cast<double>(buffer[base + i0]);
  const double y1 = static_cast<double>(buffer[base + i1]);
  const double y2 = static_cast<double>(buffer[base + i2]);
  const double y3 = static_cast<double>(buffer[base + i3]);
  return y1 + 0.5 * fraction *
                  (y2 - y0 +
                   fraction * (2.0 * y0 - 5.0 * y1 + 4.0 * y2 - y3 +
                               fraction * (3.0 * (y1 - y2) + y3 - y0)));
}

} // namespace

class RotarySpeakerKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::RotarySpeakerPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    buffer_length_ = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.006)) + 4u;
    filter_state_.assign(static_cast<std::size_t>(max_channels_) * 8u, 0.0);
    low_delay_.assign(static_cast<std::size_t>(max_channels_) * buffer_length_, 0.0F);
    high_delay_.assign(static_cast<std::size_t>(max_channels_) * buffer_length_, 0.0F);
    reset();
  }

  void reset() noexcept override {
    std::fill(filter_state_.begin(), filter_state_.end(), 0.0);
    std::fill(low_delay_.begin(), low_delay_.end(), 0.0F);
    std::fill(high_delay_.begin(), high_delay_.end(), 0.0F);
    write_position_ = 0u;
    last_channel_count_ = 0u;
    drum_phase_ = 0.0;
    horn_phase_ = kHalfPi;
    drum_speed_ = 0.0;
    horn_speed_ = 0.0;
    coefficients_ready_ = false;
    smoothers_ready_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }
    if (last_channel_count_ != channel_count) {
      std::fill(filter_state_.begin(), filter_state_.end(), 0.0);
      std::fill(low_delay_.begin(), low_delay_.end(), 0.0F);
      std::fill(high_delay_.begin(), high_delay_.end(), 0.0F);
      write_position_ = 0u;
      drum_phase_ = 0.0;
      horn_phase_ = kHalfPi;
      drum_speed_ = 0.0;
      horn_speed_ = 0.0;
      smoothers_ready_ = false;
      last_channel_count_ = channel_count;
    }

    const double maximum_crossover = sample_rate_ * 0.45;
    const double raw_crossover = static_cast<double>(params_.crossover);
    const double crossover = raw_crossover > maximum_crossover ? maximum_crossover : raw_crossover;
    const CrossoverCoefficients target_coefficients = designCrossover(sample_rate_, crossover);
    if (!coefficients_ready_) {
      coefficients_ = target_coefficients;
      coefficients_ready_ = true;
    }
    const double target_speed_scale = static_cast<double>(params_.speed) * 0.01;
    const double target_acceleration = static_cast<double>(params_.acceleration);
    const double target_balance = static_cast<double>(params_.rotorBalance) * 0.01;
    const double target_width = static_cast<double>(params_.stereoWidth) * 0.01;
    const double target_doppler = static_cast<double>(params_.dopplerDepth) * 0.01;
    const double target_amplitude = static_cast<double>(params_.amplitudeDepth) * 0.01;
    const double target_mix = static_cast<double>(params_.mix) * 0.01;
    const int speed_state = static_cast<int>(params_.speedState + 0.5F);
    const double smoothing = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.005));
    if (!smoothers_ready_) {
      acceleration_ = target_acceleration;
      balance_ = target_balance;
      width_ = target_width;
      doppler_ = target_doppler;
      amplitude_ = target_amplitude;
      mix_ = target_mix;
      smoothers_ready_ = true;
    }

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      coefficients_.lp_b0 += (target_coefficients.lp_b0 - coefficients_.lp_b0) * smoothing;
      coefficients_.lp_b1 += (target_coefficients.lp_b1 - coefficients_.lp_b1) * smoothing;
      coefficients_.lp_b2 += (target_coefficients.lp_b2 - coefficients_.lp_b2) * smoothing;
      coefficients_.hp_b0 += (target_coefficients.hp_b0 - coefficients_.hp_b0) * smoothing;
      coefficients_.hp_b1 += (target_coefficients.hp_b1 - coefficients_.hp_b1) * smoothing;
      coefficients_.hp_b2 += (target_coefficients.hp_b2 - coefficients_.hp_b2) * smoothing;
      coefficients_.a1 += (target_coefficients.a1 - coefficients_.a1) * smoothing;
      coefficients_.a2 += (target_coefficients.a2 - coefficients_.a2) * smoothing;
      acceleration_ += (target_acceleration - acceleration_) * smoothing;
      balance_ += (target_balance - balance_) * smoothing;
      width_ += (target_width - width_) * smoothing;
      doppler_ += (target_doppler - doppler_) * smoothing;
      amplitude_ += (target_amplitude - amplitude_) * smoothing;
      mix_ += (target_mix - mix_) * smoothing;

      double target_drum_speed = 0.0;
      double target_horn_speed = 0.0;
      if (speed_state == 1) {
        target_drum_speed = 0.7 * target_speed_scale;
        target_horn_speed = 0.85 * target_speed_scale;
      } else if (speed_state == 2) {
        target_drum_speed = 5.9 * target_speed_scale;
        target_horn_speed = 6.8 * target_speed_scale;
      }
      const double effective_acceleration = acceleration_ > 0.001 ? acceleration_ : 0.001;
      const double drum_step = kMaximumDrumSpeed / (effective_acceleration * 1.3 * sample_rate_);
      const double horn_step = kMaximumHornSpeed / (effective_acceleration * 0.8 * sample_rate_);
      drum_speed_ = moveTowards(drum_speed_, target_drum_speed, drum_step);
      horn_speed_ = moveTowards(horn_speed_, target_horn_speed, horn_step);

      const double balance_angle = (balance_ + 1.0) * 0.125 * kTwoPi;
      const double low_weight = std::cos(balance_angle) * kSqrtTwo;
      const double high_weight = std::sin(balance_angle) * kSqrtTwo;
      const double base_delay = sample_rate_ * 0.002;
      const double delay_excursion = sample_rate_ * 0.001 * doppler_;

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t audio_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const double dry = static_cast<double>(audio[audio_index]);
        const std::size_t state_base = static_cast<std::size_t>(channel) * 8u;
        double low = coefficients_.lp_b0 * dry + filter_state_[state_base];
        filter_state_[state_base] =
            coefficients_.lp_b1 * dry - coefficients_.a1 * low + filter_state_[state_base + 1u];
        filter_state_[state_base + 1u] = coefficients_.lp_b2 * dry - coefficients_.a2 * low;
        const double low_second = coefficients_.lp_b0 * low + filter_state_[state_base + 2u];
        filter_state_[state_base + 2u] = coefficients_.lp_b1 * low - coefficients_.a1 * low_second +
                                         filter_state_[state_base + 3u];
        filter_state_[state_base + 3u] = coefficients_.lp_b2 * low - coefficients_.a2 * low_second;
        low = low_second;

        double high = coefficients_.hp_b0 * dry + filter_state_[state_base + 4u];
        filter_state_[state_base + 4u] =
            coefficients_.hp_b1 * dry - coefficients_.a1 * high + filter_state_[state_base + 5u];
        filter_state_[state_base + 5u] = coefficients_.hp_b2 * dry - coefficients_.a2 * high;
        const double high_second = coefficients_.hp_b0 * high + filter_state_[state_base + 6u];
        filter_state_[state_base + 6u] = coefficients_.hp_b1 * high -
                                         coefficients_.a1 * high_second +
                                         filter_state_[state_base + 7u];
        filter_state_[state_base + 7u] =
            coefficients_.hp_b2 * high - coefficients_.a2 * high_second;
        high = high_second;

        const std::size_t delay_base = static_cast<std::size_t>(channel) * buffer_length_;
        low_delay_[delay_base + write_position_] = static_cast<float>(low);
        high_delay_[delay_base + write_position_] = static_cast<float>(high);
        const double pair_width =
            ((channel & 1u) != 0u || channel + 1u < channel_count) ? width_ : 0.0;
        const double microphone_offset =
            (channel & 1u) == 0u ? -pair_width * kHalfPi : pair_width * kHalfPi;
        const double drum_angle = drum_phase_ + microphone_offset;
        const double horn_angle = horn_phase_ - microphone_offset;
        const double drum_delay_samples = base_delay + delay_excursion * std::sin(drum_angle);
        const double horn_delay_samples = base_delay + delay_excursion * std::sin(horn_angle);
        const double delayed_low =
            readCubic(low_delay_, delay_base, buffer_length_, write_position_, drum_delay_samples);
        const double delayed_high =
            readCubic(high_delay_, delay_base, buffer_length_, write_position_, horn_delay_samples);
        const double drum_gain = 1.0 + 0.5 * amplitude_ * std::cos(drum_angle);
        const double horn_gain = 1.0 + 0.5 * amplitude_ * std::cos(horn_angle);
        const double drum_spatial = 1.0 + 0.25 * pair_width * std::sin(drum_angle);
        const double horn_spatial = 1.0 + 0.25 * pair_width * std::sin(horn_angle);
        const double wet = low_weight * delayed_low * drum_gain * drum_spatial +
                           high_weight * delayed_high * horn_gain * horn_spatial;
        const double output = dry * (1.0 - mix_) + wet * mix_;
        if (std::isfinite(output)) {
          audio[audio_index] = static_cast<float>(output);
        } else {
          audio[audio_index] = 0.0F;
          for (std::size_t state = 0u; state < 8u; ++state) {
            filter_state_[state_base + state] = 0.0;
          }
        }
      }

      drum_phase_ += kTwoPi * drum_speed_ / sample_rate_;
      horn_phase_ += kTwoPi * horn_speed_ / sample_rate_;
      if (drum_phase_ >= kTwoPi) {
        drum_phase_ -= kTwoPi;
      }
      if (horn_phase_ >= kTwoPi) {
        horn_phase_ -= kTwoPi;
      }
      ++write_position_;
      if (write_position_ >= buffer_length_) {
        write_position_ = 0u;
      }
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t state_base = static_cast<std::size_t>(channel) * 8u;
      bool reset_state = false;
      for (std::size_t state = 0u; state < 8u; ++state) {
        if (!std::isfinite(filter_state_[state_base + state])) {
          reset_state = true;
          break;
        }
      }
      if (reset_state) {
        for (std::size_t state = 0u; state < 8u; ++state) {
          filter_state_[state_base + state] = 0.0;
        }
      } else {
        for (std::size_t state = 0u; state < 8u; ++state) {
          const double value = filter_state_[state_base + state];
          if (value > -kDenormalThreshold && value < kDenormalThreshold) {
            filter_state_[state_base + state] = 0.0;
          }
        }
      }
    }
  }

private:
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t buffer_length_ = 1u;
  std::uint32_t write_position_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool coefficients_ready_ = false;
  bool smoothers_ready_ = false;
  CrossoverCoefficients coefficients_{};
  double drum_phase_ = 0.0;
  double horn_phase_ = kHalfPi;
  double drum_speed_ = 0.0;
  double horn_speed_ = 0.0;
  double acceleration_ = 2.0;
  double balance_ = 0.0;
  double width_ = 0.0;
  double doppler_ = 0.0;
  double amplitude_ = 0.0;
  double mix_ = 0.0;
  std::vector<double> filter_state_;
  std::vector<float> low_delay_;
  std::vector<float> high_delay_;
};

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(RotarySpeakerPlugin, effetune::plugins::modulation::RotarySpeakerKernel)
