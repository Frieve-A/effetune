#ifndef EFFETUNE_SFZ_EQUALIZER_H
#define EFFETUNE_SFZ_EQUALIZER_H
#include "../../eq/five_band_peq/peq_coefficients.h"
#include "effetune/dsp/denormal.h"
#include <array>
#include <cmath>

namespace effetune::plugins::others::sfz {
// Three independent parametric bands. Their state belongs to the voice, so EQ
// cannot prolong a voice after its sample/envelope lifetime has ended.
class VoiceEqualizer {
public:
  void configure(unsigned band, float frequency, float bandwidth, float gain, float rate,
                 unsigned type = 0) noexcept {
    auto &b = bands_[band];
    if (b.frequency == frequency && b.bandwidth == bandwidth && b.gain == gain && b.type == type)
      return;
    b.frequency = frequency;
    b.bandwidth = bandwidth;
    b.gain = gain;
    b.type = type;
    b.enabled = gain != 0.0F;
    if (!b.enabled) {
      b.left = {};
      b.right = {};
      return;
    }
    const auto hz = frequency < 1.0F ? 1.0F : frequency > rate * .45F ? rate * .45F : frequency;
    if (type) {
      dsp::BiquadCoefficients coefficients;
      const auto q = static_cast<float>(1 / (2 * std::sinh(.34657359027997265 * bandwidth)));
      b.enabled = eq::detail::makePeqCoefficients(gain, type == 1 ? 3.0F : 4.0F, hz, q, 1, rate,
                                                  coefficients);
      b.b0 = static_cast<float>(coefficients.b0);
      b.b1 = static_cast<float>(coefficients.b1);
      b.b2 = static_cast<float>(coefficients.b2);
      b.a1 = static_cast<float>(coefficients.a1);
      b.a2 = static_cast<float>(coefficients.a2);
      return;
    }
    const auto omega = 6.283185307179586 * hz / rate;
    const auto sine = std::sin(omega), cosine = std::cos(omega);
    const auto amplitude = std::pow(10.0, gain / 40.0);
    const auto alpha = sine * std::sinh(.34657359027997265 * bandwidth * omega / sine);
    const auto scale = 1.0 / (1.0 + alpha / amplitude);
    b.b0 = static_cast<float>((1.0 + alpha * amplitude) * scale);
    b.b1 = b.a1 = static_cast<float>(-2.0 * cosine * scale);
    b.b2 = static_cast<float>((1.0 - alpha * amplitude) * scale);
    b.a2 = static_cast<float>((1.0 - alpha / amplitude) * scale);
  }
  void process(float &left, float &right) noexcept {
    left = dsp::flushSubnormal(left);
    right = dsp::flushSubnormal(right);
    for (auto &band : bands_)
      if (band.enabled) {
        left = band.process(left, band.left);
        right = band.process(right, band.right);
      }
  }

private:
  struct State {
    float first = 0.0F, second = 0.0F;
  };
  struct Band {
    float frequency = -1.0F, bandwidth = -1.0F, gain = 0.0F;
    unsigned type = 0;
    float b0 = 1.0F, b1 = 0.0F, b2 = 0.0F, a1 = 0.0F, a2 = 0.0F;
    State left{}, right{};
    bool enabled = false;
    float process(float input, State &state) const noexcept {
      const auto output = b0 * input + state.first;
      state.first = dsp::flushSubnormal(b1 * input - a1 * output + state.second);
      state.second = dsp::flushSubnormal(b2 * input - a2 * output);
      return dsp::flushSubnormal(output);
    }
  };
  std::array<Band, 3> bands_{};
};
} // namespace effetune::plugins::others::sfz
#endif
