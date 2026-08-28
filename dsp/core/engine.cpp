#include "engine.h"

#include "IRReverbPluginParams.h"
#include "VolumePluginParams.h"
#include "allocation_guard.h"
#include "registry.h"

#if defined(__EMSCRIPTEN__)
#include "effetune/dsp/denormal_noise.h"
#endif

#include <cmath>
#include <cstring>
#include <limits>
#include <utility>

#if !defined(__EMSCRIPTEN__) &&                                                                    \
    (defined(_M_IX86) || defined(_M_X64) || defined(__i386__) || defined(__x86_64__))
#include <xmmintrin.h>
#define ET_HAS_X86_MXCSR 1
#endif

namespace effetune {
namespace {

constexpr std::uint32_t kDescriptorHeaderBytes = 8;
constexpr std::uint32_t kDescriptorNodeBytes = 12;
constexpr std::uint32_t kIrDryEnabledIndex = 4u;
constexpr std::uint32_t kIrDryLevelIndex = 5u;
constexpr float kIrDrySilenceDb = -96.0F;

void enableDenormalFlushForCurrentThread() noexcept {
#if defined(ET_HAS_X86_MXCSR)
  thread_local bool enabled = false;
  if (!enabled) {
    constexpr unsigned int kFlushToZero = 1u << 15u;
    constexpr unsigned int kDenormalsAreZero = 1u << 6u;
    _mm_setcsr(_mm_getcsr() | kFlushToZero | kDenormalsAreZero);
    enabled = true;
  }
#endif
}

#if defined(__EMSCRIPTEN__)
void addDenormalNoise(float *audio, std::uint32_t channel_count, std::uint32_t frame_count,
                      double time_seconds, float sample_rate) noexcept {
  const auto frame_origin =
      static_cast<std::uint64_t>(std::llround(time_seconds * static_cast<double>(sample_rate)));
  const float first =
      static_cast<float>(((frame_origin & 1u) == 0u) ? dsp::NyquistDenormalNoise::kAmplitude
                                                     : -dsp::NyquistDenormalNoise::kAmplitude);
  for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
    const std::uint32_t offset = channel * frame_count;
    float noise = first;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      audio[offset + frame] += noise;
      noise = -noise;
    }
  }
}

void prepareDenormalProtectedInput(float *audio, std::uint32_t channel_count,
                                   std::uint32_t frame_count, double time_seconds,
                                   float sample_rate, bool add_noise) noexcept {
  const auto frame_origin =
      static_cast<std::uint64_t>(std::llround(time_seconds * static_cast<double>(sample_rate)));
  const float first =
      static_cast<float>(((frame_origin & 1u) == 0u) ? dsp::NyquistDenormalNoise::kAmplitude
                                                     : -dsp::NyquistDenormalNoise::kAmplitude);
  const float limit = static_cast<float>(dsp::NyquistDenormalNoise::kMaximumOutputNoiseAmplitude);
  for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
    const std::uint32_t offset = channel * frame_count;
    float noise = first;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const std::uint32_t sample = offset + frame;
      const float input = audio[sample];
      const float canonical = (input >= -limit && input <= limit) ? 0.0F : input;
      audio[sample] = add_noise ? canonical + noise : canonical;
      noise = -noise;
    }
  }
}

bool requiresPostKernelDenormalNoise(const KernelDescriptor &descriptor) noexcept {
  // Its explicit cone integrator has an intentionally exact-silent equilibrium, while a
  // Nyquist input can excite the worst-case mechanical settings. Injecting at the output
  // preserves that equilibrium and still protects every downstream kernel.
  return std::strcmp(descriptor.typeName, "DynamicSaturationPlugin") == 0;
}
#endif

bool isGraphMutableType(const KernelDescriptor &descriptor) noexcept {
  return std::strcmp(descriptor.typeName, "VolumePlugin") == 0 ||
         std::strcmp(descriptor.typeName, "IRReverbPlugin") == 0;
}

bool isIrReverb(const KernelDescriptor &descriptor) noexcept {
  return std::strcmp(descriptor.typeName, "IRReverbPlugin") == 0;
}

bool isIrDrySilent(const std::array<float, 7> &parameters) noexcept {
  return parameters[kIrDryEnabledIndex] == 0.0F || parameters[kIrDryLevelIndex] <= kIrDrySilenceDb;
}

std::uint32_t readU32(const std::uint8_t *input) noexcept {
  return static_cast<std::uint32_t>(input[0]) | (static_cast<std::uint32_t>(input[1]) << 8u) |
         (static_cast<std::uint32_t>(input[2]) << 16u) |
         (static_cast<std::uint32_t>(input[3]) << 24u);
}

bool validChannelSpec(std::int8_t spec) noexcept {
  return spec == -2 || spec == -1 || (spec >= 0 && spec <= 15) || (spec >= 16 && spec <= 23);
}

} // namespace

Engine::~Engine() { destroyAllInstances(); }

void Engine::invalidatePipeline() noexcept {
  ++pipeline_revision_;
  pipeline_ = {};
  pipeline_compensation_ = {};
  pipeline_output_delays_ = {};
  pipeline_output_delay_line_ = {};
  pipeline_count_ = 0u;
  pipeline_latency_samples_ = 0u;
  pipeline_configured_ = false;
  pipeline_delay_history_dirty_ = false;
}

void Engine::invalidateGraph() noexcept {
  releaseGraphOwnership();
  graph_ = GraphPlan{};
  graph_diagnostic_ = {ET_OK, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_NONE, 0u, 0u};
}

void Engine::releaseGraphOwnership() noexcept {
  for (InstanceSlot &slot : instances_) {
    slot.graphOwned = false;
    slot.graphInitialParametersValid = false;
  }
}

void Engine::installGraphOwnership() noexcept {
  for (std::uint32_t index = 0u; index < instances_.size(); ++index) {
    InstanceSlot &slot = instances_[index];
    if (slot.kernel == nullptr) {
      continue;
    }
    const et_instance handle = makeHandle(index, slot.generation);
    slot.graphOwned = graph_.references(handle);
    if (slot.graphOwned && slot.graphParametersValid) {
      slot.graphInitialParameters = slot.graphParameters;
      slot.graphInitialParametersValid = true;
    }
  }
}

bool Engine::graphUniformOutputLatency(const InstanceSlot &slot) const noexcept {
  if (!isIrReverb(*slot.descriptor)) {
    return true;
  }
  return slot.graphParametersValid &&
         slot.graphParameterCount == generated::IRReverbPluginParams::kFloatCount &&
         isIrDrySilent(slot.graphParameters);
}

bool Engine::graphRequiresActiveAsset(const InstanceSlot &slot) const noexcept {
  if (slot.kernel->assetCapacity(0u) == 0u) {
    return false;
  }
  constexpr std::array<const char *, 6> required_types{"FIRCrossoverPlugin", "FiveBandFIRPEQPlugin",
                                                       "GroupDelayEqPlugin", "GroupDelayPEQPlugin",
                                                       "IRReverbPlugin",     "RoomEqPlugin"};
  for (const char *type_name : required_types) {
    if (std::strcmp(slot.descriptor->typeName, type_name) == 0) {
      return true;
    }
  }
  return false;
}

void Engine::resetGraphOwnedInstances() noexcept {
  for (InstanceSlot &slot : instances_) {
    if (!slot.graphOwned) {
      continue;
    }
    if (slot.graphInitialParametersValid) {
      static_cast<void>(slot.kernel->stageParameters(slot.graphInitialParameters.data(),
                                                     slot.graphParameterCount,
                                                     slot.descriptor->paramsHash));
      slot.kernel->applyPendingParameters();
      slot.graphParameters = slot.graphInitialParameters;
      slot.graphParametersValid = true;
    }
    slot.kernel->reset();
    slot.telemetrySequence = 0u;
    slot.telemetryFrames = 0.0;
  }
}

void Engine::resetPipelineDelayHistory() noexcept {
  for (std::uint32_t index = 0u; index < pipeline_count_; ++index) {
    pipeline_compensation_[index].delayLine.reset();
  }
  pipeline_output_delay_line_.reset();
  pipeline_delay_history_dirty_ = false;
}

void Engine::applyDelay(dsp::DelayLine &delay_line, std::uint32_t channel,
                        std::uint32_t delay_samples, float *audio,
                        std::uint32_t frame_count) noexcept {
  for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
    delay_line.push(channel, audio[frame]);
    audio[frame] = delay_line.read(channel, delay_samples);
  }
}

et_status Engine::prepare(float sample_rate, std::uint32_t max_channels, std::uint32_t max_frames,
                          std::uint32_t telemetry_ring_bytes) noexcept {
  destroyAllInstances();
  prepared_ = false;
  invalidatePipeline();
  invalidateGraph();
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
    if (slot.kernel != nullptr && !slot.graphOwned) {
      slot.kernel->reset();
      slot.telemetrySequence = 0;
      slot.telemetryFrames = 0.0;
    }
  }
  resetGraphOwnedInstances();
  resetPipelineDelayHistory();
  graph_.reset();
  return ET_OK;
}

et_status Engine::resetGraph() noexcept {
  if (!prepared_ || !graph_.configured()) {
    return ET_ERR_STATE;
  }
  resetGraphOwnedInstances();
  graph_.reset();
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

#if defined(ET_ENABLE_TEST_KERNEL)
PluginKernel *Engine::instanceKernelForTesting(et_instance instance) noexcept {
  InstanceSlot *slot = findInstance(instance);
  return slot == nullptr ? nullptr : slot->kernel;
}

extern "C" PluginKernel *et_engine_instance_kernel_for_testing(Engine *engine,
                                                               et_instance instance) noexcept {
  return engine == nullptr ? nullptr : engine->instanceKernelForTesting(instance);
}
#endif

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
      slot.kernel->setInstanceSalt(index);
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
    slot.graphParameters = {};
    slot.graphInitialParameters = {};
    slot.graphParameterCount = 0u;
    slot.graphParametersValid = false;
    slot.graphInitialParametersValid = false;
    slot.graphOwned = false;
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
  if (slot != nullptr && !slot->graphOwned) {
    destroySlot(*slot);
    invalidatePipeline();
  }
}

et_status Engine::resetInstance(et_instance instance) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  if (slot->graphOwned) {
    return ET_ERR_STATE;
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
  if (slot->graphOwned) {
    return ET_ERR_STATE;
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
  if (slot->graphOwned) {
    return ET_ERR_STATE;
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
  if (slot->graphOwned) {
    return ET_ERR_STATE;
  }
  if (offset_frames != 0u) {
    return ET_ERR_ARGS;
  }
  const et_status status = slot->kernel->stageParameters(packed, float_count, params_hash);
  if (status == ET_OK && isGraphMutableType(*slot->descriptor)) {
    std::memcpy(slot->graphParameters.data(), packed,
                static_cast<std::size_t>(float_count) * sizeof(float));
    slot->graphParameterCount = float_count;
    slot->graphParametersValid = true;
  }
  return status;
}

et_status Engine::setInstanceParamBytes(et_instance instance, const std::uint8_t *packed,
                                        std::uint32_t byte_count, std::uint32_t params_hash,
                                        std::uint32_t offset_frames) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  if (slot->graphOwned) {
    return ET_ERR_STATE;
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
  if (slot == nullptr || slot->graphOwned || info.channels == 0u || info.channels > 16u ||
      info.frames == 0u || info.byteSize == 0u ||
      info.byteSize > slot->kernel->assetCapacity(asset_slot) || info.topology > 4u ||
      info.processingChannels == 0u || info.processingChannels > max_channels_ ||
      info.footprintBytes < info.byteSize ||
      info.footprintBytes > slot->kernel->assetCapacity(asset_slot) ||
      (info.headBlock != 0u && info.headBlock != 128u && info.headBlock != 256u &&
       info.headBlock != 512u && info.headBlock != 1024u) ||
      (info.rateDivider != 1u && info.rateDivider != 2u && info.rateDivider != 4u) ||
      (info.topology == 4u && (info.pathCount == 0u || info.pathCount > 16u ||
                               info.inputCount == 0u || info.inputCount > 16u)) ||
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
  if (slot->graphOwned) {
    return ET_ERR_STATE;
  }
  return slot->kernel->commitAsset(asset_slot, byte_size, format_tag);
}

void Engine::abortInstanceAsset(et_instance instance, std::uint32_t asset_slot) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot != nullptr && !slot->graphOwned) {
    slot->kernel->clearAsset(asset_slot);
  }
}

std::uint32_t Engine::instanceAssetState(et_instance instance,
                                         std::uint32_t asset_slot) const noexcept {
  const InstanceSlot *slot = findInstance(instance);
  return slot == nullptr ? static_cast<std::uint32_t>(ET_ASSET_STATE_NONE)
                         : slot->kernel->assetState(asset_slot);
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
#if defined(__EMSCRIPTEN__)
  const bool add_noise_after = requiresPostKernelDenormalNoise(*slot.descriptor);
  prepareDenormalProtectedInput(audio, channel_count, frame_count, time_seconds, sample_rate_,
                                !add_noise_after);
#endif
  slot.kernel->process(audio, channel_count, frame_count, {time_seconds});
#if defined(__EMSCRIPTEN__)
  if (add_noise_after) {
    addDenormalNoise(audio, channel_count, frame_count, time_seconds, sample_rate_);
  }
#endif
  maybeWriteTelemetry(slot, frame_count);
}

et_status Engine::processInstance(et_instance instance, float *audio, std::uint32_t channel_count,
                                  std::uint32_t frame_count, double time_seconds) noexcept {
  enableDenormalFlushForCurrentThread();
  const et_status validation = validateProcessArgs(audio, channel_count, frame_count, time_seconds);
  if (validation != ET_OK) {
    return validation;
  }
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  if (slot->graphOwned) {
    return ET_ERR_STATE;
  }
  allocation_guard::Scope allocation_scope;
  processSlot(*slot, audio, channel_count, frame_count, time_seconds);
  return ET_OK;
}

et_status Engine::readInstanceRuntimeEvent(et_instance instance,
                                           RuntimeEventState &state) const noexcept {
  const InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  slot->kernel->readRuntimeEvent(state);
  return ET_OK;
}

#if defined(ET_DEBUG_STATE)
et_status Engine::readInstanceDebugState(et_instance instance,
                                         DebugStateSnapshot &state) const noexcept {
  const InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  return slot->kernel->readDebugState(state) ? ET_OK : ET_ERR_UNSUPPORTED;
}

et_status Engine::readInstanceDebugStateV2(et_instance instance,
                                           DebugStateSnapshotV2 &state) const noexcept {
  const InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  return slot->kernel->readDebugStateV2(state) ? ET_OK : ET_ERR_UNSUPPORTED;
}

et_status Engine::beginInstanceDebugObservation(et_instance instance,
                                                std::uint64_t &origin) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  return slot->kernel->beginDebugObservation(origin) ? ET_OK : ET_ERR_UNSUPPORTED;
}

et_status Engine::clearInstanceDebugDetectorObservation(et_instance instance) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (slot == nullptr) {
    return ET_ERR_ARGS;
  }
  return slot->kernel->clearDebugDetectorObservation() ? ET_OK : ET_ERR_UNSUPPORTED;
}
#endif

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
    const InstanceSlot *slot = findInstance(node.instance);
    if (node.enabled > 1u || node.sectionGate > 1u || node.inputBus >= Arena::kBusCount ||
        node.outputBus >= Arena::kBusCount || !validChannelSpec(node.channelSpec) ||
        record[9] != 0u || record[10] != 0u || record[11] != 0u || slot == nullptr ||
        slot->graphOwned) {
      return ET_ERR_DESC;
    }
    for (std::uint32_t prior = 0; prior < index; ++prior) {
      if (parsed[prior].instance == node.instance) {
        return ET_ERR_DESC;
      }
    }
    parsed[index] = node;
  }

  PipelineLatencySnapshot snapshot;
  snapshot.owner_ = this;
  snapshot.nodes_ = parsed;
  snapshot.node_count_ = node_count;
  snapshot.channel_count_ = max_channels_;
  for (std::uint32_t index = 0u; index < node_count; ++index) {
    snapshot.latencies_[index] = instanceLatency(parsed[index].instance);
  }
  PipelineLatencyUpdate update;
  const et_status status = preparePipelineLatencyUpdate(snapshot, update);
  if (status != ET_OK) {
    return status;
  }
  pipeline_ = parsed;
  pipeline_compensation_ = std::move(update.compensation_);
  pipeline_output_delays_ = update.output_delays_;
  pipeline_output_delay_line_ = std::move(update.output_delay_line_);
  pipeline_count_ = node_count;
  pipeline_latency_samples_ = update.latency_;
  ++pipeline_revision_;
  pipeline_configured_ = true;
  pipeline_delay_history_dirty_ = false;
  return ET_OK;
}

et_status Engine::capturePipelineLatencySnapshot(PipelineLatencySnapshot &snapshot) const noexcept {
  snapshot = {};
  if (!pipeline_configured_) {
    return ET_ERR_STATE;
  }
  snapshot.owner_ = this;
  snapshot.revision_ = pipeline_revision_;
  snapshot.nodes_ = pipeline_;
  snapshot.node_count_ = pipeline_count_;
  snapshot.channel_count_ = max_channels_;
  for (std::uint32_t index = 0u; index < pipeline_count_; ++index) {
    snapshot.latencies_[index] = instanceLatency(pipeline_[index].instance);
  }
  return ET_OK;
}

et_status Engine::preparePipelineLatencyUpdate(const PipelineLatencySnapshot &snapshot,
                                               PipelineLatencyUpdate &update) noexcept {
  // Reuse and destruction are non-real-time operations, even after a failed prepare.
  update.ready_ = false;
  update.latency_ = 0u;
  update.compensation_ = {};
  update.output_delays_ = {};
  update.output_delay_line_ = {};
  if (snapshot.owner_ == nullptr) {
    return ET_ERR_STATE;
  }
  const auto build_plan = [&]() -> et_status {
    std::array<std::array<std::uint32_t, 16>, Arena::kBusCount> latency{};
    std::array<std::array<bool, 16>, Arena::kBusCount> has_content{};
    auto &compensation = update.compensation_;
    auto &output_delays = update.output_delays_;
    auto &output_delay_line = update.output_delay_line_;

    for (std::uint32_t channel = 0u; channel < snapshot.channel_count_; ++channel) {
      has_content[0][channel] = true;
    }

    for (std::uint32_t index = 0u; index < snapshot.node_count_; ++index) {
      const PipelineNode &node = snapshot.nodes_[index];
      if (node.enabled == 0u || node.sectionGate == 0u) {
        continue;
      }

      std::uint32_t first_channel = 0u;
      std::uint32_t routed_channels = snapshot.channel_count_;
      if (node.channelSpec != -2) {
        routed_channels = node.channelSpec == -1 || node.channelSpec >= 16 ? 2u : 1u;
        if (node.channelSpec >= 16) {
          first_channel = static_cast<std::uint32_t>(node.channelSpec - 16) * 2u;
        } else if (node.channelSpec >= 0) {
          first_channel = static_cast<std::uint32_t>(node.channelSpec);
        }
      }
      if (first_channel + routed_channels > snapshot.channel_count_) {
        continue;
      }

      const std::uint32_t plugin_latency = snapshot.latencies_[index];
      std::uint32_t maximum_merge_delay = 0u;
      for (std::uint32_t offset = 0u; offset < routed_channels; ++offset) {
        const std::uint32_t channel = first_channel + offset;
        const std::uint32_t input_latency =
            has_content[node.inputBus][channel] ? latency[node.inputBus][channel] : 0u;
        if (plugin_latency > std::numeric_limits<std::uint32_t>::max() - input_latency) {
          return ET_ERR_DESC;
        }
        const std::uint32_t incoming_latency = input_latency + plugin_latency;

        if (node.inputBus == node.outputBus) {
          latency[node.outputBus][channel] = incoming_latency;
          has_content[node.outputBus][channel] = true;
          continue;
        }

        if (!has_content[node.outputBus][channel]) {
          latency[node.outputBus][channel] = incoming_latency;
          has_content[node.outputBus][channel] = true;
          continue;
        }

        const std::uint32_t destination_latency = latency[node.outputBus][channel];
        if (destination_latency < incoming_latency) {
          const std::uint32_t delay = incoming_latency - destination_latency;
          compensation[index].targets[channel] = DelayTarget::Destination;
          compensation[index].delays[channel] = delay;
          maximum_merge_delay = delay > maximum_merge_delay ? delay : maximum_merge_delay;
          latency[node.outputBus][channel] = incoming_latency;
        } else if (incoming_latency < destination_latency) {
          const std::uint32_t delay = destination_latency - incoming_latency;
          compensation[index].targets[channel] = DelayTarget::Incoming;
          compensation[index].delays[channel] = delay;
          maximum_merge_delay = delay > maximum_merge_delay ? delay : maximum_merge_delay;
        }
      }
      if (maximum_merge_delay != 0u && !compensation[index].delayLine.prepareNothrow(
                                           snapshot.channel_count_, maximum_merge_delay)) {
        return ET_ERR_OOM;
      }
    }

    std::uint32_t total_latency = 0u;
    for (std::uint32_t channel = 0u; channel < snapshot.channel_count_; ++channel) {
      if (has_content[0][channel] && latency[0][channel] > total_latency) {
        total_latency = latency[0][channel];
      }
    }
    std::uint32_t maximum_output_delay = 0u;
    for (std::uint32_t channel = 0u; channel < snapshot.channel_count_; ++channel) {
      const std::uint32_t channel_latency = has_content[0][channel] ? latency[0][channel] : 0u;
      output_delays[channel] = total_latency - channel_latency;
      maximum_output_delay = output_delays[channel] > maximum_output_delay ? output_delays[channel]
                                                                           : maximum_output_delay;
    }
    if (maximum_output_delay != 0u &&
        !output_delay_line.prepareNothrow(snapshot.channel_count_, maximum_output_delay)) {
      return ET_ERR_OOM;
    }

    update.latency_ = total_latency;
    update.snapshot_ = snapshot;
    update.ready_ = true;
    return ET_OK;
  };

#if defined(ET_ENABLE_LIFECYCLE_EXCEPTION_BOUNDARY)
  try {
    return build_plan();
  } catch (...) {
    return ET_ERR_OOM;
  }
#else
  return build_plan();
#endif
}

et_status Engine::applyPipelineLatencyUpdate(PipelineLatencyUpdate &update) noexcept {
  allocation_guard::Scope allocation_scope;
  const PipelineLatencySnapshot &snapshot = update.snapshot_;
  if (!pipeline_configured_ || !update.ready_ || snapshot.owner_ != this ||
      snapshot.revision_ != pipeline_revision_) {
    return ET_ERR_STATE;
  }
  for (std::uint32_t index = 0u; index < pipeline_count_; ++index) {
    if (snapshot.latencies_[index] != instanceLatency(pipeline_[index].instance)) {
      return ET_ERR_STATE;
    }
  }

  const auto adopt_storage = [](dsp::DelayLine &active, dsp::DelayLine &prepared) noexcept {
    if (prepared.channelCount() != 0u &&
        (active.channelCount() == 0u || prepared.maxDelaySamples() > active.maxDelaySamples())) {
      prepared.copyHistoryFrom(active);
      active.swap(prepared);
    }
  };
  for (std::uint32_t index = 0u; index < pipeline_count_; ++index) {
    auto &active = pipeline_compensation_[index];
    auto &next = update.compensation_[index];
    adopt_storage(active.delayLine, next.delayLine);
    for (std::uint32_t channel = 0u; channel < max_channels_; ++channel) {
      if (active.targets[channel] != next.targets[channel]) {
        // A changed merge target represents a different signal, not reusable history.
        active.delayLine.clearChannel(channel);
      }
    }
    active.targets = next.targets;
    active.delays = next.delays;
  }
  adopt_storage(pipeline_output_delay_line_, update.output_delay_line_);
  pipeline_output_delays_ = update.output_delays_;
  pipeline_latency_samples_ = update.latency_;
  ++pipeline_revision_;
  update.ready_ = false;
  return ET_OK;
}

et_status Engine::processPipeline(std::uint32_t channel_count, std::uint32_t frame_count,
                                  double time_seconds, std::uint32_t master_bypass) noexcept {
  enableDenormalFlushForCurrentThread();
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
    if (pipeline_delay_history_dirty_) {
      resetPipelineDelayHistory();
    }
    return ET_OK;
  }

  pipeline_delay_history_dirty_ = true;
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
    PipelineMergeCompensation &compensation = pipeline_compensation_[index];

    if (node.channelSpec == -2) {
      if (node.inputBus == node.outputBus) {
        processSlot(*slot, input, channel_count, frame_count, time_seconds);
      } else {
        float *routed = arena_.scratch(0);
        std::memcpy(routed, input, total_floats * sizeof(float));
        processSlot(*slot, routed, channel_count, frame_count, time_seconds);
        for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
          float *target = output + channel * frame_count;
          float *source = routed + channel * frame_count;
          if (compensation.targets[channel] == DelayTarget::Destination) {
            applyDelay(compensation.delayLine, channel, compensation.delays[channel], target,
                       frame_count);
          } else if (compensation.targets[channel] == DelayTarget::Incoming) {
            applyDelay(compensation.delayLine, channel, compensation.delays[channel], source,
                       frame_count);
          }
          for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
            target[frame] += source[frame];
          }
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
      float *source = routed + channel * frame_count;
      if (node.inputBus == node.outputBus) {
        std::memcpy(target, source, frame_count * sizeof(float));
      } else {
        if (compensation.targets[first_channel + channel] == DelayTarget::Destination) {
          applyDelay(compensation.delayLine, first_channel + channel,
                     compensation.delays[first_channel + channel], target, frame_count);
        } else if (compensation.targets[first_channel + channel] == DelayTarget::Incoming) {
          applyDelay(compensation.delayLine, first_channel + channel,
                     compensation.delays[first_channel + channel], source, frame_count);
        }
        for (std::uint32_t frame = 0; frame < frame_count; ++frame) {
          target[frame] += source[frame];
        }
      }
    }
  }
  for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
    const std::uint32_t delay = pipeline_output_delays_[channel];
    if (pipeline_output_delay_line_.channelCount() != 0u) {
      applyDelay(pipeline_output_delay_line_, channel, delay, main_bus + channel * frame_count,
                 frame_count);
    }
  }
  return ET_OK;
}

et_status Engine::configureGraph(const std::uint8_t *descriptor,
                                 std::uint32_t descriptor_bytes) noexcept {
  if (!prepared_) {
    graph_diagnostic_ = {
        ET_ERR_STATE, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_DOCUMENT, 0u, 0u};
    return ET_ERR_STATE;
  }

  GraphPlan candidate;
#if defined(ET_ENABLE_LIFECYCLE_EXCEPTION_BOUNDARY)
  et_status status = ET_ERR_OOM;
  try {
    status = candidate.configure(*this, descriptor, descriptor_bytes);
  } catch (...) {
    status = ET_ERR_OOM;
  }
#else
  const et_status status = candidate.configure(*this, descriptor, descriptor_bytes);
#endif
  if (status != ET_OK) {
    graph_diagnostic_ = candidate.diagnostic();
    if (graph_diagnostic_.status == ET_OK) {
      graph_diagnostic_ = {status, ET_GRAPH_DIAGNOSTIC_GRAPH,    0u, ET_GRAPH_PATH_GRAPH_MEMORY,
                           0u,     GraphPlan::kMaxWorkspaceBytes};
    }
    return status;
  }
  invalidatePipeline();
  releaseGraphOwnership();
  graph_ = std::move(candidate);
  installGraphOwnership();
  resetGraphOwnedInstances();
  graph_.reset();
  graph_diagnostic_ = graph_.diagnostic();
  return ET_OK;
}

et_status Engine::setGraphInstanceParams(et_instance instance, const float *packed,
                                         std::uint32_t float_count, std::uint32_t params_hash,
                                         std::uint32_t changed_index) noexcept {
  InstanceSlot *slot = findInstance(instance);
  if (!graph_.configured() || slot == nullptr || !slot->graphOwned) {
    return ET_ERR_STATE;
  }
  const std::uint32_t node_index = graph_.originalIndex(instance);
  const auto reject = [&](std::uint32_t path) {
    graph_diagnostic_ = {
        ET_ERR_GRAPH_UNSUPPORTED_CAPABILITY, ET_GRAPH_DIAGNOSTIC_NODE, node_index, path, 0u, 0u};
    return ET_ERR_GRAPH_UNSUPPORTED_CAPABILITY;
  };
  if (packed == nullptr || params_hash != slot->descriptor->paramsHash ||
      float_count != slot->descriptor->paramsFloatCount || changed_index >= float_count ||
      !slot->graphParametersValid || slot->graphParameterCount != float_count) {
    return reject(ET_GRAPH_PATH_NODE_INSTANCE);
  }

  const bool volume = std::strcmp(slot->descriptor->typeName, "VolumePlugin") == 0;
  const bool ir_reverb = isIrReverb(*slot->descriptor);
  if ((!volume || changed_index != 0u || params_hash != generated::VolumePluginParams::kHash ||
       float_count != generated::VolumePluginParams::kFloatCount) &&
      (!ir_reverb || (changed_index != kIrDryEnabledIndex && changed_index != kIrDryLevelIndex) ||
       params_hash != generated::IRReverbPluginParams::kHash ||
       float_count != generated::IRReverbPluginParams::kFloatCount)) {
    return reject(ET_GRAPH_PATH_NODE_INSTANCE);
  }
  for (std::uint32_t index = 0u; index < float_count; ++index) {
    if (index != changed_index && packed[index] != slot->graphParameters[index]) {
      return reject(ET_GRAPH_PATH_NODE_INSTANCE);
    }
  }
  if (ir_reverb && slot->kernel->latencySamples() != 0u) {
    std::array<float, 7> next_parameters{};
    std::memcpy(next_parameters.data(), packed,
                static_cast<std::size_t>(float_count) * sizeof(float));
    const bool was_silent = isIrDrySilent(slot->graphParameters);
    const bool is_silent = isIrDrySilent(next_parameters);
    if (was_silent != is_silent) {
      return reject(ET_GRAPH_PATH_NODE_LATENCY);
    }
  }

  const et_status status = slot->kernel->stageParameters(packed, float_count, params_hash);
  if (status != ET_OK) {
    return status;
  }
  std::memcpy(slot->graphParameters.data(), packed,
              static_cast<std::size_t>(float_count) * sizeof(float));
  graph_diagnostic_ = {ET_OK, ET_GRAPH_DIAGNOSTIC_GRAPH, 0u, ET_GRAPH_PATH_NONE, 0u, 0u};
  return ET_OK;
}

et_status Engine::processGraph(std::uint32_t channel_count, std::uint32_t frame_count,
                               double time_seconds) noexcept {
  enableDenormalFlushForCurrentThread();
  float *main_bus = arena_.combined();
  const et_status validation =
      validateProcessArgs(main_bus, channel_count, frame_count, time_seconds);
  if (validation != ET_OK) {
    return validation;
  }
  return graph_.process(*this, channel_count, frame_count, time_seconds);
}

et_status Engine::copyGraphSnapshot(std::uint8_t *output,
                                    std::uint32_t output_bytes) const noexcept {
  const std::vector<std::uint8_t> &snapshot = graph_.snapshot();
  if (!graph_.configured()) {
    return ET_ERR_STATE;
  }
  if (output == nullptr || output_bytes < snapshot.size()) {
    return ET_ERR_ARGS;
  }
  std::memcpy(output, snapshot.data(), snapshot.size());
  return ET_OK;
}

} // namespace effetune
