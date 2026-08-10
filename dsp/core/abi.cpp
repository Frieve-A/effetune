#include "effetune/abi.h"

#include "arena.h"
#include "engine.h"
#include "registry.h"

#include <algorithm>
#include <array>
#include <cstring>
#include <limits>
#include <new>

namespace {

constexpr std::uint32_t kMaxEngines = 16;
std::array<effetune::Engine *, kMaxEngines> g_engines{};

effetune::Engine *findEngine(et_engine handle) noexcept {
  return handle > 0u && handle <= kMaxEngines ? g_engines[handle - 1u] : nullptr;
}

} // namespace

extern "C" {

std::uint32_t et_abi_version(void) { return EFFETUNE_DSP_ABI_VERSION; }

std::uint32_t et_build_flags(void) {
  std::uint32_t flags = 0;
#if defined(ET_SIMD)
  flags |= ET_BUILD_SIMD;
#endif
#if defined(ET_DEBUG_BUILD)
  flags |= ET_BUILD_DEBUG;
#endif
  return flags;
}

std::uint32_t et_kernel_count(void) { return effetune::registry::count(); }

std::int32_t et_kernel_name(std::uint32_t index, char *buffer, std::uint32_t buffer_size) {
  const effetune::KernelDescriptor *descriptor = effetune::registry::at(index);
  if (descriptor == nullptr || (buffer == nullptr && buffer_size != 0u)) {
    return ET_ERR_ARGS;
  }
  const std::size_t length = std::strlen(descriptor->typeName);
  if (buffer_size != 0u) {
    const std::size_t copy_length = length < static_cast<std::size_t>(buffer_size - 1u)
                                        ? length
                                        : static_cast<std::size_t>(buffer_size - 1u);
    std::memcpy(buffer, descriptor->typeName, copy_length);
    buffer[copy_length] = '\0';
  }
  return static_cast<std::int32_t>(length);
}

std::uint32_t et_kernel_params_hash(std::uint32_t index) {
  const effetune::KernelDescriptor *descriptor = effetune::registry::at(index);
  return descriptor == nullptr ? 0u : descriptor->paramsHash;
}

std::uint32_t et_kernel_param_bytes_capacity(std::uint32_t index) {
  const effetune::KernelDescriptor *descriptor = effetune::registry::at(index);
  return descriptor == nullptr ? 0u : descriptor->paramsByteCapacity;
}

std::uint32_t et_kernel_asset_capacity(std::uint32_t index, std::uint32_t slot) {
  const effetune::KernelDescriptor *descriptor = effetune::registry::at(index);
  return descriptor == nullptr ? 0u : descriptor->assetCapacity(slot);
}

std::uint32_t et_engine_memory_required(float sample_rate, std::uint32_t max_channels,
                                        std::uint32_t max_frames,
                                        std::uint32_t telemetry_ring_bytes) {
  return effetune::Arena::memoryRequired(sample_rate, max_channels, max_frames,
                                         telemetry_ring_bytes);
}

et_engine et_engine_create(void) {
  for (std::uint32_t index = 0; index < kMaxEngines; ++index) {
    if (g_engines[index] == nullptr) {
      g_engines[index] = new (std::nothrow) effetune::Engine();
      return g_engines[index] == nullptr ? 0u : index + 1u;
    }
  }
  return 0u;
}

void et_engine_destroy(et_engine engine) {
  if (engine == 0u || engine > kMaxEngines) {
    return;
  }
  delete g_engines[engine - 1u];
  g_engines[engine - 1u] = nullptr;
}

et_status et_engine_prepare(et_engine engine, float sample_rate, std::uint32_t max_channels,
                            std::uint32_t max_frames, std::uint32_t telemetry_ring_bytes) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr
             ? ET_ERR_ARGS
             : target->prepare(sample_rate, max_channels, max_frames, telemetry_ring_bytes);
}

et_status et_engine_reset(et_engine engine) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? ET_ERR_ARGS : target->reset();
}

et_status et_engine_set_telemetry_rate(et_engine engine, float rate_hz) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? ET_ERR_ARGS : target->setTelemetryRate(rate_hz);
}

et_instance et_instance_create(et_engine engine, const char *type_name) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? 0u : target->createInstance(type_name);
}

void et_instance_destroy(et_engine engine, et_instance instance) {
  effetune::Engine *target = findEngine(engine);
  if (target != nullptr) {
    target->destroyInstance(instance);
  }
}

et_status et_instance_reset(et_engine engine, et_instance instance) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? ET_ERR_ARGS : target->resetInstance(instance);
}

std::uint32_t et_instance_latency(et_engine engine, et_instance instance) {
  const effetune::Engine *target = findEngine(engine);
  return target == nullptr ? 0u : target->instanceLatency(instance);
}

et_status et_instance_set_tap(et_engine engine, et_instance instance, std::uint32_t tap_id) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? ET_ERR_ARGS : target->setInstanceTap(instance, tap_id);
}

et_status et_instance_set_seed(et_engine engine, et_instance instance, std::uint32_t seed_low,
                               std::uint32_t seed_high) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? ET_ERR_ARGS : target->setInstanceSeed(instance, seed_low, seed_high);
}

et_status et_instance_set_params(et_engine engine, et_instance instance, const float *packed,
                                 std::uint32_t float_count, std::uint32_t params_hash,
                                 std::uint32_t offset_frames) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr
             ? ET_ERR_ARGS
             : target->setInstanceParams(instance, packed, float_count, params_hash, offset_frames);
}

et_status et_instance_set_param_bytes(et_engine engine, et_instance instance,
                                      const std::uint8_t *packed, std::uint32_t byte_count,
                                      std::uint32_t params_hash, std::uint32_t offset_frames) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? ET_ERR_ARGS
                           : target->setInstanceParamBytes(instance, packed, byte_count,
                                                           params_hash, offset_frames);
}

std::uint32_t et_instance_asset_begin(et_engine engine, et_instance instance, std::uint32_t slot,
                                      std::uint32_t channels, std::uint32_t frames,
                                      std::uint32_t topology, std::uint32_t head_block,
                                      std::uint32_t rate_divider, std::uint32_t path_count,
                                      std::uint32_t input_count, std::uint32_t processing_channels,
                                      std::uint32_t footprint_bytes, std::uint32_t byte_size) {
  effetune::Engine *target = findEngine(engine);
  if (target == nullptr) {
    return 0u;
  }
  const effetune::AssetBeginInfo info{channels,        frames,     topology,    head_block,
                                      rate_divider,    path_count, input_count, processing_channels,
                                      footprint_bytes, byte_size};
  std::uint8_t *staging = target->beginInstanceAsset(instance, slot, info);
  return static_cast<std::uint32_t>(reinterpret_cast<std::uintptr_t>(staging));
}

et_status et_instance_asset_commit(et_engine engine, et_instance instance, std::uint32_t slot,
                                   std::uint32_t byte_size, std::uint32_t format_tag) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? ET_ERR_ARGS
                           : target->commitInstanceAsset(instance, slot, byte_size, format_tag);
}

void et_instance_asset_abort(et_engine engine, et_instance instance, std::uint32_t slot) {
  effetune::Engine *target = findEngine(engine);
  if (target != nullptr) {
    target->abortInstanceAsset(instance, slot);
  }
}

std::uint32_t et_instance_asset_state(et_engine engine, et_instance instance, std::uint32_t slot) {
  const effetune::Engine *target = findEngine(engine);
  return target == nullptr ? static_cast<std::uint32_t>(ET_ASSET_STATE_NONE)
                           : target->instanceAssetState(instance, slot);
}

et_status et_instance_process(et_engine engine, et_instance instance, float *audio,
                              std::uint32_t channel_count, std::uint32_t frame_count,
                              double time_seconds) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr
             ? ET_ERR_ARGS
             : target->processInstance(instance, audio, channel_count, frame_count, time_seconds);
}

et_status et_instance_runtime_event(et_engine engine, et_instance instance,
                                    et_runtime_event_state *out_state) {
  effetune::Engine *target = findEngine(engine);
  if (target == nullptr || out_state == nullptr) {
    return ET_ERR_ARGS;
  }
  effetune::RuntimeEventState state{};
  const et_status status = target->readInstanceRuntimeEvent(instance, state);
  if (status == ET_OK) {
    out_state->generation = state.generation;
    out_state->latched = state.latched;
    out_state->cause = state.cause;
  }
  return status;
}

#if defined(ET_DEBUG_STATE)
et_status et_instance_debug_state(et_engine engine, et_instance instance, std::uint32_t *out_words,
                                  std::uint32_t word_count, double *out_values,
                                  std::uint32_t value_count) {
  constexpr std::uint32_t kWordCount = 57u;
  constexpr std::uint32_t kValueCount = 45u;
  effetune::Engine *target = findEngine(engine);
  if (target == nullptr || out_words == nullptr || word_count != kWordCount ||
      out_values == nullptr || value_count != kValueCount) {
    return ET_ERR_ARGS;
  }
  effetune::DebugStateSnapshot state{};
  const et_status status = target->readInstanceDebugState(instance, state);
  if (status != ET_OK) {
    return status;
  }
  out_words[0] = static_cast<std::uint32_t>(state.digest);
  out_words[1] = static_cast<std::uint32_t>(state.digest >> 32u);
  for (std::size_t index = 0u; index < state.transition.size(); ++index) {
    if (state.transition[index] > std::numeric_limits<std::uint32_t>::max()) {
      return ET_ERR_STATE;
    }
    out_words[index + 2u] = static_cast<std::uint32_t>(state.transition[index]);
  }
  out_words[14] = state.runtimeEvent.generation;
  out_words[15] = state.runtimeEvent.latched;
  out_words[16] = state.runtimeEvent.cause;
  for (std::size_t index = 0u; index < state.auxiliaryWords.size(); ++index) {
    const std::uint64_t value = state.auxiliaryWords[index];
    if (value > std::numeric_limits<std::uint32_t>::max() &&
        !(index >= 6u && index <= 8u && value == std::numeric_limits<std::uint64_t>::max())) {
      return ET_ERR_STATE;
    }
    out_words[index + 17u] = value == std::numeric_limits<std::uint64_t>::max()
                                 ? std::numeric_limits<std::uint32_t>::max()
                                 : static_cast<std::uint32_t>(value);
  }
  std::copy(state.appliedParameters.begin(), state.appliedParameters.end(), out_values);
  std::copy(state.feedbackCalibration.begin(), state.feedbackCalibration.end(), out_values + 10u);
  std::copy(state.auxiliaryValues.begin(), state.auxiliaryValues.end(), out_values + 19u);
  return ET_OK;
}

et_status et_instance_debug_state_v2(et_engine engine, et_instance instance,
                                     std::uint32_t *out_words, std::uint32_t word_count,
                                     double *out_values, std::uint32_t value_count) {
  constexpr std::uint32_t kWordCount = 57u;
  constexpr std::uint32_t kValueCount = 59u;
  effetune::Engine *target = findEngine(engine);
  if (target == nullptr || out_words == nullptr || word_count != kWordCount ||
      out_values == nullptr || value_count != kValueCount) {
    return ET_ERR_ARGS;
  }
  effetune::DebugStateSnapshotV2 state{};
  const et_status status = target->readInstanceDebugStateV2(instance, state);
  if (status != ET_OK) {
    return status;
  }
  out_words[0] = static_cast<std::uint32_t>(state.legacy.digest);
  out_words[1] = static_cast<std::uint32_t>(state.legacy.digest >> 32u);
  for (std::size_t index = 0u; index < state.legacy.transition.size(); ++index) {
    if (state.legacy.transition[index] > std::numeric_limits<std::uint32_t>::max()) {
      return ET_ERR_STATE;
    }
    out_words[index + 2u] = static_cast<std::uint32_t>(state.legacy.transition[index]);
  }
  out_words[14] = state.legacy.runtimeEvent.generation;
  out_words[15] = state.legacy.runtimeEvent.latched;
  out_words[16] = state.legacy.runtimeEvent.cause;
  for (std::size_t index = 0u; index < state.legacy.auxiliaryWords.size(); ++index) {
    const std::uint64_t value = state.legacy.auxiliaryWords[index];
    if (value > std::numeric_limits<std::uint32_t>::max() &&
        !(index >= 6u && index <= 8u && value == std::numeric_limits<std::uint64_t>::max())) {
      return ET_ERR_STATE;
    }
    out_words[index + 17u] = value == std::numeric_limits<std::uint64_t>::max()
                                 ? std::numeric_limits<std::uint32_t>::max()
                                 : static_cast<std::uint32_t>(value);
  }
  std::copy(state.legacy.appliedParameters.begin(), state.legacy.appliedParameters.end(),
            out_values);
  std::copy(state.legacy.feedbackCalibration.begin(), state.legacy.feedbackCalibration.end(),
            out_values + 10u);
  std::copy(state.legacy.auxiliaryValues.begin(), state.legacy.auxiliaryValues.end(),
            out_values + 19u);
  std::copy(state.appliedParameters.begin() + 10u, state.appliedParameters.end(), out_values + 45u);
  std::copy(state.transitionBoundaryAppliedParameters.begin() + 10u,
            state.transitionBoundaryAppliedParameters.end(), out_values + 52u);
  return ET_OK;
}

et_status et_instance_debug_begin_observation(et_engine engine, et_instance instance,
                                              std::uint32_t *out_origin_words,
                                              std::uint32_t word_count) {
  effetune::Engine *target = findEngine(engine);
  if (target == nullptr || out_origin_words == nullptr || word_count != 2u) {
    return ET_ERR_ARGS;
  }
  std::uint64_t origin = 0u;
  const et_status status = target->beginInstanceDebugObservation(instance, origin);
  if (status == ET_OK) {
    out_origin_words[0] = static_cast<std::uint32_t>(origin);
    out_origin_words[1] = static_cast<std::uint32_t>(origin >> 32u);
  }
  return status;
}

et_status et_instance_debug_clear_detector_observation(et_engine engine, et_instance instance) {
  effetune::Engine *target = findEngine(engine);
  if (target == nullptr) {
    return ET_ERR_ARGS;
  }
  return target->clearInstanceDebugDetectorObservation(instance);
}
#endif

float *et_arena_combined_ptr(et_engine engine) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? nullptr : target->combined();
}

float *et_arena_bus_ptr(et_engine engine, std::uint32_t bus) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? nullptr : target->bus(bus);
}

float *et_arena_scratch_ptr(et_engine engine, std::uint32_t which) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? nullptr : target->scratch(which);
}

char *et_scratch_ptr(et_engine engine) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? nullptr : target->byteScratch();
}

std::uint8_t *et_telemetry_staging_ptr(et_engine engine) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? nullptr : target->telemetryStaging();
}

std::uint32_t et_telemetry_capacity(et_engine engine) {
  const effetune::Engine *target = findEngine(engine);
  return target == nullptr ? 0u : target->telemetryCapacity();
}

std::uint32_t et_telemetry_read(et_engine engine, std::uint8_t *output, std::uint32_t max_bytes,
                                std::uint32_t *dropped_frames) {
  effetune::Engine *target = findEngine(engine);
  if (target == nullptr) {
    if (dropped_frames != nullptr) {
      *dropped_frames = 0u;
    }
    return 0u;
  }
  return target->readTelemetry(output, max_bytes, dropped_frames);
}

et_status et_pipeline_configure(et_engine engine, const std::uint8_t *descriptor,
                                std::uint32_t descriptor_bytes) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr ? ET_ERR_ARGS : target->configurePipeline(descriptor, descriptor_bytes);
}

std::uint32_t et_pipeline_latency(et_engine engine) {
  const effetune::Engine *target = findEngine(engine);
  return target == nullptr ? 0u : target->pipelineLatency();
}

et_status et_pipeline_process(et_engine engine, std::uint32_t channel_count,
                              std::uint32_t frame_count, double time_seconds,
                              std::uint32_t master_bypass) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr
             ? ET_ERR_ARGS
             : target->processPipeline(channel_count, frame_count, time_seconds, master_bypass);
}

} // extern "C"
