#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_PowerAmpSagPlugin() noexcept;

namespace {

constexpr std::uint32_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kTelemetryBytes = 256u;
constexpr std::uint32_t kFrames = 16u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "power_amp_sag/native_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define POWER_SAG_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

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

void testFrameAndModeReset() {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_PowerAmpSagPlugin();
  POWER_SAG_CHECK(descriptor != nullptr);
  POWER_SAG_CHECK(descriptor->paramsFloatCount == 4u);

  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> object_storage{};
  POWER_SAG_CHECK(descriptor->objectSize <= object_storage.size());
  effetune::PluginKernel *kernel = descriptor->construct(object_storage.data());
  POWER_SAG_CHECK(kernel != nullptr);
  kernel->prepare({48000.0F, 2u, kFrames});

  const std::array<float, 4u> shared_params{3.0F, 50.0F, 40.0F, 0.0F};
  POWER_SAG_CHECK(kernel->stageParameters(shared_params.data(), 4u, descriptor->paramsHash) ==
                  ET_OK);
  kernel->applyPendingParameters();
  std::array<float, kFrames * 2u> audio{};
  audio.fill(0.25F);
  kernel->process(audio.data(), 2u, kFrames, {0.0});
  for (float sample : audio) {
    POWER_SAG_CHECK(std::isfinite(sample));
    POWER_SAG_CHECK(sample <= 0.25F);
  }

  std::array<std::uint8_t, kTelemetryBytes> ring_storage{};
  std::array<std::uint8_t, kTelemetryBytes> output{};
  effetune::TelemetryRing ring;
  ring.adopt(ring_storage.data(), static_cast<std::uint32_t>(ring_storage.size()));
  std::uint32_t sequence = 0u;
  effetune::TelemetryWriter writer(ring, 1201u, sequence);
  kernel->writeTelemetry(writer);
  std::uint32_t dropped = 0u;
  const std::uint32_t bytes =
      ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
  POWER_SAG_CHECK(bytes == 24u);
  POWER_SAG_CHECK(dropped == 0u);
  POWER_SAG_CHECK(readU16(output.data()) == 12u);
  POWER_SAG_CHECK(readU16(output.data() + 2u) == 1u);
  POWER_SAG_CHECK(readU32(output.data() + 4u) == 1201u);
  POWER_SAG_CHECK(readU32(output.data() + 8u) == 0u);
  POWER_SAG_CHECK(readU16(output.data() + 12u) == 8u);
  POWER_SAG_CHECK(readU16(output.data() + 14u) == 0u);
  const float input_envelope = readF32(output.data() + 16u);
  const float gain_reduction = readF32(output.data() + 20u);
  POWER_SAG_CHECK(std::isfinite(input_envelope));
  POWER_SAG_CHECK(input_envelope >= 0.0F);
  POWER_SAG_CHECK(std::isfinite(gain_reduction));
  POWER_SAG_CHECK(gain_reduction <= 0.0F);

  const std::array<float, 4u> monoblock_params{3.0F, 50.0F, 40.0F, 1.0F};
  POWER_SAG_CHECK(kernel->stageParameters(monoblock_params.data(), 4u, descriptor->paramsHash) ==
                  ET_OK);
  kernel->applyPendingParameters();
  audio.fill(0.25F);
  kernel->process(audio.data(), 2u, kFrames, {0.0});
  for (float sample : audio) {
    POWER_SAG_CHECK(std::isfinite(sample));
  }

  kernel->reset();
  effetune::TelemetryWriter reset_writer(ring, 1201u, sequence);
  kernel->writeTelemetry(reset_writer);
  POWER_SAG_CHECK(ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped) ==
                  0u);
  descriptor->destroy(kernel);
}

} // namespace

int main() {
  testFrameAndModeReset();
  if (failures != 0) {
    std::fprintf(stderr, "%d Power Amp Sag contract check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Power Amp Sag frame and state tests passed");
  return 0;
}
