#ifndef EFFETUNE_PLUGINS_DYNAMICS_MULTIBAND_COMMON_H
#define EFFETUNE_PLUGINS_DYNAMICS_MULTIBAND_COMMON_H

#include "effetune/dsp/channel_lanes.h"
#include "effetune/dsp/denormal_noise.h"
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
  explicit FiveBandCrossover(dsp::LinkwitzRileyStateStorage state_storage =
                                 dsp::LinkwitzRileyStateStorage::Float32) noexcept
      : state_storage_(state_storage) {}

  void prepare(const PrepareInfo &info) {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    lowpass_states_.resize(static_cast<std::size_t>(kFiveBandCrossoverCount) * max_channels_);
    highpass_states_.resize(static_cast<std::size_t>(kFiveBandCrossoverCount) * max_channels_);
    band_storage_.resize(static_cast<std::size_t>(max_channels_) * kFiveBandCount * max_frames_);
    // Two channel lanes each own two intermediate high-pass buffers.
    remainders_.resize(static_cast<std::size_t>(4u) * max_frames_);
    reset();
  }

  void reset() noexcept {
    resetFilterStates();
    frequencies_.fill(0.0F);
    channel_count_ = 0u;
    configured_ = false;
    denormal_noise_.reset();
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
    // Channel pairs and each crossover's low/high outputs share one loop so the independent
    // recursions overlap without changing any filter's arithmetic.
    dsp::forEachChannelPair(channel_count, [&](std::uint32_t channel, auto lanes) noexcept {
      splitLanes<decltype(lanes)::value>(audio, channel, frame_count);
    });
    denormal_noise_.advance(frame_count);
  }

  [[nodiscard]] float *band(std::uint32_t channel, std::uint32_t band_index) noexcept {
    const std::size_t offset =
        (static_cast<std::size_t>(channel) * kFiveBandCount + band_index) * max_frames_;
    return band_storage_.data() + offset;
  }

private:
  void resetFilterStates() noexcept {
    for (dsp::LinkwitzRiley24State &state : lowpass_states_) {
      dsp::resetLinkwitzRiley24State(state, state_storage_);
    }
    for (dsp::LinkwitzRiley24State &state : highpass_states_) {
      dsp::resetLinkwitzRiley24State(state, state_storage_);
    }
  }

  // Splits Lanes adjacent channels into five bands with the crossover tree.
  template <std::uint32_t Lanes>
  void splitLanes(const float *audio, std::uint32_t channel, std::uint32_t frame_count) noexcept {
    const float *input[Lanes];
    float *low[Lanes];
    float *high[Lanes];
    float *remainder1[Lanes];
    float *remainder2[Lanes];
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
      remainder1[lane] = remainders_.data() + static_cast<std::size_t>(2u * lane) * max_frames_;
      remainder2[lane] = remainder1[lane] + max_frames_;
    }
    // Crossover k reads `source`, writes band k to `low` and the remainder to `target`.
    const auto crossover = [&](std::uint32_t index, auto source, auto target) noexcept {
      for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
        input[lane] = source(lane);
        low[lane] = band(channel + lane, index);
        high[lane] = target(lane);
      }
      crossoverLanes<Lanes>(input, low, high, index, channel, frame_count);
    };
    crossover(
        0u,
        [&](std::uint32_t lane) {
          return audio + static_cast<std::size_t>(channel + lane) * frame_count;
        },
        [&](std::uint32_t lane) { return remainder1[lane]; });
    crossover(
        1u, [&](std::uint32_t lane) { return remainder1[lane]; },
        [&](std::uint32_t lane) { return remainder2[lane]; });
    crossover(
        2u, [&](std::uint32_t lane) { return remainder2[lane]; },
        [&](std::uint32_t lane) { return remainder1[lane]; });
    crossover(
        3u, [&](std::uint32_t lane) { return remainder1[lane]; },
        [&](std::uint32_t lane) { return band(channel + lane, 4u); });
  }

  // Applies one crossover's low-pass and high-pass to Lanes channels in a single frame loop.
  template <std::uint32_t Lanes>
  void crossoverLanes(const float *const *input, float *const *low, float *const *high,
                      std::uint32_t index, std::uint32_t channel,
                      std::uint32_t frame_count) noexcept {
    const dsp::LinkwitzRiley24Coefficients coefficients = coefficients_[index];
    dsp::LinkwitzRiley24State low_state[Lanes];
    dsp::LinkwitzRiley24State high_state[Lanes];
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
      low_state[lane] = lowpassState(index, channel + lane);
      high_state[lane] = highpassState(index, channel + lane);
    }
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double noise = denormal_noise_.sample(frame);
      for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
        const double sample = static_cast<double>(input[lane][frame]);
        low[lane][frame] = static_cast<float>(dsp::processLinkwitzRiley24SampleWithDenormalNoise(
            sample, coefficients.lowpass, low_state[lane], noise));
        high[lane][frame] = static_cast<float>(dsp::processLinkwitzRiley24SampleWithDenormalNoise(
            sample, coefficients.highpass, high_state[lane], noise));
      }
    }
    const bool quantize = state_storage_ == dsp::LinkwitzRileyStateStorage::Float32;
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
      if (quantize) {
        dsp::quantizeLinkwitzRiley24StateToFloat(low_state[lane]);
        dsp::quantizeLinkwitzRiley24StateToFloat(high_state[lane]);
      }
      lowpassState(index, channel + lane) = low_state[lane];
      highpassState(index, channel + lane) = high_state[lane];
    }
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
  std::vector<float> remainders_;
  double sample_rate_ = 0.0;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t channel_count_ = 0u;
  dsp::LinkwitzRileyStateStorage state_storage_ = dsp::LinkwitzRileyStateStorage::Float32;
  dsp::NyquistDenormalNoise denormal_noise_;
  bool configured_ = false;
};

} // namespace effetune::plugins::dynamics::multiband_detail

#endif
