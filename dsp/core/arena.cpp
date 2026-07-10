#include "arena.h"

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>

namespace effetune {
namespace {

constexpr std::uint32_t kAlignment = 16;
constexpr std::uint32_t kSlabCount = Arena::kBusCount + Arena::kScratchCount;

bool validConfiguration(float sample_rate, std::uint32_t max_channels,
                        std::uint32_t max_frames) noexcept {
  return std::isfinite(sample_rate) && sample_rate > 0.0F && max_channels > 0u &&
         max_channels <= 8u && max_frames >= 32u;
}

} // namespace

Arena::~Arena() { release(); }

std::uint32_t Arena::memoryRequired(float sample_rate, std::uint32_t max_channels,
                                    std::uint32_t max_frames,
                                    std::uint32_t telemetry_ring_bytes) noexcept {
  if (!validConfiguration(sample_rate, max_channels, max_frames)) {
    return 0;
  }

  const std::uint64_t slab_floats = static_cast<std::uint64_t>(max_channels) * max_frames;
  const std::uint64_t slab_bytes = slab_floats * sizeof(float);
  const std::uint64_t telemetry_bytes =
      telemetry_ring_bytes == 0u ? 0u
                                 : (static_cast<std::uint64_t>(telemetry_ring_bytes) + 3u) & ~3ull;
  const std::uint64_t total =
      slab_bytes * kSlabCount + kByteScratchBytes + telemetry_bytes * 2u + kAlignment * 3u;
  if (slab_floats > std::numeric_limits<std::uint32_t>::max() || total > kMaximumBytes ||
      total > std::numeric_limits<std::uint32_t>::max()) {
    return 0;
  }
  return static_cast<std::uint32_t>(total);
}

et_status Arena::prepare(float sample_rate, std::uint32_t max_channels, std::uint32_t max_frames,
                         std::uint32_t telemetry_ring_bytes) noexcept {
  const std::uint32_t required =
      memoryRequired(sample_rate, max_channels, max_frames, telemetry_ring_bytes);
  if (required == 0u) {
    return ET_ERR_ARGS;
  }

  release();
  storage_ = static_cast<std::byte *>(std::malloc(required));
  if (storage_ == nullptr) {
    return ET_ERR_OOM;
  }

  allocated_bytes_ = required;
  slab_float_count_ = max_channels * max_frames;
  slab_bytes_ = slab_float_count_ * static_cast<std::uint32_t>(sizeof(float));
  byte_scratch_offset_ = alignUp(slab_bytes_ * kSlabCount, kAlignment);
  telemetry_offset_ = alignUp(byte_scratch_offset_ + kByteScratchBytes, kAlignment);
  telemetry_capacity_ = telemetry_ring_bytes == 0u ? 0u : alignUp(telemetry_ring_bytes, 4u);
  telemetry_staging_offset_ = alignUp(telemetry_offset_ + telemetry_capacity_, kAlignment);
  clear();
  return ET_OK;
}

void Arena::clear() noexcept {
  if (storage_ != nullptr) {
    std::memset(storage_, 0, allocated_bytes_);
  }
}

void Arena::release() noexcept {
  std::free(storage_);
  storage_ = nullptr;
  allocated_bytes_ = 0;
  slab_float_count_ = 0;
  slab_bytes_ = 0;
  byte_scratch_offset_ = 0;
  telemetry_offset_ = 0;
  telemetry_staging_offset_ = 0;
  telemetry_capacity_ = 0;
}

float *Arena::bus(std::uint32_t index) noexcept {
  if (storage_ == nullptr || index >= kBusCount) {
    return nullptr;
  }
  return reinterpret_cast<float *>(storage_ + index * slab_bytes_);
}

float *Arena::scratch(std::uint32_t index) noexcept {
  if (storage_ == nullptr || index >= kScratchCount) {
    return nullptr;
  }
  const std::uint32_t slab_index = kBusCount + index;
  return reinterpret_cast<float *>(storage_ + slab_index * slab_bytes_);
}

char *Arena::byteScratch() noexcept {
  return storage_ == nullptr ? nullptr : reinterpret_cast<char *>(storage_ + byte_scratch_offset_);
}

std::uint8_t *Arena::telemetryStorage() noexcept {
  return storage_ == nullptr || telemetry_capacity_ == 0u
             ? nullptr
             : reinterpret_cast<std::uint8_t *>(storage_ + telemetry_offset_);
}

std::uint8_t *Arena::telemetryStaging() noexcept {
  return storage_ == nullptr || telemetry_capacity_ == 0u
             ? nullptr
             : reinterpret_cast<std::uint8_t *>(storage_ + telemetry_staging_offset_);
}

} // namespace effetune
