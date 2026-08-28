#include "effetune/dsp/partitioned_convolver.h"

#include <pffft.h>

#include <cmath>
#include <cstring>
#include <new>
#include <utility>

namespace effetune::dsp {
namespace {

constexpr std::uint32_t kDirectHead = 128u;
constexpr std::uint32_t kShortIrLadderMaximum = 512u;
constexpr std::uint32_t kLongIrLadderMaximum = 1024u;
constexpr std::uint32_t kVeryLongIrLadderMaximum = 2048u;
constexpr std::uint32_t kExtremelyLongIrLadderMaximum = 4096u;
constexpr std::uint32_t kShortIrMaximumFrames = 8192u;
constexpr std::uint32_t kLongIrMaximumFrames = 65535u;
constexpr std::uint32_t kVeryLongIrMaximumFrames = 131071u;
constexpr std::uint32_t kIncrementalMinimumBlock = 1024u;
constexpr std::uint32_t kMaximumStages = 8u;
constexpr std::uint32_t kSliceSamples = 16u;
constexpr std::uint32_t kMaximumSchedulerSlots = 256u;
constexpr std::uint32_t kExclusiveTransformBlock = 2048u;
constexpr int kScheduledTransformWorkBudget = 256;
constexpr int kScheduledMacWorkBudget = 256;
constexpr std::size_t kPffftFactorCount = 25u;
using Path = ConvolutionPath;

std::uint32_t integerLog2(std::uint32_t value) noexcept {
  std::uint32_t result = 0u;
  while (value > 1u) {
    value >>= 1u;
    ++result;
  }
  return result;
}

std::size_t pffftSetupBytes(std::uint32_t fftSize) noexcept {
  // Keep memory reporting aligned with PFFFT's setup struct and real-transform
  // coefficient allocation in the vendored pffft_priv_impl.h.
  const std::size_t fields = (3u + kPffftFactorCount) * sizeof(int) + 3u * sizeof(void *);
  const std::size_t alignment = alignof(void *);
  const std::size_t setup = (fields + alignment - 1u) & ~(alignment - 1u);
  return setup + static_cast<std::size_t>(fftSize) * sizeof(float);
}

struct InternalConfig {
  std::uint32_t latencySamples = 128u;
  std::uint32_t sliceOffset = 0u;
  std::uint32_t inputs = 2u;
  std::uint32_t outputs = 2u;
  std::uint32_t pathCount = 0u;
  std::array<Path, ConvolverConfig::kMaximumPaths> paths{};
};

class AlignedFloats {
public:
  AlignedFloats() = default;
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

  bool resize(std::size_t count) noexcept {
    pffft_aligned_free(data_);
    data_ = nullptr;
    count_ = 0u;
    if (count == 0u)
      return true;
    if (count > static_cast<std::size_t>(-1) / sizeof(float))
      return false;
    data_ = static_cast<float *>(pffft_aligned_malloc(count * sizeof(float)));
    if (data_ == nullptr)
      return false;
    count_ = count;
    clear();
    return true;
  }
  void release() noexcept {
    pffft_aligned_free(data_);
    data_ = nullptr;
    count_ = 0u;
  }
  void clear() noexcept {
    if (data_ != nullptr)
      std::memset(data_, 0, count_ * sizeof(float));
  }
  void swap(AlignedFloats &other) noexcept {
    std::swap(data_, other.data_);
    std::swap(count_, other.count_);
  }
  [[nodiscard]] float *data() noexcept { return data_; }
  [[nodiscard]] const float *data() const noexcept { return data_; }
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
  // A scheduled job keeps the original transform and accumulation order while
  // exposing independently resumable steps to the cross-stage scheduler.
  enum class WorkPhase : std::uint8_t { forward, mac, inverse, done };

  struct WorkCursor {
    WorkPhase phase = WorkPhase::forward;
    std::uint32_t index = 0u;
    std::uint32_t substep = 0u;
  };

  struct WorkStep {
    std::uint64_t weight = 0u;
    bool exclusive = false;
  };

  PartitionStage() = default;
  ~PartitionStage() { release(); }
  PartitionStage(const PartitionStage &) = delete;
  PartitionStage &operator=(const PartitionStage &) = delete;

  bool reserve(std::uint32_t blockSize, std::uint32_t offset, std::uint32_t segmentFrames,
               std::uint32_t irChannels, const InternalConfig &config) noexcept {
    release();
    transform_step_count_ = 1u;
    mac_step_count_ = 1u;
    block_size_ = blockSize;
    fft_size_ = 2u * blockSize;
    offset_ = offset;
    partitions_ = (segmentFrames + blockSize - 1u) / blockSize;
    inputs_ = config.inputs;
    outputs_ = config.outputs;
    path_count_ = config.pathCount;
    ir_channels_ = irChannels;
    segment_frames_ = segmentFrames;
    updatePathTopology(config.paths.data());
    amortized_ =
        blockSize >= 2u * kSliceSamples && offset + config.latencySamples >= 2u * blockSize;
    setup_ = pffft_new_setup(static_cast<int>(fft_size_), PFFFT_REAL);
    if (setup_ == nullptr ||
        !input_blocks_.resize(static_cast<std::size_t>(inputs_) * block_size_) ||
        !job_blocks_.resize(static_cast<std::size_t>(inputs_) * block_size_) ||
        !previous_blocks_.resize(static_cast<std::size_t>(inputs_) * block_size_) ||
        !fft_input_.resize(fft_size_) || !fft_work_.resize(fft_size_) ||
        !input_fdl_.resize(static_cast<std::size_t>(inputs_) * partitions_ * fft_size_) ||
        !ir_spectra_.resize(static_cast<std::size_t>(ir_channels_) * partitions_ * fft_size_) ||
        !accumulators_.resize(static_cast<std::size_t>(outputs_) * fft_size_) ||
        !inverse_.resize(static_cast<std::size_t>(outputs_) * fft_size_)) {
      release();
      return false;
    }
    if (amortized_ && block_size_ >= kIncrementalMinimumBlock) {
      transform_state_ = pffft_new_ordered_real_forward(setup_);
      mac_state_ = pffft_new_zconvolve_accumulate(setup_);
      if (transform_state_ == nullptr || mac_state_ == nullptr ||
          pffft_ordered_real_forward_set_work_budget(transform_state_,
                                                     kScheduledTransformWorkBudget) == 0 ||
          pffft_unordered_real_backward_begin(transform_state_, accumulators_.data(),
                                              inverse_.data(), fft_work_.data()) == 0 ||
          pffft_zconvolve_accumulate_begin(mac_state_, input_fdl_.data(), ir_spectra_.data(),
                                           accumulators_.data(), 1.0F) == 0) {
        release();
        return false;
      }
      transform_step_count_ =
          static_cast<std::uint32_t>(pffft_ordered_real_forward_step_count(transform_state_));
      const std::uint32_t workCount =
          static_cast<std::uint32_t>(pffft_zconvolve_accumulate_step_count(mac_state_));
      mac_step_count_ = (workCount + static_cast<std::uint32_t>(kScheduledMacWorkBudget) - 1u) /
                        static_cast<std::uint32_t>(kScheduledMacWorkBudget);
      if (transform_step_count_ == 0u || mac_step_count_ == 0u) {
        release();
        return false;
      }
    }
    reset();
    return true;
  }

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
    job_cursor_ = {};
    job_mac_units_ = 0u;
#if defined(ET_ENABLE_TEST_KERNEL)
    deadline_recovery_count_ = 0u;
#endif
  }

  bool push(const float *inputFrame, AlignedFloats &outputRing, std::uint32_t ringSize,
            std::uint32_t latency) noexcept {
    for (std::uint32_t input = 0u; input < inputs_; ++input)
      input_blocks_[static_cast<std::size_t>(input) * block_size_ + fill_] = inputFrame[input];
    ++fill_;
    bool immediateWork = false;
    if (fill_ == block_size_) {
      if (amortized_)
        immediateWork = startScheduledBlock(outputRing, ringSize, latency);
      else {
        renderBlock(outputRing, ringSize, latency);
        ++blocks_processed_;
        immediateWork = true;
      }
      fill_ = 0u;
    }
    return immediateWork;
  }

  [[nodiscard]] std::size_t memoryBytes() const noexcept {
    return input_blocks_.bytes() + job_blocks_.bytes() + previous_blocks_.bytes() +
           fft_input_.bytes() + fft_work_.bytes() + input_fdl_.bytes() + ir_spectra_.bytes() +
           accumulators_.bytes() + inverse_.bytes() + pffftSetupBytes(fft_size_);
  }
  [[nodiscard]] std::uint32_t blockSize() const noexcept { return block_size_; }
  [[nodiscard]] std::uint32_t offset() const noexcept { return offset_; }
  [[nodiscard]] bool amortized() const noexcept { return amortized_; }
  [[nodiscard]] std::uint32_t periodSlots() const noexcept { return block_size_ / kSliceSamples; }
#if defined(ET_ENABLE_TEST_KERNEL)
  [[nodiscard]] std::uint64_t deadlineRecoveryCount() const noexcept {
    return deadline_recovery_count_;
  }
#endif

  [[nodiscard]] WorkCursor initialWorkCursor() const noexcept { return {}; }

  [[nodiscard]] WorkStep nextWorkStep(const WorkCursor &cursor) const noexcept {
    const std::uint64_t fft = fft_size_;
    const std::uint64_t transform =
        fft * integerLog2(fft_size_) + 3u * static_cast<std::uint64_t>(block_size_);
    switch (cursor.phase) {
    case WorkPhase::forward:
      return {(transform + transform_step_count_ - 1u) / transform_step_count_,
              transform_step_count_ == 1u && block_size_ >= kExclusiveTransformBlock};
    case WorkPhase::mac:
      return {(2u * fft + mac_step_count_ - 1u) / mac_step_count_, false};
    case WorkPhase::inverse:
      return {(transform + transform_step_count_ - 1u) / transform_step_count_,
              transform_step_count_ == 1u && block_size_ >= kExclusiveTransformBlock};
    case WorkPhase::done:
      return {};
    }
    return {};
  }

  [[nodiscard]] bool workStepCommitsOutput(const WorkCursor &cursor) const noexcept {
    return cursor.phase == WorkPhase::inverse && cursor.substep + 1u == transform_step_count_;
  }

  void advanceWorkCursor(WorkCursor &cursor) const noexcept {
    switch (cursor.phase) {
    case WorkPhase::forward:
      if (++cursor.substep == transform_step_count_) {
        cursor.substep = 0u;
        if (++cursor.index == inputs_) {
          cursor.phase = WorkPhase::mac;
          cursor.index = 0u;
        }
      }
      break;
    case WorkPhase::mac:
      if (++cursor.substep == mac_step_count_) {
        cursor.substep = 0u;
        if (++cursor.index == path_count_ * partitions_) {
          cursor.phase = WorkPhase::inverse;
          cursor.index = 0u;
        }
      }
      break;
    case WorkPhase::inverse:
      if (++cursor.substep == transform_step_count_) {
        cursor.substep = 0u;
        if (++cursor.index == outputs_) {
          cursor.phase = WorkPhase::done;
          cursor.index = 0u;
        }
      }
      break;
    case WorkPhase::done:
      break;
    }
  }

  [[nodiscard]] bool workComplete(const WorkCursor &cursor) const noexcept {
    return cursor.phase == WorkPhase::done;
  }

  [[nodiscard]] std::uint64_t jobWorkWeight() const noexcept {
    WorkCursor cursor = initialWorkCursor();
    std::uint64_t total = 0u;
    while (!workComplete(cursor)) {
      total += nextWorkStep(cursor).weight;
      advanceWorkCursor(cursor);
    }
    return total;
  }

  [[nodiscard]] std::uint32_t jobStepCount() const noexcept {
    return (inputs_ + outputs_) * transform_step_count_ +
           path_count_ * partitions_ * mac_step_count_;
  }

  [[nodiscard]] std::uint32_t jobExclusiveStepCount() const noexcept {
    return transform_step_count_ != 1u || block_size_ < kExclusiveTransformBlock
               ? 0u
               : inputs_ + outputs_;
  }

  [[nodiscard]] std::uint64_t maximumStepWeight() const noexcept {
    WorkCursor cursor = initialWorkCursor();
    std::uint64_t maximum = 0u;
    while (!workComplete(cursor)) {
      const std::uint64_t weight = nextWorkStep(cursor).weight;
      maximum = weight > maximum ? weight : maximum;
      advanceWorkCursor(cursor);
    }
    return maximum;
  }

  void runScheduledStep(AlignedFloats &outputRing, std::uint32_t ringSize,
                        std::uint32_t latency) noexcept {
    if (!job_active_)
      return;
    switch (job_cursor_.phase) {
    case WorkPhase::forward:
      if (!runScheduledForwardStep(job_cursor_.index, job_cursor_.substep)) {
        job_active_ = false;
        return;
      }
      break;
    case WorkPhase::mac:
      if (!runScheduledMacStep(job_cursor_.index, job_cursor_.substep, job_fdl_write_)) {
        job_active_ = false;
        return;
      }
      break;
    case WorkPhase::inverse:
      if (!runScheduledInverseStep(outputRing, ringSize, latency, job_block_index_,
                                   job_cursor_.index, job_cursor_.substep)) {
        job_active_ = false;
        return;
      }
      break;
    case WorkPhase::done:
      job_active_ = false;
      return;
    }
    advanceWorkCursor(job_cursor_);
    if (workComplete(job_cursor_))
      job_active_ = false;
  }

  bool updatePathsWithoutAllocation(const Path *paths, std::uint32_t pathCount) noexcept {
    if (paths == nullptr || pathCount != path_count_)
      return false;
    updatePathTopology(paths);
    return true;
  }

  void beginPreparation(const float *ir, std::uint32_t irChannels,
                        std::uint32_t irFrames) noexcept {
    staged_ir_ = ir;
    staged_ir_channels_ = irChannels;
    staged_ir_frames_ = irFrames;
    prepare_ir_channel_ = 0u;
    prepare_partition_ = 0u;
    ir_spectra_.clear();
  }

  bool prepareOne() noexcept {
    if (prepare_ir_channel_ >= ir_channels_)
      return true;
    fft_input_.clear();
    const std::uint32_t partitionOffset = prepare_partition_ * block_size_;
    const std::uint32_t remaining =
        segment_frames_ > partitionOffset ? segment_frames_ - partitionOffset : 0u;
    const std::uint32_t copyFrames = remaining < block_size_ ? remaining : block_size_;
    for (std::uint32_t frame = 0u; frame < copyFrames; ++frame) {
      const std::size_t irIndex = static_cast<std::size_t>(offset_) + partitionOffset + frame;
      if (staged_ir_ != nullptr && prepare_ir_channel_ < staged_ir_channels_ &&
          irIndex < staged_ir_frames_) {
        fft_input_[frame] =
            staged_ir_[static_cast<std::size_t>(prepare_ir_channel_) * staged_ir_frames_ + irIndex];
      }
    }
    float *spectrum =
        ir_spectra_.data() +
        (static_cast<std::size_t>(prepare_ir_channel_) * partitions_ + prepare_partition_) *
            fft_size_;
    pffft_transform(setup_, fft_input_.data(), spectrum, fft_work_.data(), PFFFT_FORWARD);
    ++prepare_partition_;
    if (prepare_partition_ == partitions_) {
      prepare_partition_ = 0u;
      ++prepare_ir_channel_;
    }
    return prepare_ir_channel_ >= ir_channels_;
  }

private:
  void release() noexcept {
    pffft_destroy_ordered_real_forward(transform_state_);
    transform_state_ = nullptr;
    pffft_destroy_zconvolve_accumulate(mac_state_);
    mac_state_ = nullptr;
    if (setup_ != nullptr)
      pffft_destroy_setup(setup_);
    setup_ = nullptr;
    input_blocks_.release();
    job_blocks_.release();
    previous_blocks_.release();
    fft_input_.release();
    fft_work_.release();
    input_fdl_.release();
    ir_spectra_.release();
    accumulators_.release();
    inverse_.release();
  }

  void updatePathTopology(const Path *paths) noexcept {
    for (std::uint32_t index = 0u; index < path_count_; ++index) {
      paths_[index] = paths[index];
      path_starts_output_[index] = true;
      for (std::uint32_t previous = 0u; previous < index; ++previous) {
        if (paths_[previous].output == paths_[index].output) {
          path_starts_output_[index] = false;
          break;
        }
      }
    }
  }

  [[nodiscard]] bool outputHasPath(std::uint32_t output) const noexcept {
    for (std::uint32_t index = 0u; index < path_count_; ++index) {
      if (paths_[index].output == output)
        return true;
    }
    return false;
  }

  [[nodiscard]] static bool incrementalStepSucceeded(int result, std::uint32_t substep,
                                                     std::uint32_t stepCount) noexcept {
    if (result < 0)
      return false;
    return (result == 1) == (substep + 1u == stepCount);
  }

  [[nodiscard]] bool runScheduledForwardStep(std::uint32_t input, std::uint32_t substep) noexcept {
    if (transform_step_count_ == 1u) {
      forwardInput(job_blocks_, job_fdl_write_, input);
      return true;
    }
    if (substep == 0u) {
      const std::size_t inputOffset = static_cast<std::size_t>(input) * block_size_;
      std::memcpy(fft_input_.data(), previous_blocks_.data() + inputOffset,
                  block_size_ * sizeof(float));
      std::memcpy(fft_input_.data() + block_size_, job_blocks_.data() + inputOffset,
                  block_size_ * sizeof(float));
      std::memcpy(previous_blocks_.data() + inputOffset, job_blocks_.data() + inputOffset,
                  block_size_ * sizeof(float));
      float *spectrum =
          input_fdl_.data() +
          (static_cast<std::size_t>(input) * partitions_ + job_fdl_write_) * fft_size_;
      if (pffft_unordered_real_forward_begin(transform_state_, fft_input_.data(), spectrum,
                                             fft_work_.data()) == 0)
        return false;
    }
    return incrementalStepSucceeded(pffft_ordered_real_forward_step(transform_state_), substep,
                                    transform_step_count_);
  }

  [[nodiscard]] bool runScheduledMacStep(std::uint32_t unit, std::uint32_t substep,
                                         std::uint32_t writeIndex) noexcept {
    if (mac_step_count_ == 1u) {
      accumulateUnit(unit, writeIndex);
      return true;
    }
    const std::uint32_t pathIndex = unit / partitions_;
    const std::uint32_t partition = unit % partitions_;
    const Path &path = paths_[pathIndex];
    float *accumulator = accumulators_.data() + static_cast<std::size_t>(path.output) * fft_size_;
    const std::uint32_t fdlIndex =
        writeIndex >= partition ? writeIndex - partition : writeIndex + partitions_ - partition;
    const float *inputSpectrum =
        input_fdl_.data() +
        (static_cast<std::size_t>(path.input) * partitions_ + fdlIndex) * fft_size_;
    const float *irSpectrum =
        ir_spectra_.data() +
        (static_cast<std::size_t>(path.irChannel) * partitions_ + partition) * fft_size_;
    if (substep == 0u) {
      const float scale = 1.0F / static_cast<float>(fft_size_);
      const bool startsOutput = partition == 0u && path_starts_output_[pathIndex];
      const int began = startsOutput
                            ? pffft_zconvolve_no_accu_begin(mac_state_, inputSpectrum, irSpectrum,
                                                            accumulator, scale)
                            : pffft_zconvolve_accumulate_begin(mac_state_, inputSpectrum,
                                                               irSpectrum, accumulator, scale);
      if (began == 0)
        return false;
    }
    const int result = pffft_zconvolve_accumulate_step(mac_state_, kScheduledMacWorkBudget);
    if (result < 0)
      return false;
    return (result == 1) == (substep + 1u == mac_step_count_);
  }

  void commitInverseOutput(AlignedFloats &outputRing, std::uint32_t ringSize, std::uint32_t latency,
                           std::uint64_t blockIndex, std::uint32_t output) noexcept {
    const std::uint64_t outputStart =
        blockIndex * static_cast<std::uint64_t>(block_size_) + offset_ + latency;
    float *ring = outputRing.data() + static_cast<std::size_t>(output) * ringSize;
    const float *source =
        inverse_.data() + static_cast<std::size_t>(output) * fft_size_ + block_size_;
    const std::uint32_t ringStart = static_cast<std::uint32_t>(outputStart) & (ringSize - 1u);
    const std::uint32_t untilWrap = ringSize - ringStart;
    const std::uint32_t firstFrames = block_size_ < untilWrap ? block_size_ : untilWrap;
    for (std::uint32_t frame = 0u; frame < firstFrames; ++frame)
      ring[ringStart + frame] += source[frame];
    for (std::uint32_t frame = firstFrames; frame < block_size_; ++frame)
      ring[frame - firstFrames] += source[frame];
  }

  [[nodiscard]] bool runScheduledInverseStep(AlignedFloats &outputRing, std::uint32_t ringSize,
                                             std::uint32_t latency, std::uint64_t blockIndex,
                                             std::uint32_t output, std::uint32_t substep) noexcept {
    if (!outputHasPath(output))
      return true;
    if (transform_step_count_ == 1u) {
      inverseOutput(outputRing, ringSize, latency, blockIndex, output);
      return true;
    }
    if (substep == 0u) {
      const float *accumulator =
          accumulators_.data() + static_cast<std::size_t>(output) * fft_size_;
      float *time = inverse_.data() + static_cast<std::size_t>(output) * fft_size_;
      if (pffft_unordered_real_backward_begin(transform_state_, accumulator, time,
                                              fft_work_.data()) == 0)
        return false;
    }
    const int result = pffft_ordered_real_forward_step(transform_state_);
    if (!incrementalStepSucceeded(result, substep, transform_step_count_))
      return false;
    if (result == 1)
      commitInverseOutput(outputRing, ringSize, latency, blockIndex, output);
    return true;
  }

  void forwardInput(const AlignedFloats &blocks, std::uint32_t writeIndex,
                    std::uint32_t input) noexcept {
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

  void forwardBlock(const AlignedFloats &blocks, std::uint32_t writeIndex) noexcept {
    for (std::uint32_t input = 0u; input < inputs_; ++input)
      forwardInput(blocks, writeIndex, input);
  }

  void accumulateUnit(std::uint32_t unit, std::uint32_t writeIndex) noexcept {
    const std::uint32_t pathIndex = unit / partitions_;
    const std::uint32_t partition = unit % partitions_;
    const Path &path = paths_[pathIndex];
    float *accumulator = accumulators_.data() + static_cast<std::size_t>(path.output) * fft_size_;
    const std::uint32_t fdlIndex =
        writeIndex >= partition ? writeIndex - partition : writeIndex + partitions_ - partition;
    const float *inputSpectrum =
        input_fdl_.data() +
        (static_cast<std::size_t>(path.input) * partitions_ + fdlIndex) * fft_size_;
    const float *irSpectrum =
        ir_spectra_.data() +
        (static_cast<std::size_t>(path.irChannel) * partitions_ + partition) * fft_size_;
    const float scale = 1.0F / static_cast<float>(fft_size_);
    if (partition == 0u && path_starts_output_[pathIndex]) {
      pffft_zconvolve_no_accu(setup_, inputSpectrum, irSpectrum, accumulator, scale);
    } else {
      pffft_zconvolve_accumulate(setup_, inputSpectrum, irSpectrum, accumulator, scale);
    }
  }

  void accumulateUntil(std::uint32_t targetUnit, std::uint32_t writeIndex) noexcept {
    const std::uint32_t totalUnits = path_count_ * partitions_;
    if (targetUnit > totalUnits)
      targetUnit = totalUnits;
    while (job_mac_units_ < targetUnit) {
      accumulateUnit(job_mac_units_, writeIndex);
      ++job_mac_units_;
    }
  }

  void inverseOutput(AlignedFloats &outputRing, std::uint32_t ringSize, std::uint32_t latency,
                     std::uint64_t blockIndex, std::uint32_t output) noexcept {
    const float *accumulator = accumulators_.data() + static_cast<std::size_t>(output) * fft_size_;
    float *time = inverse_.data() + static_cast<std::size_t>(output) * fft_size_;
    pffft_transform(setup_, accumulator, time, fft_work_.data(), PFFFT_BACKWARD);
    commitInverseOutput(outputRing, ringSize, latency, blockIndex, output);
  }

  void inverseBlock(AlignedFloats &outputRing, std::uint32_t ringSize, std::uint32_t latency,
                    std::uint64_t blockIndex) noexcept {
    for (std::uint32_t output = 0u; output < outputs_; ++output) {
      if (outputHasPath(output))
        inverseOutput(outputRing, ringSize, latency, blockIndex, output);
    }
  }

  void renderBlock(AlignedFloats &outputRing, std::uint32_t ringSize,
                   std::uint32_t latency) noexcept {
    job_mac_units_ = 0u;
    forwardBlock(input_blocks_, fdl_write_);
    accumulateUntil(path_count_ * partitions_, fdl_write_);
    inverseBlock(outputRing, ringSize, latency, blocks_processed_);
    advanceFdlWrite();
  }

  void advanceFdlWrite() noexcept {
    ++fdl_write_;
    if (fdl_write_ == partitions_)
      fdl_write_ = 0u;
  }

  bool startScheduledBlock(AlignedFloats &outputRing, std::uint32_t ringSize,
                           std::uint32_t latency) noexcept {
    bool recoveredDeadline = false;
#if defined(ET_ENABLE_TEST_KERNEL)
    if (job_active_)
      ++deadline_recovery_count_;
#endif
    while (job_active_) {
      runScheduledStep(outputRing, ringSize, latency);
      recoveredDeadline = true;
    }
    input_blocks_.swap(job_blocks_);
    job_active_ = true;
    job_cursor_ = initialWorkCursor();
    job_mac_units_ = 0u;
    job_fdl_write_ = fdl_write_;
    job_block_index_ = blocks_processed_;
    ++blocks_processed_;
    advanceFdlWrite();
    return recoveredDeadline;
  }

  std::uint32_t block_size_ = 0u;
  std::uint32_t fft_size_ = 0u;
  std::uint32_t offset_ = 0u;
  std::uint32_t partitions_ = 0u;
  std::uint32_t inputs_ = 0u;
  std::uint32_t outputs_ = 0u;
  std::uint32_t path_count_ = 0u;
  std::uint32_t ir_channels_ = 0u;
  std::array<Path, ConvolverConfig::kMaximumPaths> paths_{};
  std::array<bool, ConvolverConfig::kMaximumPaths> path_starts_output_{};
  bool amortized_ = false;
  PFFFT_Setup *setup_ = nullptr;
  PFFFT_OrderedRealForward *transform_state_ = nullptr;
  PFFFT_ZConvolveAccumulate *mac_state_ = nullptr;
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
  std::uint32_t transform_step_count_ = 1u;
  std::uint32_t mac_step_count_ = 1u;
  std::uint32_t fdl_write_ = 0u;
  std::uint64_t blocks_processed_ = 0u;
  bool job_active_ = false;
  WorkCursor job_cursor_{};
  std::uint32_t job_mac_units_ = 0u;
  std::uint32_t job_fdl_write_ = 0u;
  std::uint64_t job_block_index_ = 0u;
#if defined(ET_ENABLE_TEST_KERNEL)
  std::uint64_t deadline_recovery_count_ = 0u;
#endif
  const float *staged_ir_ = nullptr;
  std::uint32_t staged_ir_channels_ = 0u;
  std::uint32_t staged_ir_frames_ = 0u;
  std::uint32_t segment_frames_ = 0u;
  std::uint32_t prepare_ir_channel_ = 0u;
  std::uint32_t prepare_partition_ = 0u;
};

} // namespace

class PartitionedConvolver::Impl {
public:
  ~Impl() { releaseStorage(); }

  bool reserve(const ConvolverConfig &config) noexcept {
    if (config.inputs == 0u || config.outputs == 0u || config.pathCount == 0u ||
        config.pathCount > ConvolverConfig::kMaximumPaths || config.irChannels == 0u ||
        config.irFrames == 0u)
      return false;
    for (std::uint32_t index = 0u; index < config.pathCount; ++index) {
      const Path &path = config.paths[index];
      if (path.input >= config.inputs || path.output >= config.outputs ||
          path.irChannel >= config.irChannels)
        return false;
    }
    const std::uint32_t headBlock =
        config.latencySamples == 0u ? kDirectHead : config.latencySamples;
    if (headBlock < 128u || headBlock > 1024u || (headBlock & (headBlock - 1u)) != 0u)
      return false;

    releaseStorage();
    state_ = ConvolverPreparationState::error;
    config_.latencySamples = config.latencySamples;
    config_.sliceOffset = config.sliceOffset;
    config_.inputs = config.inputs;
    config_.outputs = config.outputs;
    config_.pathCount = config.pathCount;
    for (std::uint32_t index = 0u; index < config.pathCount; ++index)
      config_.paths[index] = config.paths[index];
    ir_channels_ = config.irChannels;
    ir_frames_ = config.irFrames;
    latency_ = config.latencySamples;

    if (latency_ == 0u &&
        (!direct_taps_.resize(static_cast<std::size_t>(ir_channels_) * kDirectHead) ||
         !direct_history_.resize(static_cast<std::size_t>(config_.inputs) * kDirectHead))) {
      releaseStorage();
      return false;
    }
    std::uint32_t requestedLadderMaximum =
        config.irFrames <= kShortIrMaximumFrames  ? kShortIrLadderMaximum
        : config.irFrames <= kLongIrMaximumFrames ? kLongIrLadderMaximum
                                                  : kVeryLongIrLadderMaximum;
    if (config.irFrames > kVeryLongIrMaximumFrames && config.inputs <= 2u && config.outputs <= 2u) {
      requestedLadderMaximum = kExtremelyLongIrLadderMaximum;
    }
    const std::uint32_t minimumLadderMaximum = 2u * headBlock;
    const std::uint32_t ladderMaximum = requestedLadderMaximum < minimumLadderMaximum
                                            ? minimumLadderMaximum
                                            : requestedLadderMaximum;
    if (!addLadder(headBlock, ladderMaximum, config.irFrames) || !buildSchedule()) {
      releaseStorage();
      return false;
    }

    std::uint32_t requiredRing = latency_ + 4096u;
    for (std::uint32_t index = 0u; index < stage_count_; ++index) {
      const std::uint32_t required =
          latency_ + stages_[index]->offset() + stages_[index]->blockSize() + 4096u;
      if (required > requiredRing)
        requiredRing = required;
    }
    ring_size_ = nextPowerOfTwo(requiredRing);
    if (!output_ring_.resize(static_cast<std::size_t>(config_.outputs) * ring_size_) ||
        !input_frame_.resize(config_.inputs)) {
      releaseStorage();
      return false;
    }
    reset();
    state_ = ConvolverPreparationState::reserved;
    return true;
  }

  bool updatePathsWithoutAllocation(const Path *paths, std::uint32_t pathCount) noexcept {
    if (state_ != ConvolverPreparationState::reserved || paths == nullptr ||
        pathCount != config_.pathCount)
      return false;
    for (std::uint32_t index = 0u; index < pathCount; ++index) {
      const Path &path = paths[index];
      if (path.input >= config_.inputs || path.output >= config_.outputs ||
          path.irChannel >= ir_channels_)
        return false;
    }
    for (std::uint32_t index = 0u; index < stage_count_; ++index) {
      if (!stages_[index]->updatePathsWithoutAllocation(paths, pathCount))
        return false;
    }
    for (std::uint32_t index = 0u; index < pathCount; ++index)
      config_.paths[index] = paths[index];
    return true;
  }

  bool commit(const float *ir, std::uint32_t channels, std::uint32_t frames) noexcept {
    if (state_ != ConvolverPreparationState::reserved || ir == nullptr ||
        channels != ir_channels_ || frames != ir_frames_)
      return false;
    for (std::uint32_t index = 0u; index < stage_count_; ++index)
      stages_[index]->beginPreparation(ir, channels, frames);
    stage_index_ = stage_count_ == 0u ? 0u : config_.sliceOffset % stage_count_;
    prepared_stages_ = 0u;
    preparation_samples_ = 0u;
    if (latency_ == 0u) {
      for (std::uint32_t channel = 0u; channel < ir_channels_; ++channel) {
        const float *source = ir + static_cast<std::size_t>(channel) * frames;
        std::memcpy(direct_taps_.data() + static_cast<std::size_t>(channel) * kDirectHead, source,
                    (frames < kDirectHead ? frames : kDirectHead) * sizeof(float));
      }
    }
    state_ = ConvolverPreparationState::preparing;
    return true;
  }

  ConvolverPreparationState prepareSlice(std::uint32_t partitionBudget) noexcept {
    if (state_ != ConvolverPreparationState::preparing || partitionBudget == 0u)
      return state_;
    while (partitionBudget-- > 0u && prepared_stages_ < stage_count_) {
      if (stages_[stage_index_]->prepareOne()) {
        ++prepared_stages_;
        if (prepared_stages_ < stage_count_)
          stage_index_ = (stage_index_ + 1u) % stage_count_;
      }
    }
    if (prepared_stages_ == stage_count_) {
      // reserve() already reset the runtime buffers, and preparation only writes IR spectra and
      // transform scratch. Avoid clearing the complete long-IR working set in one audio callback.
      state_ = ConvolverPreparationState::warming;
    }
    return state_;
  }

  void clear() noexcept {
    releaseStorage();
    state_ = ConvolverPreparationState::empty;
  }

  [[nodiscard]] ConvolverPreparationState state() const noexcept { return state_; }
  [[nodiscard]] std::uint32_t latencySamples() const noexcept { return latency_; }

  void reset() noexcept {
    for (std::uint32_t index = 0u; index < stage_count_; ++index)
      stages_[index]->reset();
    direct_history_.clear();
    output_ring_.clear();
    direct_position_ = 0u;
    timeline_ = 0u;
    stream_history_samples_ = 0u;
    scheduler_samples_ = 0u;
    scheduler_slot_ = 0u;
    slot_has_immediate_work_ = false;
    non_finite_ = false;
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    if (audio == nullptr || channels < config_.inputs || channels < config_.outputs || frames == 0u)
      return;
    std::uint32_t processStart = 0u;
    if (state_ == ConvolverPreparationState::preparing) {
      while (processStart < frames && state_ == ConvolverPreparationState::preparing) {
        const std::uint32_t untilSlice = kSliceSamples - preparation_samples_;
        const std::uint32_t available = frames - processStart;
        const std::uint32_t consumed = available < untilSlice ? available : untilSlice;
        preparation_samples_ += consumed;
        processStart += consumed;
        if (preparation_samples_ == kSliceSamples) {
          preparation_samples_ = 0u;
          prepareSlice(1u);
        }
      }
      if (state_ == ConvolverPreparationState::preparing) {
        std::memset(audio, 0, static_cast<std::size_t>(channels) * frames * sizeof(float));
        return;
      }
    }
    if (state_ != ConvolverPreparationState::warming &&
        state_ != ConvolverPreparationState::active) {
      std::memset(audio, 0, static_cast<std::size_t>(channels) * frames * sizeof(float));
      return;
    }
    for (std::uint32_t frame = processStart; frame < frames; ++frame) {
      if (state_ == ConvolverPreparationState::warming && stream_history_samples_ >= latency_)
        state_ = ConvolverPreparationState::active;
      for (std::uint32_t input = 0u; input < config_.inputs; ++input)
        input_frame_[input] = audio[static_cast<std::size_t>(input) * frames + frame];

      for (std::uint32_t index = 0u; index < stage_count_; ++index) {
        slot_has_immediate_work_ =
            stages_[index]->push(input_frame_.data(), output_ring_, ring_size_, latency_) ||
            slot_has_immediate_work_;
      }

      ++scheduler_samples_;
      if (scheduler_samples_ == kSliceSamples) {
        scheduler_samples_ = 0u;
        runScheduledSlot(slot_has_immediate_work_);
        slot_has_immediate_work_ = false;
      }

      const std::uint32_t ringFrame = static_cast<std::uint32_t>(timeline_) & (ring_size_ - 1u);
      for (std::uint32_t output = 0u; output < config_.outputs; ++output) {
        const std::size_t index = static_cast<std::size_t>(output) * ring_size_ + ringFrame;
        float value = output_ring_[index];
        output_ring_[index] = 0.0F;
        if (latency_ == 0u)
          value += renderDirect(output);
        if (!std::isfinite(value)) {
          non_finite_ = true;
          value = 0.0F;
        }
        audio[static_cast<std::size_t>(output) * frames + frame] = value;
      }

      if (latency_ == 0u) {
        for (std::uint32_t input = 0u; input < config_.inputs; ++input) {
          direct_history_[static_cast<std::size_t>(input) * kDirectHead + direct_position_] =
              input_frame_[input];
        }
        ++direct_position_;
        if (direct_position_ == kDirectHead)
          direct_position_ = 0u;
      }
      ++timeline_;
      if (state_ == ConvolverPreparationState::warming)
        ++stream_history_samples_;
    }
    for (std::uint32_t channel = 0u; channel < channels; ++channel)
      std::memset(audio + static_cast<std::size_t>(channel) * frames, 0,
                  processStart * sizeof(float));
  }

  [[nodiscard]] std::size_t memoryBytes() const noexcept {
    std::size_t bytes = sizeof(*this) + output_ring_.bytes() + direct_taps_.bytes() +
                        direct_history_.bytes() + input_frame_.bytes() + schedule_action_count_;
    for (std::uint32_t index = 0u; index < stage_count_; ++index)
      bytes += sizeof(PartitionStage) + stages_[index]->memoryBytes();
    return bytes;
  }

#if defined(ET_ENABLE_TEST_KERNEL)
  [[nodiscard]] std::uint64_t deadlineRecoveryCountForTesting() const noexcept {
    std::uint64_t count = 0u;
    for (std::uint32_t index = 0u; index < stage_count_; ++index)
      count += stages_[index]->deadlineRecoveryCount();
    return count;
  }

  [[nodiscard]] ConvolverScheduleTrace scheduleTraceForTesting() const noexcept {
    ConvolverScheduleTrace trace;
    trace.cycleSlots = scheduler_cycle_slots_;
    trace.callbackCount =
        (scheduler_cycle_slots_ + ConvolverScheduleTrace::kSlotsPerCallback - 1u) /
        ConvolverScheduleTrace::kSlotsPerCallback;
    trace.slotWeightLimit = schedule_weight_limit_;
    trace.deadlineRecoveryCount = deadlineRecoveryCountForTesting();

    std::array<PartitionStage::WorkCursor, kMaximumStages> cursors{};
    std::array<std::uint32_t, kMaximumStages> starts{};
    std::array<std::uint32_t, kMaximumStages> deadlines{};
    for (std::uint32_t stageIndex = 0u; stageIndex < stage_count_; ++stageIndex) {
      const PartitionStage &stage = *stages_[stageIndex];
      if (!stage.amortized())
        continue;
      cursors[stageIndex] = stage.initialWorkCursor();
      deadlines[stageIndex] = stage.periodSlots() - 1u;
    }

    for (std::uint32_t slot = 0u; slot < scheduler_cycle_slots_; ++slot) {
      for (std::uint32_t stageIndex = 0u; stageIndex < stage_count_; ++stageIndex) {
        const PartitionStage &stage = *stages_[stageIndex];
        if (!stage.amortized() || deadlines[stageIndex] != slot)
          continue;
        if (!stage.workComplete(cursors[stageIndex]))
          ++trace.deadlineViolationCount;
        if (slot + 1u < scheduler_cycle_slots_) {
          cursors[stageIndex] = stage.initialWorkCursor();
          starts[stageIndex] = slot + 1u;
          deadlines[stageIndex] = slot + stage.periodSlots();
        }
      }

      const std::uint32_t begin = schedule_offsets_[slot];
      const std::uint32_t end = schedule_offsets_[slot + 1u];
      trace.slotActionCounts[slot] = end - begin;
      if (isImmediateSlot(slot) && begin != end)
        trace.immediateSlotViolationCount += end - begin;
      for (std::uint32_t action = begin; action < end; ++action) {
        const std::uint32_t stageIndex = schedule_actions_[action];
        if (stageIndex >= stage_count_ || !stages_[stageIndex]->amortized() ||
            starts[stageIndex] > slot || deadlines[stageIndex] <= slot ||
            stages_[stageIndex]->workComplete(cursors[stageIndex])) {
          ++trace.jobOrderViolationCount;
          continue;
        }
        const PartitionStage::WorkStep step =
            stages_[stageIndex]->nextWorkStep(cursors[stageIndex]);
        trace.slotWeights[slot] += step.weight;
        stages_[stageIndex]->advanceWorkCursor(cursors[stageIndex]);
      }
      trace.callbackWeights[slot / ConvolverScheduleTrace::kSlotsPerCallback] +=
          trace.slotWeights[slot];
    }
    return trace;
  }
#endif

private:
  static constexpr std::uint32_t kInvalidAction = static_cast<std::uint32_t>(-1);

  struct ScheduledAction {
    std::uint64_t weight = 0u;
    std::uint32_t stageIndex = 0u;
    std::uint32_t occurrence = 0u;
    std::uint32_t ordinal = 0u;
    std::uint32_t slot = 0u;
    std::uint32_t startSlot = 0u;
    std::uint32_t deadlineSlot = 0u;
    std::uint32_t previousAction = kInvalidAction;
    std::uint32_t nextAction = kInvalidAction;
    bool exclusive = false;
    bool commitsOutput = false;
  };

  struct SimulatedJob {
    PartitionStage *stage = nullptr;
    PartitionStage::WorkCursor cursor{};
    std::uint64_t totalWeight = 0u;
    std::uint64_t remainingWeight = 0u;
    std::uint32_t remainingExclusiveSteps = 0u;
    std::uint32_t deadlineSlot = 0u;
    std::uint32_t startSlot = 0u;
    std::uint32_t stageIndex = 0u;
    std::uint32_t occurrence = 0u;
    std::uint32_t ordinal = 0u;
    std::uint32_t lastAction = kInvalidAction;
  };

  void resetSimulatedJob(SimulatedJob &job, std::uint32_t startSlot,
                         std::uint32_t deadlineSlot) const noexcept {
    job.cursor = job.stage->initialWorkCursor();
    job.remainingWeight = job.totalWeight;
    job.remainingExclusiveSteps = job.stage->jobExclusiveStepCount();
    job.deadlineSlot = deadlineSlot;
    job.startSlot = startSlot;
    job.ordinal = 0u;
    job.lastAction = kInvalidAction;
  }

  [[nodiscard]] std::uint32_t usableSlots(std::uint32_t begin,
                                          std::uint32_t deadline) const noexcept {
    std::uint32_t count = 0u;
    for (std::uint32_t slot = begin; slot < deadline; ++slot) {
      if (head_period_slots_ == 0u || slot % head_period_slots_ != head_period_slots_ - 1u)
        ++count;
    }
    return count;
  }

  [[nodiscard]] bool simulateSchedule(std::uint64_t slotWeightLimit,
                                      ScheduledAction *records = nullptr) noexcept {
    std::array<SimulatedJob, kMaximumStages> jobs{};
    std::uint32_t jobCount = 0u;
    for (std::uint32_t stageIndex = 0u; stageIndex < stage_count_; ++stageIndex) {
      PartitionStage *stage = stages_[stageIndex];
      if (!stage->amortized())
        continue;
      SimulatedJob &job = jobs[jobCount++];
      job.stage = stage;
      job.stageIndex = stageIndex;
      job.totalWeight = stage->jobWorkWeight();
      resetSimulatedJob(job, 0u, stage->periodSlots() - 1u);
    }

    std::uint32_t actionCount = 0u;
    if (records != nullptr)
      schedule_offsets_[0u] = 0u;
    for (std::uint32_t slot = 0u; slot < scheduler_cycle_slots_; ++slot) {
      for (std::uint32_t index = 0u; index < jobCount; ++index) {
        SimulatedJob &job = jobs[index];
        if (job.deadlineSlot != slot)
          continue;
        if (job.remainingWeight != 0u)
          return false;
        if (slot + 1u < scheduler_cycle_slots_) {
          ++job.occurrence;
          resetSimulatedJob(job, slot + 1u, slot + job.stage->periodSlots());
        }
      }
      const bool headSlot =
          head_period_slots_ != 0u && slot % head_period_slots_ == head_period_slots_ - 1u;
      if (headSlot) {
        if (records != nullptr)
          schedule_offsets_[slot + 1u] = actionCount;
        continue;
      }

      std::uint64_t usedWeight = 0u;
      bool slotClosed = false;
      while (!slotClosed) {
        std::uint32_t selected = jobCount;
        std::uint64_t selectedDeficit = 0u;
        std::uint64_t selectedWeight = 1u;
        bool selectedForced = false;
        std::uint32_t selectedTie = 0u;
        PartitionStage::WorkStep selectedStep{};
        for (std::uint32_t index = 0u; index < jobCount; ++index) {
          SimulatedJob &job = jobs[index];
          if (job.remainingWeight == 0u || job.deadlineSlot <= slot)
            continue;
          const PartitionStage::WorkStep step = job.stage->nextWorkStep(job.cursor);
          if (step.weight == 0u || step.weight > slotWeightLimit ||
              step.weight > slotWeightLimit - usedWeight || (step.exclusive && usedWeight != 0u))
            continue;
          const std::uint32_t totalSlots = usableSlots(job.startSlot, job.deadlineSlot);
          const std::uint32_t elapsedSlots = usableSlots(job.startSlot, slot + 1u);
          if (totalSlots == 0u)
            continue;
          const std::uint64_t completedWeight = job.totalWeight - job.remainingWeight;
          // Follow each job's ideal fluid progress, then break ties by deadline
          // and the deterministic instance phase.
          const std::uint64_t desiredWeight =
              (job.totalWeight * elapsedSlots + totalSlots - 1u) / totalSlots;
          const std::uint64_t deficit =
              desiredWeight > completedWeight ? desiredWeight - completedWeight : 0u;
          const std::uint32_t remainingSlots = usableSlots(slot, job.deadlineSlot);
          const std::uint32_t leadSlots =
              job.remainingExclusiveSteps != 0u && !step.exclusive ? 1u : 0u;
          // A transform marked exclusive needs a clean slot. Reserve one
          // preceding slot when ordered MAC work still blocks that transform.
          const bool forced = job.remainingExclusiveSteps + leadSlots >= remainingSlots;
          if (deficit == 0u && !forced)
            continue;
          const std::uint32_t tie =
              (job.stageIndex + stage_count_ - (slot % stage_count_)) % stage_count_;
          bool better = selected == jobCount || (forced && !selectedForced);
          if (!better && forced == selectedForced) {
            const SimulatedJob &best = jobs[selected];
            const std::uint64_t left = deficit * selectedWeight;
            const std::uint64_t right = selectedDeficit * step.weight;
            better =
                left > right ||
                (left == right && (job.deadlineSlot < best.deadlineSlot ||
                                   (job.deadlineSlot == best.deadlineSlot && tie < selectedTie)));
          }
          if (!better)
            continue;
          selected = index;
          selectedDeficit = deficit;
          selectedWeight = step.weight;
          selectedForced = forced;
          selectedTie = tie;
          selectedStep = step;
        }
        if (selected == jobCount)
          break;

        SimulatedJob &job = jobs[selected];
        if (records != nullptr) {
          if (actionCount >= schedule_action_count_)
            return false;
          ScheduledAction &action = records[actionCount];
          action.weight = selectedStep.weight;
          action.stageIndex = job.stageIndex;
          action.occurrence = job.occurrence;
          action.ordinal = job.ordinal;
          action.slot = slot;
          action.startSlot = job.startSlot;
          action.deadlineSlot = job.deadlineSlot;
          action.previousAction = job.lastAction;
          action.nextAction = kInvalidAction;
          action.exclusive = selectedStep.exclusive;
          action.commitsOutput = job.stage->workStepCommitsOutput(job.cursor);
          if (job.lastAction != kInvalidAction)
            records[job.lastAction].nextAction = actionCount;
          job.lastAction = actionCount;
        }
        ++actionCount;
        ++job.ordinal;
        usedWeight += selectedStep.weight;
        job.remainingWeight -= selectedStep.weight;
        if (selectedStep.exclusive)
          --job.remainingExclusiveSteps;
        job.stage->advanceWorkCursor(job.cursor);
        slotClosed = selectedStep.exclusive || usedWeight == slotWeightLimit;
      }
      if (records != nullptr)
        schedule_offsets_[slot + 1u] = actionCount;
    }
    return actionCount == schedule_action_count_;
  }

  [[nodiscard]] bool isImmediateSlot(std::uint32_t slot) const noexcept {
    return head_period_slots_ != 0u && slot % head_period_slots_ == head_period_slots_ - 1u;
  }

  [[nodiscard]] static std::uint8_t rotateRightOne(std::uint8_t value) noexcept {
    return static_cast<std::uint8_t>((value >> 1u) | (value << 7u));
  }

  [[nodiscard]] bool moveScheduledAction(
      ScheduledAction *records, std::uint32_t actionIndex, std::uint32_t targetSlot,
      std::uint64_t slotWeightLimit, std::array<std::uint64_t, kMaximumSchedulerSlots> &slotWeights,
      std::array<std::uint32_t, kMaximumSchedulerSlots> &slotActionCounts,
      std::array<std::uint32_t, kMaximumSchedulerSlots> &slotExclusiveCounts) const noexcept {
    ScheduledAction &action = records[actionIndex];
    if (action.commitsOutput || targetSlot == action.slot || isImmediateSlot(targetSlot))
      return false;
    if (action.exclusive ? slotActionCounts[targetSlot] != 0u
                         : slotExclusiveCounts[targetSlot] != 0u) {
      return false;
    }
    if (action.weight > slotWeightLimit - slotWeights[targetSlot])
      return false;

    slotWeights[action.slot] -= action.weight;
    --slotActionCounts[action.slot];
    if (action.exclusive)
      --slotExclusiveCounts[action.slot];
    slotWeights[targetSlot] += action.weight;
    ++slotActionCounts[targetSlot];
    if (action.exclusive)
      ++slotExclusiveCounts[targetSlot];
    action.slot = targetSlot;
    return true;
  }

  [[nodiscard]] bool validateScheduledActions(const ScheduledAction *records,
                                              std::uint64_t slotWeightLimit) const noexcept {
    std::array<std::uint64_t, kMaximumSchedulerSlots> slotWeights{};
    std::array<std::uint32_t, kMaximumSchedulerSlots> slotActionCounts{};
    std::array<std::uint32_t, kMaximumSchedulerSlots> slotExclusiveCounts{};
    for (std::uint32_t index = 0u; index < schedule_action_count_; ++index) {
      const ScheduledAction &action = records[index];
      if (action.slot < action.startSlot || action.slot >= action.deadlineSlot ||
          isImmediateSlot(action.slot)) {
        return false;
      }
      if (action.previousAction != kInvalidAction &&
          records[action.previousAction].slot > action.slot) {
        return false;
      }
      if (action.nextAction != kInvalidAction && records[action.nextAction].slot < action.slot)
        return false;
      slotWeights[action.slot] += action.weight;
      ++slotActionCounts[action.slot];
      if (action.exclusive)
        ++slotExclusiveCounts[action.slot];
    }
    for (std::uint32_t slot = 0u; slot < scheduler_cycle_slots_; ++slot) {
      if (slotWeights[slot] > slotWeightLimit || slotExclusiveCounts[slot] > 1u ||
          (slotExclusiveCounts[slot] != 0u && slotActionCounts[slot] != 1u)) {
        return false;
      }
    }
    return true;
  }

  [[nodiscard]] bool rephaseSchedule(ScheduledAction *records,
                                     std::uint64_t slotWeightLimit) noexcept {
    std::array<std::uint64_t, kMaximumSchedulerSlots> slotWeights{};
    std::array<std::uint32_t, kMaximumSchedulerSlots> slotActionCounts{};
    std::array<std::uint32_t, kMaximumSchedulerSlots> slotExclusiveCounts{};
    for (std::uint32_t index = 0u; index < schedule_action_count_; ++index) {
      const ScheduledAction &action = records[index];
      slotWeights[action.slot] += action.weight;
      ++slotActionCounts[action.slot];
      if (action.exclusive)
        ++slotExclusiveCounts[action.slot];
    }

    const std::uint32_t phase = rotateRightOne(static_cast<std::uint8_t>(config_.sliceOffset));
    const std::uint32_t phasePosition = phase <= 128u ? phase : 256u - phase;
    const auto bounds = [&](const ScheduledAction &action, std::uint32_t &earliest,
                            std::uint32_t &latest) {
      earliest = action.startSlot;
      if (action.previousAction != kInvalidAction) {
        const std::uint32_t previous = records[action.previousAction].slot;
        earliest = previous > earliest ? previous : earliest;
      }
      latest = action.deadlineSlot - 1u;
      if (action.nextAction != kInvalidAction) {
        const std::uint32_t next = records[action.nextAction].slot;
        latest = next < latest ? next : latest;
      }
    };

    for (std::uint32_t index = 0u; index < schedule_action_count_; ++index) {
      ScheduledAction &action = records[index];
      std::uint32_t earliest = 0u;
      std::uint32_t latest = 0u;
      bounds(action, earliest, latest);
      const std::uint32_t target =
          earliest + static_cast<std::uint32_t>(static_cast<std::uint64_t>(latest - earliest) *
                                                phasePosition / 128u);
      if (target >= action.slot)
        continue;
      for (std::uint32_t slot = target; slot < action.slot; ++slot) {
        if (moveScheduledAction(records, index, slot, slotWeightLimit, slotWeights,
                                slotActionCounts, slotExclusiveCounts)) {
          break;
        }
      }
    }
    for (std::uint32_t reverse = schedule_action_count_; reverse > 0u; --reverse) {
      const std::uint32_t index = reverse - 1u;
      ScheduledAction &action = records[index];
      std::uint32_t earliest = 0u;
      std::uint32_t latest = 0u;
      bounds(action, earliest, latest);
      const std::uint32_t target =
          earliest + static_cast<std::uint32_t>(static_cast<std::uint64_t>(latest - earliest) *
                                                phasePosition / 128u);
      if (target <= action.slot)
        continue;
      for (std::uint32_t slot = target; slot > action.slot; --slot) {
        if (moveScheduledAction(records, index, slot, slotWeightLimit, slotWeights,
                                slotActionCounts, slotExclusiveCounts)) {
          break;
        }
      }
    }

    std::uint32_t actionIndex = 0u;
    schedule_offsets_[0u] = 0u;
    for (std::uint32_t slot = 0u; slot < scheduler_cycle_slots_; ++slot) {
      for (std::uint32_t index = 0u; index < schedule_action_count_; ++index) {
        if (records[index].slot == slot)
          schedule_actions_[actionIndex++] = static_cast<std::uint8_t>(records[index].stageIndex);
      }
      schedule_offsets_[slot + 1u] = actionIndex;
    }
    return actionIndex == schedule_action_count_ &&
           validateScheduledActions(records, slotWeightLimit);
  }

  bool buildSchedule() noexcept {
    head_period_slots_ = 0u;
    scheduler_cycle_slots_ = 1u;
    std::uint64_t totalWeight = 0u;
    std::uint64_t maximumStepWeight = 0u;
    std::uint32_t totalActions = 0u;
    bool hasScheduledStage = false;
    for (std::uint32_t index = 0u; index < stage_count_; ++index) {
      const PartitionStage &stage = *stages_[index];
      const std::uint32_t period = stage.periodSlots();
      // Stage periods are powers of two, so the largest period is their common
      // repeating cycle and no runtime least-common-multiple work is needed.
      scheduler_cycle_slots_ = period > scheduler_cycle_slots_ ? period : scheduler_cycle_slots_;
      if (!stage.amortized()) {
        head_period_slots_ =
            head_period_slots_ == 0u || period < head_period_slots_ ? period : head_period_slots_;
        continue;
      }
      hasScheduledStage = true;
    }
    if (!hasScheduledStage) {
      schedule_offsets_.fill(0u);
#if defined(ET_ENABLE_TEST_KERNEL)
      schedule_weight_limit_ = 0u;
#endif
      return true;
    }
    if (scheduler_cycle_slots_ > kMaximumSchedulerSlots)
      return false;

    for (std::uint32_t index = 0u; index < stage_count_; ++index) {
      const PartitionStage &stage = *stages_[index];
      if (!stage.amortized())
        continue;
      const std::uint32_t occurrences = scheduler_cycle_slots_ / stage.periodSlots();
      totalWeight += stage.jobWorkWeight() * occurrences;
      totalActions += stage.jobStepCount() * occurrences;
      const std::uint64_t stageMaximum = stage.maximumStepWeight();
      maximumStepWeight = stageMaximum > maximumStepWeight ? stageMaximum : maximumStepWeight;
    }
    schedule_actions_ = new (std::nothrow) std::uint8_t[totalActions];
    if (schedule_actions_ == nullptr)
      return false;
    schedule_action_count_ = totalActions;
    if (!simulateSchedule(totalWeight))
      return false;

    std::uint64_t low = maximumStepWeight;
    std::uint64_t high = totalWeight;
    while (low < high) {
      const std::uint64_t middle = low + (high - low) / 2u;
      if (simulateSchedule(middle))
        high = middle;
      else
        low = middle + 1u;
    }
    ScheduledAction *records = new (std::nothrow) ScheduledAction[totalActions];
    if (records == nullptr)
      return false;
    const bool recorded = simulateSchedule(low, records);
    const bool rephased = recorded && rephaseSchedule(records, low);
    delete[] records;
#if defined(ET_ENABLE_TEST_KERNEL)
    schedule_weight_limit_ = low;
#endif
    return rephased;
  }

  void runScheduledSlot(bool immediateWork) noexcept {
    if (!immediateWork && schedule_actions_ != nullptr) {
      const std::uint32_t begin = schedule_offsets_[scheduler_slot_];
      const std::uint32_t end = schedule_offsets_[scheduler_slot_ + 1u];
      for (std::uint32_t action = begin; action < end; ++action) {
        const std::uint32_t stageIndex = schedule_actions_[action];
        stages_[stageIndex]->runScheduledStep(output_ring_, ring_size_, latency_);
      }
    }
    ++scheduler_slot_;
    if (scheduler_slot_ == scheduler_cycle_slots_)
      scheduler_slot_ = 0u;
  }

  [[nodiscard]] float renderDirect(std::uint32_t output) const noexcept {
    float value = 0.0F;
    for (std::uint32_t pathIndex = 0u; pathIndex < config_.pathCount; ++pathIndex) {
      const Path &path = config_.paths[pathIndex];
      if (path.output != output)
        continue;
      const float *history =
          direct_history_.data() + static_cast<std::size_t>(path.input) * kDirectHead;
      const float *taps =
          direct_taps_.data() + static_cast<std::size_t>(path.irChannel) * kDirectHead;
      value += input_frame_[path.input] * taps[0u];
      for (std::uint32_t tap = 1u; tap < kDirectHead; ++tap) {
        const std::uint32_t historyIndex =
            direct_position_ >= tap ? direct_position_ - tap : direct_position_ + kDirectHead - tap;
        value += history[historyIndex] * taps[tap];
      }
    }
    return value;
  }

  bool addSegment(std::uint32_t block, std::uint32_t offset, std::uint32_t end,
                  std::uint32_t irFrames) noexcept {
    if (offset >= irFrames || end <= offset)
      return true;
    if (stage_count_ >= kMaximumStages)
      return false;
    const std::uint32_t clippedEnd = end < irFrames ? end : irFrames;
    PartitionStage *stage = new (std::nothrow) PartitionStage();
    if (stage == nullptr ||
        !stage->reserve(block, offset, clippedEnd - offset, ir_channels_, config_)) {
      delete stage;
      return false;
    }
    stages_[stage_count_] = stage;
    ++stage_count_;
    return true;
  }

  bool addLadder(std::uint32_t headBlock, std::uint32_t ladderMaximum,
                 std::uint32_t irFrames) noexcept {
    const std::uint32_t headOffset = latency_ == 0u ? kDirectHead : 0u;
    if (!addSegment(headBlock, headOffset, 4u * headBlock, irFrames))
      return false;
    std::uint32_t block = 2u * headBlock;
    while (block < ladderMaximum) {
      if (!addSegment(block, 2u * block, 4u * block, irFrames))
        return false;
      block *= 2u;
    }
    return addSegment(ladderMaximum, 2u * ladderMaximum, irFrames, irFrames);
  }

  void releaseStorage() noexcept {
    for (std::uint32_t index = 0u; index < stage_count_; ++index) {
      delete stages_[index];
      stages_[index] = nullptr;
    }
    stage_count_ = 0u;
    direct_taps_.release();
    direct_history_.release();
    output_ring_.release();
    input_frame_.release();
    delete[] schedule_actions_;
    schedule_actions_ = nullptr;
    schedule_action_count_ = 0u;
    scheduler_cycle_slots_ = 1u;
    head_period_slots_ = 0u;
    config_ = {};
    ir_channels_ = 0u;
    ir_frames_ = 0u;
    stage_index_ = 0u;
    prepared_stages_ = 0u;
    preparation_samples_ = 0u;
    stream_history_samples_ = 0u;
    ring_size_ = 1u;
    latency_ = 0u;
    direct_position_ = 0u;
    timeline_ = 0u;
    scheduler_samples_ = 0u;
    scheduler_slot_ = 0u;
    slot_has_immediate_work_ = false;
    non_finite_ = false;
#if defined(ET_ENABLE_TEST_KERNEL)
    schedule_weight_limit_ = 0u;
#endif
  }

  InternalConfig config_;
  std::array<PartitionStage *, kMaximumStages> stages_{};
  std::uint32_t stage_count_ = 0u;
  AlignedFloats direct_taps_;
  AlignedFloats direct_history_;
  AlignedFloats output_ring_;
  AlignedFloats input_frame_;
  std::uint8_t *schedule_actions_ = nullptr;
  std::uint32_t schedule_action_count_ = 0u;
  std::array<std::uint32_t, kMaximumSchedulerSlots + 1u> schedule_offsets_{};
  std::uint32_t scheduler_cycle_slots_ = 1u;
  std::uint32_t head_period_slots_ = 0u;
  std::uint32_t scheduler_samples_ = 0u;
  std::uint32_t scheduler_slot_ = 0u;
  bool slot_has_immediate_work_ = false;
#if defined(ET_ENABLE_TEST_KERNEL)
  std::uint64_t schedule_weight_limit_ = 0u;
#endif
  std::uint32_t direct_position_ = 0u;
  std::uint32_t ring_size_ = 1u;
  std::uint32_t latency_ = 0u;
  std::uint64_t timeline_ = 0u;
  bool non_finite_ = false;
  std::uint32_t ir_channels_ = 0u;
  std::uint32_t ir_frames_ = 0u;
  std::uint32_t stage_index_ = 0u;
  std::uint32_t prepared_stages_ = 0u;
  std::uint32_t preparation_samples_ = 0u;
  std::uint64_t stream_history_samples_ = 0u;
  ConvolverPreparationState state_ = ConvolverPreparationState::empty;
};

PartitionedConvolver::PartitionedConvolver() noexcept : impl_(new(std::nothrow) Impl()) {}
PartitionedConvolver::~PartitionedConvolver() { delete impl_; }
PartitionedConvolver::PartitionedConvolver(PartitionedConvolver &&other) noexcept
    : impl_(std::exchange(other.impl_, nullptr)) {}
PartitionedConvolver &PartitionedConvolver::operator=(PartitionedConvolver &&other) noexcept {
  if (this != &other) {
    delete impl_;
    impl_ = std::exchange(other.impl_, nullptr);
  }
  return *this;
}

bool PartitionedConvolver::reserve(const ConvolverConfig &config) noexcept {
  return impl_ != nullptr && impl_->reserve(config);
}
bool PartitionedConvolver::updatePathsWithoutAllocation(const ConvolutionPath *paths,
                                                        std::uint32_t pathCount) noexcept {
  return impl_ != nullptr && impl_->updatePathsWithoutAllocation(paths, pathCount);
}
bool PartitionedConvolver::commit(const float *ir, std::uint32_t channels,
                                  std::uint32_t frames) noexcept {
  return impl_ != nullptr && impl_->commit(ir, channels, frames);
}
ConvolverPreparationState
PartitionedConvolver::prepareSlice(std::uint32_t partitionBudget) noexcept {
  return impl_ == nullptr ? ConvolverPreparationState::error : impl_->prepareSlice(partitionBudget);
}
void PartitionedConvolver::clear() noexcept {
  if (impl_ != nullptr)
    impl_->clear();
}
void PartitionedConvolver::reset() noexcept {
  if (impl_ != nullptr)
    impl_->reset();
}
void PartitionedConvolver::process(float *audio, std::uint32_t channels,
                                   std::uint32_t frames) noexcept {
  if (impl_ != nullptr)
    impl_->process(audio, channels, frames);
}
std::size_t PartitionedConvolver::memoryBytes() const noexcept {
  return impl_ == nullptr ? 0u : impl_->memoryBytes();
}
#if defined(ET_ENABLE_TEST_KERNEL)
std::uint64_t PartitionedConvolver::deadlineRecoveryCountForTesting() const noexcept {
  return impl_ == nullptr ? 0u : impl_->deadlineRecoveryCountForTesting();
}
ConvolverScheduleTrace PartitionedConvolver::scheduleTraceForTesting() const noexcept {
  return impl_ == nullptr ? ConvolverScheduleTrace{} : impl_->scheduleTraceForTesting();
}
#endif
std::uint32_t PartitionedConvolver::latencySamples() const noexcept {
  return impl_ == nullptr ? 0u : impl_->latencySamples();
}
ConvolverPreparationState PartitionedConvolver::state() const noexcept {
  return impl_ == nullptr ? ConvolverPreparationState::error : impl_->state();
}

} // namespace effetune::dsp
