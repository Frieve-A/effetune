#ifndef EFFETUNE_PLUGINS_DYNAMICS_MULTIBAND_COMMON_H
#define EFFETUNE_PLUGINS_DYNAMICS_MULTIBAND_COMMON_H

#include "effetune/dsp/linkwitz_riley.h"
#include "effetune/kernel.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::dynamics::multiband_detail {

constexpr std::uint32_t kFiveBandCount = 5u;
constexpr std::uint32_t kFiveBandCrossoverCount = 4u;

struct CrossoverChange final {
  bool filtersReset = false;
  bool dynamicsReset = false;
};

class FiveBandCrossover final {
public:
  void prepare(const PrepareInfo &info) {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    lowpass_states_.resize(static_cast<std::size_t>(kFiveBandCrossoverCount) * max_channels_);
    highpass_states_.resize(static_cast<std::size_t>(kFiveBandCrossoverCount) * max_channels_);
    band_storage_.resize(static_cast<std::size_t>(max_channels_) * kFiveBandCount * max_frames_);
    input_.resize(max_frames_);
    highpass1_.resize(max_frames_);
    highpass2_.resize(max_frames_);
    reset();
  }

  void reset() noexcept {
    resetFilterStates();
    frequencies_.fill(0.0F);
    channel_count_ = 0u;
    configured_ = false;
  }

  [[nodiscard]] CrossoverChange
  configure(const std::array<float, kFiveBandCrossoverCount> &frequencies,
            std::uint32_t channel_count) noexcept {
    bool frequencies_changed = !configured_;
    if (!frequencies_changed) {
      for (std::uint32_t index = 0u; index < kFiveBandCrossoverCount; ++index) {
        if (frequencies_[index] != frequencies[index]) {
          frequencies_changed = true;
          break;
        }
      }
    }
    const bool channels_changed = !configured_ || channel_count_ != channel_count;
    if (!frequencies_changed && !channels_changed)
      return {};

    resetFilterStates();
    for (std::uint32_t index = 0u; index < kFiveBandCrossoverCount; ++index) {
      coefficients_[index] =
          dsp::designLinkwitzRiley24(sample_rate_, static_cast<double>(frequencies[index]));
    }
    frequencies_ = frequencies;
    channel_count_ = channel_count;
    configured_ = true;
    return {true, channels_changed};
  }

  void split(const float *audio, std::uint32_t channel_count, std::uint32_t frame_count) noexcept {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const float *channel_audio = audio + static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        input_[frame] = channel_audio[frame];
      }

      filterBlock(input_.data(), band(channel, 0u), coefficients_[0u].lowpass,
                  lowpassState(0u, channel), frame_count);
      filterBlock(input_.data(), highpass1_.data(), coefficients_[0u].highpass,
                  highpassState(0u, channel), frame_count);
      filterBlock(highpass1_.data(), band(channel, 1u), coefficients_[1u].lowpass,
                  lowpassState(1u, channel), frame_count);
      filterBlock(highpass1_.data(), highpass2_.data(), coefficients_[1u].highpass,
                  highpassState(1u, channel), frame_count);
      filterBlock(highpass2_.data(), band(channel, 2u), coefficients_[2u].lowpass,
                  lowpassState(2u, channel), frame_count);
      filterBlock(highpass2_.data(), highpass1_.data(), coefficients_[2u].highpass,
                  highpassState(2u, channel), frame_count);
      filterBlock(highpass1_.data(), band(channel, 3u), coefficients_[3u].lowpass,
                  lowpassState(3u, channel), frame_count);
      filterBlock(highpass1_.data(), band(channel, 4u), coefficients_[3u].highpass,
                  highpassState(3u, channel), frame_count);
    }
  }

  [[nodiscard]] float *band(std::uint32_t channel, std::uint32_t band_index) noexcept {
    const std::size_t offset =
        (static_cast<std::size_t>(channel) * kFiveBandCount + band_index) * max_frames_;
    return band_storage_.data() + offset;
  }

private:
  void resetFilterStates() noexcept {
    for (dsp::LinkwitzRiley24State &state : lowpass_states_) {
      dsp::resetLinkwitzRiley24State(state, dsp::LinkwitzRileyStateStorage::Float32);
    }
    for (dsp::LinkwitzRiley24State &state : highpass_states_) {
      dsp::resetLinkwitzRiley24State(state, dsp::LinkwitzRileyStateStorage::Float32);
    }
  }

  void filterBlock(const float *input, float *output, const dsp::BiquadCoefficients &coefficients,
                   dsp::LinkwitzRiley24State &state, std::uint32_t frame_count) noexcept {
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      output[frame] = static_cast<float>(dsp::processLinkwitzRiley24Sample(
          static_cast<double>(input[frame]), coefficients, state));
    }
    dsp::quantizeLinkwitzRiley24StateToFloat(state);
  }

  [[nodiscard]] dsp::LinkwitzRiley24State &lowpassState(std::uint32_t crossover,
                                                        std::uint32_t channel) noexcept {
    return lowpass_states_[static_cast<std::size_t>(crossover) * max_channels_ + channel];
  }

  [[nodiscard]] dsp::LinkwitzRiley24State &highpassState(std::uint32_t crossover,
                                                         std::uint32_t channel) noexcept {
    return highpass_states_[static_cast<std::size_t>(crossover) * max_channels_ + channel];
  }

  std::array<dsp::LinkwitzRiley24Coefficients, kFiveBandCrossoverCount> coefficients_{};
  std::array<float, kFiveBandCrossoverCount> frequencies_{};
  std::vector<dsp::LinkwitzRiley24State> lowpass_states_;
  std::vector<dsp::LinkwitzRiley24State> highpass_states_;
  std::vector<float> band_storage_;
  std::vector<float> input_;
  std::vector<float> highpass1_;
  std::vector<float> highpass2_;
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t channel_count_ = 0u;
  bool configured_ = false;
};

} // namespace effetune::plugins::dynamics::multiband_detail

#endif
