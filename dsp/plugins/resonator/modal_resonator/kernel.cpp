#include "effetune/kernel.h"
#include "ModalResonatorPluginParams.h"
#include "effetune/dsp/denormal_noise.h"

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
  double delay_samples = 1.0;
  double feedback = 0.0;
  double high_pass_alpha = 0.0;
  double low_pass_alpha = 0.0;
  double gain = 0.0;
  bool enabled = false;
};

struct AutomationControls final {
  std::array<double, modal_resonator::kResonatorCount> frequency_log{};
  std::array<double, modal_resonator::kResonatorCount> decay{};
  std::array<double, modal_resonator::kResonatorCount> high_pass_log{};
  std::array<double, modal_resonator::kResonatorCount> low_pass_log{};
  std::array<double, modal_resonator::kResonatorCount> gain{};
  double mix = 0.0;
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
    config_trajectory_.resize(static_cast<std::size_t>(max_frames_) *
                              modal_resonator::kResonatorCount);
    wet_trajectory_.resize(max_frames_);
    dry_trajectory_.resize(max_frames_);
    automation_ramp_frames_ = static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005));
    if (automation_ramp_frames_ == 0u) {
      automation_ramp_frames_ = 1u;
    }
    reset();
  }

  void reset() noexcept override {
    std::fill(delay_buffers_.begin(), delay_buffers_.end(), 0.0F);
    std::fill(delay_positions_.begin(), delay_positions_.end(), 0u);
    for (FilterState &state : filter_states_)
      state.reset();
    std::fill(accumulation_.begin(), accumulation_.end(), 0.0F);
    active_channels_ = 0u;
    automation_initialized_ = false;
    automation_ramp_remaining_ = 0u;
    denormal_noise_.reset();
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }
    if (active_channels_ != channel_count)
      initializeChannels(channel_count);

    if (!automation_initialized_) {
      for (std::uint32_t resonator = 0u; resonator < modal_resonator::kResonatorCount;
           ++resonator) {
        controls_.frequency_log[resonator] = params_.frequencyLog[resonator];
        controls_.decay[resonator] = params_.decay[resonator];
        controls_.high_pass_log[resonator] = params_.highPassLog[resonator];
        controls_.low_pass_log[resonator] = params_.lowPassLog[resonator];
        controls_.gain[resonator] = params_.gain[resonator];
      }
      controls_.mix = params_.mix;
      targets_ = controls_;
      automation_initialized_ = true;
    } else if (automationTargetsChanged()) {
      updateAutomationTargets();
      automation_ramp_remaining_ = automation_ramp_frames_;
    }
    const bool automation_active = automation_ramp_remaining_ != 0u;
    const std::uint32_t trajectory_frames = automation_active ? frame_count : 1u;
    for (std::uint32_t frame = 0u; frame < trajectory_frames; ++frame) {
      if (automation_ramp_remaining_ != 0u) {
        const double ramp_scale = 1.0 / static_cast<double>(automation_ramp_remaining_);
        controls_.mix += (targets_.mix - controls_.mix) * ramp_scale;
        for (std::uint32_t resonator = 0u; resonator < modal_resonator::kResonatorCount;
             ++resonator) {
          controls_.frequency_log[resonator] +=
              (targets_.frequency_log[resonator] - controls_.frequency_log[resonator]) * ramp_scale;
          controls_.decay[resonator] +=
              (targets_.decay[resonator] - controls_.decay[resonator]) * ramp_scale;
          controls_.high_pass_log[resonator] +=
              (targets_.high_pass_log[resonator] - controls_.high_pass_log[resonator]) * ramp_scale;
          controls_.low_pass_log[resonator] +=
              (targets_.low_pass_log[resonator] - controls_.low_pass_log[resonator]) * ramp_scale;
          controls_.gain[resonator] +=
              (targets_.gain[resonator] - controls_.gain[resonator]) * ramp_scale;
        }
        --automation_ramp_remaining_;
        if (automation_ramp_remaining_ == 0u) {
          controls_ = targets_;
        }
      }
      wet_trajectory_[frame] = controls_.mix < 50.0 ? controls_.mix * 0.02 : 1.0;
      dry_trajectory_[frame] = controls_.mix < 50.0 ? 1.0 : (100.0 - controls_.mix) * 0.02;
      for (std::uint32_t resonator = 0u; resonator < modal_resonator::kResonatorCount;
           ++resonator) {
        ResonatorConfig &config =
            config_trajectory_[static_cast<std::size_t>(frame) * modal_resonator::kResonatorCount +
                               resonator];
        config.enabled = params_.resonatorEnabled[resonator] != 0.0F;
        const double frequency = std::exp(controls_.frequency_log[resonator]);
        config.delay_samples = std::clamp(sample_rate_ / frequency, 1.0,
                                          static_cast<double>(delay_buffer_length_ - 1u));
        double cycles = controls_.decay[resonator] * 0.001 * sample_rate_ / config.delay_samples;
        if (cycles < kMinimumCycles)
          cycles = kMinimumCycles;
        const double feedback = std::exp(std::log(kDecayTarget) / cycles);
        config.feedback = feedback < kMaximumFeedback ? feedback : kMaximumFeedback;
        config.high_pass_alpha =
            std::exp(-2.0 * std::numbers::pi_v<double> *
                     std::exp(controls_.high_pass_log[resonator]) / sample_rate_);
        config.low_pass_alpha =
            std::exp(-2.0 * std::numbers::pi_v<double> *
                     std::exp(controls_.low_pass_log[resonator]) / sample_rate_);
        config.gain = std::pow(10.0, controls_.gain[resonator] / 20.0);
      }
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t audio_offset = static_cast<std::size_t>(channel) * frame_count;
      std::fill(accumulation_.begin(), accumulation_.begin() + frame_count, 0.0F);

      for (std::uint32_t resonator = 0u; resonator < modal_resonator::kResonatorCount;
           ++resonator) {
        if (!config_trajectory_[resonator].enabled)
          continue;

        const std::size_t state_index =
            static_cast<std::size_t>(channel) * modal_resonator::kResonatorCount + resonator;
        float *delay = delay_buffers_.data() + state_index * delay_buffer_length_;
        std::uint32_t position = delay_positions_[state_index];
        FilterState &state = filter_states_[state_index];

        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const std::uint32_t trajectory_frame = automation_active ? frame : 0u;
          const ResonatorConfig &config =
              config_trajectory_[static_cast<std::size_t>(trajectory_frame) *
                                     modal_resonator::kResonatorCount +
                                 resonator];
          const float input = audio[audio_offset + frame];
          const double noise = denormal_noise_.sample(frame);
          const std::uint32_t delay_floor = static_cast<std::uint32_t>(config.delay_samples);
          const double fraction = config.delay_samples - static_cast<double>(delay_floor);
          const std::uint32_t read_position = position >= delay_floor
                                                  ? position - delay_floor
                                                  : position + delay_buffer_length_ - delay_floor;
          const std::uint32_t older_position =
              read_position == 0u ? delay_buffer_length_ - 1u : read_position - 1u;
          const double delayed = static_cast<double>(delay[read_position]) +
                                 fraction * (static_cast<double>(delay[older_position]) -
                                             static_cast<double>(delay[read_position]));
          delay[position] =
              static_cast<float>(static_cast<double>(input) + noise + delayed * config.feedback);

          const double delayed_double = delayed;
          const double after_high_pass =
              config.high_pass_alpha *
                  (state.high_pass_y_previous + delayed_double - state.high_pass_x_previous) +
              noise;
          state.high_pass_x_previous = delayed_double;
          state.high_pass_y_previous = after_high_pass;
          const double after_low_pass =
              state.low_pass_y_previous +
              (1.0 - config.low_pass_alpha) * (after_high_pass - state.low_pass_y_previous) + noise;
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
        const std::uint32_t trajectory_frame = automation_active ? frame : 0u;
        const double dry = static_cast<double>(audio[audio_offset + frame]);
        audio[audio_offset + frame] = static_cast<float>(dry * dry_trajectory_[trajectory_frame] +
                                                         static_cast<double>(accumulation_[frame]) *
                                                             wet_trajectory_[trajectory_frame]);
      }
    }
    denormal_noise_.advance(frame_count);
  }

private:
  bool automationTargetsChanged() const noexcept {
    if (targets_.mix != static_cast<double>(params_.mix)) {
      return true;
    }
    for (std::uint32_t resonator = 0u; resonator < modal_resonator::kResonatorCount; ++resonator) {
      if (targets_.frequency_log[resonator] !=
              static_cast<double>(params_.frequencyLog[resonator]) ||
          targets_.decay[resonator] != static_cast<double>(params_.decay[resonator]) ||
          targets_.high_pass_log[resonator] !=
              static_cast<double>(params_.highPassLog[resonator]) ||
          targets_.low_pass_log[resonator] != static_cast<double>(params_.lowPassLog[resonator]) ||
          targets_.gain[resonator] != static_cast<double>(params_.gain[resonator])) {
        return true;
      }
    }
    return false;
  }

  void updateAutomationTargets() noexcept {
    targets_.mix = params_.mix;
    for (std::uint32_t resonator = 0u; resonator < modal_resonator::kResonatorCount; ++resonator) {
      targets_.frequency_log[resonator] = params_.frequencyLog[resonator];
      targets_.decay[resonator] = params_.decay[resonator];
      targets_.high_pass_log[resonator] = params_.highPassLog[resonator];
      targets_.low_pass_log[resonator] = params_.lowPassLog[resonator];
      targets_.gain[resonator] = params_.gain[resonator];
    }
  }

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
  std::vector<ResonatorConfig> config_trajectory_;
  std::vector<double> wet_trajectory_;
  std::vector<double> dry_trajectory_;
  AutomationControls controls_{};
  AutomationControls targets_{};
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t delay_buffer_length_ = 2u;
  std::uint32_t active_channels_ = 0u;
  std::uint32_t automation_ramp_frames_ = 240u;
  std::uint32_t automation_ramp_remaining_ = 0u;
  bool automation_initialized_ = false;
  dsp::NyquistDenormalNoise denormal_noise_;
};

static_assert(sizeof(ModalResonatorKernel) <= 8192u);

} // namespace effetune::plugins::resonator

EFFETUNE_REGISTER_KERNEL(ModalResonatorPlugin, effetune::plugins::resonator::ModalResonatorKernel)
