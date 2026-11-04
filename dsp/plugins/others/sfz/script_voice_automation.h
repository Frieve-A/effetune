#ifndef EFFETUNE_SFZ_SCRIPT_VOICE_AUTOMATION_H
#define EFFETUNE_SFZ_SCRIPT_VOICE_AUTOMATION_H

#include "script_host_parameters.h"

namespace effetune::plugins::others::sfz::script {
constexpr std::uint64_t kAutomationMaxFrame = 9007199254740991ull;

struct AutomationContributions {
  double relative = 1, absolute = 0;
};

// Pointer-free state: the host serializes fields explicitly with its note checkpoint.
struct AutomationLane {
  double startValue = 0, target = 0;
  std::uint64_t startFrame = 0, endFrame = 0;
  Curve curve = Curve::EaseInOut;
  double startRelative = 1, startAbsolute = 0, finalMix = 0;

  double position(std::uint64_t frame) const noexcept {
    if (frame >= endFrame)
      return 1;
    if (frame <= startFrame)
      return 0;
    const double t =
        static_cast<double>(frame - startFrame) / static_cast<double>(endFrame - startFrame);
    return curvePosition(t, curve);
  }
  double value(std::uint64_t frame) const noexcept {
    const auto t = position(frame);
    return startValue * (1 - t) + target * t;
  }
  AutomationContributions contributions(std::uint64_t frame, bool additive = false) const noexcept {
    const auto t = position(frame);
    const auto relative = (additive ? 1.0 : target) * (1 - finalMix);
    const auto absolute = additive ? target : target * finalMix;
    return {startRelative * (1 - t) + relative * t, startAbsolute * (1 - t) + absolute * t};
  }
  bool valid() const noexcept {
    return std::isfinite(startValue) && std::isfinite(target) && startFrame <= endFrame &&
           endFrame <= kAutomationMaxFrame && static_cast<unsigned>(curve) <= 1 &&
           std::isfinite(startRelative) && startRelative >= 0 && std::isfinite(startAbsolute) &&
           std::isfinite(finalMix) && finalMix >= 0 && finalMix <= 1;
  }
  bool retarget(double destination, std::uint64_t frame, std::uint64_t duration, Curve shape,
                double destinationMix, bool additive = false) noexcept {
    if (!std::isfinite(destination) || frame > kAutomationMaxFrame ||
        duration > kAutomationMaxFrame - frame || static_cast<unsigned>(shape) > 1 ||
        !std::isfinite(destinationMix) || destinationMix < 0 || destinationMix > 1)
      return false;
    const auto current = contributions(frame, additive);
    startValue = value(frame);
    startRelative = current.relative;
    startAbsolute = current.absolute;
    target = destination;
    startFrame = frame;
    endFrame = frame + duration;
    curve = shape;
    finalMix = destinationMix;
    if (!duration) {
      startValue = target;
      const auto end = contributions(frame, additive);
      startRelative = end.relative;
      startAbsolute = end.absolute;
    }
    return true;
  }
};

struct VoiceAutomationValues {
  double gain = 1, tune = 1, pan = 0;
  bool gainFinal = false, tuneFinal = false, panFinal = false;
  double gainRelative = 1, gainAbsolute = 0, tuneRelative = 1, tuneAbsolute = 0, panRelative = 1,
         panAbsolute = 0;
};

struct VoiceAutomation {
  AutomationLane gain{1, 1}, tune{1, 1}, pan{};
  // The public contract leaves default fade duration unspecified. This engine
  // uses a short 1 ms ramp; scripts can override each duration independently.
  double gainSeconds = .001, tuneSeconds = .001, panSeconds = .001;
  Curve gainCurve = Curve::EaseInOut, tuneCurve = Curve::EaseInOut, panCurve = Curve::EaseInOut;
  std::uint64_t stopFrame = 0;
  bool stopOnFade = false;

  VoiceAutomationValues values(std::uint64_t frame) const noexcept {
    const auto g = gain.contributions(frame), t = tune.contributions(frame),
               p = pan.contributions(frame, true);
    return {gain.value(frame),
            tune.value(frame),
            pan.value(frame),
            gain.finalMix > 0 || g.absolute > 0,
            tune.finalMix > 0 || t.absolute > 0,
            pan.finalMix > 0,
            g.relative,
            g.absolute,
            t.relative,
            t.absolute,
            p.relative,
            p.absolute};
  }
  bool shouldStop(std::uint64_t frame) const noexcept { return stopOnFade && frame >= stopFrame; }
  bool valid() const noexcept {
    return gain.valid() && tune.valid() && pan.valid() && gain.startValue >= 0 &&
           gain.target >= 0 && gain.startAbsolute >= 0 && tune.startAbsolute >= 0 &&
           tune.startValue >= 0 && tune.target >= 0 && pan.startValue >= -1 &&
           pan.startValue <= 1 && pan.target >= -1 && pan.target <= 1 && pan.startRelative <= 1 &&
           pan.startAbsolute >= -1 && pan.startAbsolute <= 1 && std::isfinite(gainSeconds) &&
           gainSeconds >= 0 && std::isfinite(tuneSeconds) && tuneSeconds >= 0 &&
           std::isfinite(panSeconds) && panSeconds >= 0 && static_cast<unsigned>(gainCurve) <= 1 &&
           static_cast<unsigned>(tuneCurve) <= 1 && static_cast<unsigned>(panCurve) <= 1 &&
           stopFrame <= kAutomationMaxFrame;
  }
  // newNote means the host has not started any voice of this note yet. Initial
  // controls take effect immediately, while a birth fade-in starts at silence.
  bool apply(const VoiceChange &change, std::uint64_t frame, double rate,
             bool newNote = false) noexcept {
    if (!std::isfinite(change.value) || frame > kAutomationMaxFrame || !std::isfinite(rate) ||
        rate <= 0)
      return false;
    double *seconds = nullptr;
    Curve *shape = nullptr;
    switch (change.target) {
    case VoiceTarget::GainTime:
      seconds = &gainSeconds;
      break;
    case VoiceTarget::TuneTime:
      seconds = &tuneSeconds;
      break;
    case VoiceTarget::PanTime:
      seconds = &panSeconds;
      break;
    case VoiceTarget::GainCurve:
      shape = &gainCurve;
      break;
    case VoiceTarget::TuneCurve:
      shape = &tuneCurve;
      break;
    case VoiceTarget::PanCurve:
      shape = &panCurve;
      break;
    default:
      break;
    }
    if (seconds) {
      std::uint64_t unused = 0;
      if (!durationFrames(change.value, rate, unused))
        return false;
      *seconds = change.value;
      return true;
    }
    if (shape) {
      if (change.value != 0 && change.value != 1)
        return false;
      *shape = static_cast<Curve>(static_cast<unsigned>(change.value));
      return true;
    }
    AutomationLane *lane = nullptr;
    double duration = 0;
    Curve curve = Curve::EaseInOut;
    switch (change.target) {
    case VoiceTarget::Gain:
      lane = &gain;
      duration = gainSeconds;
      curve = gainCurve;
      break;
    case VoiceTarget::Tune:
      lane = &tune;
      duration = tuneSeconds;
      curve = tuneCurve;
      break;
    case VoiceTarget::Pan:
      lane = &pan;
      duration = panSeconds;
      curve = panCurve;
      break;
    case VoiceTarget::FadeIn:
    case VoiceTarget::FadeOut:
      lane = &gain;
      duration = change.value;
      break;
    default:
      return false;
    }
    const bool fade = change.target == VoiceTarget::FadeIn || change.target == VoiceTarget::FadeOut;
    const double target = fade ? (change.target == VoiceTarget::FadeIn ? 1.0 : 0.0)
                               : combineVoiceChange(change, lane->target);
    std::uint64_t frames = 0;
    if (!durationFrames(newNote && !fade ? 0 : duration, rate, frames) || !std::isfinite(target) ||
        (change.target == VoiceTarget::Pan ? target < -1 || target > 1 : target < 0))
      return false;
    auto next = *lane;
    if (newNote && change.target == VoiceTarget::FadeIn)
      next = {};
    double finalMix = change.final ? 1.0 : 0.0;
    if (fade) {
      const auto current = lane->contributions(frame);
      const auto level = current.relative + current.absolute;
      finalMix = level > 0 ? current.absolute / level : lane->finalMix;
    }
    // Relative commands accumulate against the last destination, not an
    // intermediate sample of its ramp. Interrupted ramps start without a jump.
    if (!next.retarget(target, frame, frames, curve, finalMix, change.target == VoiceTarget::Pan))
      return false;
    *lane = next;
    if (lane == &gain) {
      stopOnFade = change.target == VoiceTarget::FadeOut && change.stop;
      stopFrame = stopOnFade ? next.endFrame : 0;
    }
    return true;
  }

  bool rescaleClock(double oldRate, double newRate) noexcept {
    if (!valid() || !std::isfinite(oldRate) || oldRate <= 0 || !std::isfinite(newRate) ||
        newRate <= 0)
      return false;
    auto next = *this;
    const auto scale = [&](std::uint64_t &frame) {
      const double scaled = static_cast<double>(frame) * newRate / oldRate;
      if (!std::isfinite(scaled) || scaled > static_cast<double>(kAutomationMaxFrame))
        return false;
      frame = scaled >= static_cast<double>(kAutomationMaxFrame)
                  ? kAutomationMaxFrame
                  : static_cast<std::uint64_t>(std::floor(scaled + .5));
      return true;
    };
    for (auto *lane : {&next.gain, &next.tune, &next.pan})
      if (!scale(lane->startFrame) || !scale(lane->endFrame))
        return false;
    if (!scale(next.stopFrame))
      return false;
    *this = next;
    return true;
  }
};
} // namespace effetune::plugins::others::sfz::script
#endif
