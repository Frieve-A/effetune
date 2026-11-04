#pragma once
#include <cmath>
#include <cstdint>
#include <span>

namespace effetune::plugins::others::sfz::amplifier {
struct CurvePoint {
  std::uint32_t velocity = 0;
  float amplitude = 0;
};
struct PanSettings {
  float keyTrack = 0, keyCenter = 60, velocityTrack = 0, random = 0;
  std::uint32_t law = 0, invert = 0;
};
struct PositionSettings {
  float keyTrack = 0, keyCenter = 60, velocityTrack = 0, random = 0;
};
struct Crossfade {
  std::uint32_t source = 0;
  float inLow = 0, inHigh = 0, outLow = 127, outHigh = 127;
  std::uint32_t power = 1;
};
struct StereoGains {
  float left = 1, right = 1;
};
inline float bounded(float value, float low, float high) noexcept {
  return value < low ? low : value > high ? high : value;
}

// Authored points override the standard squared velocity response. Missing
// endpoints are 0/0 and 127/1; interpolation is linear in amplitude.
inline float velocityCurve(float velocity, std::span<const CurvePoint> points) noexcept {
  velocity = bounded(velocity, 0, 127);
  if (points.empty()) {
    const float normalized = velocity / 127;
    return normalized * normalized;
  }
  CurvePoint low{0, 0}, high{127, 1};
  for (const auto &point : points) {
    if (point.velocity <= velocity && point.velocity >= low.velocity)
      low = point;
    if (point.velocity >= velocity && point.velocity <= high.velocity)
      high = point;
  }
  if (low.velocity == high.velocity)
    return low.amplitude;
  const float fraction = (velocity - static_cast<float>(low.velocity)) /
                         static_cast<float>(high.velocity - low.velocity);
  return low.amplitude + (high.amplitude - low.amplitude) * fraction;
}
// Reference-inferred signed response. Tracking is normalized here and is not
// clamped: random tracking offsets may cross zero or exceed ordinary depth.
inline float velocityResponse(float curve, float normalizedTrack) noexcept {
  if (normalizedTrack == 1.0F)
    return curve;
  const float complement = 1.0F - curve;
  return normalizedTrack >= 0 ? 1.0F - normalizedTrack * complement : normalizedTrack * complement;
}
inline float velocityGain(float velocity, float track,
                          std::span<const CurvePoint> points = {}) noexcept {
  return velocityResponse(velocityCurve(velocity, points), track * .01F);
}

// An independent counter-based birth draw. The immutable seed and voice age are
// already checkpointed; reconstruction does not consume the pan/CC135 RNG stream.
inline float velocityBirthRandom(std::uint32_t seed, std::uint64_t age) noexcept {
  std::uint64_t value = age + (static_cast<std::uint64_t>(seed) << 32u) + 0x56454c545241434bull;
  value = (value ^ (value >> 30u)) * 0xbf58476d1ce4e5b9ull;
  value = (value ^ (value >> 27u)) * 0x94d049bb133111ebull;
  value ^= value >> 31u;
  return static_cast<float>(value >> 40u) * (1.0F / 16777216.0F);
}

// Birth-only tracking adds to the ordinary dynamic pan target. Random uses the
// existing voice's signed random fact, not a second random generator.
inline float panOffset(const PanSettings &settings, float musicalKey, float velocity,
                       float signedRandom) noexcept {
  return (musicalKey - settings.keyCenter) * settings.keyTrack +
         velocity / 127 * settings.velocityTrack + bounded(signedRandom, -1, 1) * settings.random;
}
// Unlike pan random, measured position random uses a one-sided birth fact.
// Return the unclamped offset: the caller adds the dynamic position before clamp.
inline double positionOffset(const PositionSettings &settings, float musicalKey, float velocity,
                             float unipolarRandom) noexcept {
  return (static_cast<double>(musicalKey) - settings.keyCenter) * settings.keyTrack +
         static_cast<double>(velocity) / 127 * settings.velocityTrack +
         static_cast<double>(bounded(unipolarRandom, 0, 1)) * settings.random;
}
inline StereoGains panGains(float pan, std::uint32_t law) noexcept {
  pan = bounded(pan, -100, 100) * .01F;
  if (law == 2) {
    const float angle = (pan + 1) * .7853981633974483F;
    return {std::cos(angle), std::sin(angle)};
  }
  // Explicit balance keeps the nearer channel unchanged. Law zero remains the
  // existing engine policy and must be selected by the caller before this call.
  return {pan > 0 ? 1 - pan : 1, pan < 0 ? 1 + pan : 1};
}
inline float phaseGain(const PanSettings &settings) noexcept {
  return settings.invert ? -1.0F : 1.0F;
}

inline float crossfadeGain(const Crossfade &settings, float value) noexcept {
  const float rising =
      settings.inHigh <= settings.inLow
          ? (value >= settings.inHigh ? 1.F : 0.F)
          : bounded((value - settings.inLow) / (settings.inHigh - settings.inLow), 0, 1);
  const float falling =
      settings.outHigh <= settings.outLow
          ? (value <= settings.outLow ? 1.F : 0.F)
          : bounded((settings.outHigh - value) / (settings.outHigh - settings.outLow), 0, 1);
  const float gain = rising * falling;
  return settings.power ? std::sqrt(gain) : gain;
}
template <class Controller>
float crossfadeGain(std::span<const Crossfade> settings, float musicalKey, float velocity,
                    Controller &&rawController) noexcept {
  float gain = 1;
  for (const auto &fade : settings)
    gain *= crossfadeGain(fade, fade.source == 0   ? musicalKey
                                : fade.source == 1 ? velocity
                                                   : rawController(fade.source - 2));
  return gain;
}
} // namespace effetune::plugins::others::sfz::amplifier
