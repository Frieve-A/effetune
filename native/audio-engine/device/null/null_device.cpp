#include "null_device.h"
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
} // namespace effetune::audio
