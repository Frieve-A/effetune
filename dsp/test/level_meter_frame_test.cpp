#include "effetune/abi.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace {

int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "level_meter_frame_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define LEVEL_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

std::uint16_t readU16(const std::uint8_t *input) noexcept {
  return static_cast<std::uint16_t>(input[0]) |
         static_cast<std::uint16_t>(static_cast<std::uint16_t>(input[1]) << 8u);
}

std::uint32_t readU32(const std::uint8_t *input) noexcept {
  return static_cast<std::uint32_t>(input[0]) | (static_cast<std::uint32_t>(input[1]) << 8u) |
         (static_cast<std::uint32_t>(input[2]) << 16u) |
         (static_cast<std::uint32_t>(input[3]) << 24u);
}

float readF32(const std::uint8_t *input) noexcept {
  const std::uint32_t bits = readU32(input);
  float value = 0.0F;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

bool near(float actual, float expected, float tolerance = 1.0e-6F) noexcept {
  const float difference = actual - expected;
  const float absolute = difference < 0.0F ? -difference : difference;
  return absolute <= tolerance;
}

std::uint32_t readTelemetry(et_engine engine, std::uint32_t &dropped) noexcept {
  return et_telemetry_read(engine, et_telemetry_staging_ptr(engine), et_telemetry_capacity(engine),
                           &dropped);
}

void checkHeader(const std::uint8_t *frame, std::uint32_t tap_id, std::uint32_t sequence,
                 std::uint16_t payload_bytes) noexcept {
  LEVEL_CHECK(readU16(frame) == 1u);
  LEVEL_CHECK(readU16(frame + 2u) == 1u);
  LEVEL_CHECK(readU32(frame + 4u) == tap_id);
  LEVEL_CHECK(readU32(frame + 8u) == sequence);
  LEVEL_CHECK(readU16(frame + 12u) == payload_bytes);
}

void fillConstant(float *audio, std::uint32_t channels, std::uint32_t frames,
                  const std::array<float, 8> &values) noexcept {
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      audio[channel * frames + frame] = values[channel];
    }
  }
}

void testDefaultCadenceWindowAndChannelReset() {
  constexpr std::uint32_t kTapId = 0x1234u;
  const et_engine engine = et_engine_create();
  LEVEL_CHECK(engine != 0u);
  LEVEL_CHECK(et_engine_prepare(engine, 48000.0F, 4u, 128u, 2048u) == ET_OK);
  const et_instance instance = et_instance_create(engine, "LevelMeterPlugin");
  LEVEL_CHECK(instance != 0u);
  LEVEL_CHECK(et_instance_set_tap(engine, instance, kTapId) == ET_OK);

  std::array<float, 4u * 128u> audio{};
  for (std::uint32_t block = 0u; block < 7u; ++block) {
    fillConstant(audio.data(), 2u, 128u, {0.5F, -0.25F, 0.0F, 0.0F});
    if (block == 0u) {
      audio[0] = 1.25F;
    }
    LEVEL_CHECK(et_instance_process(engine, instance, audio.data(), 2u, 128u,
                                    static_cast<double>(block) * 128.0 / 48000.0) == ET_OK);
    LEVEL_CHECK(audio[0] == (block == 0u ? 1.25F : 0.5F));
    LEVEL_CHECK(audio[128] == -0.25F);
  }

  std::uint32_t dropped = 0u;
  std::uint8_t *frame = et_telemetry_staging_ptr(engine);
  std::uint32_t bytes = readTelemetry(engine, dropped);
  LEVEL_CHECK(bytes == 40u);
  LEVEL_CHECK(dropped == 0u);
  checkHeader(frame, kTapId, 0u, 24u);
  LEVEL_CHECK(readU32(frame + 16u) == 2u);
  LEVEL_CHECK(near(readF32(frame + 20u), 1.25F));
  const float expected_rms =
      static_cast<float>(std::sqrt((1.25 * 1.25 + 895.0 * 0.5 * 0.5) / 896.0));
  LEVEL_CHECK(near(readF32(frame + 24u), expected_rms));
  LEVEL_CHECK(near(readF32(frame + 28u), 0.25F));
  LEVEL_CHECK(near(readF32(frame + 32u), 0.25F));
  LEVEL_CHECK(readU32(frame + 36u) == 1u);

  for (std::uint32_t block = 0u; block < 6u; ++block) {
    fillConstant(audio.data(), 2u, 128u, {0.5F, -0.25F, 0.0F, 0.0F});
    LEVEL_CHECK(et_instance_process(engine, instance, audio.data(), 2u, 128u,
                                    0.1 + static_cast<double>(block) * 128.0 / 48000.0) == ET_OK);
  }
  bytes = readTelemetry(engine, dropped);
  LEVEL_CHECK(bytes == 40u);
  checkHeader(frame, kTapId, 1u, 24u);
  LEVEL_CHECK(near(readF32(frame + 20u), 0.5F));
  LEVEL_CHECK(near(readF32(frame + 24u), 0.5F));
  LEVEL_CHECK(readU32(frame + 36u) == 0u);

  for (std::uint32_t block = 0u; block < 8u; ++block) {
    fillConstant(audio.data(), 4u, 97u, {0.1F, -0.2F, 0.3F, 1.125F});
    LEVEL_CHECK(et_instance_process(engine, instance, audio.data(), 4u, 97u,
                                    0.2 + static_cast<double>(block) * 97.0 / 48000.0) == ET_OK);
    LEVEL_CHECK(audio[0] == 0.1F && audio[97] == -0.2F && audio[3u * 97u] == 1.125F);
  }
  bytes = readTelemetry(engine, dropped);
  LEVEL_CHECK(bytes == 56u);
  checkHeader(frame, kTapId, 2u, 40u);
  LEVEL_CHECK(readU32(frame + 16u) == 4u);
  LEVEL_CHECK(near(readF32(frame + 20u), 0.1F));
  LEVEL_CHECK(near(readF32(frame + 28u), 0.2F));
  LEVEL_CHECK(near(readF32(frame + 36u), 0.3F));
  LEVEL_CHECK(near(readF32(frame + 44u), 1.125F));
  LEVEL_CHECK(readU32(frame + 52u) == 8u);

  LEVEL_CHECK(et_instance_reset(engine, instance) == ET_OK);
  for (std::uint32_t block = 0u; block < 7u; ++block) {
    fillConstant(audio.data(), 2u, 128u, {0.0F, 0.0F, 0.0F, 0.0F});
    LEVEL_CHECK(et_instance_process(engine, instance, audio.data(), 2u, 128u,
                                    0.3 + static_cast<double>(block) * 128.0 / 48000.0) == ET_OK);
  }
  bytes = readTelemetry(engine, dropped);
  LEVEL_CHECK(bytes == 40u);
  checkHeader(frame, kTapId, 0u, 24u);
  LEVEL_CHECK(readF32(frame + 20u) == 0.0F);
  LEVEL_CHECK(readF32(frame + 24u) == 0.0F);
  LEVEL_CHECK(readU32(frame + 36u) == 0u);
  et_engine_destroy(engine);
}

void testSampleRateAndVariableBlockCadence() {
  const et_engine engine = et_engine_create();
  LEVEL_CHECK(et_engine_prepare(engine, 44100.0F, 8u, 128u, 1024u) == ET_OK);
  const et_instance instance = et_instance_create(engine, "LevelMeterPlugin");
  LEVEL_CHECK(instance != 0u);
  LEVEL_CHECK(et_instance_set_tap(engine, instance, 77u) == ET_OK);

  std::array<float, 8u * 97u> audio{};
  std::uint32_t dropped = 0u;
  for (std::uint32_t block = 0u; block < 7u; ++block) {
    fillConstant(audio.data(), 8u, 97u, {0.75F, -0.5F, 0.25F, -0.125F, 0.1F, -0.2F, 0.3F, 1.5F});
    LEVEL_CHECK(et_instance_process(engine, instance, audio.data(), 8u, 97u,
                                    static_cast<double>(block) * 97.0 / 44100.0) == ET_OK);
  }
  LEVEL_CHECK(readTelemetry(engine, dropped) == 0u);

  fillConstant(audio.data(), 8u, 97u, {0.75F, -0.5F, 0.25F, -0.125F, 0.1F, -0.2F, 0.3F, 1.5F});
  LEVEL_CHECK(et_instance_process(engine, instance, audio.data(), 8u, 97u, 7.0 * 97.0 / 44100.0) ==
              ET_OK);
  std::uint8_t *frame = et_telemetry_staging_ptr(engine);
  LEVEL_CHECK(readTelemetry(engine, dropped) == 88u);
  checkHeader(frame, 77u, 0u, 72u);
  LEVEL_CHECK(readU32(frame + 16u) == 8u);
  LEVEL_CHECK(near(readF32(frame + 20u), 0.75F));
  LEVEL_CHECK(near(readF32(frame + 24u), 0.75F));
  LEVEL_CHECK(near(readF32(frame + 28u), 0.5F));
  LEVEL_CHECK(near(readF32(frame + 32u), 0.5F));
  LEVEL_CHECK(near(readF32(frame + 76u), 1.5F));
  LEVEL_CHECK(near(readF32(frame + 80u), 1.5F));
  LEVEL_CHECK(readU32(frame + 84u) == 128u);
  et_engine_destroy(engine);
}

} // namespace

int main() {
  testDefaultCadenceWindowAndChannelReset();
  testSampleRateAndVariableBlockCadence();
  if (failures != 0) {
    std::fprintf(stderr, "%d LevelMeter frame-content check(s) failed\n", failures);
    return 1;
  }
  std::puts("All LevelMeter frame-content tests passed");
  return 0;
}
