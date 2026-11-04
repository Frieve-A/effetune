#ifndef EFFETUNE_SFZ_PLAYBACK_H
#define EFFETUNE_SFZ_PLAYBACK_H
#include <cmath>
#include <cstdint>
#include <limits>
#include <span>

namespace effetune::plugins::others::sfz::playback {
struct Timing {
  double delayBeats = 0, randomBeats = 0, syncBeats = 0, syncOffset = 0, stopBeats = -1;
  double delaySeconds = 0, delaySamples = 0;
};
struct TimingState {
  double startBeat = 0, stopBeat = std::numeric_limits<double>::infinity(), seconds = 0;
  bool started = false, cancelled = false;
};
// PPQ is the actual transport position at this sample. Beat delays follow tempo
// changes; seconds/sample delays begin once the beat boundary has been reached.
inline TimingState schedule(const Timing &p, double ppq, double rate, double randomUnit) noexcept {
  const double origin =
      p.syncBeats > 0 ? std::ceil((ppq - p.syncOffset) / p.syncBeats) * p.syncBeats + p.syncOffset
                      : ppq;
  return {origin + p.delayBeats + p.randomBeats * randomUnit,
          p.stopBeats < 0 ? std::numeric_limits<double>::infinity() : origin + p.stopBeats,
          p.delaySeconds + (rate > 0 ? p.delaySamples / rate : 0), false, false};
}
inline void cancelPending(TimingState &s) noexcept {
  if (!s.started)
    s.cancelled = true;
}
inline bool tickTiming(TimingState &s, double ppq, double seconds) noexcept {
  if (s.cancelled)
    return false;
  if (ppq >= s.stopBeat) {
    s.cancelled = true;
    return false;
  }
  if (s.started)
    return true;
  if (ppq < s.startBeat)
    return false;
  if (s.seconds > seconds * 1.e-9) {
    s.seconds -= seconds;
    return false;
  }
  s.started = true;
  return true;
}
inline bool pedalDown(bool enabled, float threshold, double rawCC) noexcept {
  return enabled && rawCC >= threshold;
}
inline double integerDelayContribution(double depth, std::uint8_t rawCC) noexcept {
  return depth * (static_cast<double>(rawCC) / 127.0);
}
inline std::uint64_t sampleDelay(std::uint64_t base, double contribution) noexcept {
  const double value = static_cast<double>(base) + contribution;
  return value <= 0              ? 0
         : value >= 4294967296.0 ? 4294967296ULL
                                 : static_cast<std::uint64_t>(std::floor(value));
}
inline bool selfMaskCandidate(bool selfMask, unsigned oldVelocity, unsigned newVelocity) noexcept {
  return !selfMask || oldVelocity <= newVelocity;
}
inline bool releaseEligible(bool allowDead, bool correspondingAttackAlive) noexcept {
  return allowDead || correspondingAttackAlive;
}
struct DecaySegment {
  double rate = 0, seconds = -1;
};
// Return a dB adjustment, not linear gain. Negative authored rates intentionally
// create positive gain. The caller combines this once with its other dB terms.
template <class Segments>
inline double releaseDecay(double ageSeconds, double rate, const Segments &segments) noexcept {
  double remaining = ageSeconds > 0 ? ageSeconds : 0;
  if (segments.empty())
    return -rate * remaining;
  double result = 0;
  for (const auto &segment : segments) {
    const double used =
        segment.seconds < 0 || segment.seconds > remaining ? remaining : segment.seconds;
    result -= used * segment.rate;
    remaining -= used;
    if (remaining <= 0 || segment.seconds < 0)
      break;
  }
  return result;
}
inline double startOffset(double baseFrames, double delta, bool percent, double totalFrames,
                          double randomFrames, double randomUnit) noexcept {
  const double position =
      baseFrames + delta * (percent ? totalFrames * .01 : 1) + randomFrames * randomUnit;
  return std::floor(position < 0 ? 0 : position);
}
inline double loopPitchRatio(bool inLoop, double cents) noexcept {
  return inLoop ? std::exp2(cents / 1200) : 1;
}
// Travel is measured from loop entry, independently of the onset/outro sample
// direction. Inclusive endpoints are visited once on alternate-loop reversal.
inline double loopAddress(double travel, double first, double last, unsigned type) noexcept {
  if (last <= first)
    return first;
  if (type == 2) {
    const double span = last - first;
    double phase = std::fmod(travel, 2 * span);
    if (phase < 0)
      phase += 2 * span;
    return first + (phase <= span ? phase : 2 * span - phase);
  }
  const double span = last - first + 1;
  double phase = std::fmod(travel, span);
  if (phase < 0)
    phase += span;
  return type == 1 ? last - phase : first + phase;
}
struct RepeatState {
  std::uint64_t completed = 0;
};
struct ReverseCondition {
  std::uint32_t controller = 0;
  float low = 0, high = 127;
};
template <class ControllerAt>
inline bool reverseDirection(bool authoredReverse, std::span<const ReverseCondition> conditions,
                             ControllerAt controllerAt) noexcept {
  if (authoredReverse || conditions.empty())
    return authoredReverse;
  for (const auto &condition : conditions) {
    const double value = controllerAt(condition.controller);
    if (value < condition.low || value > condition.high)
      return false;
  }
  return true;
}
// Call after advancing the source position. A positive count is the number of
// complete plays, including the first. Count zero leaves normal playback alone.
inline bool repeatSample(RepeatState &state, double &position, double first, double last,
                         std::uint64_t count, bool reverse) noexcept {
  if (!count)
    return false;
  const double span = last - first + 1;
  if (span <= 0)
    return false;
  const double travel = reverse ? last - position : position - first;
  if (travel < span)
    return true;
  const double crossed = std::floor(travel / span);
  if (state.completed >= count || crossed >= static_cast<double>(count - state.completed))
    return false;
  state.completed += static_cast<std::uint64_t>(crossed);
  const double phase = std::fmod(travel, span);
  position = reverse ? last - phase : first + phase;
  return true;
}
inline float fadeout(double remainingFrames, double step, double rate, double seconds) noexcept {
  if (seconds <= 0 || step == 0 || rate <= 0)
    return 1;
  const double fraction = remainingFrames / (std::abs(step) * rate * seconds);
  return static_cast<float>(fraction <= 0 ? 0 : fraction >= 1 ? 1 : fraction);
}
// Independent bounded release profile: a negative power shape mirrors the
// corresponding positive curve; zero gives linear. Mode 10 is our normalized
// exponential, not a claim of the unspecified vendor's internal algorithm.
inline float offGain(double progress, int curve, double shape) noexcept {
  if (progress <= 0)
    return 1;
  if (progress >= 1)
    return 0;
  if (curve == -2)
    return 1;
  if (curve == -1 || shape == 0)
    return static_cast<float>(1 - progress);
  const double magnitude = std::abs(shape);
  if (curve == 0)
    return static_cast<float>(shape > 0 ? std::pow(1 - progress, magnitude)
                                        : 1 - std::pow(progress, magnitude));
  if (curve == 2) {
    const double position = shape > 0 ? progress : 1 - progress;
    const double value = std::log1p(magnitude * position) / std::log1p(magnitude);
    return static_cast<float>(shape > 0 ? 1 - value : value);
  }
  // Mode 1 uses |shape| as the exponential base; a negative base is interpreted
  // as reversed curvature. This retains the public negative coefficient domain.
  const double exponent = curve == 1 ? (shape < 0 ? -1 : 1) * std::log(magnitude) : shape;
  if (std::abs(exponent) < 1.e-8)
    return static_cast<float>(1 - progress);
  const double value = exponent > 0 ? std::exp(-exponent * (1 - progress)) *
                                          -std::expm1(-exponent * progress) / -std::expm1(-exponent)
                                    : std::expm1(exponent * progress) / std::expm1(exponent);
  return static_cast<float>(1 - value);
}
} // namespace effetune::plugins::others::sfz::playback
#endif
