#ifndef EFFETUNE_SFZ_EFFECT_STATIC_H
#define EFFETUNE_SFZ_EFFECT_STATIC_H
#include "nothrow_storage.h"
#include "sfz_noise.h"

namespace effetune::plugins::others::sfz {
struct EffectStaticParameters {
  float cyclicLevel = 0, cyclicTime = 1, level = 0, randomLevel = 0, randomMaximum = 1,
        randomMinimum = .1F, tone = .5F;
  unsigned filter = 0;
  bool stereo = true;
};
class EffectStatic {
public:
  bool prepare(float rate, std::uint64_t seed) noexcept {
    if (!std::isfinite(rate) || rate <= 0 ||
        !comb_.allocate(2u * VoiceFilter::maximumCombFrames(rate)))
      return false;
    rate_ = rate;
    seed_ = seed;
    reset();
    return true;
  }
  void reset() noexcept {
    noise_.reset(seed_);
    events_.seed(seed_ ^ 0x9e3779b97f4a7c15ULL);
    cyclicPhase_ = 0;
    randomRemaining_ = 0;
    comb_.clear();
    filter_.reset();
  }
  void process(float &left, float &right, const EffectStaticParameters &p) noexcept {
    float a = 0, b = 0;
    noise_.process(a, b, rate_, p.level, p.tone, 0, p.stereo, 0);
    // Cyclic and random controls add reproducible static impulses. Their time
    // controls are seconds and remain independent of callback partitioning.
    if (cyclicPhase_ >= 1) {
      cyclicPhase_ -= std::floor(cyclicPhase_);
      a += p.cyclicLevel;
      b += p.cyclicLevel;
    }
    if (p.cyclicTime > 0)
      cyclicPhase_ += 1 / (p.cyclicTime * rate_);
    if (randomRemaining_ <= 0) {
      const float impulse = static_cast<float>(events_.nextFloatSigned()) * p.randomLevel;
      a += impulse;
      b += p.stereo ? static_cast<float>(events_.nextFloatSigned()) * p.randomLevel : impulse;
      randomRemaining_ =
          p.randomMinimum + (p.randomMaximum - p.randomMinimum) * events_.nextFloat01();
    }
    randomRemaining_ -= 1.0 / rate_;
    filter_.configure(p.filter, 20 * std::pow(1000.0F, p.tone), 0, 0, rate_);
    filter_.process(a, b, {comb_.data(), comb_.size()});
    left += a;
    right += b;
  }
  static bool generates(const EffectStaticParameters &p) noexcept {
    return p.level != 0 || (p.cyclicLevel != 0 && p.cyclicTime > 0) || p.randomLevel != 0;
  }

private:
  NoiseLayer noise_;
  VoiceFilter filter_;
  dsp::XorShiftRng events_;
  NothrowStorage<float> comb_;
  std::uint64_t seed_ = 1;
  float rate_ = 0;
  double cyclicPhase_ = 0, randomRemaining_ = 0;
};
} // namespace effetune::plugins::others::sfz
#endif
