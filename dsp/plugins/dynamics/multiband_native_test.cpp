#include "effetune/dsp/linkwitz_riley.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_MultibandCompressorPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_MultibandExpanderPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_MultibandTransientPlugin() noexcept;

namespace {

constexpr std::uint32_t kStorageBytes = 16384u;
constexpr std::uint32_t kFrames = 64u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "dynamics/multiband_native_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define MULTIBAND_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

template <std::size_t ParamCount> struct KernelHarness final {
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> storage{};
  const effetune::KernelDescriptor *descriptor = nullptr;
  effetune::PluginKernel *kernel = nullptr;

  explicit KernelHarness(const effetune::KernelDescriptor *source) : descriptor(source) {
    MULTIBAND_CHECK(descriptor != nullptr);
    MULTIBAND_CHECK(descriptor != nullptr && descriptor->objectSize <= storage.size());
    if (descriptor == nullptr || descriptor->objectSize > storage.size())
      return;
    kernel = descriptor->construct(storage.data());
    MULTIBAND_CHECK(kernel != nullptr);
    if (kernel != nullptr)
      kernel->prepare({48000.0F, 4u, kFrames});
  }

  ~KernelHarness() {
    if (kernel != nullptr)
      descriptor->destroy(kernel);
  }

  void stage(const std::array<float, ParamCount> &params) noexcept {
    MULTIBAND_CHECK(kernel->stageParameters(params.data(), ParamCount, descriptor->paramsHash) ==
                    ET_OK);
  }

  void process(float *audio, std::uint32_t channels = 1u) noexcept {
    kernel->applyPendingParameters();
    kernel->process(audio, channels, kFrames, {0.0});
  }
};

std::array<float, 34> compressorParams() noexcept {
  return {100.0F, 500.0F, 2000.0F, 8000.0F, -20.0F, -22.0F, -25.0F, -28.0F, -18.0F,
          4.0F,   3.0F,   2.5F,    2.0F,    5.0F,   30.0F,  20.0F,  15.0F,  10.0F,
          5.0F,   150.0F, 120.0F,  80.0F,   60.0F,  40.0F,  6.0F,   4.0F,   4.0F,
          3.0F,   2.0F,   -1.0F,   0.0F,    1.0F,   1.5F,   -2.0F};
}

std::array<float, 34> expanderParams() noexcept {
  return {100.0F, 500.0F, 2000.0F, 8000.0F, -30.0F, -16.0F, -24.0F, -36.0F, -48.0F,
          1.2F,   1.2F,   1.2F,    1.1F,    1.1F,   10.0F,  7.75F,  5.5F,   3.25F,
          1.0F,   100.0F, 87.5F,   75.0F,   62.5F,  50.0F,  6.0F,   4.0F,   4.0F,
          3.0F,   2.0F,   1.0F,    1.0F,    1.0F,   1.0F,   1.0F};
}

std::array<float, 23> transientParams() noexcept {
  return {200.0F, 4000.0F, 5.0F, 2.0F, 0.5F, 50.0F, 30.0F, 20.0F, 25.0F, 10.0F, 5.0F, 250.0F,
          150.0F, 100.0F,  6.0F, 6.0F, 6.0F, 0.0F,  0.0F,  0.0F,  5.0F,  5.0F,  5.0F};
}

std::array<float, kFrames> signal(float scale = 1.0F) noexcept {
  std::array<float, kFrames> result{};
  for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
    const float value = static_cast<float>((static_cast<int>(frame % 11u) - 5) * 0.08);
    result[frame] = value * scale;
  }
  return result;
}

bool equal(const std::array<float, kFrames> &left,
           const std::array<float, kFrames> &right) noexcept {
  for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
    if (left[frame] != right[frame])
      return false;
  }
  return true;
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
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

template <std::size_t ParamCount>
void checkTelemetry(KernelHarness<ParamCount> &harness, std::uint8_t expected_bands,
                    std::uint8_t expected_kind, bool require_nonnegative) noexcept {
  std::array<std::uint8_t, 256> ring_storage{};
  std::array<std::uint8_t, 256> output{};
  effetune::TelemetryRing ring;
  ring.adopt(ring_storage.data(), static_cast<std::uint32_t>(ring_storage.size()));
  std::uint32_t sequence = 0u;
  effetune::TelemetryWriter writer(ring, 313u, sequence);
  harness.kernel->writeTelemetry(writer);
  std::uint32_t dropped = 0u;
  const std::uint32_t bytes =
      ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
  const std::uint16_t payload_bytes =
      static_cast<std::uint16_t>(4u + static_cast<std::uint32_t>(expected_bands) * 4u);
  MULTIBAND_CHECK(bytes == 16u + payload_bytes);
  MULTIBAND_CHECK(dropped == 0u);
  MULTIBAND_CHECK(readU16(output.data()) == 13u);
  MULTIBAND_CHECK(readU16(output.data() + 2u) == 1u);
  MULTIBAND_CHECK(readU32(output.data() + 4u) == 313u);
  MULTIBAND_CHECK(readU32(output.data() + 8u) == 0u);
  MULTIBAND_CHECK(readU16(output.data() + 12u) == payload_bytes);
  MULTIBAND_CHECK(readU16(output.data() + 14u) == 0u);
  const std::uint8_t *payload = output.data() + 16u;
  MULTIBAND_CHECK(payload[0] == expected_bands);
  MULTIBAND_CHECK(payload[1] == expected_kind);
  MULTIBAND_CHECK(payload[2] == 0u && payload[3] == 0u);
  for (std::uint32_t band = 0u; band < expected_bands; ++band) {
    const float value = readF32(payload + 4u + band * 4u);
    MULTIBAND_CHECK(std::isfinite(value));
    if (require_nonnegative)
      MULTIBAND_CHECK(value >= 0.0F);
  }
}

void testDescriptors() noexcept {
  const auto *compressor = et_kernel_descriptor_MultibandCompressorPlugin();
  const auto *expander = et_kernel_descriptor_MultibandExpanderPlugin();
  const auto *transient = et_kernel_descriptor_MultibandTransientPlugin();
  MULTIBAND_CHECK(compressor != nullptr && compressor->paramsHash == 0xe52acce2u);
  MULTIBAND_CHECK(compressor != nullptr && compressor->paramsFloatCount == 34u);
  MULTIBAND_CHECK(expander != nullptr && expander->paramsHash == 0xe52acce2u);
  MULTIBAND_CHECK(expander != nullptr && expander->paramsFloatCount == 34u);
  MULTIBAND_CHECK(transient != nullptr && transient->paramsHash == 0x5521411cu);
  MULTIBAND_CHECK(transient != nullptr && transient->paramsFloatCount == 23u);
  MULTIBAND_CHECK(compressor != nullptr && compressor->paramsByteCapacity == 0u);
  MULTIBAND_CHECK(expander != nullptr && expander->paramsByteCapacity == 0u);
  MULTIBAND_CHECK(transient != nullptr && transient->paramsByteCapacity == 0u);
  MULTIBAND_CHECK(compressor != nullptr && compressor->objectSize <= 8192u);
  MULTIBAND_CHECK(expander != nullptr && expander->objectSize <= 8192u);
  MULTIBAND_CHECK(transient != nullptr && transient->objectSize <= 8192u);
}

void testLinkwitzRileyPrecisionContract() noexcept {
  const effetune::dsp::LinkwitzRiley24Coefficients coefficients =
      effetune::dsp::designLinkwitzRiley24(48000.0, 1000.0);
  MULTIBAND_CHECK(coefficients.lowpass.isFinite());
  MULTIBAND_CHECK(coefficients.highpass.isFinite());
  MULTIBAND_CHECK(coefficients.lowpass.b0 > 0.0);
  MULTIBAND_CHECK(coefficients.highpass.b1 < 0.0);

  effetune::dsp::LinkwitzRiley24State float_state{};
  effetune::dsp::LinkwitzRiley24State double_state{};
  effetune::dsp::resetLinkwitzRiley24State(float_state,
                                           effetune::dsp::LinkwitzRileyStateStorage::Float32);
  effetune::dsp::resetLinkwitzRiley24State(double_state,
                                           effetune::dsp::LinkwitzRileyStateStorage::Float64);
  MULTIBAND_CHECK(float_state.stage1.x1 == static_cast<double>(static_cast<float>(1.0e-25)));
  MULTIBAND_CHECK(double_state.stage1.x1 == 1.0e-25);

  float_state.stage1.x1 = 1.0 / 3.0;
  float_state.stage2.y2 = -1.0 / 7.0;
  effetune::dsp::quantizeLinkwitzRiley24StateToFloat(float_state);
  MULTIBAND_CHECK(float_state.stage1.x1 == static_cast<double>(static_cast<float>(1.0 / 3.0)));
  MULTIBAND_CHECK(float_state.stage2.y2 == static_cast<double>(static_cast<float>(-1.0 / 7.0)));
}

void testExplicitResetIsDeterministic() noexcept {
  KernelHarness<34> compressor(et_kernel_descriptor_MultibandCompressorPlugin());
  const auto params = compressorParams();
  compressor.stage(params);
  auto first = signal();
  compressor.process(first.data());
  compressor.kernel->reset();
  auto second = signal();
  compressor.process(second.data());
  MULTIBAND_CHECK(equal(first, second));

  KernelHarness<34> expander(et_kernel_descriptor_MultibandExpanderPlugin());
  expander.stage(expanderParams());
  first = signal();
  expander.process(first.data());
  expander.kernel->reset();
  second = signal();
  expander.process(second.data());
  MULTIBAND_CHECK(equal(first, second));
}

void testCrossoverTransitionStateContracts() noexcept {
  KernelHarness<34> warmed(et_kernel_descriptor_MultibandCompressorPlugin());
  auto compressor_params = compressorParams();
  for (std::uint32_t band = 0u; band < 5u; ++band) {
    compressor_params[4u + band] = -20.0F;
    compressor_params[9u + band] = 20.0F;
    compressor_params[14u + band] = 0.1F;
    compressor_params[19u + band] = 1000.0F;
    compressor_params[24u + band] = 0.0F;
    compressor_params[29u + band] = 0.0F;
  }
  warmed.stage(compressor_params);
  auto warmup = signal(2.0F);
  warmed.process(warmup.data());
  compressor_params[0] = 180.0F;
  warmed.stage(compressor_params);
  auto transition = signal(0.01F);
  warmed.process(transition.data());
  auto warmed_output = signal(0.01F);
  warmed.process(warmed_output.data());

  KernelHarness<34> fresh(et_kernel_descriptor_MultibandCompressorPlugin());
  fresh.stage(compressor_params);
  transition = signal(0.01F);
  fresh.process(transition.data());
  auto fresh_output = signal(0.01F);
  fresh.process(fresh_output.data());
  MULTIBAND_CHECK(!equal(warmed_output, fresh_output));

  KernelHarness<23> transient_warmed(et_kernel_descriptor_MultibandTransientPlugin());
  auto transient_params = transientParams();
  transient_warmed.stage(transient_params);
  warmup = signal(2.0F);
  transient_warmed.process(warmup.data());
  transient_params[0] = 300.0F;
  transient_warmed.stage(transient_params);
  transition = signal(0.2F);
  transient_warmed.process(transition.data());
  warmed_output = signal(0.2F);
  transient_warmed.process(warmed_output.data());

  KernelHarness<23> transient_fresh(et_kernel_descriptor_MultibandTransientPlugin());
  transient_fresh.stage(transient_params);
  transition = signal(0.2F);
  transient_fresh.process(transition.data());
  fresh_output = signal(0.2F);
  transient_fresh.process(fresh_output.data());
  MULTIBAND_CHECK(equal(warmed_output, fresh_output));
}

void testTelemetryPayloads() noexcept {
  KernelHarness<34> compressor(et_kernel_descriptor_MultibandCompressorPlugin());
  compressor.stage(compressorParams());
  auto audio = signal();
  compressor.process(audio.data());
  checkTelemetry(compressor, 5u, 0u, true);

  KernelHarness<34> expander(et_kernel_descriptor_MultibandExpanderPlugin());
  expander.stage(expanderParams());
  audio = signal();
  expander.process(audio.data());
  checkTelemetry(expander, 5u, 1u, true);

  KernelHarness<23> transient(et_kernel_descriptor_MultibandTransientPlugin());
  transient.stage(transientParams());
  audio = signal();
  transient.process(audio.data());
  checkTelemetry(transient, 3u, 2u, false);
}

} // namespace

int main() {
  testDescriptors();
  testLinkwitzRileyPrecisionContract();
  testExplicitResetIsDeterministic();
  testCrossoverTransitionStateContracts();
  testTelemetryPayloads();
  if (failures != 0) {
    std::fprintf(stderr, "Multiband native tests failed: %d\n", failures);
    return 1;
  }
  std::puts("Multiband native tests passed");
  return 0;
}
