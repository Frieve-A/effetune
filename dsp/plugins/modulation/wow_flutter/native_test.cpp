#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_WowFlutterPlugin() noexcept;

namespace {

constexpr std::uint32_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kFrames = 4096u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "wow_flutter/native_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define WOW_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

void fillInput(float *audio, std::uint32_t channels) noexcept {
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
      const std::uint32_t pattern = (frame * 17u + channel * 13u) % 257u;
      audio[static_cast<std::size_t>(channel) * kFrames + frame] =
          static_cast<float>(pattern) / 128.0F - 1.0F;
    }
  }
}

void testSeedResetAndChannelChange() {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_WowFlutterPlugin();
  WOW_CHECK(descriptor != nullptr);
  WOW_CHECK(descriptor->paramsFloatCount == 7u);
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> object_storage{};
  WOW_CHECK(descriptor->objectSize <= object_storage.size());
  effetune::PluginKernel *kernel = descriptor->construct(object_storage.data());
  WOW_CHECK(kernel != nullptr);
  kernel->prepare({48000.0F, 2u, kFrames});
  kernel->setRandomSeed(0x12345678u, 0x9abcdef0u);
  const std::array<float, 7u> params{0.5F, 6.0F, 10.0F, 5.0F, -6.0F, 0.0F, 100.0F};
  WOW_CHECK(kernel->stageParameters(params.data(), 7u, descriptor->paramsHash) == ET_OK);
  kernel->applyPendingParameters();

  std::array<float, kFrames * 2u> first{};
  std::array<float, kFrames * 2u> second{};
  fillInput(first.data(), 2u);
  second = first;
  kernel->process(first.data(), 2u, kFrames, {0.0});
  kernel->reset();
  kernel->process(second.data(), 2u, kFrames, {0.0});
  for (std::size_t index = 0u; index < first.size(); ++index) {
    WOW_CHECK(first[index] == second[index]);
    WOW_CHECK(std::isfinite(first[index]));
  }

  fillInput(first.data(), 2u);
  kernel->process(first.data(), 2u, kFrames, {0.0});
  std::array<float, kFrames> mono{};
  fillInput(mono.data(), 1u);
  kernel->process(mono.data(), 1u, kFrames, {0.0});
  for (float sample : mono) {
    WOW_CHECK(std::isfinite(sample));
  }

  descriptor->destroy(kernel);
}

} // namespace

int main() {
  testSeedResetAndChannelChange();
  if (failures != 0) {
    std::fprintf(stderr, "%d Wow Flutter contract check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Wow Flutter seed and state tests passed");
  return 0;
}
