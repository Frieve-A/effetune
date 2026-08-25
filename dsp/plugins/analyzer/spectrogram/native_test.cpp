#include "effetune/kernel.h"

#include "pffft.h"

#include <algorithm>
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

  void reset() noexcept { kernel->reset(); }
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

std::vector<std::uint8_t> takeTelemetry(KernelHarness &harness) {
  harness.telemetryTick();
  const std::uint32_t bytes = harness.read();
  return {harness.output.begin(), harness.output.begin() + bytes};
}

void processGenerated(KernelHarness &harness, float sample_rate, std::uint32_t total_samples,
                      const std::vector<std::uint32_t> &blocks, double time_origin = 0.0) {
  const std::uint32_t maximum_block = *std::max_element(blocks.begin(), blocks.end());
  std::vector<float> audio(2u * maximum_block);
  std::uint32_t processed = 0u;
  std::uint32_t block_index = 0u;
  while (processed < total_samples) {
    const std::uint32_t requested = blocks[block_index % blocks.size()];
    const std::uint32_t remaining = total_samples - processed;
    const std::uint32_t block = requested < remaining ? requested : remaining;
    for (std::uint32_t frame = 0u; frame < block; ++frame) {
      const double phase = 2.0 * kPi * 1000.0 * static_cast<double>(processed + frame) /
                           static_cast<double>(sample_rate);
      const float sample = static_cast<float>(0.75 * std::sin(phase));
      audio[frame] = sample;
      audio[block + frame] = sample * 0.5F;
    }
    const std::vector<float> original(audio.begin(), audio.begin() + 2u * block);
    harness.process(audio.data(), 2u, block,
                    time_origin + static_cast<double>(processed) / sample_rate);
    SPECTROGRAM_CHECK(std::memcmp(audio.data(), original.data(), sizeof(float) * 2u * block) == 0);
    processed += block;
    ++block_index;
  }
}

std::vector<std::uint8_t> renderPayload(float sample_rate, const std::vector<std::uint32_t> &blocks,
                                        std::uint32_t total_samples = 1024u,
                                        double time_origin = 0.0) {
  const std::uint32_t maximum_block = *std::max_element(blocks.begin(), blocks.end());
  KernelHarness harness(sample_rate, maximum_block);
  harness.setParams(-96.0F, 8.0F);
  processGenerated(harness, sample_rate, total_samples, blocks, time_origin);
  return takeTelemetry(harness);
}

std::vector<std::uint8_t> renderPointColumn(KernelHarness &harness, std::uint32_t points,
                                            const std::vector<std::uint32_t> &blocks) {
  constexpr float kSampleRate = 192000.0F;
  harness.setParams(-144.0F, static_cast<float>(points));
  processGenerated(harness, kSampleRate, 1u << points, blocks);
  const std::vector<std::uint8_t> telemetry = takeTelemetry(harness);
  if (telemetry.size() != kFrameBytes) {
    return telemetry;
  }
  return {telemetry.begin() + 16u, telemetry.end()};
}

std::array<std::uint8_t, 256u> legacySineColumn(std::uint32_t points, float sample_rate,
                                                float db_range, double amplitude) {
  constexpr double kPowerFloor = 1.0e-24;
  constexpr double kCorrectionAcDb = 12.041199826559248;
  constexpr double kCorrectionDcDb = 6.020599913279624;
  constexpr double kMinimumLevelDb = -144.0;
  constexpr double kMinimumFrequency = 20.0;
  constexpr double kLogMinimumFrequency = 1.3010299956639811952;
  constexpr double kLogMaximumFrequency = 4.6020599913279623904;
  const std::uint32_t fft_size = 1u << points;
  const std::uint32_t bin_count = fft_size / 2u;

  std::array<std::uint8_t, 256u> column{};
  PFFFT_Setup *setup = pffft_new_setup(static_cast<int>(fft_size), PFFFT_REAL);
  float *input = static_cast<float *>(pffft_aligned_malloc(sizeof(float) * fft_size));
  float *output = static_cast<float *>(pffft_aligned_malloc(sizeof(float) * fft_size));
  float *work = static_cast<float *>(pffft_aligned_malloc(sizeof(float) * fft_size));
  SPECTROGRAM_CHECK(setup != nullptr && input != nullptr && output != nullptr && work != nullptr);
  if (setup == nullptr || input == nullptr || output == nullptr || work == nullptr) {
    if (setup != nullptr) {
      pffft_destroy_setup(setup);
    }
    if (input != nullptr) {
      pffft_aligned_free(input);
    }
    if (output != nullptr) {
      pffft_aligned_free(output);
    }
    if (work != nullptr) {
      pffft_aligned_free(work);
    }
    return column;
  }

  const double window_factor = 2.0 * kPi / static_cast<double>(fft_size);
  for (std::uint32_t index = 0u; index < fft_size; ++index) {
    const double sample =
        amplitude * std::sin(2.0 * kPi * 1000.0 * static_cast<double>(index) / sample_rate);
    const double window = 0.5 * (1.0 - std::cos(window_factor * static_cast<double>(index)));
    input[index] = static_cast<float>(sample * window);
  }
  pffft_transform_ordered(setup, input, output, work, PFFFT_FORWARD);

  std::vector<float> levels(bin_count);
  const double normalization_db = -20.0 * std::log10(static_cast<double>(fft_size));
  for (std::uint32_t bin = 0u; bin < bin_count; ++bin) {
    const std::uint32_t real_index = bin == 0u ? 0u : bin * 2u;
    const double real = static_cast<double>(output[real_index]);
    const double imaginary = bin == 0u ? 0.0 : static_cast<double>(output[bin * 2u + 1u]);
    const double power = real * real + imaginary * imaginary;
    const double correction = bin == 0u ? kCorrectionDcDb : kCorrectionAcDb;
    double level = 10.0 * std::log10(power + kPowerFloor) + correction + normalization_db;
    if (level < kMinimumLevelDb) {
      level = kMinimumLevelDb;
    }
    levels[bin] = static_cast<float>(level);
  }

  const double log_range = kLogMaximumFrequency - kLogMinimumFrequency;
  const double nyquist = static_cast<double>(sample_rate) * 0.5;
  for (std::uint32_t y = 0u; y < column.size(); ++y) {
    const double frequency = std::pow(
        10.0, kLogMaximumFrequency -
                  static_cast<double>(y) / static_cast<double>(column.size() - 1u) * log_range);
    double level = kMinimumLevelDb;
    if (frequency >= kMinimumFrequency && frequency <= nyquist) {
      const double bin_position =
          frequency * static_cast<double>(fft_size) / static_cast<double>(sample_rate);
      const std::uint32_t bin1 = static_cast<std::uint32_t>(std::floor(bin_position));
      if (bin1 < bin_count) {
        const std::uint32_t bin2 = bin1 + 1u < bin_count ? bin1 + 1u : bin1;
        const double fraction = bin_position - static_cast<double>(bin1);
        level = static_cast<double>(levels[bin1]) +
                (static_cast<double>(levels[bin2]) - static_cast<double>(levels[bin1])) * fraction;
      }
    }
    double normalized = (level - static_cast<double>(db_range)) / -static_cast<double>(db_range);
    if (normalized < 0.0) {
      normalized = 0.0;
    } else if (normalized > 1.0) {
      normalized = 1.0;
    }
    column[y] = static_cast<std::uint8_t>(normalized * 255.0 + 0.5);
  }

  pffft_destroy_setup(setup);
  pffft_aligned_free(input);
  pffft_aligned_free(output);
  pffft_aligned_free(work);
  return column;
}

void testKnownToneLogMappingAndVariableBlocks() {
  constexpr float kSampleRate = 32000.0F;
  constexpr std::uint32_t kFftSize = 256u;
  constexpr std::array<std::uint32_t, 4> kBlocks = {97u, 83u, 76u, 128u};
  KernelHarness harness(kSampleRate, 128u);
  harness.tap_id = 0x2345u;
  harness.setParams(-96.0F, 8.0F);

  std::vector<float> audio(2u * 128u);
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
  SPECTROGRAM_CHECK(processed == kFftSize + kFftSize / 2u);

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

  const std::array<std::uint8_t, 256u> legacy_column =
      legacySineColumn(8u, kSampleRate, -96.0F, 1.0);
  for (std::uint32_t row = 0u; row < legacy_column.size(); ++row) {
    const int difference =
        static_cast<int>(second[12u + row]) - static_cast<int>(legacy_column[row]);
    SPECTROGRAM_CHECK(difference >= -1 && difference <= 1);
  }

  harness.telemetryTick();
  SPECTROGRAM_CHECK(harness.read() == 0u);
}

void testOneFramePerHopAndPointBounds() {
  constexpr std::uint32_t kPublishedPointEightFrames = 8u;
  constexpr std::uint32_t kPointEightSamples = (kPublishedPointEightFrames + 1u) * (1u << 7u);
  KernelHarness harness(48000.0F, kPointEightSamples);
  harness.tap_id = 91u;
  harness.setParams(-144.0F, 7.0F);
  std::vector<float> audio(4u * kPointEightSamples);
  for (std::uint32_t frame = 0u; frame < kPointEightSamples; ++frame) {
    audio[frame] = 0.1F;
    audio[kPointEightSamples + frame] = -0.2F;
    audio[2u * kPointEightSamples + frame] = 0.3F;
    audio[3u * kPointEightSamples + frame] = -0.4F;
  }
  const std::vector<float> original = audio;
  harness.process(audio.data(), 4u, kPointEightSamples, 4.0);
  SPECTROGRAM_CHECK(std::memcmp(audio.data(), original.data(), sizeof(float) * audio.size()) == 0);
  harness.telemetryTick();
  SPECTROGRAM_CHECK(harness.read() == kPublishedPointEightFrames * kFrameBytes);
  for (std::uint32_t index = 0u; index < kPublishedPointEightFrames; ++index) {
    checkFrameHeader(frameAt(harness, index), 91u, index);
    const std::uint8_t *payload = payloadAt(harness, index);
    SPECTROGRAM_CHECK(readU16(payload + 8u) == 256u);
    SPECTROGRAM_CHECK(readU16(payload + 10u) == 8u);
    const float expected_time = 4.0F + static_cast<float>((index + 1u) * 128u) / 48000.0F;
    SPECTROGRAM_CHECK(near(readF32(payload + 4u), expected_time, 5.0e-7F));
  }

  harness.setParams(-48.0F, 15.0F);
  std::vector<float> maximum_audio(1u << 14u);
  harness.process(maximum_audio.data(), 1u, 1u << 14u, 8.0);
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
  std::vector<float> audio(384u);

  harness.process(audio.data(), 1u, 384u, kFloatIntegerBoundary);
  harness.telemetryTick();
  SPECTROGRAM_CHECK(harness.read() == 2u * kFrameBytes);
  const float first = readF32(payloadAt(harness, 0u) + 4u);
  const float second = readF32(payloadAt(harness, 1u) + 4u);
  SPECTROGRAM_CHECK(first == 16777216.0F);
  SPECTROGRAM_CHECK(second == first);

  harness.reset();
  harness.process(audio.data(), 1u, 256u, kFloatIntegerBoundary + 2.0);
  harness.telemetryTick();
  SPECTROGRAM_CHECK(harness.read() == kFrameBytes);
  const float later = readF32(payloadAt(harness, 0u) + 4u);
  SPECTROGRAM_CHECK(later == 16777218.0F);
  SPECTROGRAM_CHECK(later > second);
}

void testFixedAndMixedBlockPayloadsAreExact() {
  constexpr float kSampleRate = 32768.0F;
  const std::vector<std::uint8_t> reference = renderPayload(kSampleRate, {16u});
  SPECTROGRAM_CHECK(!reference.empty());
  for (const std::uint32_t frames : {1u, 7u, 16u, 32u, 64u, 128u, 129u}) {
    SPECTROGRAM_CHECK(renderPayload(kSampleRate, {frames}) == reference);
  }
  SPECTROGRAM_CHECK(renderPayload(kSampleRate, {1u, 7u, 16u, 32u, 64u, 128u, 129u}) == reference);
}

void testMaximumFftPayloadMatchesLegacyWithinOneLsb() {
  constexpr float kSampleRate = 192000.0F;
  constexpr std::uint32_t kFftSize = 1u << 14u;
  KernelHarness harness(kSampleRate, 129u);
  harness.setParams(-144.0F, 14.0F);
  processGenerated(harness, kSampleRate, kFftSize + kFftSize / 2u,
                   {1u, 7u, 16u, 32u, 64u, 128u, 129u});
  const std::vector<std::uint8_t> frames = takeTelemetry(harness);
  SPECTROGRAM_CHECK(frames.size() == 2u * kFrameBytes);
  if (frames.size() != 2u * kFrameBytes) {
    return;
  }

  const std::uint8_t *payload = frames.data() + kFrameBytes + 16u;
  SPECTROGRAM_CHECK(readF32(payload) == kSampleRate);
  SPECTROGRAM_CHECK(
      near(readF32(payload + 4u), static_cast<float>(kFftSize) / kSampleRate, 1.0e-7F));
  SPECTROGRAM_CHECK(readU16(payload + 8u) == 256u);
  SPECTROGRAM_CHECK(readU16(payload + 10u) == 14u);
  const std::array<std::uint8_t, 256u> legacy_column =
      legacySineColumn(14u, kSampleRate, -144.0F, 0.5625);
  for (std::uint32_t row = 0u; row < legacy_column.size(); ++row) {
    const int difference =
        static_cast<int>(payload[12u + row]) - static_cast<int>(legacy_column[row]);
    SPECTROGRAM_CHECK(difference >= -1 && difference <= 1);
  }
}

void testIncompleteColumnIsNeverPublished() {
  constexpr float kSampleRate = 48000.0F;
  KernelHarness harness(kSampleRate, 128u);
  harness.setParams(-96.0F, 8.0F);
  std::vector<float> audio(2u * 128u);

  harness.process(audio.data(), 2u, 128u, 0.0);
  SPECTROGRAM_CHECK(takeTelemetry(harness).empty());
  harness.process(audio.data(), 2u, 127u, 128.0 / kSampleRate);
  SPECTROGRAM_CHECK(takeTelemetry(harness).empty());
  harness.process(audio.data(), 2u, 1u, 255.0 / kSampleRate);
  const std::vector<std::uint8_t> published = takeTelemetry(harness);
  SPECTROGRAM_CHECK(published.size() == kFrameBytes);
  if (published.size() == kFrameBytes) {
    const std::uint8_t *payload = published.data() + 16u;
    SPECTROGRAM_CHECK(near(readF32(payload + 4u), 128.0F / kSampleRate, 1.0e-7F));
    SPECTROGRAM_CHECK(readU16(payload + 10u) == 8u);
  }
}

void testPublishedColumnRingKeepsNewestCompleteColumns() {
  constexpr float kSampleRate = 32768.0F;
  constexpr std::uint32_t kHop = 128u;
  constexpr std::uint32_t kPublishedColumns = 129u;
  KernelHarness harness(kSampleRate, 129u);
  harness.setParams(-96.0F, 8.0F);
  processGenerated(harness, kSampleRate, (kPublishedColumns + 1u) * kHop, {129u, 16u});
  const std::vector<std::uint8_t> frames = takeTelemetry(harness);
  SPECTROGRAM_CHECK(frames.size() == 128u * kFrameBytes);
  if (frames.size() != 128u * kFrameBytes) {
    return;
  }
  const std::uint8_t *first = frames.data() + 16u;
  const std::uint8_t *last = frames.data() + 127u * kFrameBytes + 16u;
  SPECTROGRAM_CHECK(near(readF32(first + 4u), 2.0F * kHop / kSampleRate, 1.0e-7F));
  SPECTROGRAM_CHECK(near(readF32(last + 4u),
                         static_cast<float>(kPublishedColumns) * kHop / kSampleRate, 1.0e-7F));
}

void testResetAndPointChangeCancelActiveJobs() {
  constexpr float kSampleRate = 32768.0F;
  constexpr double kNewTimelineOrigin = 8208.0 / kSampleRate;
  const std::vector<std::uint8_t> reset_reference = renderPayload(kSampleRate, {129u, 7u}, 384u);

  KernelHarness reset_harness(kSampleRate, 129u);
  reset_harness.setParams(-96.0F, 8.0F);
  processGenerated(reset_harness, kSampleRate, 160u, {129u, 7u});
  SPECTROGRAM_CHECK(takeTelemetry(reset_harness).empty());
  reset_harness.reset();
  processGenerated(reset_harness, kSampleRate, 384u, {129u, 7u});
  SPECTROGRAM_CHECK(takeTelemetry(reset_harness) == reset_reference);

  KernelHarness points_harness(kSampleRate, 129u);
  points_harness.setParams(-144.0F, 14.0F);
  processGenerated(points_harness, kSampleRate, 8208u, {129u, 16u});
  SPECTROGRAM_CHECK(takeTelemetry(points_harness).empty());
  points_harness.setParams(-96.0F, 8.0F);
  processGenerated(points_harness, kSampleRate, 384u, {129u, 7u}, kNewTimelineOrigin);
  const std::vector<std::uint8_t> changed = takeTelemetry(points_harness);
  const std::vector<std::uint8_t> changed_reference =
      renderPayload(kSampleRate, {129u, 7u}, 384u, kNewTimelineOrigin);
  SPECTROGRAM_CHECK(changed == changed_reference);
  for (std::size_t offset = 0u; offset < changed.size(); offset += kFrameBytes) {
    SPECTROGRAM_CHECK(readU16(changed.data() + offset + 16u + 10u) == 8u);
  }
}

void testPreparedTwiddleTablesAcrossPointChangesAndReset() {
  constexpr float kSampleRate = 192000.0F;
  const std::vector<std::uint32_t> mixed_blocks = {1u, 7u, 16u, 32u, 64u, 128u, 129u};
  KernelHarness harness(kSampleRate, 129u);

  for (std::uint32_t points = 8u; points <= 14u; ++points) {
    const std::vector<std::uint8_t> column = renderPointColumn(harness, points, mixed_blocks);
    SPECTROGRAM_CHECK(column.size() == kPayloadBytes);
    if (column.size() == kPayloadBytes) {
      SPECTROGRAM_CHECK(readF32(column.data()) == kSampleRate);
      SPECTROGRAM_CHECK(readU16(column.data() + 10u) == points);
    }

    harness.reset();
    SPECTROGRAM_CHECK(renderPointColumn(harness, points, mixed_blocks) == column);
  }
}

void testLatencyRemainsZero() {
  KernelHarness harness(192000.0F, 16u);
  SPECTROGRAM_CHECK(harness.kernel != nullptr && harness.kernel->latencySamples() == 0u);
}

} // namespace

int main() {
  testKnownToneLogMappingAndVariableBlocks();
  testOneFramePerHopAndPointBounds();
  testFloatTimestampPrecisionBoundary();
  testFixedAndMixedBlockPayloadsAreExact();
  testMaximumFftPayloadMatchesLegacyWithinOneLsb();
  testIncompleteColumnIsNeverPublished();
  testPublishedColumnRingKeepsNewestCompleteColumns();
  testResetAndPointChangeCancelActiveJobs();
  testPreparedTwiddleTablesAcrossPointChangesAndReset();
  testLatencyRemainsZero();
  if (failures != 0) {
    std::fprintf(stderr, "%d Spectrogram native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Spectrogram native tests passed");
  return 0;
}
