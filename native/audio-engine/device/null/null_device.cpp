#include "null_device.h"
#include <algorithm>
#include <bit>
#include <chrono>
#include <cstring>
#include <stdexcept>

namespace effetune::audio {
std::vector<std::uint8_t> NullDevice::render(std::span<const std::uint8_t> input,
                                             std::uint32_t frames) {
  return render(session, input, frames);
}
std::vector<std::uint8_t> NullDevice::render(Session &session, std::span<const std::uint8_t> input,
                                             std::uint32_t frames, std::uint64_t *processingNs) {
  static_assert(std::endian::native == std::endian::little && sizeof(float) == 4);
  const auto samples = std::size_t(frames) * session.format().width();
  if (!session.isOpen() || frames == 0 || input.size() != samples * sizeof(float))
    throw std::invalid_argument("invalid null render buffer");
  std::vector<float> planar(samples);
  std::memcpy(planar.data(), input.data(), input.size());
  const auto start = std::chrono::steady_clock::now();
  if (!session.render(planar, frames))
    throw std::runtime_error("null device callback failed");
  if (processingNs)
    *processingNs = std::chrono::duration_cast<std::chrono::nanoseconds>(
                        std::chrono::steady_clock::now() - start)
                        .count();
  std::vector<std::uint8_t> output(input.size());
  std::memcpy(output.data(), planar.data(), output.size());
  return output;
}
NullDevice::BenchmarkTiming
NullDevice::benchmark(Session &session, std::span<const float> blockLoop, std::uint32_t blockSize,
                      std::uint32_t warmupBlocks, std::uint64_t durationNs) {
  constexpr std::uint32_t batchBlocks = 1024;
  const auto channels = session.format().width();
  const auto blockSamples = std::size_t(blockSize) * channels;
  if (!session.isOpen() || !blockSamples || blockLoop.size() < blockSamples ||
      blockLoop.size() % blockSamples)
    throw std::invalid_argument("invalid benchmark input");
  const auto totalBlocks = blockLoop.size() / blockSamples;
  std::size_t blockIndex = 0;
  std::vector<float> batch;
  const auto render = [&](std::uint32_t blocks) {
    const auto frames = blocks * blockSize;
    batch.resize(std::size_t(frames) * channels);
    for (std::uint32_t block = 0; block < blocks; ++block) {
      const auto *source = blockLoop.data() + (blockIndex++ % totalBlocks) * blockSamples;
      for (std::uint32_t channel = 0; channel < channels; ++channel)
        std::copy_n(source + std::size_t(channel) * blockSize, blockSize,
                    batch.data() + std::size_t(channel) * frames + block * blockSize);
    }
    const auto start = std::chrono::steady_clock::now();
    if (!session.render(batch, frames))
      throw std::runtime_error("null device callback failed");
    return std::uint64_t(std::chrono::duration_cast<std::chrono::nanoseconds>(
                             std::chrono::steady_clock::now() - start)
                             .count());
  };
  if (warmupBlocks)
    render(warmupBlocks);
  BenchmarkTiming timing;
  while (timing.elapsedNs < durationNs) {
    const auto processingNs = render(batchBlocks);
    if (!processingNs)
      throw std::runtime_error("benchmark render reported no processing time");
    timing.elapsedNs += processingNs;
    timing.blocks += batchBlocks;
  }
  return timing;
}
} // namespace effetune::audio
