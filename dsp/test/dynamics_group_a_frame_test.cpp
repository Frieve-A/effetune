#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_CompressorPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_GatePlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_ExpanderPlugin() noexcept;

namespace {

constexpr std::uint32_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kTelemetryBytes = 256u;
constexpr std::uint32_t kFrames = 16u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "dynamics_group_a_frame_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define DYNAMICS_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

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
    DYNAMICS_CHECK(descriptor != nullptr);
    DYNAMICS_CHECK(descriptor->objectSize <= object_storage.size());
    kernel = descriptor->construct(object_storage.data());
    DYNAMICS_CHECK(kernel != nullptr);
    ring.adopt(ring_storage.data(), static_cast<std::uint32_t>(ring_storage.size()));
    kernel->prepare({48000.0F, 2u, kFrames});
    kernel->reset();
  }

  ~KernelHarness() {
    if (kernel != nullptr) {
      descriptor->destroy(kernel);
    }
  }

  void process(const std::array<float, 6u> &params, float amplitude) noexcept {
    DYNAMICS_CHECK(kernel->stageParameters(params.data(), static_cast<std::uint32_t>(params.size()),
                                           descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
    std::array<float, kFrames> audio{};
    audio.fill(amplitude);
    kernel->process(audio.data(), 1u, kFrames, {0.0});
    for (float sample : audio) {
      DYNAMICS_CHECK(std::isfinite(sample));
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
    DYNAMICS_CHECK(dropped == 0u);
    return bytes;
  }
};

void checkFrame(const KernelHarness &harness, std::uint32_t expected_sequence,
                bool expect_positive) noexcept {
  DYNAMICS_CHECK(readU16(harness.output.data()) == 2u);
  DYNAMICS_CHECK(readU16(harness.output.data() + 2u) == 1u);
  DYNAMICS_CHECK(readU32(harness.output.data() + 4u) == harness.tap_id);
  DYNAMICS_CHECK(readU32(harness.output.data() + 8u) == expected_sequence);
  DYNAMICS_CHECK(readU16(harness.output.data() + 12u) == 4u);
  DYNAMICS_CHECK(readU16(harness.output.data() + 14u) == 0u);
  const float amount_db = readF32(harness.output.data() + 16u);
  DYNAMICS_CHECK(std::isfinite(amount_db));
  DYNAMICS_CHECK(amount_db >= 0.0F);
  if (expect_positive) {
    DYNAMICS_CHECK(amount_db > 0.0F);
  } else {
    DYNAMICS_CHECK(amount_db == 0.0F);
  }
}

void testPlugin(const effetune::KernelDescriptor *descriptor, std::uint32_t tap_id,
                std::array<float, 6u> active_params, float amplitude) {
  KernelHarness harness(descriptor, tap_id);
  harness.telemetryTick();
  DYNAMICS_CHECK(harness.read() == 0u);

  harness.process(active_params, amplitude);
  harness.telemetryTick();
  DYNAMICS_CHECK(harness.read() == 20u);
  checkFrame(harness, 0u, true);

  active_params[1] = 1.0F;
  harness.process(active_params, amplitude);
  harness.telemetryTick();
  DYNAMICS_CHECK(harness.read() == 20u);
  checkFrame(harness, 1u, false);

  harness.kernel->reset();
  harness.telemetryTick();
  DYNAMICS_CHECK(harness.read() == 0u);
}

} // namespace

int main() {
  testPlugin(et_kernel_descriptor_CompressorPlugin(), 101u,
             {-60.0F, 20.0F, 0.1F, 10.0F, 0.0F, 0.0F}, 1.0F);
  testPlugin(et_kernel_descriptor_GatePlugin(), 202u, {0.0F, 100.0F, 0.01F, 10.0F, 0.0F, 0.0F},
             0.01F);
  testPlugin(et_kernel_descriptor_ExpanderPlugin(), 303u, {0.0F, 20.0F, 0.1F, 10.0F, 0.0F, 0.0F},
             0.5F);
  if (failures != 0) {
    std::fprintf(stderr, "%d dynamics frame-content check(s) failed\n", failures);
    return 1;
  }
  std::puts("All dynamics group A frame-content tests passed");
  return 0;
}
