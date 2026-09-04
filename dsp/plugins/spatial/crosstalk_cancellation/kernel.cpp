#include "effetune/kernel.h"
#include "CrosstalkCancellationPluginParams.h"
#include "effetune/dsp/partitioned_convolver.h"
#include "nothrow_storage.h"

#if defined(ET_SIMD) && defined(__wasm_simd128__)
#include <wasm_simd128.h>
#define ET_XTC_WASM_SIMD 1
#else
#define ET_XTC_WASM_SIMD 0
#endif

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>

namespace effetune::plugins::spatial {
namespace {

constexpr std::uint32_t kAssetSlot = 0u;
constexpr std::uint32_t kAssetCapacity = 32u * 1024u * 1024u;
constexpr std::uint32_t kAssetHeaderBytes = 32u;
constexpr std::uint32_t kAssetMagic = 0x31415445u;
constexpr std::uint32_t kTrueStereoTopology = 3u;
constexpr std::uint32_t kAssetChannels = 4u;
constexpr std::uint32_t kProcessingChannels = 2u;
constexpr std::uint32_t kMaximumFilterDelay = 65536u;
constexpr std::uint32_t kMaximumIrFrames = 131072u;
constexpr std::uint32_t kFadeFrames = 128u;
constexpr std::uint32_t kDelayTransitionFrames = 256u;
constexpr std::uint32_t kReplacementDryReady = 1u << 16u;
constexpr float kReplacementDryLatencyMode = -1.0F;
constexpr std::size_t kAdmissionHeadroom = 1u * 1024u * 1024u;

std::uint32_t readU32(const std::uint8_t *bytes) noexcept {
  return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8u) |
         (static_cast<std::uint32_t>(bytes[2]) << 16u) |
         (static_cast<std::uint32_t>(bytes[3]) << 24u);
}

float decibelsToGain(float decibels) noexcept { return std::pow(10.0F, decibels * 0.05F); }

std::uint32_t filterDelay(float value) noexcept {
  if (!(value > 0.0F))
    return 0u;
  if (value >= static_cast<float>(kMaximumFilterDelay))
    return kMaximumFilterDelay;
  return static_cast<std::uint32_t>(value);
}

bool supportedHeadBlock(std::uint32_t value) noexcept {
  return value == 0u || value == 128u || value == 256u || value == 512u || value == 1024u;
}

} // namespace

class CrosstalkCancellationKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::CrosstalkCancellationPluginParams)

public:
  static std::uint32_t assetCapacityForSlot(std::uint32_t slot) noexcept {
    return slot == kAssetSlot ? kAssetCapacity : 0u;
  }

  void prepare(const PrepareInfo &info) noexcept override {
    prepared_ = false;
    releaseStorage();
    sample_rate_ = info.sampleRate;
    max_frames_ = info.maxFrames;
    delay_capacity_ = kMaximumFilterDelay + 1024u + max_frames_ + 2u;
    const std::size_t audioSamples = static_cast<std::size_t>(kProcessingChannels) * max_frames_;
    const std::size_t delaySamples =
        static_cast<std::size_t>(kProcessingChannels) * delay_capacity_;
    if (info.maxChannels < kProcessingChannels || max_frames_ == 0u ||
        !wet_audio_.allocate(audioSamples) || !dry_audio_.allocate(audioSamples) ||
        !dry_delay_.allocate(delaySamples) || !blend_mix_.allocate(max_frames_) ||
        !blend_gain_.allocate(max_frames_)) {
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
    if (!prepared_ || audio == nullptr || channelCount != kProcessingChannels || frameCount == 0u ||
        frameCount > max_frames_ || !resident_asset_seen_) {
      return;
    }

    const bool convolverRunning =
        asset_state_ == ET_ASSET_STATE_PREPARING || asset_state_ == ET_ASSET_STATE_ACTIVE;
    bool assetReadyForBlock = false;
    if (convolverRunning) {
      std::memcpy(wet_audio_.data(), audio,
                  static_cast<std::size_t>(kProcessingChannels) * frameCount * sizeof(float));
      const dsp::ConvolverPreparationState stateBefore = convolver_.state();
      const std::uint64_t historyBefore = stream_history_samples_;
      convolver_.process(wet_audio_.data(), kProcessingChannels, frameCount);
      const bool convolverWasWarmingOrActive =
          stateBefore == dsp::ConvolverPreparationState::warming ||
          stateBefore == dsp::ConvolverPreparationState::active;
      if (convolverWasWarmingOrActive) {
        const std::uint64_t maximum = std::numeric_limits<std::uint64_t>::max();
        stream_history_samples_ = stream_history_samples_ > maximum - frameCount
                                      ? maximum
                                      : stream_history_samples_ + frameCount;
      }
      assetReadyForBlock = asset_state_ == ET_ASSET_STATE_PREPARING &&
                           convolverWasWarmingOrActive &&
                           convolver_.state() == dsp::ConvolverPreparationState::active &&
                           historyBefore >= resident_latency_;
    } else {
      std::memset(wet_audio_.data(), 0,
                  static_cast<std::size_t>(kProcessingChannels) * frameCount * sizeof(float));
    }
    if (assetReadyForBlock)
      asset_state_ = ET_ASSET_STATE_ACTIVE;

    const bool replacementDryRequested = params_.latencyMode == kReplacementDryLatencyMode;
    if (!replacementDryRequested)
      replacement_dry_ready_ = false;
    retargetStrength(params_.strength * 0.01F);
    retargetOutputGain(decibelsToGain(params_.outputGain));
    renderDryAndControls(audio, frameCount, replacementDryRequested);
    blendOutput(audio, frameCount);

    if (replacementDryRequested && asset_state_ == ET_ASSET_STATE_ACTIVE && wet_mix_ == 0.0F)
      replacement_dry_ready_ = true;
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    return resident_asset_seen_ ? resident_latency_ : 0u;
  }

  [[nodiscard]] std::uint32_t assetCapacity(std::uint32_t slot) const noexcept override {
    return assetCapacityForSlot(slot);
  }

  std::uint8_t *beginAsset(std::uint32_t slot, const AssetBeginInfo &info) noexcept override {
    applyPendingParameters();
    if (!validateBegin(slot, info)) {
      setAssetError(1u);
      return nullptr;
    }

    dsp::ConvolverConfig config;
    config.latencySamples = info.headBlock;
    config.sliceOffset = slice_offset_;
    config.inputs = kProcessingChannels;
    config.outputs = kProcessingChannels;
    config.irChannels = kAssetChannels;
    config.irFrames = info.frames;
    config.pathCount = 4u;
    config.paths[0] = {0u, 0u, 0u};
    config.paths[1] = {0u, 1u, 1u};
    config.paths[2] = {1u, 0u, 2u};
    config.paths[3] = {1u, 1u, 3u};

    const std::uint64_t probeBytes = static_cast<std::uint64_t>(info.footprintBytes) +
                                     static_cast<std::uint64_t>(kAdmissionHeadroom);
    if (probeBytes > std::numeric_limits<std::size_t>::max()) {
      setAssetError(2u);
      return nullptr;
    }
    NothrowStorage<std::uint8_t> admissionProbe;
    if (!admissionProbe.allocate(static_cast<std::size_t>(probeBytes))) {
      setAssetError(2u);
      return nullptr;
    }
    admissionProbe.release();

    convolver_.clear();
    staging_payload_.release();
    wet_mix_ = 0.0F;
    replacement_dry_ready_ = false;
    if (!staging_payload_.allocate(info.byteSize / sizeof(float)) || !convolver_.reserve(config) ||
        convolver_.memoryBytes() + info.byteSize > info.footprintBytes) {
      setAssetError(2u);
      return nullptr;
    }
    begin_info_ = info;
    candidate_latency_ = info.headBlock + filterDelay(params_.filterDelaySamples);
    asset_state_ = ET_ASSET_STATE_STAGED;
    asset_reason_ = 0u;
    return reinterpret_cast<std::uint8_t *>(staging_payload_.data());
  }

  et_status commitAsset(std::uint32_t slot, std::uint32_t bytes,
                        std::uint32_t formatTag) noexcept override {
    if (slot != kAssetSlot || asset_state_ != ET_ASSET_STATE_STAGED ||
        bytes != begin_info_.byteSize || formatTag != ET_ASSET_F32_MULTICH || !validatePayload()) {
      setAssetError(1u);
      return ET_ERR_ARGS;
    }
    const float *samples = staging_payload_.data() + kAssetHeaderBytes / sizeof(float);
    if (!convolver_.commit(samples, begin_info_.channels, begin_info_.frames)) {
      setAssetError(3u);
      return ET_ERR_STATE;
    }
    previous_resident_latency_ = resident_asset_seen_ ? resident_latency_ : 0u;
    resident_latency_ = candidate_latency_;
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
    discardAssetState();
    asset_state_ = ET_ASSET_STATE_NONE;
    asset_reason_ = 0u;
  }

  [[nodiscard]] std::uint32_t assetState(std::uint32_t slot) const noexcept override {
    return slot == kAssetSlot ? asset_state_ | (asset_reason_ << 8u) |
                                    (replacement_dry_ready_ ? kReplacementDryReady : 0u)
                              : static_cast<std::uint32_t>(ET_ASSET_STATE_NONE);
  }

private:
  bool validateBegin(std::uint32_t slot, const AssetBeginInfo &info) const noexcept {
    if (slot != kAssetSlot || !prepared_ || info.topology != kTrueStereoTopology ||
        info.channels != kAssetChannels || info.processingChannels != kProcessingChannels ||
        info.frames == 0u || info.frames > kMaximumIrFrames ||
        !supportedHeadBlock(info.headBlock) || info.rateDivider != 1u || info.pathCount != 0u ||
        info.inputCount != 0u || info.footprintBytes < info.byteSize ||
        info.footprintBytes > kAssetCapacity || !(params_.filterDelaySamples >= 0.0F) ||
        params_.filterDelaySamples > static_cast<float>(kMaximumFilterDelay)) {
      return false;
    }
    const std::uint64_t expected = kAssetHeaderBytes + static_cast<std::uint64_t>(kAssetChannels) *
                                                           info.frames * sizeof(float);
    return expected == info.byteSize && expected <= kAssetCapacity &&
           (info.byteSize % sizeof(float)) == 0u;
  }

  bool validatePayload() const noexcept {
    const auto *bytes = reinterpret_cast<const std::uint8_t *>(staging_payload_.data());
    return readU32(bytes) == kAssetMagic && readU32(bytes + 4u) == kAssetChannels &&
           readU32(bytes + 8u) == begin_info_.frames &&
           readU32(bytes + 12u) == static_cast<std::uint32_t>(std::lround(sample_rate_)) &&
           readU32(bytes + 16u) == kTrueStereoTopology && readU32(bytes + 20u) == 0u &&
           readU32(bytes + 24u) == 0u && readU32(bytes + 28u) == 0u;
  }

  void setAssetError(std::uint32_t reason) noexcept {
    discardAssetState();
    asset_state_ = ET_ASSET_STATE_ERROR;
    asset_reason_ = reason;
  }

  void discardAssetState() noexcept {
    convolver_.clear();
    staging_payload_.release();
    dry_delay_.clear();
    delay_position_ = 0u;
    begin_info_ = {};
    candidate_latency_ = 0u;
    resident_latency_ = 0u;
    previous_resident_latency_ = 0u;
    latency_transition_remaining_ = 0u;
    stream_history_samples_ = 0u;
    resident_asset_seen_ = false;
    wet_mix_ = 0.0F;
    replacement_dry_ready_ = false;
  }

  void releaseStorage() noexcept {
    wet_audio_.release();
    dry_audio_.release();
    dry_delay_.release();
    blend_mix_.release();
    blend_gain_.release();
    staging_payload_.release();
  }

  void resetRuntime() noexcept {
    dry_audio_.clear();
    dry_delay_.clear();
    delay_position_ = 0u;
    strength_ = params_.strength * 0.01F;
    strength_target_ = strength_;
    strength_step_ = 0.0F;
    strength_remaining_ = 0u;
    strength_initialized_ = false;
    output_gain_ = decibelsToGain(params_.outputGain);
    output_gain_target_ = output_gain_;
    output_gain_step_ = 0.0F;
    output_gain_remaining_ = 0u;
    output_gain_initialized_ = false;
    wet_mix_ = 0.0F;
    replacement_dry_ready_ = false;
    latency_transition_remaining_ = 0u;
  }

  std::uint32_t smoothingFrames() const noexcept {
    const double frames = std::ceil(static_cast<double>(sample_rate_) * 0.005);
    return frames > 1.0 ? static_cast<std::uint32_t>(frames) : 1u;
  }

  void retargetStrength(float target) noexcept {
    if (target < 0.0F)
      target = 0.0F;
    else if (target > 1.0F)
      target = 1.0F;
    retargetRamp(target, strength_, strength_target_, strength_step_, strength_remaining_,
                 strength_initialized_);
  }

  void retargetOutputGain(float target) noexcept {
    retargetRamp(target, output_gain_, output_gain_target_, output_gain_step_,
                 output_gain_remaining_, output_gain_initialized_);
  }

  void retargetRamp(float target, float &current, float &currentTarget, float &step,
                    std::uint32_t &remaining, bool &initialized) noexcept {
    if (!initialized) {
      current = target;
      currentTarget = target;
      step = 0.0F;
      remaining = 0u;
      initialized = true;
      return;
    }
    if (target == currentTarget)
      return;
    currentTarget = target;
    remaining = smoothingFrames();
    step = (currentTarget - current) / static_cast<float>(remaining);
  }

  static float advanceRamp(float &current, float target, float &step,
                           std::uint32_t &remaining) noexcept {
    if (remaining == 0u)
      return current;
    current += step;
    if (--remaining == 0u) {
      current = target;
      step = 0.0F;
    }
    return current;
  }

  std::uint32_t activeResidentLatency() const noexcept {
    return latency_transition_remaining_ > kFadeFrames ? previous_resident_latency_
                                                       : resident_latency_;
  }

  float latencyTransitionGain() const noexcept {
    if (latency_transition_remaining_ == 0u)
      return 1.0F;
    if (latency_transition_remaining_ > kFadeFrames) {
      return static_cast<float>(latency_transition_remaining_ - kFadeFrames) /
             static_cast<float>(kFadeFrames);
    }
    return 1.0F -
           static_cast<float>(latency_transition_remaining_) / static_cast<float>(kFadeFrames);
  }

  float readDelay(const float *ring, std::uint32_t delay) const noexcept {
    if (delay >= delay_capacity_)
      delay = delay_capacity_ - 1u;
    const std::uint32_t readPosition = delay_position_ >= delay
                                           ? delay_position_ - delay
                                           : delay_capacity_ + delay_position_ - delay;
    return ring[readPosition];
  }

  void renderDryAndControls(const float *audio, std::uint32_t frameCount,
                            bool replacementDryRequested) noexcept {
    const float wetTarget =
        asset_state_ == ET_ASSET_STATE_ACTIVE && !replacementDryRequested ? 1.0F : 0.0F;
    for (std::uint32_t frame = 0u; frame < frameCount; ++frame) {
      if (wet_mix_ < wetTarget) {
        wet_mix_ += 1.0F / static_cast<float>(kFadeFrames);
        if (wet_mix_ > wetTarget)
          wet_mix_ = wetTarget;
      } else if (wet_mix_ > wetTarget) {
        wet_mix_ -= 1.0F / static_cast<float>(kFadeFrames);
        if (wet_mix_ < wetTarget)
          wet_mix_ = wetTarget;
      }
      const float strength =
          advanceRamp(strength_, strength_target_, strength_step_, strength_remaining_);
      const float outputGain =
          advanceRamp(output_gain_, output_gain_target_, output_gain_step_, output_gain_remaining_);
      blend_mix_.data()[frame] = wet_mix_ * strength;
      blend_gain_.data()[frame] = outputGain * latencyTransitionGain();
      const std::uint32_t delay = activeResidentLatency();
      for (std::uint32_t channel = 0u; channel < kProcessingChannels; ++channel) {
        const std::size_t audioIndex = static_cast<std::size_t>(channel) * frameCount + frame;
        const std::size_t ringBase = static_cast<std::size_t>(channel) * delay_capacity_;
        dry_delay_.data()[ringBase + delay_position_] = audio[audioIndex];
        dry_audio_.data()[audioIndex] = readDelay(dry_delay_.data() + ringBase, delay);
      }
      if (++delay_position_ == delay_capacity_)
        delay_position_ = 0u;
      if (latency_transition_remaining_ != 0u)
        --latency_transition_remaining_;
    }
  }

  void blendOutput(float *audio, std::uint32_t frameCount) noexcept {
    for (std::uint32_t channel = 0u; channel < kProcessingChannels; ++channel) {
      const std::size_t base = static_cast<std::size_t>(channel) * frameCount;
      std::uint32_t frame = 0u;
#if ET_XTC_WASM_SIMD
      for (; frame + 4u <= frameCount; frame += 4u) {
        const v128_t dry = wasm_v128_load(dry_audio_.data() + base + frame);
        const v128_t wet = wasm_v128_load(wet_audio_.data() + base + frame);
        const v128_t mix = wasm_v128_load(blend_mix_.data() + frame);
        const v128_t gain = wasm_v128_load(blend_gain_.data() + frame);
        const v128_t selected = wasm_f32x4_add(dry, wasm_f32x4_mul(mix, wasm_f32x4_sub(wet, dry)));
        wasm_v128_store(audio + base + frame, wasm_f32x4_mul(selected, gain));
      }
#endif
      for (; frame < frameCount; ++frame) {
        const float dry = dry_audio_.data()[base + frame];
        const float wet = wet_audio_.data()[base + frame];
        audio[base + frame] =
            (dry + blend_mix_.data()[frame] * (wet - dry)) * blend_gain_.data()[frame];
      }
    }
  }

  bool prepared_ = false;
  float sample_rate_ = 48000.0F;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t delay_capacity_ = 0u;
  std::uint32_t delay_position_ = 0u;
  std::uint32_t slice_offset_ = 0u;
  dsp::PartitionedConvolver convolver_;
  NothrowStorage<float> staging_payload_;
  NothrowStorage<float> wet_audio_;
  NothrowStorage<float> dry_audio_;
  NothrowStorage<float> dry_delay_;
  NothrowStorage<float> blend_mix_;
  NothrowStorage<float> blend_gain_;
  AssetBeginInfo begin_info_{};
  std::uint32_t asset_state_ = ET_ASSET_STATE_NONE;
  std::uint32_t asset_reason_ = 0u;
  std::uint32_t candidate_latency_ = 0u;
  std::uint32_t resident_latency_ = 0u;
  std::uint32_t previous_resident_latency_ = 0u;
  std::uint32_t latency_transition_remaining_ = 0u;
  std::uint64_t stream_history_samples_ = 0u;
  bool resident_asset_seen_ = false;
  bool replacement_dry_ready_ = false;
  float strength_ = 0.7F;
  float strength_target_ = 0.7F;
  float strength_step_ = 0.0F;
  std::uint32_t strength_remaining_ = 0u;
  bool strength_initialized_ = false;
  float output_gain_ = 1.0F;
  float output_gain_target_ = 1.0F;
  float output_gain_step_ = 0.0F;
  std::uint32_t output_gain_remaining_ = 0u;
  bool output_gain_initialized_ = false;
  float wet_mix_ = 0.0F;
};

static_assert(sizeof(CrosstalkCancellationKernel) <= 8192u);

} // namespace effetune::plugins::spatial

EFFETUNE_REGISTER_KERNEL(CrosstalkCancellationPlugin,
                         effetune::plugins::spatial::CrosstalkCancellationKernel)
