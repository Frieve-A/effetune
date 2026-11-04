#ifndef EFFETUNE_SFZ_EFFECT_DELAY_H
#define EFFETUNE_SFZ_EFFECT_DELAY_H
#include "filters.h"
#include "nothrow_storage.h"
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace effetune::plugins::others::sfz {
// App policy for FX and playback beat timing when no musical tempo is supplied.
// Source142 remains zero; timing adapters alone use this standalone tempo.
inline float effectPhysicalTempo(float supplied) noexcept {
  return supplied > 0 ? supplied : 120.0F;
}
inline float effectPreparationTempo(float minimum) noexcept {
  const auto supplied = effectPhysicalTempo(minimum);
  return supplied < effectPhysicalTempo(0) ? supplied : effectPhysicalTempo(0);
}
struct EffectDelayParameters {
  float cutoff = 20000, dampHigh = 0, dampLow = 0, dry = 1, feedback = 0, input = 1;
  std::uint32_t filter = 0, mode = 0;
  std::array<float, 3> level{1, 0, 1}, pan{0, .5F, 1}, sync{}, time{.25F, .25F, .25F};
  float lfoFrequency = .5F, modDepth = 0, resonance = 0, spread = 1, tapTime = 0, wet = 1;
};
class EffectDelay {
public:
  static std::uint32_t storageFrames(float rate, double maximumSeconds) noexcept {
    if (!std::isfinite(rate) || rate <= 0 || !std::isfinite(maximumSeconds) || maximumSeconds <= 0)
      return 0;
    const auto frames = std::ceil(rate * maximumSeconds) + 3;
    return frames > std::numeric_limits<std::uint32_t>::max() / 2u
               ? 0
               : static_cast<std::uint32_t>(frames);
  }
  // The control owner resolves the complete seconds/beat/modulation bound and
  // admits this storage before activating the instrument. No render-time growth.
  bool prepare(float rate, double maximumSeconds) noexcept {
    const auto frames = storageFrames(rate, maximumSeconds);
    if (!frames)
      return false;
    if (!storage_.allocate(static_cast<std::size_t>(frames) * 2u) ||
        !comb_.allocate(VoiceFilter::maximumCombFrames(rate) * 2u))
      return false;
    rate_ = rate;
    frames_ = static_cast<std::uint32_t>(frames);
    reset();
    return true;
  }
  void reset() noexcept {
    storage_.clear();
    comb_.clear();
    filter_.reset();
    position_ = valid_ = 0;
    phase_ = 0;
    low_ = high_ = {};
  }
  bool accepts(const EffectDelayParameters &p, float minimumBpm) const noexcept {
    if (!frames_ || !std::isfinite(minimumBpm) || minimumBpm <= 0)
      return false;
    for (auto tap = 0u; tap < 3; ++tap) {
      const double seconds = p.sync[tap] > 0 ? p.sync[tap] * 60.0 / minimumBpm : p.time[tap];
      if ((seconds + p.tapTime * 2 + p.modDepth * .03) * rate_ + 2 >= frames_)
        return false;
    }
    return true;
  }
  void process(float &left, float &right, const EffectDelayParameters &p, float bpm) noexcept {
    if (!frames_)
      return;
    left = dsp::flushSubnormal(left);
    right = dsp::flushSubnormal(right);
    const float originalLeft = left, originalRight = right;
    std::array<float, 3> taps{};
    for (auto tap = 0u; tap < 3; ++tap) {
      double seconds =
          p.sync[tap] > 0 ? p.sync[tap] * 60.0 / effectPhysicalTempo(bpm) : p.time[tap];
      seconds += p.tapTime * tap;
      if (p.mode >= 7 && p.mode <= 10) {
        const double offset = p.mode == 8 ? tap / 3.0 : tap == 2 ? .5 : 0;
        seconds += p.modDepth * (p.mode == 10 ? .002 : .02) *
                   std::sin(6.283185307179586 * (phase_ + offset));
      }
      const double delay = seconds * rate_;
      // Sub-sample delay is at least one sample, keeping the feedback causal.
      const auto sample = [&](unsigned channel) {
        if (p.mode == 11) {
          // Two crossfaded moving read heads create continuous detuning without
          // the discontinuity of resetting a single ramped delay head.
          const double secondPhase = phase_ < .5 ? phase_ + .5 : phase_ - .5;
          const auto head = [&](double phase) {
            const double age = (seconds + p.modDepth * .02 * (phase * 2 - 1)) * rate_;
            return read(channel, age < 1 ? 1 : age);
          };
          const float blend = static_cast<float>(.5 - .5 * std::cos(6.283185307179586 * phase_));
          return head(phase_) * blend + head(secondPhase) * (1 - blend);
        }
        const float first = read(channel, delay < 1 ? 1 : delay);
        if (p.mode != 9)
          return first;
        const double other =
            (seconds + p.modDepth * .01 * std::sin(6.283185307179586 * (phase_ + .25))) * rate_;
        return .5F * (first + read(channel, other < 1 ? 1 : other));
      };
      taps[tap] = tap == 0 ? sample(0) : tap == 2 ? sample(1) : .5F * (sample(0) + sample(1));
    }
    float wetLeft = 0, wetRight = 0;
    for (auto tap = 0u; tap < 3; ++tap) {
      auto pan = p.pan[tap];
      if (p.mode == 6)
        pan = static_cast<float>(.5 + .5 * std::sin(6.283185307179586 * phase_));
      const auto value = taps[tap] * p.level[tap];
      wetLeft += value * (pan <= .5F ? 1 : 2 * (1 - pan));
      wetRight += value * (pan >= .5F ? 1 : 2 * pan);
    }
    const float mid = (wetLeft + wetRight) * .5F;
    wetLeft = mid + (wetLeft - mid) * p.spread;
    wetRight = mid + (wetRight - mid) * p.spread;
    filter_.configure(p.filter, p.cutoff, p.resonance, 0, rate_);
    filter_.process(wetLeft, wetRight, {comb_.data(), comb_.size()});
    // Damping controls remove successively more high/low frequencies per echo.
    const float highCoefficient = static_cast<float>(
        1 - std::exp(-6.283185307179586 * (20000 * std::pow(.01, p.dampHigh)) / rate_));
    const float lowCoefficient = static_cast<float>(
        1 - std::exp(-6.283185307179586 * (20 * std::pow(100.0, p.dampLow)) / rate_));
    const auto damp = [&](float input, unsigned channel) {
      high_[channel] =
          dsp::flushSubnormal(high_[channel] + highCoefficient * (input - high_[channel]));
      float output = p.dampHigh == 0 ? input : high_[channel];
      low_[channel] =
          dsp::flushSubnormal(low_[channel] + lowCoefficient * (output - low_[channel]));
      return dsp::flushSubnormal(p.dampLow == 0 ? output : output - low_[channel]);
    };
    const float a = damp(wetLeft, 0), b = damp(wetRight, 1);
    const bool ping = p.mode == 2, converge = p.mode == 3 || p.mode == 4;
    const bool cross = p.mode == 1 || ping;
    const float mono = .5F * (originalLeft + originalRight);
    const float sourceLeft = p.mode == 4 ? 0 : (ping || converge) ? mono : originalLeft;
    const float sourceRight = p.mode == 4 ? mono : (ping || converge) ? 0 : originalRight;
    // L/R/C and R/L/C feedback alternates while progressively converging to
    // center. The declared profile contracts stereo difference by 0.6 per echo.
    const float feedbackLeft = converge ? .2F * a + .8F * b : cross ? b : a;
    const float feedbackRight = converge ? .8F * a + .2F * b : cross ? a : b;
    storage_.data()[position_] =
        dsp::flushSubnormal(sourceLeft * p.input + feedbackLeft * p.feedback);
    storage_.data()[frames_ + position_] =
        dsp::flushSubnormal(sourceRight * p.input + feedbackRight * p.feedback);
    position_ = (position_ + 1) % frames_;
    if (valid_ < frames_ - 1)
      ++valid_;
    phase_ += p.lfoFrequency / rate_;
    phase_ -= std::floor(phase_);
    left = dsp::flushSubnormal(originalLeft * p.dry + wetLeft * p.wet);
    right = dsp::flushSubnormal(originalRight * p.dry + wetRight * p.wet);
  }

private:
  float read(unsigned channel, double delay) const noexcept {
    if (delay >= frames_ - 1)
      return 0;
    const auto age = static_cast<std::uint32_t>(delay);
    const float fraction = static_cast<float>(delay - age);
    const auto sample = [&](unsigned distance) {
      return distance <= valid_
                 ? storage_.data()[channel * frames_ + (position_ + frames_ - distance) % frames_]
                 : 0.0F;
    };
    return sample(age) * (1 - fraction) + sample(age + 1) * fraction;
  }
  NothrowStorage<float> storage_, comb_;
  VoiceFilter filter_;
  std::array<float, 2> low_{}, high_{};
  float rate_ = 0;
  double phase_ = 0;
  std::uint32_t frames_ = 0, position_ = 0, valid_ = 0;
};
} // namespace effetune::plugins::others::sfz
#endif
