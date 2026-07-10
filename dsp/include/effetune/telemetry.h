#ifndef EFFETUNE_TELEMETRY_H
#define EFFETUNE_TELEMETRY_H

#include <cstddef>
#include <cstdint>

namespace effetune {

constexpr std::uint32_t kTelemetryHeaderBytes = 16;
constexpr std::uint16_t kTelemetryFlagDropped = 1u << 0u;

class TelemetryRing {
public:
  void adopt(std::uint8_t *storage, std::uint32_t capacity) noexcept;
  void reset() noexcept;

  bool write(std::uint16_t frame_type, std::uint16_t format_version, std::uint32_t tap_id,
             std::uint32_t sequence, const void *payload, std::uint16_t payload_bytes,
             std::uint16_t flags = 0) noexcept;
  std::uint32_t read(std::uint8_t *output, std::uint32_t max_bytes,
                     std::uint32_t *dropped_frames) noexcept;

  [[nodiscard]] std::uint32_t capacity() const noexcept { return capacity_; }
  [[nodiscard]] std::uint32_t size() const noexcept { return used_; }

private:
  static std::uint32_t frameBytes(std::uint16_t payload_bytes) noexcept;
  bool discardOldest() noexcept;
  void copyIn(std::uint32_t offset, const void *source, std::uint32_t bytes) noexcept;
  void copyOut(std::uint32_t offset, void *target, std::uint32_t bytes) const noexcept;
  std::uint16_t readU16(std::uint32_t offset) const noexcept;

  std::uint8_t *storage_ = nullptr;
  std::uint32_t capacity_ = 0;
  std::uint32_t read_offset_ = 0;
  std::uint32_t write_offset_ = 0;
  std::uint32_t used_ = 0;
  std::uint32_t dropped_since_read_ = 0;
  bool drop_flag_pending_ = false;
};

class TelemetryWriter {
public:
  TelemetryWriter(TelemetryRing &ring, std::uint32_t tap_id, std::uint32_t &sequence) noexcept
      : ring_(ring), tap_id_(tap_id), sequence_(sequence) {}

  bool write(std::uint16_t frame_type, std::uint16_t format_version, const void *payload,
             std::uint16_t payload_bytes, std::uint16_t flags = 0) noexcept {
    const std::uint32_t sequence = sequence_++;
    return ring_.write(frame_type, format_version, tap_id_, sequence, payload, payload_bytes,
                       flags);
  }

private:
  TelemetryRing &ring_;
  std::uint32_t tap_id_;
  std::uint32_t &sequence_;
};

} // namespace effetune

#endif
