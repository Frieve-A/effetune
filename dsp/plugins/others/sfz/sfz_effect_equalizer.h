#ifndef EFFETUNE_SFZ_EFFECT_EQUALIZER_H
#define EFFETUNE_SFZ_EFFECT_EQUALIZER_H
#include "../../eq/five_band_peq/peq_coefficients.h"
#include "equalizer.h"
#include <array>

namespace effetune::plugins::others::sfz {
class EffectEqualizer {
public:
  void reset() noexcept {
    peak_ = {};
    states_ = {};
    controls_ = {-1, -1, -1, -1, -1};
    enabled_ = false;
  }
  void process(float &left, float &right, float rate, float frequency, float bandwidth, float gain,
               unsigned type) noexcept {
    const std::array<float, 5> controls{rate, frequency, bandwidth, gain, static_cast<float>(type)};
    if (controls != controls_) {
      if (controls_[0] != rate || controls_[4] != type)
        reset();
      controls_ = controls;
      if (type == 0)
        peak_.configure(0, frequency, bandwidth, gain, rate);
      else {
        const float q = static_cast<float>(1 / (2 * std::sinh(.34657359027997265 * bandwidth)));
        enabled_ = eq::detail::makePeqCoefficients(gain, type == 1 ? 3.0F : 4.0F, frequency, q, 1,
                                                   rate, coefficients_);
      }
    }
    if (type == 0)
      peak_.process(left, right);
    else if (enabled_) {
      left = dsp::flushSubnormal(static_cast<float>(
          dsp::processBiquadTdf2Sample(dsp::flushSubnormal(left), coefficients_, states_[0])));
      right = dsp::flushSubnormal(static_cast<float>(
          dsp::processBiquadTdf2Sample(dsp::flushSubnormal(right), coefficients_, states_[1])));
      for (auto &state : states_) {
        state.s1 = dsp::flushSubnormal(state.s1);
        state.s2 = dsp::flushSubnormal(state.s2);
      }
    }
  }

private:
  VoiceEqualizer peak_;
  dsp::BiquadCoefficients coefficients_;
  std::array<dsp::BiquadTdf2State, 2> states_{};
  std::array<float, 5> controls_{-1, -1, -1, -1, -1};
  bool enabled_ = false;
};
} // namespace effetune::plugins::others::sfz
#endif
