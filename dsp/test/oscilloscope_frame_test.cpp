#include "effetune/kernel.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_OscilloscopePlugin() noexcept;

namespace {

constexpr std::uint32_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kTelemetryBytes = 131072u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "oscilloscope_frame_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define SCOPE_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

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

struct KernelHarness {
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> object_storage{};
  std::array<std::uint8_t, kTelemetryBytes> ring_storage{};
  std::array<std::uint8_t, kTelemetryBytes> output{};
  const effetune::KernelDescriptor *descriptor = nullptr;
  effetune::PluginKernel *kernel = nullptr;
  effetune::TelemetryRing ring;
  std::uint32_t tap_id = 0u;
  std::uint32_t sequence = 0u;

  KernelHarness(float sample_rate, std::uint32_t max_frames) {
    descriptor = et_kernel_descriptor_OscilloscopePlugin();
    SCOPE_CHECK(descriptor != nullptr);
    SCOPE_CHECK(descriptor->objectSize <= object_storage.size());
    kernel = descriptor->construct(object_storage.data());
    SCOPE_CHECK(kernel != nullptr);
    ring.adopt(ring_storage.data(), static_cast<std::uint32_t>(ring_storage.size()));
    kernel->prepare({sample_rate, 8u, max_frames});
    kernel->reset();
  }

  ~KernelHarness() {
    if (kernel != nullptr) {
      descriptor->destroy(kernel);
    }
  }

  void setParams(float display_time, float trigger_mode, float trigger_level, float trigger_edge,
                 float holdoff, float display_level = 0.0F, float vertical_offset = 0.0F) noexcept {
    const std::array<float, 7> params = {display_time, trigger_mode,  trigger_level,  trigger_edge,
                                         holdoff,      display_level, vertical_offset};
    SCOPE_CHECK(kernel->stageParameters(params.data(), static_cast<std::uint32_t>(params.size()),
                                        descriptor->paramsHash) == ET_OK);
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               double time_seconds) noexcept {
    kernel->applyPendingParameters();
    kernel->process(audio, channels, frames, {time_seconds});
  }

  void telemetryTick() noexcept {
    effetune::TelemetryWriter writer(ring, tap_id, sequence);
    kernel->writeTelemetry(writer);
  }

  std::uint32_t read() noexcept {
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
    SCOPE_CHECK(dropped == 0u);
    return bytes;
  }

  void reset() noexcept {
    kernel->reset();
    sequence = 0u;
    ring.reset();
  }
};

void checkFrameHeader(const std::uint8_t *frame, std::uint32_t tap_id, std::uint32_t sequence,
                      std::uint16_t payload_bytes) noexcept {
  SCOPE_CHECK(readU16(frame) == 3u);
  SCOPE_CHECK(readU16(frame + 2u) == 2u);
  SCOPE_CHECK(readU32(frame + 4u) == tap_id);
  SCOPE_CHECK(readU32(frame + 8u) == sequence);
  SCOPE_CHECK(readU16(frame + 12u) == payload_bytes);
  SCOPE_CHECK(readU16(frame + 14u) == 0u);
}

void testRawCadenceTapSequenceResetAndPassthrough() {
  KernelHarness harness(8000.0F, 8u);
  harness.tap_id = 0x1234u;
  harness.setParams(0.001F, 1.0F, 1.0F, 0.0F, 0.0001F);
  std::array<float, 16> audio{};
  const std::array<float, 8> left = {-1.0F, -0.5F, 0.0F, 0.5F, 1.0F, 0.75F, 0.25F, -0.25F};
  const std::array<float, 8> right = {1.0F, 0.5F, 0.0F, -0.5F, -1.0F, 0.25F, 0.75F, -0.75F};
  for (std::uint32_t frame = 0u; frame < 8u; ++frame) {
    audio[frame] = left[frame];
    audio[8u + frame] = right[frame];
  }
  const auto original = audio;
  harness.process(audio.data(), 2u, 8u, 0.0);
  SCOPE_CHECK(audio == original);

  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 0u);
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 64u);
  checkFrameHeader(harness.output.data(), 0x1234u, 0u, 48u);
  const std::uint8_t *payload = harness.output.data() + 16u;
  SCOPE_CHECK(readF32(payload) == 8000.0F);
  SCOPE_CHECK(readU32(payload + 4u) == 8u);
  SCOPE_CHECK(readU32(payload + 8u) == 0u);
  SCOPE_CHECK(readU16(payload + 12u) == 0u);
  SCOPE_CHECK(payload[14u] == 0u);
  SCOPE_CHECK(payload[15u] == 0u);
  for (std::uint32_t frame = 0u; frame < 8u; ++frame) {
    SCOPE_CHECK(readF32(payload + 16u + frame * 4u) == (left[frame] + right[frame]) * 0.5F);
  }

  harness.telemetryTick();
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 64u);
  checkFrameHeader(harness.output.data(), 0x1234u, 1u, 48u);

  harness.tap_id = 99u;
  harness.sequence = 0u;
  harness.telemetryTick();
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 64u);
  checkFrameHeader(harness.output.data(), 99u, 0u, 48u);

  harness.reset();
  harness.tap_id = 99u;
  harness.process(audio.data(), 2u, 8u, 0.0);
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 0u);
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 64u);
  checkFrameHeader(harness.output.data(), 99u, 0u, 48u);
}

void testRisingTriggerCaptureContent() {
  KernelHarness harness(1000.0F, 4u);
  harness.tap_id = 7u;
  harness.setParams(0.004F, 1.0F, 0.0F, 0.0F, 0.0001F);
  std::array<float, 8> first = {-1.0F, -0.5F, 0.25F, 0.5F, -1.0F, -0.5F, 0.75F, 0.5F};
  harness.process(first.data(), 2u, 4u, 0.01);
  std::array<float, 8> second = {0.75F, 1.0F, 0.5F, 0.25F, 0.25F, 0.0F, -0.5F, -0.25F};
  harness.process(second.data(), 2u, 4u, 0.014);
  harness.telemetryTick();
  harness.telemetryTick();

  SCOPE_CHECK(harness.read() == 48u);
  checkFrameHeader(harness.output.data(), 7u, 0u, 32u);
  const std::uint8_t *payload = harness.output.data() + 16u;
  SCOPE_CHECK(readU32(payload + 4u) == 4u);
  SCOPE_CHECK(readU32(payload + 8u) == 0u);
  SCOPE_CHECK(readU16(payload + 12u) == 0u);
  SCOPE_CHECK(payload[14u] == 0u);
  SCOPE_CHECK(payload[15u] == 1u);
  SCOPE_CHECK(readF32(payload + 16u) == 0.5F);
  SCOPE_CHECK(readF32(payload + 20u) == 0.5F);
  SCOPE_CHECK(readF32(payload + 24u) == 0.5F);
  SCOPE_CHECK(readF32(payload + 28u) == 0.5F);
}

void testPreviousSnapshotRemainsPublishedDuringCapture() {
  KernelHarness harness(1000.0F, 4u);
  harness.setParams(0.004F, 1.0F, 1.0F, 0.0F, 0.0001F);
  std::array<float, 4> first = {0.1F, 0.2F, 0.3F, 0.4F};
  harness.process(first.data(), 1u, 4u, 0.0);
  harness.telemetryTick();
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 48u);

  harness.setParams(0.004F, 1.0F, 0.0F, 0.0F, 0.0001F);
  std::array<float, 4> second = {-1.0F, -0.5F, -0.25F, 0.5F};
  harness.process(second.data(), 1u, 4u, 0.01);
  harness.telemetryTick();
  harness.telemetryTick();

  SCOPE_CHECK(harness.read() == 48u);
  const std::uint8_t *payload = harness.output.data() + 16u;
  SCOPE_CHECK(readU32(payload + 4u) == 4u);
  for (std::uint32_t frame = 0u; frame < 4u; ++frame) {
    SCOPE_CHECK(readF32(payload + 16u + frame * 4u) == first[frame]);
  }

  std::array<float, 4> third = {0.6F, 0.7F, 0.8F, 0.9F};
  harness.process(third.data(), 1u, 4u, 0.02);
  harness.telemetryTick();
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 48u);
  SCOPE_CHECK(payload[15u] == 1u);
  SCOPE_CHECK(readF32(payload + 16u) == second[3]);
  for (std::uint32_t frame = 1u; frame < 4u; ++frame) {
    SCOPE_CHECK(readF32(payload + 16u + frame * 4u) == third[frame - 1u]);
  }
}

void testCaptureSettingChangesInvalidatePreviousSnapshot() {
  // Change the display duration, trigger mode, and trigger edge independently.
  constexpr std::array<std::array<float, 3>, 3> settings = {
      {{0.008F, 1.0F, 0.0F}, {0.004F, 0.0F, 0.0F}, {0.004F, 1.0F, 1.0F}}};
  for (const auto &setting : settings) {
    KernelHarness harness(1000.0F, 4u);
    harness.setParams(0.004F, 1.0F, 1.0F, 0.0F, 0.0001F);
    std::array<float, 4> first = {0.1F, 0.2F, 0.3F, 0.4F};
    harness.process(first.data(), 1u, 4u, 0.0);
    harness.telemetryTick();
    harness.telemetryTick();
    SCOPE_CHECK(harness.read() == 48u);

    harness.setParams(setting[0], setting[1], 0.0F, setting[2], 0.0001F);
    std::array<float, 4> crossing = {-1.0F, -0.5F, -0.25F, 0.5F};
    std::array<float, 4> following = {0.6F, 0.7F, 0.8F, 0.9F};
    if (setting[2] == 1.0F) {
      for (auto &value : crossing)
        value = -value;
      for (auto &value : following)
        value = -value;
    }
    harness.process(crossing.data(), 1u, 4u, 0.04);
    harness.telemetryTick();
    harness.telemetryTick();
    SCOPE_CHECK(harness.read() == 0u);

    harness.process(following.data(), 1u, 4u, 0.08);
    harness.telemetryTick();
    harness.telemetryTick();
    const bool longer_capture = setting[0] == 0.008F;
    if (longer_capture) {
      SCOPE_CHECK(harness.read() == 0u);
      harness.process(following.data(), 1u, 4u, 0.12);
      harness.telemetryTick();
      harness.telemetryTick();
    }
    SCOPE_CHECK(harness.read() == (longer_capture ? 64u : 48u));
    const auto *payload = harness.output.data() + 16u;
    SCOPE_CHECK(readU32(payload + 4u) == (longer_capture ? 8u : 4u));
    SCOPE_CHECK(payload[15u] == 1u);
    SCOPE_CHECK(readF32(payload + 16u) == crossing[3]);
  }
}

void testPastTriggerCaptureIsBoundedAcrossRingWrap() {
  constexpr std::uint32_t kFrames = 8u;
  constexpr std::uint32_t kCaptureSamples = 100u;
  KernelHarness harness(1000.0F, 128u);
  harness.setParams(0.1F, 1.0F, 0.5F, 0.0F, 0.0001F);

  std::array<float, 128> prefill{};
  prefill.fill(-1.0F);
  for (std::uint32_t processed = 0u; processed < 65520u; processed += 128u) {
    harness.process(prefill.data(), 1u, 128u, static_cast<double>(processed) / 1000.0);
  }

  std::array<float, kFrames> block{};
  block.fill(-1.0F);
  block[1] = 1.0F;
  harness.process(block.data(), 1u, kFrames, 65.520);
  harness.process(block.data(), 1u, kFrames, 65.528);
  block.fill(-1.0F);
  for (std::uint32_t absolute = 65536u; absolute < 65624u; absolute += kFrames) {
    harness.process(block.data(), 1u, kFrames, static_cast<double>(absolute) / 1000.0);
  }

  harness.telemetryTick();
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 432u);
  const std::uint8_t *payload = harness.output.data() + 16u;
  SCOPE_CHECK(readU32(payload + 4u) == kCaptureSamples);
  SCOPE_CHECK(payload[15u] == 1u);
  SCOPE_CHECK(readF32(payload + 16u) == 1.0F);
  SCOPE_CHECK(readF32(payload + 16u + 8u * 4u) == 1.0F);

  harness.process(block.data(), 1u, kFrames, 65.624);
  harness.telemetryTick();
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 432u);
  payload = harness.output.data() + 16u;
  SCOPE_CHECK(readF32(payload + 16u + 8u * 4u) == 1.0F);

  for (std::uint32_t absolute = 65632u; absolute < 65680u; absolute += kFrames) {
    harness.process(block.data(), 1u, kFrames, static_cast<double>(absolute) / 1000.0);
  }
  harness.telemetryTick();
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 432u);
  payload = harness.output.data() + 16u;
  SCOPE_CHECK(readU32(payload + 4u) == kCaptureSamples);
  SCOPE_CHECK(payload[15u] == 1u);
  SCOPE_CHECK(readF32(payload + 16u) == 1.0F);
  for (std::uint32_t sample = 1u; sample < kCaptureSamples; ++sample) {
    SCOPE_CHECK(readF32(payload + 16u + sample * 4u) == -1.0F);
  }
}

void testM4ReductionWithVariableBlocks() {
  constexpr std::uint32_t kFrames = 4800u;
  KernelHarness harness(48000.0F, 127u);
  harness.tap_id = 88u;
  harness.setParams(0.1F, 1.0F, 1.0F, 0.0F, 0.01F);
  std::vector<float> audio(127u);
  std::uint32_t processed = 0u;
  while (processed < kFrames) {
    const std::uint32_t remainder = kFrames - processed;
    const std::uint32_t block = remainder < 127u ? remainder : 127u;
    for (std::uint32_t frame = 0u; frame < block; ++frame) {
      const std::uint32_t index = processed + frame;
      if (index == 0u) {
        audio[frame] = 1.0F;
      } else if (index == 1u || index == 2u) {
        audio[frame] = 10.0F;
      } else if (index == 4u || index == 5u) {
        audio[frame] = -10.0F;
      } else if (index == 8u) {
        audio[frame] = 2.0F;
      } else {
        audio[frame] = static_cast<float>(index);
      }
    }
    harness.process(audio.data(), 1u, block, static_cast<double>(processed) / 48000.0);
    processed += block;
  }
  harness.telemetryTick();
  harness.telemetryTick();

  SCOPE_CHECK(harness.read() == 9248u);
  checkFrameHeader(harness.output.data(), 88u, 0u, 9232u);
  const std::uint8_t *payload = harness.output.data() + 16u;
  SCOPE_CHECK(readF32(payload) == 48000.0F);
  SCOPE_CHECK(readU32(payload + 4u) == 4800u);
  SCOPE_CHECK(readU32(payload + 8u) == 0u);
  SCOPE_CHECK(readU16(payload + 12u) == 512u);
  SCOPE_CHECK(payload[14u] == 1u);
  SCOPE_CHECK(payload[15u] == 0u);
  SCOPE_CHECK(readF32(payload + 16u) == 1.0F);
  SCOPE_CHECK(readF32(payload + 20u) == -10.0F);
  SCOPE_CHECK(readF32(payload + 24u) == 10.0F);
  SCOPE_CHECK(readF32(payload + 28u) == 2.0F);
  SCOPE_CHECK(payload[32u] == 4u);
  SCOPE_CHECK(payload[33u] == 1u);
  const std::uint32_t last_bucket = 16u + 511u * 18u;
  SCOPE_CHECK(readF32(payload + last_bucket) == 4790.0F);
  SCOPE_CHECK(readF32(payload + last_bucket + 4u) == 4790.0F);
  SCOPE_CHECK(readF32(payload + last_bucket + 8u) == 4799.0F);
  SCOPE_CHECK(readF32(payload + last_bucket + 12u) == 4799.0F);
  SCOPE_CHECK(payload[last_bucket + 16u] == 0u);
  SCOPE_CHECK(payload[last_bucket + 17u] == 9u);
}

void testFreeRunPublishesLatestWindow() {
  KernelHarness harness(1000.0F, 4u);
  harness.setParams(0.004F, 2.0F, 0.0F, 0.0F, 0.0001F);
  std::array<float, 4> block = {0.1F, 0.2F, 0.3F, 0.4F};
  harness.process(block.data(), 1u, 4u, 0.0);
  block = {0.5F, 0.6F, 0.7F, 0.8F};
  harness.process(block.data(), 1u, 2u, 0.004);
  harness.telemetryTick();

  SCOPE_CHECK(harness.read() == 48u);
  const std::uint8_t *payload = harness.output.data() + 16u;
  SCOPE_CHECK(readU32(payload + 4u) == 4u);
  SCOPE_CHECK(payload[15u] == 0u);
  const std::array<float, 4> expected = {0.3F, 0.4F, 0.5F, 0.6F};
  for (std::uint32_t frame = 0u; frame < 4u; ++frame) {
    SCOPE_CHECK(readF32(payload + 16u + frame * 4u) == expected[frame]);
  }
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 48u);
}

void testTenSecondRollingEnvelopeAcrossWrap() {
  constexpr std::uint32_t kRate = 48000u;
  constexpr std::uint32_t kWindow = kRate * 10u;
  constexpr std::uint32_t kStride = (kWindow + 4095u) / 4096u;
  KernelHarness harness(static_cast<float>(kRate), 127u);
  harness.setParams(10.0F, 2.0F, 0.0F, 0.0F, 0.0001F);
  std::array<float, 127> audio{};
  // Wrap the aggregate ring, not just the short PCM ring, and end in a partial bucket.
  constexpr std::uint32_t kEnd = kStride * 8192u + kWindow + 37u;
  std::uint32_t processed = 0u;
  while (processed < kEnd) {
    const std::uint32_t count = kEnd - processed < 127u ? kEnd - processed : 127u;
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      const std::uint32_t sample = processed + frame;
      audio[frame] = sample % 997u == 0u ? 1.0F : sample % 991u == 0u ? -1.0F : 0.125F;
    }
    harness.process(audio.data(), 1u, count, static_cast<double>(processed) / kRate);
    processed += count;
  }
  harness.telemetryTick();
  const std::uint32_t bytes = harness.read();
  SCOPE_CHECK(bytes > 0u && bytes <= 34000u);
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == bytes);
  SCOPE_CHECK(readU16(harness.output.data() + 2u) == 3u);
  const auto *payload = harness.output.data() + 16u;
  SCOPE_CHECK(readU32(payload + 4u) == kWindow);
  SCOPE_CHECK(payload[14u] == 2u && payload[15u] == 2u);
  SCOPE_CHECK(readU32(payload + 16u) == kStride);
  SCOPE_CHECK(readU32(payload + 20u) == kEnd && readU32(payload + 24u) == 0u);
  const std::uint32_t count = readU16(payload + 12u);
  const std::uint32_t first = (kEnd - kWindow - kRate / 10u) / kStride;
  SCOPE_CHECK(count == (kEnd - 1u) / kStride - first + 1u);
  for (std::uint32_t bucket = 0u; bucket < count; ++bucket) {
    const std::uint32_t begin = (first + bucket) * kStride;
    const std::uint32_t end = begin + kStride < kEnd ? begin + kStride : kEnd;
    float minimum = 1.0F;
    float maximum = -1.0F;
    for (std::uint32_t sample = begin; sample < end; ++sample) {
      const float value = sample % 997u == 0u ? 1.0F : sample % 991u == 0u ? -1.0F : 0.125F;
      minimum = value < minimum ? value : minimum;
      maximum = value > maximum ? value : maximum;
    }
    SCOPE_CHECK(readF32(payload + 28u + bucket * 8u) == minimum);
    SCOPE_CHECK(readF32(payload + 32u + bucket * 8u) == maximum);
  }

  harness.setParams(1.0F, 2.0F, 0.0F, 0.0F, 0.0001F);
  audio.fill(0.5F);
  harness.process(audio.data(), 1u, 37u, 30.0);
  harness.telemetryTick();
  constexpr std::uint32_t kResetStride = (kRate + 4095u) / 4096u;
  constexpr std::uint32_t kResetBuckets = (37u + kResetStride - 1u) / kResetStride;
  SCOPE_CHECK(harness.read() == 44u + kResetBuckets * 8u);
  payload = harness.output.data() + 16u;
  SCOPE_CHECK(readU16(payload + 12u) == kResetBuckets);
  SCOPE_CHECK(readU32(payload + 16u) == kResetStride);
  SCOPE_CHECK(readU32(payload + 20u) == 37u);
  for (std::uint32_t bucket = 0u; bucket < kResetBuckets; ++bucket) {
    SCOPE_CHECK(readF32(payload + 28u + bucket * 8u) == 0.5F);
    SCOPE_CHECK(readF32(payload + 32u + bucket * 8u) == 0.5F);
  }
}

void testTenSecondTriggeredEnvelopeAtHighRate() {
  constexpr std::uint32_t kRate = 384000u;
  constexpr std::uint32_t kWindow = kRate * 10u;
  KernelHarness harness(static_cast<float>(kRate), 113u);
  harness.setParams(10.0F, 1.0F, 1.0F, 0.0F, 0.0001F);
  std::array<float, 113> audio{};
  std::uint32_t processed = 0u;
  while (processed < kWindow) {
    const std::uint32_t count = kWindow - processed < 113u ? kWindow - processed : 113u;
    for (std::uint32_t frame = 0u; frame < count; ++frame) {
      // Both impulses have offsets beyond the old 8-bit M4 limit.
      const auto offset = (processed + frame) % 3750u;
      audio[frame] = offset == 3000u ? 0.75F : offset == 3500u ? -0.5F : 0.0F;
    }
    harness.process(audio.data(), 1u, count, static_cast<double>(processed) / kRate);
    processed += count;
  }
  harness.telemetryTick();
  harness.telemetryTick();
  SCOPE_CHECK(harness.read() == 32812u);
  const auto *payload = harness.output.data() + 16u;
  SCOPE_CHECK(readU32(payload + 4u) == kWindow);
  SCOPE_CHECK(readU16(payload + 12u) == 4096u);
  SCOPE_CHECK(payload[14u] == 2u && payload[15u] == 0u);
  for (std::uint32_t bucket = 0u; bucket < 4096u; ++bucket) {
    const auto begin =
        static_cast<std::uint32_t>(static_cast<std::uint64_t>(bucket) * kWindow / 4096u);
    const auto end =
        static_cast<std::uint32_t>(static_cast<std::uint64_t>(bucket + 1u) * kWindow / 4096u);
    float minimum = 0.0F;
    float maximum = 0.0F;
    for (std::uint32_t sample = begin; sample < end; ++sample) {
      const auto offset = sample % 3750u;
      if (offset == 3000u)
        maximum = 0.75F;
      if (offset == 3500u)
        minimum = -0.5F;
    }
    SCOPE_CHECK(readF32(payload + 28u + bucket * 8u) == minimum);
    SCOPE_CHECK(readF32(payload + 32u + bucket * 8u) == maximum);
  }
}

void testShortRollingEnvelopeRetainsInterpolationHistory() {
  KernelHarness harness(48000.0F, 128u);
  harness.setParams(0.045F, 2.0F, 0.0F, 0.0F, 0.0001F);
  std::array<float, 128> audio{};
  constexpr std::uint32_t kEnd = 128u * 200u;
  for (std::uint32_t start = 0u; start < kEnd; start += 128u) {
    for (std::uint32_t frame = 0u; frame < 128u; ++frame) {
      audio[frame] = static_cast<float>((start + frame) % 127u) / 128.0F - 0.5F;
    }
    harness.process(audio.data(), 1u, 128u, static_cast<double>(start) / 48000.0);
  }
  harness.telemetryTick();
  const auto bytes = harness.read();
  SCOPE_CHECK(bytes > 0u && bytes < 65536u);
  const auto *payload = harness.output.data() + 16u;
  const auto window = readU32(payload + 4u);
  const auto count = readU16(payload + 12u);
  SCOPE_CHECK(readU32(payload + 16u) == 1u);
  const std::uint32_t first = kEnd - count;
  SCOPE_CHECK(first <= kEnd - window - 48000u / 30u);
  for (std::uint32_t bucket = 0u; bucket < count; ++bucket) {
    const float value = static_cast<float>((first + bucket) % 127u) / 128.0F - 0.5F;
    SCOPE_CHECK(readF32(payload + 28u + bucket * 8u) == value);
    SCOPE_CHECK(readF32(payload + 32u + bucket * 8u) == value);
  }
}

} // namespace

int main() {
  testRawCadenceTapSequenceResetAndPassthrough();
  testRisingTriggerCaptureContent();
  testPreviousSnapshotRemainsPublishedDuringCapture();
  testCaptureSettingChangesInvalidatePreviousSnapshot();
  testPastTriggerCaptureIsBoundedAcrossRingWrap();
  testM4ReductionWithVariableBlocks();
  testFreeRunPublishesLatestWindow();
  testTenSecondRollingEnvelopeAcrossWrap();
  testTenSecondTriggeredEnvelopeAtHighRate();
  testShortRollingEnvelopeRetainsInterpolationHistory();
  if (failures != 0) {
    std::fprintf(stderr, "%d Oscilloscope frame-content check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Oscilloscope frame-content tests passed");
  return 0;
}
