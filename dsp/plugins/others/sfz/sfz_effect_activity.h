#ifndef EFFETUNE_SFZ_EFFECT_ACTIVITY_H
#define EFFETUNE_SFZ_EFFECT_ACTIVITY_H
namespace effetune::plugins::others::sfz {
inline constexpr double kEffectQuietSeconds = .25;
inline bool effectOutputAudible(float value) noexcept {
  return value < -1.0e-7F || value > 1.0e-7F;
}
} // namespace effetune::plugins::others::sfz
#endif
