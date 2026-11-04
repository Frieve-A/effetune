#ifndef EFFETUNE_SFZ_EFFECT_DISTORTION_H
#define EFFETUNE_SFZ_EFFECT_DISTORTION_H
#include <array>
#include <cmath>

namespace effetune::plugins::others::sfz {
class EffectDistortion {
public:
  void reset() noexcept { tone_ = {}; }
  void process(float &left, float &right, double rate, float depth, unsigned stages, float tone,
               float dry, float wet) noexcept {
    const float drive = std::pow(10.0F, depth * 2);
    const float normalization = std::tanh(drive);
    const double cutoff = 200 * std::pow(100.0, tone);
    const float coefficient = static_cast<float>(1 - std::exp(-6.283185307179586 * cutoff / rate));
    const auto channel = [&](float input, unsigned index) {
      float shaped = input;
      if (depth > 0)
        for (auto stage = 0u; stage < stages; ++stage) {
          // Unequal positive and negative saturation adds the specified even
          // harmonics, while preserving exact zero input and bounded output.
          const float asymmetry = shaped < 0 ? .5F : 1.0F;
          shaped = asymmetry * std::tanh(shaped * drive / asymmetry) / normalization;
        }
      tone_[index] += coefficient * (shaped - tone_[index]);
      return input * dry + (tone >= 1 ? shaped : tone_[index]) * wet;
    };
    left = channel(left, 0);
    right = channel(right, 1);
  }

private:
  std::array<float, 2> tone_{};
};
} // namespace effetune::plugins::others::sfz
#endif
