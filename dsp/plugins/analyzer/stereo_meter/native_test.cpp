#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_StereoMeterPlugin() noexcept;

namespace {

constexpr std::uint32_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kTelemetryBytes = 64u * 1024u;
constexpr std::uint32_t kPayloadHeaderBytes = 8u;
constexpr std::uint32_t kSampleBytes = 8u;
constexpr std::uint32_t kEnvelopeBytes = 360u * 4u;
constexpr std::uint32_t kPayloadTailBytes = kEnvelopeBytes + 16u;
constexpr std::uint32_t kMaxDeltaSamples = 8000u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "stereo_meter/native_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define STEREO_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

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

bool near(float actual, float expected, float tolerance = 1.0e-5F) noexcept {
  const float difference = actual - expected;
  const float absolute = difference < 0.0F ? -difference : difference;
  return absolute <= tolerance;
}

struct KernelHarness {
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> object_storage{};
  std::vector<std::uint8_t> ring_storage;
  std::vector<std::uint8_t> output;
  const effetune::KernelDescriptor *descriptor = nullptr;
  effetune::PluginKernel *kernel = nullptr;
  effetune::TelemetryRing ring;
  std::uint32_t tap_id = 0u;
  std::uint32_t sequence = 0u;

  KernelHarness(float sample_rate, std::uint32_t max_frames)
      : ring_storage(kTelemetryBytes), output(kTelemetryBytes) {
    descriptor = et_kernel_descriptor_StereoMeterPlugin();
    STEREO_CHECK(descriptor != nullptr);
    STEREO_CHECK(descriptor != nullptr && descriptor->paramsHash == 0xb0de3212u);
    STEREO_CHECK(descriptor != nullptr && descriptor->paramsFloatCount == 1u);
    STEREO_CHECK(descriptor != nullptr && descriptor->objectSize <= object_storage.size());
    if (descriptor == nullptr || descriptor->objectSize > object_storage.size()) {
      return;
    }
    kernel = descriptor->construct(object_storage.data());
    STEREO_CHECK(kernel != nullptr);
    ring.adopt(ring_storage.data(), static_cast<std::uint32_t>(ring_storage.size()));
    if (kernel != nullptr) {
      kernel->prepare({sample_rate, 8u, max_frames});
      kernel->reset();
    }
  }

  ~KernelHarness() {
    if (kernel != nullptr) {
      descriptor->destroy(kernel);
    }
  }

  void setWindow(float seconds) noexcept {
    STEREO_CHECK(kernel->stageParameters(&seconds, 1u, descriptor->paramsHash) == ET_OK);
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
    STEREO_CHECK(dropped == 0u);
    return bytes;
  }
};

const std::uint8_t *payload(const KernelHarness &harness) noexcept {
  return harness.output.data() + 16u;
}

std::uint32_t payloadBytes(std::uint32_t sample_count) noexcept {
  return kPayloadHeaderBytes + sample_count * kSampleBytes + kPayloadTailBytes;
}

std::uint32_t frameBytes(std::uint32_t sample_count) noexcept {
  return (16u + payloadBytes(sample_count) + 3u) & ~3u;
}

std::uint32_t envelopeOffset(std::uint32_t sample_count) noexcept {
  return kPayloadHeaderBytes + sample_count * kSampleBytes;
}

std::uint32_t statisticsOffset(std::uint32_t sample_count) noexcept {
  return envelopeOffset(sample_count) + kEnvelopeBytes;
}

void emitFrame(KernelHarness &harness, std::uint32_t sample_count) noexcept {
  harness.telemetryTick();
  STEREO_CHECK(harness.read() == frameBytes(sample_count));
}

void checkFrame(const KernelHarness &harness, std::uint32_t sequence, std::uint32_t sample_count,
                std::uint16_t sample_flags = 0u) noexcept {
  const std::uint8_t *frame = harness.output.data();
  STEREO_CHECK(readU16(frame) == 6u);
  STEREO_CHECK(readU16(frame + 2u) == 2u);
  STEREO_CHECK(readU32(frame + 4u) == harness.tap_id);
  STEREO_CHECK(readU32(frame + 8u) == sequence);
  STEREO_CHECK(readU16(frame + 12u) == payloadBytes(sample_count));
  STEREO_CHECK(readU16(frame + 14u) == 0u);
  const std::uint8_t *data = payload(harness);
  STEREO_CHECK(near(readF32(data), 1000.0F) || readF32(data) == 384000.0F);
  STEREO_CHECK(readU16(data + 4u) == sample_count);
  STEREO_CHECK(readU16(data + 6u) == sample_flags);
}

void testMonoMirrorAndFullPrecisionCoordinates() {
  KernelHarness harness(1000.0F, 10u);
  harness.tap_id = 61u;
  harness.setWindow(0.01F);
  std::array<float, 10> audio{};
  audio[9] = 0.5F;
  const std::array<float, 10> original = audio;
  harness.process(audio.data(), 1u, 10u, 1.0);
  STEREO_CHECK(std::memcmp(audio.data(), original.data(), sizeof(audio)) == 0);

  emitFrame(harness, 10u);
  checkFrame(harness, 0u, 10u);
  const std::uint8_t *data = payload(harness);
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes + 9u * kSampleBytes), 0.0F));
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes + 9u * kSampleBytes + 4u), 1.0F));
  const std::uint32_t envelope = envelopeOffset(10u);
  const std::uint32_t statistics = statisticsOffset(10u);
  STEREO_CHECK(near(readF32(data + envelope + 270u * 4u), 1.0F));
  STEREO_CHECK(near(readF32(data + statistics), 1.0F));
  STEREO_CHECK(near(readF32(data + statistics + 4u), 0.0F));
  STEREO_CHECK(near(readF32(data + statistics + 8u), 0.5F));
  STEREO_CHECK(near(readF32(data + statistics + 12u), 0.5F));
}

void testAntiPhaseBoundariesAndFourChannelPassthrough() {
  KernelHarness harness(1000.0F, 10u);
  harness.tap_id = 62u;
  harness.setWindow(0.01F);
  std::array<float, 40> audio{};
  for (std::uint32_t frame = 0u; frame < 10u; ++frame) {
    const float left = (frame & 1u) == 0u ? 1.0F : -1.0F;
    audio[frame] = left;
    audio[10u + frame] = -left;
    audio[20u + frame] = 9.0F;
    audio[30u + frame] = -9.0F;
  }
  const std::array<float, 40> original = audio;
  harness.process(audio.data(), 4u, 10u, 2.0);
  STEREO_CHECK(std::memcmp(audio.data(), original.data(), sizeof(audio)) == 0);

  emitFrame(harness, 10u);
  checkFrame(harness, 0u, 10u);
  const std::uint8_t *data = payload(harness);
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes), -2.0F));
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes + 4u), 0.0F));
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes + kSampleBytes), 2.0F));
  const std::uint32_t envelope = envelopeOffset(10u);
  const std::uint32_t statistics = statisticsOffset(10u);
  STEREO_CHECK(near(readF32(data + envelope), 2.0F));
  STEREO_CHECK(near(readF32(data + envelope + 180u * 4u), 2.0F));
  STEREO_CHECK(near(readF32(data + statistics), -1.0F));
  STEREO_CHECK(near(readF32(data + statistics + 4u), 0.0F));
  STEREO_CHECK(near(readF32(data + statistics + 8u), 1.0F));
  STEREO_CHECK(near(readF32(data + statistics + 12u), 1.0F));
}

void testVariableBlocksUseLatestWindow() {
  KernelHarness harness(1000.0F, 5u);
  harness.tap_id = 63u;
  harness.setWindow(0.01F);
  constexpr std::array<std::uint32_t, 3> blocks = {3u, 4u, 5u};
  std::array<float, 10> audio{};
  std::uint32_t processed = 0u;
  for (const std::uint32_t block : blocks) {
    for (std::uint32_t frame = 0u; frame < block; ++frame) {
      const std::uint32_t sample = processed + frame;
      audio[frame] = sample < 2u ? 2.0F : 0.25F;
      audio[block + frame] = sample < 2u ? 2.0F : 0.5F;
    }
    const std::vector<float> original(audio.begin(), audio.begin() + block * 2u);
    harness.process(audio.data(), 2u, block, 3.0);
    STEREO_CHECK(std::memcmp(audio.data(), original.data(), sizeof(float) * block * 2u) == 0);
    processed += block;
  }
  STEREO_CHECK(processed == 12u);

  emitFrame(harness, 12u);
  checkFrame(harness, 0u, 12u);
  const std::uint8_t *data = payload(harness);
  const std::uint32_t latest_sample = kPayloadHeaderBytes + 11u * kSampleBytes;
  STEREO_CHECK(near(readF32(data + latest_sample), 0.25F));
  STEREO_CHECK(near(readF32(data + latest_sample + 4u), 0.75F));
  const std::uint32_t envelope = envelopeOffset(12u);
  const std::uint32_t statistics = statisticsOffset(12u);
  STEREO_CHECK(near(readF32(data + statistics), 1.0F));
  STEREO_CHECK(near(readF32(data + statistics + 4u), 6.0205999F, 2.0e-5F));
  STEREO_CHECK(near(readF32(data + statistics + 8u), 0.25F));
  STEREO_CHECK(near(readF32(data + statistics + 12u), 0.5F));
  STEREO_CHECK(near(readF32(data + envelope + 270u * 4u), 4.0F));
}

void testEnvelopeDecayAndSequence() {
  KernelHarness harness(1000.0F, 1u);
  harness.tap_id = 64u;
  harness.setWindow(0.01F);
  float tone = 0.5F;
  harness.process(&tone, 1u, 1u, 4.0);
  emitFrame(harness, 1u);
  checkFrame(harness, 0u, 1u);
  STEREO_CHECK(near(readF32(payload(harness) + envelopeOffset(1u) + 270u * 4u), 1.0F));

  float silence = 0.0F;
  harness.process(&silence, 1u, 1u, 4.1);
  emitFrame(harness, 1u);
  checkFrame(harness, 1u, 1u);
  STEREO_CHECK(
      near(readF32(payload(harness) + envelopeOffset(1u) + 270u * 4u), 0.7943282F, 2.0e-6F));
}

void testOutOfFieldCoordinatesRetainTheirRange() {
  KernelHarness harness(1000.0F, 10u);
  harness.tap_id = 65u;
  harness.setWindow(0.01F);
  std::array<float, 20> audio{};
  for (std::uint32_t frame = 0u; frame < 10u; ++frame) {
    audio[frame] = 2.0F;
    audio[10u + frame] = 2.0F;
  }
  harness.process(audio.data(), 2u, 10u, 5.0);
  emitFrame(harness, 10u);
  checkFrame(harness, 0u, 10u);
  const std::uint8_t *data = payload(harness);
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes), 0.0F));
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes + 4u), 4.0F));
  const std::uint32_t statistics = statisticsOffset(10u);
  STEREO_CHECK(near(readF32(data + statistics + 8u), 2.0F));
  STEREO_CHECK(near(readF32(data + statistics + 12u), 2.0F));
}

void testOversizedDeltaKeepsLatestSamplesAndMarksDiscontinuity() {
  KernelHarness harness(384000.0F, 1000u);
  harness.tap_id = 66u;
  harness.setWindow(0.01F);
  std::vector<float> audio(2000u);
  for (std::uint32_t frame = 0u; frame < 1000u; ++frame) {
    audio[frame] = 0.25F;
    audio[1000u + frame] = 0.5F;
  }
  for (std::uint32_t block = 0u; block < 17u; ++block) {
    harness.process(audio.data(), 2u, 1000u, 6.0);
  }

  emitFrame(harness, kMaxDeltaSamples);
  checkFrame(harness, 0u, kMaxDeltaSamples, 1u);
  const std::uint8_t *data = payload(harness);
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes), 0.25F));
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes + 4u), 0.75F));
}

} // namespace

int main() {
  testMonoMirrorAndFullPrecisionCoordinates();
  testAntiPhaseBoundariesAndFourChannelPassthrough();
  testVariableBlocksUseLatestWindow();
  testEnvelopeDecayAndSequence();
  testOutOfFieldCoordinatesRetainTheirRange();
  testOversizedDeltaKeepsLatestSamplesAndMarksDiscontinuity();
  if (failures != 0) {
    std::fprintf(stderr, "%d Stereo Meter native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Stereo Meter native tests passed");
  return 0;
}
