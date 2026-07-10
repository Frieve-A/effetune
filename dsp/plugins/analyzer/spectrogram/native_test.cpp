#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_SpectrogramPlugin() noexcept;

namespace {

constexpr double kPi = 3.14159265358979323846264338327950288;
constexpr std::uint32_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kTelemetryBytes = 128u * 1024u;
constexpr std::uint32_t kPayloadBytes = 268u;
constexpr std::uint32_t kFrameBytes = 16u + kPayloadBytes;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "spectrogram/native_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define SPECTROGRAM_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

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

bool near(float actual, float expected, float tolerance) noexcept {
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
    descriptor = et_kernel_descriptor_SpectrogramPlugin();
    SPECTROGRAM_CHECK(descriptor != nullptr);
    SPECTROGRAM_CHECK(descriptor != nullptr && descriptor->paramsHash == 0xc99dcc20u);
    SPECTROGRAM_CHECK(descriptor != nullptr && descriptor->paramsFloatCount == 2u);
    SPECTROGRAM_CHECK(descriptor != nullptr && descriptor->objectSize <= object_storage.size());
    if (descriptor == nullptr || descriptor->objectSize > object_storage.size()) {
      return;
    }
    kernel = descriptor->construct(object_storage.data());
    SPECTROGRAM_CHECK(kernel != nullptr);
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

  void setParams(float dB_range, float points) noexcept {
    const std::array<float, 2> params = {dB_range, points};
    SPECTROGRAM_CHECK(kernel->stageParameters(params.data(), 2u, descriptor->paramsHash) == ET_OK);
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
    SPECTROGRAM_CHECK(dropped == 0u);
    return bytes;
  }
};

const std::uint8_t *frameAt(const KernelHarness &harness, std::uint32_t index) noexcept {
  return harness.output.data() + index * kFrameBytes;
}

const std::uint8_t *payloadAt(const KernelHarness &harness, std::uint32_t index) noexcept {
  return frameAt(harness, index) + 16u;
}

void checkFrameHeader(const std::uint8_t *frame, std::uint32_t tap_id,
                      std::uint32_t sequence) noexcept {
  SPECTROGRAM_CHECK(readU16(frame) == 5u);
  SPECTROGRAM_CHECK(readU16(frame + 2u) == 1u);
  SPECTROGRAM_CHECK(readU32(frame + 4u) == tap_id);
  SPECTROGRAM_CHECK(readU32(frame + 8u) == sequence);
  SPECTROGRAM_CHECK(readU16(frame + 12u) == kPayloadBytes);
  SPECTROGRAM_CHECK(readU16(frame + 14u) == 0u);
}

void testKnownToneLogMappingAndVariableBlocks() {
  constexpr float kSampleRate = 32000.0F;
  constexpr std::uint32_t kFftSize = 256u;
  constexpr std::array<std::uint32_t, 3> kBlocks = {97u, 83u, 76u};
  KernelHarness harness(kSampleRate, 97u);
  harness.tap_id = 0x2345u;
  harness.setParams(-96.0F, 8.0F);

  std::vector<float> audio(2u * 97u);
  std::uint32_t processed = 0u;
  for (const std::uint32_t block : kBlocks) {
    for (std::uint32_t frame = 0u; frame < block; ++frame) {
      const float sample = static_cast<float>(
          std::sin(2.0 * kPi * 1000.0 * static_cast<double>(processed + frame) / kSampleRate));
      audio[frame] = sample;
      audio[block + frame] = sample;
    }
    const std::vector<float> original(audio.begin(), audio.begin() + block * 2u);
    harness.process(audio.data(), 2u, block, static_cast<double>(processed) / kSampleRate);
    SPECTROGRAM_CHECK(std::memcmp(audio.data(), original.data(), sizeof(float) * block * 2u) == 0);
    processed += block;
  }
  SPECTROGRAM_CHECK(processed == kFftSize);

  harness.telemetryTick();
  SPECTROGRAM_CHECK(harness.read() == 2u * kFrameBytes);
  checkFrameHeader(frameAt(harness, 0u), 0x2345u, 0u);
  checkFrameHeader(frameAt(harness, 1u), 0x2345u, 1u);
  const std::uint8_t *first = payloadAt(harness, 0u);
  const std::uint8_t *second = payloadAt(harness, 1u);
  SPECTROGRAM_CHECK(readF32(first) == kSampleRate);
  SPECTROGRAM_CHECK(near(readF32(first + 4u), 128.0F / kSampleRate, 1.0e-7F));
  SPECTROGRAM_CHECK(near(readF32(second + 4u), 256.0F / kSampleRate, 1.0e-7F));
  SPECTROGRAM_CHECK(readU16(second + 8u) == 256u);
  SPECTROGRAM_CHECK(readU16(second + 10u) == 8u);
  SPECTROGRAM_CHECK(second[12u] == 0u);

  std::uint8_t maximum = 0u;
  std::uint32_t maximum_row = 0u;
  for (std::uint32_t row = 0u; row < 256u; ++row) {
    const std::uint8_t intensity = second[12u + row];
    if (intensity > maximum) {
      maximum = intensity;
      maximum_row = row;
    }
  }
  SPECTROGRAM_CHECK(maximum >= 253u);
  SPECTROGRAM_CHECK(maximum_row >= 122u && maximum_row <= 125u);
  SPECTROGRAM_CHECK(second[12u + 123u] >= 250u);
  SPECTROGRAM_CHECK(second[12u + 124u] >= 250u);

  harness.telemetryTick();
  SPECTROGRAM_CHECK(harness.read() == 0u);
}

void testOneFramePerHopAndPointBounds() {
  KernelHarness harness(48000.0F, 1024u);
  harness.tap_id = 91u;
  harness.setParams(-144.0F, 7.0F);
  std::vector<float> audio(4u * 1024u);
  for (std::uint32_t frame = 0u; frame < 1024u; ++frame) {
    audio[frame] = 0.1F;
    audio[1024u + frame] = -0.2F;
    audio[2048u + frame] = 0.3F;
    audio[3072u + frame] = -0.4F;
  }
  const std::vector<float> original = audio;
  harness.process(audio.data(), 4u, 1024u, 4.0);
  SPECTROGRAM_CHECK(std::memcmp(audio.data(), original.data(), sizeof(float) * audio.size()) == 0);
  harness.telemetryTick();
  SPECTROGRAM_CHECK(harness.read() == 8u * kFrameBytes);
  for (std::uint32_t index = 0u; index < 8u; ++index) {
    checkFrameHeader(frameAt(harness, index), 91u, index);
    const std::uint8_t *payload = payloadAt(harness, index);
    SPECTROGRAM_CHECK(readU16(payload + 8u) == 256u);
    SPECTROGRAM_CHECK(readU16(payload + 10u) == 8u);
    const float expected_time = 4.0F + static_cast<float>((index + 1u) * 128u) / 48000.0F;
    SPECTROGRAM_CHECK(near(readF32(payload + 4u), expected_time, 5.0e-7F));
  }

  harness.setParams(-48.0F, 15.0F);
  std::vector<float> maximum_audio(1u << 13u);
  harness.process(maximum_audio.data(), 1u, 1u << 13u, 8.0);
  harness.telemetryTick();
  SPECTROGRAM_CHECK(harness.read() == kFrameBytes);
  const std::uint8_t *payload = payloadAt(harness, 0u);
  SPECTROGRAM_CHECK(readU16(payload + 10u) == 14u);
  for (std::uint32_t row = 0u; row < 256u; ++row) {
    SPECTROGRAM_CHECK(payload[12u + row] <= 255u);
  }
}

void testFloatTimestampPrecisionBoundary() {
  constexpr double kFloatIntegerBoundary = 16777216.0;
  KernelHarness harness(48000.0F, 256u);
  harness.setParams(-96.0F, 8.0F);
  std::vector<float> audio(256u);

  harness.process(audio.data(), 1u, 256u, kFloatIntegerBoundary);
  harness.telemetryTick();
  SPECTROGRAM_CHECK(harness.read() == 2u * kFrameBytes);
  const float first = readF32(payloadAt(harness, 0u) + 4u);
  const float second = readF32(payloadAt(harness, 1u) + 4u);
  SPECTROGRAM_CHECK(first == 16777216.0F);
  SPECTROGRAM_CHECK(second == first);

  harness.process(audio.data(), 1u, 128u, kFloatIntegerBoundary + 2.0);
  harness.telemetryTick();
  SPECTROGRAM_CHECK(harness.read() == kFrameBytes);
  const float later = readF32(payloadAt(harness, 0u) + 4u);
  SPECTROGRAM_CHECK(later == 16777218.0F);
  SPECTROGRAM_CHECK(later > second);
}

} // namespace

int main() {
  testKnownToneLogMappingAndVariableBlocks();
  testOneFramePerHopAndPointBounds();
  testFloatTimestampPrecisionBoundary();
  if (failures != 0) {
    std::fprintf(stderr, "%d Spectrogram native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Spectrogram native tests passed");
  return 0;
}
