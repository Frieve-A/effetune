#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
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
constexpr std::uint32_t kEnvelopeBinCount = 360u;
constexpr long double kRadiansToDegrees = 57.295779513082320876798154814105L;
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

std::uint32_t floatBits(float value) noexcept {
  std::uint32_t bits = 0u;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&bits, &value, sizeof(bits));
  return bits;
}

bool near(float actual, float expected, float tolerance = 1.0e-5F) noexcept {
  const float difference = actual - expected;
  const float absolute = difference < 0.0F ? -difference : difference;
  return absolute <= tolerance;
}

float envelopeDecayFactor(double seconds) noexcept {
  return static_cast<float>(std::pow(10.0, -seconds));
}

struct EnvelopeOracle {
  explicit EnvelopeOracle(float sample_rate)
      : decay(std::pow(10.0L, -1.0L / static_cast<long double>(sample_rate))) {}

  void process(float input_left, float input_right) noexcept {
    for (long double &peak : peaks) {
      peak *= decay;
    }

    const float left = std::isfinite(input_left) ? input_left : 0.0F;
    const float right = std::isfinite(input_right) ? input_right : 0.0F;
    const long double x = static_cast<long double>(right) - static_cast<long double>(left);
    const long double y = static_cast<long double>(left) + static_cast<long double>(right);
    const long double angle = -std::atan2(y, x) * kRadiansToDegrees;
    int angle_index =
        static_cast<int>(std::floor(angle + 0.5L)) % static_cast<int>(kEnvelopeBinCount);
    if (angle_index < 0) {
      angle_index += static_cast<int>(kEnvelopeBinCount);
    }
    long double magnitude = std::sqrt(x * x + y * y);
    const long double maximum_float = static_cast<long double>(std::numeric_limits<float>::max());
    if (!std::isfinite(magnitude) || magnitude > maximum_float) {
      magnitude = maximum_float;
    }
    long double &peak = peaks[static_cast<std::uint32_t>(angle_index)];
    if (magnitude > peak) {
      peak = magnitude;
    }
  }

  void reset() noexcept { peaks.fill(0.0L); }

  std::array<long double, kEnvelopeBinCount> peaks{};
  long double decay = 1.0L;
};

struct KernelHarness {
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> object_storage{};
  float sample_rate = 0.0F;
  std::vector<std::uint8_t> ring_storage;
  std::vector<std::uint8_t> output;
  const effetune::KernelDescriptor *descriptor = nullptr;
  effetune::PluginKernel *kernel = nullptr;
  effetune::TelemetryRing ring;
  std::uint32_t tap_id = 0u;
  std::uint32_t sequence = 0u;

  KernelHarness(float requested_sample_rate, std::uint32_t max_frames)
      : sample_rate(requested_sample_rate), ring_storage(kTelemetryBytes), output(kTelemetryBytes) {
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
      STEREO_CHECK(kernel->latencySamples() == 0u);
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

  void reset() noexcept { kernel->reset(); }

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
  STEREO_CHECK(readF32(data) == harness.sample_rate);
  STEREO_CHECK(readU16(data + 4u) == sample_count);
  STEREO_CHECK(readU16(data + 6u) == sample_flags);
}

void checkEnvelope(const KernelHarness &harness, std::uint32_t sample_count,
                   const EnvelopeOracle &oracle) noexcept {
  const std::uint8_t *envelope = payload(harness) + envelopeOffset(sample_count);
  for (std::uint32_t bin = 0u; bin < kEnvelopeBinCount; ++bin) {
    const float actual = readF32(envelope + bin * 4u);
    const float expected = static_cast<float>(oracle.peaks[bin]);
    if (expected == 0.0F) {
      STEREO_CHECK(floatBits(actual) == 0u);
      continue;
    }
    const std::uint32_t actual_bits = floatBits(actual);
    const std::uint32_t expected_bits = floatBits(expected);
    const std::uint32_t distance =
        actual_bits > expected_bits ? actual_bits - expected_bits : expected_bits - actual_bits;
    STEREO_CHECK(std::isfinite(actual));
    STEREO_CHECK(distance <= 1u);
  }
}

template <std::size_t BlockCount>
void processPlanarInBlocks(KernelHarness &harness, const std::vector<float> &source,
                           std::uint32_t total_frames,
                           const std::array<std::uint32_t, BlockCount> &blocks) {
  std::uint32_t processed = 0u;
  std::uint32_t block_index = 0u;
  while (processed < total_frames) {
    const std::uint32_t requested = blocks[block_index++ % blocks.size()];
    const std::uint32_t frames =
        total_frames - processed < requested ? total_frames - processed : requested;
    std::vector<float> chunk(frames * 2u);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      chunk[frame] = source[processed + frame];
      chunk[frames + frame] = source[total_frames + processed + frame];
    }
    harness.process(chunk.data(), 2u, frames, static_cast<double>(processed) * 0.001);
    processed += frames;
  }
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
  STEREO_CHECK(near(readF32(data + envelope + 180u * 4u), 2.0F * envelopeDecayFactor(0.001)));
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
  STEREO_CHECK(near(readF32(data + envelope + 270u * 4u), 4.0F * envelopeDecayFactor(0.01)));
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

  std::array<float, 8> silence{};
  harness.process(silence.data(), 1u, static_cast<std::uint32_t>(silence.size()), 4.1);
  emitFrame(harness, static_cast<std::uint32_t>(silence.size()));
  checkFrame(harness, 1u, static_cast<std::uint32_t>(silence.size()));
  STEREO_CHECK(near(readF32(payload(harness) +
                            envelopeOffset(static_cast<std::uint32_t>(silence.size())) + 270u * 4u),
                    envelopeDecayFactor(0.008), 2.0e-6F));
}

void testEnvelopeDecayIsSampleAccurateAndPhaseIndependent() {
  KernelHarness unshifted(1000.0F, 23u);
  KernelHarness shifted(1000.0F, 16u);
  unshifted.tap_id = 68u;
  shifted.tap_id = 68u;
  unshifted.setWindow(0.01F);
  shifted.setWindow(0.01F);

  float tone = 0.5F;
  std::array<float, 23> silence{};
  unshifted.process(&tone, 1u, 1u, 0.0);
  unshifted.process(silence.data(), 1u, static_cast<std::uint32_t>(silence.size()), 0.0);

  std::array<float, 5> phase_shift{};
  shifted.process(phase_shift.data(), 1u, static_cast<std::uint32_t>(phase_shift.size()), 0.0);
  shifted.process(&tone, 1u, 1u, 0.0);
  shifted.process(silence.data(), 1u, 7u, 0.0);
  shifted.process(silence.data() + 7u, 1u, 16u, 0.0);

  emitFrame(unshifted, 24u);
  emitFrame(shifted, 29u);
  const float expected = envelopeDecayFactor(0.023);
  const float unshifted_peak = readF32(payload(unshifted) + envelopeOffset(24u) + 270u * 4u);
  const float shifted_peak = readF32(payload(shifted) + envelopeOffset(29u) + 270u * 4u);
  STEREO_CHECK(near(unshifted_peak, expected, 2.0e-6F));
  STEREO_CHECK(near(shifted_peak, expected, 2.0e-6F));
  STEREO_CHECK(unshifted_peak == shifted_peak);

  KernelHarness replacement(1000.0F, 100u);
  replacement.tap_id = 69u;
  replacement.setWindow(0.01F);
  replacement.process(&tone, 1u, 1u, 0.0);
  std::array<float, 100> longer_silence{};
  replacement.process(longer_silence.data(), 1u, static_cast<std::uint32_t>(longer_silence.size()),
                      0.0);
  float smaller_tone = 0.45F;
  replacement.process(&smaller_tone, 1u, 1u, 0.0);
  emitFrame(replacement, 102u);
  STEREO_CHECK(near(readF32(payload(replacement) + envelopeOffset(102u) + 270u * 4u), 0.9F));

  KernelHarness renormalized(1.0F, 101u);
  renormalized.tap_id = 72u;
  renormalized.process(&tone, 1u, 1u, 0.0);
  std::array<float, 101> renormalize_silence{};
  renormalized.process(renormalize_silence.data(), 1u,
                       static_cast<std::uint32_t>(renormalize_silence.size()), 0.0);
  renormalized.process(&smaller_tone, 1u, 1u, 0.0);
  emitFrame(renormalized, 1u);
  STEREO_CHECK(near(readF32(payload(renormalized) + envelopeOffset(1u) + 270u * 4u), 0.9F));
}

void testEnvelopeOracleAndFramePartitionPayloads() {
  constexpr std::uint32_t kTotalFrames = 1025u;
  std::vector<float> source(kTotalFrames * 2u);
  EnvelopeOracle oracle(48000.0F);
  for (std::uint32_t frame = 0u; frame < kTotalFrames; ++frame) {
    const float left = static_cast<float>(static_cast<int>((frame * 17u) % 101u) - 50) * 0.0078125F;
    const float right =
        static_cast<float>(static_cast<int>((frame * 29u) % 97u) - 48) * 0.009765625F;
    source[frame] = left;
    source[kTotalFrames + frame] = right;
    oracle.process(left, right);
  }

  const auto render = [&](const auto &blocks) {
    KernelHarness harness(48000.0F, 129u);
    harness.tap_id = 73u;
    harness.setWindow(0.01F);
    processPlanarInBlocks(harness, source, kTotalFrames, blocks);
    emitFrame(harness, kTotalFrames);
    checkFrame(harness, 0u, kTotalFrames);
    checkEnvelope(harness, kTotalFrames, oracle);
    return std::vector<std::uint8_t>(payload(harness),
                                     payload(harness) + payloadBytes(kTotalFrames));
  };

  const std::vector<std::uint8_t> expected = render(std::array<std::uint32_t, 1>{1u});
  STEREO_CHECK(render(std::array<std::uint32_t, 1>{7u}) == expected);
  STEREO_CHECK(render(std::array<std::uint32_t, 1>{16u}) == expected);
  STEREO_CHECK(render(std::array<std::uint32_t, 1>{32u}) == expected);
  STEREO_CHECK(render(std::array<std::uint32_t, 1>{64u}) == expected);
  STEREO_CHECK(render(std::array<std::uint32_t, 1>{128u}) == expected);
  STEREO_CHECK(render(std::array<std::uint32_t, 1>{129u}) == expected);
  STEREO_CHECK(render(std::array<std::uint32_t, 7>{1u, 7u, 16u, 32u, 64u, 128u, 129u}) == expected);
}

void testEnvelopeOracleAcrossRenormalizationAndPeakReplacement() {
  KernelHarness harness(10.0F, 997u);
  harness.tap_id = 74u;
  EnvelopeOracle oracle(10.0F);

  float first_peak = 0.5F;
  harness.process(&first_peak, 1u, 1u, 0.0);
  oracle.process(first_peak, first_peak);
  std::array<float, 997> silence{};
  harness.process(silence.data(), 1u, static_cast<std::uint32_t>(silence.size()), 0.0);
  for (const float sample : silence) {
    oracle.process(sample, sample);
  }
  float replacement_before_boundary = 0.25F;
  harness.process(&replacement_before_boundary, 1u, 1u, 0.0);
  oracle.process(replacement_before_boundary, replacement_before_boundary);
  emitFrame(harness, 10u);
  checkEnvelope(harness, 10u, oracle);

  float silent_sample = 0.0F;
  harness.process(&silent_sample, 1u, 1u, 0.0);
  oracle.process(silent_sample, silent_sample);
  emitFrame(harness, 1u);
  checkEnvelope(harness, 1u, oracle);

  float replacement_after_boundary = 0.375F;
  harness.process(&replacement_after_boundary, 1u, 1u, 0.0);
  oracle.process(replacement_after_boundary, replacement_after_boundary);
  emitFrame(harness, 1u);
  checkEnvelope(harness, 1u, oracle);
  STEREO_CHECK(readF32(payload(harness) + envelopeOffset(1u) + 270u * 4u) == 0.75F);
}

void testNonFiniteSanitizationAndEnvelopeClamp() {
  KernelHarness harness(1000.0F, 4u);
  harness.tap_id = 75u;
  EnvelopeOracle oracle(1000.0F);
  const float infinity = std::numeric_limits<float>::infinity();
  const float quiet_nan = std::numeric_limits<float>::quiet_NaN();
  const float maximum = std::numeric_limits<float>::max();
  std::array<float, 8> audio = {quiet_nan, infinity,  -infinity, maximum,
                                infinity,  -infinity, quiet_nan, maximum};
  for (std::uint32_t frame = 0u; frame < 4u; ++frame) {
    oracle.process(audio[frame], audio[4u + frame]);
  }
  harness.process(audio.data(), 2u, 4u, 0.0);
  emitFrame(harness, 4u);
  checkFrame(harness, 0u, 4u);
  checkEnvelope(harness, 4u, oracle);

  const std::uint8_t *data = payload(harness);
  for (std::uint32_t frame = 0u; frame < 3u; ++frame) {
    STEREO_CHECK(floatBits(readF32(data + kPayloadHeaderBytes + frame * kSampleBytes)) == 0u);
    STEREO_CHECK(floatBits(readF32(data + kPayloadHeaderBytes + frame * kSampleBytes + 4u)) == 0u);
  }
  STEREO_CHECK(floatBits(readF32(data + kPayloadHeaderBytes + 3u * kSampleBytes)) == 0u);
  STEREO_CHECK(readF32(data + kPayloadHeaderBytes + 3u * kSampleBytes + 4u) == maximum);
  STEREO_CHECK(readF32(data + envelopeOffset(4u) + 270u * 4u) == maximum);
}

void testWindowBucketsAt44100HzAcrossPartialWrapAndFrameSplits() {
  constexpr std::uint32_t kTotalFrames = 44337u;
  constexpr std::uint32_t kTelemetryBoundary = 40000u;
  constexpr std::uint32_t kFinalFrames = kTotalFrames - kTelemetryBoundary;
  constexpr std::uint32_t kWindowFrames = 446u;
  KernelHarness whole(44100.0F, kTotalFrames);
  KernelHarness fixed(44100.0F, 64u);
  KernelHarness mixed(44100.0F, 127u);
  whole.tap_id = 70u;
  fixed.tap_id = 70u;
  mixed.tap_id = 70u;
  whole.setWindow(0.0101F);
  fixed.setWindow(0.0101F);
  mixed.setWindow(0.0101F);

  std::vector<float> source(kTotalFrames * 2u);
  for (std::uint32_t frame = 0u; frame < kTotalFrames; ++frame) {
    source[frame] = static_cast<float>(static_cast<int>(frame % 31u) - 15) * 0.03125F;
    source[kTotalFrames + frame] =
        static_cast<float>(static_cast<int>((frame * 11u) % 37u) - 18) * 0.015625F;
  }
  constexpr std::array<std::uint32_t, 1> whole_blocks = {kTelemetryBoundary};
  constexpr std::array<std::uint32_t, 1> fixed_blocks = {64u};
  constexpr std::array<std::uint32_t, 5> blocks = {17u, 64u, 1u, 127u, 33u};
  const auto processRange = [&](KernelHarness &harness, const auto &block_sizes,
                                std::uint32_t begin, std::uint32_t end) {
    std::uint32_t processed = begin;
    std::uint32_t block_index = 0u;
    while (processed < end) {
      const std::uint32_t requested = block_sizes[block_index++ % block_sizes.size()];
      const std::uint32_t block = end - processed < requested ? end - processed : requested;
      std::vector<float> chunk(block * 2u);
      for (std::uint32_t frame = 0u; frame < block; ++frame) {
        chunk[frame] = source[processed + frame];
        chunk[block + frame] = source[kTotalFrames + processed + frame];
      }
      harness.process(chunk.data(), 2u, block, 0.0);
      processed += block;
    }
  };

  processRange(whole, whole_blocks, 0u, kTelemetryBoundary);
  processRange(fixed, fixed_blocks, 0u, kTelemetryBoundary);
  processRange(mixed, blocks, 0u, kTelemetryBoundary);
  emitFrame(whole, kMaxDeltaSamples);
  emitFrame(fixed, kMaxDeltaSamples);
  emitFrame(mixed, kMaxDeltaSamples);

  processRange(whole, whole_blocks, kTelemetryBoundary, kTotalFrames);
  processRange(fixed, fixed_blocks, kTelemetryBoundary, kTotalFrames);
  processRange(mixed, blocks, kTelemetryBoundary, kTotalFrames);

  emitFrame(whole, kFinalFrames);
  emitFrame(fixed, kFinalFrames);
  emitFrame(mixed, kFinalFrames);
  checkFrame(whole, 1u, kFinalFrames);
  STEREO_CHECK(std::memcmp(payload(whole), payload(fixed), payloadBytes(kFinalFrames)) == 0);
  STEREO_CHECK(std::memcmp(payload(whole), payload(mixed), payloadBytes(kFinalFrames)) == 0);

  const std::uint8_t *data = payload(whole);
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes),
                    source[kTotalFrames + kTelemetryBoundary] - source[kTelemetryBoundary]));
  STEREO_CHECK(near(readF32(data + kPayloadHeaderBytes + 4u),
                    source[kTotalFrames + kTelemetryBoundary] + source[kTelemetryBoundary]));

  double sum_lr = 0.0;
  double sum_l2 = 0.0;
  double sum_r2 = 0.0;
  float peak_left = 0.0F;
  float peak_right = 0.0F;
  for (std::uint32_t frame = kTotalFrames - kWindowFrames; frame < kTotalFrames; ++frame) {
    const float left = source[frame];
    const float right = source[kTotalFrames + frame];
    const float absolute_left = left < 0.0F ? -left : left;
    const float absolute_right = right < 0.0F ? -right : right;
    peak_left = absolute_left > peak_left ? absolute_left : peak_left;
    peak_right = absolute_right > peak_right ? absolute_right : peak_right;
    sum_lr += static_cast<double>(left) * right;
    sum_l2 += static_cast<double>(left) * left;
    sum_r2 += static_cast<double>(right) * right;
  }
  const float expected_correlation =
      static_cast<float>(sum_lr / (std::sqrt(sum_l2) * std::sqrt(sum_r2)));
  const float expected_balance =
      static_cast<float>(10.0 * std::log10(sum_r2 + 1.0e-12) - 10.0 * std::log10(sum_l2 + 1.0e-12));
  const std::uint32_t statistics = statisticsOffset(kFinalFrames);
  STEREO_CHECK(near(readF32(data + statistics), expected_correlation));
  STEREO_CHECK(near(readF32(data + statistics + 4u), expected_balance));
  STEREO_CHECK(readF32(data + statistics + 8u) == peak_left);
  STEREO_CHECK(readF32(data + statistics + 12u) == peak_right);

  whole.setWindow(1.0F);
  fixed.setWindow(1.0F);
  mixed.setWindow(1.0F);
  std::array<float, 2> final_sample = {0.3125F, -0.125F};
  whole.process(final_sample.data(), 2u, 1u, 0.0);
  fixed.process(final_sample.data(), 2u, 1u, 0.0);
  mixed.process(final_sample.data(), 2u, 1u, 0.0);
  emitFrame(whole, 1u);
  emitFrame(fixed, 1u);
  emitFrame(mixed, 1u);
  checkFrame(whole, 2u, 1u);
  STEREO_CHECK(std::memcmp(payload(whole), payload(fixed), payloadBytes(1u)) == 0);
  STEREO_CHECK(std::memcmp(payload(whole), payload(mixed), payloadBytes(1u)) == 0);

  sum_lr = static_cast<double>(final_sample[0]) * final_sample[1];
  sum_l2 = static_cast<double>(final_sample[0]) * final_sample[0];
  sum_r2 = static_cast<double>(final_sample[1]) * final_sample[1];
  peak_left = final_sample[0];
  peak_right = -final_sample[1];
  constexpr std::uint32_t kFullWindowStart = kTotalFrames + 1u - 44100u;
  for (std::uint32_t frame = kFullWindowStart; frame < kTotalFrames; ++frame) {
    const float left = source[frame];
    const float right = source[kTotalFrames + frame];
    const float absolute_left = left < 0.0F ? -left : left;
    const float absolute_right = right < 0.0F ? -right : right;
    peak_left = absolute_left > peak_left ? absolute_left : peak_left;
    peak_right = absolute_right > peak_right ? absolute_right : peak_right;
    sum_lr += static_cast<double>(left) * right;
    sum_l2 += static_cast<double>(left) * left;
    sum_r2 += static_cast<double>(right) * right;
  }
  const std::uint32_t full_statistics = statisticsOffset(1u);
  STEREO_CHECK(near(readF32(payload(whole) + full_statistics),
                    static_cast<float>(sum_lr / (std::sqrt(sum_l2) * std::sqrt(sum_r2)))));
  STEREO_CHECK(near(readF32(payload(whole) + full_statistics + 4u),
                    static_cast<float>(10.0 * std::log10(sum_r2 + 1.0e-12) -
                                       10.0 * std::log10(sum_l2 + 1.0e-12))));
  STEREO_CHECK(readF32(payload(whole) + full_statistics + 8u) == peak_left);
  STEREO_CHECK(readF32(payload(whole) + full_statistics + 12u) == peak_right);
}

void testResetClearsEnvelopeAndPendingTelemetry() {
  KernelHarness harness(1000.0F, 4u);
  harness.tap_id = 71u;
  EnvelopeOracle oracle(1000.0F);
  float tone = 0.5F;
  harness.process(&tone, 1u, 1u, 0.0);
  oracle.process(tone, tone);
  harness.reset();
  oracle.reset();
  harness.telemetryTick();
  STEREO_CHECK(harness.read() == 0u);

  float silence = 0.0F;
  harness.process(&silence, 1u, 1u, 0.0);
  oracle.process(silence, silence);
  emitFrame(harness, 1u);
  checkEnvelope(harness, 1u, oracle);

  harness.process(&tone, 1u, 1u, 0.0);
  oracle.process(tone, tone);
  emitFrame(harness, 1u);
  checkEnvelope(harness, 1u, oracle);
  STEREO_CHECK(readF32(payload(harness) + envelopeOffset(1u) + 270u * 4u) == 1.0F);
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
  testEnvelopeDecayIsSampleAccurateAndPhaseIndependent();
  testEnvelopeOracleAndFramePartitionPayloads();
  testEnvelopeOracleAcrossRenormalizationAndPeakReplacement();
  testNonFiniteSanitizationAndEnvelopeClamp();
  testWindowBucketsAt44100HzAcrossPartialWrapAndFrameSplits();
  testResetClearsEnvelopeAndPendingTelemetry();
  testOutOfFieldCoordinatesRetainTheirRange();
  testOversizedDeltaKeepsLatestSamplesAndMarksDiscontinuity();
  if (failures != 0) {
    std::fprintf(stderr, "%d Stereo Meter native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Stereo Meter native tests passed");
  return 0;
}
