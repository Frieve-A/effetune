#include "effetune/kernel.h"
#include "IRReverbPluginParams.h"
#include "effetune/dsp/halfband.h"
#include "effetune/dsp/partitioned_convolver.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <new>

namespace effetune::plugins::reverb {
namespace {

constexpr std::uint32_t kAssetSlot = 0u;
constexpr std::uint32_t kAssetCapacity = 32u * 1024u * 1024u;
constexpr std::size_t kAssetAdmissionHeadroom = 1u * 1024u * 1024u;
constexpr std::uint32_t kAssetHeaderBytes = 32u;
constexpr std::uint32_t kAssetMagic = 0x31415445u;
constexpr std::uint32_t kAssetFormat = ET_ASSET_F32_MULTICH;
constexpr std::uint32_t kTopologyMono = 1u;
constexpr std::uint32_t kTopologyIndependent = 2u;
constexpr std::uint32_t kTopologyTrueStereo = 3u;
constexpr std::uint32_t kTopologyMatrix = 4u;
constexpr std::uint32_t kPathRecordBytes = 12u;
constexpr std::uint32_t kMaximumPaths = 8u;
constexpr std::uint32_t kFadeFrames = 128u;
constexpr std::uint32_t kMaximumChannels = 8u;
constexpr std::uint64_t kConvolverImplBytesUpperBound = 512u;
constexpr std::uint64_t kConvolverStageBytesUpperBound = 512u;
constexpr std::uint64_t kPffftSetupFixedBytesUpperBound = 136u;

std::uint32_t readU32(const std::uint8_t *bytes) noexcept {
  return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8u) |
         (static_cast<std::uint32_t>(bytes[2]) << 16u) |
         (static_cast<std::uint32_t>(bytes[3]) << 24u);
}

float decibelsToGain(float decibels) noexcept { return std::pow(10.0F, decibels * 0.05F); }

std::uint64_t nextPowerOfTwo(std::uint64_t value) noexcept {
  std::uint64_t result = 1u;
  while (result < value)
    result *= 2u;
  return result;
}

void addConvolverStageEstimate(const dsp::ConvolverConfig &config, std::uint32_t block,
                               std::uint32_t offset, std::uint32_t end, std::uint64_t &requiredRing,
                               std::uint64_t &bytes) noexcept {
  if (offset >= config.irFrames || end <= offset)
    return;
  const std::uint32_t clippedEnd = end < config.irFrames ? end : config.irFrames;
  const std::uint64_t segmentFrames = clippedEnd - offset;
  const std::uint64_t fft = 2u * static_cast<std::uint64_t>(block);
  const std::uint64_t partitions = (segmentFrames + block - 1u) / block;
  const std::uint64_t floatCount =
      3u * static_cast<std::uint64_t>(config.inputs) * block + 2u * fft +
      (config.inputs + config.irChannels) * partitions * fft + 2u * config.outputs * fft;
  bytes += kConvolverStageBytesUpperBound + floatCount * sizeof(float) +
           nextPowerOfTwo(config.pathCount) * kPathRecordBytes + kPffftSetupFixedBytesUpperBound +
           fft * sizeof(float);
  const std::uint64_t required = config.latencySamples + offset + block + 4096u;
  if (required > requiredRing)
    requiredRing = required;
}

std::uint64_t estimateConvolverMemoryUpperBound(const dsp::ConvolverConfig &config) noexcept {
  const std::uint32_t headBlock = config.latencySamples == 0u ? 128u : config.latencySamples;
  std::uint64_t requiredRing = config.latencySamples + 4096u;
  std::uint64_t bytes = kConvolverImplBytesUpperBound;
  addConvolverStageEstimate(config, headBlock, config.latencySamples == 0u ? 128u : 0u,
                            4u * headBlock, requiredRing, bytes);
  for (std::uint32_t block = 2u * headBlock; block < 4096u; block *= 2u) {
    addConvolverStageEstimate(config, block, 2u * block, 4u * block, requiredRing, bytes);
  }
  addConvolverStageEstimate(config, 4096u, 8192u, config.irFrames, requiredRing, bytes);
  bytes +=
      static_cast<std::uint64_t>(config.outputs) * nextPowerOfTwo(requiredRing) * sizeof(float);
  if (config.latencySamples == 0u) {
    bytes += static_cast<std::uint64_t>(config.irChannels + config.inputs) * 128u * sizeof(float);
  }
  bytes += static_cast<std::uint64_t>(config.inputs) * sizeof(float);
  return bytes;
}

template <typename T> class NothrowStorage {
public:
  NothrowStorage() = default;
  ~NothrowStorage() { delete[] data_; }
  NothrowStorage(const NothrowStorage &) = delete;
  NothrowStorage &operator=(const NothrowStorage &) = delete;

  bool allocate(std::size_t count) noexcept {
    delete[] data_;
    data_ = nullptr;
    count_ = 0u;
    if (count == 0u)
      return true;
    data_ = new (std::nothrow) T[count];
    if (data_ == nullptr)
      return false;
    count_ = count;
    return true;
  }
  void release() noexcept {
    delete[] data_;
    data_ = nullptr;
    count_ = 0u;
  }
  [[nodiscard]] T *data() noexcept { return data_; }
  [[nodiscard]] const T *data() const noexcept { return data_; }
  [[nodiscard]] T *begin() noexcept { return data_; }
  [[nodiscard]] T *end() noexcept { return data_ + count_; }
  [[nodiscard]] const T *begin() const noexcept { return data_; }
  [[nodiscard]] const T *end() const noexcept { return data_ + count_; }
  [[nodiscard]] T &operator[](std::size_t index) noexcept { return data_[index]; }
  [[nodiscard]] const T &operator[](std::size_t index) const noexcept { return data_[index]; }
  void clear() noexcept {
    if (data_ != nullptr)
      std::memset(data_, 0, count_ * sizeof(T));
  }

private:
  T *data_ = nullptr;
  std::size_t count_ = 0u;
};

using StagingPayload = NothrowStorage<float>;

} // namespace

class IRReverbKernel final : public PluginKernel {
  EFFETUNE_PARAMS(generated::IRReverbPluginParams)

public:
  static std::uint32_t assetCapacityForSlot(std::uint32_t slot) noexcept {
    return slot == kAssetSlot ? kAssetCapacity : 0u;
  }

  void prepare(const PrepareInfo &info) noexcept override {
    prepared_ = false;
    releaseFixedStorage();
    sample_rate_ = info.sampleRate;
    max_channels_ = info.maxChannels;
    max_frames_ = info.maxFrames;
    const double maximum_delay = std::ceil(static_cast<double>(sample_rate_) * 0.5);
    pre_delay_length_ = maximum_delay < 1.0 ? 1u : static_cast<std::uint32_t>(maximum_delay) + 1u;
    wet_fifo_capacity_ = max_frames_ * 4u + 8u;
    if (!full_rate_audio_.allocate(static_cast<std::size_t>(max_channels_) * max_frames_) ||
        !decimators_.allocate(static_cast<std::size_t>(max_channels_) * 2u) ||
        !interpolators_.allocate(static_cast<std::size_t>(max_channels_) * 2u) ||
        !pre_delay_.allocate(static_cast<std::size_t>(max_channels_) * pre_delay_length_) ||
        !pre_delay_positions_.allocate(max_channels_) ||
        !wet_fifo_.allocate(static_cast<std::size_t>(max_channels_) * wet_fifo_capacity_)) {
      releaseFixedStorage();
      max_channels_ = 0u;
      max_frames_ = 0u;
      return;
    }
    prepared_ = true;
    clearAsset(kAssetSlot);
    resetRuntimeState();
  }

  [[nodiscard]] bool preparedSuccessfully() const noexcept override { return prepared_; }

  void reset() noexcept override {
    convolver_.reset();
    resetRuntimeState();
    wet_fade_out_remaining_ = 0u;
    wet_fade_in_remaining_ = 0u;
    last_wet_.fill(0.0F);
  }

  void setRandomSeed(std::uint32_t seedLow, std::uint32_t seedHigh) noexcept override {
    slice_offset_ = seedLow ^ (seedHigh << 16u | seedHigh >> 16u);
  }

  void process(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
               const ProcessInfo &) noexcept override {
    if (!prepared_ || audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
        frame_count == 0u || frame_count > max_frames_) {
      return;
    }

    const MixParameters mix = currentMixParameters();
    if (asset_state_ == ET_ASSET_STATE_PREPARING) {
      if (rate_divider_ == 1u) {
        processFullRate(audio, channel_count, frame_count, mix,
                        channel_count == processing_channels_);
      } else {
        processReducedRate(audio, channel_count, frame_count, mix,
                           channel_count == processing_channels_);
      }
      return;
    }
    if (asset_state_ != ET_ASSET_STATE_ACTIVE) {
      applyDryWithWetFadeOut(audio, channel_count, frame_count, mix);
      return;
    }
    if (channel_count != processing_channels_) {
      applyDryOnly(audio, channel_count, frame_count, mix);
      return;
    }
    if (rate_divider_ == 1u) {
      processFullRate(audio, channel_count, frame_count, mix, true);
    } else {
      processReducedRate(audio, channel_count, frame_count, mix, true);
    }
  }

  [[nodiscard]] std::uint32_t latencySamples() const noexcept override {
    if (asset_state_ == ET_ASSET_STATE_NONE || asset_state_ == ET_ASSET_STATE_ERROR)
      return 0u;
    const std::uint32_t convolution = convolver_.latencySamples() * rate_divider_;
    const std::uint32_t resampler =
        rate_divider_ == 1u
            ? 0u
            : 2u * static_cast<std::uint32_t>(dsp::Halfband2x::kLatency) * (rate_divider_ - 1u);
    return convolution + resampler;
  }

  [[nodiscard]] std::uint32_t assetCapacity(std::uint32_t slot) const noexcept override {
    return assetCapacityForSlot(slot);
  }

  std::uint8_t *beginAsset(std::uint32_t slot, const AssetBeginInfo &info) noexcept override {
    if (!validateBegin(slot, info))
      return nullptr;

    dsp::ConvolverConfig config;
    config.latencySamples = info.headBlock;
    config.sliceOffset = slice_offset_;
    config.inputs =
        info.topology == kTopologyTrueStereo
            ? 2u
            : (info.topology == kTopologyMatrix ? info.inputCount : info.processingChannels);
    config.outputs = info.processingChannels;
    config.irChannels = info.channels;
    config.irFrames = info.frames;
    if (info.topology == kTopologyMono) {
      config.pathCount = info.processingChannels;
      for (std::uint32_t channel = 0u; channel < config.pathCount; ++channel)
        config.paths[channel] = {channel, channel, 0u};
    } else if (info.topology == kTopologyIndependent) {
      config.pathCount = info.channels;
      for (std::uint32_t channel = 0u; channel < info.channels; ++channel)
        config.paths[channel] = {channel, channel, channel};
    } else if (info.topology == kTopologyTrueStereo) {
      config.pathCount = 4u;
      config.paths[0u] = {0u, 0u, 0u};
      config.paths[1u] = {0u, 1u, 1u};
      config.paths[2u] = {1u, 0u, 2u};
      config.paths[3u] = {1u, 1u, 3u};
    } else {
      config.pathCount = info.pathCount;
      for (std::uint32_t path = 0u; path < info.pathCount; ++path) {
        config.paths[path] = {path % info.inputCount, path % info.processingChannels,
                              path % info.channels};
      }
    }

    const std::uint64_t requiredFootprint =
        static_cast<std::uint64_t>(info.byteSize) + estimateConvolverMemoryUpperBound(config);
    if (requiredFootprint > info.footprintBytes || requiredFootprint > kAssetCapacity)
      return nullptr;

    const std::uint64_t probeBytes =
        static_cast<std::uint64_t>(info.footprintBytes) + kAssetAdmissionHeadroom;
    if (probeBytes > std::numeric_limits<std::size_t>::max())
      return nullptr;
    NothrowStorage<std::uint8_t> admissionProbe;
    if (!admissionProbe.allocate(static_cast<std::size_t>(probeBytes)))
      return nullptr;
    admissionProbe.release();

    beginWetMute();
    convolver_.clear();
    staging_payload_.release();
    if (!staging_payload_.allocate(info.byteSize / sizeof(float)) || !convolver_.reserve(config) ||
        convolver_.memoryBytes() + info.byteSize > info.footprintBytes) {
      convolver_.clear();
      staging_payload_.release();
      setAssetError(2u);
      return nullptr;
    }

    begin_info_ = info;
    processing_channels_ = info.processingChannels;
    rate_divider_ = info.rateDivider;
    asset_state_ = ET_ASSET_STATE_STAGED;
    asset_reason_ = 0u;
    resetRuntimeState();
    return reinterpret_cast<std::uint8_t *>(staging_payload_.data());
  }

  et_status commitAsset(std::uint32_t slot, std::uint32_t bytes,
                        std::uint32_t format_tag) noexcept override {
    if (slot != kAssetSlot || asset_state_ != ET_ASSET_STATE_STAGED ||
        bytes != begin_info_.byteSize || format_tag != kAssetFormat || !validatePayload()) {
      convolver_.clear();
      setAssetError(1u);
      return ET_ERR_ARGS;
    }
    const std::uint32_t pathTableBytes =
        begin_info_.topology == kTopologyMatrix ? begin_info_.pathCount * kPathRecordBytes : 0u;
    if (begin_info_.topology == kTopologyMatrix) {
      std::array<dsp::ConvolutionPath, kMaximumPaths> paths{};
      if (!decodeMatrixPaths(paths) ||
          !convolver_.updatePathsWithoutAllocation(paths.data(), begin_info_.pathCount)) {
        convolver_.clear();
        setAssetError(1u);
        return ET_ERR_ARGS;
      }
    }
    const float *samples =
        staging_payload_.data() + (kAssetHeaderBytes + pathTableBytes) / sizeof(float);
    if (!convolver_.commit(samples, begin_info_.channels, begin_info_.frames)) {
      convolver_.clear();
      setAssetError(3u);
      return ET_ERR_STATE;
    }
    asset_state_ = ET_ASSET_STATE_PREPARING;
    asset_reason_ = 0u;
    return ET_OK;
  }

  void clearAsset(std::uint32_t slot) noexcept override {
    if (slot != kAssetSlot)
      return;
    if (asset_state_ != ET_ASSET_STATE_NONE)
      beginWetMute();
    convolver_.clear();
    staging_payload_.release();
    asset_state_ = ET_ASSET_STATE_NONE;
    asset_reason_ = 0u;
    rate_divider_ = 1u;
    resetRuntimeState();
  }

  [[nodiscard]] std::uint32_t assetState(std::uint32_t slot) const noexcept override {
    return slot == kAssetSlot ? asset_state_ | (asset_reason_ << 8u)
                              : static_cast<std::uint32_t>(ET_ASSET_STATE_NONE);
  }

private:
  struct MixParameters {
    float dryGain;
    float wetGain;
    std::uint32_t preDelayFrames;
  };

  void releaseFixedStorage() noexcept {
    full_rate_audio_.release();
    decimators_.release();
    interpolators_.release();
    pre_delay_.release();
    pre_delay_positions_.release();
    wet_fifo_.release();
  }

  [[nodiscard]] MixParameters currentMixParameters() const noexcept {
    const double requested = static_cast<double>(params_.preDelay) * sample_rate_ * 0.001;
    std::uint32_t delay = requested > 0.0 ? static_cast<std::uint32_t>(requested) : 0u;
    if (delay >= pre_delay_length_)
      delay = pre_delay_length_ - 1u;
    return {params_.dryLevel <= -96.0F ? 0.0F : decibelsToGain(params_.dryLevel),
            decibelsToGain(params_.wetLevel), delay};
  }

  bool validateBegin(std::uint32_t slot, const AssetBeginInfo &info) const noexcept {
    if (slot != kAssetSlot || sample_rate_ <= 0.0F || max_channels_ == 0u || info.channels == 0u ||
        info.channels > kMaximumChannels || info.frames == 0u ||
        (info.topology != kTopologyMono && info.topology != kTopologyIndependent &&
         info.topology != kTopologyTrueStereo && info.topology != kTopologyMatrix) ||
        (info.topology == kTopologyMono && info.channels != 1u) || info.processingChannels == 0u ||
        info.processingChannels > max_channels_ || info.footprintBytes < info.byteSize ||
        info.footprintBytes > kAssetCapacity ||
        (info.topology == kTopologyIndependent && info.channels != info.processingChannels) ||
        (info.topology == kTopologyTrueStereo &&
         (info.channels != 4u || info.processingChannels != 2u)) ||
        (info.headBlock != 0u && info.headBlock != 128u && info.headBlock != 256u &&
         info.headBlock != 512u && info.headBlock != 1024u) ||
        (info.rateDivider != 1u && info.rateDivider != 2u && info.rateDivider != 4u) ||
        (info.headBlock == 0u && info.rateDivider != 1u)) {
      return false;
    }
    if (info.topology == kTopologyMatrix) {
      if (info.pathCount == 0u || info.pathCount > kMaximumPaths || info.inputCount == 0u ||
          info.inputCount > info.pathCount || info.inputCount > info.processingChannels)
        return false;
    } else if (info.pathCount != 0u || info.inputCount != 0u) {
      return false;
    }
    const std::uint64_t pathTableBytes =
        info.topology == kTopologyMatrix
            ? static_cast<std::uint64_t>(info.pathCount) * kPathRecordBytes
            : 0u;
    const std::uint64_t expected =
        kAssetHeaderBytes + pathTableBytes +
        static_cast<std::uint64_t>(info.channels) * info.frames * sizeof(float);
    return expected == info.byteSize && expected <= kAssetCapacity &&
           (info.byteSize % sizeof(float)) == 0u;
  }

  bool validatePayload() const noexcept {
    const auto *bytes = reinterpret_cast<const std::uint8_t *>(staging_payload_.data());
    const std::uint32_t expected_rate =
        static_cast<std::uint32_t>(std::lround(sample_rate_ / rate_divider_));
    return readU32(bytes) == kAssetMagic && readU32(bytes + 4u) == begin_info_.channels &&
           readU32(bytes + 8u) == begin_info_.frames && readU32(bytes + 12u) == expected_rate &&
           readU32(bytes + 16u) == begin_info_.topology &&
           readU32(bytes + 20u) ==
               (begin_info_.topology == kTopologyMatrix ? begin_info_.pathCount : 0u) &&
           readU32(bytes + 24u) == 0u && readU32(bytes + 28u) == 0u;
  }

  bool decodeMatrixPaths(std::array<dsp::ConvolutionPath, kMaximumPaths> &paths) const noexcept {
    const auto *bytes =
        reinterpret_cast<const std::uint8_t *>(staging_payload_.data()) + kAssetHeaderBytes;
    std::array<bool, kMaximumChannels> inputs{};
    std::uint32_t distinctInputs = 0u;
    for (std::uint32_t index = 0u; index < begin_info_.pathCount; ++index) {
      const std::uint8_t *record = bytes + index * kPathRecordBytes;
      const dsp::ConvolutionPath path{readU32(record), readU32(record + 4u), readU32(record + 8u)};
      if (path.input >= begin_info_.inputCount || path.output >= max_channels_ ||
          path.output >= begin_info_.processingChannels || path.irChannel >= begin_info_.channels)
        return false;
      paths[index] = path;
      if (!inputs[path.input]) {
        inputs[path.input] = true;
        ++distinctInputs;
      }
    }
    return distinctInputs == begin_info_.inputCount;
  }

  void setAssetError(std::uint32_t reason) noexcept {
    staging_payload_.clear();
    asset_state_ = ET_ASSET_STATE_ERROR;
    asset_reason_ = reason;
    resetRuntimeState();
  }

  void beginWetMute() noexcept {
    wet_fade_out_remaining_ = kFadeFrames;
    wet_fade_in_remaining_ = 0u;
  }

  void updatePreparationState() noexcept {
    if (asset_state_ == ET_ASSET_STATE_PREPARING &&
        convolver_.state() == dsp::ConvolverPreparationState::active) {
      asset_state_ = ET_ASSET_STATE_ACTIVE;
      wet_fade_in_remaining_ = kFadeFrames;
    }
  }

  void resetRuntimeState() noexcept {
    for (dsp::Halfband2x &filter : decimators_)
      filter.reset();
    for (dsp::Halfband2x &filter : interpolators_)
      filter.reset();
    std::fill(pre_delay_.begin(), pre_delay_.end(), 0.0F);
    std::fill(pre_delay_positions_.begin(), pre_delay_positions_.end(), 0u);
    std::fill(wet_fifo_.begin(), wet_fifo_.end(), 0.0F);
    wet_fifo_read_ = 0u;
    wet_fifo_write_ = 0u;
    wet_fifo_size_ = 0u;
  }

  void processFullRate(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                       const MixParameters &mix, bool wet_allowed) noexcept {
    for (std::uint32_t channel = 0u; channel < processing_channels_; ++channel) {
      float *target = full_rate_audio_.data() + static_cast<std::size_t>(channel) * frame_count;
      if (channel < channel_count) {
        std::memcpy(target, audio + static_cast<std::size_t>(channel) * frame_count,
                    frame_count * sizeof(float));
      } else {
        std::memset(target, 0, frame_count * sizeof(float));
      }
    }
    if (asset_state_ == ET_ASSET_STATE_PREPARING) {
      for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
        for (std::uint32_t channel = 0u; channel < processing_channels_; ++channel) {
          conv_frame_[channel] =
              full_rate_audio_[static_cast<std::size_t>(channel) * frame_count + frame];
        }
        convolver_.process(conv_frame_.data(), processing_channels_, 1u);
        updatePreparationState();
        if (wet_allowed && asset_state_ == ET_ASSET_STATE_ACTIVE) {
          for (std::uint32_t channel = 0u; channel < channel_count; ++channel)
            wet_frame_[channel] = conv_frame_[channel];
          mixFrame(audio, channel_count, frame_count, frame, mix);
        } else {
          mixDryWithWetFadeOutFrame(audio, channel_count, frame_count, frame, mix);
        }
      }
      return;
    }
    convolver_.process(full_rate_audio_.data(), processing_channels_, frame_count);
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
        wet_frame_[channel] =
            full_rate_audio_[static_cast<std::size_t>(channel) * frame_count + frame];
      }
      mixFrame(audio, channel_count, frame_count, frame, mix);
    }
  }

  void processReducedRate(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                          const MixParameters &mix, bool wet_allowed) noexcept {
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      bool low_ready = false;
      for (std::uint32_t channel = 0u; channel < processing_channels_; ++channel) {
        const float input = channel < channel_count
                                ? audio[static_cast<std::size_t>(channel) * frame_count + frame]
                                : 0.0F;
        float first_stage = 0.0F;
        bool produced = decimator(channel, 0u).decimate(input, first_stage);
        if (rate_divider_ == 4u && produced)
          produced = decimator(channel, 1u).decimate(first_stage, conv_frame_[channel]);
        else if (produced)
          conv_frame_[channel] = first_stage;
        if (channel == 0u)
          low_ready = produced;
      }
      if (low_ready) {
        convolver_.process(conv_frame_.data(), processing_channels_, 1u);
        updatePreparationState();
        if (wet_allowed && asset_state_ == ET_ASSET_STATE_ACTIVE)
          interpolateAndQueue();
      }
      if (wet_allowed && asset_state_ == ET_ASSET_STATE_ACTIVE) {
        popWetFrame();
        mixFrame(audio, channel_count, frame_count, frame, mix);
      } else {
        mixDryWithWetFadeOutFrame(audio, channel_count, frame_count, frame, mix);
      }
    }
  }

  dsp::Halfband2x &decimator(std::uint32_t channel, std::uint32_t stage) noexcept {
    return decimators_[static_cast<std::size_t>(channel) * 2u + stage];
  }

  dsp::Halfband2x &interpolator(std::uint32_t channel, std::uint32_t stage) noexcept {
    return interpolators_[static_cast<std::size_t>(channel) * 2u + stage];
  }

  void interpolateAndQueue() noexcept {
    std::array<std::array<float, kMaximumChannels>, 4> generated{};
    const float rate_gain = rate_divider_ == 4u ? 2.0F : 1.41421356237F;
    if (rate_divider_ == 2u) {
      for (std::uint32_t channel = 0u; channel < processing_channels_; ++channel) {
        interpolator(channel, 0u)
            .interpolate(conv_frame_[channel] * rate_gain, generated[0u][channel],
                         generated[1u][channel]);
      }
      pushWetFrame(generated[0u]);
      pushWetFrame(generated[1u]);
      return;
    }

    for (std::uint32_t channel = 0u; channel < processing_channels_; ++channel) {
      float first = 0.0F;
      float second = 0.0F;
      interpolator(channel, 1u).interpolate(conv_frame_[channel] * rate_gain, first, second);
      interpolator(channel, 0u).interpolate(first, generated[0u][channel], generated[1u][channel]);
      interpolator(channel, 0u).interpolate(second, generated[2u][channel], generated[3u][channel]);
    }
    for (const auto &frame : generated)
      pushWetFrame(frame);
  }

  void pushWetFrame(const std::array<float, kMaximumChannels> &frame) noexcept {
    if (wet_fifo_size_ == wet_fifo_capacity_)
      return;
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      wet_fifo_[static_cast<std::size_t>(channel) * wet_fifo_capacity_ + wet_fifo_write_] =
          frame[channel];
    }
    ++wet_fifo_write_;
    if (wet_fifo_write_ == wet_fifo_capacity_)
      wet_fifo_write_ = 0u;
    ++wet_fifo_size_;
  }

  void popWetFrame() noexcept {
    if (wet_fifo_size_ == 0u) {
      wet_frame_.fill(0.0F);
      return;
    }
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      wet_frame_[channel] =
          wet_fifo_[static_cast<std::size_t>(channel) * wet_fifo_capacity_ + wet_fifo_read_];
    }
    ++wet_fifo_read_;
    if (wet_fifo_read_ == wet_fifo_capacity_)
      wet_fifo_read_ = 0u;
    --wet_fifo_size_;
  }

  float applyPreDelay(std::uint32_t channel, float wet, std::uint32_t delay) noexcept {
    float *buffer = pre_delay_.data() + static_cast<std::size_t>(channel) * pre_delay_length_;
    std::uint32_t &position = pre_delay_positions_[channel];
    float output = wet;
    if (delay != 0u) {
      const std::uint32_t read =
          position >= delay ? position - delay : position + pre_delay_length_ - delay;
      output = buffer[read];
    }
    buffer[position] = wet;
    ++position;
    if (position == pre_delay_length_)
      position = 0u;
    return output;
  }

  void applyDryOnly(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                    const MixParameters &mix) noexcept {
    const std::size_t samples = static_cast<std::size_t>(channel_count) * frame_count;
    if (mix.dryGain == 0.0F) {
      std::memset(audio, 0, samples * sizeof(float));
      return;
    }
    for (std::size_t index = 0u; index < samples; ++index)
      audio[index] *= mix.dryGain;
  }

  void applyDryWithWetFadeOut(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                              const MixParameters &mix) noexcept {
    if (wet_fade_out_remaining_ == 0u) {
      applyDryOnly(audio, channel_count, frame_count, mix);
      return;
    }
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      mixDryWithWetFadeOutFrame(audio, channel_count, frame_count, frame, mix);
    }
  }

  void mixDryWithWetFadeOutFrame(float *audio, std::uint32_t channel_count,
                                 std::uint32_t frame_count, std::uint32_t frame,
                                 const MixParameters &mix) noexcept {
    const float fade = wet_fade_out_remaining_ == 0u
                           ? 0.0F
                           : static_cast<float>(wet_fade_out_remaining_) / kFadeFrames;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
      const float dry = audio[index] * mix.dryGain;
      audio[index] = dry + last_wet_[channel] * fade * mix.wetGain;
    }
    if (wet_fade_out_remaining_ != 0u) {
      --wet_fade_out_remaining_;
      if (wet_fade_out_remaining_ == 0u)
        last_wet_.fill(0.0F);
    }
  }

  void mixFrame(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                std::uint32_t frame, const MixParameters &mix) noexcept {
    const float fade_in = wet_fade_in_remaining_ == 0u
                              ? 1.0F
                              : 1.0F - static_cast<float>(wet_fade_in_remaining_) / kFadeFrames;
    for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
      const std::size_t index = static_cast<std::size_t>(channel) * frame_count + frame;
      float wet = wet_frame_[channel];
      if (wet_fade_in_remaining_ != 0u)
        wet *= fade_in;
      wet = applyPreDelay(channel, wet, mix.preDelayFrames);
      audio[index] = audio[index] * mix.dryGain + wet * mix.wetGain;
      last_wet_[channel] = wet;
    }
    if (wet_fade_in_remaining_ != 0u)
      --wet_fade_in_remaining_;
  }

  float sample_rate_ = 0.0F;
  std::uint32_t max_channels_ = 0u;
  std::uint32_t max_frames_ = 0u;
  std::uint32_t pre_delay_length_ = 1u;
  std::uint32_t wet_fifo_capacity_ = 1u;
  std::uint32_t wet_fifo_read_ = 0u;
  std::uint32_t wet_fifo_write_ = 0u;
  std::uint32_t wet_fifo_size_ = 0u;
  std::uint32_t rate_divider_ = 1u;
  std::uint32_t processing_channels_ = 1u;
  std::uint32_t slice_offset_ = 0u;
  std::uint32_t asset_state_ = ET_ASSET_STATE_NONE;
  std::uint32_t asset_reason_ = 0u;
  std::uint32_t wet_fade_out_remaining_ = 0u;
  std::uint32_t wet_fade_in_remaining_ = 0u;
  bool prepared_ = false;
  AssetBeginInfo begin_info_{};
  dsp::PartitionedConvolver convolver_{};
  StagingPayload staging_payload_;
  NothrowStorage<float> full_rate_audio_;
  NothrowStorage<dsp::Halfband2x> decimators_;
  NothrowStorage<dsp::Halfband2x> interpolators_;
  NothrowStorage<float> pre_delay_;
  NothrowStorage<std::uint32_t> pre_delay_positions_;
  NothrowStorage<float> wet_fifo_;
  std::array<float, kMaximumChannels> conv_frame_{};
  std::array<float, kMaximumChannels> wet_frame_{};
  std::array<float, kMaximumChannels> last_wet_{};
};

static_assert(sizeof(IRReverbKernel) <= 8192u);

} // namespace effetune::plugins::reverb

EFFETUNE_REGISTER_KERNEL(IRReverbPlugin, effetune::plugins::reverb::IRReverbKernel)
