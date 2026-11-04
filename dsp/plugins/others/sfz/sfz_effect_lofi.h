#ifndef EFFETUNE_SFZ_EFFECT_LOFI_H
#define EFFETUNE_SFZ_EFFECT_LOFI_H
#include <cmath>

namespace effetune::plugins::others::sfz {
class EffectLofi {
public:
  void reset() noexcept {
    phase_ = 1;
    left_ = right_ = 0;
  }
  void process(float &left, float &right, float bitReduction, float decimation) noexcept {
    // 0..100% spans 24..1 effective bits and sample-rate divisors 1..1024.
    // Zero controls are exact bypass, including values outside nominal full scale.
    if (decimation == 0 || phase_ >= 1) {
      phase_ -= std::floor(phase_);
      if (bitReduction > 0) {
        const float steps = std::exp2(23 - 23 * bitReduction);
        left_ = std::round(left * steps) / steps;
        right_ = std::round(right * steps) / steps;
      } else {
        left_ = left;
        right_ = right;
      }
    }
    phase_ += std::exp2(-10 * decimation);
    if (decimation == 0 && bitReduction == 0)
      return;
    left = left_;
    right = right_;
  }

private:
  double phase_ = 1;
  float left_ = 0, right_ = 0;
};
} // namespace effetune::plugins::others::sfz
#endif
