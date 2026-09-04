#include "ClipRestorerPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_ClipRestorerPlugin() noexcept;

namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kSampleRate = 96000.0;
constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::uint32_t kQualityFrames = 96000u;
#ifdef NDEBUG
constexpr std::uint32_t kPerformanceRepetitions = 20u;
#endif
constexpr std::size_t kKernelStorageBytes = 8192u;
constexpr std::size_t kTelemetryBytes = 64u;
constexpr std::uint16_t kTelemetryFrameType = 22u;
constexpr double kThreshold = 0.5011872336272722;
constexpr double kLowThreshold = 0.12589254117941673;
using Params = effetune::generated::ClipRestorerPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Clip Restorer check failed: %s\n", message);
    ++failures;
  }
}

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

Params parameters(float threshold = -6.0F, float output_gain = 0.0F) noexcept {
  return {threshold, output_gain};
}

class KernelHarness final {
public:
  KernelHarness(float sample_rate = static_cast<float>(kSampleRate),
                std::uint32_t max_channels = 2u, std::uint32_t max_frames = kMaximumFrames) {
    descriptor_ = et_kernel_descriptor_ClipRestorerPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr) {
      return;
    }
    check(descriptor_->objectSize <= storage_.size(), "kernel fits fixed object storage");
    check(descriptor_->paramsHash == Params::kHash, "descriptor hash matches generated params");
    check(descriptor_->paramsFloatCount == Params::kFloatCount,
          "descriptor parameter count matches generated params");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      kernel_->prepare({sample_rate, max_channels, max_frames});
      check(kernel_->preparedSuccessfully(), "kernel prepares");
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  void stage(const Params &params) noexcept {
    const et_status status =
        kernel_->stageParameters(&params.threshold, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->applyPendingParameters();
    kernel_->process(audio, channels, frames, {0.0});
  }

  void reset() noexcept { kernel_->reset(); }

  [[nodiscard]] std::uint32_t latency() const noexcept { return kernel_->latencySamples(); }

  [[nodiscard]] float telemetry() noexcept {
    std::array<std::uint8_t, kTelemetryBytes> ring_storage{};
    std::array<std::uint8_t, kTelemetryBytes> frame{};
    effetune::TelemetryRing ring;
    ring.adopt(ring_storage.data(), static_cast<std::uint32_t>(ring_storage.size()));
    std::uint32_t sequence = 0u;
    effetune::TelemetryWriter writer(ring, 53u, sequence);
    kernel_->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring.read(frame.data(), static_cast<std::uint32_t>(frame.size()), &dropped);
    check(dropped == 0u, "telemetry ring accepts the fixed frame");
    check(bytes == 20u, "telemetry frame contains a four-byte payload");
    if (bytes < 20u) {
      return 0.0F;
    }
    check(readU16(frame.data()) == kTelemetryFrameType, "telemetry frame type is 22");
    check(readU16(frame.data() + 2u) == 1u, "telemetry format version is one");
    check(readU32(frame.data() + 4u) == 53u, "telemetry preserves the tap id");
    check(readU16(frame.data() + 12u) == 4u, "telemetry payload size is four bytes");
    return readF32(frame.data() + 16u);
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

class XorShift64 final {
public:
  explicit XorShift64(std::uint64_t seed) noexcept : state_(seed == 0u ? 0xeffe7a5eu : seed) {}

  double bipolar() noexcept {
    state_ ^= state_ << 13u;
    state_ ^= state_ >> 7u;
    state_ ^= state_ << 17u;
    return 2.0 * static_cast<double>(state_ >> 11u) / 9007199254740992.0 - 1.0;
  }

private:
  std::uint64_t state_;
};

std::vector<float> cleanSignal(std::uint32_t frames, std::uint32_t channels) {
  std::vector<float> signal(static_cast<std::size_t>(frames) * channels);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    XorShift64 random(0xeffe7a5eu + channel * 0x9e3779b9u);
    const double phase = 0.31 * static_cast<double>(channel);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double time = static_cast<double>(frame) / kSampleRate;
      signal[static_cast<std::size_t>(channel) * frames + frame] = static_cast<float>(
          0.30 * std::sin(2.0 * kPi * 220.0 * time + phase) +
          0.20 * std::sin(2.0 * kPi * 1370.0 * time + phase + 0.47) +
          0.12 * std::sin(2.0 * kPi * 3300.0 * time + phase + 0.83) + 0.05 * random.bipolar());
    }
  }
  return signal;
}

std::vector<float> sineSignal(std::uint32_t frames, std::uint32_t channels, double frequency,
                              double amplitude) {
  std::vector<float> signal(static_cast<std::size_t>(frames) * channels);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    const double phase = 0.29 * static_cast<double>(channel);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      signal[static_cast<std::size_t>(channel) * frames + frame] = static_cast<float>(
          amplitude *
          std::sin(2.0 * kPi * frequency * static_cast<double>(frame) / kSampleRate + phase));
    }
  }
  return signal;
}

std::vector<float> hardClip(const std::vector<float> &input, float level) {
  std::vector<float> output(input.size());
  for (std::size_t index = 0u; index < input.size(); ++index) {
    const float sample = input[index];
    output[index] = sample > level ? level : (sample < -level ? -level : sample);
  }
  return output;
}

std::vector<float> render(KernelHarness &harness, const std::vector<float> &input,
                          std::uint32_t frames, std::uint32_t channels, bool variable_blocks) {
  std::vector<float> output(input.size(), 0.0F);
  std::array<float, 2u * kMaximumFrames> block{};
  std::uint32_t offset = 0u;
  std::uint32_t sequence = 0u;
  while (offset < frames) {
    std::uint32_t block_frames = variable_blocks ? 1u + (sequence * 43u) % 128u : 113u;
    const std::uint32_t remaining = frames - offset;
    if (block_frames > remaining) {
      block_frames = remaining;
    }
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t frame = 0u; frame < block_frames; ++frame) {
        block[static_cast<std::size_t>(channel) * block_frames + frame] =
            input[static_cast<std::size_t>(channel) * frames + offset + frame];
      }
    }
    harness.process(block.data(), channels, block_frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t frame = 0u; frame < block_frames; ++frame) {
        output[static_cast<std::size_t>(channel) * frames + offset + frame] =
            block[static_cast<std::size_t>(channel) * block_frames + frame];
      }
    }
    offset += block_frames;
    ++sequence;
  }
  return output;
}

void processBlocks(KernelHarness &harness, const std::vector<float> &input,
                   std::uint32_t block_frames = 128u) {
  std::array<float, kMaximumFrames> block{};
  std::uint32_t offset = 0u;
  while (offset < input.size()) {
    const std::uint32_t remaining = static_cast<std::uint32_t>(input.size()) - offset;
    const std::uint32_t frames = block_frames < remaining ? block_frames : remaining;
    std::copy_n(input.data() + offset, frames, block.data());
    harness.process(block.data(), 1u, frames);
    offset += frames;
  }
}

std::vector<float> clipWorstCase(std::uint32_t frames) {
  constexpr double frequency = kSampleRate / 432.0;
  constexpr float clip_level = static_cast<float>(kThreshold * (1.0 + 1.0e-6));
  return hardClip(sineSignal(frames, 1u, frequency, 2.5), clip_level);
}

double maximumDifference(const std::vector<float> &left, const std::vector<float> &right) {
  double maximum = 0.0;
  for (std::size_t index = 0u; index < left.size(); ++index) {
    const double difference = static_cast<double>(left[index]) - right[index];
    const double magnitude = difference < 0.0 ? -difference : difference;
    if (magnitude > maximum) {
      maximum = magnitude;
    }
  }
  return maximum;
}

void testLatencyCleanPassThroughAndGain() {
  for (float sample_rate : {44100.0F, 48000.0F, 96000.0F, 192000.0F}) {
    KernelHarness harness(sample_rate, 1u);
    harness.stage(parameters());
    const auto maximum_repair = static_cast<std::uint32_t>(std::lround(0.002 * sample_rate));
    check(harness.latency() == maximum_repair + 74u,
          "latency uses the fixed maximum repair length");
  }

  constexpr std::uint32_t frames = 12000u;
  const std::vector<float> clean = cleanSignal(frames, 2u);
  KernelHarness unity;
  unity.stage(parameters(-0.1F, 0.0F));
  const std::vector<float> output = render(unity, clean, frames, 2u, false);
  const std::uint32_t latency = unity.latency();
  double maximum_error = 0.0;
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::uint32_t frame = latency; frame < frames; ++frame) {
      const double difference =
          static_cast<double>(output[static_cast<std::size_t>(channel) * frames + frame]) -
          clean[static_cast<std::size_t>(channel) * frames + frame - latency];
      const double magnitude = difference < 0.0 ? -difference : difference;
      if (magnitude > maximum_error) {
        maximum_error = magnitude;
      }
    }
  }
  check(maximum_error <= 1.0e-6, "sub-threshold audio is an exact delayed pass-through");
  check(unity.telemetry() == 0.0F, "sub-threshold audio reports no restoration");

  KernelHarness gain;
  gain.stage(parameters(-0.1F, -3.0F));
  const std::vector<float> gained = render(gain, clean, frames, 2u, false);
  const float scale = static_cast<float>(std::exp(-3.0 * 0.1151292546497022842));
  maximum_error = 0.0;
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::uint32_t frame = latency; frame < frames; ++frame) {
      const double expected =
          static_cast<double>(clean[static_cast<std::size_t>(channel) * frames + frame - latency]) *
          static_cast<double>(scale);
      const double difference =
          static_cast<double>(gained[static_cast<std::size_t>(channel) * frames + frame]) -
          expected;
      const double magnitude = difference < 0.0 ? -difference : difference;
      if (magnitude > maximum_error) {
        maximum_error = magnitude;
      }
    }
  }
  check(maximum_error <= 1.0e-6, "output gain is applied after the fixed delay");
}

void testDeclippingQualityAndFramePartitioning() {
  constexpr std::uint32_t frames = kQualityFrames;
  constexpr float clip_level = static_cast<float>(kThreshold * (1.0 + 1.0e-6));
  const std::vector<float> reference = sineSignal(frames, 1u, 220.0, 1.0);
  const std::vector<float> clipped = hardClip(reference, clip_level);

  KernelHarness fixed(static_cast<float>(kSampleRate), 1u);
  fixed.stage(parameters());
  const std::vector<float> fixed_output = render(fixed, clipped, frames, 1u, false);
  KernelHarness variable(static_cast<float>(kSampleRate), 1u);
  variable.stage(parameters());
  const std::vector<float> variable_output = render(variable, clipped, frames, 1u, true);
  check(maximumDifference(fixed_output, variable_output) <= 2.0e-6,
        "output is independent of frame partitioning");

  const std::uint32_t latency = fixed.latency();
  double clipped_error_power = 0.0;
  double restored_error_power = 0.0;
  double restored_peak = 0.0;
  for (std::uint32_t frame = 2048u + latency; frame < frames; ++frame) {
    const std::uint32_t input_frame = frame - latency;
    const double clipped_error = clipped[input_frame] - reference[input_frame];
    const double restored_error = fixed_output[frame] - reference[input_frame];
    clipped_error_power += clipped_error * clipped_error;
    restored_error_power += restored_error * restored_error;
    const double magnitude =
        fixed_output[frame] < 0.0F ? -fixed_output[frame] : fixed_output[frame];
    if (magnitude > restored_peak) {
      restored_peak = magnitude;
    }
  }
  const double rms_ratio = std::sqrt(restored_error_power / clipped_error_power);
  std::printf("Clip Restorer measured 220 Hz error ratio %.6f, peak %.6f\n", rms_ratio,
              restored_peak);
  check(restored_error_power < clipped_error_power,
        "bounded AR restoration improves the clipped sine");
  check(restored_peak > 1.05 * kThreshold,
        "bounded AR restoration reconstructs values above the clip level");
  check(fixed.telemetry() > 0.0F, "clipped sine reports restored samples");

  fixed.reset();
  fixed.stage(parameters());
  const std::vector<float> replay = render(fixed, clipped, frames, 1u, false);
  check(replay == fixed_output, "reset reproduces the same output");
}

void testLowLevelDeclippingQualityAndBounds() {
  constexpr std::uint32_t frames = kQualityFrames;
  constexpr float clip_level = static_cast<float>(kLowThreshold * (1.0 + 1.0e-6));
  const std::vector<float> reference = sineSignal(frames, 1u, 440.0, 0.32);
  const std::vector<float> clipped = hardClip(reference, clip_level);

  KernelHarness harness(static_cast<float>(kSampleRate), 1u);
  harness.stage(parameters(-18.0F));
  const std::vector<float> output = render(harness, clipped, frames, 1u, true);
  const std::uint32_t latency = harness.latency();
  double clipped_error_power = 0.0;
  double restored_error_power = 0.0;
  double restored_peak = 0.0;
  for (std::uint32_t frame = 2048u + latency; frame < frames; ++frame) {
    const std::uint32_t input_frame = frame - latency;
    const double clipped_error = clipped[input_frame] - reference[input_frame];
    const double restored_error = output[frame] - reference[input_frame];
    clipped_error_power += clipped_error * clipped_error;
    restored_error_power += restored_error * restored_error;
    check(std::isfinite(output[frame]), "low-level restoration output remains finite");
    const double magnitude = output[frame] < 0.0F ? -output[frame] : output[frame];
    if (magnitude > restored_peak) {
      restored_peak = magnitude;
    }
  }
  const float restored_percent = harness.telemetry();
  std::printf("Clip Restorer measured -18 dB error ratio %.6f, peak %.6f, Restored %.3f%%\n",
              std::sqrt(restored_error_power / clipped_error_power), restored_peak,
              restored_percent);
  check(restored_error_power < clipped_error_power,
        "bounded AR restoration improves a low-level clipped sine");
  check(restored_peak > 1.05 * kLowThreshold,
        "low-level restoration reconstructs values above the clip level");
  check(restored_peak <= 4.0 * kLowThreshold + 2.0e-6,
        "low-level restoration respects the maximum overshoot bound");
  check(restored_percent > 0.0F, "low-level clipped sine reports restored samples");
  check(restored_percent <= 100.0F,
        "low-level restoration remains within the repair-density limit");
}

void testParityNoiseActivation() {
  constexpr std::uint32_t frames = 4096u;
  constexpr std::uint32_t channels = 2u;
  std::vector<float> signal(static_cast<std::size_t>(frames) * channels, 0.0F);
  XorShift64 random(0xeffe7a5eu);
  for (float &sample : signal) {
    sample = static_cast<float>(random.bipolar());
  }
  KernelHarness harness;
  harness.stage(parameters());
  render(harness, signal, frames, channels, false);
  check(harness.telemetry() > 0.0F, "the production parity noise case executes restoration");
}

void testWorstCasePathAndTiming() {
  const std::vector<float> worst = clipWorstCase(2u * kQualityFrames);
  KernelHarness activation(static_cast<float>(kSampleRate), 1u);
  activation.stage(parameters());
  processBlocks(activation, worst);
  const float restored_percent = activation.telemetry();
  std::printf("Clip Restorer measured worst-path Restored %.3f%%\n", restored_percent);
  check(restored_percent > 50.0F,
        "the dense clipped-sine worst case repeatedly executes restoration");

#ifdef NDEBUG
  const std::vector<float> normal = cleanSignal(kQualityFrames, 1u);
  const std::vector<float> measured_worst = clipWorstCase(kQualityFrames);
  const auto measure_minimum = [](const std::vector<float> &input) {
    KernelHarness harness(static_cast<float>(kSampleRate), 1u);
    harness.stage(parameters());
    processBlocks(harness, input);
    double minimum_seconds = 1.0e30;
    for (std::uint32_t repetition = 0u; repetition < kPerformanceRepetitions; ++repetition) {
      const auto begin = std::chrono::steady_clock::now();
      processBlocks(harness, input);
      const double seconds =
          std::chrono::duration<double>(std::chrono::steady_clock::now() - begin).count();
      if (seconds < minimum_seconds) {
        minimum_seconds = seconds;
      }
    }
    return minimum_seconds;
  };
  const double normal_seconds = measure_minimum(normal);
  const double worst_seconds = measure_minimum(measured_worst);
  const double ratio = worst_seconds / normal_seconds;
  std::printf("Clip Restorer measured worst/normal time %.3f (%.6f / %.6f s)\n", ratio,
              worst_seconds, normal_seconds);
  check(ratio <= 40.0, "banded restoration stays within the worst-path CPU ratio gate");
#endif
}

void testDenseRestorationBounds() {
  constexpr std::uint32_t frames = kQualityFrames;
  constexpr float clip_level = static_cast<float>(kThreshold * (1.0 + 1.0e-6));
  const std::vector<float> reference = sineSignal(frames, 1u, 500.0, 1.0);
  const std::vector<float> clipped = hardClip(reference, clip_level);
  KernelHarness harness(static_cast<float>(kSampleRate), 1u);
  harness.stage(parameters());
  const std::vector<float> output = render(harness, clipped, frames, 1u, false);
  double peak = 0.0;
  for (float sample : output) {
    check(std::isfinite(sample), "dense restoration output remains finite");
    const double magnitude = sample < 0.0F ? -sample : sample;
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  check(peak <= 4.0 * kThreshold + 2.0e-6,
        "dense restoration respects the maximum overshoot bound");
  check(peak > kThreshold * 1.01, "dense restoration executes the repair path");
  check(harness.telemetry() > 0.0F, "dense restoration reports restored samples");
}

void testLongPlateausPassThrough() {
  constexpr std::uint32_t frames = 12000u;
  std::vector<float> square(frames);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    square[frame] = (frame / 960u) % 2u == 0u ? 0.8F : -0.8F;
  }
  KernelHarness harness(static_cast<float>(kSampleRate), 1u);
  harness.stage(parameters());
  const std::vector<float> output = render(harness, square, frames, 1u, true);
  const std::uint32_t latency = harness.latency();
  double maximum_error = 0.0;
  for (std::uint32_t frame = latency; frame < frames; ++frame) {
    const double difference = static_cast<double>(output[frame]) - square[frame - latency];
    const double magnitude = difference < 0.0 ? -difference : difference;
    if (magnitude > maximum_error) {
      maximum_error = magnitude;
    }
  }
  check(maximum_error <= 1.0e-6, "plateaus longer than two milliseconds pass through");
  check(harness.telemetry() == 0.0F, "long plateaus report no restored samples");
}

} // namespace

int main() {
  testLatencyCleanPassThroughAndGain();
  testDeclippingQualityAndFramePartitioning();
  testLowLevelDeclippingQualityAndBounds();
  testParityNoiseActivation();
  testDenseRestorationBounds();
  testLongPlateausPassThrough();
  testWorstCasePathAndTiming();
  if (failures != 0) {
    std::fprintf(stderr, "%d Clip Restorer native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Clip Restorer native tests passed");
  return 0;
}
