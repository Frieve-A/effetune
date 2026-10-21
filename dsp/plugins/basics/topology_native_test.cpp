#include "../../generated/cpp/MultiChannelPanelPluginParams.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_ChannelDividerPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_MatrixPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_MultiChannelPanelPlugin() noexcept;

namespace {

constexpr std::uint32_t kKernelStorageBytes = 16384u;
constexpr std::uint32_t kTelemetryBytes = 1024u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "basics/topology_native_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define TOPOLOGY_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

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

bool near(float actual, float expected, float tolerance = 1.0e-6F) noexcept {
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
  std::uint32_t sequence = 0u;

  KernelHarness(const effetune::KernelDescriptor *source, float sample_rate,
                std::uint32_t max_channels, std::uint32_t max_frames)
      : ring_storage(kTelemetryBytes), output(kTelemetryBytes), descriptor(source) {
    TOPOLOGY_CHECK(descriptor != nullptr);
    TOPOLOGY_CHECK(descriptor != nullptr && descriptor->objectSize <= object_storage.size());
    if (descriptor == nullptr || descriptor->objectSize > object_storage.size())
      return;
    kernel = descriptor->construct(object_storage.data());
    TOPOLOGY_CHECK(kernel != nullptr);
    ring.adopt(ring_storage.data(), static_cast<std::uint32_t>(ring_storage.size()));
    if (kernel != nullptr) {
      kernel->prepare({sample_rate, max_channels, max_frames});
      kernel->reset();
    }
  }

  ~KernelHarness() {
    if (kernel != nullptr)
      descriptor->destroy(kernel);
  }

  void process(float *audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    kernel->applyPendingParameters();
    kernel->process(audio, channels, frames, {0.0});
  }

  std::uint32_t telemetry() noexcept {
    effetune::TelemetryWriter writer(ring, 77u, sequence);
    kernel->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
    TOPOLOGY_CHECK(dropped == 0u);
    return bytes;
  }
};

void checkFrameHeader(const KernelHarness &harness, std::uint16_t frame_type,
                      std::uint16_t payload_bytes) noexcept {
  const std::uint8_t *frame = harness.output.data();
  TOPOLOGY_CHECK(readU16(frame) == frame_type);
  TOPOLOGY_CHECK(readU16(frame + 2u) == 1u);
  TOPOLOGY_CHECK(readU32(frame + 4u) == 77u);
  TOPOLOGY_CHECK(readU32(frame + 8u) == 0u);
  TOPOLOGY_CHECK(readU16(frame + 12u) == payload_bytes);
  TOPOLOGY_CHECK(readU16(frame + 14u) == 0u);
}

void testDescriptorsAndChannelCountFrames() {
  const effetune::KernelDescriptor *divider = et_kernel_descriptor_ChannelDividerPlugin();
  const effetune::KernelDescriptor *matrix = et_kernel_descriptor_MatrixPlugin();
  const effetune::KernelDescriptor *panel = et_kernel_descriptor_MultiChannelPanelPlugin();
  TOPOLOGY_CHECK(divider != nullptr && divider->paramsHash == 0xea073d60u);
  TOPOLOGY_CHECK(divider != nullptr && divider->paramsFloatCount == 7u);
  TOPOLOGY_CHECK(divider != nullptr && divider->paramsByteCapacity == 0u);
  TOPOLOGY_CHECK(matrix != nullptr && matrix->paramsHash == 0x07080f45u);
  TOPOLOGY_CHECK(matrix != nullptr && matrix->paramsFloatCount == 0u);
  TOPOLOGY_CHECK(matrix != nullptr && matrix->paramsByteCapacity == 3076u);
  TOPOLOGY_CHECK(panel != nullptr && panel->paramsHash == 0x9d3d18b9u);
  TOPOLOGY_CHECK(panel != nullptr && panel->paramsFloatCount == 79u);
  TOPOLOGY_CHECK(panel != nullptr && panel->paramsByteCapacity == 0u);

  KernelHarness divider_harness(divider, 48000.0F, 8u, 16u);
  std::array<float, 7> divider_params = {2.0F, 2000.0F, -24.0F, 4000.0F, -24.0F, 8000.0F, -24.0F};
  TOPOLOGY_CHECK(divider_harness.kernel->stageParameters(
                     divider_params.data(), static_cast<std::uint32_t>(divider_params.size()),
                     divider->paramsHash) == ET_OK);
  std::array<float, 64> divider_audio{};
  divider_audio[0] = 1.0F;
  divider_harness.process(divider_audio.data(), 4u, 16u);
  TOPOLOGY_CHECK(divider_harness.telemetry() == 20u);
  checkFrameHeader(divider_harness, 9u, 4u);
  TOPOLOGY_CHECK(readU32(divider_harness.output.data() + 16u) == 4u);

  KernelHarness matrix_harness(matrix, 48000.0F, 8u, 8u);
  TOPOLOGY_CHECK(matrix_harness.kernel->stageParameters(nullptr, 0u, matrix->paramsHash) == ET_OK);
  constexpr std::array<std::uint8_t, 10> routes = {1u, 0u, 2u, 0u, 0u, 0u, 0u, 1u, 1u, 0u};
  TOPOLOGY_CHECK(
      matrix_harness.kernel->stageParameterBytes(
          routes.data(), static_cast<std::uint32_t>(routes.size()), matrix->paramsHash) == ET_OK);
  std::array<float, 16> matrix_audio{};
  matrix_harness.process(matrix_audio.data(), 2u, 8u);
  TOPOLOGY_CHECK(matrix_harness.telemetry() == 20u);
  checkFrameHeader(matrix_harness, 9u, 4u);
  TOPOLOGY_CHECK(readU32(matrix_harness.output.data() + 16u) == 2u);

  std::array<std::uint8_t, 9> truncated = {1u, 0u, 2u, 0u, 0u, 0u, 0u, 1u, 1u};
  TOPOLOGY_CHECK(matrix_harness.kernel->stageParameterBytes(
                     truncated.data(), static_cast<std::uint32_t>(truncated.size()),
                     matrix->paramsHash) == ET_ERR_ARGS);
}

void testMatrixResetPreservesRoutingParameters() {
  const auto *descriptor = et_kernel_descriptor_MatrixPlugin();
  KernelHarness harness(descriptor, 48000.0F, 4u, 1u);
  const std::array<float, 4> input = {0.25F, 0.125F, 0.75F, 0.5F};
  const auto render = [&]() {
    auto audio = input;
    harness.process(audio.data(), 4u, 1u);
    return audio;
  };
  const std::array<float, 4> defaults = {0.25F, 0.125F, 0.0F, 0.0F};
  TOPOLOGY_CHECK(render() == defaults);

  // mx = "00021112": preserve channels 1/2 and mix both into channel 3.
  constexpr std::array<std::uint8_t, 16> routes = {1u, 0u, 4u, 0u, 0u, 0u, 0u, 0u,
                                                   2u, 0u, 1u, 1u, 0u, 1u, 2u, 0u};
  TOPOLOGY_CHECK(harness.kernel->stageParameterBytes(routes.data(),
                                                     static_cast<std::uint32_t>(routes.size()),
                                                     descriptor->paramsHash) == ET_OK);
  harness.kernel->reset();
  const std::array<float, 4> mixed = {0.25F, 0.125F, 0.375F, 0.0F};
  TOPOLOGY_CHECK(render() == mixed);
  harness.kernel->reset();
  TOPOLOGY_CHECK(render() == mixed);
  TOPOLOGY_CHECK(render() == mixed);

  constexpr std::array<std::uint8_t, 4> empty_routes = {1u, 0u, 0u, 0u};
  TOPOLOGY_CHECK(harness.kernel->stageParameterBytes(
                     empty_routes.data(), static_cast<std::uint32_t>(empty_routes.size()),
                     descriptor->paramsHash) == ET_OK);
  harness.kernel->reset();
  const std::array<float, 4> silence{};
  TOPOLOGY_CHECK(render() == silence);
  harness.kernel->reset();
  TOPOLOGY_CHECK(render() == silence);
}

void testChannelDividerOutOfRangeSlopeClampsToSectionCapacity() {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_ChannelDividerPlugin();
  constexpr std::array<float, 7> maximum_slope = {2.0F,   2000.0F, -96.0F, 4000.0F,
                                                  -24.0F, 8000.0F, -24.0F};
  std::array<float, 7> out_of_range = maximum_slope;
  out_of_range[2] = -108.0F;
  std::array<float, 128> input{};
  for (std::uint32_t frame = 0u; frame < 32u; ++frame) {
    input[frame] = static_cast<float>(0.6 * std::sin(static_cast<double>(frame) * 0.19));
    input[32u + frame] = static_cast<float>(0.4 * std::cos(static_cast<double>(frame) * 0.13));
  }

  KernelHarness bounded(descriptor, 48000.0F, 4u, 32u);
  TOPOLOGY_CHECK(bounded.kernel->stageParameters(maximum_slope.data(),
                                                 static_cast<std::uint32_t>(maximum_slope.size()),
                                                 descriptor->paramsHash) == ET_OK);
  std::array<float, 128> expected = input;
  bounded.process(expected.data(), 4u, 32u);

  KernelHarness defended(descriptor, 48000.0F, 4u, 32u);
  TOPOLOGY_CHECK(defended.kernel->stageParameters(out_of_range.data(),
                                                  static_cast<std::uint32_t>(out_of_range.size()),
                                                  descriptor->paramsHash) == ET_OK);
  std::array<float, 128> actual = input;
  defended.process(actual.data(), 4u, 32u);

  for (const float sample : actual)
    TOPOLOGY_CHECK(std::isfinite(sample));
  TOPOLOGY_CHECK(actual == expected);
}

void testMultiChannelLevelFrame() {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_MultiChannelPanelPlugin();
  KernelHarness harness(descriptor, 3000.0F, 8u, 10u);
  std::array<float, effetune::generated::MultiChannelPanelPluginParams::kFloatCount> params{};
  params[1] = 1.0F;
  TOPOLOGY_CHECK(harness.kernel->stageParameters(params.data(),
                                                 static_cast<std::uint32_t>(params.size()),
                                                 descriptor->paramsHash) == ET_OK);
  std::array<float, 20> audio{};
  for (std::uint32_t frame = 0u; frame < 10u; ++frame) {
    audio[frame] = (frame & 1u) == 0u ? 0.25F : -0.25F;
    audio[10u + frame] = (frame & 1u) == 0u ? -0.75F : 0.75F;
  }
  harness.process(audio.data(), 2u, 10u);
  for (std::uint32_t frame = 0u; frame < 10u; ++frame) {
    TOPOLOGY_CHECK(audio[10u + frame] == 0.0F);
  }

  TOPOLOGY_CHECK(harness.telemetry() == 36u);
  checkFrameHeader(harness, 10u, 20u);
  const std::uint8_t *payload = harness.output.data() + 16u;
  TOPOLOGY_CHECK(payload[0] == 2u);
  TOPOLOGY_CHECK(payload[1] == 0u && payload[2] == 0u && payload[3] == 0u);
  TOPOLOGY_CHECK(near(readF32(payload + 4u), 0.25F));
  TOPOLOGY_CHECK(payload[8u] == 0u);
  TOPOLOGY_CHECK(payload[9u] == 0u && payload[10u] == 0u && payload[11u] == 0u);
  TOPOLOGY_CHECK(near(readF32(payload + 12u), 0.75F));
  TOPOLOGY_CHECK(payload[16u] == 1u);
  TOPOLOGY_CHECK(payload[17u] == 0u && payload[18u] == 0u && payload[19u] == 0u);
}

void testMultiChannelPeakWindowWithIrregularBlocks() {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_MultiChannelPanelPlugin();
  KernelHarness harness(descriptor, 960.0F, 1u, 17u);
  std::array<float, effetune::generated::MultiChannelPanelPluginParams::kFloatCount> params{};
  TOPOLOGY_CHECK(harness.kernel->stageParameters(params.data(),
                                                 static_cast<std::uint32_t>(params.size()),
                                                 descriptor->paramsHash) == ET_OK);

  const std::array<std::uint32_t, 4> block_sizes = {5u, 3u, 7u, 17u};
  bool first_sample = true;
  for (const std::uint32_t block_size : block_sizes) {
    std::vector<float> audio(block_size, 0.25F);
    if (first_sample) {
      audio[0] = 1.0F;
      first_sample = false;
    }
    harness.process(audio.data(), 1u, block_size);
  }

  TOPOLOGY_CHECK(harness.telemetry() == 28u);
  checkFrameHeader(harness, 10u, 12u);
  TOPOLOGY_CHECK(near(readF32(harness.output.data() + 20u), 1.0F));

  std::array<float, 1> next = {0.1F};
  harness.process(next.data(), 1u, 1u);
  TOPOLOGY_CHECK(harness.telemetry() == 28u);
  TOPOLOGY_CHECK(near(readF32(harness.output.data() + 20u), 0.25F));
}

} // namespace

int main() {
  testDescriptorsAndChannelCountFrames();
  testMatrixResetPreservesRoutingParameters();
  testChannelDividerOutOfRangeSlopeClampsToSectionCapacity();
  testMultiChannelLevelFrame();
  testMultiChannelPeakWindowWithIrregularBlocks();
  if (failures != 0) {
    std::fprintf(stderr, "Basics topology native tests failed: %d\n", failures);
    return 1;
  }
  std::puts("Basics topology native tests passed");
  return 0;
}
