#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <numbers>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_AutoLevelerPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_BrickwallLimiterPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_TransientShaperPlugin() noexcept;

namespace {

constexpr std::uint32_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kTelemetryBytes = 256u;
constexpr std::uint32_t kFrames = 8u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "dynamics_group_b_frame_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define DYNAMICS_B_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

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

struct KernelHarness final {
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> object_storage{};
  std::array<std::uint8_t, kTelemetryBytes> ring_storage{};
  std::array<std::uint8_t, kTelemetryBytes> output{};
  const effetune::KernelDescriptor *descriptor = nullptr;
  effetune::PluginKernel *kernel = nullptr;
  effetune::TelemetryRing ring;
  std::uint32_t tap_id = 0u;
  std::uint32_t sequence = 0u;

  KernelHarness(const effetune::KernelDescriptor *kernel_descriptor, std::uint32_t tap)
      : descriptor(kernel_descriptor), tap_id(tap) {
    DYNAMICS_B_CHECK(descriptor != nullptr);
    DYNAMICS_B_CHECK(descriptor->objectSize <= object_storage.size());
    kernel = descriptor->construct(object_storage.data());
    DYNAMICS_B_CHECK(kernel != nullptr);
    ring.adopt(ring_storage.data(), static_cast<std::uint32_t>(ring_storage.size()));
    kernel->prepare({48000.0F, 2u, kFrames});
    kernel->reset();
  }

  ~KernelHarness() {
    if (kernel != nullptr) {
      descriptor->destroy(kernel);
    }
  }

  template <std::size_t Size> void stage(const std::array<float, Size> &params) noexcept {
    DYNAMICS_B_CHECK(Size == descriptor->paramsFloatCount);
    DYNAMICS_B_CHECK(kernel->stageParameters(params.data(), static_cast<std::uint32_t>(Size),
                                             descriptor->paramsHash) == ET_OK);
  }

  void process(float amplitude) noexcept {
    kernel->applyPendingParameters();
    std::array<float, kFrames> audio{};
    audio.fill(amplitude);
    kernel->process(audio.data(), 1u, kFrames, {0.0});
    for (float sample : audio) {
      DYNAMICS_B_CHECK(std::isfinite(sample));
    }
  }

  void telemetryTick() noexcept {
    effetune::TelemetryWriter writer(ring, tap_id, sequence);
    kernel->writeTelemetry(writer);
  }

  std::uint32_t read() noexcept {
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
    DYNAMICS_B_CHECK(dropped == 0u);
    return bytes;
  }
};

void checkFrameHeader(const KernelHarness &harness, std::uint16_t frame_type,
                      std::uint16_t payload_bytes, std::uint32_t sequence) noexcept {
  DYNAMICS_B_CHECK(readU16(harness.output.data()) == frame_type);
  DYNAMICS_B_CHECK(readU16(harness.output.data() + 2u) == 1u);
  DYNAMICS_B_CHECK(readU32(harness.output.data() + 4u) == harness.tap_id);
  DYNAMICS_B_CHECK(readU32(harness.output.data() + 8u) == sequence);
  DYNAMICS_B_CHECK(readU16(harness.output.data() + 12u) == payload_bytes);
  DYNAMICS_B_CHECK(readU16(harness.output.data() + 14u) == 0u);
  const std::uint32_t unpadded = 16u + payload_bytes;
  const std::uint32_t aligned = (unpadded + 3u) & ~3u;
  for (std::uint32_t index = unpadded; index < aligned; ++index) {
    DYNAMICS_B_CHECK(harness.output[index] == 0u);
  }
}

void testAutoLevelerFrame() {
  KernelHarness harness(et_kernel_descriptor_AutoLevelerPlugin(), 701u);
  harness.stage(std::array<float, 7u>{-18.0F, 1000.0F, 12.0F, -12.0F, 50.0F, 5000.0F, -60.0F});
  harness.process(0.5F);
  harness.telemetryTick();
  DYNAMICS_B_CHECK(harness.read() == 24u);
  checkFrameHeader(harness, 7u, 8u, 0u);
  const float input_lufs = readF32(harness.output.data() + 16u);
  const float output_lufs = readF32(harness.output.data() + 20u);
  DYNAMICS_B_CHECK(std::isfinite(input_lufs));
  DYNAMICS_B_CHECK(input_lufs >= -144.0F);
  DYNAMICS_B_CHECK(std::isfinite(output_lufs));
  DYNAMICS_B_CHECK(output_lufs >= -144.0F);
  harness.kernel->reset();
  harness.process(1.0e-20F);
  harness.telemetryTick();
  DYNAMICS_B_CHECK(harness.read() == 24u);
  checkFrameHeader(harness, 7u, 8u, 1u);
  DYNAMICS_B_CHECK(readF32(harness.output.data() + 16u) == -144.0F);
  DYNAMICS_B_CHECK(readF32(harness.output.data() + 20u) == -144.0F);
  harness.kernel->reset();
  harness.telemetryTick();
  DYNAMICS_B_CHECK(harness.read() == 0u);
}

void testAutoLevelerWindowAutomation() {
  KernelHarness harness(et_kernel_descriptor_AutoLevelerPlugin(), 701u);
  constexpr std::uint32_t frames = 128u;
  constexpr std::uint32_t settled_frames = 3u * 48000u;
  harness.kernel->prepare({48000.0F, 1u, frames});
  std::array<float, 7u> params{-36.0F, 3000.0F, 0.0F, -36.0F, 1.0F, 5000.0F, -96.0F};
  float settled_output_lufs = -144.0F;
  for (std::uint32_t start = 0u; start < settled_frames + 64u * frames; start += frames) {
    if (start >= settled_frames) {
      params[1] = 3010.0F + 10.0F * static_cast<float>((start - settled_frames) / frames);
    }
    harness.stage(params);
    harness.kernel->applyPendingParameters();
    std::array<float, frames> audio{};
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      audio[frame] = static_cast<float>(
          0.5 * std::sin(2.0 * std::numbers::pi * 1000.0 * (start + frame) / 48000.0));
    }
    harness.kernel->process(audio.data(), 1u, frames, {0.0});
    if (start + frames == settled_frames) {
      harness.telemetryTick();
      DYNAMICS_B_CHECK(harness.read() == 24u);
      settled_output_lufs = readF32(harness.output.data() + 20u);
    }
    if (start >= settled_frames) {
      for (float sample : audio) {
        DYNAMICS_B_CHECK(std::abs(sample) < 0.025F);
      }
      harness.telemetryTick();
      DYNAMICS_B_CHECK(harness.read() == 24u);
      DYNAMICS_B_CHECK(std::abs(readF32(harness.output.data() + 20u) - settled_output_lufs) <
                       0.01F);
    }
  }
}

void testAutoLevelerWindowHistory() {
  KernelHarness harness(et_kernel_descriptor_AutoLevelerPlugin(), 701u);
  constexpr std::uint32_t frames = 128u;
  constexpr std::uint32_t sample_rate = 48000u;
  constexpr std::uint32_t capacity = 10u * sample_rate;
  constexpr std::uint32_t total_frames = 21u * sample_rate;
  harness.kernel->prepare({48000.0F, 1u, frames});
  std::array<float, 7u> params{-18.0F, 3000.0F, 12.0F, -36.0F, 1.0F, 10.0F, -96.0F};
  constexpr std::array<float, 6u> windows{1000.0F, 10000.0F, 3010.0F, 7000.0F, 2000.0F, 9999.0F};
  std::vector<double> powers(total_frames);
  // Independent direct-form filters use the published BS.1770-4 tables at 48 kHz.
  std::array<double, 4u> highpass_state{};
  std::array<double, 4u> shelf_state{};
  const auto filter = [](double input, std::array<double, 4u> &state,
                         const std::array<double, 5u> &coefficients) {
    const double output = coefficients[0] * input + coefficients[1] * state[0] +
                          coefficients[2] * state[1] - coefficients[3] * state[2] -
                          coefficients[4] * state[3];
    state = {input, state[0], output, state[2]};
    return static_cast<float>(output);
  };
  for (std::uint32_t start = 0u; start < total_frames; start += frames) {
    params[1] = windows[(start / frames) % windows.size()];
    harness.stage(params);
    harness.kernel->applyPendingParameters();
    std::array<float, frames> audio{};
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const std::uint32_t index = start + frame;
      const double amplitude = 0.1 + 0.05 * ((index / sample_rate) % 7u);
      audio[frame] = static_cast<float>(
          amplitude * std::sin(2.0 * std::numbers::pi * 997.0 * index / sample_rate));
      const float highpass = filter(audio[frame], highpass_state,
                                    {1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621});
      const double weighted = filter(highpass, shelf_state,
                                     {1.53512485958697, -2.69169618940638, 1.19839281085285,
                                      -1.69065929318241, 0.73248077421585});
      powers[index] = weighted * weighted;
    }
    harness.kernel->process(audio.data(), 1u, frames, {0.0});
    const std::uint32_t end = start + frames;
    if ((start / frames) % 127u != 0u && start / capacity == end / capacity) {
      continue;
    }
    const auto window_samples = static_cast<std::uint32_t>(
        std::floor(static_cast<double>(params[1]) * 0.001 * sample_rate));
    const std::uint32_t first = end < window_samples ? 0u : end - window_samples;
    double sum = 0.0;
    for (std::uint32_t index = first; index < end; ++index) {
      sum += powers[index];
    }
    const double expected_lufs = 10.0 * std::log10(sum / (end - first)) - 0.691;
    harness.telemetryTick();
    DYNAMICS_B_CHECK(harness.read() == 24u);
    DYNAMICS_B_CHECK(std::abs(readF32(harness.output.data() + 16u) - expected_lufs) < 1.0e-5);
  }
}

void testTransientFrame() {
  KernelHarness harness(et_kernel_descriptor_TransientShaperPlugin(), 801u);
  harness.stage(std::array<float, 7u>{0.1F, 20.0F, 100.0F, 300.0F, 24.0F, 0.0F, 0.1F});
  harness.process(1.0F);
  harness.telemetryTick();
  DYNAMICS_B_CHECK(harness.read() == 20u);
  checkFrameHeader(harness, 8u, 4u, 0u);
  const float gain_db = readF32(harness.output.data() + 16u);
  DYNAMICS_B_CHECK(std::isfinite(gain_db));
  DYNAMICS_B_CHECK(gain_db > 0.0F);
  harness.kernel->reset();
  harness.telemetryTick();
  DYNAMICS_B_CHECK(harness.read() == 0u);
}

void testBrickwallFrameAndStagedLatency() {
  KernelHarness harness(et_kernel_descriptor_BrickwallLimiterPlugin(), 201u);
  const auto stage_and_check = [&harness](float lookahead, float oversampling,
                                          std::uint32_t expected_latency) {
    harness.stage(std::array<float, 6u>{-24.0F, 100.0F, lookahead, oversampling, 0.0F, -1.0F});
    DYNAMICS_B_CHECK(harness.kernel->latencySamples() == expected_latency);
  };

  stage_and_check(0.0F, 1.0F, 1u);
  stage_and_check(3.0F, 1.0F, 144u);
  stage_and_check(0.0F, 2.0F, 32u);
  stage_and_check(0.0F, 4.0F, 17u);
  stage_and_check(0.0F, 8.0F, 9u);
  stage_and_check(3.0F, 8.0F, 152u);
  stage_and_check(0.0F, 1.0F, 1u);
  harness.process(1.0F);
  harness.telemetryTick();
  DYNAMICS_B_CHECK(harness.read() == 20u);
  checkFrameHeader(harness, 2u, 4u, 0u);
  const float reduction_db = readF32(harness.output.data() + 16u);
  DYNAMICS_B_CHECK(std::isfinite(reduction_db));
  DYNAMICS_B_CHECK(reduction_db > 0.0F);
  harness.kernel->reset();
  DYNAMICS_B_CHECK(harness.kernel->latencySamples() == 1u);
  harness.telemetryTick();
  DYNAMICS_B_CHECK(harness.read() == 0u);
}

} // namespace

int main() {
  testAutoLevelerFrame();
  testAutoLevelerWindowAutomation();
  testAutoLevelerWindowHistory();
  testTransientFrame();
  testBrickwallFrameAndStagedLatency();
  if (failures != 0) {
    std::fprintf(stderr, "%d dynamics group B contract check(s) failed\n", failures);
    return 1;
  }
  std::puts("All dynamics group B frame and latency tests passed");
  return 0;
}
