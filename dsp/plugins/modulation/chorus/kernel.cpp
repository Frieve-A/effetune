#include "effetune/kernel.h"
#include "ChorusPluginParams.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::modulation {
namespace {

constexpr double kTwoPi = 6.2831853071795864769;
constexpr std::uint32_t kMaximumChannels = 8u;
constexpr std::uint32_t kMaximumVoices = 6u;

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

class ChorusKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::ChorusPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    prepared_ = std::isfinite(sample_rate_) && sample_rate_ > 0.0 && max_channels_ > 0u &&
                max_channels_ <= kMaximumChannels && max_frames_ > 0u;
    if (!prepared_)
      return;
    buffer_size_ = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.052)) + 4u;
    delay_buffers_.resize(static_cast<std::size_t>(max_channels_) * buffer_size_);
    feedback_state_.resize(max_channels_);
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  void reset() noexcept override {
    for (float &sample : delay_buffers_)
      sample = 0.0F;
    for (double &sample : feedback_state_)
      sample = 0.0;
    position_ = 0u;
    phase_ = 0.0;
    voice_phases_.fill(0.0);
    last_channel_count_ = 0u;
    initialized_ = false;
    transition_phase_ = 0u;
    transition_position_ = 0u;
    active_mode_ = 0u;
    active_voices_ = 3u;
    pending_mode_ = active_mode_;
    pending_voices_ = active_voices_;
    smoothed_initialized_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_)
      return;

    const std::uint32_t requested_mode = boundedInteger(params_.mode, 0u, 4u, active_mode_);
    const std::uint32_t requested_voices =
        boundedInteger(params_.voices, 1u, kMaximumVoices, active_voices_);
    const bool voices_affect_wet =
        requested_mode == 0u || requested_mode == 2u || active_mode_ == 0u || active_mode_ == 2u;
    if (!initialized_) {
      active_mode_ = requested_mode;
      active_voices_ = requested_voices;
      pending_mode_ = active_mode_;
      pending_voices_ = active_voices_;
    } else if ((requested_mode != active_mode_ ||
                (voices_affect_wet && requested_voices != active_voices_)) &&
               transition_phase_ == 0u) {
      pending_mode_ = requested_mode;
      pending_voices_ = requested_voices;
      transition_phase_ = 1u;
      transition_position_ = 0u;
    } else if (transition_phase_ != 0u) {
      pending_mode_ = requested_mode;
      pending_voices_ = requested_voices;
    } else {
      active_voices_ = requested_voices;
    }

    if (!initialized_ || channel_count != last_channel_count_) {
      clearAudioState();
      last_channel_count_ = channel_count;
      initialized_ = true;
    }

    const double delay_target = bounded(params_.delay, 0.5, 30.0, 12.0);
    const double targets[6] = {
        bounded(params_.rate, 0.05, 10.0, 0.8),
        delay_target,
        bounded(params_.depth, 0.0, delay_target, delay_target < 3.0 ? delay_target : 3.0),
        bounded(params_.stereoSpread, 0.0, 100.0, 60.0),
        bounded(params_.feedback, -75.0, 75.0, 0.0),
        bounded(params_.mix, 0.0, 100.0, 45.0),
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

      std::uint32_t voice_count = 1u;
      if (active_mode_ == 0u || active_mode_ == 2u)
        voice_count = active_voices_;
      else if (active_mode_ == 1u)
        voice_count = 2u;
      const double spread = active_mode_ == 0u ? 0.0 : smoothed_[3] * 0.01;
      const double feedback =
          active_mode_ == 3u ? bounded(smoothed_[4] * 0.01, -0.75, 0.75, 0.0) : 0.0;
      const double mix = active_mode_ == 4u ? 1.0 : smoothed_[5] * 0.01;
      double wet_gate = 1.0;
      if (transition_phase_ == 1u)
        wet_gate = 1.0 - static_cast<double>(transition_position_) /
                             static_cast<double>(transition_length);
      else if (transition_phase_ == 2u)
        wet_gate =
            static_cast<double>(transition_position_) / static_cast<double>(transition_length);

      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t audio_index = static_cast<std::size_t>(channel) * frame_count + frame;
        const std::size_t buffer_offset = static_cast<std::size_t>(channel) * buffer_size_;
        const double dry = static_cast<double>(audio[audio_index]);
        const double write = dry + feedback_state_[channel] * feedback;
        delay_buffers_[buffer_offset + position_] =
            static_cast<float>(std::isfinite(write) ? write : 0.0);
        double wet = 0.0;
        const double side = (channel & 1u) != 0u ? 1.0 : 0.0;
        for (std::uint32_t voice = 0u; voice < voice_count; ++voice) {
          const double voice_offset =
              kTwoPi * static_cast<double>(voice) / static_cast<double>(voice_count);
          const double stereo_offset = side * spread * 0.5 * 3.14159265358979323846;
          const double lfo_phase = active_mode_ == 2u ? voice_phases_[voice] : phase_;
          const double lfo = std::sin(lfo_phase + voice_offset + stereo_offset);
          double delay_ms = smoothed_[1] + smoothed_[2] * lfo;
          if (delay_ms < 0.05)
            delay_ms = 0.05;
          double delay_samples = delay_ms * sample_rate_ * 0.001;
          const double maximum_delay = static_cast<double>(buffer_size_ - 3u);
          if (delay_samples > maximum_delay)
            delay_samples = maximum_delay;
          wet += readCubic(buffer_offset, delay_samples);
        }
        wet /= static_cast<double>(voice_count);
        if (!std::isfinite(wet) || (wet > -1.0e-30 && wet < 1.0e-30))
          wet = 0.0;
        feedback_state_[channel] = wet;
        audio[audio_index] =
            static_cast<float>(dry * (1.0 - mix * wet_gate) + wet * mix * wet_gate);
      }

      phase_ += kTwoPi * smoothed_[0] / sample_rate_;
      if (phase_ >= kTwoPi)
        phase_ -= kTwoPi;
      if (active_mode_ == 2u) {
        const double voice_center = (static_cast<double>(voice_count) - 1.0) * 0.5;
        const double phase_step = kTwoPi * smoothed_[0] / sample_rate_;
        for (std::uint32_t voice = 0u; voice < voice_count; ++voice) {
          voice_phases_[voice] +=
              phase_step * (1.0 + (static_cast<double>(voice) - voice_center) * 0.03);
          if (voice_phases_[voice] >= kTwoPi)
            voice_phases_[voice] -= kTwoPi;
        }
      }
      ++position_;
      if (position_ >= buffer_size_)
        position_ = 0u;
      advanceTransition(transition_length);
    }
  }

private:
  [[nodiscard]] double readCubic(std::size_t offset, double delay_samples) const noexcept {
    double read = static_cast<double>(position_) - delay_samples;
    while (read < 0.0)
      read += static_cast<double>(buffer_size_);
    while (read >= static_cast<double>(buffer_size_))
      read -= static_cast<double>(buffer_size_);
    const auto index1 = static_cast<std::uint32_t>(std::floor(read));
    const double fraction = read - static_cast<double>(index1);
    const std::uint32_t index0 = index1 == 0u ? buffer_size_ - 1u : index1 - 1u;
    const std::uint32_t index2 = index1 + 1u == buffer_size_ ? 0u : index1 + 1u;
    const std::uint32_t index3 = index2 + 1u == buffer_size_ ? 0u : index2 + 1u;
    const double y0 = static_cast<double>(delay_buffers_[offset + index0]);
    const double y1 = static_cast<double>(delay_buffers_[offset + index1]);
    const double y2 = static_cast<double>(delay_buffers_[offset + index2]);
    const double y3 = static_cast<double>(delay_buffers_[offset + index3]);
    const double c0 = y1;
    const double c1 = 0.5 * (y2 - y0);
    const double c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const double c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * fraction + c2) * fraction + c1) * fraction + c0;
  }

  void clearAudioState() noexcept {
    for (float &sample : delay_buffers_)
      sample = 0.0F;
    for (double &sample : feedback_state_)
      sample = 0.0;
    position_ = 0u;
    phase_ = 0.0;
    voice_phases_.fill(0.0);
  }

  void advanceTransition(std::uint32_t transition_length) noexcept {
    if (transition_phase_ == 0u)
      return;
    ++transition_position_;
    if (transition_position_ < transition_length)
      return;
    if (transition_phase_ == 1u) {
      const bool flanger_boundary = active_mode_ == 3u || pending_mode_ == 3u;
      active_mode_ = pending_mode_;
      active_voices_ = pending_voices_;
      if (active_mode_ == 2u)
        voice_phases_.fill(phase_);
      if (flanger_boundary) {
        for (double &sample : feedback_state_)
          sample = 0.0;
      }
      transition_phase_ = 2u;
      transition_position_ = 0u;
    } else {
      transition_position_ = 0u;
      const bool voices_affect_next_wet =
          pending_mode_ == 0u || pending_mode_ == 2u || active_mode_ == 0u || active_mode_ == 2u;
      const bool topology_changed = pending_mode_ != active_mode_ ||
                                    (voices_affect_next_wet && pending_voices_ != active_voices_);
      if (topology_changed) {
        transition_phase_ = 1u;
      } else {
        active_voices_ = pending_voices_;
        transition_phase_ = 0u;
      }
    }
  }

  std::vector<float> delay_buffers_;
  std::vector<double> feedback_state_;
  std::array<double, kMaximumVoices> voice_phases_{};
  double smoothed_[6]{};
  double sample_rate_ = 0.0;
  double phase_ = 0.0;
  std::uint32_t buffer_size_ = 0u;
  std::uint32_t position_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t active_mode_ = 0u;
  std::uint32_t active_voices_ = 3u;
  std::uint32_t pending_mode_ = 0u;
  std::uint32_t pending_voices_ = 3u;
  std::uint32_t transition_phase_ = 0u;
  std::uint32_t transition_position_ = 0u;
  bool prepared_ = false;
  bool initialized_ = false;
  bool smoothed_initialized_ = false;
};

static_assert(sizeof(ChorusKernel) <= 8192u);

} // namespace effetune::plugins::modulation

EFFETUNE_REGISTER_KERNEL(ChorusPlugin, effetune::plugins::modulation::ChorusKernel)
