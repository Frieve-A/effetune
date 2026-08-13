#ifndef EFFETUNE_PLUGINS_DYNAMICS_MULTIBAND_TELEMETRY_H
#define EFFETUNE_PLUGINS_DYNAMICS_MULTIBAND_TELEMETRY_H

#include "binary_io.h"
#include "effetune/telemetry.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace effetune::plugins::dynamics::multiband_telemetry {

constexpr std::uint16_t kFrameType = 13u;
constexpr std::uint16_t kVersion = 1u;
constexpr std::size_t kMaximumBands = 5u;

enum class ValueKind : std::uint8_t {
  GainReduction = 0u,
  ExpansionMagnitude = 1u,
  TransientGain = 2u,
};

using binary_io::writeF32;

template <std::size_t BandCount>
void write(TelemetryWriter &writer, ValueKind kind,
           const std::array<float, BandCount> &values) noexcept {
  static_assert(BandCount > 0u && BandCount <= kMaximumBands);
  std::array<std::uint8_t, 4u + kMaximumBands * sizeof(float)> payload{};
  payload[0] = static_cast<std::uint8_t>(BandCount);
  payload[1] = static_cast<std::uint8_t>(kind);
  for (std::size_t band = 0u; band < BandCount; ++band) {
    writeF32(payload.data() + 4u + band * sizeof(float), values[band]);
  }
  writer.write(kFrameType, kVersion, payload.data(),
               static_cast<std::uint16_t>(4u + BandCount * sizeof(float)));
}

} // namespace effetune::plugins::dynamics::multiband_telemetry

#endif
