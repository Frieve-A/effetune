#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_MultibandBalancePlugin() noexcept;

namespace {

constexpr std::uint32_t kMaxFrames = 128u;
constexpr std::uint32_t kMaxChannels = 8u;
constexpr std::uint32_t kParamCount = 9u;
constexpr std::uint32_t kStorageBytes = 8192u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "spatial/multiband_balance/native_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define MULTIBAND_BALANCE_CHECK(expression)                                                        \
  check(static_cast<bool>(expression), #expression, __LINE__)

using AudioBuffer = std::array<float, kMaxFrames * kMaxChannels>;
using ParamBuffer = std::array<float, kParamCount>;

ParamBuffer defaultParams() noexcept {
  return {100.0F, 500.0F, 2000.0F, 8000.0F, 0.0F, 0.0F, 0.0F, 0.0F, 0.0F};
}

AudioBuffer signal(std::uint32_t channel_count, std::uint32_t frame_count,
                   float scale = 1.0F) noexcept {
  AudioBuffer audio{};
  for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const int phase = static_cast<int>((frame * 11u + channel * 5u) % 29u) - 14;
      audio[static_cast<std::size_t>(channel) * frame_count + frame] =
          static_cast<float>(phase) * 0.025F * scale;
    }
  }
  return audio;
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

  explicit KernelHarness(float sample_rate = 48000.0F) {
    descriptor = et_kernel_descriptor_MultibandBalancePlugin();
    MULTIBAND_BALANCE_CHECK(descriptor != nullptr);
    MULTIBAND_BALANCE_CHECK(descriptor != nullptr && descriptor->objectSize <= storage.size());
    if (descriptor == nullptr || descriptor->objectSize > storage.size())
      return;
    kernel = descriptor->construct(storage.data());
    MULTIBAND_BALANCE_CHECK(kernel != nullptr);
    if (kernel != nullptr) {
      kernel->prepare({sample_rate, kMaxChannels, kMaxFrames});
    }
  }

  ~KernelHarness() {
    if (kernel != nullptr)
      descriptor->destroy(kernel);
  }

  void stage(const ParamBuffer &params) noexcept {
    MULTIBAND_BALANCE_CHECK(kernel != nullptr);
    if (kernel == nullptr)
      return;
    MULTIBAND_BALANCE_CHECK(
        kernel->stageParameters(params.data(), kParamCount, descriptor->paramsHash) == ET_OK);
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

void testDescriptorAndCapacity() noexcept {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_MultibandBalancePlugin();
  MULTIBAND_BALANCE_CHECK(descriptor != nullptr);
  MULTIBAND_BALANCE_CHECK(descriptor != nullptr && descriptor->paramsHash == 0xdd7a7ec7u);
  MULTIBAND_BALANCE_CHECK(descriptor != nullptr && descriptor->paramsFloatCount == kParamCount);
  MULTIBAND_BALANCE_CHECK(descriptor != nullptr && descriptor->paramsByteCapacity == 0u);
  MULTIBAND_BALANCE_CHECK(descriptor != nullptr && descriptor->objectSize <= kStorageBytes);

  KernelHarness harness(192000.0F);
  harness.stage(defaultParams());
  AudioBuffer audio = signal(kMaxChannels, kMaxFrames);
  harness.process(audio, kMaxChannels, kMaxFrames);
  MULTIBAND_BALANCE_CHECK(harness.kernel != nullptr && harness.kernel->latencySamples() == 0u);
}

void testExplicitReset() noexcept {
  KernelHarness harness;
  harness.stage(defaultParams());
  AudioBuffer first = signal(2u, kMaxFrames);
  harness.process(first, 2u, kMaxFrames);
  harness.kernel->reset();
  AudioBuffer second = signal(2u, kMaxFrames);
  harness.process(second, 2u, kMaxFrames);
  MULTIBAND_BALANCE_CHECK(equal(first, second, 2u * kMaxFrames));
}

void testFrequencyChangeResetsState() noexcept {
  KernelHarness changed;
  changed.stage(defaultParams());
  AudioBuffer warmup = signal(2u, kMaxFrames, 1.5F);
  changed.process(warmup, 2u, kMaxFrames);

  ParamBuffer updated = defaultParams();
  updated[0] = 240.0F;
  updated[1] = 1200.0F;
  updated[2] = 4600.0F;
  updated[3] = 12000.0F;
  changed.stage(updated);
  AudioBuffer actual = signal(2u, 73u, 0.6F);
  changed.process(actual, 2u, 73u);

  KernelHarness fresh;
  fresh.stage(updated);
  AudioBuffer expected = signal(2u, 73u, 0.6F);
  fresh.process(expected, 2u, 73u);
  MULTIBAND_BALANCE_CHECK(equal(actual, expected, 146u));
}

void testBalanceChangePreservesState() noexcept {
  KernelHarness warmed;
  warmed.stage(defaultParams());
  AudioBuffer warmup = signal(2u, kMaxFrames, 1.25F);
  warmed.process(warmup, 2u, kMaxFrames);

  ParamBuffer balanced = defaultParams();
  balanced[4] = -80.0F;
  balanced[5] = 60.0F;
  balanced[6] = -40.0F;
  balanced[7] = 20.0F;
  balanced[8] = 100.0F;
  warmed.stage(balanced);
  AudioBuffer continued = signal(2u, 91u, 0.5F);
  warmed.process(continued, 2u, 91u);

  KernelHarness fresh;
  fresh.stage(balanced);
  AudioBuffer restarted = signal(2u, 91u, 0.5F);
  fresh.process(restarted, 2u, 91u);
  MULTIBAND_BALANCE_CHECK(!equal(continued, restarted, 182u));
}

void testChannelChangeResetsState() noexcept {
  KernelHarness changed;
  changed.stage(defaultParams());
  AudioBuffer warmup = signal(2u, kMaxFrames, 1.4F);
  changed.process(warmup, 2u, kMaxFrames);
  AudioBuffer actual = signal(4u, 79u, 0.65F);
  changed.process(actual, 4u, 79u);

  KernelHarness fresh;
  fresh.stage(defaultParams());
  AudioBuffer expected = signal(4u, 79u, 0.65F);
  fresh.process(expected, 4u, 79u);
  MULTIBAND_BALANCE_CHECK(equal(actual, expected, 316u));
}

void testMonoBypassFreezesState() noexcept {
  KernelHarness bypassed;
  KernelHarness uninterrupted;
  bypassed.stage(defaultParams());
  uninterrupted.stage(defaultParams());
  AudioBuffer prefix_a = signal(2u, 97u, 1.1F);
  AudioBuffer prefix_b = prefix_a;
  bypassed.process(prefix_a, 2u, 97u);
  uninterrupted.process(prefix_b, 2u, 97u);

  AudioBuffer mono = signal(1u, 53u, 2.0F);
  const AudioBuffer mono_input = mono;
  bypassed.process(mono, 1u, 53u);
  MULTIBAND_BALANCE_CHECK(equal(mono, mono_input, 53u));

  AudioBuffer suffix_a = signal(2u, 113u, 0.7F);
  AudioBuffer suffix_b = suffix_a;
  bypassed.process(suffix_a, 2u, 113u);
  uninterrupted.process(suffix_b, 2u, 113u);
  MULTIBAND_BALANCE_CHECK(equal(suffix_a, suffix_b, 226u));
}

} // namespace

int main() {
  testDescriptorAndCapacity();
  testExplicitReset();
  testFrequencyChangeResetsState();
  testBalanceChangePreservesState();
  testChannelChangeResetsState();
  testMonoBypassFreezesState();
  if (failures != 0) {
    std::fprintf(stderr, "Multiband balance native tests failed: %d\n", failures);
    return 1;
  }
  std::puts("Multiband balance native tests passed");
  return 0;
}
