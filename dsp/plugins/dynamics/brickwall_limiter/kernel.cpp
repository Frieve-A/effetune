#include "effetune/kernel.h"
#include "BrickwallLimiterPluginParams.h"
#include "effetune/dsp/delay_line.h"

#include "../auto_leveler/group_b_telemetry.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace effetune::plugins::dynamics {

class BrickwallLimiterKernel final : public PluginKernel {
public:
  using Params = generated::BrickwallLimiterPluginParams;

  [[nodiscard]] std::uint32_t parameterHash() const noexcept final { return Params::kHash; }

  [[nodiscard]] std::uint32_t parameterFloatCount() const noexcept final {
    return Params::kFloatCount;
  }

  [[nodiscard]] std::uint32_t parameterByteCapacity() const noexcept final {
    return ::effetune::paramByteCapacity<Params>();
  }

  et_status stageParameters(const float *packed, std::uint32_t float_count,
                            std::uint32_t params_hash) noexcept final {
    if (params_hash != Params::kHash) {
      return ET_ERR_HASH;
    }
    if (float_count != Params::kFloatCount || packed == nullptr ||
        sizeof(Params) != sizeof(float) * Params::kFloatCount) {
      return ET_ERR_ARGS;
    }
    std::memcpy(&staged_params_, packed, sizeof(Params));
    params_pending_ = true;
    reported_latency_samples_ = latencyFor(staged_params_);
    return ET_OK;
  }

  void applyPendingParameters() noexcept final {
    if (params_pending_) {
      params_ = staged_params_;
      params_pending_ = false;
    }
  }

  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    const std::size_t maximum_samples = static_cast<std::size_t>(info.maxChannels) * info.maxFrames;
    input_buffer_.resize(maximum_samples);
    oversampled_.resize(maximum_samples * kMaximumOversampling);
    processed_oversampled_.resize(maximum_samples * kMaximumOversampling);
    upsample_states_.resize(static_cast<std::size_t>(info.maxChannels) * kMaximumUpsampleState);
    downsample_states_.resize(static_cast<std::size_t>(info.maxChannels) * kMaximumDownsampleState);
    x_buffer_.resize(static_cast<std::size_t>(info.maxFrames) + kMaximumUpsampleState);
    z_buffer_.resize(static_cast<std::size_t>(info.maxFrames) * kMaximumOversampling +
                     kMaximumDownsampleState);
    gain_states_.resize(info.maxChannels);
    threshold_lookup_.resize(kLookupSize);
    const auto maximum_delay = static_cast<std::uint32_t>(
        std::ceil(sample_rate_ * 0.01) * static_cast<double>(kMaximumOversampling));
    delay_prepared_ = delay_line_.prepare(info.maxChannels, maximum_delay);
    reset();
  }

  void reset() noexcept override {
    std::fill(input_buffer_.begin(), input_buffer_.end(), 0.0F);
    std::fill(oversampled_.begin(), oversampled_.end(), 0.0F);
    std::fill(processed_oversampled_.begin(), processed_oversampled_.end(), 0.0F);
    std::fill(upsample_states_.begin(), upsample_states_.end(), 0.0F);
    std::fill(downsample_states_.begin(), downsample_states_.end(), 0.0F);
    std::fill(x_buffer_.begin(), x_buffer_.end(), 0.0F);
    std::fill(z_buffer_.begin(), z_buffer_.end(), 0.0F);
    std::fill(gain_states_.begin(), gain_states_.end(), 1.0F);
    std::fill(threshold_lookup_.begin(), threshold_lookup_.end(), 1.0F);
    delay_line_.reset();
    prototype_.fill(0.0F);
    for (auto &phase : polyphase_) {
      phase.fill(0.0F);
    }
    phase_lengths_.fill(0u);
    active_channels_ = 0u;
    active_oversampling_ = 0u;
    active_delay_samples_ = 0u;
    active_lookahead_ = 0.0;
    maximum_phase_length_ = 0u;
    threshold_linear_ = 1.0;
    latest_reduction_db_ = 0.0F;
    topology_initialized_ = false;
    path_initialized_ = false;
    threshold_lookup_valid_ = false;
    has_measurement_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0 || !delay_prepared_) {
      return;
    }

    const std::uint32_t oversampling = normalizedOversampling();
    if (!topology_initialized_ || channel_count != active_channels_ ||
        oversampling != active_oversampling_) {
      initializeTopology(channel_count, oversampling);
    }

    constexpr double kLn10Over20 = 0.11512925464970229;
    const double input_gain = std::exp(static_cast<double>(params_.inputGain) * kLn10Over20);
    const std::size_t sample_count = static_cast<std::size_t>(channel_count) * frame_count;
    for (std::size_t index = 0u; index < sample_count; ++index) {
      input_buffer_[index] = static_cast<float>(static_cast<double>(audio[index]) * input_gain);
    }

    double release_ms = static_cast<double>(params_.release);
    if (release_ms < 10.0) {
      release_ms = 10.0;
    }
    const double release_seconds = release_ms * 0.001;
    const double effective_threshold =
        std::exp((static_cast<double>(params_.threshold) + static_cast<double>(params_.margin)) *
                 kLn10Over20);
    updateThresholdLookup(effective_threshold);

    if (oversampling == 1u) {
      processOriginalRate(audio, channel_count, frame_count, release_seconds);
    } else {
      processOversampled(audio, channel_count, frame_count, oversampling, release_seconds);
    }
    updateMeasurement(channel_count);
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (has_measurement_) {
      group_b_detail::writeGainReduction(writer, latest_reduction_db_);
    }
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return reported_latency_samples_;
  }

private:
  static constexpr std::uint32_t kFilterLength = 63u;
  static constexpr std::uint32_t kMaximumOversampling = 8u;
  static constexpr std::uint32_t kMaximumUpsampleState = 31u;
  static constexpr std::uint32_t kMaximumDownsampleState = 62u;
  static constexpr std::uint32_t kLookupSize = 1024u;
  static constexpr double kLookupMaximum = 10.0;
  static constexpr double kLookupScale = 1024.0 / kLookupMaximum;
  static constexpr double kPi = 3.141592653589793;

  [[nodiscard]] std::uint32_t normalizedOversampling() const noexcept {
    const auto value = static_cast<std::uint32_t>(params_.oversampling);
    return value == 2u || value == 4u || value == 8u ? value : 1u;
  }

  [[nodiscard]] std::uint32_t latencyFor(const Params &params) const noexcept {
    if (sample_rate_ <= 0.0) {
      return 0u;
    }
    const double raw_delay =
        std::ceil(static_cast<double>(params.lookahead) * sample_rate_ * 0.001);
    const std::uint32_t lookahead = raw_delay > 0.0 ? static_cast<std::uint32_t>(raw_delay) : 1u;
    const auto raw_factor = static_cast<std::uint32_t>(params.oversampling);
    const std::uint32_t factor =
        raw_factor == 2u || raw_factor == 4u || raw_factor == 8u ? raw_factor : 1u;
    if (factor == 1u) {
      return lookahead;
    }
    return lookahead + (62u + factor - 1u) / factor;
  }

  void initializeTopology(std::uint32_t channel_count, std::uint32_t oversampling) noexcept {
    active_channels_ = channel_count;
    active_oversampling_ = oversampling;
    active_delay_samples_ = 0u;
    active_lookahead_ = 0.0;
    path_initialized_ = false;
    threshold_lookup_valid_ = false;
    delay_line_.reset();
    std::fill(gain_states_.begin(), gain_states_.end(), 1.0F);
    std::fill(upsample_states_.begin(), upsample_states_.end(), 0.0F);
    std::fill(downsample_states_.begin(), downsample_states_.end(), 0.0F);
    if (oversampling > 1u) {
      buildPolyphaseFilter(oversampling);
    } else {
      maximum_phase_length_ = 0u;
      phase_lengths_.fill(0u);
    }
    topology_initialized_ = true;
  }

  void updateThresholdLookup(double threshold) noexcept {
    if (threshold_lookup_valid_ && threshold == threshold_linear_) {
      return;
    }
    constexpr double kInverseLookupSize = 1.0 / static_cast<double>(kLookupSize);
    for (std::uint32_t index = 0u; index < kLookupSize; ++index) {
      const double magnitude = static_cast<double>(index) * kInverseLookupSize * kLookupMaximum;
      double gain = 1.0;
      if (magnitude > 1.0e-6 && magnitude > threshold) {
        gain = threshold / magnitude;
      }
      threshold_lookup_[index] = static_cast<float>(gain);
    }
    threshold_linear_ = threshold;
    threshold_lookup_valid_ = true;
  }

  [[nodiscard]] double thresholdGain(double magnitude) const noexcept {
    if (magnitude <= 1.0e-6 || magnitude <= threshold_linear_) {
      return 1.0;
    }
    if (magnitude > kLookupMaximum) {
      return threshold_linear_ / magnitude;
    }
    std::uint32_t index = static_cast<std::uint32_t>(magnitude * kLookupScale);
    if (index >= kLookupSize) {
      index = kLookupSize - 1u;
    }
    return static_cast<double>(threshold_lookup_[index]);
  }

  [[nodiscard]] std::uint32_t originalDelaySamples() const noexcept {
    const double raw = std::ceil(static_cast<double>(params_.lookahead) * sample_rate_ * 0.001);
    const auto samples = static_cast<std::uint32_t>(raw);
    return samples > 0u ? samples : 1u;
  }

  void processOriginalRate(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                           double release_seconds) noexcept {
    const std::uint32_t delay_samples = originalDelaySamples();
    const double lookahead = static_cast<double>(params_.lookahead);
    if (!path_initialized_ || delay_samples != active_delay_samples_ ||
        lookahead != active_lookahead_) {
      delay_line_.reset();
      std::fill(gain_states_.begin(), gain_states_.end(), 1.0F);
      active_delay_samples_ = delay_samples;
      active_lookahead_ = lookahead;
      path_initialized_ = true;
    }

    const double release = std::exp(-(1.0 / sample_rate_) / release_seconds);
    const double release_inverse = 1.0 - release;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      double gain = static_cast<double>(gain_states_[channel]);
      const std::size_t offset = static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const float delayed = delay_line_.read(channel, delay_samples - 1u);
        delay_line_.push(channel, input_buffer_[offset + frame]);
        const double delayed_value = static_cast<double>(delayed);
        const double magnitude = delayed_value >= 0.0 ? delayed_value : -delayed_value;
        const double target = thresholdGain(magnitude);
        gain = target < gain ? target : release * gain + release_inverse * target;
        audio[offset + frame] = static_cast<float>(delayed_value * gain);
      }
      gain_states_[channel] = static_cast<float>(gain);
    }
  }

  void processOversampled(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                          std::uint32_t factor, double release_seconds) noexcept {
    const std::uint32_t upsample_state_length = maximum_phase_length_ - 1u;
    const std::uint32_t oversampled_frames = frame_count * factor;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *state =
          upsample_states_.data() + static_cast<std::size_t>(channel) * kMaximumUpsampleState;
      for (std::uint32_t index = 0u; index < upsample_state_length; ++index) {
        x_buffer_[index] = state[index];
      }
      const std::size_t input_offset = static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        x_buffer_[upsample_state_length + frame] = input_buffer_[input_offset + frame];
      }

      const std::size_t output_offset = static_cast<std::size_t>(channel) * oversampled_frames;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const std::uint32_t input_index = upsample_state_length + frame;
        for (std::uint32_t phase = 0u; phase < factor; ++phase) {
          double accumulator = 0.0;
          for (std::uint32_t tap = 0u; tap < phase_lengths_[phase]; ++tap) {
            accumulator += static_cast<double>(polyphase_[phase][tap]) *
                           static_cast<double>(x_buffer_[input_index - tap]);
          }
          oversampled_[output_offset + static_cast<std::size_t>(frame) * factor + phase] =
              static_cast<float>(accumulator);
        }
      }
      const std::uint32_t combined = upsample_state_length + frame_count;
      for (std::uint32_t index = 0u; index < upsample_state_length; ++index) {
        state[index] = x_buffer_[combined - upsample_state_length + index];
      }
    }

    if (!path_initialized_) {
      std::fill(gain_states_.begin(), gain_states_.end(), 1.0F);
      path_initialized_ = true;
    }
    const std::uint32_t delay_samples = originalDelaySamples() * factor;
    if (delay_samples != active_delay_samples_) {
      delay_line_.reset();
      active_delay_samples_ = delay_samples;
    }
    const double oversampled_rate = sample_rate_ * static_cast<double>(factor);
    const double release = std::exp(-(1.0 / oversampled_rate) / release_seconds);
    const double release_inverse = 1.0 - release;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      double gain = static_cast<double>(gain_states_[channel]);
      const std::size_t offset = static_cast<std::size_t>(channel) * oversampled_frames;
      for (std::uint32_t frame = 0u; frame < oversampled_frames; ++frame) {
        const float delayed = delay_line_.read(channel, delay_samples - 1u);
        delay_line_.push(channel, oversampled_[offset + frame]);
        const double delayed_value = static_cast<double>(delayed);
        const double magnitude = delayed_value >= 0.0 ? delayed_value : -delayed_value;
        const double target = thresholdGain(magnitude);
        gain = target < gain ? target : release * gain + release_inverse * target;
        processed_oversampled_[offset + frame] = static_cast<float>(delayed_value * gain);
      }
      gain_states_[channel] = static_cast<float>(gain);
    }

    const std::uint32_t phase_span = (kFilterLength + factor - 1u) / factor;
    const std::uint32_t downsample_state_length = factor * (phase_span - 1u);
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *state =
          downsample_states_.data() + static_cast<std::size_t>(channel) * kMaximumDownsampleState;
      for (std::uint32_t index = 0u; index < downsample_state_length; ++index) {
        z_buffer_[index] = state[index];
      }
      const std::size_t oversampled_offset = static_cast<std::size_t>(channel) * oversampled_frames;
      for (std::uint32_t frame = 0u; frame < oversampled_frames; ++frame) {
        z_buffer_[downsample_state_length + frame] =
            processed_oversampled_[oversampled_offset + frame];
      }

      const std::size_t output_offset = static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const std::uint32_t input_index = frame * factor + downsample_state_length;
        const std::uint32_t phase = input_index % factor;
        double accumulator = 0.0;
        for (std::uint32_t tap = 0u; tap < phase_lengths_[phase]; ++tap) {
          const std::uint32_t distance = factor * tap;
          if (distance > input_index) {
            break;
          }
          accumulator += static_cast<double>(polyphase_[phase][tap]) *
                         static_cast<double>(z_buffer_[input_index - distance]);
        }
        audio[output_offset + frame] = static_cast<float>(accumulator);
      }
      const std::uint32_t combined = downsample_state_length + oversampled_frames;
      for (std::uint32_t index = 0u; index < downsample_state_length; ++index) {
        state[index] = z_buffer_[combined - downsample_state_length + index];
      }
    }
  }

  void updateMeasurement(std::uint32_t channel_count) noexcept {
    float minimum_gain = 1.0F;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      if (gain_states_[channel] < minimum_gain) {
        minimum_gain = gain_states_[channel];
      }
    }
    const double reduction =
        minimum_gain < 1.0F ? -20.0 * std::log10(static_cast<double>(minimum_gain)) : 0.0;
    latest_reduction_db_ = static_cast<float>(reduction);
    has_measurement_ = true;
  }

  [[nodiscard]] static double calculateI0(double value) noexcept {
    const double absolute = value >= 0.0 ? value : -value;
    if (absolute < 3.75) {
      double ratio = value / 3.75;
      ratio *= ratio;
      return 1.0 + ratio * (3.5156229 +
                            ratio * (3.0899424 +
                                     ratio * (1.2067492 +
                                              ratio * (0.2659732 +
                                                       ratio * (0.0360768 + ratio * 0.0045813)))));
    }
    const double ratio = 3.75 / absolute;
    return (std::exp(absolute) / std::sqrt(absolute)) *
           (0.39894228 +
            ratio *
                (0.01328592 +
                 ratio * (0.00225319 +
                          ratio * (-0.00157565 +
                                   ratio * (0.00916281 +
                                            ratio * (-0.02057706 +
                                                     ratio * (0.02635537 +
                                                              ratio * (-0.01647633 +
                                                                       ratio * 0.00392377))))))));
  }

  void buildPolyphaseFilter(std::uint32_t factor) noexcept {
    constexpr double kBeta = 5.0;
    const double inverse_i0 = 1.0 / calculateI0(kBeta);
    const double center = static_cast<double>(kFilterLength - 1u) * 0.5;
    double sum = 0.0;
    for (std::uint32_t index = 0u; index < kFilterLength; ++index) {
      const double centered = (static_cast<double>(index) - center) / static_cast<double>(factor);
      double sinc = 1.0;
      const double magnitude = centered >= 0.0 ? centered : -centered;
      if (magnitude >= 1.0e-6) {
        const double angle = kPi * centered;
        sinc = std::sin(angle) / angle;
      }
      const double scaled =
          2.0 * (static_cast<double>(index) - center) / static_cast<double>(kFilterLength - 1u);
      const double inside = 1.0 - scaled * scaled;
      const double window =
          inside < 0.0 ? 0.0 : calculateI0(kBeta * std::sqrt(inside)) * inverse_i0;
      const double coefficient = sinc * window;
      prototype_[index] = static_cast<float>(coefficient);
      sum += coefficient;
    }
    const double normalization = static_cast<double>(factor) / sum;
    for (float &coefficient : prototype_) {
      coefficient = static_cast<float>(static_cast<double>(coefficient) * normalization);
    }

    maximum_phase_length_ = 0u;
    phase_lengths_.fill(0u);
    for (std::uint32_t phase = 0u; phase < factor; ++phase) {
      const std::uint32_t length = (kFilterLength - phase + factor - 1u) / factor;
      phase_lengths_[phase] = length;
      if (length > maximum_phase_length_) {
        maximum_phase_length_ = length;
      }
      for (std::uint32_t tap = 0u; tap < length; ++tap) {
        polyphase_[phase][tap] = prototype_[phase + factor * tap];
      }
    }
  }

  std::vector<float> input_buffer_;
  std::vector<float> oversampled_;
  std::vector<float> processed_oversampled_;
  std::vector<float> upsample_states_;
  std::vector<float> downsample_states_;
  std::vector<float> x_buffer_;
  std::vector<float> z_buffer_;
  std::vector<float> gain_states_;
  std::vector<float> threshold_lookup_;
  Params params_{};
  Params staged_params_{};
  dsp::DelayLine delay_line_;
  std::array<float, kFilterLength> prototype_{};
  std::array<std::array<float, kFilterLength>, kMaximumOversampling> polyphase_{};
  std::array<std::uint32_t, kMaximumOversampling> phase_lengths_{};
  double sample_rate_ = 0.0;
  double threshold_linear_ = 1.0;
  double active_lookahead_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t active_channels_ = 0u;
  std::uint32_t active_oversampling_ = 0u;
  std::uint32_t active_delay_samples_ = 0u;
  std::uint32_t maximum_phase_length_ = 0u;
  std::uint32_t reported_latency_samples_ = 0u;
  float latest_reduction_db_ = 0.0F;
  bool params_pending_ = false;
  bool topology_initialized_ = false;
  bool path_initialized_ = false;
  bool threshold_lookup_valid_ = false;
  bool has_measurement_ = false;
  bool delay_prepared_ = false;
};

static_assert(sizeof(BrickwallLimiterKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(BrickwallLimiterPlugin,
                         effetune::plugins::dynamics::BrickwallLimiterKernel)
