#include "effetune/dsp/partitioned_convolver.h"

#include <pffft.h>

#include <cmath>
#include <cstring>
#include <new>
#include <utility>

namespace effetune::dsp {
namespace {

constexpr std::uint32_t kDirectHead = 128u;
constexpr std::uint32_t kLadderMaximum = 4096u;
constexpr std::uint32_t kMaximumStages = 8u;
constexpr std::size_t kPffftFactorCount = 25u;
using Path = ConvolutionPath;

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
  PartitionStage() = default;
  ~PartitionStage() { release(); }
  PartitionStage(const PartitionStage &) = delete;
  PartitionStage &operator=(const PartitionStage &) = delete;

  bool reserve(std::uint32_t blockSize, std::uint32_t offset, std::uint32_t segmentFrames,
               std::uint32_t stageIndex, std::uint32_t irChannels,
               const InternalConfig &config) noexcept {
    release();
    block_size_ = blockSize;
    fft_size_ = 2u * blockSize;
    offset_ = offset;
    partitions_ = (segmentFrames + blockSize - 1u) / blockSize;
    inputs_ = config.inputs;
    outputs_ = config.outputs;
    path_count_ = config.pathCount;
    ir_channels_ = irChannels;
    segment_frames_ = segmentFrames;
    for (std::uint32_t index = 0u; index < path_count_; ++index)
      paths_[index] = config.paths[index];
    amortized_ = blockSize >= 256u && offset >= 2u * blockSize;
    phase_seed_ = config.sliceOffset + offset / 128u + stageIndex * 5u;
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
    job_window_slice_ = 0u;
    job_slice_samples_ = 0u;
    job_mac_units_ = 0u;
  }

  void push(const float *inputFrame, AlignedFloats &outputRing, std::uint32_t ringSize,
            std::uint32_t latency) noexcept {
    for (std::uint32_t input = 0u; input < inputs_; ++input)
      input_blocks_[static_cast<std::size_t>(input) * block_size_ + fill_] = inputFrame[input];
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
           fft_input_.bytes() + fft_work_.bytes() + input_fdl_.bytes() + ir_spectra_.bytes() +
           accumulators_.bytes() + inverse_.bytes() + pffftSetupBytes(fft_size_);
  }
  [[nodiscard]] std::uint32_t blockSize() const noexcept { return block_size_; }
  [[nodiscard]] std::uint32_t offset() const noexcept { return offset_; }

  bool updatePathsWithoutAllocation(const Path *paths, std::uint32_t pathCount) noexcept {
    if (paths == nullptr || pathCount != path_count_)
      return false;
    for (std::uint32_t index = 0u; index < pathCount; ++index)
      paths_[index] = paths[index];
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
    const std::uint32_t totalUnits = path_count_ * partitions_;
    if (targetUnit > totalUnits)
      targetUnit = totalUnits;
    while (job_mac_units_ < targetUnit) {
      const std::uint32_t pathIndex = job_mac_units_ / partitions_;
      const std::uint32_t partition = job_mac_units_ % partitions_;
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
    accumulateUntil(path_count_ * partitions_, fdl_write_);
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
    const std::uint32_t totalUnits = path_count_ * partitions_;
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
    const std::uint32_t totalUnits = path_count_ * partitions_;
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

  std::uint32_t block_size_ = 0u;
  std::uint32_t fft_size_ = 0u;
  std::uint32_t offset_ = 0u;
  std::uint32_t partitions_ = 0u;
  std::uint32_t inputs_ = 0u;
  std::uint32_t outputs_ = 0u;
  std::uint32_t path_count_ = 0u;
  std::uint32_t ir_channels_ = 0u;
  std::array<Path, ConvolverConfig::kMaximumPaths> paths_{};
  bool amortized_ = false;
  std::uint32_t phase_seed_ = 0u;
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
    if (!addLadder(headBlock, config.irFrames)) {
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
    preparation_quantum_ = 0u;
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
      reset();
      state_ = ConvolverPreparationState::active;
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
    non_finite_ = false;
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    if (audio == nullptr || channels < config_.inputs || channels < config_.outputs || frames == 0u)
      return;
    if (state_ == ConvolverPreparationState::preparing) {
      preparation_samples_ += frames;
      while (preparation_samples_ >= 128u && state_ == ConvolverPreparationState::preparing) {
        preparation_samples_ -= 128u;
        const std::uint32_t budget =
            ((preparation_quantum_ + config_.sliceOffset) & 1u) == 0u ? 2u : 1u;
        ++preparation_quantum_;
        prepareSlice(budget);
      }
      std::memset(audio, 0, static_cast<std::size_t>(channels) * frames * sizeof(float));
      return;
    }
    if (state_ != ConvolverPreparationState::active) {
      std::memset(audio, 0, static_cast<std::size_t>(channels) * frames * sizeof(float));
      return;
    }
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      for (std::uint32_t input = 0u; input < config_.inputs; ++input)
        input_frame_[input] = audio[static_cast<std::size_t>(input) * frames + frame];

      for (std::uint32_t index = 0u; index < stage_count_; ++index)
        stages_[index]->push(input_frame_.data(), output_ring_, ring_size_, latency_);

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
    }
  }

  [[nodiscard]] std::size_t memoryBytes() const noexcept {
    std::size_t bytes = sizeof(*this) + output_ring_.bytes() + direct_taps_.bytes() +
                        direct_history_.bytes() + input_frame_.bytes();
    for (std::uint32_t index = 0u; index < stage_count_; ++index)
      bytes += sizeof(PartitionStage) + stages_[index]->memoryBytes();
    return bytes;
  }

private:
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
        !stage->reserve(block, offset, clippedEnd - offset, stage_count_, ir_channels_, config_)) {
      delete stage;
      return false;
    }
    stages_[stage_count_] = stage;
    ++stage_count_;
    return true;
  }

  bool addLadder(std::uint32_t headBlock, std::uint32_t irFrames) noexcept {
    const std::uint32_t headOffset = latency_ == 0u ? kDirectHead : 0u;
    if (!addSegment(headBlock, headOffset, 4u * headBlock, irFrames))
      return false;
    std::uint32_t block = 2u * headBlock;
    while (block < kLadderMaximum) {
      if (!addSegment(block, 2u * block, 4u * block, irFrames))
        return false;
      block *= 2u;
    }
    return addSegment(kLadderMaximum, 2u * kLadderMaximum, irFrames, irFrames);
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
    config_ = {};
    ir_channels_ = 0u;
    ir_frames_ = 0u;
    stage_index_ = 0u;
    prepared_stages_ = 0u;
    preparation_samples_ = 0u;
    preparation_quantum_ = 0u;
    ring_size_ = 1u;
    latency_ = 0u;
    direct_position_ = 0u;
    timeline_ = 0u;
    non_finite_ = false;
  }

  InternalConfig config_;
  std::array<PartitionStage *, kMaximumStages> stages_{};
  std::uint32_t stage_count_ = 0u;
  AlignedFloats direct_taps_;
  AlignedFloats direct_history_;
  AlignedFloats output_ring_;
  AlignedFloats input_frame_;
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
  std::uint64_t preparation_quantum_ = 0u;
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
std::uint32_t PartitionedConvolver::latencySamples() const noexcept {
  return impl_ == nullptr ? 0u : impl_->latencySamples();
}
ConvolverPreparationState PartitionedConvolver::state() const noexcept {
  return impl_ == nullptr ? ConvolverPreparationState::error : impl_->state();
}

} // namespace effetune::dsp
