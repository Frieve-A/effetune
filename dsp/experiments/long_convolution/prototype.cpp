#include "prototype.h"

#include <pffft.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <new>
#include <utility>

namespace effetune::experiments::long_convolution {
namespace {

constexpr std::uint32_t kDirectHead = 128u;
constexpr std::uint32_t kTailRatio = 32u;
constexpr std::uint32_t kLadderMaximum = 4096u;

class AlignedFloats {
public:
  AlignedFloats() = default;
  explicit AlignedFloats(std::size_t count) { resize(count); }
  ~AlignedFloats() { pffft_aligned_free(data_); }
  AlignedFloats(const AlignedFloats &) = delete;
  AlignedFloats &operator=(const AlignedFloats &) = delete;
  AlignedFloats(AlignedFloats &&other) noexcept
      : data_(std::exchange(other.data_, nullptr)), count_(std::exchange(other.count_, 0u)) {}
  AlignedFloats &operator=(AlignedFloats &&other) noexcept {
    if (this != &other) {
      pffft_aligned_free(data_);
      data_ = std::exchange(other.data_, nullptr);
      count_ = std::exchange(other.count_, 0u);
    }
    return *this;
  }

  void resize(std::size_t count) {
    pffft_aligned_free(data_);
    data_ = nullptr;
    count_ = 0u;
    if (count == 0u)
      return;
    data_ = static_cast<float *>(pffft_aligned_malloc(count * sizeof(float)));
    if (data_ == nullptr)
      throw std::bad_alloc();
    count_ = count;
    clear();
  }
  void clear() noexcept {
    if (data_ != nullptr)
      std::memset(data_, 0, count_ * sizeof(float));
  }
  [[nodiscard]] float *data() noexcept { return data_; }
  [[nodiscard]] const float *data() const noexcept { return data_; }
  [[nodiscard]] std::size_t size() const noexcept { return count_; }
  [[nodiscard]] std::size_t bytes() const noexcept { return count_ * sizeof(float); }
  float &operator[](std::size_t index) noexcept { return data_[index]; }
  const float &operator[](std::size_t index) const noexcept { return data_[index]; }

private:
  float *data_ = nullptr;
  std::size_t count_ = 0u;
};

std::uint32_t nextPowerOfTwo(std::uint32_t value) noexcept {
  if (value <= 1u)
    return 1u;
  --value;
  value |= value >> 1u;
  value |= value >> 2u;
  value |= value >> 4u;
  value |= value >> 8u;
  value |= value >> 16u;
  return value + 1u;
}

class PartitionStage {
public:
  PartitionStage(std::uint32_t blockSize, std::uint32_t offset, std::uint32_t segmentFrames,
                 std::uint32_t stageIndex, const Config &config,
                 const std::vector<std::vector<float>> &irChannels)
      : block_size_(blockSize), fft_size_(2u * blockSize), offset_(offset),
        partitions_((segmentFrames + blockSize - 1u) / blockSize), inputs_(config.inputs),
        outputs_(config.outputs), paths_(config.paths),
        amortized_(config.stageRole != StageRole::deferredTail && blockSize >= 256u &&
                   offset >= 2u * blockSize),
        phase_seed_(config.sliceOffset + offset / 128u + stageIndex * 5u),
        setup_(pffft_new_setup(static_cast<int>(fft_size_), PFFFT_REAL)),
        input_blocks_(static_cast<std::size_t>(inputs_) * block_size_),
        job_blocks_(static_cast<std::size_t>(inputs_) * block_size_),
        previous_blocks_(static_cast<std::size_t>(inputs_) * block_size_), fft_input_(fft_size_),
        fft_work_(fft_size_),
        input_fdl_(static_cast<std::size_t>(inputs_) * partitions_ * fft_size_),
        ir_spectra_(static_cast<std::size_t>(paths_.size()) * partitions_ * fft_size_),
        accumulators_(static_cast<std::size_t>(outputs_) * fft_size_),
        inverse_(static_cast<std::size_t>(outputs_) * fft_size_) {
    if (setup_ == nullptr)
      throw std::bad_alloc();
    prepareIr(segmentFrames, irChannels);
  }

  ~PartitionStage() { pffft_destroy_setup(setup_); }
  PartitionStage(const PartitionStage &) = delete;
  PartitionStage &operator=(const PartitionStage &) = delete;

  void reset() noexcept {
    input_blocks_.clear();
    job_blocks_.clear();
    previous_blocks_.clear();
    input_fdl_.clear();
    accumulators_.clear();
    inverse_.clear();
    fill_ = 0u;
    fdl_write_ = 0u;
    blocks_processed_ = 0u;
    job_active_ = false;
    job_window_slice_ = 0u;
    job_slice_samples_ = 0u;
    job_mac_units_ = 0u;
  }

  void push(const float *inputFrame, AlignedFloats &outputRing, std::uint32_t ringSize,
            std::uint32_t latency) noexcept {
    for (std::uint32_t input = 0u; input < inputs_; ++input) {
      input_blocks_[static_cast<std::size_t>(input) * block_size_ + fill_] = inputFrame[input];
    }
    ++fill_;
    if (job_active_) {
      ++job_slice_samples_;
      if (job_slice_samples_ == 128u) {
        job_slice_samples_ = 0u;
        ++job_window_slice_;
        runScheduledSlice(outputRing, ringSize, latency);
      }
    }
    if (fill_ == block_size_) {
      if (amortized_)
        startScheduledBlock(outputRing, ringSize, latency);
      else {
        renderBlock(outputRing, ringSize, latency);
        ++blocks_processed_;
      }
      fill_ = 0u;
    }
  }

  [[nodiscard]] std::size_t memoryBytes() const noexcept {
    return input_blocks_.bytes() + job_blocks_.bytes() + previous_blocks_.bytes() +
           fft_work_.bytes() + input_fdl_.bytes() + ir_spectra_.bytes() + accumulators_.bytes() +
           inverse_.bytes();
  }
  [[nodiscard]] std::uint32_t blockSize() const noexcept { return block_size_; }
  [[nodiscard]] std::uint32_t offset() const noexcept { return offset_; }

private:
  void prepareIr(std::uint32_t segmentFrames, const std::vector<std::vector<float>> &irChannels) {
    for (std::size_t pathIndex = 0u; pathIndex < paths_.size(); ++pathIndex) {
      const Path &path = paths_[pathIndex];
      if (path.irChannel >= irChannels.size())
        throw std::bad_alloc();
      const std::vector<float> &ir = irChannels[path.irChannel];
      for (std::uint32_t partition = 0u; partition < partitions_; ++partition) {
        fft_input_.clear();
        const std::uint32_t partitionOffset = partition * block_size_;
        const std::uint32_t remaining =
            segmentFrames > partitionOffset ? segmentFrames - partitionOffset : 0u;
        const std::uint32_t copyFrames = remaining < block_size_ ? remaining : block_size_;
        for (std::uint32_t frame = 0u; frame < copyFrames; ++frame) {
          const std::size_t irIndex = static_cast<std::size_t>(offset_) + partitionOffset + frame;
          if (irIndex < ir.size())
            fft_input_[frame] = ir[irIndex];
        }
        float *spectrum = ir_spectra_.data() + (pathIndex * partitions_ + partition) * fft_size_;
        pffft_transform(setup_, fft_input_.data(), spectrum, fft_work_.data(), PFFFT_FORWARD);
      }
    }
  }

  void forwardBlock(const AlignedFloats &blocks, std::uint32_t writeIndex) noexcept {
    for (std::uint32_t input = 0u; input < inputs_; ++input) {
      const std::size_t inputOffset = static_cast<std::size_t>(input) * block_size_;
      std::memcpy(fft_input_.data(), previous_blocks_.data() + inputOffset,
                  block_size_ * sizeof(float));
      std::memcpy(fft_input_.data() + block_size_, blocks.data() + inputOffset,
                  block_size_ * sizeof(float));
      float *spectrum = input_fdl_.data() +
                        (static_cast<std::size_t>(input) * partitions_ + writeIndex) * fft_size_;
      pffft_transform(setup_, fft_input_.data(), spectrum, fft_work_.data(), PFFFT_FORWARD);
      std::memcpy(previous_blocks_.data() + inputOffset, blocks.data() + inputOffset,
                  block_size_ * sizeof(float));
    }
    accumulators_.clear();
  }

  void accumulateUntil(std::uint32_t targetUnit, std::uint32_t writeIndex) noexcept {
    const float scale = 1.0F / static_cast<float>(fft_size_);
    const std::uint32_t totalUnits = static_cast<std::uint32_t>(paths_.size()) * partitions_;
    if (targetUnit > totalUnits)
      targetUnit = totalUnits;
    while (job_mac_units_ < targetUnit) {
      const std::size_t pathIndex = job_mac_units_ / partitions_;
      const std::uint32_t partition = job_mac_units_ % partitions_;
      const Path &path = paths_[pathIndex];
      float *accumulator = accumulators_.data() + static_cast<std::size_t>(path.output) * fft_size_;
      const std::uint32_t fdlIndex =
          writeIndex >= partition ? writeIndex - partition : writeIndex + partitions_ - partition;
      const float *inputSpectrum =
          input_fdl_.data() +
          (static_cast<std::size_t>(path.input) * partitions_ + fdlIndex) * fft_size_;
      const float *irSpectrum =
          ir_spectra_.data() + (pathIndex * partitions_ + partition) * fft_size_;
      pffft_zconvolve_accumulate(setup_, inputSpectrum, irSpectrum, accumulator, scale);
      ++job_mac_units_;
    }
  }

  void inverseBlock(AlignedFloats &outputRing, std::uint32_t ringSize, std::uint32_t latency,
                    std::uint64_t blockIndex) noexcept {
    const std::uint64_t outputStart =
        blockIndex * static_cast<std::uint64_t>(block_size_) + offset_ + latency;
    for (std::uint32_t output = 0u; output < outputs_; ++output) {
      const float *accumulator =
          accumulators_.data() + static_cast<std::size_t>(output) * fft_size_;
      float *time = inverse_.data() + static_cast<std::size_t>(output) * fft_size_;
      pffft_transform(setup_, accumulator, time, fft_work_.data(), PFFFT_BACKWARD);
      for (std::uint32_t frame = 0u; frame < block_size_; ++frame) {
        const std::uint32_t ringFrame =
            static_cast<std::uint32_t>(outputStart + frame) & (ringSize - 1u);
        outputRing[static_cast<std::size_t>(output) * ringSize + ringFrame] +=
            time[block_size_ + frame];
      }
    }
  }

  void renderBlock(AlignedFloats &outputRing, std::uint32_t ringSize,
                   std::uint32_t latency) noexcept {
    job_mac_units_ = 0u;
    forwardBlock(input_blocks_, fdl_write_);
    accumulateUntil(static_cast<std::uint32_t>(paths_.size()) * partitions_, fdl_write_);
    inverseBlock(outputRing, ringSize, latency, blocks_processed_);
    advanceFdlWrite();
  }

  void advanceFdlWrite() noexcept {
    ++fdl_write_;
    if (fdl_write_ == partitions_)
      fdl_write_ = 0u;
  }

  void startScheduledBlock(AlignedFloats &outputRing, std::uint32_t ringSize,
                           std::uint32_t latency) noexcept {
    if (job_active_)
      return;
    std::memcpy(job_blocks_.data(), input_blocks_.data(), input_blocks_.bytes());
    job_active_ = true;
    job_window_slice_ = 0u;
    job_slice_samples_ = 0u;
    job_mac_units_ = 0u;
    job_fdl_write_ = fdl_write_;
    job_block_index_ = blocks_processed_;
    ++blocks_processed_;
    advanceFdlWrite();
    const std::uint32_t slices = block_size_ / 128u;
    const std::uint32_t totalUnits = static_cast<std::uint32_t>(paths_.size()) * partitions_;
    if (slices <= 2u) {
      job_forward_slice_ = 0u;
    } else {
      const std::uint32_t macSlices = totalUnits < slices - 2u ? totalUnits : slices - 2u;
      const std::uint32_t maximumForwardSlice = slices - 2u - macSlices;
      job_forward_slice_ =
          maximumForwardSlice == 0u ? 0u : phase_seed_ % (maximumForwardSlice + 1u);
    }
    runScheduledSlice(outputRing, ringSize, latency);
  }

  void runScheduledSlice(AlignedFloats &outputRing, std::uint32_t ringSize,
                         std::uint32_t latency) noexcept {
    if (!job_active_)
      return;
    const std::uint32_t slices = block_size_ / 128u;
    const std::uint32_t totalUnits = static_cast<std::uint32_t>(paths_.size()) * partitions_;
    if (job_window_slice_ == job_forward_slice_)
      forwardBlock(job_blocks_, job_fdl_write_);
    if (slices == 2u) {
      if (job_window_slice_ == 0u)
        accumulateUntil((totalUnits + 1u) / 2u, job_fdl_write_);
      else if (job_window_slice_ == 1u)
        accumulateUntil(totalUnits, job_fdl_write_);
    } else if (job_window_slice_ > job_forward_slice_ && job_window_slice_ < slices - 1u) {
      const std::uint32_t availableSlices = slices - 2u - job_forward_slice_;
      const std::uint32_t relativeSlice = job_window_slice_ - job_forward_slice_;
      const std::uint32_t target = static_cast<std::uint32_t>(
          static_cast<std::uint64_t>(totalUnits) * relativeSlice / availableSlices);
      accumulateUntil(target, job_fdl_write_);
    }
    if (job_window_slice_ == slices - 1u) {
      accumulateUntil(totalUnits, job_fdl_write_);
      inverseBlock(outputRing, ringSize, latency, job_block_index_);
      job_active_ = false;
    }
  }

  std::uint32_t block_size_;
  std::uint32_t fft_size_;
  std::uint32_t offset_;
  std::uint32_t partitions_;
  std::uint32_t inputs_;
  std::uint32_t outputs_;
  std::vector<Path> paths_;
  bool amortized_;
  std::uint32_t phase_seed_;
  PFFFT_Setup *setup_ = nullptr;
  AlignedFloats input_blocks_;
  AlignedFloats job_blocks_;
  AlignedFloats previous_blocks_;
  AlignedFloats fft_input_;
  AlignedFloats fft_work_;
  AlignedFloats input_fdl_;
  AlignedFloats ir_spectra_;
  AlignedFloats accumulators_;
  AlignedFloats inverse_;
  std::uint32_t fill_ = 0u;
  std::uint32_t fdl_write_ = 0u;
  std::uint64_t blocks_processed_ = 0u;
  bool job_active_ = false;
  std::uint32_t job_window_slice_ = 0u;
  std::uint32_t job_slice_samples_ = 0u;
  std::uint32_t job_forward_slice_ = 0u;
  std::uint32_t job_mac_units_ = 0u;
  std::uint32_t job_fdl_write_ = 0u;
  std::uint64_t job_block_index_ = 0u;
};

} // namespace

class PrototypeConvolver::Impl {
public:
  bool prepare(const Config &config, const std::vector<std::vector<float>> &irChannels) {
    if (config.inputs == 0u || config.outputs == 0u || config.paths.empty() || irChannels.empty())
      return false;
    std::uint32_t irFrames = 0u;
    for (const Path &path : config.paths) {
      if (path.input >= config.inputs || path.output >= config.outputs ||
          path.irChannel >= irChannels.size())
        return false;
      const std::size_t channelFrames = irChannels[path.irChannel].size();
      if (channelFrames > std::numeric_limits<std::uint32_t>::max())
        return false;
      const auto frames = static_cast<std::uint32_t>(channelFrames);
      if (frames > irFrames)
        irFrames = frames;
    }
    if (irFrames == 0u)
      return false;

    config_ = config;
    latency_ = config.latencySamples;
    const std::uint32_t headBlock = latency_ == 0u ? kDirectHead : latency_;
    if (headBlock < 128u || headBlock > 1024u || (headBlock & (headBlock - 1u)) != 0u)
      return false;

    stages_.clear();
    direct_taps_ = AlignedFloats{};
    direct_history_ = AlignedFloats{};
    direct_position_ = 0u;
    if (latency_ == 0u && config.stageRole != StageRole::deferredTail) {
      direct_taps_.resize(config.paths.size() * kDirectHead);
      direct_history_.resize(static_cast<std::size_t>(config.inputs) * kDirectHead);
      for (std::size_t pathIndex = 0u; pathIndex < config.paths.size(); ++pathIndex) {
        const auto &ir = irChannels[config.paths[pathIndex].irChannel];
        const std::uint32_t count =
            ir.size() < kDirectHead ? static_cast<std::uint32_t>(ir.size()) : kDirectHead;
        for (std::uint32_t frame = 0u; frame < count; ++frame)
          direct_taps_[pathIndex * kDirectHead + frame] = ir[frame];
      }
    }

    try {
      if (config.stageRole == StageRole::deferredTail)
        addSegment(2048u, 4096u, irFrames, irFrames, irChannels);
      else if (config.stageRole == StageRole::residentHead)
        addLadder(headBlock, irFrames < 4096u ? irFrames : 4096u, irChannels);
      else if (config.partitioning == Partitioning::twoStage)
        addTwoStage(headBlock, irFrames, irChannels);
      else
        addLadder(headBlock, irFrames, irChannels);
    } catch (const std::bad_alloc &) {
      stages_.clear();
      return false;
    }

    std::uint32_t requiredRing = latency_ + 4096u;
    for (const auto &stage : stages_) {
      const std::uint32_t required = latency_ + stage->offset() + stage->blockSize() + 4096u;
      if (required > requiredRing)
        requiredRing = required;
    }
    ring_size_ = nextPowerOfTwo(requiredRing);
    try {
      output_ring_.resize(static_cast<std::size_t>(config.outputs) * ring_size_);
      input_frame_.resize(config.inputs);
    } catch (const std::bad_alloc &) {
      stages_.clear();
      return false;
    }
    reset();
    return true;
  }

  void reset() noexcept {
    for (auto &stage : stages_)
      stage->reset();
    direct_history_.clear();
    output_ring_.clear();
    direct_position_ = 0u;
    timeline_ = 0u;
    deferred_blocks_ = 0u;
    non_finite_ = false;
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    if (audio == nullptr || channels < config_.inputs || channels < config_.outputs || frames == 0u)
      return;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      for (std::uint32_t input = 0u; input < config_.inputs; ++input)
        input_frame_[input] = audio[static_cast<std::size_t>(input) * frames + frame];

      for (auto &stage : stages_)
        stage->push(input_frame_.data(), output_ring_, ring_size_, latency_);

      const std::uint32_t ringFrame = static_cast<std::uint32_t>(timeline_) & (ring_size_ - 1u);
      for (std::uint32_t output = 0u; output < config_.outputs; ++output) {
        const std::size_t index = static_cast<std::size_t>(output) * ring_size_ + ringFrame;
        float value = output_ring_[index];
        output_ring_[index] = 0.0F;
        if (latency_ == 0u && config_.stageRole != StageRole::deferredTail)
          value += renderDirect(output);
        if (!std::isfinite(value)) {
          non_finite_ = true;
          value = 0.0F;
        }
        audio[static_cast<std::size_t>(output) * frames + frame] = value;
      }

      if (latency_ == 0u && config_.stageRole != StageRole::deferredTail) {
        for (std::uint32_t input = 0u; input < config_.inputs; ++input) {
          direct_history_[static_cast<std::size_t>(input) * kDirectHead + direct_position_] =
              input_frame_[input];
        }
        ++direct_position_;
        if (direct_position_ == kDirectHead)
          direct_position_ = 0u;
      }
      ++timeline_;
    }
  }

  [[nodiscard]] std::size_t memoryBytes() const noexcept {
    std::size_t bytes = sizeof(*this) + output_ring_.bytes() + direct_taps_.bytes() +
                        direct_history_.bytes() + input_frame_.capacity() * sizeof(float);
    for (const auto &stage : stages_)
      bytes += sizeof(PartitionStage) + stage->memoryBytes();
    return bytes;
  }

  bool processDeferredBlock(float *audio, std::uint32_t channels) noexcept {
    if (config_.stageRole != StageRole::deferredTail || audio == nullptr ||
        channels < config_.inputs || channels < config_.outputs)
      return false;
    constexpr std::uint32_t block = 2048u;
    process(audio, channels, block);
    const std::uint64_t target = deferred_blocks_ * block + 4096u;
    for (std::uint32_t output = 0u; output < config_.outputs; ++output) {
      for (std::uint32_t frame = 0u; frame < block; ++frame) {
        const std::uint32_t ringFrame =
            static_cast<std::uint32_t>(target + frame) & (ring_size_ - 1u);
        const std::size_t ringIndex = static_cast<std::size_t>(output) * ring_size_ + ringFrame;
        audio[static_cast<std::size_t>(output) * block + frame] = output_ring_[ringIndex];
        output_ring_[ringIndex] = 0.0F;
      }
    }
    ++deferred_blocks_;
    return true;
  }

  [[nodiscard]] float renderDirect(std::uint32_t output) const noexcept {
    float value = 0.0F;
    for (std::size_t pathIndex = 0u; pathIndex < config_.paths.size(); ++pathIndex) {
      const Path &path = config_.paths[pathIndex];
      if (path.output != output)
        continue;
      const float *history =
          direct_history_.data() + static_cast<std::size_t>(path.input) * kDirectHead;
      const float *taps = direct_taps_.data() + pathIndex * kDirectHead;
      value += input_frame_[path.input] * taps[0u];
      for (std::uint32_t tap = 1u; tap < kDirectHead; ++tap) {
        const std::uint32_t historyIndex =
            direct_position_ >= tap ? direct_position_ - tap : direct_position_ + kDirectHead - tap;
        value += history[historyIndex] * taps[tap];
      }
    }
    return value;
  }

  void addSegment(std::uint32_t block, std::uint32_t offset, std::uint32_t end,
                  std::uint32_t irFrames, const std::vector<std::vector<float>> &irChannels) {
    if (offset >= irFrames || end <= offset)
      return;
    const std::uint32_t clippedEnd = end < irFrames ? end : irFrames;
    stages_.push_back(std::make_unique<PartitionStage>(block, offset, clippedEnd - offset,
                                                       static_cast<std::uint32_t>(stages_.size()),
                                                       config_, irChannels));
  }

  void addTwoStage(std::uint32_t headBlock, std::uint32_t irFrames,
                   const std::vector<std::vector<float>> &irChannels) {
    const std::uint32_t tailBlock = kTailRatio * headBlock;
    const std::uint32_t tailOffset = 2u * tailBlock;
    const std::uint32_t headOffset = latency_ == 0u ? kDirectHead : 0u;
    addSegment(headBlock, headOffset, tailOffset, irFrames, irChannels);
    addSegment(tailBlock, tailOffset, irFrames, irFrames, irChannels);
  }

  void addLadder(std::uint32_t headBlock, std::uint32_t irFrames,
                 const std::vector<std::vector<float>> &irChannels) {
    const std::uint32_t headOffset = latency_ == 0u ? kDirectHead : 0u;
    addSegment(headBlock, headOffset, 4u * headBlock, irFrames, irChannels);
    std::uint32_t block = 2u * headBlock;
    while (block < kLadderMaximum) {
      addSegment(block, 2u * block, 4u * block, irFrames, irChannels);
      block *= 2u;
    }
    addSegment(kLadderMaximum, 2u * kLadderMaximum, irFrames, irFrames, irChannels);
  }

  Config config_;
  std::vector<std::unique_ptr<PartitionStage>> stages_;
  AlignedFloats direct_taps_;
  AlignedFloats direct_history_;
  AlignedFloats output_ring_;
  std::vector<float> input_frame_;
  std::uint32_t direct_position_ = 0u;
  std::uint32_t ring_size_ = 1u;
  std::uint32_t latency_ = 0u;
  std::uint64_t timeline_ = 0u;
  std::uint64_t deferred_blocks_ = 0u;
  bool non_finite_ = false;
};

PrototypeConvolver::PrototypeConvolver() : impl_(std::make_unique<Impl>()) {}
PrototypeConvolver::~PrototypeConvolver() = default;
PrototypeConvolver::PrototypeConvolver(PrototypeConvolver &&) noexcept = default;
PrototypeConvolver &PrototypeConvolver::operator=(PrototypeConvolver &&) noexcept = default;

bool PrototypeConvolver::prepare(const Config &config,
                                 const std::vector<std::vector<float>> &irChannels) {
  return impl_->prepare(config, irChannels);
}
void PrototypeConvolver::reset() noexcept { impl_->reset(); }
void PrototypeConvolver::process(float *audio, std::uint32_t channels,
                                 std::uint32_t frames) noexcept {
  impl_->process(audio, channels, frames);
}
bool PrototypeConvolver::processDeferredBlock(float *audio, std::uint32_t channels) noexcept {
  return impl_->processDeferredBlock(audio, channels);
}
std::size_t PrototypeConvolver::memoryBytes() const noexcept { return impl_->memoryBytes(); }
std::uint32_t PrototypeConvolver::latencySamples() const noexcept { return impl_->latency_; }
bool PrototypeConvolver::sawNonFinite() const noexcept { return impl_->non_finite_; }

std::vector<float> directReference(const Config &config,
                                   const std::vector<std::vector<float>> &irChannels,
                                   const std::vector<float> &input, std::uint32_t frames) {
  std::vector<double> reference(static_cast<std::size_t>(config.outputs) * frames, 0.0);
  for (const Path &path : config.paths) {
    if (path.input >= config.inputs || path.output >= config.outputs ||
        path.irChannel >= irChannels.size())
      continue;
    const auto &ir = irChannels[path.irChannel];
    for (std::uint32_t inputFrame = 0u; inputFrame < frames; ++inputFrame) {
      const float sample = input[static_cast<std::size_t>(path.input) * frames + inputFrame];
      if (sample == 0.0F)
        continue;
      for (std::size_t tap = 0u; tap < ir.size(); ++tap) {
        const std::uint64_t outputFrame =
            static_cast<std::uint64_t>(inputFrame) + tap + config.latencySamples;
        if (outputFrame >= frames)
          break;
        reference[static_cast<std::size_t>(path.output) * frames + outputFrame] +=
            static_cast<double>(sample) * static_cast<double>(ir[tap]);
      }
    }
  }
  std::vector<float> output(reference.size(), 0.0F);
  for (std::size_t index = 0u; index < reference.size(); ++index)
    output[index] = static_cast<float>(reference[index]);
  return output;
}

std::string_view partitioningName(Partitioning value) noexcept {
  if (value == Partitioning::twoStage)
    return "two-stage";
  return value == Partitioning::ladder ? "capped-ladder" : "worker-offload";
}

} // namespace effetune::experiments::long_convolution
