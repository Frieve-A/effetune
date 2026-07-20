#ifndef EFFETUNE_EXPERIMENTS_LONG_CONVOLUTION_PROTOTYPE_H
#define EFFETUNE_EXPERIMENTS_LONG_CONVOLUTION_PROTOTYPE_H

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string_view>
#include <vector>

namespace effetune::experiments::long_convolution {

enum class Partitioning { twoStage, ladder, workerOffload };
enum class StageRole { complete, residentHead, deferredTail };

struct Path {
  std::uint32_t input;
  std::uint32_t output;
  std::uint32_t irChannel;
};

struct Config {
  Partitioning partitioning = Partitioning::twoStage;
  StageRole stageRole = StageRole::complete;
  std::uint32_t latencySamples = 128u;
  std::uint32_t sliceOffset = 0u;
  std::uint32_t inputs = 2u;
  std::uint32_t outputs = 2u;
  std::vector<Path> paths;
};

struct QuantumTiming {
  double medianMicroseconds = 0.0;
  double worstMicroseconds = 0.0;
};

class PrototypeConvolver {
public:
  PrototypeConvolver();
  ~PrototypeConvolver();
  PrototypeConvolver(PrototypeConvolver &&) noexcept;
  PrototypeConvolver &operator=(PrototypeConvolver &&) noexcept;
  PrototypeConvolver(const PrototypeConvolver &) = delete;
  PrototypeConvolver &operator=(const PrototypeConvolver &) = delete;

  bool prepare(const Config &config, const std::vector<std::vector<float>> &irChannels);
  void reset() noexcept;
  void process(float *channelMajorAudio, std::uint32_t channels, std::uint32_t frames) noexcept;
  bool processDeferredBlock(float *channelMajorAudio, std::uint32_t channels) noexcept;
  [[nodiscard]] std::size_t memoryBytes() const noexcept;
  [[nodiscard]] std::uint32_t latencySamples() const noexcept;
  [[nodiscard]] bool sawNonFinite() const noexcept;

private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

std::vector<float> directReference(const Config &config,
                                   const std::vector<std::vector<float>> &irChannels,
                                   const std::vector<float> &input, std::uint32_t frames);
std::string_view partitioningName(Partitioning value) noexcept;

} // namespace effetune::experiments::long_convolution

#endif
