#ifndef EFFETUNE_PLUGINS_DYNAMICS_GROUP_B_TELEMETRY_H
#define EFFETUNE_PLUGINS_DYNAMICS_GROUP_B_TELEMETRY_H

#include "binary_io.h"
#include "effetune/telemetry.h"

#include <array>
#include <cstdint>
#include <cstring>

namespace effetune::plugins::dynamics::group_b_detail {

constexpr std::uint16_t kTapGainReduction = 2u;
constexpr std::uint16_t kTapLoudnessLevels = 7u;
constexpr std::uint16_t kTapTransientGain = 8u;
constexpr std::uint16_t kTelemetryVersion = 1u;

using binary_io::writeF32;

inline void writeGainReduction(TelemetryWriter &writer, float amount_db) noexcept {
  std::array<std::uint8_t, 4u> payload{};
  writeF32(payload.data(), amount_db);
  writer.write(kTapGainReduction, kTelemetryVersion, payload.data(),
               static_cast<std::uint16_t>(payload.size()));
}

inline void writeLoudnessLevels(TelemetryWriter &writer, float input_lufs,
                                float output_lufs) noexcept {
  std::array<std::uint8_t, 8u> payload{};
  writeF32(payload.data(), input_lufs);
  writeF32(payload.data() + 4u, output_lufs);
  writer.write(kTapLoudnessLevels, kTelemetryVersion, payload.data(),
               static_cast<std::uint16_t>(payload.size()));
}

inline void writeTransientGain(TelemetryWriter &writer, float gain_db) noexcept {
  std::array<std::uint8_t, 4u> payload{};
  writeF32(payload.data(), gain_db);
  writer.write(kTapTransientGain, kTelemetryVersion, payload.data(),
               static_cast<std::uint16_t>(payload.size()));
}

} // namespace effetune::plugins::dynamics::group_b_detail

#endif
