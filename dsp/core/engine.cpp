#include "engine.h"

#include "allocation_guard.h"
#include "registry.h"

#include <cmath>
#include <cstring>

namespace effetune {
namespace {

constexpr std::uint32_t kDescriptorHeaderBytes = 8;
constexpr std::uint32_t kDescriptorNodeBytes = 12;

std::uint32_t readU32(const std::uint8_t *input) noexcept {
  return static_cast<std::uint32_t>(input[0]) | (static_cast<std::uint32_t>(input[1]) << 8u) |
         (static_cast<std::uint32_t>(input[2]) << 16u) |
         (static_cast<std::uint32_t>(input[3]) << 24u);
}

bool validChannelSpec(std::int8_t spec) noexcept {
  return spec == -2 || spec == -1 || (spec >= 0 && spec <= 7) || (spec >= 16 && spec <= 19);
}

} // namespace

Engine::~Engine() { destroyAllInstances(); }

et_status Engine::prepare(float sample_rate, std::uint32_t max_channels, std::uint32_t max_frames,
                          std::uint32_t telemetry_ring_bytes) noexcept {
  destroyAllInstances();
  prepared_ = false;
  pipeline_configured_ = false;
  pipeline_count_ = 0;
  const et_status status =
      arena_.prepare(sample_rate, max_channels, max_frames, telemetry_ring_bytes);
  if (status != ET_OK) {
    return status;
  }
  sample_rate_ = sample_rate;
  max_channels_ = max_channels;
  max_frames_ = max_frames;
  telemetry_rate_hz_ = 60.0F;
  telemetry_.adopt(arena_.telemetryStorage(), arena_.telemetryCapacity());
  prepared_ = true;
  return ET_OK;
}

et_status Engine::reset() noexcept {
  if (!prepared_) {
    return ET_ERR_STATE;
  }
  arena_.clear();
  telemetry_.adopt(arena_.telemetryStorage(), arena_.telemetryCapacity());
  for (InstanceSlot &slot : instances_) {
    if (slot.kernel != nullptr) {
      slot.kernel->reset();
      slot.telemetrySequence = 0;
      slot.telemetryFrames = 0.0;
    }
  }
  return ET_OK;
}

et_status Engine::setTelemetryRate(float rate_hz) noexcept {
  if (!prepared_) {
    return ET_ERR_STATE;
  }
  if (!std::isfinite(rate_hz) || rate_hz < 0.0F || rate_hz > 240.0F) {
    return ET_ERR_ARGS;
  }
  telemetry_rate_hz_ = rate_hz;
  for (InstanceSlot &slot : instances_) {
    slot.telemetryFrames = 0.0;
  }
  return ET_OK;
}

et_instance Engine::makeHandle(std::uint32_t slot, std::uint16_t generation) noexcept {
  return (static_cast<std::uint32_t>(generation) << 16u) | (slot + 1u);
}

Engine::InstanceSlot *Engine::findInstance(et_instance instance) noexcept {
  if (instance == 0u) {
    return nullptr;
  }
  const std::uint32_t encoded_slot = instance & 0xffffu;
  if (encoded_slot == 0u || encoded_slot > kMaxInstances) {
    return nullptr;
  }
  InstanceSlot &slot = instances_[encoded_slot - 1u];
  const std::uint16_t generation = static_cast<std::uint16_t>(instance >> 16u);
  return slot.kernel != nullptr && slot.generation == generation ? &slot : nullptr;
}

const Engine::InstanceSlot *Engine::findInstance(et_instance instance) const noexcept {
  return const_cast<Engine *>(this)->findInstance(instance);
}

et_instance Engine::createInstance(const char *type_name) noexcept {
  if (!prepared_) {
    return 0;
  }
  const KernelDescriptor *descriptor = registry::find(type_name);
  if (descriptor == nullptr || descriptor->objectSize > kKernelStorageBytes ||
      descriptor->objectAlignment > alignof(std::max_align_t)) {
    return 0;
  }

  for (std::uint32_t index = 0; index < kMaxInstances; ++index) {
    InstanceSlot &slot = instances_[index];
    if (slot.kernel != nullptr) {
      continue;
    }
    slot.descriptor = descriptor;
    const auto initialize_slot = [&]() -> et_instance {
      slot.kernel = descriptor->construct(slot.storage.data());
      if (slot.kernel == nullptr) {
        slot.descriptor = nullptr;
        return 0;
      }
      slot.tapId = 0;
      slot.telemetrySequence = 0;
      slot.telemetryFrames = 0.0;
      const et_instance handle = makeHandle(index, slot.generation);
      slot.kernel->setRandomSeed(0xeffe7a5eU ^ handle, 0U);
      slot.kernel->prepare({sample_rate_, max_channels_, max_frames_});
      if (!slot.kernel->preparedSuccessfully()) {
        destroySlot(slot);
        return 0;
      }
      slot.kernel->reset();
      return handle;
    };
#if defined(ET_ENABLE_LIFECYCLE_EXCEPTION_BOUNDARY)
    try {
      return initialize_slot();
    } catch (...) {
      if (slot.kernel != nullptr) {
        destroySlot(slot);
      } else {
        slot.descriptor = nullptr;
      }
      return 0;
    }
#else
    return initialize_slot();
#endif
  }
  return 0;
}

void Engine::destroySlot(InstanceSlot &slot) noexcept {
  if (slot.kernel != nullptr) {
    slot.descriptor->destroy(slot.kernel);
    slot.kernel = nullptr;
    slot.descriptor = nullptr;
    slot.tapId = 0;
    slot.telemetrySequence = 0;
    slot.telemetryFrames = 0.0;
    ++slot.generation;
    if (slot.generation == 0u) {
      slot.generation = 1u;
    }
  }
}

void Engine::destroyAllInstances() noexcept {
  for (InstanceSlot &slot : instances_) {
    destroySlot(slot);
  }
}

void Engine::destroyInstance(et_instance instance) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot != nullptr) {
    destroySlot(*slot);
    pipeline_configured_ = false;
    pipeline_count_ = 0;
  }
}

et_status Engine::resetInstance(et_instance instance) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  slot->kernel->reset();
  slot->telemetrySequence = 0;
  slot->telemetryFrames = 0.0;
  return ET_OK;
}

std::uint32_t Engine::instanceLatency(et_instance instance) const noexcept {
  const InstanceSlot *slot = findInstance(instance);
  return slot == nullptr ? 0u : slot->kernel->latencySamples();
}

et_status Engine::setInstanceTap(et_instance instance, std::uint32_t tap_id) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  slot->tapId = tap_id;
  slot->telemetrySequence = 0;
  return ET_OK;
}

et_status Engine::setInstanceSeed(et_instance instance, std::uint32_t seed_low,
                                  std::uint32_t seed_high) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  slot->kernel->setRandomSeed(seed_low, seed_high);
  return ET_OK;
}

et_status Engine::setInstanceParams(et_instance instance, const float *packed,
                                    std::uint32_t float_count, std::uint32_t params_hash,
                                    std::uint32_t offset_frames) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  if (offset_frames != 0u) {
    return ET_ERR_ARGS;
  }
  return slot->kernel->stageParameters(packed, float_count, params_hash);
}

et_status Engine::setInstanceParamBytes(et_instance instance, const std::uint8_t *packed,
                                        std::uint32_t byte_count, std::uint32_t params_hash,
                                        std::uint32_t offset_frames) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  if (offset_frames != 0u || slot->descriptor->paramsByteCapacity == 0u ||
      byte_count > slot->descriptor->paramsByteCapacity ||
      (byte_count != 0u && packed == nullptr)) {
    return ET_ERR_ARGS;
  }
  if (params_hash != slot->descriptor->paramsHash) {
    return ET_ERR_HASH;
  }
  return slot->kernel->stageParameterBytes(packed, byte_count, params_hash);
}

std::uint8_t *Engine::beginInstanceAsset(et_instance instance, std::uint32_t asset_slot,
                                         const AssetBeginInfo &info) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr || info.channels == 0u || info.channels > 8u || info.frames == 0u ||
      info.byteSize == 0u || info.byteSize > slot->kernel->assetCapacity(asset_slot) ||
      info.topology > 4u || info.processingChannels == 0u ||
      info.processingChannels > max_channels_ || info.footprintBytes < info.byteSize ||
      info.footprintBytes > slot->kernel->assetCapacity(asset_slot) ||
      (info.headBlock != 0u && info.headBlock != 128u && info.headBlock != 256u &&
       info.headBlock != 512u && info.headBlock != 1024u) ||
      (info.rateDivider != 1u && info.rateDivider != 2u && info.rateDivider != 4u) ||
      (info.topology == 4u && (info.pathCount == 0u || info.pathCount > 8u ||
                               info.inputCount == 0u || info.inputCount > 8u)) ||
      (info.topology != 4u && (info.pathCount != 0u || info.inputCount != 0u))) {
    return nullptr;
  }
  return slot->kernel->beginAsset(asset_slot, info);
}

et_status Engine::commitInstanceAsset(et_instance instance, std::uint32_t asset_slot,
                                      std::uint32_t byte_size, std::uint32_t format_tag) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr || byte_size == 0u) {
    return ET_ERR_ARGS;
  }
  return slot->kernel->commitAsset(asset_slot, byte_size, format_tag);
}

void Engine::abortInstanceAsset(et_instance instance, std::uint32_t asset_slot) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot != nullptr) {
    slot->kernel->clearAsset(asset_slot);
  }
}

std::uint32_t Engine::instanceAssetState(et_instance instance,
                                         std::uint32_t asset_slot) const noexcept {
  const InstanceSlot *slot = findInstance(instance);
  return slot == nullptr ? ET_ASSET_STATE_NONE : slot->kernel->assetState(asset_slot);
}

et_status Engine::validateProcessArgs(const float *audio, std::uint32_t channel_count,
                                      std::uint32_t frame_count,
                                      double time_seconds) const noexcept {
  if (!prepared_) {
    return ET_ERR_STATE;
  }
  if (audio == nullptr || channel_count == 0u || channel_count > max_channels_ ||
      frame_count == 0u || frame_count > max_frames_ || !std::isfinite(time_seconds)) {
    return ET_ERR_ARGS;
  }
  return ET_OK;
}

void Engine::maybeWriteTelemetry(InstanceSlot &slot, std::uint32_t frame_count) noexcept {
  if (telemetry_rate_hz_ <= 0.0F || telemetry_.capacity() == 0u) {
    return;
  }
  slot.telemetryFrames += frame_count;
  const double interval = static_cast<double>(sample_rate_) / telemetry_rate_hz_;
  if (slot.telemetryFrames < interval) {
    return;
  }
  slot.telemetryFrames = std::fmod(slot.telemetryFrames, interval);
  TelemetryWriter writer(telemetry_, slot.tapId, slot.telemetrySequence);
  slot.kernel->writeTelemetry(writer);
}

void Engine::processSlot(InstanceSlot &slot, float *audio, std::uint32_t channel_count,
                         std::uint32_t frame_count, double time_seconds) noexcept {
  slot.kernel->applyPendingParameters();
  slot.kernel->process(audio, channel_count, frame_count, {time_seconds});
  maybeWriteTelemetry(slot, frame_count);
}

et_status Engine::processInstance(et_instance instance, float *audio, std::uint32_t channel_count,
                                  std::uint32_t frame_count, double time_seconds) noexcept {
  const et_status validation = validateProcessArgs(audio, channel_count, frame_count, time_seconds);
  if (validation != ET_OK) {
    return validation;
  }
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  allocation_guard::Scope allocation_scope;
  processSlot(*slot, audio, channel_count, frame_count, time_seconds);
  return ET_OK;
}

et_status Engine::configurePipeline(const std::uint8_t *descriptor,
                                    std::uint32_t descriptor_bytes) noexcept {
  if (!prepared_) {
    return ET_ERR_STATE;
  }
  if (descriptor == nullptr || descriptor_bytes < kDescriptorHeaderBytes) {
    return ET_ERR_DESC;
  }
  const std::uint32_t version = readU32(descriptor);
  const std::uint32_t node_count = readU32(descriptor + 4u);
  if (version != kPipelineDescriptorVersion || node_count > kMaxPipelineNodes ||
      descriptor_bytes != kDescriptorHeaderBytes + node_count * kDescriptorNodeBytes) {
    return ET_ERR_DESC;
  }

  std::array<PipelineNode, kMaxPipelineNodes> parsed{};
  for (std::uint32_t index = 0; index < node_count; ++index) {
    const std::uint8_t *record = descriptor + kDescriptorHeaderBytes + index * kDescriptorNodeBytes;
    PipelineNode node{};
    node.instance = readU32(record);
    node.enabled = record[4];
    node.inputBus = record[5];
    node.outputBus = record[6];
    node.channelSpec = static_cast<std::int8_t>(record[7]);
    node.sectionGate = record[8];
    if (node.enabled > 1u || node.sectionGate > 1u || node.inputBus >= Arena::kBusCount ||
        node.outputBus >= Arena::kBusCount || !validChannelSpec(node.channelSpec) ||
        record[9] != 0u || record[10] != 0u || record[11] != 0u ||
        findInstance(node.instance) == nullptr) {
      return ET_ERR_DESC;
    }
    for (std::uint32_t prior = 0; prior < index; ++prior) {
      if (parsed[prior].instance == node.instance) {
        return ET_ERR_DESC;
      }
    }
    parsed[index] = node;
  }

  pipeline_ = parsed;
  pipeline_count_ = node_count;
  pipeline_configured_ = true;
  return ET_OK;
}

et_status Engine::processPipeline(std::uint32_t channel_count, std::uint32_t frame_count,
                                  double time_seconds, std::uint32_t master_bypass) noexcept {
  float *main_bus = arena_.combined();
  const et_status validation =
      validateProcessArgs(main_bus, channel_count, frame_count, time_seconds);
  if (validation != ET_OK) {
    return validation;
  }
  if (!pipeline_configured_) {
    return ET_ERR_STATE;
  }
  if (master_bypass != 0u) {
    return ET_OK;
  }

  allocation_guard::Scope allocation_scope;

  const std::uint32_t total_floats = channel_count * frame_count;
  for (std::uint32_t bus_index = 1; bus_index < Arena::kBusCount; ++bus_index) {
    std::memset(arena_.bus(bus_index), 0, total_floats * sizeof(float));
  }

  for (std::uint32_t index = 0; index < pipeline_count_; ++index) {
    const PipelineNode &node = pipeline_[index];
    if (node.enabled == 0u || node.sectionGate == 0u) {
      continue;
    }
    InstanceSlot *slot = findInstance(node.instance);
    if (slot == nullptr) {
      return ET_ERR_DESC;
    }
    float *input = arena_.bus(node.inputBus);
    float *output = arena_.bus(node.outputBus);

    if (node.channelSpec == -2) {
      if (node.inputBus == node.outputBus) {
        processSlot(*slot, input, channel_count, frame_count, time_seconds);
      } else {
        float *routed = arena_.scratch(0);
        std::memcpy(routed, input, total_floats * sizeof(float));
        processSlot(*slot, routed, channel_count, frame_count, time_seconds);
        for (std::uint32_t sample = 0; sample < total_floats; ++sample) {
          output[sample] += routed[sample];
        }
      }
      continue;
    }

    std::uint32_t first_channel = 0;
    std::uint32_t routed_channels = 1;
    if (node.channelSpec == -1) {
      routed_channels = 2;
    } else if (node.channelSpec >= 16) {
      first_channel = static_cast<std::uint32_t>(node.channelSpec - 16) * 2u;
      routed_channels = 2;
    } else {
      first_channel = static_cast<std::uint32_t>(node.channelSpec);
    }
    if (first_channel + routed_channels > channel_count) {
      continue;
    }

    float *routed = arena_.scratch(routed_channels == 2u ? 2u : 3u);
    for (std::uint32_t channel = 0; channel < routed_channels; ++channel) {
      std::memcpy(routed + channel * frame_count, input + (first_channel + channel) * frame_count,
                  frame_count * sizeof(float));
    }
    processSlot(*slot, routed, routed_channels, frame_count, time_seconds);
    for (std::uint32_t channel = 0; channel < routed_channels; ++channel) {
      float *target = output + (first_channel + channel) * frame_count;
      const float *source = routed + channel * frame_count;
      if (node.inputBus == node.outputBus) {
        std::memcpy(target, source, frame_count * sizeof(float));
      } else {
        for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
          target[frame] += source[frame];
        }
      }
    }
  }
  return ET_OK;
}

} // namespace effetune
