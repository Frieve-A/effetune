#include "effetune/kernel.h"
#include "G726ADPCMSimulatorPluginParams.h"
#include "effetune/dsp/halfband.h"
#include "effetune/dsp/rational_resampler.h"
#include "effetune/dsp/xorshift_rng.h"
#include "kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr std::uint32_t kCodecRate = 8000u;
constexpr std::size_t kMaximumRateFactor = 8u;
constexpr std::size_t kWetFifoCapacity = 8192u;
constexpr double kResamplerCutoffHz = 3800.0;
// The radio link control is an exponent slider whose minimum doubles as "Off".
// At that value the transmission model is bypassed entirely, so the codec path
// stays bit-identical to the clean round trip and consumes no random numbers.
constexpr double kBitErrorOffExponent = -6.0;
constexpr double kBitErrorMaximumExponent = -2.0;

[[nodiscard]] float sanitizeFinite(float sample) noexcept {
  return std::isfinite(sample) ? sample : 0.0F;
}

[[nodiscard]] std::int16_t toLinear14(float sample) noexcept {
  double scaled = static_cast<double>(sanitizeFinite(sample)) * 8192.0;
  if (scaled < -8192.0) {
    scaled = -8192.0;
  } else if (scaled > 8191.0) {
    scaled = 8191.0;
  }
  const double rounded = scaled < 0.0 ? std::ceil(scaled - 0.5) : std::floor(scaled + 0.5);
  return static_cast<std::int16_t>(rounded);
}

[[nodiscard]] double blend(double dry, double wet, double mix) noexcept {
  if (mix <= 0.0) {
    return dry;
  }
  if (mix >= 1.0) {
    return wet;
  }
  return dry + (wet - dry) * mix;
}

} // namespace

class G726ADPCMSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::G726ADPCMSimulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<std::uint32_t>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    configureRate();
    if (supported_) {
      downsampler_.prepare(base_rate_, kCodecRate, kResamplerCutoffHz);
      upsampler_.prepare(kCodecRate, base_rate_, kResamplerCutoffHz);
    }
    dry_delay_.assign(2u * (static_cast<std::size_t>(latency_samples_) + 1u), 0.0F);
    wet_fifo_.assign(kWetFifoCapacity, 0.0F);
    reset();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return supported_; }

  void reset() noexcept override {
    encoder_.reset(4u);
    decoder_.reset(4u);
    downsampler_.reset();
    upsampler_.reset();
    for (auto &stage : input_halfbands_) {
      stage.reset();
    }
    for (auto &stage : output_halfbands_) {
      stage.reset();
    }
    for (float &sample : dry_delay_) {
      sample = 0.0F;
    }
    for (float &sample : wet_fifo_) {
      sample = 0.0F;
    }
    dry_position_ = 0u;
    wet_read_ = 0u;
    wet_write_ = 0u;
    wet_count_ = 0u;
    active_bitrate_index_ = 2u;
    controls_initialized_ = false;
    gain_smoothed_ = 1.0;
    mix_smoothed_ = 1.0;
    bit_error_rate_ = 0.0;
    random_.seed(selected_seed_low_, selected_seed_high_);
  }

  void setRandomSeed(std::uint32_t seed_low, std::uint32_t seed_high) noexcept override {
    selected_seed_low_ = seed_low;
    selected_seed_high_ = seed_high;
    random_.seed(seed_low, seed_high);
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return supported_ ? latency_samples_ : 0u;
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!supported_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }

    const std::uint32_t processed_channels = channel_count == 1u ? 1u : 2u;
    float *left = audio;
    float *right = processed_channels == 2u ? audio + frame_count : audio;
    const double output_target = std::pow(10.0, static_cast<double>(params_.outputGain) / 20.0);
    const double mix_target = static_cast<double>(params_.mix) * 0.01;
    const double smoothing = 1.0 - std::exp(-1.0 / (static_cast<double>(sample_rate_) * 0.02));
    bit_error_rate_ = currentBitErrorRate();
    if (!controls_initialized_) {
      gain_smoothed_ = output_target;
      mix_smoothed_ = mix_target;
      controls_initialized_ = true;
    }

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      gain_smoothed_ += smoothing * (output_target - gain_smoothed_);
      mix_smoothed_ += smoothing * (mix_target - mix_smoothed_);

      const float dry_left = sanitizeFinite(left[frame]);
      const float dry_right = processed_channels == 2u ? sanitizeFinite(right[frame]) : dry_left;
      const float codec_input =
          processed_channels == 2u ? 0.5F * dry_left + 0.5F * dry_right : dry_left;
      processHostSample(codec_input);
      const float wet = popWet();
      const float delayed_left = delayDry(0u, dry_left);
      const float output_left =
          static_cast<float>(blend(delayed_left, wet, mix_smoothed_) * gain_smoothed_);
      left[frame] = std::isfinite(output_left) ? output_left : 0.0F;
      if (processed_channels == 2u) {
        const float delayed_right = delayDry(1u, dry_right);
        const float output_right =
            static_cast<float>(blend(delayed_right, wet, mix_smoothed_) * gain_smoothed_);
        right[frame] = std::isfinite(output_right) ? output_right : 0.0F;
      }
      dry_position_ = dry_position_ + 1u == latency_samples_ + 1u ? 0u : dry_position_ + 1u;
    }
  }

private:
  void configureRate() noexcept {
    supported_ = true;
    switch (sample_rate_) {
    case 44100u:
      base_rate_ = 44100u;
      halfband_stages_ = 0u;
      latency_samples_ = 1250u;
      break;
    case 48000u:
      base_rate_ = 48000u;
      halfband_stages_ = 0u;
      latency_samples_ = 1341u;
      break;
    case 88200u:
      base_rate_ = 44100u;
      halfband_stages_ = 1u;
      latency_samples_ = 2628u;
      break;
    case 96000u:
      base_rate_ = 48000u;
      halfband_stages_ = 1u;
      latency_samples_ = 2809u;
      break;
    case 176400u:
      base_rate_ = 44100u;
      halfband_stages_ = 2u;
      latency_samples_ = 5387u;
      break;
    case 192000u:
      base_rate_ = 48000u;
      halfband_stages_ = 2u;
      latency_samples_ = 5748u;
      break;
    case 352800u:
      base_rate_ = 44100u;
      halfband_stages_ = 3u;
      latency_samples_ = 10887u;
      break;
    case 384000u:
      base_rate_ = 48000u;
      halfband_stages_ = 3u;
      latency_samples_ = 11606u;
      break;
    default:
      base_rate_ = 0u;
      halfband_stages_ = 0u;
      latency_samples_ = 0u;
      supported_ = false;
      break;
    }
  }

  void processHostSample(float sample) noexcept {
    float decimated = sample;
    for (std::uint32_t stage = 0u; stage < halfband_stages_; ++stage) {
      float output = 0.0F;
      if (!input_halfbands_[stage].decimate(decimated, output)) {
        return;
      }
      decimated = output;
    }

    std::array<float, dsp::RationalResampler::kMaximumOutputs> codec_samples;
    const std::size_t codec_count = downsampler_.push(decimated, codec_samples);
    for (std::size_t index = 0u; index < codec_count; ++index) {
      applyBitrateAtCodecBoundary();
      const std::uint8_t codeword = encoder_.encode(toLinear14(codec_samples[index]));
      const std::uint8_t received = corruptCodeword(codeword);
      const float decoded = static_cast<float>(decoder_.decode(received)) / 8192.0F;
      std::array<float, dsp::RationalResampler::kMaximumOutputs> base_samples;
      const std::size_t base_count = upsampler_.push(decoded, base_samples);
      for (std::size_t base_index = 0u; base_index < base_count; ++base_index) {
        interpolateToHost(base_samples[base_index]);
      }
    }
  }

  void applyBitrateAtCodecBoundary() noexcept {
    int requested = static_cast<int>(std::floor(static_cast<double>(params_.bitrate) + 0.5));
    if (requested < 0) {
      requested = 0;
    } else if (requested > 3) {
      requested = 3;
    }
    const std::uint32_t index = static_cast<std::uint32_t>(requested);
    if (index == active_bitrate_index_) {
      return;
    }
    active_bitrate_index_ = index;
    const unsigned bits = index + 2u;
    encoder_.reset(bits);
    decoder_.reset(bits);
  }

  // Radio links such as DECT hand the decoder the codeword the channel delivered,
  // not the one the encoder produced. Reproducing that asymmetry is the whole
  // effect: ADPCM re-converges on its own, so the errors are heard as crackle.
  [[nodiscard]] double currentBitErrorRate() const noexcept {
    const double exponent = static_cast<double>(params_.radioBitErrorExponent);
    if (!(exponent > kBitErrorOffExponent)) {
      return 0.0;
    }
    const double limited = exponent > kBitErrorMaximumExponent ? kBitErrorMaximumExponent : exponent;
    return std::pow(10.0, limited);
  }

  [[nodiscard]] std::uint8_t corruptCodeword(std::uint8_t codeword) noexcept {
    if (bit_error_rate_ <= 0.0) {
      return codeword;
    }
    const std::uint32_t bits = active_bitrate_index_ + 2u;
    std::uint32_t received = codeword;
    for (std::uint32_t bit = 0u; bit < bits; ++bit) {
      if (random_.nextFloat01() < bit_error_rate_) {
        received ^= 1u << bit;
      }
    }
    return static_cast<std::uint8_t>(received);
  }

  void interpolateToHost(float sample) noexcept {
    std::array<float, kMaximumRateFactor> current;
    std::array<float, kMaximumRateFactor> next;
    current[0] = sample;
    std::size_t count = 1u;
    for (std::uint32_t stage = 0u; stage < halfband_stages_; ++stage) {
      std::size_t next_count = 0u;
      for (std::size_t index = 0u; index < count; ++index) {
        float first = 0.0F;
        float second = 0.0F;
        output_halfbands_[stage].interpolate(current[index], first, second);
        next[next_count++] = first;
        next[next_count++] = second;
      }
      for (std::size_t index = 0u; index < next_count; ++index) {
        current[index] = next[index];
      }
      count = next_count;
    }
    for (std::size_t index = 0u; index < count; ++index) {
      pushWet(current[index]);
    }
  }

  void pushWet(float sample) noexcept {
    wet_fifo_[wet_write_] = sample;
    wet_write_ = wet_write_ + 1u == kWetFifoCapacity ? 0u : wet_write_ + 1u;
    if (wet_count_ < kWetFifoCapacity) {
      ++wet_count_;
    } else {
      wet_read_ = wet_read_ + 1u == kWetFifoCapacity ? 0u : wet_read_ + 1u;
    }
  }

  [[nodiscard]] float popWet() noexcept {
    if (wet_count_ == 0u) {
      return 0.0F;
    }
    const float sample = wet_fifo_[wet_read_];
    wet_read_ = wet_read_ + 1u == kWetFifoCapacity ? 0u : wet_read_ + 1u;
    --wet_count_;
    return sample;
  }

  [[nodiscard]] float delayDry(std::uint32_t channel, float sample) noexcept {
    const std::size_t delay_size = static_cast<std::size_t>(latency_samples_) + 1u;
    const std::size_t base = channel * delay_size;
    dry_delay_[base + dry_position_] = sample;
    // With a latency-plus-one ring, the next slot contains the delayed sample.
    const std::size_t next_position = dry_position_ + 1u;
    const std::size_t read = next_position == delay_size ? 0u : next_position;
    return dry_delay_[base + read];
  }

  std::uint32_t sample_rate_ = 0u;
  std::uint32_t base_rate_ = 0u;
  std::uint32_t halfband_stages_ = 0u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t latency_samples_ = 0u;
  std::uint32_t active_bitrate_index_ = 2u;
  bool supported_ = false;
  bool controls_initialized_ = false;
  double gain_smoothed_ = 1.0;
  double mix_smoothed_ = 1.0;
  double bit_error_rate_ = 0.0;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  dsp::XorShiftRng random_{};

  g726::Codec encoder_{};
  g726::Codec decoder_{};
  dsp::RationalResampler downsampler_{};
  dsp::RationalResampler upsampler_{};
  std::array<dsp::Halfband2x, 3> input_halfbands_{};
  std::array<dsp::Halfband2x, 3> output_halfbands_{};
  std::vector<float> dry_delay_{};
  std::vector<float> wet_fifo_{};
  std::size_t dry_position_ = 0u;
  std::size_t wet_read_ = 0u;
  std::size_t wet_write_ = 0u;
  std::size_t wet_count_ = 0u;
};

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(G726ADPCMSimulatorPlugin,
                         effetune::plugins::lofi::G726ADPCMSimulatorKernel)
