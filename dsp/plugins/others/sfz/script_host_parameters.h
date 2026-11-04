#ifndef EFFETUNE_SFZ_SCRIPT_HOST_PARAMETERS_H
#define EFFETUNE_SFZ_SCRIPT_HOST_PARAMETERS_H

#include "script_vm.h"

namespace effetune::plugins::others::sfz::script {
// Symbol values are shared with script-compiler.js; they are not a native engine ABI.
enum class EventParameter : std::uint32_t {
  Note,
  Tune,
  Velocity,
  Volume,
  User0,
  User1,
  User2,
  User3
};
enum class Curve : std::uint32_t { Linear, EaseInOut };
enum class VoiceTarget : std::uint32_t {
  Gain,
  Tune,
  Pan,
  Attack,
  Decay,
  Sustain,
  Release,
  Cutoff,
  CutoffAttack,
  CutoffDecay,
  CutoffSustain,
  CutoffRelease,
  Resonance,
  AmpLfoDepth,
  AmpLfoFrequency,
  PitchLfoDepth,
  PitchLfoFrequency,
  CutoffLfoDepth,
  CutoffLfoFrequency,
  PlayPosition,
  Note,
  Velocity,
  GainTime,
  GainCurve,
  TuneTime,
  TuneCurve,
  PanTime,
  PanCurve,
  FadeIn,
  FadeOut
};
struct VoiceChange {
  VoiceTarget target = VoiceTarget::Gain;
  // Gain and tuning use ratios, pan uses [-1,1], durations use seconds.
  // Envelope/filter/LFO values are relative factors unless absolute is true.
  double value = 0;
  bool absolute = false, final = false, accumulate = false, newNoteOnly = false, stop = false;
};

inline bool numericArgument(const Value &value) noexcept {
  return value.kind <= 1 && std::isfinite(value.numeric());
}
inline bool integerArgument(const Value &value, double low, double high) noexcept {
  return value.kind == 0 && value.unit() == 0 && std::isfinite(value.numeric()) &&
         value.numeric() >= low && value.numeric() <= high &&
         std::floor(value.numeric()) == value.numeric();
}
inline bool durationSeconds(const Value &value, double &seconds) noexcept {
  if (!numericArgument(value) || value.unit() > 1 || value.numeric() < 0)
    return false;
  seconds = value.unit() == 1 ? value.numeric() : value.numeric() * 0.000001;
  return std::isfinite(seconds);
}
inline bool durationFrames(double seconds, double sampleRate, std::uint64_t &frames) noexcept {
  if (!std::isfinite(seconds) || seconds < 0 || !std::isfinite(sampleRate) || sampleRate <= 0)
    return false;
  const double count = std::ceil(seconds * sampleRate);
  if (!std::isfinite(count) || count > 9007199254740991.0)
    return false;
  frames = static_cast<std::uint64_t>(count);
  return true;
}
inline double curvePosition(double position, Curve curve) noexcept {
  const double t = position < 0 ? 0 : position > 1 ? 1 : position;
  return curve == Curve::EaseInOut ? t * t * (3.0 - 2.0 * t) : t;
}

// This decodes public NKSP arguments only. The host owns voices, event liveness,
// new-note admission, previous script controls and the instrument's synthesis model.
inline bool decodeVoiceChange(Builtin builtin, const Value *arguments, std::uint32_t count,
                              VoiceChange &change) noexcept {
  if (!arguments || count < 2 || count > 3 || !integerArgument(arguments[0], 1, 4294967295.0) ||
      !numericArgument(arguments[1]))
    return false;
  const auto &v = arguments[1];
  change = {};
  change.final = (v.flags & 256u) != 0 || v.unit() == 1 || v.unit() == 2;
  const bool relative = builtin == Builtin::ChangeVol || builtin == Builtin::ChangeTune ||
                        builtin == Builtin::ChangePan;
  if (count == 3) {
    const bool flag = integerArgument(arguments[2], 0, 1) ||
                      ((builtin == Builtin::ChangeTune || builtin == Builtin::FadeOut) &&
                       arguments[2].kind == 1 && arguments[2].unit() == 0 &&
                       (arguments[2].real == 0 || arguments[2].real == 1));
    if ((!relative && builtin != Builtin::FadeOut) || !flag)
      return false;
    if (relative)
      change.accumulate = arguments[2].numeric() != 0;
  }
  enum class Scale {
    Factor,
    SecondsOrFactor,
    HertzOrFactor,
    LevelOrFactor,
    Duration,
    Curve,
    Note,
    Velocity,
    Gain,
    Tune,
    Pan
  };
  auto scale = Scale::Factor;
  switch (builtin) {
  case Builtin::ChangeVol:
    change.target = VoiceTarget::Gain;
    scale = Scale::Gain;
    break;
  case Builtin::ChangeTune:
    change.target = VoiceTarget::Tune;
    scale = Scale::Tune;
    break;
  case Builtin::ChangePan:
    change.target = VoiceTarget::Pan;
    scale = Scale::Pan;
    break;
  case Builtin::ChangeAttack:
    change.target = VoiceTarget::Attack;
    scale = Scale::SecondsOrFactor;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeDecay:
    change.target = VoiceTarget::Decay;
    scale = Scale::SecondsOrFactor;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeRelease:
    change.target = VoiceTarget::Release;
    scale = Scale::SecondsOrFactor;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeSustain:
    change.target = VoiceTarget::Sustain;
    scale = Scale::LevelOrFactor;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeCutoffAttack:
    change.target = VoiceTarget::CutoffAttack;
    scale = Scale::SecondsOrFactor;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeCutoffDecay:
    change.target = VoiceTarget::CutoffDecay;
    scale = Scale::SecondsOrFactor;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeCutoffRelease:
    change.target = VoiceTarget::CutoffRelease;
    scale = Scale::SecondsOrFactor;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeCutoffSustain:
    change.target = VoiceTarget::CutoffSustain;
    scale = Scale::LevelOrFactor;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeCutoff:
    change.target = VoiceTarget::Cutoff;
    scale = Scale::HertzOrFactor;
    break;
  case Builtin::ChangeReso:
    change.target = VoiceTarget::Resonance;
    break;
  case Builtin::ChangeAmpLfoDepth:
    change.target = VoiceTarget::AmpLfoDepth;
    break;
  case Builtin::ChangeAmpLfoFreq:
    change.target = VoiceTarget::AmpLfoFrequency;
    scale = Scale::HertzOrFactor;
    break;
  case Builtin::ChangePitchLfoDepth:
    change.target = VoiceTarget::PitchLfoDepth;
    break;
  case Builtin::ChangePitchLfoFreq:
    change.target = VoiceTarget::PitchLfoFrequency;
    scale = Scale::HertzOrFactor;
    break;
  case Builtin::ChangeCutoffLfoDepth:
    change.target = VoiceTarget::CutoffLfoDepth;
    break;
  case Builtin::ChangeCutoffLfoFreq:
    change.target = VoiceTarget::CutoffLfoFrequency;
    scale = Scale::HertzOrFactor;
    break;
  case Builtin::ChangePlayPos:
    change.target = VoiceTarget::PlayPosition;
    scale = Scale::Duration;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeNote:
    change.target = VoiceTarget::Note;
    scale = Scale::Note;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeVelo:
    change.target = VoiceTarget::Velocity;
    scale = Scale::Velocity;
    change.newNoteOnly = true;
    break;
  case Builtin::ChangeVolTime:
    change.target = VoiceTarget::GainTime;
    scale = Scale::Duration;
    break;
  case Builtin::ChangeTuneTime:
    change.target = VoiceTarget::TuneTime;
    scale = Scale::Duration;
    break;
  case Builtin::ChangePanTime:
    change.target = VoiceTarget::PanTime;
    scale = Scale::Duration;
    break;
  case Builtin::ChangeVolCurve:
    change.target = VoiceTarget::GainCurve;
    scale = Scale::Curve;
    break;
  case Builtin::ChangeTuneCurve:
    change.target = VoiceTarget::TuneCurve;
    scale = Scale::Curve;
    break;
  case Builtin::ChangePanCurve:
    change.target = VoiceTarget::PanCurve;
    scale = Scale::Curve;
    break;
  case Builtin::FadeIn:
    change.target = VoiceTarget::FadeIn;
    scale = Scale::Duration;
    break;
  case Builtin::FadeOut:
    change.target = VoiceTarget::FadeOut;
    scale = Scale::Duration;
    change.stop = count < 3 || arguments[2].numeric() != 0;
    break;
  default:
    return false;
  }
  switch (scale) {
  case Scale::Gain:
    if (v.unit() != 0 && v.unit() != 3)
      return false;
    change.value = std::pow(10.0, v.unit() == 3 ? v.numeric() * 0.5 : v.numeric() * 0.00005);
    break;
  case Scale::Tune:
    if (v.unit())
      return false;
    change.value = std::exp2((v.hasPrefix() ? v.numeric() * 100.0 : v.numeric() * 0.001) / 1200.0);
    break;
  case Scale::Pan:
    if (!integerArgument(v, -1000, 1000))
      return false;
    change.value = v.numeric() * 0.001;
    break;
  case Scale::Duration:
    change.absolute = true;
    if (!durationSeconds(v, change.value))
      return false;
    break;
  case Scale::Curve:
    if (!integerArgument(v, 0, 1))
      return false;
    change.value = v.numeric();
    break;
  case Scale::Note:
  case Scale::Velocity:
    if (!integerArgument(v, scale == Scale::Velocity ? 1 : 0, 127))
      return false;
    change.value = v.numeric();
    break;
  case Scale::SecondsOrFactor:
  case Scale::HertzOrFactor:
    if (v.unit() && v.unit() != (scale == Scale::SecondsOrFactor ? 1u : 2u))
      return false;
    if (v.numeric() < 0)
      return false;
    change.absolute = v.unit() != 0;
    change.value = change.absolute ? v.numeric() : v.numeric() * 0.000001;
    break;
  case Scale::LevelOrFactor:
    if (v.unit() != 0 && v.unit() != 3)
      return false;
    if (!v.unit() && v.numeric() < 0)
      return false;
    change.value = v.unit() == 3 ? std::pow(10.0, v.numeric() * 0.5) : v.numeric() * 0.000001;
    break;
  case Scale::Factor:
    if (v.unit() || v.numeric() < 0)
      return false;
    change.value = v.numeric() * 0.000001;
    break;
  }
  return std::isfinite(change.value);
}

inline double combineVoiceChange(const VoiceChange &change, double previous) noexcept {
  if (!change.accumulate)
    return change.value;
  if (change.target == VoiceTarget::Pan) {
    const auto value = previous + change.value;
    return value < -1 ? -1 : value > 1 ? 1 : value;
  }
  return previous * change.value;
}
} // namespace effetune::plugins::others::sfz::script
#endif
