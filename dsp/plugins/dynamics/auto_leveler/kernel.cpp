#include "effetune/kernel.h"
#include "AutoLevelerPluginParams.h"
#include "effetune/dsp/biquad.h"

#include "group_b_telemetry.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::dynamics {
namespace {

constexpr dsp::BiquadCoefficients kPreFilter = {1.0, -2.0, 1.0, -1.99004745483398,
                                                0.99007225036621};
constexpr dsp::BiquadCoefficients kShelfFilter = {
    1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585};

} // namespace

class AutoLevelerKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::AutoLevelerPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    mono_buffer_.resize(info.maxFrames);
    weighted_buffer_.resize(info.maxFrames);
    const double maximum_window = sample_rate_ * 10.0;
    maximum_window_samples_ =
        maximum_window > 1.0 ? static_cast<std::uint32_t>(maximum_window) : 1u;
    energy_buffer_.resize(maximum_window_samples_);
    reset();
  }

  void reset() noexcept override {
    std::fill(mono_buffer_.begin(), mono_buffer_.end(), 0.0F);
    std::fill(weighted_buffer_.begin(), weighted_buffer_.end(), 0.0F);
    std::fill(energy_buffer_.begin(), energy_buffer_.end(), 0.0F);
    pre_state_.reset();
    shelf_state_.reset();
    buffer_index_ = 0u;
    window_samples_ = 1u;
    valid_samples_ = 0u;
    active_channel_count_ = 0u;
    sum_ = 0.0;
    current_gain_ = 1.0;
    latest_input_lufs_ = -144.0F;
    latest_output_lufs_ = -144.0F;
    initialized_ = false;
    has_measurement_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > mono_buffer_.size() || sample_rate_ <= 0.0) {
      return;
    }

    std::uint32_t requested_window = static_cast<std::uint32_t>(
        std::floor(static_cast<double>(params_.timeWindow) * 0.001 * sample_rate_));
    if (requested_window == 0u) {
      requested_window = 1u;
    } else if (requested_window > maximum_window_samples_) {
      requested_window = maximum_window_samples_;
    }
    if (!initialized_ || channel_count != active_channel_count_ ||
        requested_window != window_samples_) {
      initializeState(channel_count, requested_window);
    }

    std::fill(mono_buffer_.begin(), mono_buffer_.begin() + frame_count, 0.0F);
    const double channel_scale = 1.0 / static_cast<double>(channel_count);
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const float *channel_audio = audio + channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double contribution = channel_scale == 1.0
                                        ? static_cast<double>(channel_audio[frame])
                                        : static_cast<double>(channel_audio[frame]) * channel_scale;
        mono_buffer_[frame] =
            static_cast<float>(static_cast<double>(mono_buffer_[frame]) + contribution);
      }
    }

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      weighted_buffer_[frame] = static_cast<float>(dsp::processBiquadDf1Sample(
          static_cast<double>(mono_buffer_[frame]), kPreFilter, pre_state_));
    }
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      weighted_buffer_[frame] = static_cast<float>(dsp::processBiquadDf1Sample(
          static_cast<double>(weighted_buffer_[frame]), kShelfFilter, shelf_state_));
    }

    const double noise_gate_linear = std::pow(10.0, static_cast<double>(params_.noiseGate) / 10.0);
    const double target_lufs_linear =
        std::pow(10.0, static_cast<double>(params_.targetLufs) / 10.0);
    const double maximum_gain = std::pow(10.0, static_cast<double>(params_.maxGain) / 20.0);
    const double minimum_gain = std::pow(10.0, static_cast<double>(params_.minGain) / 20.0);
    const double attack_samples_raw = static_cast<double>(params_.attack) * sample_rate_ / 1000.0;
    const double attack_samples = attack_samples_raw < 1.0 ? 1.0 : attack_samples_raw;
    const double release_samples_raw = static_cast<double>(params_.release) * sample_rate_ / 1000.0;
    const double release_samples = release_samples_raw < 1.0 ? 1.0 : release_samples_raw;
    const double attack_decay = std::exp(-0.6931471805599453 / attack_samples);
    const double release_decay = std::exp(-0.6931471805599453 / release_samples);
    double gain = current_gain_;
    double current_lufs_linear = 0.0;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double weighted = static_cast<double>(weighted_buffer_[frame]);
      const double square = weighted * weighted;
      sum_ -= static_cast<double>(energy_buffer_[buffer_index_]);
      sum_ += square;
      energy_buffer_[buffer_index_] = static_cast<float>(square);
      ++buffer_index_;
      if (buffer_index_ == window_samples_) {
        buffer_index_ = 0u;
      }
      if (valid_samples_ < window_samples_) {
        ++valid_samples_;
      }
      current_lufs_linear = sum_ > 0.0 ? sum_ / static_cast<double>(valid_samples_) : 0.0;

      double target_gain = current_lufs_linear < noise_gate_linear || current_lufs_linear <= 0.0
                               ? 1.0
                               : std::sqrt(target_lufs_linear / current_lufs_linear);
      if (target_gain > maximum_gain) {
        target_gain = maximum_gain;
      } else if (target_gain < minimum_gain) {
        target_gain = minimum_gain;
      }
      const bool use_attack = target_gain < gain;
      const double decay = use_attack ? attack_decay : release_decay;
      gain = gain * decay + target_gain * (1.0 - decay);
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        audio[index] = static_cast<float>(static_cast<double>(audio[index]) * gain);
      }
    }
    current_gain_ = gain;

    double input_lufs = -144.0;
    if (current_lufs_linear > 0.0) {
      input_lufs = 10.0 * std::log10(current_lufs_linear) - 0.691;
      if (input_lufs < -144.0) {
        input_lufs = -144.0;
      }
    }
    double output_lufs = -144.0;
    if (input_lufs > -144.0 && gain > 0.0) {
      output_lufs = input_lufs + 20.0 * std::log10(gain);
      if (output_lufs < -144.0) {
        output_lufs = -144.0;
      }
    }
    if (valid_samples_ > 0u) {
      latest_input_lufs_ = static_cast<float>(input_lufs);
      latest_output_lufs_ = static_cast<float>(output_lufs);
      has_measurement_ = true;
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (has_measurement_) {
      group_b_detail::writeLoudnessLevels(writer, latest_input_lufs_, latest_output_lufs_);
    }
  }

private:
  void initializeState(std::uint32_t channel_count, std::uint32_t requested_window) noexcept {
    std::fill(energy_buffer_.begin(), energy_buffer_.begin() + requested_window, 0.0F);
    pre_state_.reset();
    shelf_state_.reset();
    buffer_index_ = 0u;
    window_samples_ = requested_window;
    valid_samples_ = 0u;
    active_channel_count_ = channel_count;
    sum_ = 0.0;
    current_gain_ = 1.0;
    latest_input_lufs_ = -144.0F;
    latest_output_lufs_ = -144.0F;
    initialized_ = true;
    has_measurement_ = false;
  }

  std::vector<float> mono_buffer_;
  std::vector<float> weighted_buffer_;
  std::vector<float> energy_buffer_;
  dsp::BiquadDf1State pre_state_{};
  dsp::BiquadDf1State shelf_state_{};
  double sample_rate_ = 0.0;
  double sum_ = 0.0;
  double current_gain_ = 1.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t maximum_window_samples_ = 1u;
  std::uint32_t window_samples_ = 1u;
  std::uint32_t buffer_index_ = 0u;
  std::uint32_t valid_samples_ = 0u;
  std::uint32_t active_channel_count_ = 0u;
  float latest_input_lufs_ = -144.0F;
  float latest_output_lufs_ = -144.0F;
  bool initialized_ = false;
  bool has_measurement_ = false;
};

static_assert(sizeof(AutoLevelerKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(AutoLevelerPlugin, effetune::plugins::dynamics::AutoLevelerKernel)
