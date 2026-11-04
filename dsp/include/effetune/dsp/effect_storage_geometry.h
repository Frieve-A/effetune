#ifndef EFFETUNE_DSP_EFFECT_STORAGE_GEOMETRY_H
#define EFFETUNE_DSP_EFFECT_STORAGE_GEOMETRY_H
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace effetune::dsp {
inline std::size_t effectKernelStorageUnits(std::size_t bytes) noexcept {
  return (bytes + sizeof(std::max_align_t) - 1) / sizeof(std::max_align_t);
}
inline std::uint32_t chorusDelayFrames(double rate) noexcept {
  return static_cast<std::uint32_t>(std::ceil(rate * .052)) + 4;
}
inline std::uint32_t fdnDelayFrames(double rate) noexcept {
  const auto frames = std::ceil(rate * .175);
  return frames < 1 ? 1 : static_cast<std::uint32_t>(frames);
}
inline std::uint32_t fdnPredelayFrames(double rate) noexcept {
  const auto frames = std::ceil(rate * .1);
  return frames < 1 ? 1 : static_cast<std::uint32_t>(frames);
}
inline std::uint64_t chorusStorageBytes(double rate, std::uint32_t channels) noexcept {
  return static_cast<std::uint64_t>(chorusDelayFrames(rate)) * channels * sizeof(float) +
         static_cast<std::uint64_t>(channels) * sizeof(double);
}
inline std::uint64_t fdnStorageBytes(double rate) noexcept {
  return (8ull * fdnDelayFrames(rate) + fdnPredelayFrames(rate)) * sizeof(float);
}
} // namespace effetune::dsp
#endif
