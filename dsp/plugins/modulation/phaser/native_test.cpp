#include "barber_window.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_PhaserPlugin() noexcept;

namespace {

constexpr std::uint32_t kStorageBytes = 8192u;
constexpr std::uint32_t kFrames = 8192u;
constexpr std::uint32_t kEnvelopeFrames = 2048u;
int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Phaser check failed: %s\n", message);
    ++failures;
  }
}

void testFiniteDecayAndReset() {
  const auto *descriptor = et_kernel_descriptor_PhaserPlugin();
  check(descriptor != nullptr && descriptor->paramsFloatCount == 9u, "descriptor contract");
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> storage{};
  auto *kernel = descriptor->construct(storage.data());
  kernel->prepare({192000.0F, 8u, kFrames});
  check(kernel->preparedSuccessfully(), "maximum prepare capacity");
  const std::array<float, 9u> params{1.0F,   10.0F,  8000.0F, 6.0F,  12.0F,
                                     -90.0F, 180.0F, 1.0F,    100.0F};
  check(kernel->stageParameters(params.data(), static_cast<std::uint32_t>(params.size()),
                                descriptor->paramsHash) == ET_OK,
        "parameter staging");
  kernel->applyPendingParameters();
  std::array<float, kFrames * 8u> first{};
  first[0] = 1.0F;
  kernel->process(first.data(), 8u, kFrames, {0.0});
  for (float sample : first)
    check(std::isfinite(sample), "finite maximum-feedback output");

  kernel->reset();
  std::array<float, kFrames * 8u> replay{};
  replay[0] = 1.0F;
  kernel->process(replay.data(), 8u, kFrames, {0.0});
  check(first == replay, "reset replay");
  descriptor->destroy(kernel);
}

void testZeroRangeBarberEnvelopeIsPhaseInvariant() {
  const auto *descriptor = et_kernel_descriptor_PhaserPlugin();
  const auto render_after_silence = [descriptor](std::uint32_t warmup_frames) {
    alignas(std::max_align_t) std::array<std::byte, kStorageBytes> storage{};
    auto *kernel = descriptor->construct(storage.data());
    kernel->prepare({48000.0F, 1u, kFrames});
    const std::array<float, 9u> params{1.0F, 10.0F, 1400.0F, 0.0F, 8.0F, 0.0F, 0.0F, 0.0F, 100.0F};
    kernel->stageParameters(params.data(), static_cast<std::uint32_t>(params.size()),
                            descriptor->paramsHash);
    kernel->applyPendingParameters();
    if (warmup_frames > 0u) {
      std::array<float, kFrames> silence{};
      kernel->process(silence.data(), 1u, warmup_frames, {0.0});
    }
    std::array<float, kEnvelopeFrames> output{};
    for (std::uint32_t frame = 0u; frame < kEnvelopeFrames; ++frame) {
      output[frame] = static_cast<float>(0.45 * std::sin(static_cast<double>(frame) * 0.071) +
                                         0.2 * std::cos(static_cast<double>(frame) * 0.193));
    }
    kernel->process(output.data(), 1u, kEnvelopeFrames, {0.0});
    descriptor->destroy(kernel);
    return output;
  };

  const auto reference = render_after_silence(0u);
  for (const std::uint32_t warmup_frames : {601u, 1237u}) {
    const auto shifted = render_after_silence(warmup_frames);
    double maximum_envelope_difference = 0.0;
    for (std::uint32_t frame = 0u; frame < kEnvelopeFrames; ++frame) {
      check(std::isfinite(shifted[frame]), "finite zero-range barber output");
      const double difference = std::abs(std::abs(static_cast<double>(reference[frame])) -
                                         std::abs(static_cast<double>(shifted[frame])));
      if (difference > maximum_envelope_difference)
        maximum_envelope_difference = difference;
    }
    check(maximum_envelope_difference < 1.0e-6,
          "zero-range barber envelope is independent of sweep phase");
  }
}

void testBarberWindowHasConstantUnityAndPower() {
  for (const double cycle : {0.0, 0.071, 0.193, 0.337, 0.781}) {
    double weight_sum = 0.0;
    double squared_sum = 0.0;
    for (std::uint32_t voice = 0u; voice < 3u; ++voice) {
      double sweep = cycle + static_cast<double>(voice) / 3.0;
      sweep -= std::floor(sweep);
      const double weight = effetune::plugins::modulation::detail::barberWindow(sweep);
      weight_sum += weight;
      squared_sum += weight * weight;
    }
    check(std::abs(weight_sum - 1.5) < 1.0e-12, "barber linear window sum is constant");
    check(std::abs(squared_sum - 1.125) < 1.0e-12, "barber squared window sum is constant");
    check(std::abs(weight_sum / weight_sum - 1.0) < 1.0e-12,
          "zero-range barber normalization is unity");
    check(std::abs(squared_sum / (weight_sum * weight_sum) - 0.5) < 1.0e-12,
          "non-correlated barber power is phase independent");
  }
}

void testLatestPendingTransitionContinuesInsideLongBlock() {
  const auto *descriptor = et_kernel_descriptor_PhaserPlugin();
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> first_storage{};
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> second_storage{};
  auto *first = descriptor->construct(first_storage.data());
  auto *second = descriptor->construct(second_storage.data());
  first->prepare({1000.0F, 1u, 16u});
  second->prepare({1000.0F, 1u, 16u});
  const auto stage = [descriptor](effetune::PluginKernel *kernel,
                                  const std::array<float, 9u> &params) {
    check(kernel->stageParameters(params.data(), static_cast<std::uint32_t>(params.size()),
                                  descriptor->paramsHash) == ET_OK,
          "transition parameters stage");
    kernel->applyPendingParameters();
  };
  const std::array<float, 9u> initial{0.0F, 0.5F, 300.0F, 3.0F, 6.0F, 0.0F, 0.0F, 0.0F, 100.0F};
  const std::array<float, 9u> midpoint{1.0F, 0.5F, 300.0F, 3.0F, 12.0F, 0.0F, 0.0F, 1.0F, 100.0F};
  for (auto *kernel : {first, second}) {
    stage(kernel, initial);
    std::array<float, 1u> initialize{{0.15F}};
    kernel->process(initialize.data(), 1u, 1u, {0.0});
    stage(kernel, midpoint);
    std::array<float, 6u> enter_fade_up{};
    enter_fade_up.fill(0.15F);
    kernel->process(enter_fade_up.data(), 1u, static_cast<std::uint32_t>(enter_fade_up.size()),
                    {0.0});
  }

  stage(first, {0.0F, 0.5F, 300.0F, 3.0F, 4.0F, 0.0F, 0.0F, 0.0F, 100.0F});
  stage(second, {1.0F, 0.5F, 300.0F, 3.0F, 2.0F, 0.0F, 0.0F, 0.0F, 100.0F});
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
  testFiniteDecayAndReset();
  testZeroRangeBarberEnvelopeIsPhaseInvariant();
  testBarberWindowHasConstantUnityAndPower();
  testLatestPendingTransitionContinuesInsideLongBlock();
  if (failures != 0)
    return 1;
  std::puts("All Phaser native checks passed");
  return 0;
}
