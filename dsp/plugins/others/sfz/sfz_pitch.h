#ifndef EFFETUNE_SFZ_PITCH_H
#define EFFETUNE_SFZ_PITCH_H
#include "sfz_lfo.h"

namespace effetune::plugins::others::sfz::pitch {
// Public bend_step is cents, default 1; bend_smooth is milliseconds.
// The independent profile rounds to the nearest step (ties away from zero),
// then uses the same linear-time ramp as controller modulation.
struct BendSettings {
  float up = 200, down = -200, stepUp = 1, stepDown = 1, smoothMs = 0;
};
using BendState = modulation::RampState;
inline float bendTarget(const BendSettings &settings, int bend, float rangeSemitones) noexcept {
  const int bounded = bend < -8192 ? -8192 : bend > 8191 ? 8191 : bend;
  const double amount =
      bounded < 0 ? settings.down * (-bounded / 8192.0) : settings.up * (bounded / 8191.0);
  const double cents = amount * rangeSemitones * .5;
  const float step = bounded < 0 ? settings.stepDown : settings.stepUp;
  return modulation::finiteModulationValue(std::round(cents / step) * step);
}
inline float tickBend(BendState &state, const BendSettings &settings, int bend,
                      float rangeSemitones, double seconds) noexcept {
  return modulation::tickRamp(state, bendTarget(settings, bend, rangeSemitones), settings.smoothMs,
                              seconds);
}
// Keep physical MIDI identity separately for note-off and pressure ownership.
// Out-of-range shifted notes are absent, never clamped into a playable key.
inline int shiftedKey(int physicalKey, int offset) noexcept {
  const int shifted = physicalKey + offset;
  return shifted < 0 || shifted > 127 ? -1 : shifted;
}
} // namespace effetune::plugins::others::sfz::pitch
#endif
