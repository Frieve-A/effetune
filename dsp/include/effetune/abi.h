#ifndef EFFETUNE_ABI_H
#define EFFETUNE_ABI_H

#include <stdint.h>

#if defined(__GNUC__) || defined(__clang__)
#define ET_EXPORT __attribute__((used, visibility("default")))
#else
#define ET_EXPORT
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define EFFETUNE_DSP_ABI_VERSION 1u

typedef uint32_t et_engine;
typedef uint32_t et_instance;
typedef int32_t et_status;

enum {
  ET_OK = 0,
  ET_ERR_ARGS = -1,
  ET_ERR_STATE = -2,
  ET_ERR_OOM = -3,
  ET_ERR_UNKNOWN_TYPE = -4,
  ET_ERR_HASH = -5,
  ET_ERR_DESC = -6,
  ET_ERR_UNSUPPORTED = -7
};

enum { ET_BUILD_SIMD = 1u << 0u, ET_BUILD_DEBUG = 1u << 1u };

enum {
  ET_ASSET_F32_MULTICH = 1u,
  ET_ASSET_STATE_NONE = 0u,
  ET_ASSET_STATE_STAGED = 1u,
  ET_ASSET_STATE_PREPARING = 2u,
  ET_ASSET_STATE_ACTIVE = 3u,
  ET_ASSET_STATE_ERROR = 4u
};

ET_EXPORT uint32_t et_abi_version(void);
ET_EXPORT uint32_t et_build_flags(void);
ET_EXPORT uint32_t et_kernel_count(void);
ET_EXPORT int32_t et_kernel_name(uint32_t index, char *buffer, uint32_t buffer_size);
ET_EXPORT uint32_t et_kernel_params_hash(uint32_t index);
ET_EXPORT uint32_t et_kernel_param_bytes_capacity(uint32_t index);
ET_EXPORT uint32_t et_kernel_asset_capacity(uint32_t index, uint32_t slot);

ET_EXPORT uint32_t et_engine_memory_required(float sample_rate, uint32_t max_channels,
                                             uint32_t max_frames, uint32_t telemetry_ring_bytes);
ET_EXPORT et_engine et_engine_create(void);
ET_EXPORT void et_engine_destroy(et_engine engine);
ET_EXPORT et_status et_engine_prepare(et_engine engine, float sample_rate, uint32_t max_channels,
                                      uint32_t max_frames, uint32_t telemetry_ring_bytes);
ET_EXPORT et_status et_engine_reset(et_engine engine);
ET_EXPORT et_status et_engine_set_telemetry_rate(et_engine engine, float rate_hz);

ET_EXPORT et_instance et_instance_create(et_engine engine, const char *type_name);
ET_EXPORT void et_instance_destroy(et_engine engine, et_instance instance);
ET_EXPORT et_status et_instance_reset(et_engine engine, et_instance instance);
ET_EXPORT uint32_t et_instance_latency(et_engine engine, et_instance instance);
ET_EXPORT et_status et_instance_set_tap(et_engine engine, et_instance instance, uint32_t tap_id);
ET_EXPORT et_status et_instance_set_seed(et_engine engine, et_instance instance, uint32_t seed_low,
                                         uint32_t seed_high);
ET_EXPORT et_status et_instance_set_params(et_engine engine, et_instance instance,
                                           const float *packed, uint32_t float_count,
                                           uint32_t params_hash, uint32_t offset_frames);
ET_EXPORT et_status et_instance_set_param_bytes(et_engine engine, et_instance instance,
                                                const uint8_t *packed, uint32_t byte_count,
                                                uint32_t params_hash, uint32_t offset_frames);
ET_EXPORT uint32_t et_instance_asset_begin(et_engine engine, et_instance instance, uint32_t slot,
                                           uint32_t channels, uint32_t frames, uint32_t topology,
                                           uint32_t head_block, uint32_t rate_divider,
                                           uint32_t path_count, uint32_t input_count,
                                           uint32_t processing_channels, uint32_t footprint_bytes,
                                           uint32_t byte_size);
ET_EXPORT et_status et_instance_asset_commit(et_engine engine, et_instance instance, uint32_t slot,
                                             uint32_t byte_size, uint32_t format_tag);
ET_EXPORT void et_instance_asset_abort(et_engine engine, et_instance instance, uint32_t slot);
ET_EXPORT uint32_t et_instance_asset_state(et_engine engine, et_instance instance, uint32_t slot);
ET_EXPORT et_status et_instance_process(et_engine engine, et_instance instance, float *audio,
                                        uint32_t channel_count, uint32_t frame_count,
                                        double time_seconds);

ET_EXPORT float *et_arena_combined_ptr(et_engine engine);
ET_EXPORT float *et_arena_bus_ptr(et_engine engine, uint32_t bus);
ET_EXPORT float *et_arena_scratch_ptr(et_engine engine, uint32_t which);
ET_EXPORT char *et_scratch_ptr(et_engine engine);

ET_EXPORT uint8_t *et_telemetry_staging_ptr(et_engine engine);
ET_EXPORT uint32_t et_telemetry_capacity(et_engine engine);
ET_EXPORT uint32_t et_telemetry_read(et_engine engine, uint8_t *output, uint32_t max_bytes,
                                     uint32_t *dropped_frames);

ET_EXPORT et_status et_pipeline_configure(et_engine engine, const uint8_t *descriptor,
                                          uint32_t descriptor_bytes);
ET_EXPORT et_status et_pipeline_process(et_engine engine, uint32_t channel_count,
                                        uint32_t frame_count, double time_seconds,
                                        uint32_t master_bypass);

#ifdef __cplusplus
}
#endif

#endif
