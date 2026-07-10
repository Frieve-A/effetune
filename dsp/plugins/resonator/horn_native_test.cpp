#include "allocation_guard.h"
#include "effetune/kernel.h"

#include "horn_waveguide_common.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_HornResonatorPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_HornResonatorPlusPlugin() noexcept;

namespace {

constexpr std::uint32_t kFrames = 128u;
constexpr std::uint32_t kMaxChannels = 2u;
constexpr std::uint32_t kStorageBytes = 16384u;
constexpr std::uint32_t kParamCount = 8u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "resonator/horn_native_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define HORN_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

using AudioBuffer = std::array<float, kFrames * kMaxChannels>;
using ParamBuffer = std::array<float, kParamCount>;

ParamBuffer defaultParams(float waveguide_gain = 30.0F) noexcept {
  return {600.0F, 70.0F, 3.0F, 60.0F, 40.0F, 0.03F, 0.99F, waveguide_gain};
}

AudioBuffer signal(std::uint32_t channel_count, std::uint32_t frame_count,
                   float scale = 1.0F) noexcept {
  AudioBuffer result{};
  for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const int phase = static_cast<int>((frame * 7u + channel * 3u) % 19u) - 9;
      result[static_cast<std::size_t>(channel) * frame_count + frame] =
          static_cast<float>(phase) * 0.035F * scale;
    }
  }
  return result;
}

bool equal(const AudioBuffer &left, const AudioBuffer &right, std::uint32_t sample_count) noexcept {
  for (std::uint32_t index = 0u; index < sample_count; ++index) {
    if (left[index] != right[index])
      return false;
  }
  return true;
}

struct KernelHarness final {
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> storage{};
  const effetune::KernelDescriptor *descriptor = nullptr;
  effetune::PluginKernel *kernel = nullptr;

  explicit KernelHarness(const effetune::KernelDescriptor *source) : descriptor(source) {
    HORN_CHECK(descriptor != nullptr);
    HORN_CHECK(descriptor != nullptr && descriptor->objectSize <= storage.size());
    if (descriptor == nullptr || descriptor->objectSize > storage.size())
      return;
    kernel = descriptor->construct(storage.data());
    HORN_CHECK(kernel != nullptr);
    if (kernel != nullptr)
      kernel->prepare({48000.0F, kMaxChannels, kFrames});
  }

  ~KernelHarness() {
    if (kernel != nullptr)
      descriptor->destroy(kernel);
  }

  void stage(const ParamBuffer &params) noexcept {
    HORN_CHECK(kernel != nullptr);
    if (kernel == nullptr)
      return;
    HORN_CHECK(kernel->stageParameters(params.data(), kParamCount, descriptor->paramsHash) ==
               ET_OK);
  }

  void process(AudioBuffer &audio, std::uint32_t channel_count,
               std::uint32_t frame_count) noexcept {
    if (kernel == nullptr)
      return;
    kernel->applyPendingParameters();
    effetune::allocation_guard::Scope allocation_scope;
    kernel->process(audio.data(), channel_count, frame_count, {0.0});
  }
};

void testDescriptorsAndCapacity() noexcept {
  const effetune::KernelDescriptor *base = et_kernel_descriptor_HornResonatorPlugin();
  const effetune::KernelDescriptor *plus = et_kernel_descriptor_HornResonatorPlusPlugin();
  HORN_CHECK(base != nullptr && base->paramsHash == 0xc0bf4f84u);
  HORN_CHECK(plus != nullptr && plus->paramsHash == 0xc0bf4f84u);
  HORN_CHECK(base != nullptr && base->paramsFloatCount == kParamCount);
  HORN_CHECK(plus != nullptr && plus->paramsFloatCount == kParamCount);
  HORN_CHECK(base != nullptr && base->paramsByteCapacity == 0u);
  HORN_CHECK(plus != nullptr && plus->paramsByteCapacity == 0u);
  HORN_CHECK(base != nullptr && base->objectSize <= 8192u);
  HORN_CHECK(plus != nullptr && plus->objectSize <= 8192u);
  HORN_CHECK(effetune::plugins::resonator::horn_waveguide::segmentCount(192000.0, 1.2) == 672u);

  KernelHarness base_harness(base);
  KernelHarness plus_harness(plus);
  HORN_CHECK(base_harness.kernel != nullptr && base_harness.kernel->latencySamples() == 0u);
  HORN_CHECK(plus_harness.kernel != nullptr && plus_harness.kernel->latencySamples() == 0u);
}

void testExplicitReset(const effetune::KernelDescriptor *descriptor) noexcept {
  KernelHarness harness(descriptor);
  harness.stage(defaultParams());
  AudioBuffer first = signal(1u, kFrames);
  harness.process(first, 1u, kFrames);
  harness.kernel->reset();
  AudioBuffer second = signal(1u, kFrames);
  harness.process(second, 1u, kFrames);
  HORN_CHECK(equal(first, second, kFrames));
}

void testChannelResetSequence(const effetune::KernelDescriptor *descriptor) noexcept {
  KernelHarness changing(descriptor);
  changing.stage(defaultParams());
  AudioBuffer warmup = signal(1u, kFrames, 1.5F);
  changing.process(warmup, 1u, kFrames);

  AudioBuffer two_channels = signal(2u, 64u, 0.75F);
  changing.process(two_channels, 2u, 64u);
  KernelHarness fresh_two(descriptor);
  fresh_two.stage(defaultParams());
  AudioBuffer expected_two = signal(2u, 64u, 0.75F);
  fresh_two.process(expected_two, 2u, 64u);
  HORN_CHECK(equal(two_channels, expected_two, 128u));

  AudioBuffer one_channel = signal(1u, 73u, 0.5F);
  changing.process(one_channel, 1u, 73u);
  KernelHarness fresh_one(descriptor);
  fresh_one.stage(defaultParams());
  AudioBuffer expected_one = signal(1u, 73u, 0.5F);
  fresh_one.process(expected_one, 1u, 73u);
  HORN_CHECK(equal(one_channel, expected_one, 73u));
}

void testWaveguideGainPreservesState(const effetune::KernelDescriptor *descriptor) noexcept {
  KernelHarness warmed(descriptor);
  warmed.stage(defaultParams());
  AudioBuffer warmup = signal(1u, kFrames, 1.25F);
  warmed.process(warmup, 1u, kFrames);
  warmed.stage(defaultParams(-18.0F));
  AudioBuffer continued = signal(1u, kFrames, 0.5F);
  warmed.process(continued, 1u, kFrames);

  KernelHarness fresh(descriptor);
  fresh.stage(defaultParams(-18.0F));
  AudioBuffer restarted = signal(1u, kFrames, 0.5F);
  fresh.process(restarted, 1u, kFrames);
  HORN_CHECK(!equal(continued, restarted, kFrames));
}

} // namespace

int main() {
  const effetune::KernelDescriptor *base = et_kernel_descriptor_HornResonatorPlugin();
  const effetune::KernelDescriptor *plus = et_kernel_descriptor_HornResonatorPlusPlugin();
  testDescriptorsAndCapacity();
  testExplicitReset(base);
  testExplicitReset(plus);
  testChannelResetSequence(base);
  testChannelResetSequence(plus);
  testWaveguideGainPreservesState(base);
  testWaveguideGainPreservesState(plus);
  if (failures != 0) {
    std::fprintf(stderr, "Horn resonator native tests failed: %d\n", failures);
    return 1;
  }
  std::puts("Horn resonator native tests passed");
  return 0;
}
