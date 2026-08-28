#ifndef EFFETUNE_DSP_PARTITIONED_CONVOLVER_H
#define EFFETUNE_DSP_PARTITIONED_CONVOLVER_H

#include <array>
#include <cstddef>
#include <cstdint>

namespace effetune::dsp {

struct ConvolutionPath {
  std::uint32_t input;
  std::uint32_t output;
  std::uint32_t irChannel;
};

struct ConvolverConfig {
  static constexpr std::uint32_t kMaximumPaths = 16u;

  std::uint32_t latencySamples = 128u;
  std::uint32_t sliceOffset = 0u;
  std::uint32_t inputs = 2u;
  std::uint32_t outputs = 2u;
  std::uint32_t irChannels = 2u;
  std::uint32_t irFrames = 0u;
  std::uint32_t pathCount = 0u;
  std::array<ConvolutionPath, kMaximumPaths> paths{};
};

enum class ConvolverPreparationState { empty, reserved, preparing, warming, active, error };

#if defined(ET_ENABLE_TEST_KERNEL)
struct ConvolverScheduleTrace {
  static constexpr std::uint32_t kMaximumSlots = 256u;
  static constexpr std::uint32_t kSlotsPerCallback = 8u;
  static constexpr std::uint32_t kMaximumCallbacks = kMaximumSlots / kSlotsPerCallback;

  std::uint32_t cycleSlots = 0u;
  std::uint32_t callbackCount = 0u;
  std::uint64_t slotWeightLimit = 0u;
  std::array<std::uint64_t, kMaximumSlots> slotWeights{};
  std::array<std::uint32_t, kMaximumSlots> slotActionCounts{};
  std::array<std::uint64_t, kMaximumCallbacks> callbackWeights{};
  std::uint32_t immediateSlotViolationCount = 0u;
  std::uint32_t jobOrderViolationCount = 0u;
  std::uint32_t deadlineViolationCount = 0u;
  std::uint64_t deadlineRecoveryCount = 0u;
};
#endif

class PartitionedConvolver {
private:
  class Impl;

public:
  PartitionedConvolver() noexcept;
  ~PartitionedConvolver();
  PartitionedConvolver(PartitionedConvolver &&) noexcept;
  PartitionedConvolver &operator=(PartitionedConvolver &&) noexcept;
  PartitionedConvolver(const PartitionedConvolver &) = delete;
  PartitionedConvolver &operator=(const PartitionedConvolver &) = delete;

  bool reserve(const ConvolverConfig &config) noexcept;
  bool updatePathsWithoutAllocation(const ConvolutionPath *paths, std::uint32_t pathCount) noexcept;
  bool commit(const float *channelMajorIr, std::uint32_t channels, std::uint32_t frames) noexcept;
  ConvolverPreparationState prepareSlice(std::uint32_t partitionBudget = 1u) noexcept;
  void clear() noexcept;
  void reset() noexcept;
  void process(float *channelMajorAudio, std::uint32_t channels, std::uint32_t frames) noexcept;

  [[nodiscard]] ConvolverPreparationState state() const noexcept;
  [[nodiscard]] std::uint32_t latencySamples() const noexcept;
  [[nodiscard]] std::size_t memoryBytes() const noexcept;
#if defined(ET_ENABLE_TEST_KERNEL)
  [[nodiscard]] std::uint64_t deadlineRecoveryCountForTesting() const noexcept;
  [[nodiscard]] ConvolverScheduleTrace scheduleTraceForTesting() const noexcept;
#endif

private:
  Impl *impl_ = nullptr;
};

} // namespace effetune::dsp

#endif
