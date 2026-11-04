#ifndef EFFETUNE_SFZ_ENVELOPES_H
#define EFFETUNE_SFZ_ENVELOPES_H
#include <cmath>
#include <cstdint>

namespace effetune::plugins::others::sfz::modulation {
// Independently defined normalized exponential profile. The shape sign describes
// the level curvature, including descending segments, rather than elapsed time.
inline float envelopeCurve(double position, float shape, bool rising) noexcept {
  if (position <= 0.0)
    return 0.0F;
  if (position >= 1.0)
    return 1.0F;
  const double exponent = rising ? -shape : shape;
  if (std::abs(exponent) < 1.0e-5)
    return static_cast<float>(position);
  return static_cast<float>(std::expm1(exponent * position) / std::expm1(exponent));
}
inline double envelopeCurveInverse(float level, float shape, bool rising) noexcept {
  const double exponent = rising ? -shape : shape;
  if (std::abs(exponent) < 1.0e-5)
    return level;
  return std::log1p(level * std::expm1(exponent)) / exponent;
}
struct EnvelopeState {
  double elapsed = 0.0, duration = 0.0, offset = 0.0, requestedDuration = 0.0, stageTime = 0.0;
  float current = 0.0F, start = 0.0F, target = 0.0F, shape = 0.0F, endLevel = 0.0F;
  std::uint32_t stage = 0, loops = 0, curve = 0;
  bool released = false, done = false, holding = false;
};
struct FixedEnvelopeParameters {
  float delay = 0, start = 0, attack = 0, hold = 0, decay = 0, sustain = 100, release = .001F;
  float attackShape = 0, decayShape = -10.3616F, releaseShape = -10.3616F;
  bool dynamic = false, decayZero = true, releaseZero = false;
};
struct LinearEnvelopeCurve {
  float operator()(std::uint32_t, float x) const noexcept { return x; }
};
template <class CurveAt = LinearEnvelopeCurve>
inline float envelopeSegment(const EnvelopeState &s, CurveAt curveAt = {}) noexcept {
  const double position = s.duration > 0 ? (s.elapsed + s.offset) / s.duration : 1.0;
  return s.start + (s.target - s.start) *
                       curveAt(s.curve, envelopeCurve(position, s.shape, s.target > s.start));
}
inline void enterFixedEnvelope(EnvelopeState &s, std::uint32_t stage,
                               const FixedEnvelopeParameters &p) noexcept {
  s.stage = stage;
  s.elapsed = s.offset = s.stageTime = 0;
  s.start = s.current;
  s.shape = 0;
  s.holding = stage == 4;
  switch (stage) {
  case 0:
    s.duration = p.delay;
    s.start = s.target = s.current = 0;
    break;
  case 1:
    s.duration = p.attack;
    s.start = p.start * .01F;
    s.target = 1;
    s.shape = p.attackShape;
    break;
  case 2:
    s.duration = p.hold;
    s.start = s.target = 1;
    break;
  case 3:
    s.duration = p.decay;
    s.start = 1;
    s.target = p.decayZero ? 0 : p.sustain * .01F;
    s.shape = p.decayShape;
    break;
  case 4:
    s.duration = 0;
    s.current = s.start = s.target = p.sustain * .01F;
    break;
  case 5:
    s.duration = p.release;
    s.target = 0;
    s.shape = p.releaseShape;
    if (p.releaseZero) {
      s.start = 1;
      s.offset = s.duration * envelopeCurveInverse(1 - s.current, s.shape, false);
    }
    break;
  default:
    s.done = true;
    s.current = 0;
    break;
  }
  s.requestedDuration = s.duration;
  s.endLevel = stage == 3 ? p.sustain * .01F : s.target;
}
inline void resetFixedEnvelope(EnvelopeState &s, const FixedEnvelopeParameters &p) noexcept {
  s = {};
  enterFixedEnvelope(s, 0, p);
}
inline void releaseFixedEnvelope(EnvelopeState &s, const FixedEnvelopeParameters &p) noexcept {
  if (s.done || s.released)
    return;
  s.released = true;
  enterFixedEnvelope(s, 5, p);
}
inline float tickFixedEnvelope(EnvelopeState &s, const FixedEnvelopeParameters &p,
                               double seconds) noexcept {
  if (s.done)
    return 0;
  if (p.dynamic) {
    const double durations[] = {p.delay, p.attack, p.hold, p.decay, 0, p.release};
    const float newTarget = s.stage == 3   ? (p.decayZero ? 0 : p.sustain * .01F)
                            : s.stage == 4 ? p.sustain * .01F
                                           : s.target;
    // Preserve the level when controller changes alter an active segment.
    if (durations[s.stage] != s.requestedDuration || newTarget != s.target) {
      s.duration = durations[s.stage];
      s.requestedDuration = s.duration;
      s.target = newTarget;
      const double remaining = s.duration > s.stageTime ? s.duration - s.stageTime : 0;
      s.start = s.current;
      s.duration = remaining;
      s.elapsed = s.offset = 0;
      if (s.stage == 4)
        s.current = newTarget;
    }
    if (s.stage == 3)
      s.endLevel = p.sustain * .01F;
  }
  for (unsigned transition = 0; transition < 7; ++transition) {
    if (s.stage == 4)
      return s.current;
    s.current = envelopeSegment(s);
    if (s.stage == 3 && s.current <= s.endLevel) {
      const auto sustain = s.endLevel;
      enterFixedEnvelope(s, 4, p);
      s.current = s.start = s.target = sustain;
      return s.current;
    }
    if (s.elapsed + s.offset < s.duration)
      break;
    if (s.stage == 5) {
      s.done = true;
      return s.current = 0;
    }
    enterFixedEnvelope(s, s.stage + 1, p);
  }
  const auto output = s.current;
  s.elapsed += seconds;
  s.stageTime += seconds;
  return output;
}
struct FlexibleEnvelopeParameters {
  std::uint32_t points = 0, sustain = 0;
  int loop = -1;
  std::uint32_t loopCount = 0;
  bool dynamic = false;
};
struct EnvelopePoint {
  float time = 0, level = 0, shape = 0;
  std::uint32_t curve = 0;
};
template <class PointAt>
inline void enterFlexibleEnvelope(EnvelopeState &s, std::uint32_t point, PointAt pointAt) noexcept {
  const auto p = pointAt(point);
  s.stage = point;
  s.start = s.current;
  s.target = p.level;
  s.duration = p.time;
  s.requestedDuration = p.time;
  s.shape = p.shape;
  s.curve = p.curve;
  s.elapsed = s.offset = s.stageTime = 0;
  s.holding = false;
}
template <class PointAt>
inline void resetFlexibleEnvelope(EnvelopeState &s, const FlexibleEnvelopeParameters &p,
                                  PointAt pointAt) noexcept {
  s = {};
  if (!p.points) {
    s.done = true;
    return;
  }
  s.current = pointAt(0).level;
  if (p.sustain == 0) {
    s.target = s.current;
    s.holding = true;
  } else if (p.points > 1)
    enterFlexibleEnvelope(s, 1, pointAt);
  else
    s.done = true;
}
template <class PointAt>
inline void releaseFlexibleEnvelope(EnvelopeState &s, const FlexibleEnvelopeParameters &p,
                                    PointAt pointAt) noexcept {
  if (s.done || s.released)
    return;
  s.released = true;
  if (p.sustain + 1 >= p.points) {
    s.done = true;
    s.current = 0;
  } else
    enterFlexibleEnvelope(s, p.sustain + 1, pointAt);
}
template <class PointAt, class CurveAt = LinearEnvelopeCurve>
inline float tickFlexibleEnvelope(EnvelopeState &s, const FlexibleEnvelopeParameters &p,
                                  PointAt pointAt, double seconds, CurveAt curveAt = {}) noexcept {
  if (s.done)
    return 0;
  if (p.dynamic) {
    const auto point = pointAt(s.stage);
    if (s.holding)
      s.current = point.level;
    else if (point.time != s.requestedDuration || point.level != s.target) {
      s.requestedDuration = point.time;
      s.duration = point.time > s.stageTime ? point.time - s.stageTime : 0;
      s.start = s.current;
      s.target = point.level;
      s.elapsed = s.offset = 0;
    }
  }
  // One traversal bounds even a zero-duration infinite loop to constant work per
  // authored point per sample; the next sample continues from the same state.
  for (std::uint32_t transitions = 0; transitions <= p.points; ++transitions) {
    if (s.holding)
      return s.current;
    s.current = envelopeSegment(s, curveAt);
    if (s.elapsed < s.duration)
      break;
    s.current = s.target;
    if (!s.released && s.stage == p.sustain) {
      if (p.loop >= 0 && static_cast<std::uint32_t>(p.loop) < p.sustain &&
          (p.loopCount == 0 || s.loops < p.loopCount)) {
        ++s.loops;
        enterFlexibleEnvelope(s, static_cast<std::uint32_t>(p.loop), pointAt);
        continue;
      }
      s.holding = true;
      return s.current;
    }
    if (s.stage + 1 >= p.points) {
      s.done = true;
      return s.current = 0;
    }
    enterFlexibleEnvelope(s, s.stage + 1, pointAt);
  }
  const auto output = s.current;
  s.elapsed += seconds;
  s.stageTime += seconds;
  return output;
}
} // namespace effetune::plugins::others::sfz::modulation
#endif
