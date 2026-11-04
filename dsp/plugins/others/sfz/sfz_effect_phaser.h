#ifndef EFFETUNE_SFZ_EFFECT_PHASER_H
#define EFFETUNE_SFZ_EFFECT_PHASER_H
#include "filters.h"
#include "sfz_lfo.h"
#include <array>

namespace effetune::plugins::others::sfz {
class EffectPhaser {
public:
  void reset(float phaseDegrees = 0) noexcept {
    for (auto &filter : filters_)
      filter.reset();
    feedback_ = {};
    modulation::LfoParameters parameters;
    parameters.phase = phaseDegrees / 360;
    modulation::resetLfo(lfo_, parameters, 1);
    phase_ = phaseDegrees;
  }
  void process(float &left, float &right, float rate, float frequency, float phaseDegrees, int wave,
               unsigned stages, float depth, float feedback, float wet) noexcept {
    lfo_.phase += (phaseDegrees - phase_) / 360.0;
    lfo_.phase -= std::floor(lfo_.phase);
    phase_ = phaseDegrees;
    modulation::LfoParameters parameters;
    parameters.frequency = frequency;
    parameters.wave = wave;
    const float sweep =
        modulation::tickLfo(lfo_, parameters, [](auto) { return 0.0F; }, 1.0 / rate);
    // The own profile sweeps three octaves around 1 kHz and maps the published
    // 0..100 feedback control to 0..0.99, retaining a convergent feedback path.
    const float cutoff = 1000 * std::exp2(3 * depth * sweep);
    float a = left + feedback_[0] * feedback * .99F;
    float b = right + feedback_[1] * feedback * .99F;
    for (auto stage = 0u; stage < stages && stage < filters_.size(); ++stage) {
      filters_[stage].configure(static_cast<unsigned>(schema::FilterType::apf_1p), cutoff, 0, 0,
                                rate);
      filters_[stage].process(a, b);
    }
    feedback_ = {a, b};
    left += wet * (a - left);
    right += wet * (b - right);
  }

private:
  std::array<VoiceFilter, 12> filters_{};
  std::array<float, 2> feedback_{};
  modulation::LfoState lfo_{};
  float phase_ = 0;
};
} // namespace effetune::plugins::others::sfz
#endif
