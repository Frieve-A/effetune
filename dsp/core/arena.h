#ifndef EFFETUNE_CORE_ARENA_H
#define EFFETUNE_CORE_ARENA_H

#include "effetune/abi.h"

#include <cstddef>
#include <cstdint>

namespace effetune {

class Arena {
public:
  static constexpr std::uint32_t kBusCount = 5;
  static constexpr std::uint32_t kScratchCount = 4;
  static constexpr std::uint32_t kByteScratchBytes = 4096;
  static constexpr std::uint32_t kMaximumBytes = 64u * 1024u * 1024u;

  Arena() = default;
  ~Arena();
  Arena(const Arena &) = delete;
  Arena &operator=(const Arena &) = delete;

  static std::uint32_t memoryRequired(float sample_rate, std::uint32_t max_channels,
                                      std::uint32_t max_frames,
                                      std::uint32_t telemetry_ring_bytes) noexcept;

  et_status prepare(float sample_rate, std::uint32_t max_channels, std::uint32_t max_frames,
                    std::uint32_t telemetry_ring_bytes) noexcept;
  void clear() noexcept;
  void release() noexcept;

  [[nodiscard]] bool prepared() const noexcept { return storage_ != nullptr; }
  [[nodiscard]] float *combined() noexcept { return bus(0); }
  [[nodiscard]] float *bus(std::uint32_t index) noexcept;
  [[nodiscard]] float *scratch(std::uint32_t index) noexcept;
  [[nodiscard]] char *byteScratch() noexcept;
  [[nodiscard]] std::uint8_t *telemetryStorage() noexcept;
  [[nodiscard]] std::uint8_t *telemetryStaging() noexcept;
  [[nodiscard]] std::uint32_t telemetryCapacity() const noexcept { return telemetry_capacity_; }
  [[nodiscard]] std::uint32_t slabFloatCount() const noexcept { return slab_float_count_; }
  [[nodiscard]] std::uint32_t allocatedBytes() const noexcept { return allocated_bytes_; }

private:
  static constexpr std::uint32_t alignUp(std::uint32_t value, std::uint32_t alignment) noexcept {
    return (value + alignment - 1u) & ~(alignment - 1u);
  }

  std::byte *storage_ = nullptr;
  std::uint32_t allocated_bytes_ = 0;
  std::uint32_t slab_float_count_ = 0;
  std::uint32_t slab_bytes_ = 0;
  std::uint32_t byte_scratch_offset_ = 0;
  std::uint32_t telemetry_offset_ = 0;
  std::uint32_t telemetry_staging_offset_ = 0;
  std::uint32_t telemetry_capacity_ = 0;
};

} // namespace effetune

#endif
