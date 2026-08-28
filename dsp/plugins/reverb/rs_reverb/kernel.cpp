#include "effetune/kernel.h"
#include "RSReverbPluginParams.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::reverb {
namespace {

constexpr std::uint32_t kCombCount = 8u;
constexpr std::uint32_t kAllpassCount = 2u;
constexpr double kTwoPi = 6.283185307179586;
constexpr double kMaxDelayJitter = 1.03;
constexpr double kMaxRoomScale = 5.0;
constexpr std::array<double, kCombCount> kBaseDelaysMs = {19.0, 29.0, 41.0, 47.0,
                                                          23.0, 31.0, 37.0, 43.0};
constexpr std::array<double, 16u> kDelayJitter = {1.0000, 0.9884, 1.0157, 0.9738, 1.0291, 0.9812,
                                                  1.0043, 0.9926, 1.0198, 0.9701, 1.0114, 0.9855,
                                                  1.0266, 0.9793, 1.0089, 0.9968};

} // namespace

class RSReverbKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::RSReverbPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    ramp_frames_ = std::max(1u, static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005)));

    const double pre_delay_raw = std::ceil(sample_rate_ * 0.05) + 1.0;
    pre_delay_length_ = pre_delay_raw > 0.0 ? static_cast<std::uint32_t>(pre_delay_raw) : 1u;
    const double allpass_raw = std::ceil(sample_rate_ * 0.005);
    allpass_length_ = allpass_raw > 0.0 ? static_cast<std::uint32_t>(allpass_raw) : 1u;
    comb_channel_stride_ = 0u;
    for (std::uint32_t line = 0u; line < kCombCount; ++line) {
      comb_line_offsets_[line] = comb_channel_stride_;
      const double maximum_delay_seconds =
          kBaseDelaysMs[line] * kMaxDelayJitter * kMaxRoomScale * 0.001;
      const double comb_raw = std::ceil(sample_rate_ * maximum_delay_seconds);
      const std::uint32_t capacity = comb_raw > 0.0 ? static_cast<std::uint32_t>(comb_raw) : 1u;
      comb_line_capacities_[line] = capacity;
      comb_channel_stride_ += capacity;
    }

    pre_delay_buffers_.resize(static_cast<std::size_t>(max_channels_) * pre_delay_length_);
    pre_delay_positions_.resize(max_channels_);
    const std::size_t comb_slots = static_cast<std::size_t>(max_channels_) * kCombCount;
    comb_delays_ms_.resize(comb_slots);
    active_comb_lengths_.resize(comb_slots, 1u);
    feedback_gains_.resize(comb_slots);
    target_feedback_gains_.resize(comb_slots);
    feedback_steps_.resize(comb_slots);
    feedback_targets_.resize(comb_slots);
    comb_buffers_.resize(static_cast<std::size_t>(max_channels_) * comb_channel_stride_);
    comb_positions_.resize(comb_slots);
    comb_damp_states_1_.resize(comb_slots);
    comb_damp_states_2_.resize(comb_slots);
    const std::size_t allpass_slots = static_cast<std::size_t>(max_channels_) * kAllpassCount;
    allpass_buffers_.resize(allpass_slots * allpass_length_);
    allpass_positions_.resize(allpass_slots);
    allpass_last_outputs_.resize(allpass_slots);
    channel_high_damp_states_.resize(max_channels_);
    channel_low_damp_states_.resize(max_channels_);
    clearHistories();
    if (controls_initialized_) {
      const double pre_delay_target =
          std::clamp(static_cast<double>(params_.preDelay) * sample_rate_ * 0.001, 0.0,
                     static_cast<double>(pre_delay_length_ - 1u));
      current_controls_[5u] = pre_delay_target;
      target_controls_[5u] = pre_delay_target;
      control_steps_[5u] = 0.0;
    }
    active_channel_count_ = 0u;
    if (comb_delays_ready_)
      configureCombDelays(configured_room_size_);
  }

  void reset() noexcept override {
    clearHistories();
    std::fill(comb_delays_ms_.begin(), comb_delays_ms_.end(), 0.0);
    std::fill(active_comb_lengths_.begin(), active_comb_lengths_.end(), 1u);
    active_channel_count_ = 0u;
    configured_room_size_ = 0.0F;
    comb_delays_ready_ = false;
    controls_initialized_ = false;
    feedback_channel_count_ = 0u;
    ramp_remaining_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    const float room_size = params_.roomSize;
    const bool needs_comb_delays = !comb_delays_ready_ || configured_room_size_ != room_size;
    if (needs_comb_delays)
      configureCombDelays(room_size);
    if (active_channel_count_ != channel_count || needs_comb_delays) {
      clearHistories();
      active_channel_count_ = channel_count;
    }

    retargetControls();
    std::uint32_t active_combs = static_cast<std::uint32_t>(params_.density);
    if (active_combs < 1u)
      active_combs = 1u;
    if (active_combs > kCombCount)
      active_combs = kCombCount;
    const double normalization = 0.4 / static_cast<double>(active_combs);

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *pre_delay =
          pre_delay_buffers_.data() + static_cast<std::size_t>(channel) * pre_delay_length_;
      std::uint32_t pre_delay_position = pre_delay_positions_[channel];
      double channel_high_state = static_cast<double>(channel_high_damp_states_[channel]);
      double channel_low_state = static_cast<double>(channel_low_damp_states_[channel]);

      const std::size_t allpass_index0 = static_cast<std::size_t>(channel) * kAllpassCount;
      const std::size_t allpass_index1 = allpass_index0 + 1u;
      float *allpass_buffer0 = allpass_buffers_.data() + allpass_index0 * allpass_length_;
      float *allpass_buffer1 = allpass_buffers_.data() + allpass_index1 * allpass_length_;
      std::uint32_t allpass_position0 = allpass_positions_[allpass_index0];
      std::uint32_t allpass_position1 = allpass_positions_[allpass_index1];
      double allpass_last_output0 = allpass_last_outputs_[allpass_index0];
      double allpass_last_output1 = allpass_last_outputs_[allpass_index1];

      const std::size_t channel_audio_offset = static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double high_damp_coefficient = controlAt(0u, frame);
        const double low_damp_coefficient = controlAt(1u, frame);
        // Unity-peak bandpass: preserve RT60 in the passband while damping both ends.
        const double damping_pole_product = high_damp_coefficient * (1.0 - low_damp_coefficient);
        const double damping_pole_sum = high_damp_coefficient + 1.0 - low_damp_coefficient;
        const double damping_input_gain = 0.5 * (1.0 - damping_pole_product);
        const double damping_amount = controlAt(2u, frame);
        const double one_minus_damping = 1.0 - damping_amount;
        const double diffusion = controlAt(3u, frame);
        const double diffusion_squared = diffusion * diffusion;
        const double one_minus_diffusion = 1.0 - diffusion;
        const double one_minus_diffusion_squared = 1.0 - diffusion_squared;
        const double wet_mix = controlAt(4u, frame);
        const double dry_gain = wet_mix <= 0.5 ? 1.0 : 2.0 * (1.0 - wet_mix);
        const double wet_gain = wet_mix <= 0.5 ? 2.0 * wet_mix : 1.0;
        const std::size_t audio_index = channel_audio_offset + frame;
        const double input = static_cast<double>(audio[audio_index]);
        pre_delay[pre_delay_position] = static_cast<float>(input);
        double read = static_cast<double>(pre_delay_position) - controlAt(5u, frame);
        if (read < 0.0)
          read += static_cast<double>(pre_delay_length_);
        const auto first = static_cast<std::uint32_t>(std::floor(read));
        const std::uint32_t next = first + 1u == pre_delay_length_ ? 0u : first + 1u;
        const double fraction = read - static_cast<double>(first);
        const double delayed_input = static_cast<double>(pre_delay[first]) +
                                     fraction * (static_cast<double>(pre_delay[next]) -
                                                 static_cast<double>(pre_delay[first]));
        ++pre_delay_position;
        if (pre_delay_position >= pre_delay_length_)
          pre_delay_position = 0u;

        double comb_output = 0.0;
        for (std::uint32_t line = 0u; line < active_combs; ++line) {
          const std::size_t comb_index = static_cast<std::size_t>(channel) * kCombCount + line;
          float *comb_buffer = comb_buffers_.data() +
                               static_cast<std::size_t>(channel) * comb_channel_stride_ +
                               comb_line_offsets_[line];
          std::uint32_t position = comb_positions_[comb_index];
          const std::uint32_t length = active_comb_lengths_[comb_index];
          const double delayed_sample = static_cast<double>(comb_buffer[position]);
          // H(z) = (1-ab)/2 * (1-z^-2) / ((1-a*z^-1)(1-b*z^-1)).
          const double scaled_input = damping_input_gain * delayed_sample;
          const double bandpassed = scaled_input + comb_damp_states_1_[comb_index];
          comb_damp_states_1_[comb_index] =
              damping_pole_sum * bandpassed + comb_damp_states_2_[comb_index];
          comb_damp_states_2_[comb_index] = -scaled_input - damping_pole_product * bandpassed;
          const double damped_sample =
              delayed_sample * one_minus_damping + bandpassed * damping_amount;
          comb_buffer[position] =
              static_cast<float>(delayed_input + damped_sample * feedbackAt(comb_index, frame));
          ++position;
          if (position >= length)
            position = 0u;
          comb_positions_[comb_index] = position;
          comb_output += damped_sample;
        }
        double output = comb_output * normalization;

        const double delay_sample0 = static_cast<double>(allpass_buffer0[allpass_position0]);
        const double output0 =
            -one_minus_diffusion * output + delay_sample0 + diffusion * allpass_last_output0;
        allpass_buffer0[allpass_position0] = static_cast<float>(output);
        ++allpass_position0;
        if (allpass_position0 >= allpass_length_)
          allpass_position0 = 0u;
        allpass_last_output0 = output0;
        output = output0 * one_minus_diffusion_squared;

        const double delay_sample1 = static_cast<double>(allpass_buffer1[allpass_position1]);
        const double output1 =
            -one_minus_diffusion * output + delay_sample1 + diffusion * allpass_last_output1;
        allpass_buffer1[allpass_position1] = static_cast<float>(output);
        ++allpass_position1;
        if (allpass_position1 >= allpass_length_)
          allpass_position1 = 0u;
        allpass_last_output1 = output1;
        output = output1 * one_minus_diffusion_squared;

        if (damping_amount > 0.0) {
          channel_high_state = output + high_damp_coefficient * (channel_high_state - output);
          channel_low_state += low_damp_coefficient * (output - channel_low_state);
          output = output * one_minus_damping +
                   (channel_high_state * 0.5 + (output - channel_low_state) * 0.5) * damping_amount;
        }
        audio[audio_index] = static_cast<float>(input * dry_gain + output * wet_gain);
      }

      pre_delay_positions_[channel] = pre_delay_position;
      allpass_positions_[allpass_index0] = allpass_position0;
      allpass_positions_[allpass_index1] = allpass_position1;
      allpass_last_outputs_[allpass_index0] = allpass_last_output0;
      allpass_last_outputs_[allpass_index1] = allpass_last_output1;
      channel_high_damp_states_[channel] = static_cast<float>(channel_high_state);
      channel_low_damp_states_[channel] = static_cast<float>(channel_low_state);
    }
    advanceControls(frame_count);
  }

private:
  void retargetControls() noexcept {
    const std::array<double, 6u> targets{
        std::exp(-kTwoPi * static_cast<double>(params_.highDamp) / sample_rate_),
        1.0 - std::exp(-kTwoPi * static_cast<double>(params_.lowDamp) / sample_rate_),
        static_cast<double>(params_.damping) * 0.01,
        static_cast<double>(params_.diffusion),
        static_cast<double>(params_.mix) * 0.01,
        std::clamp(static_cast<double>(params_.preDelay) * sample_rate_ * 0.001, 0.0,
                   static_cast<double>(pre_delay_length_ - 1u))};
    const double inverse_reverb_time = 1.0 / static_cast<double>(params_.reverbTime);
    for (std::size_t index = 0u; index < comb_delays_ms_.size(); ++index) {
      feedback_targets_[index] = std::clamp(
          std::pow(0.001, comb_delays_ms_[index] * 0.001 * inverse_reverb_time), -0.99, 0.99);
    }
    if (!controls_initialized_) {
      current_controls_ = target_controls_ = targets;
      controls_initialized_ = true;
      control_steps_.fill(0.0);
    }
    if (feedback_channel_count_ != active_channel_count_) {
      std::copy(feedback_targets_.begin(), feedback_targets_.end(), feedback_gains_.begin());
      std::copy(feedback_targets_.begin(), feedback_targets_.end(), target_feedback_gains_.begin());
      std::fill(feedback_steps_.begin(), feedback_steps_.end(), 0.0);
      feedback_channel_count_ = active_channel_count_;
    }
    if (targets == target_controls_ && feedback_targets_ == target_feedback_gains_)
      return;
    target_controls_ = targets;
    std::copy(feedback_targets_.begin(), feedback_targets_.end(), target_feedback_gains_.begin());
    const double inverse = 1.0 / static_cast<double>(ramp_frames_);
    for (std::size_t index = 0u; index < targets.size(); ++index) {
      control_steps_[index] = (targets[index] - current_controls_[index]) * inverse;
    }
    for (std::size_t index = 0u; index < feedback_targets_.size(); ++index) {
      feedback_steps_[index] = (feedback_targets_[index] - feedback_gains_[index]) * inverse;
    }
    ramp_remaining_ = ramp_frames_;
  }

  double controlAt(std::size_t index, std::uint32_t frame) const noexcept {
    return current_controls_[index] +
           control_steps_[index] * static_cast<double>(std::min(frame + 1u, ramp_remaining_));
  }

  double feedbackAt(std::size_t index, std::uint32_t frame) const noexcept {
    return std::clamp(feedback_gains_[index] +
                          feedback_steps_[index] *
                              static_cast<double>(std::min(frame + 1u, ramp_remaining_)),
                      -0.99, 0.99);
  }

  void advanceControls(std::uint32_t frames) noexcept {
    const std::uint32_t advanced = std::min(frames, ramp_remaining_);
    for (std::size_t index = 0u; index < current_controls_.size(); ++index) {
      current_controls_[index] += control_steps_[index] * static_cast<double>(advanced);
    }
    for (std::size_t index = 0u; index < feedback_gains_.size(); ++index) {
      feedback_gains_[index] += feedback_steps_[index] * static_cast<double>(advanced);
    }
    ramp_remaining_ -= advanced;
    if (ramp_remaining_ == 0u) {
      current_controls_ = target_controls_;
      std::copy(target_feedback_gains_.begin(), target_feedback_gains_.end(),
                feedback_gains_.begin());
    }
  }

  void configureCombDelays(float room_size) noexcept {
    const double room_scale = static_cast<double>(room_size) / 10.0;
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      for (std::uint32_t line = 0u; line < kCombCount; ++line) {
        const std::size_t index = static_cast<std::size_t>(channel) * kCombCount + line;
        comb_delays_ms_[index] = kBaseDelaysMs[line] *
                                 kDelayJitter[(channel * 7u + line) % kDelayJitter.size()] *
                                 room_scale;
      }
    }
    updateActiveCombLengths();
    configured_room_size_ = room_size;
    comb_delays_ready_ = true;
  }

  void updateActiveCombLengths() noexcept {
    for (std::size_t index = 0u; index < comb_delays_ms_.size(); ++index) {
      const auto line = index % kCombCount;
      const double delay = comb_delays_ms_[index];
      const double raw_length = std::ceil(delay * sample_rate_ * 0.001);
      std::uint32_t length = raw_length > 0.0 ? static_cast<std::uint32_t>(raw_length) : 1u;
      if (length > comb_line_capacities_[line]) {
        length = comb_line_capacities_[line];
      }
      active_comb_lengths_[index] = length;
    }
  }

  void clearHistories() noexcept {
    std::fill(pre_delay_buffers_.begin(), pre_delay_buffers_.end(), 0.0F);
    std::fill(pre_delay_positions_.begin(), pre_delay_positions_.end(), 0u);
    std::fill(comb_buffers_.begin(), comb_buffers_.end(), 0.0F);
    std::fill(comb_positions_.begin(), comb_positions_.end(), 0u);
    std::fill(comb_damp_states_1_.begin(), comb_damp_states_1_.end(), 0.0);
    std::fill(comb_damp_states_2_.begin(), comb_damp_states_2_.end(), 0.0);
    std::fill(allpass_buffers_.begin(), allpass_buffers_.end(), 0.0F);
    std::fill(allpass_positions_.begin(), allpass_positions_.end(), 0u);
    std::fill(allpass_last_outputs_.begin(), allpass_last_outputs_.end(), 0.0);
    std::fill(channel_high_damp_states_.begin(), channel_high_damp_states_.end(), 0.0F);
    std::fill(channel_low_damp_states_.begin(), channel_low_damp_states_.end(), 0.0F);
  }

  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t pre_delay_length_ = 1u;
  std::uint32_t allpass_length_ = 1u;
  std::uint32_t comb_channel_stride_ = 0u;
  std::uint32_t active_channel_count_ = 0u;
  std::uint32_t feedback_channel_count_ = 0u;
  float configured_room_size_ = 0.0F;
  bool comb_delays_ready_ = false;
  bool controls_initialized_ = false;
  std::array<double, 6u> current_controls_{};
  std::array<double, 6u> target_controls_{};
  std::array<double, 6u> control_steps_{};
  std::vector<double> feedback_gains_;
  std::vector<double> target_feedback_gains_;
  std::vector<double> feedback_steps_;
  std::vector<double> feedback_targets_;
  std::uint32_t ramp_frames_ = 240u;
  std::uint32_t ramp_remaining_ = 0u;
  std::vector<double> comb_delays_ms_;
  std::vector<std::uint32_t> active_comb_lengths_;
  std::array<std::uint32_t, kCombCount> comb_line_capacities_{};
  std::array<std::uint32_t, kCombCount> comb_line_offsets_{};
  std::vector<float> pre_delay_buffers_;
  std::vector<std::uint32_t> pre_delay_positions_;
  std::vector<float> comb_buffers_;
  std::vector<std::uint32_t> comb_positions_;
  std::vector<double> comb_damp_states_1_;
  std::vector<double> comb_damp_states_2_;
  std::vector<float> allpass_buffers_;
  std::vector<std::uint32_t> allpass_positions_;
  std::vector<double> allpass_last_outputs_;
  std::vector<float> channel_high_damp_states_;
  std::vector<float> channel_low_damp_states_;
};

static_assert(sizeof(RSReverbKernel) <= 8192u);

} // namespace effetune::plugins::reverb

EFFETUNE_REGISTER_KERNEL(RSReverbPlugin, effetune::plugins::reverb::RSReverbKernel)
