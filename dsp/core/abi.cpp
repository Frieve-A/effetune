#include "effetune/abi.h"

#include "arena.h"
#include "engine.h"
#include "registry.h"

#include <array>
#include <cstring>
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
  return target == nullptr ? ET_ASSET_STATE_NONE : target->instanceAssetState(instance, slot);
}

et_status et_instance_process(et_engine engine, et_instance instance, float *audio,
                              std::uint32_t channel_count, std::uint32_t frame_count,
                              double time_seconds) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr
             ? ET_ERR_ARGS
             : target->processInstance(instance, audio, channel_count, frame_count, time_seconds);
}

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

et_status et_pipeline_process(et_engine engine, std::uint32_t channel_count,
                              std::uint32_t frame_count, double time_seconds,
                              std::uint32_t master_bypass) {
  effetune::Engine *target = findEngine(engine);
  return target == nullptr
             ? ET_ERR_ARGS
             : target->processPipeline(channel_count, frame_count, time_seconds, master_bypass);
}

} // extern "C"
