#include "effetune/kernel.h"
#include "NoiseBlenderPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

struct PinkState final {
  double values[7]{};
};

struct BrownState final {
  double last_brown = 0.0;
  double dc_offset = 0.0;
};

} // namespace

class NoiseBlenderKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::NoiseBlenderPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    pink_states_.resize(max_channels_);
    brown_states_.resize(max_channels_);
    noise_buffer_.resize(max_frames_);
  }

  void reset() noexcept override {
    clearStates();
    initialized_ = false;
    last_channel_count_ = 0u;
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
        frame_count > max_frames_) {
      return;
    }
    if (!initialized_ || last_channel_count_ != channel_count) {
      clearStates();
      initialized_ = true;
      last_channel_count_ = channel_count;
    }

    std::uint32_t noise_type = static_cast<std::uint32_t>(params_.noiseType);
    if (noise_type > 2u) {
      noise_type = 2u;
    }
    const double level_db = static_cast<double>(params_.level);
    const double level_gain = level_db <= -96.0 ? 0.0 : std::pow(10.0, level_db / 20.0);
    const bool per_channel = params_.perChannel != 0.0F;

    if (per_channel) {
      // Advance the shared RNG frame-first so block boundaries cannot reassign noise to channels.
      if (noise_type == 0u) {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
            const std::uint32_t index = channel * frame_count + frame;
            const double white = random_.nextFloatSigned();
            audio[index] =
                static_cast<float>(static_cast<double>(audio[index]) + white * level_gain);
          }
        }
      } else if (noise_type == 1u) {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
            const std::uint32_t index = channel * frame_count + frame;
            const double scaled = nextPink(pink_states_[channel]) * level_gain;
            audio[index] = static_cast<float>(static_cast<double>(audio[index]) + scaled);
          }
        }
      } else {
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
            const std::uint32_t index = channel * frame_count + frame;
            const double scaled = nextBrown(brown_states_[channel]) * level_gain;
            audio[index] = static_cast<float>(static_cast<double>(audio[index]) + scaled);
          }
        }
      }
      return;
    }

    if (noise_type == 0u) {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        noise_buffer_[frame] = static_cast<float>(random_.nextFloatSigned() * level_gain);
      }
    } else if (noise_type == 1u) {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        noise_buffer_[frame] = static_cast<float>(nextPink(pink_states_[0]) * level_gain);
      }
    } else {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        noise_buffer_[frame] = static_cast<float>(nextBrown(brown_states_[0]) * level_gain);
      }
    }

    if (level_gain != 0.0) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::uint32_t offset = channel * frame_count;
        for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
          audio[offset + frame] = static_cast<float>(static_cast<double>(audio[offset + frame]) +
                                                     static_cast<double>(noise_buffer_[frame]));
        }
      }
    }
  }

private:
  void clearStates() noexcept {
    for (PinkState &state : pink_states_) {
      for (double &value : state.values) {
        value = 0.0;
      }
    }
    for (BrownState &state : brown_states_) {
      state.last_brown = 0.0;
      state.dc_offset = 0.0;
    }
  }

  double nextPink(PinkState &state) noexcept {
    const double white = random_.nextFloatSigned();
    state.values[0] = 0.99886 * state.values[0] + white * 0.0555179;
    state.values[1] = 0.99332 * state.values[1] + white * 0.0750759;
    state.values[2] = 0.96900 * state.values[2] + white * 0.1538520;
    state.values[3] = 0.86650 * state.values[3] + white * 0.3104856;
    state.values[4] = 0.55000 * state.values[4] + white * 0.5329522;
    state.values[5] = -0.7616 * state.values[5] - white * 0.0168980;
    const double pink = (state.values[0] + state.values[1] + state.values[2] + state.values[3] +
                         state.values[4] + state.values[5] + state.values[6] + white * 0.5362) *
                        0.11;
    state.values[6] = white * 0.115926;
    return pink;
  }

  double nextBrown(BrownState &state) noexcept {
    constexpr double normalization = 0.04166666666666666666666666666667;
    constexpr double decay = 0.995;
    const double brown = state.last_brown + random_.nextFloatSigned();
    const double generated = (brown - state.dc_offset) * normalization;
    state.dc_offset = state.dc_offset * decay + (1.0 - decay) * brown;
    state.last_brown = brown;
    return generated;
  }

  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool initialized_ = false;
  std::vector<PinkState> pink_states_;
  std::vector<BrownState> brown_states_;
  std::vector<float> noise_buffer_;
  dsp::XorShiftRng random_{};
};

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(NoiseBlenderPlugin, effetune::plugins::lofi::NoiseBlenderKernel)
