#include "effetune/kernel.h"
#include "MultibandSaturationPluginParams.h"
#include "effetune/dsp/linkwitz_riley.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numbers>
#include <vector>

namespace effetune::plugins::saturation {
namespace {

[[nodiscard]] dsp::LinkwitzRiley24Coefficients
designLegacyCrossover(double sample_rate, double requested_frequency) noexcept {
  const double minimum_frequency = 20.0;
  const double maximum_frequency = sample_rate * 0.5 - 1.0;
  const double frequency =
      requested_frequency < minimum_frequency
          ? minimum_frequency
          : (requested_frequency > maximum_frequency ? maximum_frequency : requested_frequency);
  const double q = dsp::kSecondOrderButterworthQ;
  const double k = 2.0 * sample_rate;
  const double warped =
      2.0 * sample_rate * std::tan(std::numbers::pi_v<double> * frequency / sample_rate);
  const double k_squared = k * k;
  const double warped_squared = warped * warped;
  const double k_squared_q = k_squared * q;
  const double warped_squared_q = warped_squared * q;
  const double a0 = k_squared_q + k * warped + warped_squared_q;
  const double a1 = -2.0 * k_squared_q + 2.0 * warped_squared_q;
  const double a2 = k_squared_q - k * warped + warped_squared_q;

  dsp::LinkwitzRiley24Coefficients result{};
  result.lowpass.b0 = warped_squared_q / a0;
  result.lowpass.b1 = 2.0 * warped_squared_q / a0;
  result.lowpass.b2 = warped_squared_q / a0;
  result.lowpass.a1 = a1 / a0;
  result.lowpass.a2 = a2 / a0;
  result.highpass.b0 = k_squared_q / a0;
  result.highpass.b1 = -2.0 * k_squared_q / a0;
  result.highpass.b2 = k_squared_q / a0;
  result.highpass.a1 = a1 / a0;
  result.highpass.a2 = a2 / a0;
  return result;
}

} // namespace

class MultibandSaturationKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MultibandSaturationPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    lowpass_states_.resize(2u * max_channels_);
    highpass_states_.resize(2u * max_channels_);
    band_signals_.resize(static_cast<std::size_t>(max_channels_) * 3u * max_frames_);
    temporary_.resize(static_cast<std::size_t>(2u) * max_frames_);
    reset();
  }

  void reset() noexcept override {
    resetFilterStates();
    configured_ = false;
    last_channel_count_ = 0u;
    last_frequencies_ = {};
    fade_present_ = false;
    fade_counter_ = 0u;
    fade_length_ = 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    const std::array<float, 2u> frequencies{params_.frequency1, params_.frequency2};
    bool frequencies_changed = !configured_;
    for (std::size_t index = 0u; index < frequencies.size(); ++index) {
      if (frequencies[index] != last_frequencies_[index]) {
        frequencies_changed = true;
      }
    }
    if (!configured_ || channel_count != last_channel_count_ || frequencies_changed) {
      resetFilterStates();
      for (std::size_t index = 0u; index < frequencies.size(); ++index) {
        coefficients_[index] =
            designLegacyCrossover(sample_rate_, static_cast<double>(frequencies[index]));
        last_frequencies_[index] = frequencies[index];
      }
      configured_ = true;
      last_channel_count_ = channel_count;
      fade_present_ = true;
      fade_counter_ = 0u;
      const std::uint32_t five_milliseconds = static_cast<std::uint32_t>(sample_rate_ * 0.005);
      fade_length_ = five_milliseconds > frame_count ? frame_count : five_milliseconds;
    }

    const std::uint32_t fade_start = fade_counter_;
    const std::uint32_t fade_length = fade_length_;
    const bool fade_active = fade_present_ && fade_start < fade_length;

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t audio_offset = static_cast<std::size_t>(channel) * frame_count;
      float *input = temporary_.data();
      float *highpass1 = temporary_.data() + max_frames_;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        input[frame] = audio[audio_offset + frame];
      }

      float *low = bandBuffer(channel, 0u);
      float *mid = bandBuffer(channel, 1u);
      float *high = bandBuffer(channel, 2u);
      filterBlock(input, low, coefficients_[0].lowpass, lowpassState(0u, channel), frame_count);
      filterBlock(input, highpass1, coefficients_[0].highpass, highpassState(0u, channel),
                  frame_count);
      filterBlock(highpass1, mid, coefficients_[1].lowpass, lowpassState(1u, channel), frame_count);
      filterBlock(highpass1, high, coefficients_[1].highpass, highpassState(1u, channel),
                  frame_count);

      for (std::uint32_t band = 0u; band < 3u; ++band) {
        const double drive = static_cast<double>(params_.drive[band]);
        const double bias = static_cast<double>(params_.bias[band]);
        const double mix = static_cast<double>(params_.mix[band]) / 100.0;
        const double inverse_mix = 1.0 - mix;
        const double gain = std::pow(10.0, static_cast<double>(params_.gain[band]) / 20.0);
        const double bias_offset = std::tanh(drive * bias);
        float *signal = bandBuffer(channel, band);
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const double dry = static_cast<double>(signal[frame]);
          const double wet = std::tanh(drive * (dry + bias)) - bias_offset;
          signal[frame] = static_cast<float>((dry * inverse_mix + wet * mix) * gain);
        }
      }

      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const double summed = static_cast<double>(low[frame]) + static_cast<double>(mid[frame]) +
                              static_cast<double>(high[frame]);
        double fade_gain = 1.0;
        if (fade_active && fade_start + frame < fade_length) {
          fade_gain = static_cast<double>(fade_start + frame) / static_cast<double>(fade_length);
        }
        audio[audio_offset + frame] = static_cast<float>(summed * fade_gain);
      }
    }

    if (fade_active) {
      const std::uint32_t next = fade_start + frame_count;
      fade_counter_ = next >= fade_length ? fade_length : next;
      if (fade_counter_ >= fade_length) {
        fade_present_ = false;
      }
    } else if (fade_present_) {
      fade_present_ = false;
    }
  }

private:
  [[nodiscard]] float *bandBuffer(std::uint32_t channel, std::uint32_t band) noexcept {
    return band_signals_.data() + (static_cast<std::size_t>(channel) * 3u + band) * max_frames_;
  }

  [[nodiscard]] dsp::LinkwitzRiley24State &lowpassState(std::uint32_t crossover,
                                                        std::uint32_t channel) noexcept {
    return lowpass_states_[static_cast<std::size_t>(crossover) * max_channels_ + channel];
  }

  [[nodiscard]] dsp::LinkwitzRiley24State &highpassState(std::uint32_t crossover,
                                                         std::uint32_t channel) noexcept {
    return highpass_states_[static_cast<std::size_t>(crossover) * max_channels_ + channel];
  }

  static void filterBlock(const float *input, float *output,
                          const dsp::BiquadCoefficients &coefficients,
                          dsp::LinkwitzRiley24State &state, std::uint32_t frame_count) noexcept {
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      output[frame] = static_cast<float>(dsp::processLinkwitzRiley24Sample(
          static_cast<double>(input[frame]), coefficients, state));
    }
  }

  void resetFilterStates() noexcept {
    for (dsp::LinkwitzRiley24State &state : lowpass_states_) {
      dsp::resetLinkwitzRiley24State(state, dsp::LinkwitzRileyStateStorage::Float64);
    }
    for (dsp::LinkwitzRiley24State &state : highpass_states_) {
      dsp::resetLinkwitzRiley24State(state, dsp::LinkwitzRileyStateStorage::Float64);
    }
  }

  std::vector<dsp::LinkwitzRiley24State> lowpass_states_;
  std::vector<dsp::LinkwitzRiley24State> highpass_states_;
  std::vector<float> band_signals_;
  std::vector<float> temporary_;
  std::array<dsp::LinkwitzRiley24Coefficients, 2u> coefficients_{};
  std::array<float, 2u> last_frequencies_{};
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t fade_counter_ = 0u;
  std::uint32_t fade_length_ = 0u;
  bool configured_ = false;
  bool fade_present_ = false;
};

static_assert(sizeof(MultibandSaturationKernel) <= 8192u);

} // namespace effetune::plugins::saturation

EFFETUNE_REGISTER_KERNEL(MultibandSaturationPlugin,
                         effetune::plugins::saturation::MultibandSaturationKernel)
