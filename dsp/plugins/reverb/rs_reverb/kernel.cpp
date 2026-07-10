#include "effetune/kernel.h"
#include "RSReverbPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

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
constexpr std::array<double, kCombCount> kBaseDelaysMs = {19.0, 29.0, 41.0, 47.0,
                                                          23.0, 31.0, 37.0, 43.0};

} // namespace

class RSReverbKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::RSReverbPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;

    const double pre_delay_raw = std::ceil(sample_rate_ * 0.05);
    pre_delay_length_ = pre_delay_raw > 0.0 ? static_cast<std::uint32_t>(pre_delay_raw) : 1u;
    const double allpass_raw = std::ceil(sample_rate_ * 0.005);
    allpass_length_ = allpass_raw > 0.0 ? static_cast<std::uint32_t>(allpass_raw) : 1u;
    comb_channel_stride_ = 0u;
    for (std::uint32_t line = 0u; line < kCombCount; ++line) {
      comb_line_offsets_[line] = comb_channel_stride_;
      const double maximum_delay_seconds = (kBaseDelaysMs[line] + 0.5) * 0.005;
      const double comb_raw = std::ceil(sample_rate_ * maximum_delay_seconds);
      const std::uint32_t capacity = comb_raw > 0.0 ? static_cast<std::uint32_t>(comb_raw) : 1u;
      comb_line_capacities_[line] = capacity;
      comb_channel_stride_ += capacity;
    }

    pre_delay_buffers_.resize(static_cast<std::size_t>(max_channels_) * pre_delay_length_);
    pre_delay_positions_.resize(max_channels_);
    const std::size_t comb_slots = static_cast<std::size_t>(max_channels_) * kCombCount;
    comb_buffers_.resize(static_cast<std::size_t>(max_channels_) * comb_channel_stride_);
    comb_positions_.resize(comb_slots);
    comb_high_damp_states_.resize(comb_slots);
    comb_low_damp_states_.resize(comb_slots);
    const std::size_t allpass_slots = static_cast<std::size_t>(max_channels_) * kAllpassCount;
    allpass_buffers_.resize(allpass_slots * allpass_length_);
    allpass_positions_.resize(allpass_slots);
    allpass_last_outputs_.resize(allpass_slots);
    channel_high_damp_states_.resize(max_channels_);
    channel_low_damp_states_.resize(max_channels_);
    clearHistories();
    active_channel_count_ = 0u;
    if (randomized_delays_ready_) {
      updateActiveCombLengths();
    } else {
      active_comb_lengths_.fill(1u);
    }
  }

  void reset() noexcept override {
    clearHistories();
    randomized_delays_ms_.fill(0.0);
    active_comb_lengths_.fill(1u);
    active_channel_count_ = 0u;
    configured_room_size_ = 0.0F;
    randomized_delays_ready_ = false;
    random_.seed(selected_seed_low_, selected_seed_high_);
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    random_.seed(seed_low, seed_high);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    const float room_size = params_.roomSize;
    const bool needs_randomized_delays =
        !randomized_delays_ready_ || configured_room_size_ != room_size;
    if (needs_randomized_delays)
      randomizeDelays(room_size);
    if (active_channel_count_ != channel_count || needs_randomized_delays) {
      clearHistories();
      active_channel_count_ = channel_count;
    }

    const double high_damp_coefficient =
        std::exp(-kTwoPi * static_cast<double>(params_.highDamp) / sample_rate_);
    const double low_damp_coefficient =
        1.0 - std::exp(-kTwoPi * static_cast<double>(params_.lowDamp) / sample_rate_);
    const double damping_amount = static_cast<double>(params_.damping) * 0.01;
    const double one_minus_damping = 1.0 - damping_amount;
    std::uint32_t active_combs = static_cast<std::uint32_t>(params_.density);
    if (active_combs < 1u)
      active_combs = 1u;
    if (active_combs > kCombCount)
      active_combs = kCombCount;
    const double normalization = 0.4 / static_cast<double>(active_combs);
    const double diffusion = static_cast<double>(params_.diffusion);
    const double diffusion_squared = diffusion * diffusion;
    const double one_minus_diffusion = 1.0 - diffusion;
    const double one_minus_diffusion_squared = 1.0 - diffusion_squared;
    const double wet_mix = static_cast<double>(params_.mix) * 0.01;
    const double dry_gain = wet_mix <= 0.5 ? 1.0 : 2.0 * (1.0 - wet_mix);
    const double wet_gain = wet_mix <= 0.5 ? 2.0 * wet_mix : 1.0;
    const bool has_damping = params_.damping > 0.0F;
    const double inverse_reverb_time = 1.0 / static_cast<double>(params_.reverbTime);

    std::array<double, kCombCount> feedback_gains{};
    for (std::uint32_t line = 0u; line < kCombCount; ++line) {
      const double delay_seconds = randomized_delays_ms_[line] * 0.001;
      double gain = std::pow(0.001, delay_seconds * inverse_reverb_time);
      if (gain > 0.99)
        gain = 0.99;
      if (gain < -0.99)
        gain = -0.99;
      feedback_gains[line] = gain;
    }

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
        const std::size_t audio_index = channel_audio_offset + frame;
        const double input = static_cast<double>(audio[audio_index]);
        const double delayed_input = static_cast<double>(pre_delay[pre_delay_position]);
        pre_delay[pre_delay_position] = static_cast<float>(input);
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
          const std::uint32_t length = active_comb_lengths_[line];
          const double delayed_sample = static_cast<double>(comb_buffer[position]);
          double high_state = comb_high_damp_states_[comb_index];
          double low_state = comb_low_damp_states_[comb_index];
          high_state = delayed_sample + high_damp_coefficient * (high_state - delayed_sample);
          low_state = high_state + low_damp_coefficient * (low_state - high_state);
          comb_high_damp_states_[comb_index] = high_state;
          comb_low_damp_states_[comb_index] = low_state;
          const double damped_sample =
              delayed_sample * one_minus_damping + low_state * damping_amount;
          comb_buffer[position] =
              static_cast<float>(delayed_input + damped_sample * feedback_gains[line]);
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

        if (has_damping) {
          channel_high_state = output + high_damp_coefficient * (channel_high_state - output);
          channel_low_state = output + low_damp_coefficient * (channel_low_state - output);
          output = output * one_minus_damping +
                   (channel_high_state * 0.5 + channel_low_state * 0.5) * damping_amount;
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
  }

private:
  void randomizeDelays(float room_size) noexcept {
    const double room_scale = static_cast<double>(room_size) * 0.1;
    for (std::uint32_t line = 0u; line < kCombCount; ++line) {
      const double delay = (kBaseDelaysMs[line] + random_.nextFloat01() - 0.5) * room_scale;
      randomized_delays_ms_[line] = delay;
    }
    updateActiveCombLengths();
    configured_room_size_ = room_size;
    randomized_delays_ready_ = true;
  }

  void updateActiveCombLengths() noexcept {
    for (std::uint32_t line = 0u; line < kCombCount; ++line) {
      const double delay = randomized_delays_ms_[line];
      const double raw_length = std::ceil(delay * sample_rate_ * 0.001);
      std::uint32_t length = raw_length > 0.0 ? static_cast<std::uint32_t>(raw_length) : 1u;
      if (length > comb_line_capacities_[line]) {
        length = comb_line_capacities_[line];
      }
      active_comb_lengths_[line] = length;
    }
  }

  void clearHistories() noexcept {
    std::fill(pre_delay_buffers_.begin(), pre_delay_buffers_.end(), 0.0F);
    std::fill(pre_delay_positions_.begin(), pre_delay_positions_.end(), 0u);
    std::fill(comb_buffers_.begin(), comb_buffers_.end(), 0.0F);
    std::fill(comb_positions_.begin(), comb_positions_.end(), 0u);
    std::fill(comb_high_damp_states_.begin(), comb_high_damp_states_.end(), 0.0);
    std::fill(comb_low_damp_states_.begin(), comb_low_damp_states_.end(), 0.0);
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
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  float configured_room_size_ = 0.0F;
  bool randomized_delays_ready_ = false;
  dsp::XorShiftRng random_{};
  std::array<double, kCombCount> randomized_delays_ms_{};
  std::array<std::uint32_t, kCombCount> active_comb_lengths_{};
  std::array<std::uint32_t, kCombCount> comb_line_capacities_{};
  std::array<std::uint32_t, kCombCount> comb_line_offsets_{};
  std::vector<float> pre_delay_buffers_;
  std::vector<std::uint32_t> pre_delay_positions_;
  std::vector<float> comb_buffers_;
  std::vector<std::uint32_t> comb_positions_;
  std::vector<double> comb_high_damp_states_;
  std::vector<double> comb_low_damp_states_;
  std::vector<float> allpass_buffers_;
  std::vector<std::uint32_t> allpass_positions_;
  std::vector<double> allpass_last_outputs_;
  std::vector<float> channel_high_damp_states_;
  std::vector<float> channel_low_damp_states_;
};

static_assert(sizeof(RSReverbKernel) <= 8192u);

} // namespace effetune::plugins::reverb

EFFETUNE_REGISTER_KERNEL(RSReverbPlugin, effetune::plugins::reverb::RSReverbKernel)
