#include "effetune/kernel.h"
#include "BluetoothSBCSimulatorPluginParams.h"
#include "effetune/dsp/halfband.h"
#include "effetune/dsp/xorshift_rng.h"
#if !defined(__EMSCRIPTEN__)
#include "test_adapter.h"
#endif

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numbers>
#include <vector>

namespace effetune::plugins::lofi {
namespace {

constexpr std::uint32_t kSubbands = 8u;
constexpr std::uint32_t kMaximumBlocks = 16u;
constexpr std::uint32_t kMaximumCodecFrameSamples = kSubbands * kMaximumBlocks;
constexpr std::uint32_t kAnalysisLength = 80u;
constexpr std::uint32_t kSynthesisLength = 160u;
constexpr std::uint32_t kRawOutputCapacity = 4096u;
constexpr std::uint32_t kDelayCapacity = 8192u;
constexpr std::uint32_t kMaximumRateFactor = 8u;
constexpr std::uint32_t kMaximumResamplerStages = 3u;
constexpr std::uint32_t kTargetLatencyCodecSamples = 320u;
constexpr std::uint32_t kPqmfDelayCodecSamples = 72u;

// Link-quality model. An A2DP sink drops a whole L2CAP packet when its CRC keeps failing until the
// flush timeout expires, so losses arrive as bursts of consecutive SBC frames rather than isolated
// bit errors. Both the retransmission window and the concealment fade are properties of *time*,
// not of the SBC frame length, so the model is anchored to a duration and the per-frame constants
// are derived from the block count. The window is 640 codec samples (about 13 ms), which is
// B = 640 / (8 * blocks) = 80 / blocks frames, i.e. the familiar five frames at sixteen blocks and
// a typical 3-DH5 payload. The bad state loses the frame that entered it and every following frame
// draws the recovery, so B = 1 + 1 / p and the recovery probability is p = 1 / (B - 1).
// Concealment likewise halves every sixteen-block period, so the per-frame decay is
// 0.5 ^ (blocks / 16): four to five consecutive losses reach silence at sixteen blocks and sixteen
// to twenty at four blocks, which is the same wall-clock fade in both cases.
struct LinkProfile {
  double mean_burst_frames;
  double recovery_probability;
  double concealment_frame_decay;
};

// Indexed by blocks / 4 - 1, i.e. 4, 8, 12 and 16 blocks. The sixteen-block entry is exactly the
// historical pair (0.25, 0.5), so the default configuration is bit-identical.
constexpr std::array<LinkProfile, 4> kLinkProfiles = {{
    {20.0, 1.0 / 19.0, 0.8408964152537145},
    {10.0, 1.0 / 9.0, 0.7071067811865476},
    {80.0 / 12.0, 1.0 / (80.0 / 12.0 - 1.0), 0.5946035575013605},
    {5.0, 0.25, 0.5},
}};
constexpr double kMaximumLossRatio = 0.5;

// Channel modes, ordered exactly as the cm enum in params.json so the staged float is the index.
// Dual Channel is the SBC XQ configuration: both channels carry an independent mono allocation at
// the full bitpool, so the frame is twice as long as a Stereo frame at the same bitpool.
enum class ChannelMode : std::uint8_t {
  kJointStereo = 0u,
  kStereo = 1u,
  kDualChannel = 2u,
};

#if !defined(__EMSCRIPTEN__)
// The test adapter mirrors these codes so the two enums convert with a plain cast.
static_assert(static_cast<std::uint8_t>(ChannelMode::kJointStereo) ==
              static_cast<std::uint8_t>(test::BluetoothSbcChannelMode::kJointStereo));
static_assert(static_cast<std::uint8_t>(ChannelMode::kStereo) ==
              static_cast<std::uint8_t>(test::BluetoothSbcChannelMode::kStereo));
static_assert(static_cast<std::uint8_t>(ChannelMode::kDualChannel) ==
              static_cast<std::uint8_t>(test::BluetoothSbcChannelMode::kDualChannel));
#endif

constexpr std::array<double, kAnalysisLength> kPrototype8 = {{
    0.0000000000,   0.000156575398,  0.000343256425, 0.000554620202, 0.000823919506, 0.00113992507,
    0.00147640169,  0.00178371725,   0.00201182542,  0.00210371989,  0.00199454554,  0.00161656283,
    0.000902154502, -0.000178805361, -0.00164973098, -0.00349717454, 0.00565949473,  0.00802941163,
    0.0104584443,   0.0127472335,    0.0146525263,   0.0159045603,   0.0162208471,   0.0153184106,
    0.0129371806,   0.00885757540,   0.00292408442,  -0.00491578024, -0.0146404076,  -0.0261098752,
    -0.0390751381,  -0.0531873032,   0.0679989431,   0.0829847578,   0.0975753918,   0.111196689,
    0.123264548,    0.133264415,     0.140753505,    0.145389847,    0.146955068,    0.145389847,
    0.140753505,    0.133264415,     0.123264548,    0.111196689,    0.0975753918,   0.0829847578,
    -0.0679989431,  -0.0531873032,   -0.0390751381,  -0.0261098752,  -0.0146404076,  -0.00491578024,
    0.00292408442,  0.00885757540,   0.0129371806,   0.0153184106,   0.0162208471,   0.0159045603,
    0.0146525263,   0.0127472335,    0.0104584443,   0.00802941163,  -0.00565949473, -0.00349717454,
    -0.00164973098, -0.000178805361, 0.000902154502, 0.00161656283,  0.00199454554,  0.00210371989,
    0.00201182542,  0.00178371725,   0.00147640169,  0.00113992507,  0.000823919506, 0.000554620202,
    0.000343256425, 0.000156575398,
}};

constexpr std::array<std::array<int, kSubbands>, 2> kLoudnessOffset8 = {{
    {{-4, 0, 0, 0, 0, 0, 1, 2}},
    {{-4, 0, 0, 0, 0, 0, 1, 2}},
}};

using AnalysisCosineMatrix = std::array<std::array<double, 16>, kSubbands>;
using SynthesisCosineMatrix = std::array<std::array<double, kSubbands>, 16>;

[[nodiscard]] std::int32_t roundCodecPcm(double sample) noexcept {
  double scaled = sample * 32768.0;
  if (!std::isfinite(scaled)) {
    scaled = 0.0;
  }
  if (scaled < -32768.0) {
    scaled = -32768.0;
  } else if (scaled > 32767.0) {
    scaled = 32767.0;
  }
  return static_cast<std::int32_t>(scaled < 0.0 ? std::ceil(scaled - 0.5)
                                                : std::floor(scaled + 0.5));
}

[[nodiscard]] double clampCodecOutput(double sample) noexcept {
  if (!std::isfinite(sample)) {
    return 0.0;
  }
  if (sample < -32768.0) {
    return -1.0;
  }
  if (sample > 32767.0) {
    sample = 32767.0;
  }
  const double rounded = sample < 0.0 ? std::ceil(sample - 0.5) : std::floor(sample + 0.5);
  return rounded / 32768.0;
}

#if !defined(__EMSCRIPTEN__)
class SbcBitReader final {
public:
  SbcBitReader(const std::uint8_t *bytes, std::size_t length, std::size_t bit_offset) noexcept
      : bytes_(bytes), bit_count_(length * 8u), bit_offset_(bit_offset) {}

  [[nodiscard]] bool read(std::uint32_t width, std::uint32_t &value) noexcept {
    if (width > 16u || bit_offset_ + width > bit_count_) {
      return false;
    }
    value = 0u;
    for (std::uint32_t bit = 0u; bit < width; ++bit) {
      value = (value << 1u) | ((bytes_[bit_offset_ >> 3u] >> (7u - (bit_offset_ & 7u))) & 1u);
      ++bit_offset_;
    }
    return true;
  }

private:
  const std::uint8_t *bytes_ = nullptr;
  std::size_t bit_count_ = 0u;
  std::size_t bit_offset_ = 0u;
};

class SbcBitWriter final {
public:
  SbcBitWriter(std::uint8_t *bytes, std::size_t length, std::size_t bit_offset) noexcept
      : bytes_(bytes), bit_count_(length * 8u), bit_offset_(bit_offset) {}

  [[nodiscard]] bool write(std::uint32_t width, std::uint32_t value) noexcept {
    if (width > 16u || bit_offset_ + width > bit_count_) {
      return false;
    }
    for (std::uint32_t bit = width; bit-- > 0u;) {
      if (((value >> bit) & 1u) != 0u) {
        bytes_[bit_offset_ >> 3u] |= static_cast<std::uint8_t>(1u << (7u - (bit_offset_ & 7u)));
      }
      ++bit_offset_;
    }
    return true;
  }

  [[nodiscard]] std::size_t bitOffset() const noexcept { return bit_offset_; }

private:
  std::uint8_t *bytes_ = nullptr;
  std::size_t bit_count_ = 0u;
  std::size_t bit_offset_ = 0u;
};

void updateSbcCrc(std::uint8_t &crc, std::uint32_t width, std::uint32_t value) noexcept {
  for (std::uint32_t bit = width; bit-- > 0u;) {
    const bool feedback = (((crc >> 7u) ^ (value >> bit)) & 1u) != 0u;
    crc = static_cast<std::uint8_t>(crc << 1u);
    if (feedback) {
      crc ^= 0x1du;
    }
  }
}
#endif

} // namespace

class BluetoothSBCSimulatorKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::BluetoothSBCSimulatorPluginParams)

public:
  void prepare(const PrepareInfo &info) override {
    sample_rate_ = static_cast<std::uint32_t>(info.sampleRate);
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    configureRate();
    buildCosineMatrices();
    analysis_state_.assign(2u, {});
    synthesis_state_.assign(2u, {});
    input_resamplers_.resize(2u * kMaximumResamplerStages);
    output_resamplers_.resize(2u * kMaximumResamplerStages);
    codec_input_.assign(2u, {});
    subband_samples_.assign(2u, {});
    codewords_.assign(kMaximumBlocks, {});
    last_good_subbands_.assign(kMaximumBlocks, {});
    raw_output_.assign(2u * kRawOutputCapacity, 0.0);
    dry_delay_.assign(2u * kDelayCapacity, 0.0);
    wet_delay_.assign(2u * kDelayCapacity, 0.0);
    reset();
  }

  void reset() noexcept override {
    for (auto &channel : analysis_state_) {
      channel.fill(0.0);
    }
    for (auto &channel : synthesis_state_) {
      channel.fill(0.0);
    }
    for (dsp::Halfband2x &resampler : input_resamplers_) {
      resampler.reset();
    }
    for (dsp::Halfband2x &resampler : output_resamplers_) {
      resampler.reset();
    }
    for (auto &block : last_good_subbands_) {
      block = {};
    }
    for (double &sample : raw_output_) {
      sample = 0.0;
    }
    for (double &sample : dry_delay_) {
      sample = 0.0;
    }
    for (double &sample : wet_delay_) {
      sample = 0.0;
    }
    codec_input_count_ = 0u;
    raw_output_read_ = 0u;
    raw_output_write_ = 0u;
    raw_output_count_ = 0u;
    delay_position_ = 0u;
    active_channels_ = 0u;
    active_blocks_ = 16u;
    active_bitpool_ = 35u;
    active_mode_ = ChannelMode::kJointStereo;
    initialized_controls_ = false;
    output_gain_smoothed_ = 1.0;
    mix_smoothed_ = 1.0;
    active_loss_ratio_ = 0.0;
    concealment_gain_ = 1.0;
    last_good_blocks_ = 0u;
    link_bad_ = false;
    random_.seed(selected_seed_low_, selected_seed_high_);
    updateWetDelay();
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
    if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_ || !supported_) {
      return;
    }

    const std::uint32_t codec_channels = channel_count == 1u ? 1u : 2u;
    if (active_channels_ != codec_channels) {
      reset();
      active_channels_ = codec_channels;
    }

    const double output_target = std::pow(10.0, static_cast<double>(params_.outputGain) / 20.0);
    const double mix_target = static_cast<double>(params_.mix) * 0.01;
    if (!initialized_controls_) {
      output_gain_smoothed_ = output_target;
      mix_smoothed_ = mix_target;
      initialized_controls_ = true;
    }
    const double smoothing = 1.0 - std::exp(-1.0 / (static_cast<double>(sample_rate_) * 0.02));

    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      output_gain_smoothed_ += smoothing * (output_target - output_gain_smoothed_);
      mix_smoothed_ += smoothing * (mix_target - mix_smoothed_);

      std::array<double, 2> input{};
      for (std::uint32_t channel = 0u; channel < codec_channels; ++channel) {
        const double candidate = static_cast<double>(audio[channel * frame_count + frame]);
        input[channel] = std::isfinite(candidate) ? candidate : 0.0;
      }

      std::array<double, 2> codec_sample{};
      if (resampleInput(input, codec_channels, codec_sample)) {
        if (codec_input_count_ == 0u) {
          captureFrameParameters();
        }
        for (std::uint32_t channel = 0u; channel < codec_channels; ++channel) {
          codec_input_[channel][codec_input_count_] =
              static_cast<double>(roundCodecPcm(codec_sample[channel]));
        }
        ++codec_input_count_;
        if (codec_input_count_ == active_blocks_ * kSubbands) {
          encodeDecodeFrame(codec_channels);
          codec_input_count_ = 0u;
        }
      }

      std::array<double, 2> raw_wet{};
      popRawOutput(codec_channels, raw_wet);
      for (std::uint32_t channel = 0u; channel < codec_channels; ++channel) {
        const double dry = delaySample(dry_delay_, channel, latency_samples_, input[channel]);
        const double wet = delaySample(wet_delay_, channel, wet_delay_samples_, raw_wet[channel]);
        double output = (dry + (wet - dry) * mix_smoothed_) * output_gain_smoothed_;
        if (!std::isfinite(output)) {
          output = 0.0;
        }
        audio[channel * frame_count + frame] = static_cast<float>(output);
      }
      delay_position_ = (delay_position_ + 1u) % kDelayCapacity;
    }
  }

#if !defined(__EMSCRIPTEN__)
  [[nodiscard]] bool encodeTestFrame(const test::BluetoothSbcPcm &input,
                                     test::BluetoothSbcChannelMode channel_mode,
                                     std::uint32_t blocks, std::uint32_t bitpool,
                                     test::BluetoothSbcEncodedFrame &output) noexcept {
    if (sample_rate_ != 48000u ||
        (blocks != 4u && blocks != 8u && blocks != 12u && blocks != 16u) ||
        input.frames != blocks * kSubbands || bitpool < 2u || bitpool > 53u) {
      return false;
    }

    reset();
    active_channels_ = 2u;
    active_blocks_ = blocks;
    active_bitpool_ = bitpool;
    active_mode_ = static_cast<ChannelMode>(channel_mode);
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t sample = 0u; sample < input.frames; ++sample) {
        codec_input_[channel][sample] = static_cast<double>(input.samples[channel][sample]);
      }
    }
    for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        analyze(channel, &codec_input_[channel][block * kSubbands],
                subband_samples_[channel][block].data());
      }
    }
    prepareJointAndScaleFactors(2u);
    allocateBits(2u);
    quantizeLogicalFields(2u);

    output = {};
    output.bytes[0] = 0x9cu;
    output.bytes[1] = static_cast<std::uint8_t>(0xc0u | ((active_blocks_ / 4u - 1u) << 4u) |
                                                (frameModeCode() << 2u) | 1u);
    output.bytes[2] = static_cast<std::uint8_t>(active_bitpool_);
    SbcBitWriter writer(output.bytes.data(), output.bytes.size(), 32u);
    if (active_mode_ == ChannelMode::kJointStereo) {
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        if (!writer.write(1u, join_[subband] ? 1u : 0u)) {
          return false;
        }
      }
    }
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        if (!writer.write(4u, scale_factor_fields_[channel][subband])) {
          return false;
        }
      }
    }
    for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
          if (!writer.write(bits_[channel][subband], codewords_[block][channel][subband])) {
            return false;
          }
        }
      }
    }
    output.length = (writer.bitOffset() + 7u) / 8u;

    std::uint8_t crc = 0x0fu;
    updateSbcCrc(crc, 8u, output.bytes[1]);
    updateSbcCrc(crc, 8u, output.bytes[2]);
    if (active_mode_ == ChannelMode::kJointStereo) {
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        updateSbcCrc(crc, 1u, join_[subband] ? 1u : 0u);
      }
    }
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        updateSbcCrc(crc, 4u, scale_factor_fields_[channel][subband]);
      }
    }
    output.bytes[3] = crc;

    decodeLogicalFields(2u);
    copyTestFrame(static_cast<std::uint32_t>(output.length), output.logical);
    return true;
  }

  [[nodiscard]] bool decodeTestFrame(const std::uint8_t *bytes, std::size_t length,
                                     test::BluetoothSbcFrame &output) noexcept {
    if (bytes == nullptr || length < 4u || sample_rate_ != 48000u || bytes[0] != 0x9cu) {
      return false;
    }
    const std::uint32_t frequency = bytes[1] >> 6u;
    const std::uint32_t block_code = (bytes[1] >> 4u) & 3u;
    const std::uint32_t mode = (bytes[1] >> 2u) & 3u;
    const std::uint32_t allocation = (bytes[1] >> 1u) & 1u;
    const std::uint32_t subbands = bytes[1] & 1u;
    // Mode 1 is Dual Channel: no joint bits, and each channel spends the full bitpool per block.
    if (frequency != 3u || mode == 0u || allocation != 0u || subbands != 1u || bytes[2] < 2u ||
        bytes[2] > 53u) {
      return false;
    }

    reset();
    active_channels_ = 2u;
    active_blocks_ = (block_code + 1u) * 4u;
    active_bitpool_ = bytes[2];
    active_mode_ = mode == 3u ? ChannelMode::kJointStereo
                              : (mode == 2u ? ChannelMode::kStereo : ChannelMode::kDualChannel);
    const bool joint = active_mode_ == ChannelMode::kJointStereo;
    const std::uint32_t joint_bits = joint ? 8u : 0u;
    const std::uint32_t audio_channels = active_mode_ == ChannelMode::kDualChannel ? 2u : 1u;
    const std::uint32_t payload_bits =
        joint_bits + 64u + active_blocks_ * active_bitpool_ * audio_channels;
    const std::uint32_t frame_bytes = 4u + (payload_bits + 7u) / 8u;
    if (length != frame_bytes) {
      return false;
    }

    SbcBitReader reader(bytes, length, 32u);
    join_.fill(false);
    if (joint) {
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        std::uint32_t joined = 0u;
        if (!reader.read(1u, joined)) {
          return false;
        }
        join_[subband] = joined != 0u;
      }
      if (join_[kSubbands - 1u]) {
        return false;
      }
    }
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        std::uint32_t scale_factor = 0u;
        if (!reader.read(4u, scale_factor)) {
          return false;
        }
        scale_factor_fields_[channel][subband] = static_cast<std::uint8_t>(scale_factor);
      }
    }
    allocateBits(2u);
    for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
          std::uint32_t codeword = 0u;
          if (!reader.read(bits_[channel][subband], codeword)) {
            return false;
          }
          codewords_[block][channel][subband] = static_cast<std::uint16_t>(codeword);
        }
      }
    }

    decodeLogicalFields(2u);
    copyTestFrame(frame_bytes, output);
    return true;
  }

  void copyTestFrame(std::uint32_t frame_bytes, test::BluetoothSbcFrame &output) noexcept {
    output = {};
    output.frameBytes = frame_bytes;
    output.blocks = active_blocks_;
    output.bitpool = active_bitpool_;
    output.channelMode = static_cast<test::BluetoothSbcChannelMode>(active_mode_);
    output.join = join_;
    output.scaleFactors = scale_factor_fields_;
    output.bits = bits_;
    for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
      output.codewords[block] = codewords_[block];
    }
    for (std::uint32_t sample = 0u; sample < active_blocks_ * kSubbands; ++sample) {
      std::array<double, 2> decoded{};
      popRawOutput(2u, decoded);
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        output.decodedPcm[channel][sample] =
            static_cast<std::int16_t>(roundCodecPcm(decoded[channel]));
      }
    }
  }
#endif

private:
  void buildCosineMatrices() noexcept {
    for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
      for (std::uint32_t index = 0u; index < 16u; ++index) {
        const double frequency = static_cast<double>(subband) + 0.5;
        analysis_cosines_[subband][index] = std::cos(
            frequency * (static_cast<double>(index) - 4.0) * std::numbers::pi_v<double> / 8.0);
        synthesis_cosines_[index][subband] = std::cos(
            frequency * (static_cast<double>(index) + 4.0) * std::numbers::pi_v<double> / 8.0);
      }
    }
  }

  void configureRate() noexcept {
    supported_ = true;
    switch (sample_rate_) {
    case 44100u:
      rate_factor_ = 1u;
      frequency_family_ = 0u;
      break;
    case 88200u:
      rate_factor_ = 2u;
      frequency_family_ = 0u;
      break;
    case 176400u:
      rate_factor_ = 4u;
      frequency_family_ = 0u;
      break;
    case 352800u:
      rate_factor_ = 8u;
      frequency_family_ = 0u;
      break;
    case 48000u:
      rate_factor_ = 1u;
      frequency_family_ = 1u;
      break;
    case 96000u:
      rate_factor_ = 2u;
      frequency_family_ = 1u;
      break;
    case 192000u:
      rate_factor_ = 4u;
      frequency_family_ = 1u;
      break;
    case 384000u:
      rate_factor_ = 8u;
      frequency_family_ = 1u;
      break;
    default:
      rate_factor_ = 1u;
      frequency_family_ = 1u;
      supported_ = false;
      break;
    }
    resampler_stages_ =
        rate_factor_ == 8u ? 3u : (rate_factor_ == 4u ? 2u : (rate_factor_ == 2u ? 1u : 0u));
    latency_samples_ = kTargetLatencyCodecSamples * rate_factor_;
  }

  [[nodiscard]] dsp::Halfband2x &inputResampler(std::uint32_t channel,
                                                std::uint32_t stage) noexcept {
    return input_resamplers_[channel * kMaximumResamplerStages + stage];
  }

  [[nodiscard]] dsp::Halfband2x &outputResampler(std::uint32_t channel,
                                                 std::uint32_t stage) noexcept {
    return output_resamplers_[channel * kMaximumResamplerStages + stage];
  }

  [[nodiscard]] bool resampleInput(const std::array<double, 2> &input, std::uint32_t channels,
                                   std::array<double, 2> &output) noexcept {
    if (resampler_stages_ == 0u) {
      output = input;
      return true;
    }
    bool output_ready = false;
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      float stage_input = static_cast<float>(input[channel]);
      bool channel_ready = true;
      for (std::uint32_t stage = 0u; stage < resampler_stages_; ++stage) {
        float stage_output = 0.0F;
        channel_ready = inputResampler(channel, stage).decimate(stage_input, stage_output);
        if (!channel_ready) {
          break;
        }
        stage_input = stage_output;
      }
      if (channel == 0u) {
        output_ready = channel_ready;
      }
      if (channel_ready) {
        output[channel] = static_cast<double>(stage_input);
      }
    }
    return output_ready;
  }

  void captureFrameParameters() noexcept {
    std::uint32_t bitpool = static_cast<std::uint32_t>(params_.bitpool);
    if (bitpool < 2u) {
      bitpool = 2u;
    } else if (bitpool > 53u) {
      bitpool = 53u;
    }
    const int block_index = static_cast<int>(std::floor(static_cast<double>(params_.blocks) + 0.5));
    constexpr std::array<std::uint32_t, 4> block_values = {{4u, 8u, 12u, 16u}};
    const std::uint32_t safe_index =
        block_index < 0 ? 0u : (block_index > 3 ? 3u : static_cast<std::uint32_t>(block_index));
    const int mode_index =
        static_cast<int>(std::floor(static_cast<double>(params_.channelMode) + 0.5));
    constexpr std::array<ChannelMode, 3> mode_values = {
        {ChannelMode::kJointStereo, ChannelMode::kStereo, ChannelMode::kDualChannel}};
    const std::uint32_t safe_mode =
        mode_index < 0 ? 0u : (mode_index > 2 ? 2u : static_cast<std::uint32_t>(mode_index));
    active_bitpool_ = bitpool;
    active_blocks_ = block_values[safe_index];
    active_mode_ = mode_values[safe_mode];
    double loss_ratio = static_cast<double>(params_.packetLoss) * 0.01;
    if (!std::isfinite(loss_ratio) || loss_ratio < 0.0) {
      loss_ratio = 0.0;
    } else if (loss_ratio > kMaximumLossRatio) {
      loss_ratio = kMaximumLossRatio;
    }
    active_loss_ratio_ = loss_ratio;
    if (active_loss_ratio_ == 0.0) {
      // A clean link retires the outage state itself, but not the concealment history: a real sink
      // always holds the frame it decoded last, so re-enabling packet loss must conceal with the
      // live stream. The history keeps tracking every received frame, so it can never go stale.
      link_bad_ = false;
      concealment_gain_ = 1.0;
    }
    updateWetDelay();
  }

  void updateWetDelay() noexcept {
    const std::uint32_t frame_samples = active_blocks_ * kSubbands * rate_factor_;
    const std::uint32_t resampler_delay =
        2u * static_cast<std::uint32_t>(dsp::Halfband2x::kLatency) * (rate_factor_ - 1u);
    const std::uint32_t stream_delay = kPqmfDelayCodecSamples * rate_factor_ + resampler_delay;
    const std::uint32_t consumed = frame_samples + stream_delay;
    wet_delay_samples_ = latency_samples_ > consumed ? latency_samples_ - consumed : 0u;
  }

  void analyze(std::uint32_t channel, const double *input, double *subbands) noexcept {
    auto &state = analysis_state_[channel];
    for (std::uint32_t index = kAnalysisLength; index-- > kSubbands;) {
      state[index] = state[index - kSubbands];
    }
    for (std::uint32_t index = 0u; index < kSubbands; ++index) {
      state[kSubbands - 1u - index] = input[index];
    }

    std::array<double, 16> partial{};
    for (std::uint32_t index = 0u; index < 16u; ++index) {
      double value = 0.0;
      for (std::uint32_t phase = 0u; phase < 5u; ++phase) {
        const std::uint32_t coefficient = index + phase * 16u;
        value += kPrototype8[coefficient] * state[coefficient];
      }
      partial[index] = value;
    }
    for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
      double value = 0.0;
      for (std::uint32_t index = 0u; index < 16u; ++index) {
        value += analysis_cosines_[subband][index] * partial[index];
      }
      subbands[subband] = value;
    }
  }

  void synthesize(std::uint32_t channel, const double *subbands, double *output) noexcept {
    auto &state = synthesis_state_[channel];
    for (std::uint32_t index = kSynthesisLength; index-- > 16u;) {
      state[index] = state[index - 16u];
    }
    for (std::uint32_t index = 0u; index < 16u; ++index) {
      double value = 0.0;
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        value += synthesis_cosines_[index][subband] * subbands[subband];
      }
      state[index] = value;
    }

    std::array<double, kAnalysisLength> windowed{};
    for (std::uint32_t phase = 0u; phase < 5u; ++phase) {
      for (std::uint32_t index = 0u; index < kSubbands; ++index) {
        const std::uint32_t base = phase * 16u;
        windowed[base + index] = state[phase * 32u + index] * kPrototype8[base + index] * -8.0;
        windowed[base + kSubbands + index] =
            state[phase * 32u + 24u + index] * kPrototype8[base + kSubbands + index] * -8.0;
      }
    }
    for (std::uint32_t sample = 0u; sample < kSubbands; ++sample) {
      double value = 0.0;
      for (std::uint32_t phase = 0u; phase < 10u; ++phase) {
        value += windowed[sample + phase * kSubbands];
      }
      output[sample] = value;
    }
  }

  [[nodiscard]] std::uint8_t scaleFactor(const double *samples,
                                         std::uint32_t stride) const noexcept {
    double peak = 0.0;
    for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
      const double sample = samples[block * stride];
      const double magnitude = sample < 0.0 ? -sample : sample;
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
    std::uint8_t scale = 0u;
    double limit = 2.0;
    while (scale < 15u && peak >= limit) {
      ++scale;
      limit *= 2.0;
    }
    return scale;
  }

  void prepareJointAndScaleFactors(std::uint32_t channels) noexcept {
    join_.fill(false);
    if (channels == 2u && active_mode_ == ChannelMode::kJointStereo) {
      for (std::uint32_t subband = 0u; subband + 1u < kSubbands; ++subband) {
        std::array<double, kMaximumBlocks> sum{};
        std::array<double, kMaximumBlocks> difference{};
        for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
          const double left = subband_samples_[0][block][subband];
          const double right = subband_samples_[1][block][subband];
          sum[block] = (left + right) * 0.5;
          difference[block] = (left - right) * 0.5;
        }
        const std::uint8_t left_scale = scaleFactor(&subband_samples_[0][0][subband], kSubbands);
        const std::uint8_t right_scale = scaleFactor(&subband_samples_[1][0][subband], kSubbands);
        const std::uint8_t sum_scale = scaleFactor(sum.data(), 1u);
        const std::uint8_t difference_scale = scaleFactor(difference.data(), 1u);
        if (static_cast<std::uint32_t>(left_scale) + right_scale >
            static_cast<std::uint32_t>(sum_scale) + difference_scale) {
          join_[subband] = true;
          for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
            subband_samples_[0][block][subband] = sum[block];
            subband_samples_[1][block][subband] = difference[block];
          }
        }
      }
    }
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        scale_factor_fields_[channel][subband] =
            scaleFactor(&subband_samples_[channel][0][subband], kSubbands);
      }
    }
  }

  [[nodiscard]] int bitNeed(std::uint8_t scale, std::uint32_t subband) const noexcept {
    if (scale == 0u) {
      return -5;
    }
    const int loudness = static_cast<int>(scale) - kLoudnessOffset8[frequency_family_][subband];
    return loudness > 0 ? loudness / 2 : loudness;
  }

  // Mono bit allocation, applied to one channel against the full bitpool. Mono and Dual Channel
  // share it: Dual Channel simply runs it once per channel, which is what doubles the frame length.
  void allocateMono(std::uint32_t channel) noexcept {
    std::array<int, kSubbands> need{};
    int maximum = 0;
    for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
      need[subband] = bitNeed(scale_factor_fields_[channel][subband], subband);
      if (need[subband] > maximum) {
        maximum = need[subband];
      }
      bits_[channel][subband] = 0u;
    }
    int bitcount = 0;
    int slicecount = 0;
    int bitslice = maximum + 1;
    for (std::uint32_t iteration = 0u; iteration < 64u; ++iteration) {
      --bitslice;
      bitcount += slicecount;
      slicecount = 0;
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        if (need[subband] > bitslice + 1 && need[subband] < bitslice + 16) {
          ++slicecount;
        } else if (need[subband] == bitslice + 1) {
          slicecount += 2;
        }
      }
      if (bitcount + slicecount >= static_cast<int>(active_bitpool_)) {
        break;
      }
    }
    if (bitcount + slicecount == static_cast<int>(active_bitpool_)) {
      bitcount += slicecount;
      --bitslice;
    }
    for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
      bits_[channel][subband] =
          need[subband] < bitslice + 2
              ? 0u
              : static_cast<std::uint8_t>(need[subband] - bitslice < 16 ? need[subband] - bitslice
                                                                        : 16);
    }
    distributeRemainingMono(channel, need, bitslice, bitcount, true);
    distributeRemainingMono(channel, need, bitslice, bitcount, false);
  }

  void distributeRemainingMono(std::uint32_t channel, const std::array<int, kSubbands> &need,
                               int bitslice, int &bitcount, bool first_pass) noexcept {
    for (std::uint32_t subband = 0u;
         bitcount < static_cast<int>(active_bitpool_) && subband < kSubbands; ++subband) {
      std::uint8_t &bits = bits_[channel][subband];
      if (!first_pass) {
        if (bits < 16u) {
          ++bits;
          ++bitcount;
        }
      } else if (bits >= 2u && bits < 16u) {
        ++bits;
        ++bitcount;
      } else if (need[subband] == bitslice + 1 &&
                 static_cast<int>(active_bitpool_) > bitcount + 1) {
        bits = 2u;
        bitcount += 2;
      }
    }
  }

  void allocateStereo() noexcept {
    std::array<std::array<int, kSubbands>, 2> need{};
    int maximum = 0;
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        need[channel][subband] = bitNeed(scale_factor_fields_[channel][subband], subband);
        if (need[channel][subband] > maximum) {
          maximum = need[channel][subband];
        }
        bits_[channel][subband] = 0u;
      }
    }
    int bitcount = 0;
    int slicecount = 0;
    int bitslice = maximum + 1;
    for (std::uint32_t iteration = 0u; iteration < 64u; ++iteration) {
      --bitslice;
      bitcount += slicecount;
      slicecount = 0;
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
          if (need[channel][subband] > bitslice + 1 && need[channel][subband] < bitslice + 16) {
            ++slicecount;
          } else if (need[channel][subband] == bitslice + 1) {
            slicecount += 2;
          }
        }
      }
      if (bitcount + slicecount >= static_cast<int>(active_bitpool_)) {
        break;
      }
    }
    if (bitcount + slicecount == static_cast<int>(active_bitpool_)) {
      bitcount += slicecount;
      --bitslice;
    }
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
        bits_[channel][subband] =
            need[channel][subband] < bitslice + 2
                ? 0u
                : static_cast<std::uint8_t>(need[channel][subband] - bitslice < 16
                                                ? need[channel][subband] - bitslice
                                                : 16);
      }
    }
    distributeRemainingStereo(need, bitslice, bitcount, true);
    distributeRemainingStereo(need, bitslice, bitcount, false);
  }

  void distributeRemainingStereo(const std::array<std::array<int, kSubbands>, 2> &need,
                                 int bitslice, int &bitcount, bool first_pass) noexcept {
    std::uint32_t channel = 0u;
    std::uint32_t subband = 0u;
    while (bitcount < static_cast<int>(active_bitpool_) && subband < kSubbands) {
      std::uint8_t &bits = bits_[channel][subband];
      if (!first_pass) {
        if (bits < 16u) {
          ++bits;
          ++bitcount;
        }
      } else if (bits >= 2u && bits < 16u) {
        ++bits;
        ++bitcount;
      } else if (need[channel][subband] == bitslice + 1 &&
                 static_cast<int>(active_bitpool_) > bitcount + 1) {
        bits = 2u;
        bitcount += 2;
      }
      if (channel == 1u) {
        channel = 0u;
        ++subband;
      } else {
        channel = 1u;
      }
    }
  }

#if !defined(__EMSCRIPTEN__)
  // SBC header channel-mode field: 0 mono, 1 dual channel, 2 stereo, 3 joint stereo.
  [[nodiscard]] std::uint32_t frameModeCode() const noexcept {
    switch (active_mode_) {
    case ChannelMode::kDualChannel:
      return 1u;
    case ChannelMode::kStereo:
      return 2u;
    case ChannelMode::kJointStereo:
      break;
    }
    return 3u;
  }
#endif

  void allocateBits(std::uint32_t channels) noexcept {
    if (channels == 1u) {
      allocateMono(0u);
    } else if (active_mode_ == ChannelMode::kDualChannel) {
      allocateMono(0u);
      allocateMono(1u);
    } else {
      allocateStereo();
    }
  }

  void quantizeLogicalFields(std::uint32_t channels) noexcept {
    for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
      for (std::uint32_t channel = 0u; channel < channels; ++channel) {
        for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
          const std::uint32_t bit_count = bits_[channel][subband];
          if (bit_count == 0u) {
            codewords_[block][channel][subband] = 0u;
            continue;
          }
          const std::uint32_t levels = (1u << bit_count) - 1u;
          const double scale = std::ldexp(1.0, scale_factor_fields_[channel][subband] + 1u);
          double normalized = subband_samples_[channel][block][subband] / scale;
          if (normalized < -1.0) {
            normalized = -1.0;
          } else if (normalized > 1.0) {
            normalized = 1.0;
          }
          double code = std::floor((normalized + 1.0) * static_cast<double>(levels) * 0.5);
          if (code < 0.0) {
            code = 0.0;
          } else if (code > static_cast<double>(levels)) {
            code = static_cast<double>(levels);
          }
          codewords_[block][channel][subband] = static_cast<std::uint16_t>(code);
        }
      }
    }
  }

  void decodeLogicalFields(std::uint32_t channels) noexcept {
    for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
      std::array<std::array<double, kSubbands>, 2> decoded{};
      for (std::uint32_t channel = 0u; channel < channels; ++channel) {
        for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
          const std::uint32_t bit_count = bits_[channel][subband];
          if (bit_count == 0u) {
            decoded[channel][subband] = 0.0;
            continue;
          }
          const std::uint32_t levels = (1u << bit_count) - 1u;
          const double scale = std::ldexp(1.0, scale_factor_fields_[channel][subband] + 1u);
          decoded[channel][subband] =
              scale * ((static_cast<double>(codewords_[block][channel][subband]) * 2.0 + 1.0) /
                           static_cast<double>(levels) -
                       1.0);
        }
      }
      if (channels == 2u && active_mode_ == ChannelMode::kJointStereo) {
        for (std::uint32_t subband = 0u; subband + 1u < kSubbands; ++subband) {
          if (!join_[subband]) {
            continue;
          }
          const double sum = decoded[0][subband];
          const double difference = decoded[1][subband];
          decoded[0][subband] = sum + difference;
          decoded[1][subband] = sum - difference;
        }
      }
      // The sink retains the frame it decoded last regardless of the current link quality, so the
      // history is refreshed unconditionally. Otherwise the first loss after a clean stretch would
      // find an empty history and conceal with hard silence instead of the audio just heard.
      last_good_subbands_[block] = decoded;
      emitDecodedBlock(decoded, channels);
    }
    last_good_blocks_ = active_blocks_;
    concealment_gain_ = 1.0;
  }

  void emitDecodedBlock(const std::array<std::array<double, kSubbands>, 2> &decoded,
                        std::uint32_t channels) noexcept {
    std::array<std::array<double, kSubbands>, 2> pcm{};
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      synthesize(channel, decoded[channel].data(), pcm[channel].data());
    }
    for (std::uint32_t sample = 0u; sample < kSubbands; ++sample) {
      std::array<double, 2> frame{};
      for (std::uint32_t channel = 0u; channel < channels; ++channel) {
        frame[channel] = clampCodecOutput(pcm[channel][sample]);
      }
      pushInterpolatedFrame(frame, channels);
    }
  }

  [[nodiscard]] const LinkProfile &linkProfile() const noexcept {
    const std::uint32_t index = active_blocks_ / 4u - 1u;
    return kLinkProfiles[index < kLinkProfiles.size() ? index : kLinkProfiles.size() - 1u];
  }

  // Gilbert-Elliott link state advanced once per SBC frame. The bad state loses every frame it
  // covers, including the frame that entered it, so the mean burst is the profile's
  // B = 1 + 1 / recovery frames, a fixed duration expressed in frames of the current block count.
  // The good run that precedes a burst has mean (1 - entry) / entry frames, so the long-run loss
  // ratio is r = B / (B + (1 - entry) / entry); solving for the entry probability gives
  // entry = r / (B * (1 - r) + r).
  [[nodiscard]] bool updateLinkState() noexcept {
    const LinkProfile &profile = linkProfile();
    if (link_bad_) {
      if (random_.nextFloat01() < profile.recovery_probability) {
        link_bad_ = false;
      }
      return true;
    }
    const double entry =
        active_loss_ratio_ /
        (profile.mean_burst_frames * (1.0 - active_loss_ratio_) + active_loss_ratio_);
    if (random_.nextFloat01() < entry) {
      link_bad_ = true;
      return true;
    }
    return false;
  }

  // Packet-loss concealment: repeat the last received subband frame with a gain that ramps down
  // across the frame, so a sustained outage fades into silence instead of looping audibly. The
  // per-frame decay comes from the link profile, so the fade takes the same wall-clock time at
  // every block count.
  void concealFrame(std::uint32_t channels) noexcept {
    const double decay = linkProfile().concealment_frame_decay;
    for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
      std::array<std::array<double, kSubbands>, 2> decoded{};
      if (last_good_blocks_ != 0u) {
        const double progress =
            static_cast<double>(block + 1u) / static_cast<double>(active_blocks_);
        const double gain = concealment_gain_ * (1.0 + (decay - 1.0) * progress);
        const auto &source = last_good_subbands_[block % last_good_blocks_];
        for (std::uint32_t channel = 0u; channel < channels; ++channel) {
          for (std::uint32_t subband = 0u; subband < kSubbands; ++subband) {
            decoded[channel][subband] = source[channel][subband] * gain;
          }
        }
      }
      emitDecodedBlock(decoded, channels);
    }
    concealment_gain_ *= decay;
  }

  void encodeDecodeFrame(std::uint32_t channels) noexcept {
    // The transmitter always analyses the frame, so the PQMF analysis state advances even when the
    // sink never receives the packet.
    for (std::uint32_t block = 0u; block < active_blocks_; ++block) {
      for (std::uint32_t channel = 0u; channel < channels; ++channel) {
        analyze(channel, &codec_input_[channel][block * kSubbands],
                subband_samples_[channel][block].data());
      }
    }
    if (active_loss_ratio_ > 0.0 && updateLinkState()) {
      concealFrame(channels);
      return;
    }
    prepareJointAndScaleFactors(channels);
    allocateBits(channels);
    quantizeLogicalFields(channels);
    decodeLogicalFields(channels);
  }

  void pushInterpolatedFrame(const std::array<double, 2> &samples,
                             std::uint32_t channels) noexcept {
    if (resampler_stages_ == 0u) {
      pushRawFrame(samples, channels);
      return;
    }
    std::array<std::array<float, 2>, kMaximumRateFactor> current{};
    std::array<std::array<float, 2>, kMaximumRateFactor> next{};
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      current[0u][channel] = static_cast<float>(samples[channel]);
    }
    std::uint32_t generated_count = 1u;
    for (std::uint32_t stage = resampler_stages_; stage-- > 0u;) {
      for (std::uint32_t frame = 0u; frame < generated_count; ++frame) {
        for (std::uint32_t channel = 0u; channel < channels; ++channel) {
          outputResampler(channel, stage)
              .interpolate(current[frame][channel], next[2u * frame][channel],
                           next[2u * frame + 1u][channel]);
        }
      }
      generated_count *= 2u;
      current = next;
      next = {};
    }
    for (std::uint32_t frame = 0u; frame < generated_count; ++frame) {
      std::array<double, 2> output{};
      for (std::uint32_t channel = 0u; channel < channels; ++channel) {
        output[channel] = static_cast<double>(current[frame][channel]);
      }
      pushRawFrame(output, channels);
    }
  }

  void pushRawFrame(const std::array<double, 2> &samples, std::uint32_t channels) noexcept {
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      raw_output_[channel * kRawOutputCapacity + raw_output_write_] = samples[channel];
    }
    raw_output_write_ = (raw_output_write_ + 1u) % kRawOutputCapacity;
    if (raw_output_count_ < kRawOutputCapacity) {
      ++raw_output_count_;
    } else {
      raw_output_read_ = (raw_output_read_ + 1u) % kRawOutputCapacity;
    }
  }

  void popRawOutput(std::uint32_t channels, std::array<double, 2> &output) noexcept {
    if (raw_output_count_ == 0u) {
      output.fill(0.0);
      return;
    }
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      output[channel] = raw_output_[channel * kRawOutputCapacity + raw_output_read_];
    }
    raw_output_read_ = (raw_output_read_ + 1u) % kRawOutputCapacity;
    --raw_output_count_;
  }

  [[nodiscard]] double delaySample(std::vector<double> &buffer, std::uint32_t channel,
                                   std::uint32_t delay, double input) noexcept {
    const std::uint32_t base = channel * kDelayCapacity;
    buffer[base + delay_position_] = input;
    const std::uint32_t bounded_delay = delay < kDelayCapacity ? delay : kDelayCapacity - 1u;
    const std::uint32_t read = (delay_position_ + kDelayCapacity - bounded_delay) % kDelayCapacity;
    return buffer[base + read];
  }

  std::uint32_t sample_rate_ = 0u;
  std::uint32_t rate_factor_ = 1u;
  std::uint32_t resampler_stages_ = 0u;
  std::uint32_t frequency_family_ = 1u;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t active_channels_ = 0u;
  std::uint32_t active_blocks_ = 16u;
  std::uint32_t active_bitpool_ = 35u;
  std::uint32_t codec_input_count_ = 0u;
  std::uint32_t raw_output_read_ = 0u;
  std::uint32_t raw_output_write_ = 0u;
  std::uint32_t raw_output_count_ = 0u;
  std::uint32_t delay_position_ = 0u;
  std::uint32_t latency_samples_ = 0u;
  std::uint32_t wet_delay_samples_ = 0u;
  std::uint32_t last_good_blocks_ = 0u;
  std::uint32_t selected_seed_low_ = static_cast<std::uint32_t>(dsp::XorShiftRng::kFallbackSeed);
  std::uint32_t selected_seed_high_ = 0u;
  bool supported_ = false;
  ChannelMode active_mode_ = ChannelMode::kJointStereo;
  bool initialized_controls_ = false;
  bool link_bad_ = false;
  double output_gain_smoothed_ = 1.0;
  double mix_smoothed_ = 1.0;
  double active_loss_ratio_ = 0.0;
  double concealment_gain_ = 1.0;
  dsp::XorShiftRng random_{};

  AnalysisCosineMatrix analysis_cosines_{};
  SynthesisCosineMatrix synthesis_cosines_{};
  std::vector<std::array<double, kAnalysisLength>> analysis_state_;
  std::vector<std::array<double, kSynthesisLength>> synthesis_state_;
  std::vector<dsp::Halfband2x> input_resamplers_;
  std::vector<dsp::Halfband2x> output_resamplers_;
  std::vector<std::array<double, kMaximumCodecFrameSamples>> codec_input_;
  std::vector<std::array<std::array<double, kSubbands>, kMaximumBlocks>> subband_samples_;
  std::array<std::array<std::uint8_t, kSubbands>, 2> scale_factor_fields_{};
  std::array<std::array<std::uint8_t, kSubbands>, 2> bits_{};
  std::vector<std::array<std::array<std::uint16_t, kSubbands>, 2>> codewords_;
  std::array<bool, kSubbands> join_{};
  std::vector<std::array<std::array<double, kSubbands>, 2>> last_good_subbands_;
  std::vector<double> raw_output_;
  std::vector<double> dry_delay_;
  std::vector<double> wet_delay_;
};

static_assert(sizeof(BluetoothSBCSimulatorKernel) <= 8192u);

#if !defined(__EMSCRIPTEN__)
bool test::decodeBluetoothSbcTestFrame(const std::uint8_t *bytes, std::size_t length,
                                       test::BluetoothSbcFrame &output) noexcept {
  BluetoothSBCSimulatorKernel kernel;
  kernel.prepare({48000.0F, 2u, kMaximumCodecFrameSamples});
  return kernel.preparedSuccessfully() && kernel.decodeTestFrame(bytes, length, output);
}

bool test::encodeBluetoothSbcTestFrame(const test::BluetoothSbcPcm &input,
                                       test::BluetoothSbcChannelMode channel_mode,
                                       std::uint32_t blocks, std::uint32_t bitpool,
                                       test::BluetoothSbcEncodedFrame &output) noexcept {
  BluetoothSBCSimulatorKernel kernel;
  kernel.prepare({48000.0F, 2u, kMaximumCodecFrameSamples});
  return kernel.preparedSuccessfully() &&
         kernel.encodeTestFrame(input, channel_mode, blocks, bitpool, output);
}
#endif

} // namespace effetune::plugins::lofi

EFFETUNE_REGISTER_KERNEL(BluetoothSBCSimulatorPlugin,
                         effetune::plugins::lofi::BluetoothSBCSimulatorKernel)
