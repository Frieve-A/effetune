#include "prototype.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <vector>

namespace {

constexpr std::uint32_t kMaximumWorkers = 4u;
constexpr std::uint32_t kBlockSize = 2048u;

struct WorkerSlot {
  std::unique_ptr<effetune::experiments::long_convolution::PrototypeConvolver> convolver;
  std::size_t memoryBytes = 0u;
};

std::array<WorkerSlot, kMaximumWorkers> slots;

WorkerSlot *slot(std::uint32_t handle) noexcept {
  if (handle == 0u || handle > slots.size())
    return nullptr;
  WorkerSlot &candidate = slots[handle - 1u];
  return candidate.convolver ? &candidate : nullptr;
}

std::uint32_t createConvolver(std::uint32_t channels, std::uint32_t frames,
                              const float *channelMajorIr,
                              effetune::experiments::long_convolution::StageRole role,
                              std::uint32_t latencySamples) noexcept {
  if (channels == 0u || channels > 8u || frames <= 4096u || channelMajorIr == nullptr)
    return 0u;
  std::uint32_t index = 0u;
  while (index < slots.size() && slots[index].convolver)
    ++index;
  if (index == slots.size())
    return 0u;
  try {
    std::vector<std::vector<float>> ir(channels, std::vector<float>(frames));
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      const float *source = channelMajorIr + static_cast<std::size_t>(channel) * frames;
      ir[channel].assign(source, source + frames);
    }
    effetune::experiments::long_convolution::Config config;
    config.partitioning = effetune::experiments::long_convolution::Partitioning::ladder;
    config.stageRole = role;
    config.latencySamples = latencySamples;
    config.inputs = channels;
    config.outputs = channels;
    for (std::uint32_t channel = 0u; channel < channels; ++channel)
      config.paths[channel] = {channel, channel, channel};
    ++config.pathCount;
    auto convolver =
        std::make_unique<effetune::experiments::long_convolution::PrototypeConvolver>();
    if (!convolver->prepare(config, ir))
      return 0u;
    slots[index].memoryBytes = convolver->memoryBytes();
    slots[index].convolver = std::move(convolver);
    return index + 1u;
  } catch (const std::bad_alloc &) {
    return 0u;
  }
}

} // namespace

extern "C" std::uint32_t etlc_worker_create(std::uint32_t channels, std::uint32_t frames,
                                            const float *channelMajorIr) noexcept {
  return createConvolver(channels, frames, channelMajorIr,
                         effetune::experiments::long_convolution::StageRole::deferredTail, 0u);
}

extern "C" std::uint32_t etlc_worker_create_resident(std::uint32_t channels, std::uint32_t frames,
                                                     const float *channelMajorIr,
                                                     std::uint32_t latencySamples) noexcept {
  return createConvolver(channels, frames, channelMajorIr,
                         effetune::experiments::long_convolution::StageRole::residentHead,
                         latencySamples);
}

extern "C" void etlc_worker_destroy(std::uint32_t handle) noexcept {
  WorkerSlot *target = slot(handle);
  if (target == nullptr)
    return;
  target->convolver.reset();
  target->memoryBytes = 0u;
}

extern "C" void etlc_worker_reset(std::uint32_t handle) noexcept {
  WorkerSlot *target = slot(handle);
  if (target != nullptr)
    target->convolver->reset();
}

extern "C" std::uint32_t etlc_worker_process(std::uint32_t handle, float *channelMajorAudio,
                                             std::uint32_t channels,
                                             std::uint32_t frames) noexcept {
  WorkerSlot *target = slot(handle);
  if (target == nullptr || channelMajorAudio == nullptr || frames != kBlockSize)
    return 0u;
  return target->convolver->processDeferredBlock(channelMajorAudio, channels) ? 1u : 0u;
}

extern "C" std::uint32_t etlc_worker_memory_bytes(std::uint32_t handle) noexcept {
  const WorkerSlot *target = slot(handle);
  if (target == nullptr || target->memoryBytes > 0xffffffffu)
    return 0u;
  return static_cast<std::uint32_t>(target->memoryBytes);
}
