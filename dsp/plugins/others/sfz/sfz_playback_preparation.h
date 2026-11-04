#ifndef EFFETUNE_SFZ_PLAYBACK_PREPARATION_H
#define EFFETUNE_SFZ_PLAYBACK_PREPARATION_H
#include "sfz_modulation.h"
#include "sfz_playback.h"
#include <algorithm>
#include <array>

namespace effetune::plugins::others::sfz::playback {
struct PreparedDecaySegment {
  double rate = 0, seconds = -1;
  std::uint32_t authoredIndex = 0;
};
enum class Slot : std::uint32_t {
  DelaySeconds,
  DelayBeats,
  DelayBeatsRandom,
  DelaySamples,
  Offset,
  LoopStart,
  LoopEnd,
  LoopTune,
  Fadeout,
  OffShape,
  Count
};
struct PreparedPlayback {
  Timing timing;
  std::uint64_t randomOffset = 0, playCount = 0, loopRepeatLimit = 0;
  float fadeoutSeconds = 0, loopTune = 0, offShape = -10.3616F, decayRate = 0;
  float sustainLow = .5F, sostenutoLow = .5F;
  std::int32_t offCurve = 10;
  std::uint32_t loopType = 0, sustainCC = 64, sostenutoCC = 66, stealing = 0, sampleQuality = 0;
  bool percentOffset = false, selfMask = true, releaseDead = false;
  bool sustain = true, sostenuto = true, previousVelocity = false, valid = true,
       loopRepeatLimited = false;
  std::array<std::uint32_t, static_cast<unsigned>(Slot::Count)> slots{};
  std::span<const PreparedDecaySegment> decay;
  std::span<const ReverseCondition> reverse;
  PreparedPlayback() noexcept { slots.fill(UINT32_MAX); }
};

// CONTROL-only: input has already passed the bank's closed schema validation.
// Exact integer bases come from raw bank words, never the float parameter lane.
// The returned decay span borrows caller-owned immutable prepared storage.
template <class ExactIntegerBase>
inline PreparedPlayback
prepareSettings(const modulation::RegionView &view, ExactIntegerBase exactIntegerBase,
                std::span<PreparedDecaySegment> segments,
                std::span<ReverseCondition> reverseConditions = {}) noexcept {
  using K = schema::Kind;
  using P = schema::Property;
  PreparedPlayback out;
  std::size_t count = 0, reverseCount = 0;
  for (const auto &instance : view.instances) {
    const auto kind = static_cast<K>(instance.kind);
    if (kind != K::SamplePlayback && kind != K::Lifecycle && kind != K::ReleaseDecaySegment &&
        kind != K::ReverseController)
      continue;
    PreparedDecaySegment *segment = nullptr;
    ReverseCondition *reverse = nullptr;
    if (kind == K::ReverseController) {
      if (reverseCount == reverseConditions.size()) {
        out.valid = false;
        return out;
      }
      reverse = &reverseConditions[reverseCount++];
      *reverse = {};
      reverse->controller = instance.authoredIndex;
    }
    if (kind == K::ReleaseDecaySegment) {
      if (count == segments.size()) {
        out.valid = false;
        return out;
      }
      segment = &segments[count++];
      *segment = {};
      segment->authoredIndex = instance.authoredIndex;
    }
    for (auto index = instance.firstParameter;
         index < instance.firstParameter + instance.parameterCount; ++index) {
      const auto &parameter = view.parameters[index];
      const auto property = static_cast<P>(parameter.property);
      const auto value = parameter.base;
      if (reverse) {
        if (property == P::ReverseLow)
          reverse->low = value;
        else if (property == P::ReverseHigh)
          reverse->high = value;
        continue;
      }
      if (segment) {
        if (property == P::ReleaseDecay)
          segment->rate = value;
        else if (property == P::Time)
          segment->seconds = value;
        continue;
      }
      const auto slot = [&](Slot selected) { out.slots[static_cast<unsigned>(selected)] = index; };
      switch (property) {
      case P::Delay:
        out.timing.delaySeconds = value;
        slot(Slot::DelaySeconds);
        break;
      case P::LoopRepeatLimit:
        out.loopRepeatLimit = exactIntegerBase(index);
        break;
      case P::LoopRepeatLimited:
        out.loopRepeatLimited = value != 0;
        break;
      case P::DelayBeats:
        out.timing.delayBeats = value;
        slot(Slot::DelayBeats);
        break;
      case P::DelayBeatsRandom:
        out.timing.randomBeats = value;
        slot(Slot::DelayBeatsRandom);
        break;
      case P::DelaySamples:
        out.timing.delaySamples = static_cast<double>(exactIntegerBase(index));
        slot(Slot::DelaySamples);
        break;
      case P::SyncBeats:
        out.timing.syncBeats = value;
        break;
      case P::SyncOffset:
        out.timing.syncOffset = value;
        break;
      case P::StopBeats:
        out.timing.stopBeats = value;
        break;
      case P::SampleQuality:
        out.sampleQuality = static_cast<std::uint32_t>(value);
        break;
      case P::SampleFadeout:
        out.fadeoutSeconds = value;
        slot(Slot::Fadeout);
        break;
      case P::OffsetMode:
        out.percentOffset = value != 0;
        break;
      case P::Offset:
        slot(Slot::Offset);
        break;
      case P::OffsetRandom:
        out.randomOffset = exactIntegerBase(index);
        break;
      case P::LoopStartDelta:
        slot(Slot::LoopStart);
        break;
      case P::LoopEndDelta:
        slot(Slot::LoopEnd);
        break;
      case P::LoopType:
        out.loopType = static_cast<std::uint32_t>(value);
        break;
      case P::LoopTune:
        out.loopTune = value;
        slot(Slot::LoopTune);
        break;
      case P::PlayCount:
        out.playCount = exactIntegerBase(index);
        break;
      case P::NoteSelfMask:
        out.selfMask = value != 0;
        break;
      case P::OffCurve:
        out.offCurve = static_cast<std::int32_t>(value);
        break;
      case P::OffShape:
        out.offShape = value;
        slot(Slot::OffShape);
        break;
      case P::ReleaseDead:
        out.releaseDead = value != 0;
        break;
      case P::ReleaseDecay:
        out.decayRate = value;
        break;
      case P::SustainSwitch:
        out.sustain = value != 0;
        break;
      case P::SostenutoSwitch:
        out.sostenuto = value != 0;
        break;
      case P::SustainCC:
        out.sustainCC = static_cast<std::uint32_t>(value);
        break;
      case P::SostenutoCC:
        out.sostenutoCC = static_cast<std::uint32_t>(value);
        break;
      case P::SustainLow:
        out.sustainLow = value;
        break;
      case P::SostenutoLow:
        out.sostenutoLow = value;
        break;
      case P::SwitchVelocity:
        out.previousVelocity = value != 0;
        break;
      case P::PolyphonyStealing:
        out.stealing = static_cast<std::uint32_t>(value);
        break;
      default:
        break;
      }
    }
  }
  auto used = segments.first(count);
  std::sort(used.begin(), used.end(),
            [](const auto &a, const auto &b) { return a.authoredIndex < b.authoredIndex; });
  out.decay = used;
  out.reverse = reverseConditions.first(reverseCount);
  return out;
}
} // namespace effetune::plugins::others::sfz::playback
#endif
