#include "effetune/kernel.h"
#include "AutoLevelerPluginParams.h"
#include "effetune/dsp/biquad.h"
#include "effetune/dsp/denormal_noise.h"

#include "group_b_telemetry.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numbers>
#include <vector>

namespace effetune::plugins::dynamics {
namespace {

// Offset between the K-weighted power sum and the LUFS scale, ITU-R BS.1770-4 eq. (2).
constexpr double kLufsOffset = 0.691;
// K-weighting stage designs. Tables 1 and 2 of BS.1770-4 are the 48 kHz case of these, so
// deriving them from the prepared sample rate keeps the weighting curve in place at 44.1,
// 96 and 192 kHz instead of only at 48 kHz.
constexpr double kShelfFrequency = 1681.974450955533;
constexpr double kShelfGainDb = 3.999843853973347;
constexpr double kShelfQ = 0.7071752369554196;
constexpr double kShelfGainExponent = 0.4996667741545416;
constexpr double kHighpassFrequency = 38.13547087602444;
constexpr double kHighpassQ = 0.5003270373238773;

dsp::BiquadCoefficients designHighpass(double sample_rate) noexcept {
  const double k = std::tan(std::numbers::pi * kHighpassFrequency / sample_rate);
  const double a0 = 1.0 + k / kHighpassQ + k * k;
  return {1.0, -2.0, 1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / kHighpassQ + k * k) / a0};
}

dsp::BiquadCoefficients designShelf(double sample_rate) noexcept {
  const double k = std::tan(std::numbers::pi * kShelfFrequency / sample_rate);
  const double vh = std::pow(10.0, kShelfGainDb / 20.0);
  const double vb = std::pow(vh, kShelfGainExponent);
  const double a0 = 1.0 + k / kShelfQ + k * k;
  return {(vh + vb * k / kShelfQ + k * k) / a0, 2.0 * (k * k - vh) / a0,
          (vh - vb * k / kShelfQ + k * k) / a0, 2.0 * (k * k - 1.0) / a0,
          (1.0 - k / kShelfQ + k * k) / a0};
}

// BS.1770-4 table 3 weights. The Recommendation tabulates the 5.1 layout only, and Web Audio
// orders six channels L, R, C, LFE, Ls, Rs. Every other channel count is summed unweighted,
// which is the table's value for non-surround channels.
double channelWeight(std::uint32_t channel, std::uint32_t channel_count) noexcept {
  if (channel_count != 6u) {
    return 1.0;
  }
  if (channel == 3u) {
    return 0.0;
  }
  return channel >= 4u ? 1.41 : 1.0;
}

} // namespace

class AutoLevelerKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::AutoLevelerPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    pre_filter_ = designHighpass(sample_rate_);
    shelf_filter_ = designShelf(sample_rate_);
    weighted_buffer_.resize(info.maxFrames);
    power_buffer_.resize(info.maxFrames);
    pre_states_.resize(info.maxChannels);
    shelf_states_.resize(info.maxChannels);
    channel_weights_.resize(info.maxChannels);
    const double maximum_window = sample_rate_ * 10.0;
    maximum_window_samples_ =
        maximum_window > 1.0 ? static_cast<std::uint32_t>(maximum_window) : 1u;
    energy_buffer_.resize(maximum_window_samples_);
    reset();
  }

  void reset() noexcept override {
    std::fill(weighted_buffer_.begin(), weighted_buffer_.end(), 0.0F);
    std::fill(power_buffer_.begin(), power_buffer_.end(), 0.0);
    std::fill(energy_buffer_.begin(), energy_buffer_.end(), 0.0);
    resetChannelStates();
    buffer_index_ = 0u;
    valid_samples_ = 0u;
    active_channel_count_ = 0u;
    cumulative_energy_ = 0.0;
    previous_cycle_energy_ = 0.0;
    current_gain_ = 1.0;
    latest_input_lufs_ = -144.0F;
    latest_output_lufs_ = -144.0F;
    initialized_ = false;
    has_measurement_ = false;
    denormal_noise_.reset();
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > weighted_buffer_.size() || sample_rate_ <= 0.0) {
      return;
    }

    std::uint32_t requested_window = static_cast<std::uint32_t>(
        std::floor(static_cast<double>(params_.timeWindow) * 0.001 * sample_rate_));
    if (requested_window == 0u) {
      requested_window = 1u;
    } else if (requested_window > maximum_window_samples_) {
      requested_window = maximum_window_samples_;
    }
    if (!initialized_ || channel_count != active_channel_count_) {
      initializeState(channel_count);
    }

    // K-weight every channel on its own and accumulate the BS.1770-4 eq. (2) power sum
    // sum_ch G_ch * z_ch for this block. Mixing to mono first would under-read correlated
    // content by 3.01 LU and cancel anti-correlated content outright.
    std::fill(power_buffer_.begin(), power_buffer_.begin() + frame_count, 0.0);
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const double weight = channel_weights_[channel];
      if (weight == 0.0) {
        continue; // LFE is excluded from the loudness sum
      }
      const float *channel_audio = audio + channel * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        weighted_buffer_[frame] = static_cast<float>(dsp::processBiquadDf1SampleWithDenormalNoise(
            static_cast<double>(channel_audio[frame]), pre_filter_, pre_states_[channel],
            denormal_noise_.sample(frame)));
      }
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        weighted_buffer_[frame] = static_cast<float>(dsp::processBiquadDf1SampleWithDenormalNoise(
            static_cast<double>(weighted_buffer_[frame]), shelf_filter_, shelf_states_[channel],
            denormal_noise_.sample(frame)));
      }
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double weighted = static_cast<double>(weighted_buffer_[frame]);
        power_buffer_[frame] += weight * weighted * weighted;
      }
    }

    // The target and the gate are LUFS values, so they convert to the K-weighted power the
    // meter accumulates with the same BS.1770-4 offset.
    const double noise_gate_linear =
        std::pow(10.0, (static_cast<double>(params_.noiseGate) + kLufsOffset) / 10.0);
    const double target_lufs_linear =
        std::pow(10.0, (static_cast<double>(params_.targetLufs) + kLufsOffset) / 10.0);
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
      const double square = power_buffer_[frame];
      cumulative_energy_ += square;
      if (valid_samples_ < maximum_window_samples_) {
        ++valid_samples_;
      }
      const std::uint32_t window_count =
          valid_samples_ < requested_window ? valid_samples_ : requested_window;
      // Store within-cycle prefixes, reading the old slot before overwriting it.
      // This retains the full history for O(1) window changes without an ever-growing sum.
      const double sum =
          buffer_index_ < window_count
              ? cumulative_energy_ +
                    (previous_cycle_energy_ -
                     energy_buffer_[buffer_index_ + maximum_window_samples_ - window_count])
              : cumulative_energy_ - energy_buffer_[buffer_index_ - window_count];
      energy_buffer_[buffer_index_] = cumulative_energy_;
      ++buffer_index_;
      if (buffer_index_ == maximum_window_samples_) {
        buffer_index_ = 0u;
        previous_cycle_energy_ = cumulative_energy_;
        cumulative_energy_ = 0.0;
      }
      current_lufs_linear = sum > 0.0 ? sum / static_cast<double>(window_count) : 0.0;

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
    denormal_noise_.advance(frame_count);

    double input_lufs = -144.0;
    if (current_lufs_linear > 0.0) {
      input_lufs = 10.0 * std::log10(current_lufs_linear) - kLufsOffset;
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
  void resetChannelStates() noexcept {
    for (dsp::BiquadDf1State &state : pre_states_) {
      state.reset();
    }
    for (dsp::BiquadDf1State &state : shelf_states_) {
      state.reset();
    }
  }

  void initializeState(std::uint32_t channel_count) noexcept {
    std::fill(energy_buffer_.begin(), energy_buffer_.end(), 0.0);
    resetChannelStates();
    for (std::uint32_t channel = 0u; channel < channel_weights_.size(); ++channel) {
      channel_weights_[channel] = channelWeight(channel, channel_count);
    }
    buffer_index_ = 0u;
    valid_samples_ = 0u;
    active_channel_count_ = channel_count;
    cumulative_energy_ = 0.0;
    previous_cycle_energy_ = 0.0;
    current_gain_ = 1.0;
    latest_input_lufs_ = -144.0F;
    latest_output_lufs_ = -144.0F;
    initialized_ = true;
    has_measurement_ = false;
  }

  std::vector<float> weighted_buffer_;
  std::vector<double> power_buffer_;
  std::vector<double> energy_buffer_;
  std::vector<dsp::BiquadDf1State> pre_states_;
  std::vector<dsp::BiquadDf1State> shelf_states_;
  std::vector<double> channel_weights_;
  dsp::BiquadCoefficients pre_filter_{};
  dsp::BiquadCoefficients shelf_filter_{};
  double sample_rate_ = 0.0;
  double cumulative_energy_ = 0.0;
  double previous_cycle_energy_ = 0.0;
  double current_gain_ = 1.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t maximum_window_samples_ = 1u;
  std::uint32_t buffer_index_ = 0u;
  std::uint32_t valid_samples_ = 0u;
  std::uint32_t active_channel_count_ = 0u;
  float latest_input_lufs_ = -144.0F;
  float latest_output_lufs_ = -144.0F;
  bool initialized_ = false;
  bool has_measurement_ = false;
  dsp::NyquistDenormalNoise denormal_noise_;
};

static_assert(sizeof(AutoLevelerKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(AutoLevelerPlugin, effetune::plugins::dynamics::AutoLevelerKernel)
