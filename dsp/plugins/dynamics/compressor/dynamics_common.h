#ifndef EFFETUNE_PLUGINS_DYNAMICS_COMMON_H
#define EFFETUNE_PLUGINS_DYNAMICS_COMMON_H

#include "effetune/dsp/smoothing.h"
#include "effetune/telemetry.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

namespace effetune::plugins::dynamics::detail {

constexpr double kMinimumEnvelope = 1.0e-6;
constexpr double kLog10Times20 = 8.685889638065035;
constexpr double kGainFactor = 0.11512925464970229;
constexpr double kLog2 = 0.6931471805599453;
constexpr std::uint16_t kTapGainReduction = 2u;
constexpr std::uint16_t kTelemetryVersion = 1u;

inline void setLegacyEnvelopeCoefficients(dsp::AttackReleaseEnvelope &envelope, float attack_ms,
                                          float release_ms, double sample_rate) noexcept {
  double attack_samples = static_cast<double>(attack_ms) * sample_rate / 1000.0;
  if (attack_samples < 1.0) {
    attack_samples = 1.0;
  }
  double release_samples = static_cast<double>(release_ms) * sample_rate / 1000.0;
  if (release_samples < 1.0) {
    release_samples = 1.0;
  }
  const double attack_decay = std::exp(-kLog2 / attack_samples);
  const double release_decay = std::exp(-kLog2 / release_samples);
  envelope.setCoefficients(1.0 - attack_decay, 1.0 - release_decay);
}

inline void resetEnvelope(dsp::AttackReleaseEnvelope &envelope) noexcept {
  envelope.reset(static_cast<double>(static_cast<float>(kMinimumEnvelope)));
}

inline void persistEnvelopeAsFloat(dsp::AttackReleaseEnvelope &envelope) noexcept {
  envelope.reset(static_cast<double>(static_cast<float>(envelope.value())));
}

inline void writeGainReductionTelemetry(TelemetryWriter &writer, float amount_db) noexcept {
  std::array<std::uint8_t, 4u> payload{};
  std::uint32_t bits = 0u;
  static_assert(sizeof(bits) == sizeof(amount_db));
  std::memcpy(&bits, &amount_db, sizeof(bits));
  payload[0] = static_cast<std::uint8_t>(bits & 0xffu);
  payload[1] = static_cast<std::uint8_t>((bits >> 8u) & 0xffu);
  payload[2] = static_cast<std::uint8_t>((bits >> 16u) & 0xffu);
  payload[3] = static_cast<std::uint8_t>(bits >> 24u);
  writer.write(kTapGainReduction, kTelemetryVersion, payload.data(),
               static_cast<std::uint16_t>(payload.size()));
}

class CompressorExpanderLookup final {
public:
  void prepare() {
    db_lookup_.resize(kDbLookupSize);
    exp_lookup_.resize(kExpLookupSize);

    minimum_db_ = kLog10Times20 * std::log(kMinimumEnvelope);
    for (std::uint32_t index = 0u; index < kDbLookupSize; ++index) {
      const double linear = static_cast<double>(index) / kDbLookupScale;
      db_lookup_[index] = static_cast<float>(
          linear < kMinimumEnvelope ? minimum_db_ : kLog10Times20 * std::log(linear));
    }

    minimum_gain_ = std::exp(kExpMinimumDb * kGainFactor);
    maximum_gain_ = std::exp(kExpMaximumDb * kGainFactor);
    for (std::uint32_t index = 0u; index < kExpLookupSize; ++index) {
      const double decibels = kExpMinimumDb + static_cast<double>(index) / kExpLookupScale;
      exp_lookup_[index] = static_cast<float>(std::exp(decibels * kGainFactor));
    }
  }

  [[nodiscard]] double decibels(double linear) const noexcept {
    if (linear < kMinimumEnvelope) {
      return minimum_db_;
    }
    const double scaled = linear * kDbLookupScale;
    const std::uint32_t index = scaled >= static_cast<double>(kDbLookupSize - 1u)
                                    ? kDbLookupSize - 1u
                                    : static_cast<std::uint32_t>(scaled);
    return static_cast<double>(db_lookup_[index]);
  }

  [[nodiscard]] double gain(double decibels) const noexcept {
    if (decibels <= kExpMinimumDb) {
      return minimum_gain_;
    }
    if (decibels >= kExpMaximumDb) {
      return maximum_gain_;
    }
    const double scaled = (decibels - kExpMinimumDb) * kExpLookupScale;
    const std::uint32_t index = scaled >= static_cast<double>(kExpLookupSize - 1u)
                                    ? kExpLookupSize - 1u
                                    : static_cast<std::uint32_t>(scaled);
    return static_cast<double>(exp_lookup_[index]);
  }

private:
  static constexpr std::uint32_t kDbLookupSize = 4096u;
  static constexpr double kDbLookupScale = 4096.0 / 10.0;
  static constexpr std::uint32_t kExpLookupSize = 4096u;
  static constexpr double kExpMinimumDb = -60.0;
  static constexpr double kExpMaximumDb = 20.0;
  static constexpr double kExpLookupScale = 4096.0 / 80.0;

  std::vector<float> db_lookup_;
  std::vector<float> exp_lookup_;
  double minimum_db_ = 0.0;
  double minimum_gain_ = 0.0;
  double maximum_gain_ = 1.0;
};

class GateLookup final {
public:
  void prepare() {
    db_lookup_.resize(kDbLookupSize);
    exp_lookup_.resize(kExpLookupSize);
    for (std::uint32_t index = 0u; index < kDbLookupSize; ++index) {
      const double linear = static_cast<double>(index) / kDbLookupScale;
      db_lookup_[index] = static_cast<float>(
          linear < kMinimumEnvelope ? kMinimumDb : kLog10Times20 * std::log(linear));
    }
    for (std::uint32_t index = 0u; index < kExpLookupSize; ++index) {
      const double decibels = static_cast<double>(index) / kExpLookupScale;
      exp_lookup_[index] = static_cast<float>(std::exp(-decibels * kGainFactor));
    }
  }

  [[nodiscard]] double decibels(double linear) const noexcept {
    if (linear < kMinimumEnvelope) {
      return kMinimumDb;
    }
    const double scaled = linear * kDbLookupScale;
    const std::uint32_t index = scaled >= static_cast<double>(kDbLookupSize - 1u)
                                    ? kDbLookupSize - 1u
                                    : static_cast<std::uint32_t>(scaled);
    return static_cast<double>(db_lookup_[index]);
  }

  [[nodiscard]] double reductionGain(double reduction_db) const noexcept {
    if (reduction_db >= 60.0) {
      return static_cast<double>(exp_lookup_[kExpLookupSize - 1u]);
    }
    const double scaled = reduction_db * kExpLookupScale;
    std::uint32_t index = scaled <= 0.0 ? 0u : static_cast<std::uint32_t>(scaled);
    if (index >= kExpLookupSize) {
      index = kExpLookupSize - 1u;
    }
    return static_cast<double>(exp_lookup_[index]);
  }

private:
  static constexpr std::uint32_t kDbLookupSize = 4096u;
  static constexpr double kDbLookupScale = 4096.0 / 10.0;
  static constexpr double kMinimumDb = -96.0;
  static constexpr std::uint32_t kExpLookupSize = 2048u;
  static constexpr double kExpLookupScale = 2048.0 / 60.0;

  std::vector<float> db_lookup_;
  std::vector<float> exp_lookup_;
};

} // namespace effetune::plugins::dynamics::detail

#endif
