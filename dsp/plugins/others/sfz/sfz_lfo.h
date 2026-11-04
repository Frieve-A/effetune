#ifndef EFFETUNE_SFZ_LFO_H
#define EFFETUNE_SFZ_LFO_H
#include <cmath>
#include <cstdint>
#include <limits>

namespace effetune::plugins::others::sfz::modulation {
// Derived memoization only: identical arguments retain the exact library result.
// Each prepared instance uses one operation (LFO sine or physical pitch/cutoff exp2).
struct ScalarMathCache {
  double argument = std::numeric_limits<double>::quiet_NaN(), result = 0;
  double sine(double value) noexcept {
    if (argument != value) {
      argument = value;
      result = std::sin(value);
    }
    return result;
  }
  double exponential(double value) noexcept {
    if (argument != value) {
      argument = value;
      result = std::exp2(value);
    }
    return result;
  }
};
inline float finiteModulationValue(double value) noexcept {
  constexpr double limit = std::numeric_limits<float>::max();
  return std::isnan(value) ? 0.0F
                           : static_cast<float>(value < -limit  ? -limit
                                                : value > limit ? limit
                                                                : value);
}
struct RampState {
  double remaining = 0;
  float current = 0, target = 0;
  bool initialized = false;
};
inline float tickRamp(RampState &s, float target, float milliseconds, double seconds) noexcept {
  if (!s.initialized) {
    s.current = s.target = target;
    s.initialized = true;
    return target;
  }
  if (target != s.target) {
    s.target = target;
    s.remaining = milliseconds * .001;
  }
  if (s.remaining <= seconds) {
    s.current = s.target;
    s.remaining = 0;
  } else {
    s.current = finiteModulationValue(s.current + (static_cast<double>(s.target) - s.current) *
                                                      seconds / s.remaining);
    s.remaining -= seconds;
  }
  return s.current;
}
struct LfoState {
  double phase = 0, cycles = 0, elapsed = 0, initialPhase = 0;
  float delay = 0, fade = 0, randomValue = 0, current = 0;
  std::uint32_t random = 1;
  std::uint64_t randomCell = UINT64_MAX;
  RampState smoothing{};
};
struct LfoParameters {
  float frequency = 0, delay = 0, fade = 0, phase = 0, ratio = 1, scale = 1, offset = 0, smooth = 0;
  int wave = 1, count = -1;
  std::uint32_t steps = 0;
};
inline void resetLfo(LfoState &s, const LfoParameters &p, std::uint32_t seed) noexcept {
  s = {};
  s.phase = p.phase - std::floor(p.phase);
  s.initialPhase = s.phase;
  s.delay = p.delay;
  s.fade = p.fade;
  s.random = seed ? seed : 1;
}
inline float lfoRandom(LfoState &s, std::uint64_t cell) noexcept {
  if (cell != s.randomCell) {
    s.random ^= s.random << 13;
    s.random ^= s.random >> 17;
    s.random ^= s.random << 5;
    s.randomValue = static_cast<float>(s.random >> 8) * (2.0F / 16777215.0F) - 1.0F;
    s.randomCell = cell;
  }
  return s.randomValue;
}
template <class StepAt>
inline float lfoWave(LfoState &s, const LfoParameters &p, StepAt stepAt,
                     ScalarMathCache *cache = nullptr) noexcept {
  const auto phase = s.phase;
  if (p.steps || p.wave == 13) {
    if (!p.steps)
      return 0;
    auto index = static_cast<std::uint32_t>(phase * p.steps);
    if (index >= p.steps)
      index = p.steps - 1;
    return stepAt(index);
  }
  switch (p.wave) {
  case 0:
    return static_cast<float>(phase < .25   ? phase * 4
                              : phase < .75 ? 2 - phase * 4
                                            : phase * 4 - 4);
  case 1:
    return static_cast<float>(cache ? cache->sine(6.2831853071795864769 * phase)
                                    : std::sin(6.2831853071795864769 * phase));
  case 2:
    return phase < .75 ? 1.0F : -1.0F;
  case 3:
    return phase < .5 ? 1.0F : -1.0F;
  case 4:
    return phase < .25 ? 1.0F : -1.0F;
  case 5:
    return phase < .125 ? 1.0F : -1.0F;
  case 6:
    return static_cast<float>(phase * 2 - 1);
  case 7:
    return static_cast<float>(1 - phase * 2);
  case -1:
  case 12:
    return lfoRandom(s, static_cast<std::uint64_t>(std::floor((s.cycles + s.initialPhase) * 2)));
  default:
    return 0;
  }
}
template <class StepAt>
inline float tickLfo(LfoState &s, const LfoParameters &p, StepAt stepAt, double seconds,
                     ScalarMathCache *cache = nullptr) noexcept {
  if (s.elapsed < s.delay) {
    s.elapsed += seconds;
    return s.current = 0;
  }
  if (p.count >= 0 && s.cycles >= p.count) {
    s.elapsed += seconds;
    return s.current = 0;
  }
  const auto fade = s.fade > 0 ? (s.elapsed - s.delay) / s.fade : 1.0;
  const auto wave =
      finiteModulationValue(lfoWave(s, p, stepAt, cache) * static_cast<double>(p.scale) + p.offset);
  const auto output =
      tickRamp(s.smoothing, wave, p.smooth, seconds) * static_cast<float>(fade < 1 ? fade : 1);
  const double advance = p.frequency * static_cast<double>(p.ratio) * seconds;
  s.phase += advance;
  s.phase -= std::floor(s.phase);
  const auto cycles = s.cycles + advance;
  s.cycles = p.count < 0 ? (cycles < 4294967296.0 ? cycles : std::fmod(cycles, 4294967296.0))
                         : (cycles > p.count ? p.count : cycles);
  s.elapsed += seconds;
  return s.current = output;
}
} // namespace effetune::plugins::others::sfz::modulation
#endif
