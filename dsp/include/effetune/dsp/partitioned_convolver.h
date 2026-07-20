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
  static constexpr std::uint32_t kMaximumPaths = 8u;

  std::uint32_t latencySamples = 128u;
  std::uint32_t sliceOffset = 0u;
  std::uint32_t inputs = 2u;
  std::uint32_t outputs = 2u;
  std::uint32_t irChannels = 2u;
  std::uint32_t irFrames = 0u;
  std::uint32_t pathCount = 0u;
  std::array<ConvolutionPath, kMaximumPaths> paths{};
};

enum class ConvolverPreparationState { empty, reserved, preparing, active, error };

class PartitionedConvolver {
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

private:
  class Impl;
  Impl *impl_ = nullptr;
};

} // namespace effetune::dsp

#endif
