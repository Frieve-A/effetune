#include "effetune/kernel.h"
#include "NoiseBlenderPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

struct PinkState final {
  float values[7]{};
};

struct BrownState final {
  float last_brown = 0.0F;
  float dc_offset = 0.0F;
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
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::uint32_t offset = channel * frame_count;
        if (noise_type == 0u) {
          for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
            const double white = random_.nextFloatSigned();
            audio[offset + frame] =
                static_cast<float>(static_cast<double>(audio[offset + frame]) + white * level_gain);
          }
        } else if (noise_type == 1u) {
          processPinkChannel(audio + offset, frame_count, pink_states_[channel], level_gain, false);
        } else {
          processBrownChannel(audio + offset, frame_count, brown_states_[channel], level_gain,
                              false);
        }
      }
      return;
    }

    if (noise_type == 0u) {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        noise_buffer_[frame] = static_cast<float>(random_.nextFloatSigned() * level_gain);
      }
    } else if (noise_type == 1u) {
      processPinkChannel(noise_buffer_.data(), frame_count, pink_states_[0], level_gain, true);
    } else {
      processBrownChannel(noise_buffer_.data(), frame_count, brown_states_[0], level_gain, true);
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
      for (float &value : state.values) {
        value = 0.0F;
      }
    }
    for (BrownState &state : brown_states_) {
      state.last_brown = 0.0F;
      state.dc_offset = 0.0F;
    }
  }

  void processPinkChannel(float *output, std::uint32_t frame_count, PinkState &state,
                          double level_gain, bool replace) noexcept {
    double b0 = static_cast<double>(state.values[0]);
    double b1 = static_cast<double>(state.values[1]);
    double b2 = static_cast<double>(state.values[2]);
    double b3 = static_cast<double>(state.values[3]);
    double b4 = static_cast<double>(state.values[4]);
    double b5 = static_cast<double>(state.values[5]);
    double b6 = static_cast<double>(state.values[6]);
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double white = random_.nextFloatSigned();
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const double pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      const double scaled = pink * level_gain;
      output[frame] = replace ? static_cast<float>(scaled)
                              : static_cast<float>(static_cast<double>(output[frame]) + scaled);
    }
    state.values[0] = static_cast<float>(b0);
    state.values[1] = static_cast<float>(b1);
    state.values[2] = static_cast<float>(b2);
    state.values[3] = static_cast<float>(b3);
    state.values[4] = static_cast<float>(b4);
    state.values[5] = static_cast<float>(b5);
    state.values[6] = static_cast<float>(b6);
  }

  void processBrownChannel(float *output, std::uint32_t frame_count, BrownState &state,
                           double level_gain, bool replace) noexcept {
    constexpr double normalization = 0.04166666666666666666666666666667;
    constexpr double decay = 0.995;
    double last_brown = static_cast<double>(state.last_brown);
    double dc_offset = static_cast<double>(state.dc_offset);
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double white = random_.nextFloatSigned();
      const double brown = last_brown + white;
      double generated = brown - dc_offset;
      dc_offset = dc_offset * decay + (1.0 - decay) * brown;
      generated *= normalization;
      const double scaled = generated * level_gain;
      output[frame] = replace ? static_cast<float>(scaled)
                              : static_cast<float>(static_cast<double>(output[frame]) + scaled);
      last_brown = brown;
    }
    state.last_brown = static_cast<float>(last_brown);
    state.dc_offset = static_cast<float>(dc_offset);
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
