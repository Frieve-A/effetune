#include "effetune/telemetry.h"

#include <cstring>

namespace effetune {
namespace {

void writeU16(std::uint8_t *output, std::uint16_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>(value >> 8u);
}

void writeU32(std::uint8_t *output, std::uint32_t value) noexcept {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>((value >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((value >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(value >> 24u);
}

} // namespace

void TelemetryRing::adopt(std::uint8_t *storage, std::uint32_t capacity) noexcept {
  storage_ = storage;
  capacity_ = capacity & ~3u;
  reset();
}

void TelemetryRing::reset() noexcept {
  read_offset_ = 0;
  write_offset_ = 0;
  used_ = 0;
  dropped_since_read_ = 0;
  drop_flag_pending_ = false;
}

std::uint32_t TelemetryRing::frameBytes(std::uint16_t payload_bytes) noexcept {
  return (kTelemetryHeaderBytes + static_cast<std::uint32_t>(payload_bytes) + 3u) & ~3u;
}

void TelemetryRing::copyIn(std::uint32_t offset, const void *source, std::uint32_t bytes) noexcept {
  if (bytes == 0u) {
    return;
  }
  const auto *input = static_cast<const std::uint8_t *>(source);
  const std::uint32_t first = bytes < capacity_ - offset ? bytes : capacity_ - offset;
  std::memcpy(storage_ + offset, input, first);
  if (first < bytes) {
    std::memcpy(storage_, input + first, bytes - first);
  }
}

void TelemetryRing::copyOut(std::uint32_t offset, void *target,
                            std::uint32_t bytes) const noexcept {
  if (bytes == 0u) {
    return;
  }
  auto *output = static_cast<std::uint8_t *>(target);
  const std::uint32_t first = bytes < capacity_ - offset ? bytes : capacity_ - offset;
  std::memcpy(output, storage_ + offset, first);
  if (first < bytes) {
    std::memcpy(output + first, storage_, bytes - first);
  }
}

std::uint16_t TelemetryRing::readU16(std::uint32_t offset) const noexcept {
  std::uint8_t bytes[2]{};
  copyOut(offset, bytes, 2u);
  return static_cast<std::uint16_t>(bytes[0]) |
         static_cast<std::uint16_t>(static_cast<std::uint16_t>(bytes[1]) << 8u);
}

bool TelemetryRing::discardOldest() noexcept {
  if (used_ < kTelemetryHeaderBytes || capacity_ == 0u) {
    used_ = 0;
    read_offset_ = write_offset_;
    return false;
  }
  const std::uint32_t payload_offset = (read_offset_ + 12u) % capacity_;
  const std::uint32_t bytes = frameBytes(readU16(payload_offset));
  if (bytes > used_ || bytes > capacity_) {
    used_ = 0;
    read_offset_ = write_offset_;
    return false;
  }
  read_offset_ = (read_offset_ + bytes) % capacity_;
  used_ -= bytes;
  ++dropped_since_read_;
  drop_flag_pending_ = true;
  return true;
}

bool TelemetryRing::write(std::uint16_t frame_type, std::uint16_t format_version,
                          std::uint32_t tap_id, std::uint32_t sequence, const void *payload,
                          std::uint16_t payload_bytes, std::uint16_t flags) noexcept {
  const std::uint32_t bytes = frameBytes(payload_bytes);
  if (storage_ == nullptr || capacity_ < kTelemetryHeaderBytes || bytes > capacity_ ||
      (payload_bytes != 0u && payload == nullptr)) {
    ++dropped_since_read_;
    drop_flag_pending_ = true;
    return false;
  }

  while (capacity_ - used_ < bytes) {
    if (!discardOldest()) {
      ++dropped_since_read_;
      drop_flag_pending_ = true;
      return false;
    }
  }

  if (drop_flag_pending_) {
    flags = static_cast<std::uint16_t>(flags | kTelemetryFlagDropped);
    drop_flag_pending_ = false;
  }

  std::uint8_t header[kTelemetryHeaderBytes]{};
  writeU16(header, frame_type);
  writeU16(header + 2u, format_version);
  writeU32(header + 4u, tap_id);
  writeU32(header + 8u, sequence);
  writeU16(header + 12u, payload_bytes);
  writeU16(header + 14u, flags);
  copyIn(write_offset_, header, kTelemetryHeaderBytes);
  copyIn((write_offset_ + kTelemetryHeaderBytes) % capacity_, payload, payload_bytes);

  const std::uint32_t padding = bytes - kTelemetryHeaderBytes - payload_bytes;
  if (padding != 0u) {
    static constexpr std::uint8_t zeros[3]{};
    copyIn((write_offset_ + kTelemetryHeaderBytes + payload_bytes) % capacity_, zeros, padding);
  }
  write_offset_ = (write_offset_ + bytes) % capacity_;
  used_ += bytes;
  return true;
}

std::uint32_t TelemetryRing::read(std::uint8_t *output, std::uint32_t max_bytes,
                                  std::uint32_t *dropped_frames) noexcept {
  if (dropped_frames != nullptr) {
    *dropped_frames = dropped_since_read_;
  }
  dropped_since_read_ = 0;
  if (output == nullptr || max_bytes < kTelemetryHeaderBytes || storage_ == nullptr) {
    return 0;
  }

  std::uint32_t copied = 0;
  while (used_ >= kTelemetryHeaderBytes) {
    const std::uint32_t payload_offset = (read_offset_ + 12u) % capacity_;
    const std::uint32_t bytes = frameBytes(readU16(payload_offset));
    if (bytes > used_ || bytes > capacity_) {
      used_ = 0;
      read_offset_ = write_offset_;
      break;
    }
    if (bytes > max_bytes - copied) {
      break;
    }
    copyOut(read_offset_, output + copied, bytes);
    read_offset_ = (read_offset_ + bytes) % capacity_;
    used_ -= bytes;
    copied += bytes;
  }
  return copied;
}

} // namespace effetune
