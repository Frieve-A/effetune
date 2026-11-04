#ifndef EFFETUNE_SFZ_EFFECT_CONVOLVER_H
#define EFFETUNE_SFZ_EFFECT_CONVOLVER_H
#include "effetune/dsp/partitioned_convolver.h"
#include <cmath>
#include <cstdint>
#include <limits>
#include <memory>
#include <span>

namespace effetune::plugins::others::sfz {
// The prepared impulse is already resampled to the engine rate by source
// preparation. Reuse the project's zero-latency convolution implementation.
class EffectConvolver {
public:
  static dsp::ConvolverConfig configuration(std::uint32_t channels, std::uint32_t frames) noexcept {
    dsp::ConvolverConfig result;
    result.latencySamples = 0;
    result.irChannels = channels;
    result.irFrames = frames;
    result.pathCount = 2;
    result.paths[0] = {0, 0, 0};
    result.paths[1] = {1, 1, channels - 1};
    return result;
  }
  static bool storageRequirements(std::uint32_t channels, std::uint32_t frames,
                                  dsp::ConvolverStorage &storage) noexcept {
    if ((channels != 1 && channels != 2) || !frames ||
        !dsp::PartitionedConvolver::storageRequirements(configuration(channels, frames), storage))
      return false;
    storage.persistentBytes += sizeof(dsp::PartitionedConvolver);
    storage.preparationBytes += sizeof(dsp::PartitionedConvolver);
    return true;
  }
  bool prepare(std::span<const float> impulse, std::uint32_t channels, std::uint32_t frames,
               std::size_t maximumBytes = std::numeric_limits<std::size_t>::max()) noexcept {
    prepared_ = false;
    if ((channels != 1 && channels != 2) || !frames ||
        impulse.size() != static_cast<std::size_t>(channels) * frames)
      return false;
    for (const auto value : impulse)
      if (!std::isfinite(value))
        return false;
    if (maximumBytes <
        sizeof(dsp::PartitionedConvolver) + dsp::PartitionedConvolver::minimumMemoryBytes())
      return false;
    if (!convolver_)
      convolver_.reset(new (std::nothrow) dsp::PartitionedConvolver());
    if (!convolver_)
      return false;
    if (!convolver_->reserve(configuration(channels, frames),
                             maximumBytes - sizeof(dsp::PartitionedConvolver)) ||
        !convolver_->commit(impulse.data(), channels, frames))
      return false;
    // This runs only during control preparation, before publishing the node.
    auto state = convolver_->state();
    while (state == dsp::ConvolverPreparationState::preparing)
      state = convolver_->prepareSlice(32);
    prepared_ = state == dsp::ConvolverPreparationState::active ||
                state == dsp::ConvolverPreparationState::warming;
    return prepared_;
  }
  void reset() noexcept {
    if (convolver_)
      convolver_->reset();
  }
  void process(float &left, float &right, float dry, float wet, float gain) noexcept {
    if (!prepared_)
      return;
    float audio[2]{left * gain, right * gain};
    convolver_->process(audio, 2, 1);
    left = left * dry + audio[0] * wet;
    right = right * dry + audio[1] * wet;
  }
  [[nodiscard]] std::size_t memoryBytes() const noexcept {
    return convolver_ ? sizeof(*convolver_) + convolver_->memoryBytes() : 0;
  }

private:
  std::unique_ptr<dsp::PartitionedConvolver> convolver_;
  bool prepared_ = false;
};
} // namespace effetune::plugins::others::sfz
#endif
