#include "effetune/kernel.h"
#include "PhaserPluginParams.h"
#include "barber_window.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::modulation {
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTwoPi = 2.0 * kPi;
constexpr std::uint32_t kMaximumChannels = 16u;
constexpr std::uint32_t kMaximumStages = 12u;
constexpr std::uint32_t kBarberVoices = 3u;

double bounded(double value, double lower, double upper, double fallback) noexcept {
  if (!std::isfinite(value))
    return fallback;
  if (value < lower)
    return lower;
  return value > upper ? upper : value;
}

std::uint32_t boundedInteger(float value, std::uint32_t lower, std::uint32_t upper,
                             std::uint32_t fallback) noexcept {
  if (!std::isfinite(value))
    return fallback;
  const long rounded = std::lround(static_cast<double>(value));
  if (rounded < static_cast<long>(lower))
    return lower;
  return rounded > static_cast<long>(upper) ? upper : static_cast<std::uint32_t>(rounded);
}

} // namespace

class PhaserKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::PhaserPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    prepared_ = std::isfinite(sample_rate_) && sample_rate_ > 0.0 && max_channels_ > 0u &&
                max_channels_ <= kMaximumChannels && max_frames_ > 0u;
    if (!prepared_)
      return;
    allpass_state_.resize(static_cast<std::size_t>(max_channels_) * kBarberVoices * kMaximumStages);
    feedback_state_.resize(max_channels_);
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  void reset() noexcept override {
    clearRecursiveState();
    phase_ = 0.0;
    last_channel_count_ = 0u;
    initialized_ = false;
    active_mode_ = 0u;
    active_stages_ = 6u;
    active_direction_ = 0u;
    pending_mode_ = active_mode_;
    pending_stages_ = active_stages_;
    pending_direction_ = active_direction_;
    transition_phase_ = 0u;
    transition_position_ = 0u;
    smoothed_initialized_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_)
      return;

    const std::uint32_t requested_mode = boundedInteger(params_.mode, 0u, 1u, active_mode_);
    std::uint32_t requested_stages =
        boundedInteger(params_.stages, 2u, kMaximumStages, active_stages_);
    requested_stages = ((requested_stages + 1u) / 2u) * 2u;
    if (requested_stages > kMaximumStages)
      requested_stages = kMaximumStages;
    const std::uint32_t requested_direction =
        boundedInteger(params_.direction, 0u, 1u, active_direction_);
    const bool direction_affects_wet = requested_mode == 1u || active_mode_ == 1u;
    if (!initialized_) {
      active_mode_ = requested_mode;
      active_stages_ = requested_stages;
      active_direction_ = requested_direction;
      pending_mode_ = active_mode_;
      pending_stages_ = active_stages_;
      pending_direction_ = active_direction_;
    } else if ((requested_mode != active_mode_ || requested_stages != active_stages_ ||
                (direction_affects_wet && requested_direction != active_direction_)) &&
               transition_phase_ == 0u) {
      pending_mode_ = requested_mode;
      pending_stages_ = requested_stages;
      pending_direction_ = requested_direction;
      transition_phase_ = 1u;
      transition_position_ = 0u;
    } else if (transition_phase_ != 0u) {
      pending_mode_ = requested_mode;
      pending_stages_ = requested_stages;
      pending_direction_ = requested_direction;
    } else {
      active_direction_ = requested_direction;
    }

    if (!initialized_ || channel_count != last_channel_count_) {
      clearRecursiveState();
      phase_ = 0.0;
      last_channel_count_ = channel_count;
      initialized_ = true;
    }

    const double targets[6] = {
        bounded(params_.rate, 0.05, 10.0, 0.5),
        bounded(params_.centerFrequency, 80.0, 8000.0, 1000.0),
        bounded(params_.range, 0.0, 6.0, 3.0),
        bounded(params_.feedback, -90.0, 90.0, 20.0),
        bounded(params_.stereoPhase, 0.0, 180.0, 90.0),
        bounded(params_.mix, 0.0, 100.0, 50.0),
    };
    if (!smoothed_initialized_) {
      for (std::uint32_t index = 0u; index < 6u; ++index)
        smoothed_[index] = targets[index];
      smoothed_initialized_ = true;
    }
    const double smoothing = 1.0 - std::exp(-1.0 / (sample_rate_ * 0.005));
    const std::uint32_t transition_length =
        static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      for (std::uint32_t index = 0u; index < 6u; ++index)
        smoothed_[index] += (targets[index] - smoothed_[index]) * smoothing;
      const double feedback = bounded(smoothed_[3] * 0.01, -0.9, 0.9, 0.0);
      const double mix = smoothed_[5] * 0.01;
      double wet_gate = 1.0;
      if (transition_phase_ == 1u)
        wet_gate = 1.0 - static_cast<double>(transition_position_) /
                             static_cast<double>(transition_length);
      else if (transition_phase_ == 2u)
        wet_gate =
            static_cast<double>(transition_position_) / static_cast<double>(transition_length);

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t audio_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const double dry = static_cast<double>(audio[audio_index]);
        const double input = dry + feedback_state_[channel] * feedback;
        const double side_offset = (channel & 1u) != 0u ? smoothed_[4] / 360.0 : 0.0;
        double wet = 0.0;
        if (active_mode_ == 0u) {
          const double sweep = std::sin(phase_ + side_offset * kTwoPi);
          const double frequency =
              safeFrequency(smoothed_[1] * std::pow(2.0, 0.5 * smoothed_[2] * sweep));
          wet = runCascade(channel, 0u, input, coefficientForFrequency(frequency), active_stages_);
        } else {
          double weight_sum = 0.0;
          for (std::uint32_t voice = 0u; voice < kBarberVoices; ++voice) {
            double sweep_position = phase_ / kTwoPi + side_offset +
                                    static_cast<double>(voice) / static_cast<double>(kBarberVoices);
            sweep_position -= std::floor(sweep_position);
            if (active_direction_ == 1u)
              sweep_position = 1.0 - sweep_position;
            const double frequency =
                safeFrequency(smoothed_[1] * std::pow(2.0, smoothed_[2] * (sweep_position - 0.5)));
            const double weight = detail::barberWindow(sweep_position);
            wet += runCascade(channel, voice, input, coefficientForFrequency(frequency),
                              active_stages_) *
                   weight;
            weight_sum += weight;
          }
          wet /= weight_sum < 1.0e-9 ? 1.0e-9 : weight_sum;
        }
        if (!std::isfinite(wet))
          wet = 0.0;
        feedback_state_[channel] = wet;
        audio[audio_index] =
            static_cast<float>(dry * (1.0 - mix * wet_gate) + wet * mix * wet_gate);
      }

      phase_ += kTwoPi * smoothed_[0] / sample_rate_;
      if (phase_ >= kTwoPi)
        phase_ -= kTwoPi;
      advanceTransition(transition_length);
    }
  }

private:
  [[nodiscard]] double safeFrequency(double frequency) const noexcept {
    const double maximum = sample_rate_ * 0.45;
    if (!std::isfinite(frequency) || frequency < 20.0)
      return 20.0;
    return frequency > maximum ? maximum : frequency;
  }

  [[nodiscard]] double coefficientForFrequency(double frequency) const noexcept {
    const double tangent = std::tan(kPi * frequency / sample_rate_);
    return bounded((tangent - 1.0) / (tangent + 1.0), -0.999, 0.999, 0.0);
  }

  double runCascade(std::uint32_t channel, std::uint32_t voice, double input, double coefficient,
                    std::uint32_t stages) noexcept {
    const std::size_t base =
        (static_cast<std::size_t>(channel) * kBarberVoices + voice) * kMaximumStages;
    double sample = input;
    for (std::uint32_t stage = 0u; stage < stages; ++stage) {
      const double memory = allpass_state_[base + stage];
      const double output = coefficient * sample + memory;
      double next_memory = sample - coefficient * output;
      if (!std::isfinite(next_memory) || (next_memory > -1.0e-30 && next_memory < 1.0e-30))
        next_memory = 0.0;
      allpass_state_[base + stage] = next_memory;
      sample = output;
    }
    return sample;
  }

  void clearRecursiveState() noexcept {
    for (double &value : allpass_state_)
      value = 0.0;
    for (double &value : feedback_state_)
      value = 0.0;
  }

  void advanceTransition(std::uint32_t transition_length) noexcept {
    if (transition_phase_ == 0u)
      return;
    ++transition_position_;
    if (transition_position_ < transition_length)
      return;
    if (transition_phase_ == 1u) {
      active_mode_ = pending_mode_;
      active_stages_ = pending_stages_;
      active_direction_ = pending_direction_;
      clearRecursiveState();
      transition_phase_ = 2u;
      transition_position_ = 0u;
    } else {
      transition_position_ = 0u;
      const bool direction_affects_next_wet = pending_mode_ == 1u || active_mode_ == 1u;
      const bool topology_changed =
          pending_mode_ != active_mode_ || pending_stages_ != active_stages_ ||
          (direction_affects_next_wet && pending_direction_ != active_direction_);
      if (topology_changed) {
        transition_phase_ = 1u;
      } else {
        active_direction_ = pending_direction_;
        transition_phase_ = 0u;
      }
    }
  }

  std::vector<double> allpass_state_;
  std::vector<double> feedback_state_;
  double smoothed_[6]{};
  double sample_rate_ = 0.0;
  double phase_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t active_mode_ = 0u;
  std::uint32_t active_stages_ = 6u;
  std::uint32_t active_direction_ = 0u;
  std::uint32_t pending_mode_ = 0u;
  std::uint32_t pending_stages_ = 6u;
  std::uint32_t pending_direction_ = 0u;
  std::uint32_t transition_phase_ = 0u;
  std::uint32_t transition_position_ = 0u;
  bool prepared_ = false;
  bool initialized_ = false;
  bool smoothed_initialized_ = false;
};

static_assert(sizeof(PhaserKernel) <= 8192u);

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(PhaserPlugin, effetune::plugins::modulation::PhaserKernel)
