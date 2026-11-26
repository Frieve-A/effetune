#include "effetune/kernel.h"
#include "MultibandBalancePluginParams.h"
#include "effetune/dsp/linkwitz_riley.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::spatial {

class MultibandBalanceKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::MultibandBalancePluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    balance_ramp_frames_ =
        std::max(1u, static_cast<std::uint32_t>(std::ceil(sample_rate_ * 0.005)));
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    lowpass_states_.resize(4u * max_channels_);
    highpass_states_.resize(4u * max_channels_);
    band_signals_.resize(static_cast<std::size_t>(max_channels_) * 5u * max_frames_);
    // Two channel lanes each own two intermediate high-pass buffers.
    temporary_.resize(static_cast<std::size_t>(4u) * max_frames_);
    reset();
  }

  void reset() noexcept override {
    resetFilterStates();
    configured_ = false;
    last_channel_count_ = 0u;
    fade_counter_ = 0u;
    fade_length_ = 0.0;
    balances_initialized_ = false;
    balance_ramp_remaining_ = 0u;
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
      fade_length_ = sample_rate_ * 0.005;
    }

    // Channel pairs and each crossover's low/high outputs share one loop so the
    // independent recursions overlap without changing any filter's arithmetic.
    for (std::uint32_t channel = 0u; channel < channel_count; channel += 2u) {
      if (channel + 1u < channel_count)
        splitBands<2u>(audio, channel, frame_count);
      else
        splitBands<1u>(audio, channel, frame_count);
    }

    std::array<double, 5u> next_balances{};
    for (std::size_t band = 0u; band < next_balances.size(); ++band) {
      next_balances[band] = static_cast<double>(params_.balance[band]) / 100.0;
    }
    if (!balances_initialized_) {
      current_balances_ = next_balances;
      target_balances_ = next_balances;
      balances_initialized_ = true;
    } else if (next_balances != target_balances_) {
      target_balances_ = next_balances;
      for (std::size_t band = 0u; band < target_balances_.size(); ++band) {
        balance_steps_[band] = (target_balances_[band] - current_balances_[band]) /
                               static_cast<double>(balance_ramp_frames_);
      }
      balance_ramp_remaining_ = balance_ramp_frames_;
    }

    const std::uint32_t ramp_count =
        balance_ramp_remaining_ < frame_count ? balance_ramp_remaining_ : frame_count;
    for (std::uint32_t frame = 0u; frame < ramp_count; ++frame) {
      for (std::size_t band = 0u; band < current_balances_.size(); ++band) {
        current_balances_[band] += balance_steps_[band];
      }
      if (--balance_ramp_remaining_ == 0u)
        current_balances_ = target_balances_;
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        audio[static_cast<std::size_t>(channel) * frame_count + frame] =
            mixBands(channel, frame, bandGains(channel));
      }
    }
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::array<double, 5u> gains = bandGains(channel);
      float *const channel_audio = audio + static_cast<std::size_t>(channel) * frame_count;
      for (std::uint32_t frame = ramp_count; frame < frame_count; ++frame)
        channel_audio[frame] = mixBands(channel, frame, gains);
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
          audio[index] = static_cast<float>(static_cast<double>(audio[index]) * fade);
        }
      }
      fade_counter_ += frame_count;
      if (static_cast<double>(fade_counter_) >= fade_length_) {
        fade_counter_ = static_cast<std::uint32_t>(fade_length_);
        fade_length_ = 0.0;
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

  [[nodiscard]] std::array<double, 5u> bandGains(std::uint32_t channel) const noexcept {
    std::array<double, 5u> gains{};
    for (std::uint32_t band = 0u; band < 5u; ++band) {
      const double balance = current_balances_[band];
      const double candidate = (channel & 1u) == 0u ? 1.0 - balance : 1.0 + balance;
      gains[band] = candidate > 0.0 ? candidate : 0.0;
    }
    return gains;
  }

  [[nodiscard]] float mixBands(std::uint32_t channel, std::uint32_t frame,
                               const std::array<double, 5u> &gains) noexcept {
    double sum = 0.0;
    for (std::uint32_t band = 0u; band < 5u; ++band)
      sum += static_cast<double>(bandBuffer(channel, band)[frame]) * gains[band];
    return static_cast<float>(sum);
  }

  // Splits Lanes adjacent channels into five bands with the crossover tree.
  template <std::uint32_t Lanes>
  void splitBands(const float *audio, std::uint32_t channel, std::uint32_t frame_count) noexcept {
    const float *source[Lanes];
    float *low[Lanes];
    float *high[Lanes];
    float *high1[Lanes];
    float *high2[Lanes];
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
      high1[lane] = temporary_.data() + static_cast<std::size_t>(2u * lane) * max_frames_;
      high2[lane] = high1[lane] + max_frames_;
    }
    // Crossover k reads `input`, writes band k to `low` and the remainder to `high`.
    const auto split = [&](std::uint32_t crossover, auto input, auto remainder) noexcept {
      for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
        source[lane] = input(lane);
        low[lane] = bandBuffer(channel + lane, crossover);
        high[lane] = remainder(lane);
      }
      splitLanes<Lanes>(source, low, high, crossover, channel, frame_count);
    };
    split(
        0u,
        [&](std::uint32_t lane) {
          return audio + static_cast<std::size_t>(channel + lane) * frame_count;
        },
        [&](std::uint32_t lane) { return high1[lane]; });
    split(
        1u, [&](std::uint32_t lane) { return high1[lane]; },
        [&](std::uint32_t lane) { return high2[lane]; });
    split(
        2u, [&](std::uint32_t lane) { return high2[lane]; },
        [&](std::uint32_t lane) { return high1[lane]; });
    split(
        3u, [&](std::uint32_t lane) { return high1[lane]; },
        [&](std::uint32_t lane) { return bandBuffer(channel + lane, 4u); });
  }

  // Applies one crossover's low-pass and high-pass to Lanes channels in a single frame loop.
  template <std::uint32_t Lanes>
  void splitLanes(const float *const *input, float *const *low, float *const *high,
                  std::uint32_t crossover, std::uint32_t channel,
                  std::uint32_t frame_count) noexcept {
    const dsp::LinkwitzRiley24Coefficients coefficients = coefficients_[crossover];
    dsp::LinkwitzRiley24State low_state[Lanes];
    dsp::LinkwitzRiley24State high_state[Lanes];
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
      low_state[lane] = lowpassState(crossover, channel + lane);
      high_state[lane] = highpassState(crossover, channel + lane);
    }
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
        const double sample = static_cast<double>(input[lane][frame]);
        low[lane][frame] = static_cast<float>(
            dsp::processLinkwitzRiley24Sample(sample, coefficients.lowpass, low_state[lane]));
        high[lane][frame] = static_cast<float>(
            dsp::processLinkwitzRiley24Sample(sample, coefficients.highpass, high_state[lane]));
      }
    }
    for (std::uint32_t lane = 0u; lane < Lanes; ++lane) {
      dsp::quantizeLinkwitzRiley24StateToFloat(low_state[lane]);
      dsp::quantizeLinkwitzRiley24StateToFloat(high_state[lane]);
      lowpassState(crossover, channel + lane) = low_state[lane];
      highpassState(crossover, channel + lane) = high_state[lane];
    }
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
  std::array<dsp::LinkwitzRiley24Coefficients, 4u> coefficients_{};
  std::array<float, 4u> last_frequencies_{};
  std::array<double, 5u> current_balances_{};
  std::array<double, 5u> target_balances_{};
  std::array<double, 5u> balance_steps_{};
  double sample_rate_ = 0.0;
  double fade_length_ = 0.0;
  std::uint32_t fade_counter_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t balance_ramp_frames_ = 240u;
  std::uint32_t balance_ramp_remaining_ = 0u;
  bool configured_ = false;
  bool balances_initialized_ = false;
};

static_assert(sizeof(MultibandBalanceKernel) <= 8192u);

} // namespace effetune::plugins::spatial

EFFETUNE_REGISTER_KERNEL(MultibandBalancePlugin, effetune::plugins::spatial::MultibandBalanceKernel)
