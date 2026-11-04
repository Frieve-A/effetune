#ifndef EFFETUNE_SFZ_EFFECT_PAN_H
#define EFFETUNE_SFZ_EFFECT_PAN_H
#include "sfz_lfo.h"

namespace effetune::plugins::others::sfz {
class EffectPan {
public:
  void reset(float phaseDegrees) noexcept {
    modulation::LfoParameters parameters;
    parameters.phase = phaseDegrees / 360;
    modulation::resetLfo(lfo_, parameters, 1);
    phase_ = phaseDegrees;
  }
  void process(float &left, float &right, double rate, float frequency, float phaseDegrees,
               int wave, float depth, float dry, float wet) noexcept {
    // A phase parameter change offsets the running oscillator without resetting time.
    lfo_.phase += (phaseDegrees - phase_) / 360.0;
    lfo_.phase -= std::floor(lfo_.phase);
    phase_ = phaseDegrees;
    modulation::LfoParameters parameters;
    parameters.frequency = frequency;
    parameters.wave = wave;
    const float pan =
        depth * modulation::tickLfo(lfo_, parameters, [](auto) { return 0.0F; }, 1 / rate);
    // Linear complementary pan laws preserve unity at center and the dry path.
    left *= dry + wet * (pan > 0 ? 1 - pan : 1);
    right *= dry + wet * (pan < 0 ? 1 + pan : 1);
  }

private:
  modulation::LfoState lfo_{};
  float phase_ = 0;
};
} // namespace effetune::plugins::others::sfz
#endif
