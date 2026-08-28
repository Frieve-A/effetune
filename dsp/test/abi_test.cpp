#include "test_support.h"

#include "allocation_guard.h"
#include "effetune/abi.h"
#include "engine.h"
#include "nothrow_storage.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <initializer_list>
#include <latch>
#include <memory>
#include <span>
#include <thread>
#include <type_traits>
#include <vector>

#if !defined(__EMSCRIPTEN__) &&                                                                    \
    (defined(_M_IX86) || defined(_M_X64) || defined(__i386__) || defined(__x86_64__))
#include <xmmintrin.h>
#define ET_TEST_HAS_X86_MXCSR 1
#endif

namespace effetune::test {
namespace {

constexpr std::uint32_t kTestHash = 0xa17e5eedu;

std::uint32_t findKernelIndex(const char *name) {
  std::array<char, 128> buffer{};
  for (std::uint32_t index = 0; index < et_kernel_count(); ++index) {
    if (et_kernel_name(index, buffer.data(), static_cast<std::uint32_t>(buffer.size())) >= 0 &&
        std::strcmp(buffer.data(), name) == 0) {
      return index;
    }
  }
  return UINT32_MAX;
}

void testAllocationGuardScope() {
  ET_CHECK(!allocation_guard::active());
  {
    allocation_guard::Scope scope;
    ET_CHECK(allocation_guard::active() == ((et_build_flags() & ET_BUILD_DEBUG) != 0u));
  }
  ET_CHECK(!allocation_guard::active());
}

void testAudioThreadEnablesDenormalFlush() {
#if defined(ET_TEST_HAS_X86_MXCSR)
  auto engine_storage = std::make_unique<Engine>();
  Engine &engine = *engine_storage;
  ET_CHECK(engine.prepare(48000.0F, 2u, 128u, 0u) == ET_OK);
  const et_instance instance = engine.createInstance("TestGainPlugin");
  ET_CHECK(instance != 0u);
  const float gain = 1.0F;
  ET_CHECK(engine.setInstanceParams(instance, &gain, 1u, kTestHash, 0u) == ET_OK);
  std::array<std::uint8_t, 20> pipeline{};
  pipeline[0] = 1u;
  pipeline[4] = 1u;
  pipeline[8] = static_cast<std::uint8_t>(instance);
  pipeline[9] = static_cast<std::uint8_t>(instance >> 8u);
  pipeline[10] = static_cast<std::uint8_t>(instance >> 16u);
  pipeline[11] = static_cast<std::uint8_t>(instance >> 24u);
  pipeline[12] = 1u;
  pipeline[15] = static_cast<std::uint8_t>(-2);
  pipeline[16] = 1u;
  ET_CHECK(engine.configurePipeline(pipeline.data(), static_cast<std::uint32_t>(pipeline.size())) ==
           ET_OK);

  const auto entryEnablesFlush = [&](auto process, et_status expectedStatus) {
    bool enabled = false;
    std::thread audioThread([&]() {
      constexpr unsigned int kFlushToZero = 1u << 15u;
      constexpr unsigned int kDenormalsAreZero = 1u << 6u;
      const unsigned int original = _mm_getcsr();
      const unsigned int sentinel = (original & ~(kFlushToZero | kDenormalsAreZero)) | (1u << 13u);
      _mm_setcsr(sentinel);
      const et_status status = process();
      const unsigned int configured = _mm_getcsr();
      enabled =
          status == expectedStatus &&
          (configured & (kFlushToZero | kDenormalsAreZero)) == (kFlushToZero | kDenormalsAreZero) &&
          (configured & (1u << 13u)) != 0u;
      _mm_setcsr(original);
    });
    audioThread.join();
    return enabled;
  };

  std::array<float, 8> instanceAudio{};
  ET_CHECK(entryEnablesFlush(
      [&]() { return engine.processInstance(instance, instanceAudio.data(), 2u, 4u, 0.0); },
      ET_OK));
  ET_CHECK(entryEnablesFlush([&]() { return engine.processPipeline(2u, 4u, 0.0, 0u); }, ET_OK));
  ET_CHECK(entryEnablesFlush([&]() { return engine.processGraph(2u, 4u, 0.0); }, ET_ERR_STATE));
  ET_CHECK(entryEnablesFlush(
      [&]() -> et_status {
        if (engine.processInstance(instance, instanceAudio.data(), 2u, 4u, 0.0) != ET_OK ||
            engine.processPipeline(2u, 4u, 0.0, 0u) != ET_OK) {
          return ET_ERR_ARGS;
        }
        return engine.processGraph(2u, 4u, 0.0);
      },
      ET_ERR_STATE));
#endif
}

void testNothrowStorageContract() {
  static_assert(!std::is_copy_constructible_v<NothrowStorage<std::uint32_t>>);
  static_assert(!std::is_copy_assignable_v<NothrowStorage<std::uint32_t>>);

  NothrowStorage<std::uint32_t> storage;
  ET_CHECK(storage.data() == nullptr);
  ET_CHECK(storage.size() == 0u);
  ET_CHECK(storage.allocate(3u));
  ET_CHECK(storage.data() != nullptr);
  ET_CHECK(storage.size() == 3u);
  storage.data()[0] = 1u;
  storage.data()[1] = 2u;
  storage.data()[2] = 3u;
  storage.clear();
  ET_CHECK(storage.data()[0] == 0u && storage.data()[1] == 0u && storage.data()[2] == 0u);

  ET_CHECK(storage.allocate(2u));
  ET_CHECK(storage.data() != nullptr);
  ET_CHECK(storage.size() == 2u);
  storage.release();
  ET_CHECK(storage.data() == nullptr);
  ET_CHECK(storage.size() == 0u);
  ET_CHECK(storage.allocate(0u));
  ET_CHECK(storage.data() == nullptr);
  ET_CHECK(storage.size() == 0u);

  if ((et_build_flags() & ET_BUILD_DEBUG) != 0u) {
    allocation_guard::failNothrowAllocationAfterForTesting(0);
    ET_CHECK(!storage.allocate(4u));
    allocation_guard::failNothrowAllocationAfterForTesting(-1);
    ET_CHECK(storage.data() == nullptr);
    ET_CHECK(storage.size() == 0u);
  }
}

void writeU32(std::uint8_t *output, std::uint32_t value) {
  output[0] = static_cast<std::uint8_t>(value & 0xffu);
  output[1] = static_cast<std::uint8_t>((value >> 8u) & 0xffu);
  output[2] = static_cast<std::uint8_t>((value >> 16u) & 0xffu);
  output[3] = static_cast<std::uint8_t>(value >> 24u);
}

std::array<std::uint8_t, 20> descriptor(et_instance instance, std::uint8_t input_bus,
                                        std::uint8_t output_bus, std::int8_t channel_spec) {
  std::array<std::uint8_t, 20> bytes{};
  writeU32(bytes.data(), 1u);
  writeU32(bytes.data() + 4u, 1u);
  writeU32(bytes.data() + 8u, instance);
  bytes[12] = 1u;
  bytes[13] = input_bus;
  bytes[14] = output_bus;
  bytes[15] = static_cast<std::uint8_t>(channel_spec);
  bytes[16] = 1u;
  return bytes;
}

struct PipelineNodeDescriptor {
  et_instance instance;
  std::uint8_t inputBus;
  std::uint8_t outputBus;
  std::int8_t channelSpec;
};

std::vector<std::uint8_t> pipelineDescriptor(std::initializer_list<PipelineNodeDescriptor> nodes) {
  std::vector<std::uint8_t> bytes(8u + nodes.size() * 12u, 0u);
  writeU32(bytes.data(), 1u);
  writeU32(bytes.data() + 4u, static_cast<std::uint32_t>(nodes.size()));
  std::uint32_t index = 0u;
  for (const PipelineNodeDescriptor &node : nodes) {
    std::uint8_t *record = bytes.data() + 8u + index * 12u;
    writeU32(record, node.instance);
    record[4] = 1u;
    record[5] = node.inputBus;
    record[6] = node.outputBus;
    record[7] = static_cast<std::uint8_t>(node.channelSpec);
    record[8] = 1u;
    ++index;
  }
  return bytes;
}

void testDiscoveryAndLifecycle() {
  ET_CHECK(et_abi_version() == EFFETUNE_DSP_ABI_VERSION);
  ET_CHECK(et_kernel_count() >= 1u);
  const std::uint32_t test_kernel_index = findKernelIndex("TestGainPlugin");
  ET_CHECK(test_kernel_index != UINT32_MAX);
  ET_CHECK(et_kernel_params_hash(test_kernel_index) == kTestHash);
  ET_CHECK(et_kernel_params_hash(et_kernel_count()) == 0u);
  ET_CHECK(et_kernel_param_bytes_capacity(test_kernel_index) == 0u);
  ET_CHECK(et_kernel_param_bytes_capacity(et_kernel_count()) == 0u);
  const std::uint32_t matrix_kernel_index = findKernelIndex("MatrixPlugin");
  ET_CHECK(matrix_kernel_index != UINT32_MAX);
  ET_CHECK(et_kernel_param_bytes_capacity(matrix_kernel_index) == 3076u);
  ET_CHECK(et_kernel_name(test_kernel_index, nullptr, 0u) == 14);
  char short_name[5]{};
  ET_CHECK(et_kernel_name(test_kernel_index, short_name, sizeof(short_name)) == 14);
  ET_CHECK(std::strcmp(short_name, "Test") == 0);
  ET_CHECK(et_kernel_name(et_kernel_count(), short_name, sizeof(short_name)) == ET_ERR_ARGS);

  ET_CHECK(et_engine_memory_required(48000.0F, 8u, 128u, 4096u) > 0u);
  ET_CHECK(et_engine_memory_required(48000.0F, 16u, 128u, 4096u) > 0u);
  ET_CHECK(et_engine_memory_required(48000.0F, 17u, 128u, 4096u) == 0u);
  ET_CHECK(et_engine_memory_required(48000.0F, 2u, 31u, 4096u) == 0u);

  const et_engine engine = et_engine_create();
  ET_CHECK(engine != 0u);
  ET_CHECK(et_engine_reset(engine) == ET_ERR_STATE);
  ET_CHECK(et_engine_prepare(engine, 48000.0F, 4u, 128u, 256u) == ET_OK);
  ET_CHECK(et_arena_combined_ptr(engine) != nullptr);
  ET_CHECK(et_arena_bus_ptr(engine, 0u) == et_arena_combined_ptr(engine));
  ET_CHECK(et_arena_bus_ptr(engine, 4u) != nullptr);
  ET_CHECK(et_arena_bus_ptr(engine, 5u) == nullptr);
  ET_CHECK(et_arena_scratch_ptr(engine, 3u) != nullptr);
  ET_CHECK(et_arena_scratch_ptr(engine, 4u) == nullptr);
  ET_CHECK(et_scratch_ptr(engine) != nullptr);
  ET_CHECK(et_telemetry_staging_ptr(engine) != nullptr);
  ET_CHECK(et_telemetry_capacity(engine) == 256u);
  ET_CHECK(et_engine_set_telemetry_rate(engine, 240.0F) == ET_OK);
  ET_CHECK(et_engine_set_telemetry_rate(engine, -1.0F) == ET_ERR_ARGS);

  ET_CHECK(et_instance_create(engine, "MissingPlugin") == 0u);
  const et_instance instance = et_instance_create(engine, "TestGainPlugin");
  ET_CHECK(instance != 0u);
  const float gain = 2.0F;
  ET_CHECK(et_instance_set_params(engine, instance, &gain, 1u, 0u, 0u) == ET_ERR_HASH);
  ET_CHECK(et_instance_set_params(engine, instance, &gain, 1u, kTestHash, 1u) == ET_ERR_ARGS);
  ET_CHECK(et_instance_set_params(engine, instance, &gain, 1u, kTestHash, 0u) == ET_OK);
  const std::uint8_t unsupported_bytes = 0u;
  ET_CHECK(et_instance_set_param_bytes(engine, instance, &unsupported_bytes, 1u, kTestHash, 0u) ==
           ET_ERR_ARGS);
  ET_CHECK(et_instance_set_seed(engine, instance, 0x01234567u, 0x89abcdefu) == ET_OK);
  ET_CHECK(et_instance_set_seed(engine, 0u, 1u, 2u) == ET_ERR_ARGS);

  std::array<float, 8> audio{1.0F, 2.0F, 3.0F, 4.0F, 5.0F, 6.0F, 7.0F, 8.0F};
  ET_CHECK(et_instance_process(engine, instance, audio.data(), 2u, 4u, 0.0) == ET_OK);
  ET_CHECK(audio[0] == 2.0F && audio[7] == 16.0F);
  ET_CHECK(et_instance_process(engine, instance, audio.data(), 5u, 4u, 0.0) == ET_ERR_ARGS);
  ET_CHECK(et_instance_set_tap(engine, instance, 42u) == ET_OK);

  et_instance_destroy(engine, instance);
  ET_CHECK(et_instance_reset(engine, instance) == ET_ERR_ARGS);

  const et_instance matrix_instance = et_instance_create(engine, "MatrixPlugin");
  ET_CHECK(matrix_instance != 0u);
  constexpr std::uint32_t kMatrixHash = 0x07080f45u;
  ET_CHECK(et_instance_set_params(engine, matrix_instance, nullptr, 0u, kMatrixHash, 0u) == ET_OK);
  constexpr std::array<std::uint8_t, 10> matrix_routes = {1u, 0u, 2u, 0u, 0u, 0u, 0u, 1u, 1u, 0u};
  ET_CHECK(et_instance_set_param_bytes(engine, matrix_instance, matrix_routes.data(),
                                       static_cast<std::uint32_t>(matrix_routes.size()), 0u,
                                       0u) == ET_ERR_HASH);
  ET_CHECK(et_instance_set_param_bytes(engine, matrix_instance, matrix_routes.data(),
                                       static_cast<std::uint32_t>(matrix_routes.size()),
                                       kMatrixHash, 1u) == ET_ERR_ARGS);
  ET_CHECK(et_instance_set_param_bytes(engine, matrix_instance, matrix_routes.data(),
                                       static_cast<std::uint32_t>(matrix_routes.size()),
                                       kMatrixHash, 0u) == ET_OK);
  std::array<float, 8> matrix_audio{1.0F, 2.0F, 3.0F, 4.0F, 5.0F, 6.0F, 7.0F, 8.0F};
  ET_CHECK(et_instance_process(engine, matrix_instance, matrix_audio.data(), 2u, 4u, 0.0) == ET_OK);
  ET_CHECK(matrix_audio[0] == 1.0F && matrix_audio[7] == 8.0F);
  et_instance_destroy(engine, matrix_instance);
  et_engine_destroy(engine);
}

void testPipelineValidationAndRouting() {
  const et_engine engine = et_engine_create();
  ET_CHECK(et_engine_prepare(engine, 48000.0F, 4u, 128u, 256u) == ET_OK);
  const et_instance gain_instance = et_instance_create(engine, "TestGainPlugin");
  const float gain = 2.0F;
  ET_CHECK(et_instance_set_params(engine, gain_instance, &gain, 1u, kTestHash, 0u) == ET_OK);

  auto valid = descriptor(gain_instance, 0u, 0u, -2);
  ET_CHECK(et_pipeline_configure(engine, valid.data(), static_cast<std::uint32_t>(valid.size())) ==
           ET_OK);
  float *main_bus = et_arena_combined_ptr(engine);
  for (std::uint32_t index = 0; index < 16u; ++index) {
    main_bus[index] = 1.0F;
  }
  ET_CHECK(et_pipeline_process(engine, 4u, 4u, 0.0, 0u) == ET_OK);
  ET_CHECK(main_bus[0] == 2.0F && main_bus[15] == 2.0F);

  valid[17] = 1u;
  ET_CHECK(et_pipeline_configure(engine, valid.data(), static_cast<std::uint32_t>(valid.size())) ==
           ET_ERR_DESC);
  for (std::uint32_t index = 0; index < 16u; ++index) {
    main_bus[index] = 1.0F;
  }
  ET_CHECK(et_pipeline_process(engine, 4u, 4u, 0.0, 0u) == ET_OK);
  ET_CHECK(main_bus[0] == 2.0F);
  valid[17] = 0u;

  auto pair = descriptor(gain_instance, 0u, 0u, 17);
  ET_CHECK(et_pipeline_configure(engine, pair.data(), static_cast<std::uint32_t>(pair.size())) ==
           ET_OK);
  for (std::uint32_t index = 0; index < 16u; ++index) {
    main_bus[index] = 1.0F;
  }
  ET_CHECK(et_pipeline_process(engine, 4u, 4u, 0.0, 0u) == ET_OK);
  ET_CHECK(main_bus[0] == 1.0F && main_bus[7] == 1.0F);
  ET_CHECK(main_bus[8] == 2.0F && main_bus[15] == 2.0F);

  auto send = descriptor(gain_instance, 0u, 1u, -2);
  ET_CHECK(et_pipeline_configure(engine, send.data(), static_cast<std::uint32_t>(send.size())) ==
           ET_OK);
  for (std::uint32_t index = 0; index < 16u; ++index) {
    main_bus[index] = 1.0F;
  }
  ET_CHECK(et_pipeline_process(engine, 4u, 4u, 0.0, 0u) == ET_OK);
  float *bus_one = et_arena_bus_ptr(engine, 1u);
  ET_CHECK(main_bus[0] == 1.0F && bus_one[0] == 2.0F && bus_one[15] == 2.0F);

  for (std::uint32_t index = 0; index < 16u; ++index) {
    main_bus[index] = 3.0F;
  }
  ET_CHECK(et_pipeline_process(engine, 4u, 4u, 0.0, 1u) == ET_OK);
  ET_CHECK(main_bus[0] == 3.0F && main_bus[15] == 3.0F);

  auto bad_channel = descriptor(gain_instance, 0u, 0u, 24);
  ET_CHECK(et_pipeline_configure(engine, bad_channel.data(),
                                 static_cast<std::uint32_t>(bad_channel.size())) == ET_ERR_DESC);
  auto bad_bus = descriptor(gain_instance, 0u, 5u, -2);
  ET_CHECK(et_pipeline_configure(engine, bad_bus.data(),
                                 static_cast<std::uint32_t>(bad_bus.size())) == ET_ERR_DESC);
  ET_CHECK(et_pipeline_configure(engine, valid.data(), 19u) == ET_ERR_DESC);

  std::array<std::uint8_t, 8> empty{};
  writeU32(empty.data(), 1u);
  ET_CHECK(et_pipeline_configure(engine, empty.data(), static_cast<std::uint32_t>(empty.size())) ==
           ET_OK);
  ET_CHECK(et_pipeline_process(engine, 4u, 4u, 0.0, 0u) == ET_OK);
  et_engine_destroy(engine);
}

void testPipelineLatencyCompensation() {
  constexpr std::uint32_t kFrames = 128u;
  constexpr std::uint32_t kLatency = 192u;
  const et_engine engine = et_engine_create();
  ET_CHECK(et_engine_prepare(engine, 48000.0F, 2u, kFrames, 256u) == ET_OK);
  ET_CHECK(et_pipeline_latency(engine) == 0u);

  const et_instance delay = et_instance_create(engine, "TestDelayPlugin");
  const et_instance send = et_instance_create(engine, "TestGainPlugin");
  const et_instance merge = et_instance_create(engine, "TestGainPlugin");
  const float unity = 1.0F;
  ET_CHECK(delay != 0u && send != 0u && merge != 0u);
  ET_CHECK(et_instance_set_params(engine, send, &unity, 1u, kTestHash, 0u) == ET_OK);
  ET_CHECK(et_instance_set_params(engine, merge, &unity, 1u, kTestHash, 0u) == ET_OK);

  const auto routed = pipelineDescriptor({
      {delay, 0u, 1u, -2},
      {send, 0u, 1u, -2},
      {merge, 1u, 0u, -2},
  });
  ET_CHECK(et_pipeline_configure(engine, routed.data(),
                                 static_cast<std::uint32_t>(routed.size())) == ET_OK);
  ET_CHECK(et_pipeline_latency(engine) == kLatency);

  float *main_bus = et_arena_combined_ptr(engine);
  std::array<float, kFrames * 2u> first{};
  first[0] = 1.0F;
  first[kFrames] = 1.0F;
  std::memcpy(main_bus, first.data(), first.size() * sizeof(float));
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 0.0, 0u) == ET_OK);
  for (float sample : std::span(main_bus, first.size())) {
    ET_CHECK(sample == 0.0F);
  }
  std::memset(main_bus, 0, first.size() * sizeof(float));
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 0.1, 0u) == ET_OK);
  ET_CHECK(main_bus[kLatency - kFrames] == 3.0F);
  ET_CHECK(main_bus[kFrames + kLatency - kFrames] == 3.0F);

  ET_CHECK(et_engine_reset(engine) == ET_OK);
  const auto selected = pipelineDescriptor({{delay, 0u, 0u, 0}});
  ET_CHECK(et_pipeline_configure(engine, selected.data(),
                                 static_cast<std::uint32_t>(selected.size())) == ET_OK);
  ET_CHECK(et_pipeline_latency(engine) == kLatency);
  std::memcpy(main_bus, first.data(), first.size() * sizeof(float));
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 0.2, 0u) == ET_OK);
  std::memset(main_bus, 0, first.size() * sizeof(float));
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 0.3, 0u) == ET_OK);
  const std::uint32_t delayed_frame = kLatency - kFrames;
  ET_CHECK(main_bus[delayed_frame] == 1.0F);
  ET_CHECK(main_bus[kFrames + delayed_frame] == 1.0F);

  ET_CHECK(et_engine_reset(engine) == ET_OK);
  std::memcpy(main_bus, first.data(), first.size() * sizeof(float));
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 0.4, 0u) == ET_OK);
  ET_CHECK(et_engine_reset(engine) == ET_OK);
  std::memset(main_bus, 0, first.size() * sizeof(float));
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 0.5, 0u) == ET_OK);
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 0.6, 0u) == ET_OK);
  for (float sample : std::span(main_bus, first.size())) {
    ET_CHECK(sample == 0.0F);
  }

  ET_CHECK(et_engine_reset(engine) == ET_OK);
  std::array<float, kFrames * 2u> compensation_history{};
  compensation_history[kFrames] = 1.0F;
  std::memcpy(main_bus, compensation_history.data(), compensation_history.size() * sizeof(float));
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 0.7, 0u) == ET_OK);

  std::memcpy(main_bus, first.data(), first.size() * sizeof(float));
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 0.8, 1u) == ET_OK);
  ET_CHECK(main_bus[0] == 1.0F && main_bus[kFrames] == 1.0F);
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 0.9, 1u) == ET_OK);
  ET_CHECK(main_bus[0] == 1.0F && main_bus[kFrames] == 1.0F);

  std::memset(main_bus, 0, first.size() * sizeof(float));
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 1.0, 0u) == ET_OK);
  for (float sample : std::span(main_bus, first.size())) {
    ET_CHECK(sample == 0.0F);
  }
  std::memset(main_bus, 0, first.size() * sizeof(float));
  ET_CHECK(et_pipeline_process(engine, 2u, kFrames, 1.1, 0u) == ET_OK);
  for (float sample : std::span(main_bus, first.size())) {
    ET_CHECK(sample == 0.0F);
  }

  std::array<std::uint8_t, 8> empty{};
  writeU32(empty.data(), 1u);
  ET_CHECK(et_pipeline_configure(engine, empty.data(), static_cast<std::uint32_t>(empty.size())) ==
           ET_OK);
  ET_CHECK(et_pipeline_latency(engine) == 0u);
  et_engine_destroy(engine);
}

void testDynamicPipelineLatency() {
  constexpr std::uint32_t kFrames = 64u;
  constexpr std::uint32_t kLimiterHash = 0xb531a24au;
  auto engine_storage = std::make_unique<Engine>();
  Engine &engine = *engine_storage;
  ET_CHECK(engine.prepare(48000.0F, 2u, kFrames, 0u) == ET_OK);
  const et_instance left = engine.createInstance("BrickwallLimiterPlugin");
  const et_instance right = engine.createInstance("BrickwallLimiterPlugin");
  ET_CHECK(left != 0u && right != 0u);
  const auto setLatency = [&](et_instance instance, float milliseconds) {
    const std::array<float, 6> params{0.0F, 100.0F, milliseconds, 1.0F, 0.0F, 0.0F};
    ET_CHECK(engine.setInstanceParams(instance, params.data(), 6u, kLimiterHash, 0u) == ET_OK);
  };
  const auto process = [&](bool impulse) {
    std::fill_n(engine.combined(), kFrames * 2u, 0.0F);
    if (impulse) {
      engine.combined()[0] = 0.25F;
      engine.combined()[kFrames] = 0.25F;
    }
    ET_CHECK(engine.processPipeline(2u, kFrames, 0.0, 0u) == ET_OK);
  };
  const auto checkImpulse = [&](std::uint32_t latency) {
    for (std::uint32_t block = 0u; block < 16u; ++block) {
      process(block == 0u);
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
          const float expected = block * kFrames + frame == latency ? 0.25F : 0.0F;
          ET_CHECK(std::abs(engine.combined()[channel * kFrames + frame] - expected) < 1.0e-6F);
        }
      }
    }
    ET_CHECK(engine.pipelineLatency() == latency);
  };
  const auto updateLatency = [&](float milliseconds, std::uint32_t expected) {
    const std::uint32_t previous = engine.pipelineLatency();
    setLatency(left, milliseconds);
    Engine::PipelineLatencySnapshot snapshot;
    {
      allocation_guard::Scope scope;
      ET_CHECK(engine.capturePipelineLatencySnapshot(snapshot) == ET_OK);
    }
    Engine::PipelineLatencyUpdate update;
    ET_CHECK(Engine::preparePipelineLatencyUpdate(snapshot, update) == ET_OK);
    ET_CHECK(update.plannedLatency() == expected);
    ET_CHECK(engine.pipelineLatency() == previous);
    {
      allocation_guard::Scope scope;
      ET_CHECK(engine.applyPipelineLatencyUpdate(update) == ET_OK);
      ET_CHECK(engine.applyPipelineLatencyUpdate(update) == ET_ERR_STATE);
    }
    ET_CHECK(engine.pipelineLatency() == expected);
    // Allow the limiter's own control ramp to finish, without resets or reconfiguration.
    for (std::uint32_t block = 0u; block < 16u; ++block) {
      process(false);
    }
    checkImpulse(expected);
  };

  setLatency(left, 3.0F);
  auto routing = pipelineDescriptor({{left, 0u, 0u, -2}});
  ET_CHECK(engine.configurePipeline(routing.data(), static_cast<std::uint32_t>(routing.size())) ==
           ET_OK);
  checkImpulse(144u);
  updateLatency(10.0F, 480u);
  updateLatency(1.0F, 48u);

  setLatency(left, 1.0F);
  setLatency(right, 3.0F);
  routing = pipelineDescriptor({{left, 0u, 0u, 0}, {right, 0u, 0u, 1}});
  ET_CHECK(engine.configurePipeline(routing.data(), static_cast<std::uint32_t>(routing.size())) ==
           ET_OK);
  updateLatency(10.0F, 480u);
  updateLatency(2.0F, 144u);

  Engine::PipelineLatencySnapshot snapshot;
  Engine::PipelineLatencyUpdate stale;
  ET_CHECK(engine.capturePipelineLatencySnapshot(snapshot) == ET_OK);
  ET_CHECK(Engine::preparePipelineLatencyUpdate(snapshot, stale) == ET_OK);
  setLatency(left, 10.0F);
  ET_CHECK(engine.applyPipelineLatencyUpdate(stale) == ET_ERR_STATE);
  ET_CHECK(engine.pipelineLatency() == 144u);
  updateLatency(10.0F, 480u);
  ET_CHECK(engine.applyPipelineLatencyUpdate(stale) == ET_ERR_STATE);

  ET_CHECK(engine.capturePipelineLatencySnapshot(snapshot) == ET_OK);
  ET_CHECK(Engine::preparePipelineLatencyUpdate(snapshot, stale) == ET_OK);
  ET_CHECK(engine.configurePipeline(routing.data(), static_cast<std::uint32_t>(routing.size())) ==
           ET_OK);
  ET_CHECK(engine.applyPipelineLatencyUpdate(stale) == ET_ERR_STATE);
  ET_CHECK(engine.capturePipelineLatencySnapshot(snapshot) == ET_OK);
  ET_CHECK(Engine::preparePipelineLatencyUpdate(snapshot, stale) == ET_OK);
  Engine::PipelineLatencySnapshot invalid;
  ET_CHECK(Engine::preparePipelineLatencyUpdate(invalid, stale) == ET_ERR_STATE);
  ET_CHECK(engine.applyPipelineLatencyUpdate(stale) == ET_ERR_STATE);
  ET_CHECK(engine.pipelineLatency() == 480u);

  if ((et_build_flags() & ET_BUILD_DEBUG) != 0u) {
    ET_CHECK(engine.capturePipelineLatencySnapshot(snapshot) == ET_OK);
    for (std::int32_t failure = 0; failure < 2; ++failure) {
      allocation_guard::failNothrowAllocationAfterForTesting(failure);
      ET_CHECK(Engine::preparePipelineLatencyUpdate(snapshot, stale) == ET_ERR_OOM);
      allocation_guard::failNothrowAllocationAfterForTesting(-1);
      ET_CHECK(engine.applyPipelineLatencyUpdate(stale) == ET_ERR_STATE);
      ET_CHECK(engine.pipelineLatency() == 480u);
    }
    checkImpulse(480u);
  }

  // Preparation must be allowed to allocate while the audio thread's guard is active.
  ET_CHECK(engine.capturePipelineLatencySnapshot(snapshot) == ET_OK);
  std::latch start_preparing(1);
  std::latch prepared(1);
  et_status prepare_status = ET_ERR_STATE;
  std::thread control([&]() {
    start_preparing.wait();
    prepare_status = Engine::preparePipelineLatencyUpdate(snapshot, stale);
    prepared.count_down();
  });
  {
    allocation_guard::Scope scope;
    start_preparing.count_down();
    for (std::uint32_t block = 0u; block < 32u; ++block) {
      process(false);
    }
    prepared.wait();
  }
  control.join();
  ET_CHECK(prepare_status == ET_OK);
  ET_CHECK(engine.applyPipelineLatencyUpdate(stale) == ET_OK);
}

void testDynamicLatencyHistory() {
  constexpr std::uint32_t kFrames = 32u;
  auto engine_storage = std::make_unique<Engine>();
  Engine &engine = *engine_storage;
  ET_CHECK(engine.prepare(48000.0F, 2u, kFrames, 0u) == ET_OK);
  const et_instance limiter = engine.createInstance("BrickwallLimiterPlugin");
  const et_instance gain = engine.createInstance("TestGainPlugin");
  const float unity = 1.0F;
  ET_CHECK(engine.setInstanceParams(gain, &unity, 1u, kTestHash, 0u) == ET_OK);
  const auto setLatency = [&](float milliseconds) {
    const std::array<float, 6> params{0.0F, 100.0F, milliseconds, 1.0F, 0.0F, 0.0F};
    ET_CHECK(engine.setInstanceParams(limiter, params.data(), 6u, 0xb531a24au, 0u) == ET_OK);
  };
  // Exercise both final channel alignment and a destination merge delay.
  for (bool merge : {false, true}) {
    for (float next_ms : {2.0F, 3.0F, 5.0F}) {
      setLatency(3.0F);
      const auto routing = merge ? pipelineDescriptor({{limiter, 1u, 0u, -2}})
                                 : pipelineDescriptor({{limiter, 0u, 0u, 0}});
      ET_CHECK(engine.configurePipeline(routing.data(),
                                        static_cast<std::uint32_t>(routing.size())) == ET_OK);
      std::fill_n(engine.combined(), kFrames * 2u, 0.0F);
      engine.combined()[kFrames] = 0.25F;
      ET_CHECK(engine.processPipeline(2u, kFrames, 0.0, 0u) == ET_OK);
      setLatency(next_ms);
      Engine::PipelineLatencySnapshot snapshot;
      Engine::PipelineLatencyUpdate update;
      ET_CHECK(engine.capturePipelineLatencySnapshot(snapshot) == ET_OK);
      ET_CHECK(Engine::preparePipelineLatencyUpdate(snapshot, update) == ET_OK);
      // Preparation does not freeze history: another full block is processed before apply.
      std::fill_n(engine.combined(), kFrames * 2u, 0.0F);
      ET_CHECK(engine.processPipeline(2u, kFrames, 0.0, 0u) == ET_OK);
      ET_CHECK(engine.applyPipelineLatencyUpdate(update) == ET_OK);
      const std::uint32_t expected_latency = static_cast<std::uint32_t>(next_ms * 48.0F);
      ET_CHECK(engine.pipelineLatency() == expected_latency);
      for (std::uint32_t block = 2u; block < 10u; ++block) {
        std::fill_n(engine.combined(), kFrames * 2u, 0.0F);
        ET_CHECK(engine.processPipeline(2u, kFrames, 0.0, 0u) == ET_OK);
        for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
          const float expected = block * kFrames + frame == expected_latency ? 0.25F : 0.0F;
          ET_CHECK(engine.combined()[kFrames + frame] == expected);
        }
      }
    }
  }
}

void testPipelineDescriptorFuzz() {
  const et_engine engine = et_engine_create();
  ET_CHECK(et_engine_prepare(engine, 48000.0F, 4u, 128u, 256u) == ET_OK);
  const et_instance gain_instance = et_instance_create(engine, "TestGainPlugin");
  const float gain = 2.0F;
  ET_CHECK(et_instance_set_params(engine, gain_instance, &gain, 1u, kTestHash, 0u) == ET_OK);

  const auto valid = descriptor(gain_instance, 0u, 0u, -2);
  ET_CHECK(et_pipeline_configure(engine, valid.data(), static_cast<std::uint32_t>(valid.size())) ==
           ET_OK);

  std::uint32_t random = 0xeffe7a5eu;
  const auto nextRandom = [&random]() noexcept {
    random ^= random << 13u;
    random ^= random >> 17u;
    random ^= random << 5u;
    return random;
  };

  for (std::uint32_t iteration = 0u; iteration < 4096u; ++iteration) {
    auto malformed = valid;
    std::uint32_t byte_count = static_cast<std::uint32_t>(malformed.size());
    switch (iteration % 10u) {
    case 0u:
      writeU32(malformed.data(), 2u + nextRandom() % 0xfffffffdu);
      break;
    case 1u:
      writeU32(malformed.data() + 4u, 65u + nextRandom() % 1024u);
      break;
    case 2u:
      byte_count = nextRandom() % 20u;
      break;
    case 3u:
      malformed[12] = static_cast<std::uint8_t>(2u + nextRandom() % 254u);
      break;
    case 4u:
      malformed[13] = static_cast<std::uint8_t>(5u + nextRandom() % 251u);
      break;
    case 5u:
      malformed[14] = static_cast<std::uint8_t>(5u + nextRandom() % 251u);
      break;
    case 6u:
      malformed[15] = static_cast<std::uint8_t>(24u + nextRandom() % 104u);
      break;
    case 7u:
      malformed[16] = static_cast<std::uint8_t>(2u + nextRandom() % 254u);
      break;
    case 8u:
      malformed[17u + nextRandom() % 3u] = static_cast<std::uint8_t>(1u + nextRandom() % 255u);
      break;
    default:
      writeU32(malformed.data() + 8u, 0x80000000u | nextRandom());
      break;
    }
    ET_CHECK(et_pipeline_configure(engine, malformed.data(), byte_count) == ET_ERR_DESC);
  }

  float *main_bus = et_arena_combined_ptr(engine);
  for (std::uint32_t index = 0u; index < 16u; ++index)
    main_bus[index] = 1.0F;
  ET_CHECK(et_pipeline_process(engine, 4u, 4u, 0.0, 0u) == ET_OK);
  ET_CHECK(main_bus[0] == 2.0F && main_bus[15] == 2.0F);
  et_engine_destroy(engine);
}

void testTelemetryCadence() {
  const et_engine engine = et_engine_create();
  ET_CHECK(et_engine_prepare(engine, 48000.0F, 2u, 128u, 256u) == ET_OK);
  ET_CHECK(et_engine_set_telemetry_rate(engine, 240.0F) == ET_OK);
  const et_instance instance = et_instance_create(engine, "TestGainPlugin");
  const float gain = 1.0F;
  ET_CHECK(et_instance_set_params(engine, instance, &gain, 1u, kTestHash, 0u) == ET_OK);
  ET_CHECK(et_instance_set_tap(engine, instance, 99u) == ET_OK);
  std::array<float, 256> audio{};
  ET_CHECK(et_instance_process(engine, instance, audio.data(), 2u, 128u, 0.0) == ET_OK);
  ET_CHECK(et_instance_process(engine, instance, audio.data(), 2u, 128u, 0.1) == ET_OK);
  std::uint32_t dropped = 0;
  std::uint8_t *staging = et_telemetry_staging_ptr(engine);
  const std::uint32_t bytes =
      et_telemetry_read(engine, staging, et_telemetry_capacity(engine), &dropped);
  ET_CHECK(bytes == 20u);
  ET_CHECK(dropped == 0u);
  ET_CHECK(staging[0] == 0xffu && staging[1] == 0x7fu);
  ET_CHECK(staging[4] == 99u && staging[5] == 0u);
  et_engine_destroy(engine);
}

void testAssetLifecycle() {
  const std::uint32_t kernel_index = findKernelIndex("TestGainPlugin");
  ET_CHECK(kernel_index != UINT32_MAX);
  ET_CHECK(et_kernel_asset_capacity(kernel_index, 0u) == 4096u);
  ET_CHECK(et_kernel_asset_capacity(kernel_index, 1u) == 0u);
  ET_CHECK(et_kernel_asset_capacity(et_kernel_count(), 0u) == 0u);

  auto engine_storage = std::make_unique<Engine>();
  Engine &engine = *engine_storage;
  ET_CHECK(engine.prepare(48000.0F, 2u, 128u, 0u) == ET_OK);
  const et_instance instance = engine.createInstance("TestGainPlugin");
  ET_CHECK(instance != 0u);
  const float unity_gain = 1.0F;
  ET_CHECK(engine.setInstanceParams(instance, &unity_gain, 1u, kTestHash, 0u) == ET_OK);
  constexpr AssetBeginInfo valid_info{2u, 4u, 2u, 128u, 1u, 0u, 0u, 2u, 64u, 64u};
  AssetBeginInfo invalid_info = valid_info;
  invalid_info.byteSize = 4097u;
  ET_CHECK(engine.beginInstanceAsset(instance, 0u, invalid_info) == nullptr);
  ET_CHECK(engine.instanceAssetState(instance, 0u) == ET_ASSET_STATE_NONE);

  std::uint8_t *staging = engine.beginInstanceAsset(instance, 0u, valid_info);
  ET_CHECK(staging != nullptr);
  ET_CHECK(engine.instanceAssetState(instance, 0u) == ET_ASSET_STATE_STAGED);
  ET_CHECK(engine.commitInstanceAsset(instance, 0u, 64u, 99u) == ET_ERR_ARGS);
  ET_CHECK(engine.instanceAssetState(instance, 0u) == ET_ASSET_STATE_ERROR);
  std::array<float, 8> audio{};
  audio.fill(1.0F);
  ET_CHECK(engine.processInstance(instance, audio.data(), 2u, 4u, 0.0) == ET_OK);
  ET_CHECK(audio[0] == 1.0F && audio[7] == 1.0F);

  staging = engine.beginInstanceAsset(instance, 0u, valid_info);
  ET_CHECK(staging != nullptr);
  std::memset(staging, 0, valid_info.byteSize);
  writeU32(staging, 0x31415445u);
  writeU32(staging + 4u, valid_info.channels);
  writeU32(staging + 8u, valid_info.frames);
  writeU32(staging + 12u, 48000u);
  writeU32(staging + 16u, valid_info.topology);
  ET_CHECK(engine.commitInstanceAsset(instance, 0u, valid_info.byteSize, ET_ASSET_F32_MULTICH) ==
           ET_OK);
  ET_CHECK(engine.instanceAssetState(instance, 0u) == ET_ASSET_STATE_PREPARING);

  audio.fill(1.0F);
  ET_CHECK(engine.processInstance(instance, audio.data(), 2u, 4u, 0.0) == ET_OK);
  ET_CHECK(engine.instanceAssetState(instance, 0u) == ET_ASSET_STATE_ACTIVE);
  ET_CHECK(audio[0] == 2.0F && audio[7] == 2.0F);

  invalid_info = valid_info;
  invalid_info.topology = 5u;
  ET_CHECK(engine.beginInstanceAsset(instance, 0u, invalid_info) == nullptr);
  ET_CHECK(engine.instanceAssetState(instance, 0u) == ET_ASSET_STATE_ACTIVE);
  ET_CHECK(engine.resetInstance(instance) == ET_OK);
  ET_CHECK(engine.instanceAssetState(instance, 0u) == ET_ASSET_STATE_ACTIVE);
  engine.abortInstanceAsset(instance, 0u);
  ET_CHECK(engine.instanceAssetState(instance, 0u) == ET_ASSET_STATE_NONE);
  audio.fill(1.0F);
  ET_CHECK(engine.processInstance(instance, audio.data(), 2u, 4u, 0.1) == ET_OK);
  ET_CHECK(audio[0] == 1.0F && audio[7] == 1.0F);
}

} // namespace

void runAbiTests() {
  testAllocationGuardScope();
  testAudioThreadEnablesDenormalFlush();
  testNothrowStorageContract();
  testDiscoveryAndLifecycle();
  testPipelineValidationAndRouting();
  testPipelineLatencyCompensation();
  testDynamicPipelineLatency();
  testDynamicLatencyHistory();
  testPipelineDescriptorFuzz();
  testTelemetryCadence();
  testAssetLifecycle();
}

} // namespace effetune::test
