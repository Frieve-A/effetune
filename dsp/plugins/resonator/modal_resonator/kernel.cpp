#include "effetune/kernel.h"
#include "ModalResonatorPluginParams.h"

#include "modal_resonator_common.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numbers>
#include <vector>

namespace effetune::plugins::resonator {
namespace {

constexpr double kMinimumCycles = 0.1;
constexpr double kMaximumFeedback = 0.999;
constexpr double kDecayTarget = 0.001;

struct ResonatorConfig final {
  std::uint32_t delay_samples = 1u;
  double feedback = 0.0;
  double high_pass_alpha = 0.0;
  double low_pass_alpha = 0.0;
  double gain = 0.0;
  bool enabled = false;
};

struct FilterState final {
  double high_pass_x_previous = 0.0;
  double high_pass_y_previous = 0.0;
  double low_pass_y_previous = 0.0;

  void reset() noexcept {
    high_pass_x_previous = 0.0;
    high_pass_y_previous = 0.0;
    low_pass_y_previous = 0.0;
  }
};

} // namespace

class ModalResonatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::ModalResonatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    delay_buffer_length_ = modal_resonator::delayBufferLength(sample_rate_);
    const std::size_t state_count =
        static_cast<std::size_t>(max_channels_) * modal_resonator::kResonatorCount;
    delay_buffers_.resize(state_count * delay_buffer_length_);
    delay_positions_.resize(state_count);
    filter_states_.resize(state_count);
    accumulation_.resize(max_frames_);
    reset();
  }

  void reset() noexcept override {
    std::fill(delay_buffers_.begin(), delay_buffers_.end(), 0.0F);
    std::fill(delay_positions_.begin(), delay_positions_.end(), 0u);
    for (FilterState &state : filter_states_)
      state.reset();
    std::fill(accumulation_.begin(), accumulation_.end(), 0.0F);
    active_channels_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }
    if (active_channels_ != channel_count)
      initializeChannels(channel_count);

    std::array<ResonatorConfig, modal_resonator::kResonatorCount> configs{};
    for (std::uint32_t resonator = 0u; resonator < modal_resonator::kResonatorCount; ++resonator) {
      ResonatorConfig &config = configs[resonator];
      config.enabled = params_.resonatorEnabled[resonator] != 0.0F;
      if (!config.enabled)
        continue;

      const double frequency = std::exp(static_cast<double>(params_.frequencyLog[resonator]));
      const double requested_delay = std::floor(sample_rate_ / frequency);
      const std::uint32_t maximum_delay = delay_buffer_length_ - 1u;
      std::uint32_t delay_samples = 1u;
      if (!std::isfinite(requested_delay) ||
          requested_delay >= static_cast<double>(delay_buffer_length_)) {
        delay_samples = maximum_delay;
      } else if (requested_delay >= 1.0) {
        delay_samples = static_cast<std::uint32_t>(requested_delay);
      }
      config.delay_samples = delay_samples;

      const double decay_samples =
          static_cast<double>(params_.decay[resonator]) * 0.001 * sample_rate_;
      double cycles = decay_samples / static_cast<double>(delay_samples);
      if (cycles < kMinimumCycles)
        cycles = kMinimumCycles;
      double feedback = std::exp(std::log(kDecayTarget) / cycles);
      if (feedback > kMaximumFeedback)
        feedback = kMaximumFeedback;
      config.feedback = feedback;

      const double high_pass_frequency =
          std::exp(static_cast<double>(params_.highPassLog[resonator]));
      config.high_pass_alpha =
          std::exp(-2.0 * std::numbers::pi_v<double> * high_pass_frequency / sample_rate_);
      const double low_pass_frequency =
          std::exp(static_cast<double>(params_.lowPassLog[resonator]));
      config.low_pass_alpha =
          std::exp(-2.0 * std::numbers::pi_v<double> * low_pass_frequency / sample_rate_);
      config.gain = std::pow(10.0, static_cast<double>(params_.gain[resonator]) / 20.0);
    }

    const double mix = static_cast<double>(params_.mix);
    const double wet_gain = mix < 50.0 ? mix * 0.02 : 1.0;
    const double dry_gain = mix < 50.0 ? 1.0 : (100.0 - mix) * 0.02;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t audio_offset = static_cast<std::size_t>(channel) * frame_count;
      std::fill(accumulation_.begin(), accumulation_.begin() + frame_count, 0.0F);

      for (std::uint32_t resonator = 0u; resonator < modal_resonator::kResonatorCount;
           ++resonator) {
        const ResonatorConfig &config = configs[resonator];
        if (!config.enabled)
          continue;

        const std::size_t state_index =
            static_cast<std::size_t>(channel) * modal_resonator::kResonatorCount + resonator;
        float *delay = delay_buffers_.data() + state_index * delay_buffer_length_;
        std::uint32_t position = delay_positions_[state_index];
        FilterState &state = filter_states_[state_index];

        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const float input = audio[audio_offset + frame];
          const std::uint32_t read_position =
              position >= config.delay_samples
                  ? position - config.delay_samples
                  : position + delay_buffer_length_ - config.delay_samples;
          const float delayed = delay[read_position];
          delay[position] = static_cast<float>(static_cast<double>(input) +
                                               static_cast<double>(delayed) * config.feedback);

          const double delayed_double = static_cast<double>(delayed);
          const double after_high_pass =
              config.high_pass_alpha *
              (state.high_pass_y_previous + delayed_double - state.high_pass_x_previous);
          state.high_pass_x_previous = delayed_double;
          state.high_pass_y_previous = after_high_pass;
          const double after_low_pass =
              state.low_pass_y_previous +
              (1.0 - config.low_pass_alpha) * (after_high_pass - state.low_pass_y_previous);
          state.low_pass_y_previous = after_low_pass;
          const double output = after_low_pass * config.gain;
          accumulation_[frame] =
              static_cast<float>(static_cast<double>(accumulation_[frame]) + output);

          ++position;
          if (position >= delay_buffer_length_)
            position = 0u;
        }
        delay_positions_[state_index] = position;
      }

      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double dry = static_cast<double>(audio[audio_offset + frame]);
        audio[audio_offset + frame] = static_cast<float>(
            dry * dry_gain + static_cast<double>(accumulation_[frame]) * wet_gain);
      }
    }
  }

private:
  void initializeChannels(std::uint32_t channel_count) noexcept {
    std::fill(delay_buffers_.begin(), delay_buffers_.end(), 0.0F);
    std::fill(delay_positions_.begin(), delay_positions_.end(), 0u);
    for (FilterState &state : filter_states_)
      state.reset();
    active_channels_ = channel_count;
  }

  std::vector<float> delay_buffers_;
  std::vector<std::uint32_t> delay_positions_;
  std::vector<FilterState> filter_states_;
  std::vector<float> accumulation_;
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t delay_buffer_length_ = 2u;
  std::uint32_t active_channels_ = 0u;
};

static_assert(sizeof(ModalResonatorKernel) <= 8192u);

} // namespace effetune::plugins::resonator

EFFETUNE_REGISTER_KERNEL(ModalResonatorPlugin, effetune::plugins::resonator::ModalResonatorKernel)
