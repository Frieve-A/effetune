#include "test_support.h"

#include "allocation_guard.h"
#include "effetune/abi.h"
#include "engine.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>

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
  ET_CHECK(et_engine_memory_required(48000.0F, 9u, 128u, 4096u) == 0u);
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

  auto bad_channel = descriptor(gain_instance, 0u, 0u, 20);
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
      malformed[15] = static_cast<std::uint8_t>(20u + nextRandom() % 108u);
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

  Engine engine;
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
  testDiscoveryAndLifecycle();
  testPipelineValidationAndRouting();
  testPipelineDescriptorFuzz();
  testTelemetryCadence();
  testAssetLifecycle();
}

} // namespace effetune::test
