#include "effetune/kernel.h"
#include "FIRCrossoverPluginParams.h"
#include "binary_io.h"
#include "effetune/dsp/partitioned_convolver.h"
#include "nothrow_storage.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <new>

namespace effetune::plugins::basics {
namespace {

constexpr std::uint32_t kAssetSlot = 0u;
constexpr std::uint32_t kAssetCapacity = 32u * 1024u * 1024u;
constexpr std::uint32_t kAssetHeaderBytes = 32u;
constexpr std::uint32_t kMatrixPathBytes = 12u;
constexpr std::uint32_t kAssetMagic = 0x31415445u;
constexpr std::uint32_t kMatrixTopology = 4u;
constexpr std::uint32_t kMaximumChannels = 8u;
constexpr std::uint32_t kMaximumFilterDelay = 65536u;
constexpr std::uint32_t kFadeFrames = 128u;
constexpr std::uint32_t kDelayTransitionFrames = 256u;
constexpr std::uint32_t kReplacementDryReady = 1u << 16u;
constexpr float kReplacementDryLatencyMode = -1.0F;
constexpr std::uint16_t kChannelCountTelemetry = 9u;
constexpr std::uint16_t kTelemetryVersion = 1u;
constexpr std::size_t kAdmissionHeadroom = 1u * 1024u * 1024u;

std::uint32_t readU32(const std::uint8_t *bytes) noexcept {
  return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8u) |
         (static_cast<std::uint32_t>(bytes[2]) << 16u) |
         (static_cast<std::uint32_t>(bytes[3]) << 24u);
}

using binary_io::writeU32;

std::uint32_t delaySamples(float value) noexcept {
  if (!(value > 0.0F))
    return 0u;
  if (value >= static_cast<float>(kMaximumFilterDelay))
    return kMaximumFilterDelay;
  return static_cast<std::uint32_t>(value);
}

template <typename T> class CrossoverStorage : public NothrowStorage<T> {
public:
  void clear(std::size_t count) noexcept {
    if (this->data() != nullptr)
      std::memset(this->data(), 0, count * sizeof(T));
  }
};

} // namespace

class FIRCrossoverKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::FIRCrossoverPluginParams)

public:
  static std::uint32_t assetCapacityForSlot(std::uint32_t slot) noexcept {
    return slot == kAssetSlot ? kAssetCapacity : 0u;
  }

  void prepare(const PrepareInfo &info) noexcept override {
    prepared_ = false;
    releaseStorage();
    sample_rate_ = info.sampleRate;
    max_channels_ = info.maxChannels < kMaximumChannels ? info.maxChannels : kMaximumChannels;
    max_frames_ = info.maxFrames;
    delay_capacity_ = kMaximumFilterDelay + 1024u + max_frames_ + 2u;
    const std::size_t audioSamples = static_cast<std::size_t>(max_channels_) * max_frames_;
    const std::size_t delaySamplesCount = static_cast<std::size_t>(max_channels_) * delay_capacity_;
    if (max_channels_ == 0u || max_frames_ == 0u || !wet_audio_.allocate(audioSamples) ||
        !dry_delay_.allocate(delaySamplesCount) || !wet_delay_.allocate(delaySamplesCount)) {
      releaseStorage();
      return;
    }
    prepared_ = true;
    clearAsset(kAssetSlot);
    resetRuntime();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  void reset() noexcept override {
    convolver_.reset();
    resetRuntime();
  }

  void setRandomSeed(std::uint32_t seedLow, std::uint32_t seedHigh) noexcept override {
    slice_offset_ = seedLow ^ (seedHigh << 16u | seedHigh >> 16u);
  }

  void process(float *audio, std::uint32_t channelCount, std::uint32_t frameCount,
               const ProcessInfo &) noexcept override {
    telemetry_channels_ = channelCount;
    if (!prepared_ || audio == nullptr || channelCount == 0u || channelCount > max_channels_ ||
        frameCount == 0u || frameCount > max_frames_)
      return;

    const bool convolverRunning =
        asset_state_ == ET_ASSET_STATE_PREPARING || asset_state_ == ET_ASSET_STATE_ACTIVE;
    bool assetReadyForBlock = false;
    if (convolverRunning && channelCount == processing_channels_) {
      std::memcpy(wet_audio_.data(), audio,
                  static_cast<std::size_t>(channelCount) * frameCount * sizeof(float));
      const dsp::ConvolverPreparationState stateBefore = convolver_.state();
      const std::uint64_t historyBefore = stream_history_samples_;
      convolver_.process(wet_audio_.data(), channelCount, frameCount);
      if (stateBefore == dsp::ConvolverPreparationState::warming ||
          stateBefore == dsp::ConvolverPreparationState::active) {
        const std::uint64_t maximum = static_cast<std::uint64_t>(-1);
        stream_history_samples_ = stream_history_samples_ > maximum - frameCount
                                      ? maximum
                                      : stream_history_samples_ + frameCount;
      }
      assetReadyForBlock = asset_state_ == ET_ASSET_STATE_PREPARING &&
                           convolver_.state() == dsp::ConvolverPreparationState::active &&
                           historyBefore >= resident_latency_;
    } else {
      std::memset(wet_audio_.data(), 0,
                  static_cast<std::size_t>(channelCount) * frameCount * sizeof(float));
    }
    if (assetReadyForBlock)
      asset_state_ = ET_ASSET_STATE_ACTIVE;

    const bool replacementDryRequested = params_.latencyMode == kReplacementDryLatencyMode;
    if (replacementDryRequested)
      split_output_muted_ = true;
    if (!replacementDryRequested)
      replacement_dry_ready_ = false;
    for (std::uint32_t frame = 0u; frame < frameCount; ++frame) {
      const float latencyRamp = transitionGain(latency_transition_remaining_);
      for (std::uint32_t channel = 0u; channel < channelCount; ++channel) {
        const std::size_t audioIndex = static_cast<std::size_t>(channel) * frameCount + frame;
        const std::size_t ringBase = static_cast<std::size_t>(channel) * delay_capacity_;
        dry_delay_.data()[ringBase + delay_position_] = audio[audioIndex];
        wet_delay_.data()[ringBase + delay_position_] = wet_audio_.data()[audioIndex];
        const float dry = readDelay(dry_delay_.data() + ringBase, activeResidentLatency());
        const float wet = readDelay(wet_delay_.data() + ringBase, 0u);
        const bool assetActive =
            asset_state_ == ET_ASSET_STATE_ACTIVE && channelCount == processing_channels_;
        const float targetMix = assetActive && !replacementDryRequested ? 1.0F : 0.0F;
        if (wet_mix_[channel] < targetMix) {
          wet_mix_[channel] += 1.0F / static_cast<float>(kFadeFrames);
          if (wet_mix_[channel] > targetMix)
            wet_mix_[channel] = targetMix;
        } else if (wet_mix_[channel] > targetMix) {
          wet_mix_[channel] -= 1.0F / static_cast<float>(kFadeFrames);
          if (wet_mix_[channel] < targetMix)
            wet_mix_[channel] = targetMix;
        }
        const bool splitOutputOnly = split_output_muted_ || !assetActive;
        audio[audioIndex] =
            (splitOutputOnly ? wet_mix_[channel] * wet : dry + wet_mix_[channel] * (wet - dry)) *
            latencyRamp;
      }
      delay_position_ += 1u;
      if (delay_position_ == delay_capacity_)
        delay_position_ = 0u;
      if (latency_transition_remaining_ > 0u)
        --latency_transition_remaining_;
    }
    if (replacementDryRequested && asset_state_ == ET_ASSET_STATE_ACTIVE) {
      replacement_dry_ready_ = true;
      for (std::uint32_t channel = 0u; channel < channelCount; ++channel) {
        if (wet_mix_[channel] != 0.0F) {
          replacement_dry_ready_ = false;
          break;
        }
      }
    }
    if (split_output_muted_ && !replacementDryRequested && asset_state_ == ET_ASSET_STATE_ACTIVE &&
        channelCount == processing_channels_) {
      split_output_muted_ = false;
      for (std::uint32_t channel = 0u; channel < channelCount; ++channel) {
        if (wet_mix_[channel] != 1.0F) {
          split_output_muted_ = true;
          break;
        }
      }
    }
  }

  void writeTelemetry(TelemetryWriter &writer) noexcept override {
    if (telemetry_channels_ == 0u)
      return;
    std::array<std::uint8_t, 4> payload{};
    writeU32(payload.data(), telemetry_channels_);
    writer.write(kChannelCountTelemetry, kTelemetryVersion, payload.data(),
                 static_cast<std::uint16_t>(payload.size()));
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return resident_asset_seen_ ? resident_latency_ : 0u;
  }

  [[nodiscard]] std::uint32_t assetCapacity(std::uint32_t slot) const noexcept override {
    return assetCapacityForSlot(slot);
  }

  std::uint8_t *beginAsset(std::uint32_t slot, const AssetBeginInfo &info) noexcept override {
    applyPendingParameters();
    if (!validateBegin(slot, info))
      return nullptr;

    dsp::ConvolverConfig config;
    config.latencySamples = info.headBlock;
    config.sliceOffset = slice_offset_;
    config.inputs = 2u;
    config.outputs = info.processingChannels;
    config.irChannels = info.channels;
    config.irFrames = info.frames;
    config.pathCount = info.pathCount;
    for (std::uint32_t band = 0u; band < info.channels; ++band) {
      config.paths[band * 2u] = {0u, band * 2u, band};
      config.paths[band * 2u + 1u] = {1u, band * 2u + 1u, band};
    }

    const std::uint64_t probeBytes = static_cast<std::uint64_t>(info.footprintBytes) +
                                     static_cast<std::uint64_t>(kAdmissionHeadroom);
    if (probeBytes > std::numeric_limits<std::size_t>::max())
      return nullptr;
    CrossoverStorage<std::uint8_t> admissionProbe;
    if (!admissionProbe.allocate(static_cast<std::size_t>(probeBytes)))
      return nullptr;
    admissionProbe.release();

    convolver_.clear();
    staging_payload_.release();
    wet_mix_.fill(0.0F);
    replacement_dry_ready_ = false;
    if (!staging_payload_.allocate(info.byteSize / sizeof(float)) || !convolver_.reserve(config) ||
        convolver_.memoryBytes() + info.byteSize > info.footprintBytes) {
      convolver_.clear();
      staging_payload_.release();
      setAssetError(2u);
      return nullptr;
    }
    begin_info_ = info;
    candidate_latency_ = info.headBlock + delaySamples(params_.filterDelaySamples);
    candidate_processing_channels_ = info.processingChannels;
    asset_state_ = ET_ASSET_STATE_STAGED;
    asset_reason_ = 0u;
    return reinterpret_cast<std::uint8_t *>(staging_payload_.data());
  }

  et_status commitAsset(std::uint32_t slot, std::uint32_t bytes,
                        std::uint32_t formatTag) noexcept override {
    if (slot != kAssetSlot || asset_state_ != ET_ASSET_STATE_STAGED ||
        bytes != begin_info_.byteSize || formatTag != ET_ASSET_F32_MULTICH || !validatePayload()) {
      convolver_.clear();
      staging_payload_.release();
      setAssetError(1u);
      return ET_ERR_ARGS;
    }
    std::array<dsp::ConvolutionPath, dsp::ConvolverConfig::kMaximumPaths> paths{};
    if (!decodeMatrixPaths(paths) ||
        !convolver_.updatePathsWithoutAllocation(paths.data(), begin_info_.pathCount)) {
      convolver_.clear();
      staging_payload_.release();
      setAssetError(1u);
      return ET_ERR_ARGS;
    }
    const std::uint32_t pathBytes = begin_info_.pathCount * kMatrixPathBytes;
    const float *samples =
        staging_payload_.data() + (kAssetHeaderBytes + pathBytes) / sizeof(float);
    if (!convolver_.commit(samples, begin_info_.channels, begin_info_.frames)) {
      convolver_.clear();
      staging_payload_.release();
      setAssetError(3u);
      return ET_ERR_STATE;
    }
    previous_resident_latency_ = resident_asset_seen_ ? resident_latency_ : 0u;
    resident_latency_ = candidate_latency_;
    processing_channels_ = candidate_processing_channels_;
    resident_asset_seen_ = true;
    latency_transition_remaining_ =
        previous_resident_latency_ == resident_latency_ ? 0u : kDelayTransitionFrames;
    stream_history_samples_ = 0u;
    asset_state_ = ET_ASSET_STATE_PREPARING;
    asset_reason_ = 0u;
    replacement_dry_ready_ = false;
    return ET_OK;
  }

  void clearAsset(std::uint32_t slot) noexcept override {
    if (slot != kAssetSlot)
      return;
    convolver_.clear();
    staging_payload_.release();
    previous_resident_latency_ = resident_latency_;
    resident_latency_ = 0u;
    resident_asset_seen_ = false;
    processing_channels_ = 0u;
    stream_history_samples_ = 0u;
    latency_transition_remaining_ = previous_resident_latency_ == 0u ? 0u : kDelayTransitionFrames;
    asset_state_ = ET_ASSET_STATE_NONE;
    asset_reason_ = 0u;
    split_output_muted_ = true;
    replacement_dry_ready_ = false;
  }

  [[nodiscard]] std::uint32_t assetState(std::uint32_t slot) const noexcept override {
    return slot == kAssetSlot ? asset_state_ | (asset_reason_ << 8u) |
                                    (replacement_dry_ready_ ? kReplacementDryReady : 0u)
                              : static_cast<std::uint32_t>(ET_ASSET_STATE_NONE);
  }

private:
  bool validateBegin(std::uint32_t slot, const AssetBeginInfo &info) const noexcept {
    if (slot != kAssetSlot || !prepared_ || info.channels < 2u || info.channels > 4u ||
        (info.processingChannels != 4u && info.processingChannels != 6u &&
         info.processingChannels != 8u) ||
        info.processingChannels > max_channels_ || info.channels * 2u > info.processingChannels ||
        info.frames == 0u || info.frames > 131072u || info.topology != kMatrixTopology ||
        info.pathCount != info.channels * 2u || info.inputCount != 2u ||
        (info.headBlock != 0u && info.headBlock != 128u && info.headBlock != 256u &&
         info.headBlock != 512u && info.headBlock != 1024u) ||
        info.rateDivider != 1u || info.footprintBytes < info.byteSize ||
        info.footprintBytes > kAssetCapacity || !(params_.filterDelaySamples >= 0.0F) ||
        params_.filterDelaySamples > static_cast<float>(kMaximumFilterDelay))
      return false;
    const std::uint64_t expected =
        kAssetHeaderBytes + static_cast<std::uint64_t>(info.pathCount) * kMatrixPathBytes +
        static_cast<std::uint64_t>(info.channels) * info.frames * sizeof(float);
    return expected == info.byteSize && expected <= kAssetCapacity &&
           (info.byteSize % sizeof(float)) == 0u;
  }

  bool validatePayload() const noexcept {
    const auto *bytes = reinterpret_cast<const std::uint8_t *>(staging_payload_.data());
    return readU32(bytes) == kAssetMagic && readU32(bytes + 4u) == begin_info_.channels &&
           readU32(bytes + 8u) == begin_info_.frames &&
           readU32(bytes + 12u) == static_cast<std::uint32_t>(std::lround(sample_rate_)) &&
           readU32(bytes + 16u) == kMatrixTopology &&
           readU32(bytes + 20u) == begin_info_.pathCount && readU32(bytes + 24u) == 0u &&
           readU32(bytes + 28u) == 0u;
  }

  bool decodeMatrixPaths(
      std::array<dsp::ConvolutionPath, dsp::ConvolverConfig::kMaximumPaths> &paths) const noexcept {
    const auto *bytes =
        reinterpret_cast<const std::uint8_t *>(staging_payload_.data()) + kAssetHeaderBytes;
    for (std::uint32_t band = 0u; band < begin_info_.channels; ++band) {
      for (std::uint32_t input = 0u; input < 2u; ++input) {
        const std::uint32_t index = band * 2u + input;
        const std::uint8_t *record = bytes + index * kMatrixPathBytes;
        const dsp::ConvolutionPath path{readU32(record), readU32(record + 4u),
                                        readU32(record + 8u)};
        if (path.input != input || path.output != band * 2u + input || path.irChannel != band)
          return false;
        paths[index] = path;
      }
    }
    return true;
  }

  void setAssetError(std::uint32_t reason) noexcept {
    asset_state_ = ET_ASSET_STATE_ERROR;
    asset_reason_ = reason;
    wet_mix_.fill(0.0F);
    split_output_muted_ = true;
    replacement_dry_ready_ = false;
  }

  void releaseStorage() noexcept {
    wet_audio_.release();
    dry_delay_.release();
    wet_delay_.release();
    staging_payload_.release();
  }

  void resetRuntime() noexcept {
    const std::size_t delaySamplesCount = static_cast<std::size_t>(max_channels_) * delay_capacity_;
    dry_delay_.clear(delaySamplesCount);
    wet_delay_.clear(delaySamplesCount);
    delay_position_ = 0u;
    wet_mix_.fill(0.0F);
    split_output_muted_ = true;
    replacement_dry_ready_ = false;
    latency_transition_remaining_ = 0u;
  }

  [[nodiscard]] std::uint32_t activeResidentLatency() const noexcept {
    return latency_transition_remaining_ > kFadeFrames ? previous_resident_latency_
                                                       : resident_latency_;
  }

  [[nodiscard]] float transitionGain(std::uint32_t remaining) const noexcept {
    if (remaining == 0u)
      return 1.0F;
    if (remaining > kFadeFrames)
      return static_cast<float>(remaining - kFadeFrames) / static_cast<float>(kFadeFrames);
    return 1.0F - static_cast<float>(remaining) / static_cast<float>(kFadeFrames);
  }

  [[nodiscard]] float readDelay(const float *ring, std::uint32_t delay) const noexcept {
    if (delay >= delay_capacity_)
      delay = delay_capacity_ - 1u;
    const std::uint32_t readPosition = delay_position_ >= delay
                                           ? delay_position_ - delay
                                           : delay_capacity_ + delay_position_ - delay;
    return ring[readPosition];
  }

  bool prepared_ = false;
  float sample_rate_ = 48000.0F;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t delay_capacity_ = 0u;
  std::uint32_t delay_position_ = 0u;
  std::uint32_t slice_offset_ = 0u;
  std::uint32_t telemetry_channels_ = 0u;
  dsp::PartitionedConvolver convolver_;
  CrossoverStorage<float> staging_payload_;
  CrossoverStorage<float> wet_audio_;
  CrossoverStorage<float> dry_delay_;
  CrossoverStorage<float> wet_delay_;
  AssetBeginInfo begin_info_{};
  std::uint32_t asset_state_ = ET_ASSET_STATE_NONE;
  std::uint32_t asset_reason_ = 0u;
  std::uint32_t processing_channels_ = 0u;
  std::uint32_t candidate_processing_channels_ = 0u;
  std::uint32_t candidate_latency_ = 0u;
  std::uint32_t resident_latency_ = 0u;
  std::uint32_t previous_resident_latency_ = 0u;
  std::uint32_t latency_transition_remaining_ = 0u;
  std::uint64_t stream_history_samples_ = 0u;
  bool resident_asset_seen_ = false;
  bool split_output_muted_ = true;
  bool replacement_dry_ready_ = false;
  std::array<float, kMaximumChannels> wet_mix_{};
};

} // namespace effetune::plugins::basics

EFFETUNE_REGISTER_KERNEL(FIRCrossoverPlugin, effetune::plugins::basics::FIRCrossoverKernel)
