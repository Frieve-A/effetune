#include "effetune/kernel.h"
#include "MultibandBalancePluginParams.h"
#include "effetune/dsp/linkwitz_riley.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::spatial {

class MultibandBalanceKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MultibandBalancePluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    lowpass_states_.resize(4u * max_channels_);
    highpass_states_.resize(4u * max_channels_);
    band_signals_.resize(static_cast<std::size_t>(max_channels_) * 5u * max_frames_);
    temporary_.resize(static_cast<std::size_t>(3u) * max_frames_);
    output_.resize(static_cast<std::size_t>(max_channels_) * max_frames_);
    reset();
  }

  void reset() noexcept override {
    resetFilterStates();
    configured_ = false;
    last_channel_count_ = 0u;
    fade_counter_ = 0u;
    fade_length_ = 0.0;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count < 2u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || sample_rate_ <= 0.0) {
      return;
    }

    const std::array<float, 4u> frequencies{params_.frequency1, params_.frequency2,
                                            params_.frequency3, params_.frequency4};
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
            dsp::designLinkwitzRiley24(sample_rate_, static_cast<double>(frequencies[index]));
        last_frequencies_[index] = frequencies[index];
      }
      configured_ = true;
      last_channel_count_ = channel_count;
      fade_counter_ = 0u;
      const double five_milliseconds = sample_rate_ * 0.005;
      fade_length_ = static_cast<double>(frame_count) < five_milliseconds
                         ? static_cast<double>(frame_count)
                         : five_milliseconds;
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t audio_offset = static_cast<std::size_t>(channel) * frame_count;
      float *input = temporary_.data();
      float *high1 = temporary_.data() + max_frames_;
      float *high2 = temporary_.data() + 2u * max_frames_;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        input[frame] = audio[audio_offset + frame];
      }

      float *band0 = bandBuffer(channel, 0u);
      float *band1 = bandBuffer(channel, 1u);
      float *band2 = bandBuffer(channel, 2u);
      float *band3 = bandBuffer(channel, 3u);
      float *band4 = bandBuffer(channel, 4u);
      filterBlock(input, band0, coefficients_[0].lowpass, lowpassState(0u, channel), frame_count);
      filterBlock(input, high1, coefficients_[0].highpass, highpassState(0u, channel), frame_count);
      filterBlock(high1, band1, coefficients_[1].lowpass, lowpassState(1u, channel), frame_count);
      filterBlock(high1, high2, coefficients_[1].highpass, highpassState(1u, channel), frame_count);
      filterBlock(high2, band2, coefficients_[2].lowpass, lowpassState(2u, channel), frame_count);
      filterBlock(high2, high1, coefficients_[2].highpass, highpassState(2u, channel), frame_count);
      filterBlock(high1, band3, coefficients_[3].lowpass, lowpassState(3u, channel), frame_count);
      filterBlock(high1, band4, coefficients_[3].highpass, highpassState(3u, channel), frame_count);
    }

    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t output_offset = static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        output_[output_offset + frame] = 0.0F;
      }
      for (std::uint32_t band = 0u; band < 5u; ++band) {
        const double balance = static_cast<double>(params_.balance[band]) / 100.0;
        const double magnitude = balance >= 0.0 ? balance : -balance;
        double gain = 1.0;
        if (magnitude >= 1.0e-6) {
          const double candidate = channel == 0u ? 1.0 - balance : 1.0 + balance;
          gain = candidate > 0.0 ? candidate : 0.0;
        }
        const float *band_signal = bandBuffer(channel, band);
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          const std::size_t index = output_offset + frame;
          output_[index] = static_cast<float>(static_cast<double>(output_[index]) +
                                              static_cast<double>(band_signal[frame]) * gain);
        }
      }
    }

    if (fade_length_ > 0.0 && static_cast<double>(fade_counter_) < fade_length_) {
      const std::uint32_t start = fade_counter_;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        const std::uint32_t counter = start + frame;
        const double fade = static_cast<double>(counter) < fade_length_
                                ? static_cast<double>(counter) / fade_length_
                                : 1.0;
        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
          audio[index] = static_cast<float>(static_cast<double>(output_[index]) * fade);
        }
      }
      fade_counter_ += frame_count;
      if (static_cast<double>(fade_counter_) >= fade_length_) {
        fade_counter_ = static_cast<std::uint32_t>(fade_length_);
        fade_length_ = 0.0;
      }
    } else {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::size_t offset = static_cast<std::size_t>(channel) * frame_count;
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          audio[offset + frame] = output_[offset + frame];
        }
      }
    }
  }

private:
  [[nodiscard]] float *bandBuffer(std::uint32_t channel, std::uint32_t band) noexcept {
    return band_signals_.data() + (static_cast<std::size_t>(channel) * 5u + band) * max_frames_;
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
    dsp::quantizeLinkwitzRiley24StateToFloat(state);
  }

  void resetFilterStates() noexcept {
    for (dsp::LinkwitzRiley24State &state : lowpass_states_) {
      dsp::resetLinkwitzRiley24State(state, dsp::LinkwitzRileyStateStorage::Float32);
    }
    for (dsp::LinkwitzRiley24State &state : highpass_states_) {
      dsp::resetLinkwitzRiley24State(state, dsp::LinkwitzRileyStateStorage::Float32);
    }
  }

  std::vector<dsp::LinkwitzRiley24State> lowpass_states_;
  std::vector<dsp::LinkwitzRiley24State> highpass_states_;
  std::vector<float> band_signals_;
  std::vector<float> temporary_;
  std::vector<float> output_;
  std::array<dsp::LinkwitzRiley24Coefficients, 4u> coefficients_{};
  std::array<float, 4u> last_frequencies_{};
  double sample_rate_ = 0.0;
  double fade_length_ = 0.0;
  std::uint32_t fade_counter_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  bool configured_ = false;
};

static_assert(sizeof(MultibandBalanceKernel) <= 8192u);

} // namespace effetune::plugins::spatial

EFFETUNE_REGISTER_KERNEL(MultibandBalancePlugin, effetune::plugins::spatial::MultibandBalanceKernel)
