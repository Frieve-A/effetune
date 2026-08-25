#include "effetune/kernel.h"

#include "pffft.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_SpectrumAnalyzerPlugin() noexcept;

namespace {

constexpr double kPi = 3.14159265358979323846264338327950288;
constexpr std::uint32_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kTelemetryBytes = 128u * 1024u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "spectrum_analyzer/native_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define SPECTRUM_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

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

struct AlignedFloats {
  explicit AlignedFloats(std::uint32_t count)
      : data(static_cast<float *>(pffft_aligned_malloc(sizeof(float) * count))) {}
  ~AlignedFloats() {
    if (data != nullptr) {
      pffft_aligned_free(data);
    }
  }
  AlignedFloats(const AlignedFloats &) = delete;
  AlignedFloats &operator=(const AlignedFloats &) = delete;
  float *data = nullptr;
};

void testPffftRoundTripAndKnownBin() {
  constexpr std::uint32_t kSize = 256u;
  constexpr std::uint32_t kToneBin = 8u;
  PFFFT_Setup *setup = pffft_new_setup(static_cast<int>(kSize), PFFFT_REAL);
  SPECTRUM_CHECK(setup != nullptr);
  AlignedFloats input(kSize);
  AlignedFloats spectrum(kSize);
  AlignedFloats restored(kSize);
  AlignedFloats work(kSize);
  SPECTRUM_CHECK(input.data != nullptr && spectrum.data != nullptr && restored.data != nullptr &&
                 work.data != nullptr);
  if (setup == nullptr || input.data == nullptr || spectrum.data == nullptr ||
      restored.data == nullptr || work.data == nullptr) {
    if (setup != nullptr) {
      pffft_destroy_setup(setup);
    }
    return;
  }

  for (std::uint32_t index = 0u; index < kSize; ++index) {
    input.data[index] = static_cast<float>(
        0.25 + 0.5 * std::sin(2.0 * kPi * static_cast<double>(kToneBin * index) / kSize));
  }
  pffft_transform_ordered(setup, input.data, spectrum.data, work.data, PFFFT_FORWARD);
  SPECTRUM_CHECK(near(spectrum.data[0], 64.0F, 2.0e-4F));
  SPECTRUM_CHECK(near(spectrum.data[kToneBin * 2u], 0.0F, 2.0e-4F));
  SPECTRUM_CHECK(near(spectrum.data[kToneBin * 2u + 1u], -64.0F, 2.0e-4F));

  pffft_transform_ordered(setup, spectrum.data, restored.data, work.data, PFFFT_BACKWARD);
  for (std::uint32_t index = 0u; index < kSize; ++index) {
    SPECTRUM_CHECK(
        near(restored.data[index] / static_cast<float>(kSize), input.data[index], 2.0e-5F));
  }
  pffft_destroy_setup(setup);
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
    descriptor = et_kernel_descriptor_SpectrumAnalyzerPlugin();
    SPECTRUM_CHECK(descriptor != nullptr);
    SPECTRUM_CHECK(descriptor != nullptr && descriptor->paramsHash == 0xc99dcc20u);
    SPECTRUM_CHECK(descriptor != nullptr && descriptor->paramsFloatCount == 2u);
    SPECTRUM_CHECK(descriptor != nullptr && descriptor->objectSize <= object_storage.size());
    if (descriptor == nullptr || descriptor->objectSize > object_storage.size()) {
      return;
    }
    kernel = descriptor->construct(object_storage.data());
    SPECTRUM_CHECK(kernel != nullptr);
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
    SPECTRUM_CHECK(kernel->stageParameters(params.data(), 2u, descriptor->paramsHash) == ET_OK);
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames,
               double time_seconds) noexcept {
    kernel->applyPendingParameters();
    kernel->process(audio, channels, frames, {time_seconds});
  }

  void reset() noexcept { kernel->reset(); }

  void telemetryTick() noexcept {
    effetune::TelemetryWriter writer(ring, tap_id, sequence);
    kernel->writeTelemetry(writer);
  }

  std::uint32_t read() noexcept {
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
    SPECTRUM_CHECK(dropped == 0u);
    return bytes;
  }
};

void checkFrameHeader(const std::uint8_t *frame, std::uint32_t tap_id, std::uint32_t sequence,
                      std::uint16_t payload_bytes) noexcept {
  SPECTRUM_CHECK(readU16(frame) == 4u);
  SPECTRUM_CHECK(readU16(frame + 2u) == 1u);
  SPECTRUM_CHECK(readU32(frame + 4u) == tap_id);
  SPECTRUM_CHECK(readU32(frame + 8u) == sequence);
  SPECTRUM_CHECK(readU16(frame + 12u) == payload_bytes);
  SPECTRUM_CHECK(readU16(frame + 14u) == 0u);
}

template <class Sample>
void processSamples(KernelHarness &harness, float sample_rate, std::uint32_t total_frames,
                    const std::vector<std::uint32_t> &blocks, Sample sample) {
  std::uint32_t maximum_block = 1u;
  for (const std::uint32_t block : blocks) {
    if (block > maximum_block) {
      maximum_block = block;
    }
  }
  std::vector<float> audio(maximum_block * 2u);
  std::uint32_t processed = 0u;
  std::uint32_t block_index = 0u;
  while (processed < total_frames) {
    const std::uint32_t requested = blocks[block_index % blocks.size()];
    const std::uint32_t remaining = total_frames - processed;
    const std::uint32_t block = requested < remaining ? requested : remaining;
    for (std::uint32_t frame = 0u; frame < block; ++frame) {
      const float value = sample(processed + frame);
      audio[frame] = value;
      audio[block + frame] = value;
    }
    const std::vector<float> original(audio.begin(), audio.begin() + block * 2u);
    harness.process(audio.data(), 2u, block, static_cast<double>(processed) / sample_rate);
    SPECTRUM_CHECK(std::memcmp(audio.data(), original.data(), sizeof(float) * block * 2u) == 0);
    processed += block;
    ++block_index;
  }
}

std::vector<std::uint8_t> takePayload(KernelHarness &harness) {
  harness.telemetryTick();
  const std::uint32_t bytes = harness.read();
  if (bytes < 16u) {
    return {};
  }
  return {harness.output.begin() + 16u, harness.output.begin() + bytes};
}

std::vector<std::uint8_t> renderPayload(const std::vector<std::uint32_t> &blocks) {
  constexpr float kSampleRate = 48000.0F;
  constexpr std::uint32_t kFirstFrameCompletion = 1856u;
  std::uint32_t maximum_block = 1u;
  for (const std::uint32_t block : blocks) {
    if (block > maximum_block) {
      maximum_block = block;
    }
  }
  KernelHarness harness(kSampleRate, maximum_block);
  harness.setParams(-96.0F, 8.0F);
  processSamples(harness, kSampleRate, kFirstFrameCompletion, blocks, [](std::uint32_t frame) {
    return static_cast<float>(0.4 * std::sin(2.0 * kPi * 750.0 * frame / 48000.0));
  });
  return takePayload(harness);
}

std::vector<std::uint8_t> renderPointPayload(KernelHarness &harness, std::uint32_t points,
                                             const std::vector<std::uint32_t> &blocks) {
  constexpr float kSampleRate = 192000.0F;
  constexpr std::uint32_t kRateLimitedInterval = 6400u;
  const std::uint32_t fft_size = 1u << points;
  const std::uint32_t fft_hop = fft_size >> 1u;
  const std::uint32_t interval = fft_hop > kRateLimitedInterval ? fft_hop : kRateLimitedInterval;
  const std::uint32_t first_trigger = fft_size < interval ? fft_size : interval;
  harness.setParams(-144.0F, static_cast<float>(points));
  processSamples(harness, kSampleRate, first_trigger + interval, blocks, [](std::uint32_t frame) {
    return static_cast<float>(0.4 * std::sin(2.0 * kPi * 750.0 * frame / kSampleRate));
  });
  return takePayload(harness);
}

void testKnownOneKilohertzFrameAndVariableBlocks() {
  constexpr float kSampleRate = 32000.0F;
  constexpr std::uint32_t kFftSize = 256u;
  constexpr std::uint32_t kToneBin = 8u;
  constexpr std::array<std::uint32_t, 3> kBlocks = {97u, 83u, 76u};
  KernelHarness harness(kSampleRate, 97u);
  harness.tap_id = 0x1234u;
  harness.setParams(-96.0F, 8.0F);

  std::vector<float> audio(2u * kFftSize);
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
    SPECTRUM_CHECK(std::memcmp(audio.data(), original.data(), sizeof(float) * block * 2u) == 0);
    processed += block;
  }
  SPECTRUM_CHECK(processed == kFftSize);

  constexpr std::uint32_t kStagedCompletionFrames = 1056u;
  std::uint32_t completion_processed = 0u;
  while (completion_processed < kStagedCompletionFrames) {
    const std::uint32_t remaining = kStagedCompletionFrames - completion_processed;
    const std::uint32_t block = remaining < 97u ? remaining : 97u;
    for (std::uint32_t index = 0u; index < block * 2u; ++index) {
      audio[index] = 0.0F;
    }
    harness.process(audio.data(), 2u, block,
                    static_cast<double>(kFftSize + completion_processed) / kSampleRate);
    completion_processed += block;
  }

  harness.telemetryTick();
  constexpr std::uint32_t kBinCount = (kFftSize >> 1u) + 1u;
  constexpr std::uint16_t kPayloadBytes = 12u + kBinCount * 8u;
  SPECTRUM_CHECK(harness.read() == 16u + kPayloadBytes);
  checkFrameHeader(harness.output.data(), 0x1234u, 0u, kPayloadBytes);
  const std::uint8_t *payload = harness.output.data() + 16u;
  SPECTRUM_CHECK(readF32(payload) == kSampleRate);
  SPECTRUM_CHECK(readU32(payload + 4u) == kBinCount);
  SPECTRUM_CHECK(readU16(payload + 8u) == 8u);
  SPECTRUM_CHECK(readU16(payload + 10u) == 0u);
  const std::uint32_t current_offset = 12u + kToneBin * 4u;
  const std::uint32_t peak_offset = 12u + kBinCount * 4u + kToneBin * 4u;
  SPECTRUM_CHECK(near(readF32(payload + current_offset), 0.0F, 2.0e-3F));
  SPECTRUM_CHECK(near(readF32(payload + current_offset - 4u), -6.0206F, 2.0e-3F));
  SPECTRUM_CHECK(near(readF32(payload + current_offset + 4u), -6.0206F, 2.0e-3F));
  SPECTRUM_CHECK(near(readF32(payload + peak_offset), 0.0F, 2.0e-3F));
  SPECTRUM_CHECK(std::isfinite(readF32(payload + 12u + (kBinCount - 1u) * 4u)));

  harness.telemetryTick();
  SPECTRUM_CHECK(harness.read() == 0u);

  constexpr std::uint32_t kRateLimitedInterval = 1067u;
  std::uint32_t silence_processed = 0u;
  while (silence_processed < kRateLimitedInterval) {
    const std::uint32_t remaining = kRateLimitedInterval - silence_processed;
    const std::uint32_t block = remaining < 97u ? remaining : 97u;
    for (std::uint32_t index = 0u; index < block * 2u; ++index) {
      audio[index] = 0.0F;
    }
    harness.process(audio.data(), 2u, block,
                    static_cast<double>(kFftSize + kStagedCompletionFrames + silence_processed) /
                        kSampleRate);
    silence_processed += block;
  }
  harness.telemetryTick();
  SPECTRUM_CHECK(harness.read() == 16u + kPayloadBytes);
  payload = harness.output.data() + 16u;
  SPECTRUM_CHECK(near(readF32(payload + peak_offset), -0.666875F, 3.0e-3F));
}

void testMaximumPointPayloadContract() {
  constexpr std::uint32_t kFftSize = 1u << 14u;
  constexpr std::uint32_t kHopSize = kFftSize >> 1u;
  constexpr std::uint32_t kBlockSize = 127u;
  constexpr std::uint16_t kPayloadBytes = 65532u;
  KernelHarness harness(48000.0F, kBlockSize);
  harness.tap_id = 99u;
  harness.setParams(-144.0F, 14.0F);
  std::vector<float> audio(2u * kBlockSize);

  std::uint32_t processed = 0u;
  while (processed < kHopSize * 2u) {
    const std::uint32_t remaining = kHopSize * 2u - processed;
    const std::uint32_t block = remaining < kBlockSize ? remaining : kBlockSize;
    for (std::uint32_t frame = 0u; frame < block; ++frame) {
      const float sample = (processed + frame) % 2u == 0u ? 0.25F : -0.25F;
      audio[frame] = sample;
      audio[block + frame] = -sample;
    }
    const std::vector<float> original(audio.begin(), audio.begin() + block * 2u);
    harness.process(audio.data(), 2u, block, static_cast<double>(processed) / 48000.0);
    SPECTRUM_CHECK(std::memcmp(audio.data(), original.data(), sizeof(float) * block * 2u) == 0);
    processed += block;
  }

  harness.telemetryTick();
  SPECTRUM_CHECK(harness.read() == 65548u);
  checkFrameHeader(harness.output.data(), 99u, 0u, kPayloadBytes);
  const std::uint8_t *payload = harness.output.data() + 16u;
  SPECTRUM_CHECK(readF32(payload) == 48000.0F);
  SPECTRUM_CHECK(readU32(payload + 4u) == 8190u);
  SPECTRUM_CHECK(readU16(payload + 8u) == 14u);
  SPECTRUM_CHECK(readU16(payload + 10u) == 1u);
  SPECTRUM_CHECK(std::isfinite(readF32(payload + 12u + 8189u * 4u)));
  SPECTRUM_CHECK(std::isfinite(readF32(payload + 12u + 8190u * 4u + 8189u * 4u)));
}

void testFixedAndMixedBlockPayloadDeterminism() {
  const std::vector<std::uint8_t> reference = renderPayload({1u});
  SPECTRUM_CHECK(!reference.empty());
  constexpr std::array<std::uint32_t, 7> kFixedFrames = {1u, 7u, 16u, 32u, 64u, 128u, 129u};
  for (const std::uint32_t frames : kFixedFrames) {
    SPECTRUM_CHECK(renderPayload({frames}) == reference);
  }
  SPECTRUM_CHECK(renderPayload({1u, 7u, 16u, 32u, 64u, 128u, 129u}) == reference);
}

void testResetAndPointChangeCancelActiveJobs() {
  constexpr float kSampleRate = 48000.0F;
  constexpr std::uint32_t kFirstFrameCompletion = 1856u;
  const std::vector<std::uint32_t> mixed_blocks = {129u, 7u, 64u, 16u};
  const std::vector<std::uint8_t> reference = renderPayload(mixed_blocks);

  KernelHarness reset_harness(kSampleRate, 129u);
  reset_harness.setParams(-96.0F, 8.0F);
  processSamples(reset_harness, kSampleRate, 400u, {129u},
                 [](std::uint32_t frame) { return frame % 3u == 0u ? 0.25F : -0.125F; });
  reset_harness.reset();
  processSamples(reset_harness, kSampleRate, kFirstFrameCompletion, mixed_blocks,
                 [](std::uint32_t frame) {
                   return static_cast<float>(0.4 * std::sin(2.0 * kPi * 750.0 * frame / 48000.0));
                 });
  SPECTRUM_CHECK(takePayload(reset_harness) == reference);

  KernelHarness points_harness(kSampleRate, 129u);
  points_harness.setParams(-144.0F, 14.0F);
  processSamples(points_harness, kSampleRate, (1u << 13u) + 32u, {129u, 16u},
                 [](std::uint32_t frame) { return frame % 2u == 0u ? 0.3F : -0.2F; });
  points_harness.setParams(-96.0F, 8.0F);
  processSamples(points_harness, kSampleRate, kFirstFrameCompletion, mixed_blocks,
                 [](std::uint32_t frame) {
                   return static_cast<float>(0.4 * std::sin(2.0 * kPi * 750.0 * frame / 48000.0));
                 });
  SPECTRUM_CHECK(takePayload(points_harness) == reference);
}

void testPreparedTwiddleTablesAcrossPointChangesAndReset() {
  constexpr float kSampleRate = 192000.0F;
  const std::vector<std::uint32_t> mixed_blocks = {1u, 7u, 16u, 32u, 64u, 128u, 129u};
  KernelHarness harness(kSampleRate, 129u);

  for (std::uint32_t points = 8u; points <= 14u; ++points) {
    const std::vector<std::uint8_t> payload = renderPointPayload(harness, points, mixed_blocks);
    const std::uint32_t source_bin_count = (1u << (points - 1u)) + 1u;
    const std::uint32_t expected_bin_count = points == 14u ? 8190u : source_bin_count;
    SPECTRUM_CHECK(payload.size() == 12u + expected_bin_count * 8u);
    if (payload.size() == 12u + expected_bin_count * 8u) {
      SPECTRUM_CHECK(readF32(payload.data()) == kSampleRate);
      SPECTRUM_CHECK(readU32(payload.data() + 4u) == expected_bin_count);
      SPECTRUM_CHECK(readU16(payload.data() + 8u) == points);
    }

    harness.reset();
    SPECTRUM_CHECK(renderPointPayload(harness, points, mixed_blocks) == payload);
  }
}

void testPublishedPayloadRemainsCoherentDuringStaging() {
  constexpr float kSampleRate = 48000.0F;
  constexpr std::uint32_t kFftSize = 256u;
  constexpr std::uint32_t kAnalysisInterval = 1600u;
  auto prepare_first_frame = [=](KernelHarness &target) {
    processSamples(target, kSampleRate, kFftSize, {64u}, [](std::uint32_t frame) {
      return static_cast<float>(0.4 * std::sin(2.0 * kPi * 750.0 * frame / 48000.0));
    });
    processSamples(target, kSampleRate, kAnalysisInterval, {64u},
                   [](std::uint32_t) { return 0.0F; });
  };

  KernelHarness reference_harness(kSampleRate, 64u);
  reference_harness.setParams(-96.0F, 8.0F);
  prepare_first_frame(reference_harness);
  const std::vector<std::uint8_t> reference = takePayload(reference_harness);

  KernelHarness harness(kSampleRate, 64u);
  harness.setParams(-96.0F, 8.0F);
  prepare_first_frame(harness);
  processSamples(harness, kSampleRate, 800u, {16u}, [](std::uint32_t) { return 0.0F; });
  const std::vector<std::uint8_t> published_during_staging = takePayload(harness);
  SPECTRUM_CHECK(published_during_staging == reference);

  processSamples(harness, kSampleRate, 800u, {32u}, [](std::uint32_t) { return 0.0F; });
  const std::vector<std::uint8_t> second = takePayload(harness);
  SPECTRUM_CHECK(!second.empty());
  SPECTRUM_CHECK(second != published_during_staging);
}

void testLatencyIsUnchanged() {
  KernelHarness harness(192000.0F, 16u);
  SPECTRUM_CHECK(harness.kernel != nullptr && harness.kernel->latencySamples() == 0u);
}

} // namespace

int main() {
  testPffftRoundTripAndKnownBin();
  testKnownOneKilohertzFrameAndVariableBlocks();
  testMaximumPointPayloadContract();
  testFixedAndMixedBlockPayloadDeterminism();
  testResetAndPointChangeCancelActiveJobs();
  testPreparedTwiddleTablesAcrossPointChangesAndReset();
  testPublishedPayloadRemainsCoherentDuringStaging();
  testLatencyIsUnchanged();
  if (failures != 0) {
    std::fprintf(stderr, "%d Spectrum Analyzer native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Spectrum Analyzer native tests passed");
  return 0;
}
