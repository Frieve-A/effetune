// Test-only ATRAC1 sound unit serialisation adapter.
//
// This header is compiled ONLY by native_test.cpp. It is intentionally kept out
// of kernel.cpp so that the production signal path never carries serialisation
// code: the simulator models the coding loss, not a real bitstream muxer.
//
// Provenance / IPR
// ----------------
// The 212-byte sound unit container is described in publicly available format
// documentation (block size mode per band, a BFU-amount selector, one 4-bit word
// length index and one 6-bit scale factor index per active BFU, followed by the
// packed two's-complement spectral words). The layout implemented below is a
// clean-room re-expression of that description; no code or table was copied from
// any LGPL implementation (atracdenc / ffmpeg).
//
// Byte-exact interoperability with a real ATRAC1 decoder is NOT claimed and is
// not achievable here: plan section 3.1 sanctions self-derived BFU boundary and
// BFU-amount tables, so the spectral field ordering of this adapter follows our
// own tables rather than the canonical ones. The adapter therefore serves as a
// self-consistency oracle (logical unit -> bytes -> logical unit, and the proof
// that every unit the encoder emits physically fits in 212 bytes). The external
// ffmpeg cross-check of plan section 7.3 is recorded as residual risk.
//
// Field order (self-defined, documented):
//   bits  0.. 1  block size mode, low band   (0 = long, 1 = short)
//   bits  2.. 3  block size mode, mid band
//   bits  4.. 5  block size mode, high band
//   bits  6.. 7  reserved, zero
//   bits  8..10  BFU amount index (indexes kBfuAmountTable)
//   bits 11..15  reserved, zero
//   then bfuCount x 4 bits IDWL, then bfuCount x 6 bits IDSF,
//   then for every BFU with a non-zero word length, specsPerBfu words of
//   WL bits each, MSB first, two's complement.
//
// The 16-bit header is smaller than the 40-bit fixed overhead that the bit
// budget of plan section 3.1 charges, so a unit that satisfies the budget always
// fits; the 24-bit slack is the container's own reserve and is left zeroed.

#pragma once

#include "atrac1_core.h"
#include "tables.h"

#include <array>
#include <cstddef>
#include <cstdint>

namespace effetune::md_simulator::test_adapter {

inline constexpr std::size_t kAeaHeaderBytes = 2048u;
inline constexpr std::size_t kAeaTitleBytes = 16u;

using SoundUnitBytes = std::array<std::uint8_t, kSoundUnitBytes>;

class BitWriter final {
public:
  explicit BitWriter(SoundUnitBytes &bytes) noexcept : bytes_(&bytes) { bytes_->fill(0u); }

  [[nodiscard]] bool write(std::uint32_t value, std::size_t bits) noexcept {
    if (bits == 0u || bits > 32u || position_ + bits > kSoundUnitBits) {
      overflow_ = true;
      return false;
    }
    for (std::size_t index = 0u; index < bits; ++index) {
      const std::size_t bit = bits - 1u - index;
      const std::uint32_t mask = 1u << bit;
      if ((value & mask) != 0u) {
        const std::size_t target = position_ + index;
        (*bytes_)[target >> 3u] =
            static_cast<std::uint8_t>((*bytes_)[target >> 3u] | (0x80u >> (target & 7u)));
      }
    }
    position_ += bits;
    return true;
  }

  [[nodiscard]] std::size_t position() const noexcept { return position_; }
  [[nodiscard]] bool overflow() const noexcept { return overflow_; }

private:
  SoundUnitBytes *bytes_ = nullptr;
  std::size_t position_ = 0u;
  bool overflow_ = false;
};

class BitReader final {
public:
  explicit BitReader(const SoundUnitBytes &bytes) noexcept : bytes_(&bytes) {}

  [[nodiscard]] std::uint32_t read(std::size_t bits) noexcept {
    if (bits == 0u || bits > 32u || position_ + bits > kSoundUnitBits) {
      overflow_ = true;
      return 0u;
    }
    std::uint32_t value = 0u;
    for (std::size_t index = 0u; index < bits; ++index) {
      const std::size_t source = position_ + index;
      const std::uint8_t byte = (*bytes_)[source >> 3u];
      const std::uint32_t bit = (byte >> (7u - (source & 7u))) & 1u;
      value = (value << 1u) | bit;
    }
    position_ += bits;
    return value;
  }

  [[nodiscard]] std::size_t position() const noexcept { return position_; }
  [[nodiscard]] bool overflow() const noexcept { return overflow_; }

private:
  const SoundUnitBytes *bytes_ = nullptr;
  std::size_t position_ = 0u;
  bool overflow_ = false;
};

// Serialises a logical sound unit. Returns the number of bits written, or 0 on
// any structural inconsistency (an out-of-range field or a unit that does not
// fit in 212 bytes).
[[nodiscard]] inline std::size_t packSoundUnit(const SoundUnit &unit,
                                               SoundUnitBytes &bytes) noexcept {
  BitWriter writer(bytes);
  if (unit.bfuAmountIndex >= kBfuAmountTable.size()) {
    return 0u;
  }
  if (unit.bfuCount != kBfuAmountTable[unit.bfuAmountIndex]) {
    return 0u;
  }
  for (std::size_t band = 0u; band < kBandCount; ++band) {
    if (unit.blockMode[band] > 1u) {
      return 0u;
    }
    (void)writer.write(unit.blockMode[band], 2u);
  }
  (void)writer.write(0u, 2u);
  (void)writer.write(unit.bfuAmountIndex, 3u);
  (void)writer.write(0u, 5u);

  for (std::size_t bfu = 0u; bfu < unit.bfuCount; ++bfu) {
    const int wordLength = static_cast<int>(unit.wordLength[bfu]);
    if (wordLength == 1 || wordLength > 16) {
      return 0u;
    }
    const std::uint32_t idwl = wordLength == 0 ? 0u : static_cast<std::uint32_t>(wordLength - 1);
    (void)writer.write(idwl, 4u);
  }
  for (std::size_t bfu = 0u; bfu < unit.bfuCount; ++bfu) {
    if (unit.scaleFactorIndex[bfu] >= kScaleFactor.size()) {
      return 0u;
    }
    (void)writer.write(unit.scaleFactorIndex[bfu], 6u);
  }
  for (std::size_t bfu = 0u; bfu < unit.bfuCount; ++bfu) {
    const std::size_t wordLength = unit.wordLength[bfu];
    if (wordLength == 0u) {
      continue;
    }
    // The block size mode is per band, so the layout has to be chosen per band
    // as well; a unit where only one band switched uses both layouts at once.
    const std::size_t start = bfuStart(bfu, unit.blockMode[bfuBand(bfu)] != 0u);
    const std::size_t count = kSpecsPerBfu[bfu];
    const std::int32_t bound = static_cast<std::int32_t>(1) << (wordLength - 1u);
    for (std::size_t index = 0u; index < count; ++index) {
      const std::int32_t quantized = unit.quantized[start + index];
      if (quantized < -bound || quantized > bound - 1) {
        return 0u;
      }
      const std::uint32_t mask = wordLength >= 32u ? 0xFFFFFFFFu : ((1u << wordLength) - 1u);
      (void)writer.write(static_cast<std::uint32_t>(quantized) & mask, wordLength);
    }
  }
  if (writer.overflow()) {
    return 0u;
  }
  return writer.position();
}

// Reverses packSoundUnit. Returns false when the byte image is structurally
// invalid.
[[nodiscard]] inline bool unpackSoundUnit(const SoundUnitBytes &bytes, SoundUnit &unit) noexcept {
  unit.clear();
  BitReader reader(bytes);
  for (std::size_t band = 0u; band < kBandCount; ++band) {
    const std::uint32_t mode = reader.read(2u);
    if (mode > 1u) {
      return false;
    }
    unit.blockMode[band] = static_cast<std::uint8_t>(mode);
  }
  if (reader.read(2u) != 0u) {
    return false;
  }
  const std::uint32_t amountIndex = reader.read(3u);
  if (amountIndex >= kBfuAmountTable.size()) {
    return false;
  }
  if (reader.read(5u) != 0u) {
    return false;
  }
  unit.bfuAmountIndex = static_cast<std::uint8_t>(amountIndex);
  unit.bfuCount = kBfuAmountTable[amountIndex];

  for (std::size_t bfu = 0u; bfu < unit.bfuCount; ++bfu) {
    const int idwl = static_cast<int>(reader.read(4u));
    unit.wordLength[bfu] = static_cast<std::uint8_t>(wordLengthForIdwl(idwl));
  }
  for (std::size_t bfu = 0u; bfu < unit.bfuCount; ++bfu) {
    unit.scaleFactorIndex[bfu] = static_cast<std::uint8_t>(reader.read(6u));
  }
  for (std::size_t bfu = 0u; bfu < unit.bfuCount; ++bfu) {
    const std::size_t wordLength = unit.wordLength[bfu];
    if (wordLength == 0u) {
      continue;
    }
    const std::size_t start = bfuStart(bfu, unit.blockMode[bfuBand(bfu)] != 0u);
    const std::size_t count = kSpecsPerBfu[bfu];
    const std::uint32_t signBit = 1u << (wordLength - 1u);
    for (std::size_t index = 0u; index < count; ++index) {
      const std::uint32_t raw = reader.read(wordLength);
      const std::int32_t value =
          (raw & signBit) != 0u
              ? static_cast<std::int32_t>(raw) - static_cast<std::int32_t>(signBit << 1u)
              : static_cast<std::int32_t>(raw);
      unit.quantized[start + index] = value;
    }
  }
  if (reader.overflow()) {
    return false;
  }
  unit.usedBits = static_cast<std::uint32_t>(reader.position());
  return true;
}

// Writes the 2048-byte AEA container header used by the developer-side ffmpeg
// diagnostic. Clean-room implementation of the publicly documented layout:
// a four byte magic, a NUL padded title, the little-endian total sound unit
// count at offset 260 and the channel count at offset 264.
inline void writeAeaHeader(std::array<std::uint8_t, kAeaHeaderBytes> &header, const char *title,
                           std::uint32_t soundUnits, std::uint32_t channels) noexcept {
  header.fill(0u);
  header[0] = 0x00u;
  header[1] = 0x08u;
  header[2] = 0x00u;
  header[3] = 0x00u;
  for (std::size_t index = 0u; index < kAeaTitleBytes && title != nullptr; ++index) {
    const char character = title[index];
    if (character == '\0') {
      break;
    }
    header[4u + index] = static_cast<std::uint8_t>(character);
  }
  header[260u] = static_cast<std::uint8_t>(soundUnits & 0xFFu);
  header[261u] = static_cast<std::uint8_t>((soundUnits >> 8u) & 0xFFu);
  header[262u] = static_cast<std::uint8_t>((soundUnits >> 16u) & 0xFFu);
  header[263u] = static_cast<std::uint8_t>((soundUnits >> 24u) & 0xFFu);
  header[264u] = static_cast<std::uint8_t>(channels & 0xFFu);
}

} // namespace effetune::md_simulator::test_adapter
