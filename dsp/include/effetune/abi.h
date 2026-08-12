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
typedef struct et_runtime_event_state {
  uint32_t generation;
  uint32_t latched;
  uint32_t cause;
} et_runtime_event_state;

enum {
  ET_OK = 0,
  ET_ERR_ARGS = -1,
  ET_ERR_STATE = -2,
  ET_ERR_OOM = -3,
  ET_ERR_UNKNOWN_TYPE = -4,
  ET_ERR_HASH = -5,
  ET_ERR_DESC = -6,
  ET_ERR_UNSUPPORTED = -7,
  ET_ERR_GRAPH_INVALID = -8,
  ET_ERR_GRAPH_CYCLE = -9,
  ET_ERR_GRAPH_DISCONNECTED = -10,
  ET_ERR_GRAPH_CAPACITY = -11,
  ET_ERR_GRAPH_LATENCY_OVERFLOW = -12,
  ET_ERR_GRAPH_UNSUPPORTED_CAPABILITY = -13,
  ET_ERR_GRAPH_INSTANCE_PREPARE = -14
};

enum { ET_BUILD_SIMD = 1u << 0u, ET_BUILD_DEBUG = 1u << 1u, ET_BUILD_GRAPH = 1u << 2u };

enum { ET_GRAPH_CAPABILITY_V1 = 1u << 0u };

enum {
  ET_GRAPH_DIAGNOSTIC_GRAPH = 0u,
  ET_GRAPH_DIAGNOSTIC_NODE = 1u,
  ET_GRAPH_DIAGNOSTIC_EDGE = 2u
};

enum {
  ET_GRAPH_PATH_NONE = 0u,
  ET_GRAPH_PATH_DOCUMENT = 1u,
  ET_GRAPH_PATH_NODE_ID = 2u,
  ET_GRAPH_PATH_NODE_INSTANCE = 3u,
  ET_GRAPH_PATH_NODE_ASSET = 4u,
  ET_GRAPH_PATH_NODE_LATENCY = 5u,
  ET_GRAPH_PATH_NODE_CHANNEL = 6u,
  ET_GRAPH_PATH_EDGE_ID = 7u,
  ET_GRAPH_PATH_EDGE_SOURCE = 8u,
  ET_GRAPH_PATH_EDGE_DESTINATION = 9u,
  ET_GRAPH_PATH_EDGE_GAIN = 10u,
  ET_GRAPH_PATH_EDGE_PAN = 11u,
  ET_GRAPH_PATH_EDGE_CONTROL = 12u,
  ET_GRAPH_PATH_GRAPH_CYCLE = 13u,
  ET_GRAPH_PATH_GRAPH_CONNECTIVITY = 14u,
  ET_GRAPH_PATH_GRAPH_BUFFERS = 15u,
  ET_GRAPH_PATH_GRAPH_DELAY = 16u,
  ET_GRAPH_PATH_GRAPH_MEMORY = 17u,
  ET_GRAPH_PATH_GRAPH_LATENCY = 18u
};

typedef struct et_graph_diagnostic {
  int32_t status;
  uint32_t kind;
  uint32_t index;
  uint32_t path;
  uint32_t required;
  uint32_t capacity;
} et_graph_diagnostic;

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
ET_EXPORT uint32_t et_graph_capabilities(void);
ET_EXPORT uint32_t et_graph_version(void);
ET_EXPORT uint32_t et_kernel_count(void);
ET_EXPORT int32_t et_kernel_name(uint32_t index, char *buffer, uint32_t buffer_size);
ET_EXPORT uint32_t et_kernel_params_hash(uint32_t index);
ET_EXPORT uint32_t et_kernel_param_bytes_capacity(uint32_t index);
ET_EXPORT uint32_t et_kernel_asset_capacity(uint32_t index, uint32_t slot);

typedef struct et_design_fft et_design_fft;
ET_EXPORT et_design_fft *et_design_fft_create(uint32_t size);
ET_EXPORT void et_design_fft_destroy(et_design_fft *fft);
ET_EXPORT float *et_design_fft_input(et_design_fft *fft);
ET_EXPORT const float *et_design_fft_output(const et_design_fft *fft);
ET_EXPORT et_status et_design_fft_forward(et_design_fft *fft);
ET_EXPORT et_status et_design_fft_inverse(et_design_fft *fft);

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
/*
 * Audio is planar (channel-major): channel c starts at audio + c * frame_count.
 * frame_count is the number of frames per channel, not the total float count, and
 * must not exceed max_frames passed to et_engine_prepare.
 */
ET_EXPORT et_status et_instance_process(et_engine engine, et_instance instance, float *audio,
                                        uint32_t channel_count, uint32_t frame_count,
                                        double time_seconds);
ET_EXPORT et_status et_instance_runtime_event(et_engine engine, et_instance instance,
                                              et_runtime_event_state *out_state);

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
ET_EXPORT uint32_t et_pipeline_latency(et_engine engine);
ET_EXPORT et_status et_pipeline_process(et_engine engine, uint32_t channel_count,
                                        uint32_t frame_count, double time_seconds,
                                        uint32_t master_bypass);

/*
 * Graph descriptor v1 is a bounded little-endian binary document. Effect instances,
 * parameters, seeds, and assets must be prepared before et_graph_configure. Configure
 * reads the prepared instances' authoritative latency and atomically installs a complete
 * immutable execution plan. A failed configure leaves any previous plan installed.
 */
ET_EXPORT et_status et_graph_configure(et_engine engine, const uint8_t *descriptor,
                                       uint32_t descriptor_bytes);
ET_EXPORT et_status et_graph_reset(et_engine engine);
ET_EXPORT et_status et_graph_set_instance_params(et_engine engine, et_instance instance,
                                                 const float *packed, uint32_t float_count,
                                                 uint32_t params_hash, uint32_t changed_index);
ET_EXPORT uint32_t et_graph_latency(et_engine engine);
ET_EXPORT et_status et_graph_process(et_engine engine, uint32_t channel_count, uint32_t frame_count,
                                     double time_seconds);
ET_EXPORT uint32_t et_graph_snapshot_size(et_engine engine);
ET_EXPORT et_status et_graph_snapshot_copy(et_engine engine, uint8_t *output,
                                           uint32_t output_bytes);
ET_EXPORT et_status et_graph_read_diagnostic(et_engine engine, et_graph_diagnostic *out_diagnostic);

#ifdef __cplusplus
}
#endif

#endif
