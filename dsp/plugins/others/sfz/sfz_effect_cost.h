#ifndef EFFETUNE_SFZ_EFFECT_COST_H
#define EFFETUNE_SFZ_EFFECT_COST_H
#include "sfz_effect_runtime.h"
#include "sfz_resampling.h"

namespace effetune::plugins::others::sfz {
// Same owned-storage accounting as the allocator, including peak CONTROL scratch.
// Allocator metadata and opaque incremental PFFFT state retain the convolver's
// existing accounting limitation; these values do not describe process RSS.
inline bool effectPreparationBytes(const EffectPlan &plan, const PrepareInfo &info,
                                   std::uint32_t actualChannels, bool streamed,
                                   std::uint32_t controllerEvents, std::uint32_t fxWordCount,
                                   std::uint64_t &bytes) noexcept {
  bytes = 0;
  std::uint64_t persistent =
      sizeof(EffectPlan) + static_cast<std::uint64_t>(fxWordCount) * sizeof(std::uint32_t) +
      static_cast<std::uint64_t>(plan.impulseCount()) * sizeof(EffectImpulse) +
      static_cast<std::uint64_t>(info.maxFrames) * 28 * sizeof(float);
  std::uint64_t temporary = 0;
  for (auto index = 0u; index < plan.impulseCount(); ++index) {
    const auto ir = plan.impulse(index);
    const auto frames = effectImpulseFrames(ir.frames, ir.rate, info.sampleRate);
    if (!frames)
      return false;
    const auto samples = static_cast<std::uint64_t>(frames) * ir.channels;
    if (samples > (UINT64_MAX - persistent) / sizeof(float))
      return false;
    persistent += samples * sizeof(float);
    if (streamed)
      temporary =
          std::max(temporary, static_cast<std::uint64_t>(ir.frames) * ir.channels * sizeof(float));
  }
  EffectRuntime::Geometry runtime;
  if (!EffectRuntime::storageRequirements(
          plan, info, actualChannels,
          [&](EffectImpulseReference ir) {
            return EffectImpulse{
                {}, ir.channels, effectImpulseFrames(ir.frames, ir.rate, info.sampleRate)};
          },
          static_cast<float>(info.minimumPhysicalBpm), {UINT64_MAX, controllerEvents}, runtime))
    return false;
  const auto peak = std::max(temporary, runtime.preparationBytes);
  if (peak > UINT64_MAX - persistent)
    return false;
  bytes = persistent + peak;
  return true;
}
} // namespace effetune::plugins::others::sfz
#endif
