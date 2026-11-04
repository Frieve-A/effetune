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

/* Host musical context at the first input frame of a process call. */
typedef struct et_host_transport {
  uint32_t flags;
  double tempo_bpm;
  double ppq_position;
  double bar_start_ppq;
  uint32_t time_signature_numerator, time_signature_denominator;
} et_host_transport;
enum {
  ET_HOST_TRANSPORT_PLAYING = 1u,
  ET_HOST_TRANSPORT_TEMPO_VALID = 2u,
  ET_HOST_TRANSPORT_POSITION_VALID = 4u,
  ET_HOST_TRANSPORT_BAR_START_VALID = 8u,
  ET_HOST_TRANSPORT_TIME_SIGNATURE_VALID = 16u,
  ET_HOST_TRANSPORT_LOOPING = 32u
};
/* Control-only sample page requests. Frame/page identities retain all64 bits. */
typedef struct et_sfz_sample_request {
  uint32_t generation_low, generation_high;
  uint32_t page_low, page_high;
  uint32_t sample, reserved;
} et_sfz_sample_request;
ET_EXPORT uint32_t et_sfz_stream_capability(void);
ET_EXPORT et_status et_instance_stream_configure(et_engine engine, et_instance instance,
                                                 uint32_t generation_low, uint32_t generation_high);
ET_EXPORT et_status et_instance_stream_take_requests(et_engine engine, et_instance instance,
                                                     et_sfz_sample_request *requests,
                                                     uint32_t capacity, uint32_t *count);
ET_EXPORT et_status et_instance_stream_publish(et_engine engine, et_instance instance,
                                               uint32_t generation_low, uint32_t generation_high,
                                               uint32_t sample, uint32_t page_low,
                                               uint32_t page_high, const float *pcm,
                                               uint32_t frames, uint32_t channels, uint32_t flags);
/* Short MIDI messages at the input frame of the addressed instrument. */
typedef struct et_midi_event {
  uint32_t offset_frames;
  uint32_t message;
  uint32_t note_id;
  uint32_t flags;
  /* Absolute active-render clock; distinct from the offset in this audio block. */
  uint32_t render_frame_low;
  uint32_t render_frame_high;
} et_midi_event;
/* Immutable SMF musical-time map. Install only at a control/lifecycle boundary. */
typedef struct et_midi_transport_point {
  double seconds, ppq, bar_start_ppq, bpm;
  uint32_t numerator, denominator;
} et_midi_transport_point;
enum {
  ET_MIDI_TRANSPORT_ENABLED = 1u,
  ET_MIDI_TRANSPORT_PLAYING = 2u,
  ET_MIDI_TRANSPORT_LOOPING = 4u
};
enum {
  ET_STREAM_FORECAST_BEGIN = 1u,
  ET_STREAM_FORECAST_COMMIT = 2u,
  ET_STREAM_FORECAST_ADMIT = 4u,
  ET_STREAM_FORECAST_SELECTED_PRESETS = 8u
};
/* CONTROL only. ADMIT uses window-relative processed-output offset_frames,
 * sorted in input order, and a conservative SF2 source-page plan. BEGIN copies
 * current channels. COMMIT requires count0; ET_NEED_SAMPLE means actual page
 * ACKs are pending. ET_ERR_OOM for an ADMIT attempt is nonfatal pressure and
 * preserves the previous committed prediction. SELECTED_PRESETS is valid with
 * ADMIT|BEGIN and warms current selected banks/programs, not the whole bank.
 * Each selected onset covers the prepared maximum output block plus the native
 * pitch/FIR/offset/loop source geometry; existing voices retain window_frames.
 * Prefix preparation never requests a full horizon for every possible key. */
ET_EXPORT et_status et_instance_stream_prefetch(et_engine engine, et_instance instance,
                                                const et_midi_event *events, uint32_t count,
                                                uint32_t generation, uint32_t window_frames,
                                                uint32_t flags);
enum {
  ET_STREAM_SCOPE_NONE = 0u,
  ET_STREAM_SCOPE_KNOWN_MIDI = 1u,
  ET_STREAM_SCOPE_SELECTED_PRESETS = 2u,
  ET_STREAM_SCOPE_BEST_EFFORT = 3u
};
typedef struct et_stream_readiness {
  uint32_t generation, scope, admitted_frames, ready_ahead_frames;
  uint32_t planned_pages, pending_pages;
} et_stream_readiness;
/* CONTROL-only, allocation/scan-free snapshot. Frames are processed output
 * frames at the instrument's native sample rate. ready_ahead_frames is nonzero
 * only for fully ACKed KNOWN_MIDI predictions and decreases with the committed
 * completed-render sample counter (including silent/unjoined processing).
 * Generation0 is legal before MIDI ownership is attached; it must equal the
 * instance's current MIDI generation. SELECTED_PRESETS with pending_pages0 means its prefix is
 * ready; it does not predict unknown future live notes or controller changes. NONE has no admitted
 * prediction. The caller validates the MIDI generation and invalidates its known-timeline claim
 * after unplanned input/state edits. BEST_EFFORT reports actual ACKs for the
 * existing conservative SFZ/analysis preview, with ready_ahead_frames0 because
 * dynamic/VM future is unknown. */
ET_EXPORT et_status et_instance_stream_readiness(et_engine engine, et_instance instance,
                                                 et_stream_readiness *out);
enum {
  ET_MIDI_RESET = 1u,
  ET_MIDI_STATE_ONLY = 2u,
  ET_MIDI_REATTACK = 4u,
  ET_MIDI_PRESERVE_RELEASE = 8u,
  ET_MIDI_PAUSE = 16u,
  ET_MIDI_RESUME = 32u,
  ET_MIDI_RETIME = 64u,
  ET_MIDI_NATURAL_END = 128u,
  // Hydrate only channel state for a newly available MIDI instrument. No notes,
  // scripts, voice actions or clock advancement; use alone after generation attach.
  ET_MIDI_HYDRATE_CHANNEL_STATE = 512u,
  // Per-event tag inside a channel hydration batch: restore only the latest
  // accepted global CC/bend/pressure value, without reapplying channel state or actions.
  ET_MIDI_HYDRATE_GLOBAL_CC = 1024u,
  // Per-event tag inside a channel hydration batch: restore channel state only.
  // A live snapshot supplies its actual accepted global values separately.
  ET_MIDI_HYDRATE_CHANNEL_ONLY = 2048u,
  // Owner-thread channel-state edit, alone with current generation. Only offset0
  // bank/program and CC7/10/11/91/93 messages are legal. It is accepted while
  // paused and does not replace queued musical events or run scripts/triggers.
  ET_MIDI_CONTROL_ONLY = 4096u,
  // Per-event marker: message0,note_id=reset kind,clock fields0. The block
  // offset is honored without rewinding transport/generation/queued events.
  ET_MIDI_SYSTEM_RESET = 8192u,
  // Per-event GS/XG percussion designation. Status byte0, data1=channel0..15,
  // data2=mode0..3 (0=melodic, nonzero=percussion), note_id/clock fields0.
  // Hosts normalize GS USE FOR RHYTHM PART or XG PART MODE; no raw SysEx ABI.
  ET_MIDI_DRUM_MODE = 16384u
};
enum { ET_MIDI_SYSTEM_GM = 1u, ET_MIDI_SYSTEM_GS = 2u, ET_MIDI_SYSTEM_XG = 3u };
enum { ET_MIDI_CLOCK_RUNNING = 1u, ET_MIDI_CLOCK_HISTORY = 2u };
enum {
  ET_MIDI_STATE_VOICES = 1u,
  ET_MIDI_STATE_CALLBACKS = 2u,
  ET_MIDI_STATE_GENERATED = 4u,
  ET_MIDI_STATE_SCRIPT_ERROR = 8u,
  ET_MIDI_STATE_HISTORY_PENDING = 16u
};
typedef struct et_runtime_event_state {
  uint32_t generation;
  uint32_t latched;
  uint32_t cause;
} et_runtime_event_state;

enum {
  ET_OK = 0,
  ET_NEED_SAMPLE = 1,
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
/* Owner-thread, allocation-free copy; update before each process call. NULL clears
 * the context. Unknown flags are rejected without changing the previous context.
 * Invalid/non-finite fields clear their validity flags. No clock is advanced. */
ET_EXPORT et_status et_engine_set_host_transport(et_engine engine,
                                                 const et_host_transport *transport);
enum { ET_SAMPLE_PLAYER_NOTE = 0u, ET_SAMPLE_PLAYER_MAIN = 1u };

/* CONTROL-only complete per-bank additional native preparation peak for
 * SoundFont/SFZ players. Required footprint is payload_bytes + *additional_bytes;
 * compiler-private base footprints or sizeof arithmetic are not required.
 * Includes index/typed/script/cache/forecast and native processing ownership.
 * Fixed instance preparation, allocator metadata and process RSS are separate.
 * control contains the
 * complete metadata prefix before resident PCM; payload_bytes is the declared
 * full asset extent. Streamed assets contain only metadata, so their complete
 * payload is the prefix. No source PCM is read or copied for this query.
 * Uses the target build's allocator/DSP geometry. On failure, *additional_bytes
 * is0. player_kind selects Note (128 voices) or Main (1024 voices); unknown
 * kinds are rejected. Use the same kind as the target instance.
 * minimum_physical_bpm is the caller's preparation bound, not a live clock. */
ET_EXPORT et_status et_sample_player_preparation_bytes(
    const uint8_t *control, uint32_t control_bytes, uint32_t payload_bytes, uint32_t format_tag,
    float sample_rate, uint32_t processing_channels, uint32_t max_frames,
    double minimum_physical_bpm, uint64_t *additional_bytes, uint32_t player_kind);

ET_EXPORT et_instance et_instance_create(et_engine engine, const char *type_name);
ET_EXPORT void et_instance_destroy(et_engine engine, et_instance instance);
ET_EXPORT et_status et_instance_reset(et_engine engine, et_instance instance);
ET_EXPORT et_status et_instance_set_midi_events(et_engine engine, et_instance instance,
                                                const et_midi_event *events, uint32_t count,
                                                uint32_t generation, uint32_t flags);
ET_EXPORT et_status et_instance_set_midi_gain(et_engine engine, et_instance instance, float gain);
enum {
  ET_MIDI_CHANNEL_UNMUTE = 0u,
  ET_MIDI_CHANNEL_MUTE = 1u,
  ET_MIDI_CHANNEL_UNSOLO = 2u,
  ET_MIDI_CHANNEL_SOLO = 3u
};
/* Atomic transient channel edit, serialized between process calls. Channel is
 * zero-based 0..15; action is one of the four values above. Mute wins over solo.
 * Other channel bits are unchanged. Voices/controllers/clocks continue. New
 * MIDI generation/reset clears both masks. Not parameters/checkpoint contents. */
ET_EXPORT et_status et_instance_set_midi_channel_mix(et_engine engine, et_instance instance,
                                                     uint32_t channel, uint32_t action);
/* Owner-thread ephemeral measurement control for SoundFont Player. enabled is
 * 0 or 1; default is off. Other kernels return UNSUPPORTED. This is independent
 * of saved parameters, checkpoints, audio and MIDI clocks. Disable clears peaks. */
ET_EXPORT et_status et_instance_set_midi_metering(et_engine engine, et_instance instance,
                                                  uint32_t enabled);
/* SoundFont mixer telemetry frame35/version2: payload584bytes. Header u16
 * totalVoices@0,voiceLimit@2; reserved4..7 remain0. Sixteen32byte channel rows at8:
 * effectiveBank:u16@0,effectiveProgram:u8@2,CC7/10/11/91/93:u8@3..7,
 * flags:u8@8(mute1,solo2),sourceProgram:u8@9,resolvedPresetIndex:u16@10,
 * voices:u16@12,sourceBankMSB/LSB:u8@14/15,heldInputNoteBitmap128bits@16.
 * Integers are little-endian; bitmap bit0 is note0. Effective bank/preset index
 * FFFF and effective program FF mean unresolved. Voice counts include release
 * tails. Note bits track accepted NoteOn until matching NoteOff, independently
 * of sustain, release tails, missing samples and voice stealing.
 * Sixteen little-endian F32 channel peaks follow at520+4*channel. Linear values
 * can exceed1. They measure the summed stereo direct signal (max absolute L/R),
 * including controllers, pan, mute/solo and instrument gain, excluding shared FX
 * returns and upstream input. Off/unavailable is0. Successful audio quanta are
 * accumulated until a complete frame is queued; failed enqueue retains peaks.
 * Visual telemetry uses the ring's latest-state overflow policy. */

/* count zero clears the map. The engine copies the supplied points. */
ET_EXPORT et_status et_instance_set_midi_transport_map(et_engine engine, et_instance instance,
                                                       const et_midi_transport_point *points,
                                                       uint32_t count);
/* Allocation-free mapping from the existing instrument render clock to song time. */
ET_EXPORT et_status et_instance_set_midi_transport(et_engine engine, et_instance instance,
                                                   uint32_t frame_low, uint32_t frame_high,
                                                   double seconds, double speed, double duration,
                                                   uint32_t flags);
ET_EXPORT et_status et_instance_set_midi_clock(et_engine engine, et_instance instance,
                                               uint32_t frame_low, uint32_t frame_high,
                                               uint32_t generation, uint32_t flags);
ET_EXPORT uint32_t et_instance_midi_state(et_engine engine, et_instance instance);
ET_EXPORT uint32_t et_instance_midi_clock_low(et_engine engine, et_instance instance);
ET_EXPORT uint32_t et_instance_midi_clock_high(et_engine engine, et_instance instance);
ET_EXPORT uint32_t et_instance_midi_generation(et_engine engine, et_instance instance);
ET_EXPORT uint32_t et_instance_midi_checkpoint_size(et_engine engine, et_instance instance);
ET_EXPORT et_status et_instance_write_midi_checkpoint(et_engine engine, et_instance instance,
                                                      uint8_t *destination, uint32_t bytes);
ET_EXPORT et_status et_instance_read_midi_checkpoint(et_engine engine, et_instance instance,
                                                     const uint8_t *source, uint32_t bytes);
ET_EXPORT uint32_t et_instance_latency(et_engine engine, et_instance instance);
/* App-internal note-analysis reuse; producer 0 clears the link. */
// App-internal temporal boundary; does not reset the instance or telemetry.
ET_EXPORT et_status et_instance_stream_boundary(et_engine engine, et_instance instance);
ET_EXPORT et_status et_instance_set_analysis_source(et_engine engine, et_instance consumer,
                                                    et_instance producer);
ET_EXPORT et_status et_instance_set_tap(et_engine engine, et_instance instance, uint32_t tap_id);
ET_EXPORT et_status et_instance_set_seed(et_engine engine, et_instance instance, uint32_t seed_low,
                                         uint32_t seed_high);
ET_EXPORT et_status et_instance_set_params(et_engine engine, et_instance instance,
                                           const float *packed, uint32_t float_count,
                                           uint32_t params_hash, uint32_t offset_frames);
ET_EXPORT et_status et_instance_set_param_bytes(et_engine engine, et_instance instance,
                                                const uint8_t *packed, uint32_t byte_count,
                                                uint32_t params_hash, uint32_t offset_frames);
/* Legacy WASM32 address entry; returns0 without mutation on native64 builds. */
ET_EXPORT uint32_t et_instance_asset_begin(et_engine engine, et_instance instance, uint32_t slot,
                                           uint32_t channels, uint32_t frames, uint32_t topology,
                                           uint32_t head_block, uint32_t rate_divider,
                                           uint32_t path_count, uint32_t input_count,
                                           uint32_t processing_channels, uint32_t footprint_bytes,
                                           uint32_t byte_size);
/* Portable pointer entry. Pass the same minimum_physical_bpm used by the storage
 * query. Zero selects the standalone 120 BPM fallback, independently of the
 * current MIDI map. Negative/nonfinite values fail before changing the active
 * asset. Preparation is CONTROL-only; serialize with the engine owner before
 * uploading and committing the asset. */
ET_EXPORT uint8_t *et_instance_asset_begin_ptr(et_engine engine, et_instance instance,
                                               uint32_t slot, uint32_t channels, uint32_t frames,
                                               uint32_t topology, uint32_t head_block,
                                               uint32_t rate_divider, uint32_t path_count,
                                               uint32_t input_count, uint32_t processing_channels,
                                               uint32_t footprint_bytes, uint32_t byte_size,
                                               double minimum_physical_bpm);
ET_EXPORT et_status et_instance_asset_commit(et_engine engine, et_instance instance, uint32_t slot,
                                             uint32_t byte_size, uint32_t format_tag);
ET_EXPORT void et_instance_asset_abort(et_engine engine, et_instance instance, uint32_t slot);
ET_EXPORT uint32_t et_instance_asset_state(et_engine engine, et_instance instance, uint32_t slot);
/*
 * Audio is planar (channel-major): channel c starts at audio + c * frame_count.
 * frame_count is the number of frames per channel, not the total float count, and
 * must not exceed max_frames passed to et_engine_prepare.
 */
/* Native x86 render calls temporarily enable MXCSR FTZ/DAZ and restore the
 * caller's complete MXCSR on return, including error paths. Pipeline, graph
 * and offline graph rendering use the same scoped policy. Other targets do
 * not change a host floating-point control register. */
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
/* Control-side refresh; may allocate and free compensation storage. */
ET_EXPORT et_status et_pipeline_refresh_latency(et_engine engine);
/* Reserve storage off the audio thread after configuration and before processing. */
ET_EXPORT et_status et_pipeline_reserve_latency(et_engine engine);
/* Parameter-only refresh without allocation/free; returns ET_ERR_STATE if unreserved
 * or a
 * latency/storage bound is exceeded. Never falls back to allocation. */
ET_EXPORT et_status et_pipeline_refresh_latency_realtime(et_engine engine);
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
/* Internal offline pipeline graph; public graph descriptor v1 is unchanged. */
ET_EXPORT et_status et_graph_configure_offline(et_engine engine, const uint8_t *descriptor,
                                               uint32_t descriptor_bytes);
ET_EXPORT et_status et_graph_prepare_offline(et_engine engine, uint32_t *generation_low,
                                             uint32_t *generation_high);
ET_EXPORT et_status et_graph_process_offline(et_engine engine, uint32_t channel_count,
                                             uint32_t frame_count, double time_seconds,
                                             uint32_t generation_low, uint32_t generation_high);
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
