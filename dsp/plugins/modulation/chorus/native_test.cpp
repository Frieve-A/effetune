#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_ChorusPlugin() noexcept;

namespace {

constexpr std::uint32_t kStorageBytes = 8192u;
constexpr std::uint32_t kFrames = 4096u;
constexpr std::uint32_t kWrapFrames = 6000u;
int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Chorus check failed: %s\n", message);
    ++failures;
  }
}

void fill(float *audio, std::uint32_t channels) noexcept {
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
      audio[static_cast<std::size_t>(channel) * kFrames + frame] =
          static_cast<float>(std::sin(0.017 * static_cast<double>(frame + channel * 11u)) * 0.5);
    }
  }
}

void testResetReplayAndLimits() {
  const auto *descriptor = et_kernel_descriptor_ChorusPlugin();
  check(descriptor != nullptr && descriptor->paramsFloatCount == 8u, "descriptor contract");
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> storage{};
  auto *kernel = descriptor->construct(storage.data());
  kernel->prepare({192000.0F, 8u, kFrames});
  check(kernel->preparedSuccessfully(), "maximum prepare capacity");
  const std::array<float, 8u> params{3.0F, 4.0F, 2.0F, 1.8F, 1.0F, 75.0F, -75.0F, 50.0F};
  check(kernel->stageParameters(params.data(), static_cast<std::uint32_t>(params.size()),
                                descriptor->paramsHash) == ET_OK,
        "parameter staging");
  kernel->applyPendingParameters();
  std::array<float, kFrames * 8u> first{};
  std::array<float, kFrames * 8u> second{};
  fill(first.data(), 8u);
  second = first;
  kernel->process(first.data(), 8u, kFrames, {0.0});
  kernel->reset();
  kernel->process(second.data(), 8u, kFrames, {0.0});
  for (std::size_t index = 0u; index < first.size(); ++index) {
    check(std::isfinite(first[index]), "finite maximum-capacity output");
    check(first[index] == second[index], "reset replay");
  }
  descriptor->destroy(kernel);
}

void testEnsembleBasePhaseWrapContinuity() {
  const auto *descriptor = et_kernel_descriptor_ChorusPlugin();
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> storage{};
  auto *kernel = descriptor->construct(storage.data());
  kernel->prepare({48000.0F, 1u, kWrapFrames});
  const std::array<float, 8u> params{2.0F, 10.0F, 20.0F, 6.0F, 6.0F, 0.0F, 0.0F, 100.0F};
  check(kernel->stageParameters(params.data(), static_cast<std::uint32_t>(params.size()),
                                descriptor->paramsHash) == ET_OK,
        "Ensemble parameter staging");
  kernel->applyPendingParameters();
  std::array<float, kWrapFrames> audio{};
  for (std::uint32_t frame = 0u; frame < kWrapFrames; ++frame)
    audio[frame] = static_cast<float>(frame) / static_cast<float>(kWrapFrames);
  kernel->process(audio.data(), 1u, kWrapFrames, {0.0});
  check(std::abs(audio[4800] - audio[4799]) < 0.003F,
        "Ensemble remains continuous across the 10 Hz base-phase wrap");
  descriptor->destroy(kernel);
}

void testStereoChorusSpreadIsActiveOnFirstBlock() {
  const auto *descriptor = et_kernel_descriptor_ChorusPlugin();
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> narrow_storage{};
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> wide_storage{};
  auto *narrow = descriptor->construct(narrow_storage.data());
  auto *wide = descriptor->construct(wide_storage.data());
  narrow->prepare({48000.0F, 2u, kFrames});
  wide->prepare({48000.0F, 2u, kFrames});
  const std::array<float, 8u> narrow_params{1.0F, 0.65F, 15.0F, 4.0F, 2.0F, 0.0F, 0.0F, 100.0F};
  auto wide_params = narrow_params;
  wide_params[5] = 80.0F;
  check(narrow->stageParameters(narrow_params.data(),
                                static_cast<std::uint32_t>(narrow_params.size()),
                                descriptor->paramsHash) == ET_OK,
        "narrow Stereo Chorus parameter staging");
  check(wide->stageParameters(wide_params.data(), static_cast<std::uint32_t>(wide_params.size()),
                              descriptor->paramsHash) == ET_OK,
        "wide Stereo Chorus parameter staging");
  narrow->applyPendingParameters();
  wide->applyPendingParameters();

  std::array<float, kFrames * 2u> narrow_audio{};
  for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
    const float sample = static_cast<float>(std::sin(0.017 * static_cast<double>(frame)) * 0.5);
    narrow_audio[frame] = sample;
    narrow_audio[kFrames + frame] = sample;
  }
  auto wide_audio = narrow_audio;
  narrow->process(narrow_audio.data(), 2u, kFrames, {0.0});
  wide->process(wide_audio.data(), 2u, kFrames, {0.0});

  bool wide_channels_differ = false;
  for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
    check(std::isfinite(wide_audio[frame]) && std::isfinite(wide_audio[kFrames + frame]),
          "finite Stereo Chorus output");
    check(narrow_audio[frame] == narrow_audio[kFrames + frame],
          "zero spread preserves identical stereo channels");
    check(wide_audio[frame] == narrow_audio[frame],
          "spread does not alter the left side of a stereo pair");
    if (wide_audio[frame] != wide_audio[kFrames + frame])
      wide_channels_differ = true;
  }
  check(wide_channels_differ, "active Stereo Chorus applies non-zero spread to the right channel");
  descriptor->destroy(narrow);
  descriptor->destroy(wide);
}

void testLatestPendingTransitionContinuesInsideLongBlock() {
  const auto *descriptor = et_kernel_descriptor_ChorusPlugin();
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> first_storage{};
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> second_storage{};
  auto *first = descriptor->construct(first_storage.data());
  auto *second = descriptor->construct(second_storage.data());
  first->prepare({1000.0F, 1u, 16u});
  second->prepare({1000.0F, 1u, 16u});
  const auto stage = [descriptor](effetune::PluginKernel *kernel,
                                  const std::array<float, 8u> &params) {
    check(kernel->stageParameters(params.data(), static_cast<std::uint32_t>(params.size()),
                                  descriptor->paramsHash) == ET_OK,
          "transition parameters stage");
    kernel->applyPendingParameters();
  };
  const std::array<float, 8u> initial{0.0F, 0.8F, 2.0F, 1.0F, 3.0F, 0.0F, 50.0F, 100.0F};
  const std::array<float, 8u> midpoint{3.0F, 0.8F, 2.0F, 1.0F, 1.0F, 0.0F, 50.0F, 100.0F};
  for (auto *kernel : {first, second}) {
    stage(kernel, initial);
    std::array<float, 1u> initialize{{0.2F}};
    kernel->process(initialize.data(), 1u, 1u, {0.0});
    stage(kernel, midpoint);
    std::array<float, 6u> enter_fade_up{};
    enter_fade_up.fill(0.2F);
    kernel->process(enter_fade_up.data(), 1u, static_cast<std::uint32_t>(enter_fade_up.size()),
                    {0.0});
  }

  stage(first, {2.0F, 0.8F, 2.0F, 1.0F, 6.0F, 0.0F, 50.0F, 100.0F});
  stage(second, {4.0F, 0.8F, 2.0F, 1.0F, 1.0F, 0.0F, 50.0F, 100.0F});
  std::array<float, 9u> first_to_midpoint{};
  for (std::uint32_t frame = 0u; frame < first_to_midpoint.size(); ++frame)
    first_to_midpoint[frame] = static_cast<float>(0.2 * std::sin(frame * 0.31) + 0.1);
  auto second_to_midpoint = first_to_midpoint;
  first->process(first_to_midpoint.data(), 1u, static_cast<std::uint32_t>(first_to_midpoint.size()),
                 {0.0});
  second->process(second_to_midpoint.data(), 1u,
                  static_cast<std::uint32_t>(second_to_midpoint.size()), {0.0});
  check(first_to_midpoint == second_to_midpoint,
        "latest pending topology stays inactive until the next dry midpoint");

  std::array<float, 3u> first_after_midpoint{{0.17F, -0.23F, 0.31F}};
  auto second_after_midpoint = first_after_midpoint;
  first->process(first_after_midpoint.data(), 1u,
                 static_cast<std::uint32_t>(first_after_midpoint.size()), {0.0});
  second->process(second_after_midpoint.data(), 1u,
                  static_cast<std::uint32_t>(second_after_midpoint.size()), {0.0});
  check(first_after_midpoint != second_after_midpoint,
        "next transition advances inside the long fade-up block");
  descriptor->destroy(first);
  descriptor->destroy(second);
}

} // namespace

int main() {
  testResetReplayAndLimits();
  testEnsembleBasePhaseWrapContinuity();
  testStereoChorusSpreadIsActiveOnFirstBlock();
  testLatestPendingTransitionContinuesInsideLongBlock();
  if (failures != 0)
    return 1;
  std::puts("All Chorus native checks passed");
  return 0;
}
