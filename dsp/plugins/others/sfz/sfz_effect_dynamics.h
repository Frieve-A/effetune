#ifndef EFFETUNE_SFZ_EFFECT_DYNAMICS_H
#define EFFETUNE_SFZ_EFFECT_DYNAMICS_H
#include "effetune/dsp/smoothing.h"
#include <array>
#include <cmath>
#include <cstdint>

namespace effetune::plugins::others::sfz {
// Shared project envelope, with a hard-knee transfer in physical dB and ratio.
// The SFZ profile uses seconds for attack/release and an optional linked peak.
class EffectDynamics {
public:
  void reset() noexcept {
    for (auto &envelope : envelopes_)
      envelope.reset();
    for (auto &gain : gates_)
      gain.reset();
    holdRemaining_ = {};
  }
  void configure(double rate, float attack, float release, float hold = 0) noexcept {
    holdFrames_ = static_cast<std::uint32_t>(std::ceil(rate * hold));
    for (auto &envelope : envelopes_)
      envelope.setTimesMilliseconds(attack * 1000.0, release * 1000.0, rate);
    for (auto &gain : gates_)
      gain.setTimesMilliseconds(attack * 1000.0, release * 1000.0, rate);
  }
  void compress(float &left, float &right, float thresholdDb, float ratio, float makeupDb,
                bool linked) noexcept {
    const auto levels = detect(left, right, linked);
    const float makeup = std::pow(10.0F, makeupDb * .05F);
    left *= compressorGain(levels[0], thresholdDb, ratio) * makeup;
    right *= compressorGain(levels[1], thresholdDb, ratio) * makeup;
  }
  void gate(float &left, float &right, float thresholdDb, float depth, bool linked) noexcept {
    const float a = std::abs(left), b = std::abs(right);
    const float peak = a > b ? a : b;
    const float threshold = std::pow(10.0F, thresholdDb * .05F);
    const double openLeft = gates_[0].process(heldOpen((linked ? peak : a) >= threshold, 0));
    const double openRight = gates_[1].process(heldOpen((linked ? peak : b) >= threshold, 1));
    left *= static_cast<float>(1 - depth + depth * openLeft);
    right *= static_cast<float>(1 - depth + depth * openRight);
  }
  // Zero-latency linked peak limiting, with unity ceiling. No hidden lookahead.
  static void limit(float &left, float &right) noexcept {
    const auto a = std::abs(left), b = std::abs(right), peak = a > b ? a : b;
    if (peak > 1) {
      left /= peak;
      right /= peak;
    }
  }
  static float compressorGain(double amplitude, float thresholdDb, float ratio) noexcept {
    if (!(ratio > 0) || amplitude <= 0)
      return 1;
    const double over = 20 * std::log10(amplitude) - thresholdDb;
    return over > 0 ? static_cast<float>(std::pow(10.0, -over * (1 - 1.0 / ratio) * .05)) : 1;
  }

private:
  double heldOpen(bool above, unsigned channel) noexcept {
    auto &remaining = holdRemaining_[channel];
    if (above) {
      remaining = holdFrames_;
      return 1;
    }
    if (!remaining)
      return 0;
    --remaining;
    return 1;
  }
  std::array<std::uint32_t, 2> holdRemaining_{};
  std::uint32_t holdFrames_ = 0;
  std::array<double, 2> detect(float left, float right, bool linked) noexcept {
    const auto a = std::abs(left), b = std::abs(right), peak = a > b ? a : b;
    return {envelopes_[0].process(linked ? peak : a), envelopes_[1].process(linked ? peak : b)};
  }
  std::array<dsp::AttackReleaseEnvelope, 2> envelopes_{}, gates_{};
};
} // namespace effetune::plugins::others::sfz
#endif
