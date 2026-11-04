#ifndef EFFETUNE_SFZ_EFFECT_PLAN_H
#define EFFETUNE_SFZ_EFFECT_PLAN_H
#include "SFZEffectsSchema.h"
#include "sfz_effect_buses.h"
#include <bit>
#include <span>

namespace effetune::plugins::others::sfz {
struct EffectImpulseReference {
  std::uint32_t sampleOffsetOrId = 0, frames = 0, channels = 0, rate = 0;
};
class EffectPlan {
public:
  // The bank owns the immutable words. Validation precedes all effect storage
  // allocation and includes the actual host's output capacity, not only its max.
  template <class CurveExists>
  bool assign(std::span<const std::uint32_t> words, std::uint32_t regions,
              std::uint32_t sampleExtent, std::uint32_t channels, CurveExists curveExists,
              bool streamed = true) noexcept {
    words_ = {};
    if (words.size() < fxschema::kHeaderWords || words[0] != fxschema::kVersion ||
        words[1] != regions || words[2] > fxschema::kMaximumNodes ||
        words[3] > fxschema::kMaximumRoutes || words[19] != 0 || channels == 0 || channels > 16)
      return false;
    const std::uint64_t regionOffset = fxschema::kHeaderWords;
    const auto nodeOffset =
        regionOffset + static_cast<std::uint64_t>(regions) * fxschema::kRegionWords;
    const auto parameterOffset =
        nodeOffset + static_cast<std::uint64_t>(words[2]) * fxschema::kNodeWords;
    const auto routeOffset = parameterOffset + words[4];
    const auto impulseOffset =
        routeOffset + static_cast<std::uint64_t>(words[3]) * fxschema::kRouteWords;
    const auto end =
        impulseOffset + static_cast<std::uint64_t>(words[21]) * fxschema::kImpulseWords;
    if (words[5] != regionOffset || words[6] != nodeOffset || words[7] != parameterOffset ||
        words[8] != routeOffset || words[20] != impulseOffset || words[21] > words[2] ||
        end != words.size())
      return false;
    for (auto index = 0u; index < words[21]; ++index) {
      const auto offset = impulseOffset + index * fxschema::kImpulseWords;
      const auto source = words[offset], frames = words[offset + 1], count = words[offset + 2],
                 rate = words[offset + 3];
      if (!frames || (count != 1 && count != 2) || rate < 1 || rate > 768000 ||
          (streamed
               ? source >= sampleExtent
               : static_cast<std::uint64_t>(source) + static_cast<std::uint64_t>(frames) * count >
                     sampleExtent))
        return false;
    }
    for (auto index = 10u; index < 19; ++index)
      if (!gain(value(words[index])))
        return false;
    auto requiredOutputs = 1u;
    for (auto index = 0u; index < regions; ++index) {
      const auto offset = regionOffset + index * fxschema::kRegionWords;
      const auto output = words[offset];
      if (!EffectBuses::outputAvailable(output, channels))
        return false;
      if (output + 1 > requiredOutputs)
        requiredOutputs = output + 1;
      for (auto send = 1u; send < 5; ++send)
        if (!gain(value(words[offset + send])))
          return false;
    }
    auto firstParameter = 0u, firstRoute = 0u;
    for (auto index = 0u; index < words[2]; ++index) {
      const auto offset = nodeOffset + index * fxschema::kNodeWords;
      const auto type = words[offset], bus = words[offset + 1];
      if (type == 0 || type > fxschema::kTypes.size() || bus >= EffectBuses::kBusCount ||
          (bus < EffectBuses::kFirstSend && !EffectBuses::outputAvailable(bus, channels)))
        return false;
      if (bus < EffectBuses::kFirstSend && bus + 1 > requiredOutputs)
        requiredOutputs = bus + 1;
      const auto &spec = fxschema::kTypes[type - 1];
      const auto count = words[offset + 3], routes = words[offset + 5];
      if (count != spec.parameterCount || words[offset + 2] != firstParameter ||
          words[offset + 4] != firstRoute || count > words[4] - firstParameter ||
          routes > words[3] - firstRoute || words[offset + 7] > 156)
        return false;
      const auto impulse = words[offset + 6];
      if (type == static_cast<unsigned>(fxschema::Type::tdfir) ? impulse >= words[21]
                                                               : impulse != UINT32_MAX)
        return false;
      for (auto parameter = 0u; parameter < count; ++parameter) {
        const auto &range = fxschema::kParameters[spec.firstParameter + parameter];
        const auto v = value(words[parameterOffset + firstParameter + parameter]);
        if (!std::isfinite(v) || v < range.minimum || v > range.maximum ||
            (range.integer && v != std::floor(v)) ||
            (range.options && !(range.options & (1ULL << static_cast<unsigned>(v)))))
          return false;
      }
      if (type == static_cast<unsigned>(fxschema::Type::staticNoise)) {
        const auto maximum = static_cast<unsigned>(fxschema::Parameter::static_random_maxtime);
        const auto minimum = static_cast<unsigned>(fxschema::Parameter::static_random_mintime);
        if (value(words[parameterOffset + firstParameter + maximum]) <
            value(words[parameterOffset + firstParameter + minimum]))
          return false;
      }
      for (auto route = 0u; route < routes; ++route) {
        const auto position =
            routeOffset + static_cast<std::uint64_t>(firstRoute + route) * fxschema::kRouteWords;
        const auto parameter = words[position], source = words[position + 1],
                   curve = words[position + 3];
        if (parameter >= count || source > 155 || curve > 255 || (curve >= 4 && curve <= 6) ||
            (curve >= 7 && !curveExists(curve)) || !std::isfinite(value(words[position + 2])) ||
            !nonnegative(value(words[position + 4])) || !nonnegative(value(words[position + 5])) ||
            fxschema::kParameters[spec.firstParameter + parameter].integer)
          return false;
      }
      firstParameter += count;
      firstRoute += routes;
    }
    if (firstParameter != words[4] || firstRoute != words[3] || requiredOutputs != words[9])
      return false;
    words_ = words;
    return true;
  }
  [[nodiscard]] std::uint32_t nodeCount() const noexcept { return words_.empty() ? 0 : words_[2]; }
  [[nodiscard]] std::uint32_t impulseCount() const noexcept {
    return words_.empty() ? 0 : words_[21];
  }
  [[nodiscard]] EffectImpulseReference impulse(std::uint32_t index) const noexcept {
    const auto offset = words_[20] + index * fxschema::kImpulseWords;
    return {words_[offset], words_[offset + 1], words_[offset + 2], words_[offset + 3]};
  }
  [[nodiscard]] std::uint32_t regionCount() const noexcept {
    return words_.empty() ? 0 : words_[1];
  }
  [[nodiscard]] EffectRegionRouting region(std::uint32_t index) const noexcept {
    const auto offset = words_[5] + index * fxschema::kRegionWords;
    return {words_[offset],
            {value(words_[offset + 1]), value(words_[offset + 2]), value(words_[offset + 3]),
             value(words_[offset + 4])}};
  }
  [[nodiscard]] EffectReturnRouting returns() const noexcept {
    return {value(words_[10]),
            {value(words_[11]), value(words_[12]), value(words_[13]), value(words_[14])},
            {value(words_[15]), value(words_[16]), value(words_[17]), value(words_[18])}};
  }
  [[nodiscard]] std::span<const std::uint32_t> node(std::uint32_t index) const noexcept {
    return words_.subspan(words_[6] + index * fxschema::kNodeWords, fxschema::kNodeWords);
  }
  [[nodiscard]] float parameter(std::span<const std::uint32_t> node,
                                unsigned index) const noexcept {
    return value(words_[words_[7] + node[2] + index]);
  }
  [[nodiscard]] std::span<const std::uint32_t>
  routes(std::span<const std::uint32_t> node) const noexcept {
    return words_.subspan(words_[8] + node[4] * fxschema::kRouteWords,
                          node[5] * fxschema::kRouteWords);
  }
  static float value(std::uint32_t word) noexcept { return std::bit_cast<float>(word); }

private:
  static bool gain(float value) noexcept { return nonnegative(value) && value <= 1; }
  static bool nonnegative(float value) noexcept { return std::isfinite(value) && value >= 0; }
  std::span<const std::uint32_t> words_;
};
} // namespace effetune::plugins::others::sfz
#endif
