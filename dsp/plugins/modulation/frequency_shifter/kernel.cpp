#include "effetune/kernel.h"
#include "FrequencyShifterPluginParams.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::modulation {
namespace {

constexpr double kTwoPi = 6.283185307179586;
constexpr double kPi = 3.141592653589793;
constexpr std::uint32_t kBarberVoices = 3u;
constexpr std::uint32_t kHilbertPrototypeLength = 229u;
constexpr std::uint32_t kHilbertPrototypeDelay = (kHilbertPrototypeLength - 1u) / 2u;
constexpr std::uint32_t kTransitionHalf = 64u;
constexpr std::uint32_t kTransitionLength = kTransitionHalf * 2u;

struct HilbertTap {
  std::uint32_t offset = 0u;
  double value = 0.0;
};

std::uint32_t selectHilbertStride(double sample_rate) noexcept {
  if (sample_rate <= 48000.0) {
    return 1u;
  }
  if (sample_rate <= 96000.0) {
    return 2u;
  }
  return 4u;
}

double clampFrequency(double value, double guard) noexcept {
  if (value > guard) {
    return guard;
  }
  if (value < -guard) {
    return -guard;
  }
  return value;
}

void wrapPhase(double &phase) noexcept {
  if (phase >= kTwoPi) {
    phase -= kTwoPi;
  } else if (phase < 0.0) {
    phase += kTwoPi;
  }
}

} // namespace

class FrequencyShifterKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::FrequencyShifterPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    const std::uint32_t hilbert_stride = selectHilbertStride(sample_rate_);
    fir_length_ = (kHilbertPrototypeLength - 1u) * hilbert_stride + 1u;
    group_delay_ = kHilbertPrototypeDelay * hilbert_stride;
    history_.assign(static_cast<std::size_t>(max_channels_) * fir_length_, 0.0F);
    barber_carriers_.assign(2u * kBarberVoices, 0.0);
    taps_.clear();
    taps_.reserve((kHilbertPrototypeLength + 1u) / 2u);
    for (std::uint32_t tap = 0u; tap < kHilbertPrototypeLength; ++tap) {
      const std::int32_t lag =
          static_cast<std::int32_t>(tap) - static_cast<std::int32_t>(kHilbertPrototypeDelay);
      if (lag == 0 || (lag & 1) == 0) {
        continue;
      }
      const double position =
          static_cast<double>(tap) / static_cast<double>(kHilbertPrototypeLength - 1u);
      const double window = 0.54 - 0.46 * std::cos(kTwoPi * position);
      taps_.push_back({tap * hilbert_stride, (2.0 / (kPi * static_cast<double>(lag))) * window});
    }
    reset();
  }

  void reset() noexcept override {
    std::fill(history_.begin(), history_.end(), 0.0F);
    std::fill(barber_carriers_.begin(), barber_carriers_.end(), 0.0);
    write_position_ = 0u;
    shift_phase_ = 0.0;
    ring_phase_ = 0.0;
    barber_phase_ = 0.0;
    active_mode_ = -1;
    active_direction_ = 1;
    pending_mode_ = 0;
    pending_direction_ = 1;
    active_stationary_ = false;
    pending_stationary_ = false;
    transition_position_ = kTransitionLength;
    smoothers_ready_ = false;
    last_channel_count_ = 0u;
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override { return group_delay_; }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }
    const int requested_mode = static_cast<int>(params_.mode + 0.5F);
    const int requested_direction = params_.direction >= 0.5F ? -1 : 1;
    double target_minimum = static_cast<double>(params_.minimumShift);
    double target_maximum = static_cast<double>(params_.maximumShift);
    if (target_minimum > target_maximum) {
      const double swap = target_minimum;
      target_minimum = target_maximum;
      target_maximum = swap;
    }
    const double nyquist_guard = sample_rate_ * 0.45;
    if (target_minimum > nyquist_guard) {
      target_minimum = nyquist_guard;
    }
    if (target_maximum > nyquist_guard) {
      target_maximum = nyquist_guard;
    }
    const bool requested_stationary = target_minimum == target_maximum;
    if (last_channel_count_ != channel_count) {
      std::fill(history_.begin(), history_.end(), 0.0F);
      std::fill(barber_carriers_.begin(), barber_carriers_.end(), 0.0);
      write_position_ = 0u;
      shift_phase_ = 0.0;
      ring_phase_ = 0.0;
      barber_phase_ = 0.0;
      smoothers_ready_ = false;
      active_mode_ = requested_mode;
      pending_mode_ = requested_mode;
      active_direction_ = requested_direction;
      pending_direction_ = requested_direction;
      active_stationary_ = requested_stationary;
      pending_stationary_ = requested_stationary;
      transition_position_ = kTransitionLength;
      last_channel_count_ = channel_count;
    }

    if (active_mode_ < 0) {
      active_mode_ = requested_mode;
      pending_mode_ = requested_mode;
      active_direction_ = requested_direction;
      pending_direction_ = requested_direction;
      active_stationary_ = requested_stationary;
      pending_stationary_ = requested_stationary;
    } else {
      const bool transition_active = transition_position_ < kTransitionLength;
      pending_mode_ = requested_mode;
      pending_direction_ = requested_direction;
      pending_stationary_ = requested_stationary;
      if (!transition_active) {
        const bool topology_changed =
            requested_mode != active_mode_ || ((requested_mode == 2 || active_mode_ == 2) &&
                                               (requested_direction != active_direction_ ||
                                                (requested_mode == 2 && active_mode_ == 2 &&
                                                 requested_stationary != active_stationary_)));
        if (topology_changed) {
          transition_position_ = 0u;
        } else if (requested_mode != 2) {
          active_direction_ = requested_direction;
        }
      }
    }

    const double target_shift = clampFrequency(static_cast<double>(params_.shift), nyquist_guard);
    const double target_carrier =
        clampFrequency(static_cast<double>(params_.carrierFrequency), nyquist_guard);
    const double target_rate = static_cast<double>(params_.rate);
    const double target_stereo_phase = static_cast<double>(params_.stereoPhase);
    const double target_mix = static_cast<double>(params_.mix) * 0.01;
    const double smoothing = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.005));
    if (!smoothers_ready_) {
      smoothed_shift_ = target_shift;
      smoothed_carrier_ = target_carrier;
      smoothed_minimum_ = target_minimum;
      smoothed_maximum_ = target_maximum;
      smoothed_rate_ = target_rate;
      smoothed_stereo_phase_ = target_stereo_phase;
      smoothed_mix_ = target_mix;
      smoothers_ready_ = true;
    }

    std::array<double, 2u * kBarberVoices> barber_cosines{};
    std::array<double, 2u * kBarberVoices> barber_sines{};
    std::array<double, 2u * kBarberVoices> barber_weights{};
    std::array<double, 2u> barber_weight_sums{};
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      smoothed_shift_ += (target_shift - smoothed_shift_) * smoothing;
      smoothed_carrier_ += (target_carrier - smoothed_carrier_) * smoothing;
      smoothed_minimum_ += (target_minimum - smoothed_minimum_) * smoothing;
      smoothed_maximum_ += (target_maximum - smoothed_maximum_) * smoothing;
      smoothed_rate_ += (target_rate - smoothed_rate_) * smoothing;
      smoothed_stereo_phase_ += (target_stereo_phase - smoothed_stereo_phase_) * smoothing;
      smoothed_mix_ += (target_mix - smoothed_mix_) * smoothing;

      if (transition_position_ == kTransitionHalf) {
        const bool reset_barber_carriers =
            pending_mode_ == 2 && (active_mode_ != 2 || active_direction_ != pending_direction_);
        const bool stationary_changed =
            pending_mode_ == 2 && active_mode_ == 2 && active_stationary_ != pending_stationary_;
        active_mode_ = pending_mode_;
        active_direction_ = pending_direction_;
        active_stationary_ = pending_stationary_;
        if (reset_barber_carriers) {
          std::fill(barber_carriers_.begin(), barber_carriers_.end(), 0.0);
        } else if (stationary_changed) {
          std::fill(barber_carriers_.begin(), barber_carriers_.end(), barber_carriers_.front());
        }
      }
      double wet_gate = 1.0;
      if (transition_position_ < kTransitionLength) {
        wet_gate = transition_position_ < kTransitionHalf
                       ? 1.0 - static_cast<double>(transition_position_) /
                                   static_cast<double>(kTransitionHalf)
                       : static_cast<double>(transition_position_ - kTransitionHalf) /
                             static_cast<double>(kTransitionHalf);
      }

      const std::uint32_t delayed_position = write_position_ >= group_delay_
                                                 ? write_position_ - group_delay_
                                                 : write_position_ + fir_length_ - group_delay_;
      const double stereo_offset = smoothed_stereo_phase_ * kPi / 180.0;
      double shift_cosine_left = 0.0;
      double shift_sine_left = 0.0;
      double shift_cosine_right = 0.0;
      double shift_sine_right = 0.0;
      double ring_sine_left = 0.0;
      double ring_sine_right = 0.0;
      if (active_mode_ == 0) {
        shift_cosine_left = std::cos(shift_phase_);
        shift_sine_left = std::sin(shift_phase_);
        shift_cosine_right = std::cos(shift_phase_ + stereo_offset);
        shift_sine_right = std::sin(shift_phase_ + stereo_offset);
      } else if (active_mode_ == 1) {
        ring_sine_left = std::sin(ring_phase_);
        ring_sine_right = std::sin(ring_phase_ + stereo_offset);
      } else if (active_stationary_) {
        const double phase = barber_carriers_.front();
        const double cosine = std::cos(phase);
        const double sine = std::sin(phase);
        double next_phase = phase + kTwoPi * static_cast<double>(active_direction_) *
                                        smoothed_minimum_ / sample_rate_;
        wrapPhase(next_phase);
        for (std::size_t carrier_index = 0u; carrier_index < barber_carriers_.size();
             ++carrier_index) {
          barber_cosines[carrier_index] = cosine;
          barber_sines[carrier_index] = sine;
          barber_weights[carrier_index] = carrier_index % kBarberVoices == 0u ? 1.0 : 0.0;
          barber_carriers_[carrier_index] = next_phase;
        }
        barber_weight_sums[0] = 1.0;
        barber_weight_sums[1] = 1.0;
      } else {
        for (std::uint32_t parity = 0u; parity < 2u; ++parity) {
          const double stereo_sweep_offset = parity != 0u ? smoothed_stereo_phase_ / 360.0 : 0.0;
          double weight_sum = 0.0;
          for (std::uint32_t voice = 0u; voice < kBarberVoices; ++voice) {
            double sweep = barber_phase_ +
                           static_cast<double>(voice) / static_cast<double>(kBarberVoices) +
                           stereo_sweep_offset;
            sweep -= std::floor(sweep);
            const double weight_sine = std::sin(kPi * sweep);
            const double weight = weight_sine * weight_sine;
            const std::size_t carrier_index =
                static_cast<std::size_t>(parity) * kBarberVoices + voice;
            const double phase = barber_carriers_[carrier_index];
            barber_cosines[carrier_index] = std::cos(phase);
            barber_sines[carrier_index] = std::sin(phase);
            barber_weights[carrier_index] = weight;
            weight_sum += weight;
            const double instantaneous_shift =
                static_cast<double>(active_direction_) *
                (smoothed_minimum_ + (smoothed_maximum_ - smoothed_minimum_) * sweep);
            double next_phase = phase + kTwoPi * instantaneous_shift / sample_rate_;
            wrapPhase(next_phase);
            barber_carriers_[carrier_index] = next_phase;
          }
          barber_weight_sums[parity] = weight_sum;
        }
      }
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t audio_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const std::size_t history_base = static_cast<std::size_t>(channel) * fir_length_;
        history_[history_base + write_position_] = audio[audio_index];
        const double real = static_cast<double>(history_[history_base + delayed_position]);
        double imaginary = 0.0;
        if (active_mode_ != 1) {
          for (const HilbertTap &tap : taps_) {
            const std::uint32_t history_position = write_position_ >= tap.offset
                                                       ? write_position_ - tap.offset
                                                       : write_position_ + fir_length_ - tap.offset;
            imaginary += tap.value * static_cast<double>(history_[history_base + history_position]);
          }
        }
        const std::uint32_t parity = channel & 1u;
        double wet = real;
        if (active_mode_ == 0) {
          wet = parity != 0u ? real * shift_cosine_right - imaginary * shift_sine_right
                             : real * shift_cosine_left - imaginary * shift_sine_left;
        } else if (active_mode_ == 1) {
          wet = real * (parity != 0u ? ring_sine_right : ring_sine_left);
        } else {
          double weighted = 0.0;
          const std::size_t carrier_base = static_cast<std::size_t>(parity) * kBarberVoices;
          for (std::uint32_t voice = 0u; voice < kBarberVoices; ++voice) {
            const std::size_t carrier_index = carrier_base + voice;
            weighted += barber_weights[carrier_index] * (real * barber_cosines[carrier_index] -
                                                         imaginary * barber_sines[carrier_index]);
          }
          const double weight_sum = barber_weight_sums[parity];
          wet = weight_sum > 1.0e-12 ? weighted / weight_sum : 0.0;
        }
        const double wet_mix = smoothed_mix_ * wet_gate;
        const double output = real * (1.0 - wet_mix) + wet * wet_mix;
        audio[audio_index] = static_cast<float>(std::isfinite(output) ? output : 0.0);
      }

      shift_phase_ += kTwoPi * smoothed_shift_ / sample_rate_;
      ring_phase_ += kTwoPi * smoothed_carrier_ / sample_rate_;
      if (active_mode_ != 2 || !active_stationary_) {
        barber_phase_ += smoothed_rate_ / sample_rate_;
      }
      wrapPhase(shift_phase_);
      wrapPhase(ring_phase_);
      if (barber_phase_ >= 1.0) {
        barber_phase_ -= 1.0;
      }
      ++write_position_;
      if (write_position_ >= fir_length_) {
        write_position_ = 0u;
      }
      if (transition_position_ < kTransitionLength) {
        ++transition_position_;
        if (transition_position_ == kTransitionLength) {
          const bool topology_changed =
              pending_mode_ != active_mode_ || ((pending_mode_ == 2 || active_mode_ == 2) &&
                                                (pending_direction_ != active_direction_ ||
                                                 (pending_mode_ == 2 && active_mode_ == 2 &&
                                                  pending_stationary_ != active_stationary_)));
          if (topology_changed) {
            transition_position_ = 0u;
          } else if (active_mode_ != 2) {
            active_direction_ = pending_direction_;
          }
        }
      }
    }
  }

private:
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t fir_length_ = 1u;
  std::uint32_t group_delay_ = 0u;
  std::uint32_t write_position_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t transition_position_ = kTransitionLength;
  int active_mode_ = -1;
  int pending_mode_ = 0;
  int active_direction_ = 1;
  int pending_direction_ = 1;
  bool active_stationary_ = false;
  bool pending_stationary_ = false;
  bool smoothers_ready_ = false;
  double shift_phase_ = 0.0;
  double ring_phase_ = 0.0;
  double barber_phase_ = 0.0;
  double smoothed_shift_ = 0.0;
  double smoothed_carrier_ = 0.0;
  double smoothed_minimum_ = 0.0;
  double smoothed_maximum_ = 0.0;
  double smoothed_rate_ = 0.0;
  double smoothed_stereo_phase_ = 0.0;
  double smoothed_mix_ = 0.0;
  std::vector<float> history_;
  std::vector<double> barber_carriers_;
  std::vector<HilbertTap> taps_;
};

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(FrequencyShifterPlugin,
                         effetune::plugins::modulation::FrequencyShifterKernel)
