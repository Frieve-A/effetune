#include "effetune/kernel.h"
#include "MultibandTransientPluginParams.h"
#include "effetune/dsp/linkwitz_riley.h"

#include "../multiband_telemetry.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::dynamics {
namespace {

constexpr std::uint32_t kBandCount = 3u;
constexpr std::uint32_t kCrossoverCount = 2u;
constexpr double kGainFactor = 0.11512925464970229;

} // namespace

class MultibandTransientKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MultibandTransientPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    lowpass_states_.resize(static_cast<std::size_t>(kCrossoverCount) * max_channels_);
    highpass_states_.resize(static_cast<std::size_t>(kCrossoverCount) * max_channels_);
    fast_envelopes_.resize(static_cast<std::size_t>(kBandCount) * max_channels_);
    slow_envelopes_.resize(static_cast<std::size_t>(kBandCount) * max_channels_);
    band_storage_.resize(static_cast<std::size_t>(kBandCount) * max_channels_ * max_frames_);
    reset();
  }

  void reset() noexcept override {
    resetFilterStates();
    for (float &envelope : fast_envelopes_)
      envelope = 0.0F;
    for (float &envelope : slow_envelopes_)
      envelope = 0.0F;
    gains_.fill(1.0);
    latest_values_.fill(0.0F);
    frequencies_.fill(0.0F);
    channel_count_ = 0u;
    fade_counter_ = 0u;
    fade_length_ = 0u;
    configured_ = false;
    has_measurement_ = false;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    const std::array<float, kCrossoverCount> frequencies = {params_.frequency1, params_.frequency2};
    if (needsReset(frequencies, channel_count)) {
      resetFilterStates();
      for (std::uint32_t crossover = 0u; crossover < kCrossoverCount; ++crossover) {
        coefficients_[crossover] =
            dsp::designLinkwitzRiley24(sample_rate_, static_cast<double>(frequencies[crossover]));
      }
      for (float &envelope : fast_envelopes_)
        envelope = 0.0F;
      for (float &envelope : slow_envelopes_)
        envelope = 0.0F;
      gains_.fill(1.0);
      frequencies_ = frequencies;
      channel_count_ = channel_count;
      configured_ = true;
      startFade(frame_count);
    }

    splitBands(audio, channel_count, frame_count);
    shapeBands(channel_count, frame_count);
    sumBands(audio, channel_count, frame_count);
    applyFade(audio, channel_count, frame_count);
    has_measurement_ = true;
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (has_measurement_) {
      multiband_telemetry::write(writer, multiband_telemetry::ValueKind::TransientGain,
                                 latest_values_);
    }
  }

private:
  [[nodiscard]] bool needsReset(const std::array<float, kCrossoverCount> &frequencies,
                                std::uint32_t channel_count) const noexcept {
    if (!configured_ || channel_count_ != channel_count)
      return true;
    for (std::uint32_t crossover = 0u; crossover < kCrossoverCount; ++crossover) {
      if (frequencies_[crossover] != frequencies[crossover])
        return true;
    }
    return false;
  }

  void resetFilterStates() noexcept {
    for (dsp::LinkwitzRiley24State &state : lowpass_states_) {
      dsp::resetLinkwitzRiley24State(state, dsp::LinkwitzRileyStateStorage::Float64);
    }
    for (dsp::LinkwitzRiley24State &state : highpass_states_) {
      dsp::resetLinkwitzRiley24State(state, dsp::LinkwitzRileyStateStorage::Float64);
    }
  }

  void splitBands(const float *audio, std::uint32_t channel_count,
                  std::uint32_t frame_count) noexcept {
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const float *input = audio + static_cast<std::size_t>(channel) * frame_count;
      filterBlock(input, band(0u, channel), coefficients_[0u].lowpass, lowpassState(0u, channel),
                  frame_count);
    }
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const float *input = audio + static_cast<std::size_t>(channel) * frame_count;
      filterBlock(input, band(2u, channel), coefficients_[1u].highpass, highpassState(1u, channel),
                  frame_count);
    }
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const float *input = audio + static_cast<std::size_t>(channel) * frame_count;
      filterBlock(input, band(1u, channel), coefficients_[0u].highpass, highpassState(0u, channel),
                  frame_count);
    }
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *middle = band(1u, channel);
      filterBlock(middle, middle, coefficients_[1u].lowpass, lowpassState(1u, channel),
                  frame_count);
    }
  }

  void shapeBands(std::uint32_t channel_count, std::uint32_t frame_count) noexcept {
    for (std::uint32_t band_index = 0u; band_index < kBandCount; ++band_index) {
      const double transient_gain =
          std::exp(static_cast<double>(params_.transientGain[band_index]) * kGainFactor);
      const double sustain_gain =
          std::exp(static_cast<double>(params_.sustainGain[band_index]) * kGainFactor);
      const double fast_attack = coefficient(params_.fastAttack[band_index]);
      const double fast_release = coefficient(params_.fastRelease[band_index]);
      const double slow_attack = coefficient(params_.slowAttack[band_index]);
      const double slow_release = coefficient(params_.slowRelease[band_index]);
      const double smoothing = coefficient(params_.gainSmoothing[band_index]);
      double gain = gains_[band_index];

      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        double maximum_difference = 0.0;
        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          float *signal = band(band_index, channel);
          const double input = static_cast<double>(signal[frame]);
          const double magnitude = input < 0.0 ? -input : input;
          const std::size_t envelope_index =
              static_cast<std::size_t>(band_index) * max_channels_ + channel;

          const double previous_fast = static_cast<double>(fast_envelopes_[envelope_index]);
          const double fast_coefficient = magnitude > previous_fast ? fast_attack : fast_release;
          fast_envelopes_[envelope_index] = static_cast<float>(
              previous_fast * fast_coefficient + magnitude * (1.0 - fast_coefficient));

          const double previous_slow = static_cast<double>(slow_envelopes_[envelope_index]);
          const double slow_coefficient = magnitude > previous_slow ? slow_attack : slow_release;
          slow_envelopes_[envelope_index] = static_cast<float>(
              previous_slow * slow_coefficient + magnitude * (1.0 - slow_coefficient));

          const double difference = static_cast<double>(fast_envelopes_[envelope_index]) -
                                    static_cast<double>(slow_envelopes_[envelope_index]);
          if (difference > maximum_difference)
            maximum_difference = difference;
        }

        const double transient = maximum_difference > 0.0 ? maximum_difference : 0.0;
        const double transient_value = 1.0 + (transient_gain - 1.0) * transient;
        const double sustain_value = 1.0 + (sustain_gain - 1.0) * (1.0 - transient);
        const double target = transient_value * sustain_value;
        gain = (1.0 - smoothing) * target + smoothing * gain;

        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          float *signal = band(band_index, channel);
          double output = static_cast<double>(signal[frame]) * gain;
          if (output > 1.0) {
            output = 1.0;
          } else if (output < -1.0) {
            output = -1.0;
          }
          signal[frame] = static_cast<float>(output);
        }
      }
      gains_[band_index] = gain;
      latest_values_[band_index] = static_cast<float>(20.0 * std::log10(gain));
    }
  }

  void sumBands(float *audio, std::uint32_t channel_count, std::uint32_t frame_count) noexcept {
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      float *output = audio + static_cast<std::size_t>(channel) * frame_count;
      const float *low = band(0u, channel);
      const float *middle = band(1u, channel);
      const float *high = band(2u, channel);
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double low_middle =
            static_cast<double>(low[frame]) + static_cast<double>(middle[frame]);
        output[frame] = static_cast<float>(low_middle + static_cast<double>(high[frame]));
      }
    }
  }

  void applyFade(float *audio, std::uint32_t channel_count, std::uint32_t frame_count) noexcept {
    if (fade_counter_ >= fade_length_)
      return;
    const std::uint32_t samples_left = fade_length_ - fade_counter_;
    const std::uint32_t samples = samples_left < frame_count ? samples_left : frame_count;
    for (std::uint32_t frame = 0u; frame < samples; ++frame) {
      const double fade =
          static_cast<double>(fade_counter_ + frame) / static_cast<double>(fade_length_);
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
        audio[index] = static_cast<float>(static_cast<double>(audio[index]) * fade);
      }
    }
    fade_counter_ += samples;
  }

  void startFade(std::uint32_t frame_count) noexcept {
    const std::uint32_t requested = static_cast<std::uint32_t>(std::floor(sample_rate_ * 0.005));
    fade_length_ = requested < frame_count ? requested : frame_count;
    fade_counter_ = 0u;
  }

  [[nodiscard]] double coefficient(float milliseconds) const noexcept {
    return std::exp(-1.0 / (static_cast<double>(milliseconds) * 0.001 * sample_rate_));
  }

  void filterBlock(const float *input, float *output, const dsp::BiquadCoefficients &coefficients,
                   dsp::LinkwitzRiley24State &state, std::uint32_t frame_count) noexcept {
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      output[frame] = static_cast<float>(dsp::processLinkwitzRiley24Sample(
          static_cast<double>(input[frame]), coefficients, state));
    }
  }

  [[nodiscard]] float *band(std::uint32_t band_index, std::uint32_t channel) noexcept {
    const std::size_t offset =
        (static_cast<std::size_t>(band_index) * max_channels_ + channel) * max_frames_;
    return band_storage_.data() + offset;
  }

  [[nodiscard]] dsp::LinkwitzRiley24State &lowpassState(std::uint32_t crossover,
                                                        std::uint32_t channel) noexcept {
    return lowpass_states_[static_cast<std::size_t>(crossover) * max_channels_ + channel];
  }

  [[nodiscard]] dsp::LinkwitzRiley24State &highpassState(std::uint32_t crossover,
                                                         std::uint32_t channel) noexcept {
    return highpass_states_[static_cast<std::size_t>(crossover) * max_channels_ + channel];
  }

  std::array<dsp::LinkwitzRiley24Coefficients, kCrossoverCount> coefficients_{};
  std::array<float, kCrossoverCount> frequencies_{};
  std::array<double, kBandCount> gains_{};
  std::array<float, kBandCount> latest_values_{};
  std::vector<dsp::LinkwitzRiley24State> lowpass_states_;
  std::vector<dsp::LinkwitzRiley24State> highpass_states_;
  std::vector<float> fast_envelopes_;
  std::vector<float> slow_envelopes_;
  std::vector<float> band_storage_;
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t channel_count_ = 0u;
  std::uint32_t fade_counter_ = 0u;
  std::uint32_t fade_length_ = 0u;
  bool configured_ = false;
  bool has_measurement_ = false;
};

static_assert(sizeof(MultibandTransientKernel) <= 8192u);

} // namespace effetune::plugins::dynamics

EFFETUNE_REGISTER_KERNEL(MultibandTransientPlugin,
                         effetune::plugins::dynamics::MultibandTransientKernel)
