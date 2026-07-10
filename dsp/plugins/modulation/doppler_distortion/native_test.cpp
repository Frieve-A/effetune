#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_DopplerDistortionPlugin() noexcept;

namespace {

constexpr std::uint32_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kFrames = 4096u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "doppler_distortion/native_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define DOPPLER_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

void fillInput(float *audio, std::uint32_t channels) noexcept {
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
      const float sign = (frame & 1u) == 0u ? 1.0F : -1.0F;
      audio[static_cast<std::size_t>(channel) * kFrames + frame] =
          sign * (0.1F + static_cast<float>(channel) * 0.05F);
    }
  }
}

void testResetAndChannelTransition() {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_DopplerDistortionPlugin();
  DOPPLER_CHECK(descriptor != nullptr);
  DOPPLER_CHECK(descriptor->paramsFloatCount == 4u);

  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> object_storage{};
  DOPPLER_CHECK(descriptor->objectSize <= object_storage.size());
  effetune::PluginKernel *kernel = descriptor->construct(object_storage.data());
  DOPPLER_CHECK(kernel != nullptr);
  kernel->prepare({48000.0F, 2u, kFrames});
  const std::array<float, 4u> params{8.0F, 0.03F, 6000.0F, 1.5F};
  DOPPLER_CHECK(kernel->stageParameters(params.data(), 4u, descriptor->paramsHash) == ET_OK);
  kernel->applyPendingParameters();

  std::array<float, kFrames * 2u> first{};
  std::array<float, kFrames * 2u> second{};
  fillInput(first.data(), 2u);
  second = first;
  kernel->process(first.data(), 2u, kFrames, {0.0});
  kernel->reset();
  kernel->process(second.data(), 2u, kFrames, {0.0});
  for (std::size_t index = 0u; index < first.size(); ++index) {
    DOPPLER_CHECK(first[index] == second[index]);
    DOPPLER_CHECK(std::isfinite(first[index]));
  }

  fillInput(first.data(), 2u);
  kernel->process(first.data(), 2u, kFrames, {0.0});
  std::array<float, kFrames> transitioned{};
  std::array<float, kFrames> fresh{};
  fillInput(transitioned.data(), 1u);
  fresh = transitioned;
  kernel->process(transitioned.data(), 1u, kFrames, {0.0});
  kernel->reset();
  kernel->process(fresh.data(), 1u, kFrames, {0.0});
  for (std::size_t index = 0u; index < fresh.size(); ++index) {
    DOPPLER_CHECK(transitioned[index] == fresh[index]);
  }

  descriptor->destroy(kernel);
}

} // namespace

int main() {
  testResetAndChannelTransition();
  if (failures != 0) {
    std::fprintf(stderr, "%d Doppler Distortion contract check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Doppler Distortion state tests passed");
  return 0;
}
