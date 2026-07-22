#include "effetune/kernel.h"
#include "BitCrusherPluginParams.h"
#include "effetune/dsp/xorshift_rng.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr std::uint32_t kMaximumBitDepth = 24u;
constexpr double kUint32Scale = 1.0 / 4294967296.0;

double mulberry32(std::uint32_t &state) noexcept {
  state += 0x6d2b79f5u;
  std::uint32_t value = state;
  value = static_cast<std::uint32_t>(static_cast<std::uint64_t>(value ^ (value >> 15u)) |
                                     (static_cast<std::uint64_t>(0u)));
  value = static_cast<std::uint32_t>(static_cast<std::uint64_t>(value) *
                                     static_cast<std::uint64_t>(state | 1u));

  const std::uint32_t mixed = static_cast<std::uint32_t>(
      static_cast<std::uint64_t>(value ^ (value >> 7u)) * static_cast<std::uint64_t>(value | 61u));
  value ^= value + mixed;
  return static_cast<double>(value ^ (value >> 14u)) * kUint32Scale;
}

} // namespace

class BitCrusherKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::BitCrusherPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<double>(info.sampleRate);
    max_channels_ = info.maxChannels;
    last_samples_.resize(max_channels_);
    bit_amplitudes_.resize(static_cast<std::size_t>(max_channels_) * kMaximumBitDepth);
  }

  void reset() noexcept override {
    for (float &sample : last_samples_) {
      sample = 0.0F;
    }
    for (double &amplitude : bit_amplitudes_) {
      amplitude = 0.0;
    }
    sample_count_ = 0u;
    last_channel_count_ = 0u;
    last_bit_depth_ = 0u;
    last_seed_ = 0u;
    last_bit_error_ = 0.0;
    amplitudes_valid_ = false;
    random_.seed(selected_seed_low_, selected_seed_high_);
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    random_.seed(seed_low, seed_high);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_) {
      return;
    }

    std::uint32_t bit_depth = static_cast<std::uint32_t>(params_.bitDepth);
    if (bit_depth < 4u) {
      bit_depth = 4u;
    } else if (bit_depth > kMaximumBitDepth) {
      bit_depth = kMaximumBitDepth;
    }
    const bool tpdf_dither = params_.tpdfDither != 0.0F;

    double zoh_frequency = static_cast<double>(params_.zohFrequency);
    zoh_frequency = std::floor(zoh_frequency * 0.01 + 0.5) * 100.0;
    if (zoh_frequency < 4000.0) {
      zoh_frequency = 4000.0;
    } else if (zoh_frequency > 96000.0) {
      zoh_frequency = 96000.0;
    }

    double bit_error = static_cast<double>(params_.bitError);
    bit_error = std::floor(bit_error * 100.0 + 0.5) * 0.01;
    if (bit_error < 0.0) {
      bit_error = 0.0;
    } else if (bit_error > 10.0) {
      bit_error = 10.0;
    }
    std::uint32_t seed = static_cast<std::uint32_t>(params_.seed);
    if (seed > 1000u) {
      seed = 1000u;
    }

    if (last_channel_count_ != channel_count) {
      for (std::uint32_t channel = channel_count; channel < max_channels_; ++channel) {
        last_samples_[channel] = 0.0F;
      }
      if (channel_count > last_channel_count_) {
        for (std::uint32_t channel = last_channel_count_; channel < channel_count; ++channel) {
          last_samples_[channel] = 0.0F;
        }
      }
      last_channel_count_ = channel_count;
      amplitudes_valid_ = false;
    }

    if (!amplitudes_valid_ || last_bit_depth_ != bit_depth || last_bit_error_ != bit_error ||
        last_seed_ != seed) {
      rebuildAmplitudes(channel_count, bit_depth, bit_error, seed);
    }

    const double levels = std::ldexp(1.0, static_cast<int>(bit_depth)) - 1.0;
    const double ideal_full_scale = 1.0 - std::ldexp(1.0, -static_cast<int>(bit_depth));
    const double zoh_ratio = zoh_frequency / sample_rate_;

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double current_index =
          static_cast<double>(sample_count_ + static_cast<std::uint64_t>(frame));
      const double sample_index = std::floor(current_index * zoh_ratio);
      const bool reuse_last_sample = sample_index == std::floor((current_index - 1.0) * zoh_ratio);
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        const std::uint32_t offset = channel * frame_count;
        if (reuse_last_sample) {
          audio[offset + frame] = last_samples_[channel];
          continue;
        }

        const double input = static_cast<double>(audio[offset + frame]);
        double quantizer_input = ((input + 1.0) * 0.5) * levels;
        if (tpdf_dither) {
          quantizer_input += random_.nextFloat01() - random_.nextFloat01();
        }

        double rounded_code = std::floor(quantizer_input + 0.5);
        if (rounded_code < 0.0) {
          rounded_code = 0.0;
        } else if (rounded_code > levels) {
          rounded_code = levels;
        }
        const std::uint32_t code = static_cast<std::uint32_t>(rounded_code);

        double dac_output = 0.0;
        const std::size_t amplitude_offset = static_cast<std::size_t>(channel) * kMaximumBitDepth;
        for (std::uint32_t bit = 0u; bit < bit_depth; ++bit) {
          const std::uint32_t mask = 1u << (bit_depth - 1u - bit);
          if ((code & mask) != 0u) {
            dac_output += bit_amplitudes_[amplitude_offset + bit];
          }
        }

        const double output = (dac_output / ideal_full_scale) * 2.0 - 1.0;
        const float stored = static_cast<float>(output);
        audio[offset + frame] = stored;
        last_samples_[channel] = stored;
      }
    }
    sample_count_ += frame_count;
  }

private:
  void rebuildAmplitudes(std::uint32_t channel_count, std::uint32_t bit_depth, double bit_error,
                         std::uint32_t seed) noexcept {
    const double error_scale = bit_error * 0.01;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      std::uint32_t state = seed + channel;
      const std::size_t offset = static_cast<std::size_t>(channel) * kMaximumBitDepth;
      for (std::uint32_t bit = 0u; bit < bit_depth; ++bit) {
        const double ideal = std::ldexp(1.0, -static_cast<int>(bit + 1u));
        const double error = (mulberry32(state) * 2.0 - 1.0) * error_scale;
        bit_amplitudes_[offset + bit] = ideal * (1.0 + error);
      }
    }
    last_bit_depth_ = bit_depth;
    last_bit_error_ = bit_error;
    last_seed_ = seed;
    amplitudes_valid_ = true;
  }

  double sample_rate_ = 0.0;
  double last_bit_error_ = 0.0;
  std::uint64_t sample_count_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t last_channel_count_ = 0u;
  std::uint32_t last_bit_depth_ = 0u;
  std::uint32_t last_seed_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool amplitudes_valid_ = false;
  std::vector<float> last_samples_;
  std::vector<double> bit_amplitudes_;
  dsp::XorShiftRng random_{};
};

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(BitCrusherPlugin, effetune::plugins::lofi::BitCrusherKernel)
