#include "ClickRemoverPluginParams.h"
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

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_ClickRemoverPlugin() noexcept;

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
constexpr std::uint16_t kTelemetryFrameType = 21u;
using Params = effetune::generated::ClickRemoverPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Click Remover check failed: %s\n", message);
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

Params defaultParams() noexcept { return {50.0F, 1.0F}; }

class KernelHarness final {
public:
  KernelHarness(float sample_rate = static_cast<float>(kSampleRate),
                std::uint32_t max_channels = 2u, std::uint32_t max_frames = kMaximumFrames) {
    descriptor_ = et_kernel_descriptor_ClickRemoverPlugin();
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
        kernel_->stageParameters(&params.sensitivity, Params::kFloatCount, Params::kHash);
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
    effetune::TelemetryWriter writer(ring, 47u, sequence);
    kernel_->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring.read(frame.data(), static_cast<std::uint32_t>(frame.size()), &dropped);
    check(dropped == 0u, "telemetry ring accepts the fixed frame");
    check(bytes == 20u, "telemetry frame contains a four-byte payload");
    if (bytes < 20u) {
      return 0.0F;
    }
    check(readU16(frame.data()) == kTelemetryFrameType, "telemetry frame type is 21");
    check(readU16(frame.data() + 2u) == 1u, "telemetry format version is one");
    check(readU32(frame.data() + 4u) == 47u, "telemetry preserves the tap id");
    check(readU16(frame.data() + 12u) == 4u, "telemetry payload size is four bytes");
    return readF32(frame.data() + 16u);
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

class Random final {
public:
  explicit Random(std::uint32_t seed) noexcept : state_(seed | 1u) {}

  std::uint32_t next() noexcept {
    state_ ^= state_ << 13u;
    state_ ^= state_ >> 17u;
    state_ ^= state_ << 5u;
    return state_;
  }

  double bipolar() noexcept {
    return 2.0 * static_cast<double>(next() >> 8u) / static_cast<double>(1u << 24u) - 1.0;
  }

private:
  std::uint32_t state_;
};

std::vector<float> cleanSignal(std::uint32_t frames, std::uint32_t channels,
                               std::uint32_t seed = 0xeffe7a5eu) {
  std::vector<float> signal(static_cast<std::size_t>(frames) * channels);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    Random random(seed + channel * 0x9e3779b9u);
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

std::vector<float> render(KernelHarness &harness, const std::vector<float> &input,
                          std::uint32_t frames, std::uint32_t channels, bool variable_blocks) {
  std::vector<float> output(input.size(), 0.0F);
  std::array<float, 2u * kMaximumFrames> block{};
  std::uint32_t offset = 0u;
  std::uint32_t sequence = 0u;
  while (offset < frames) {
    std::uint32_t block_frames = variable_blocks ? 1u + (sequence * 37u) % 128u : 127u;
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

std::vector<float> clickWorstCase(std::uint32_t frames) {
  std::vector<float> signal = cleanSignal(frames, 1u, 0xe1d7b49bu);
  Random signs(0xeffe7a5eu);
  constexpr std::uint32_t period = 4096u;
  constexpr std::uint32_t burst_samples = 180u;
  constexpr double initial_amplitude = 0.5;
  constexpr double growth = 0.03;
  for (std::uint32_t begin = 1024u; begin < frames; begin += period) {
    const std::uint32_t available = frames - begin;
    const std::uint32_t count = burst_samples < available ? burst_samples : available;
    for (std::uint32_t offset = 0u; offset < count; ++offset) {
      const double amplitude = initial_amplitude * std::exp(growth * static_cast<double>(offset));
      signal[begin + offset] +=
          static_cast<float>(signs.next() >= 0x80000000u ? amplitude : -amplitude);
    }
  }
  return signal;
}

void testLatencyAndCleanPassThrough() {
  for (float sample_rate : {44100.0F, 48000.0F, 96000.0F, 192000.0F}) {
    KernelHarness harness(sample_rate, 1u);
    harness.stage(defaultParams());
    const auto maximum_repair = static_cast<std::uint32_t>(std::lround(0.002 * sample_rate));
    check(harness.latency() == maximum_repair + 74u,
          "latency uses the fixed maximum repair length");
  }

  constexpr std::uint32_t frames = 12000u;
  constexpr std::uint32_t channels = 2u;
  const std::vector<float> input = cleanSignal(frames, channels);
  KernelHarness harness;
  harness.stage(defaultParams());
  const std::vector<float> output = render(harness, input, frames, channels, false);
  const std::uint32_t latency = harness.latency();
  double maximum_error = 0.0;
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = latency; frame < frames; ++frame) {
      const double difference =
          static_cast<double>(output[static_cast<std::size_t>(channel) * frames + frame]) -
          input[static_cast<std::size_t>(channel) * frames + frame - latency];
      const double magnitude = difference < 0.0 ? -difference : difference;
      if (magnitude > maximum_error) {
        maximum_error = magnitude;
      }
    }
  }
  check(maximum_error <= 1.0e-6, "clean audio is an exact delayed pass-through");
  check(harness.telemetry() == 0.0F, "clean audio reports no repairs");
}

void testRepairQualityAndFramePartitioning() {
  constexpr std::uint32_t frames = kQualityFrames;
  std::vector<float> clean = cleanSignal(frames, 1u);
  std::vector<float> damaged = clean;
  std::array<std::uint32_t, 20u> clicks{};
  Random signs(0xeffe7a5eu);
  for (std::uint32_t index = 0u; index < clicks.size(); ++index) {
    clicks[index] = 2048u + index * 4096u;
    damaged[clicks[index]] += signs.next() >= 0x80000000u ? 0.5F : -0.5F;
  }

  KernelHarness fixed(static_cast<float>(kSampleRate), 1u);
  fixed.stage(defaultParams());
  const std::vector<float> fixed_output = render(fixed, damaged, frames, 1u, false);
  KernelHarness variable(static_cast<float>(kSampleRate), 1u);
  variable.stage(defaultParams());
  const std::vector<float> variable_output = render(variable, damaged, frames, 1u, true);
  check(fixed_output == variable_output, "output is independent of frame partitioning");

  double input_error_power = 0.0;
  double output_error_power = 0.0;
  const std::uint32_t latency = fixed.latency();
  for (std::uint32_t click : clicks) {
    for (std::int32_t relative = -64; relative <= 64; ++relative) {
      const std::uint32_t input_frame =
          static_cast<std::uint32_t>(static_cast<std::int32_t>(click) + relative);
      const std::uint32_t output_frame = input_frame + latency;
      const double input_error = damaged[input_frame] - clean[input_frame];
      const double output_error = fixed_output[output_frame] - clean[input_frame];
      input_error_power += input_error * input_error;
      output_error_power += output_error * output_error;
    }
  }
  std::printf("Click Remover measured repair RMS ratio %.6f\n",
              std::sqrt(output_error_power / input_error_power));
  check(output_error_power < 0.5 * input_error_power,
        "AR replacement improves the combined click windows");
  check(fixed.telemetry() > 0.0F, "click signal reports repairs");

  fixed.reset();
  fixed.stage(defaultParams());
  const std::vector<float> replay = render(fixed, damaged, frames, 1u, false);
  check(replay == fixed_output, "reset reproduces the same output");
}

void testParityImpulseActivation() {
  constexpr std::uint32_t frames = 2048u;
  constexpr std::uint32_t channels = 2u;
  std::vector<float> signal(static_cast<std::size_t>(frames) * channels, 0.0F);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    signal[static_cast<std::size_t>(channel) * frames] = 1.0F;
    signal[static_cast<std::size_t>(channel) * frames + 1000u + channel] = 1.0F;
  }
  KernelHarness harness;
  harness.stage(defaultParams());
  render(harness, signal, frames, channels, false);
  check(harness.telemetry() > 0.0F, "the production parity impulse case executes a repair");
}

void testSustainedBurstRejection() {
  constexpr std::uint32_t frames = 12000u;
  const auto render_burst = [](std::uint32_t burst_samples) {
    std::vector<float> signal = cleanSignal(frames, 1u);
    Random signs(0xeffe7a5eu);
    for (std::uint32_t offset = 0u; offset < burst_samples; ++offset) {
      signal[2048u + offset] += signs.next() >= 0x80000000u ? 0.8F : -0.8F;
    }
    KernelHarness harness(static_cast<float>(kSampleRate), 1u);
    harness.stage({50.0F, 2.0F});
    render(harness, signal, frames, 1u, false);
    return harness.telemetry();
  };
  check(render_burst(160u) == 0.0F, "a sustained random-sign burst is rejected");
  check(render_burst(8u) > 0.0F, "a short random-sign burst is repaired");
}

void testWorstCasePathAndTiming() {
  constexpr std::uint32_t frames = 2u * kQualityFrames;
  const std::vector<float> worst = clickWorstCase(frames);
  KernelHarness activation(static_cast<float>(kSampleRate), 1u);
  activation.stage({50.0F, 2.0F});
  processBlocks(activation, worst);
  const float repairs_per_second = activation.telemetry();
  std::printf("Click Remover measured worst-path Repairs/s %.3f\n", repairs_per_second);
  check(repairs_per_second > 5.0F,
        "the exponential-burst worst case repeatedly executes the repair path");

#ifdef NDEBUG
  const std::vector<float> normal = cleanSignal(kQualityFrames, 1u, 0x8c274da1u);
  const std::vector<float> measured_worst = clickWorstCase(kQualityFrames);
  const auto measure_minimum = [](const std::vector<float> &input) {
    KernelHarness harness(static_cast<float>(kSampleRate), 1u);
    harness.stage({50.0F, 2.0F});
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
  std::printf("Click Remover measured worst/normal time %.3f (%.6f / %.6f s)\n", ratio,
              worst_seconds, normal_seconds);
  check(ratio <= 3.0, "banded interpolation stays within the worst-path CPU ratio gate");
#endif
}

void testOneIntervalIsOneTelemetryEvent() {
  constexpr std::uint32_t frames = 4096u;
  std::vector<float> signal = cleanSignal(frames, 1u, 0x7118d279u);
  signal[2048u] += 0.6F;
  KernelHarness harness(static_cast<float>(kSampleRate), 1u, 1u);
  harness.stage(defaultParams());
  const double alpha = 1.0 - std::exp(-1.0 / (0.1 * kSampleRate));
  const float expected_first_event = static_cast<float>(kSampleRate * alpha);
  float previous = 0.0F;
  float first_nonzero = 0.0F;
  std::uint32_t increases = 0u;
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    float sample = signal[frame];
    harness.process(&sample, 1u, 1u);
    const float current = harness.telemetry();
    if (current > previous + 1.0e-4F) {
      ++increases;
      if (first_nonzero == 0.0F) {
        first_nonzero = current;
      }
    }
    previous = current;
  }
  const float difference = first_nonzero - expected_first_event;
  check((difference < 0.0F ? -difference : difference) <= 2.0e-3F,
        "one repaired interval increments Repairs/s by one event");
  check(increases == 1u, "one isolated click creates one repair event");
}

void testSilenceDegenerateAr() {
  constexpr std::uint32_t frames = 4096u;
  std::vector<float> silence(frames, 0.0F);
  KernelHarness harness(static_cast<float>(kSampleRate), 1u);
  harness.stage(defaultParams());
  const std::vector<float> output = render(harness, silence, frames, 1u, true);
  check(std::all_of(output.begin(), output.end(), [](float value) { return value == 0.0F; }),
        "degenerate AR input remains silent");
  check(harness.telemetry() == 0.0F, "degenerate AR input reports no repairs");
}

} // namespace

int main() {
  testLatencyAndCleanPassThrough();
  testRepairQualityAndFramePartitioning();
  testParityImpulseActivation();
  testSustainedBurstRejection();
  testOneIntervalIsOneTelemetryEvent();
  testSilenceDegenerateAr();
  testWorstCasePathAndTiming();
  if (failures != 0) {
    std::fprintf(stderr, "%d Click Remover native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Click Remover native tests passed");
  return 0;
}
