#ifndef EFFETUNE_SFZ_EFFECT_RECTIFIER_H
#define EFFETUNE_SFZ_EFFECT_RECTIFIER_H
#include <array>
namespace effetune::plugins::others::sfz {
// First-order antiderivative antialiasing integrates abs(x) over each linear
// input segment. The linear component uses that same segment's midpoint.
// This has a half-sample smoothing phase, no integer-frame lookahead or delay.
// Half-wave uses half the mix depth, so 100% half equals 50% full.
class EffectRectifier {
public:
  void reset() noexcept {
    previous_ = {};
    initialized_ = false;
  }
  void process(float &left, float &right, float depth, bool full) noexcept {
    if (!initialized_) {
      previous_ = {left, right};
      initialized_ = true;
    }
    const float mix = full ? depth : depth * .5F;
    const auto shape = [&](float input, unsigned channel) {
      const double a = previous_[channel], b = input;
      previous_[channel] = b;
      if (mix == 0)
        return input;
      const double aa = a < 0 ? -a : a, bb = b < 0 ? -b : b;
      const double middle = (a + b) * .5;
      // The zero-crossing form avoids subtracting nearly equal primitives.
      const double magnitude = (a < 0) == (b < 0) ? (aa + bb) * .5
                               : (aa + bb > 0)    ? (a * a + b * b) / (2 * (aa + bb))
                                                  : 0;
      return static_cast<float>(middle + mix * (magnitude - middle));
    };
    left = shape(left, 0);
    right = shape(right, 1);
  }

private:
  std::array<double, 2> previous_{};
  bool initialized_ = false;
};
} // namespace effetune::plugins::others::sfz
#endif
