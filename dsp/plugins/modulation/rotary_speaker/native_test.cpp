#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_RotarySpeakerPlugin() noexcept;

namespace {

constexpr std::uint32_t kFrames = 1024u;
constexpr std::uint32_t kKernelStorageBytes = 8192u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "rotary_speaker/native_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define ROTARY_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

struct KernelInstance {
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage{};
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_RotarySpeakerPlugin();
  effetune::PluginKernel *kernel = nullptr;

  KernelInstance() {
    ROTARY_CHECK(descriptor != nullptr);
    if (descriptor != nullptr) {
      ROTARY_CHECK(descriptor->objectSize <= storage.size());
      kernel = descriptor->construct(storage.data());
      ROTARY_CHECK(kernel != nullptr);
    }
  }

  ~KernelInstance() {
    if (kernel != nullptr) {
      descriptor->destroy(kernel);
    }
  }
};

void fillInput(std::array<float, kFrames * 2u> &audio) noexcept {
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
      const double phase = 0.021 * static_cast<double>(frame) + channel * 0.3;
      audio[static_cast<std::size_t>(channel) * kFrames + frame] =
          static_cast<float>(0.7 * std::sin(phase));
    }
  }
}

void fillIdenticalInput(float *audio, std::uint32_t channels) noexcept {
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
      audio[static_cast<std::size_t>(channel) * kFrames + frame] =
          static_cast<float>(0.4 + 0.3 * std::sin(0.031 * static_cast<double>(frame)));
    }
  }
}

void stage(KernelInstance &instance, const std::array<float, 9u> &params) {
  ROTARY_CHECK(instance.descriptor->paramsFloatCount == params.size());
  ROTARY_CHECK(instance.kernel->stageParameters(params.data(),
                                                static_cast<std::uint32_t>(params.size()),
                                                instance.descriptor->paramsHash) == ET_OK);
  instance.kernel->applyPendingParameters();
}

void processFresh(float *audio, std::uint32_t channel_count, float width, float amplitude) {
  KernelInstance instance;
  if (instance.kernel == nullptr) {
    return;
  }
  instance.kernel->prepare({48000.0F, channel_count, kFrames});
  stage(instance, {0.0F, 100.0F, 2.2F, 800.0F, 0.0F, width, 70.0F, amplitude, 100.0F});
  instance.kernel->process(audio, channel_count, kFrames, {0.0});
}

void testDryTransparencyAndResetReplay() {
  KernelInstance instance;
  if (instance.kernel == nullptr) {
    return;
  }
  instance.kernel->prepare({48000.0F, 2u, kFrames});
  stage(instance, {2.0F, 200.0F, 0.1F, 2000.0F, 100.0F, 100.0F, 100.0F, 100.0F, 0.0F});
  std::array<float, kFrames * 2u> input{};
  fillInput(input);
  auto output = input;
  instance.kernel->process(output.data(), 2u, kFrames, {0.0});
  for (std::size_t index = 0u; index < input.size(); ++index) {
    ROTARY_CHECK(output[index] == input[index]);
  }

  stage(instance, {1.0F, 100.0F, 2.2F, 800.0F, 0.0F, 75.0F, 45.0F, 55.0F, 70.0F});
  instance.kernel->reset();
  output = input;
  instance.kernel->process(output.data(), 2u, kFrames, {0.0});
  auto replay = input;
  instance.kernel->reset();
  instance.kernel->process(replay.data(), 2u, kFrames, {0.0});
  for (std::size_t index = 0u; index < output.size(); ++index) {
    ROTARY_CHECK(output[index] == replay[index]);
    ROTARY_CHECK(std::isfinite(output[index]));
  }
}

void testContinuousSpeedChangesAndCapacity() {
  KernelInstance instance;
  if (instance.kernel == nullptr) {
    return;
  }
  instance.kernel->prepare({192000.0F, 8u, 127u});
  stage(instance, {2.0F, 200.0F, 0.1F, 2000.0F, 0.0F, 100.0F, 100.0F, 100.0F, 100.0F});
  std::array<float, 127u * 8u> audio{};
  for (std::size_t index = 0u; index < audio.size(); ++index) {
    audio[index] = static_cast<float>((index % 41u) * (1.0 / 41.0) - 0.5);
  }
  instance.kernel->process(audio.data(), 8u, 127u, {0.0});
  stage(instance, {0.0F, 200.0F, 0.1F, 200.0F, -100.0F, 0.0F, 0.0F, 0.0F, 100.0F});
  instance.kernel->process(audio.data(), 8u, 127u, {0.0});
  stage(instance, {1.0F, 25.0F, 10.0F, 800.0F, 100.0F, 100.0F, 100.0F, 100.0F, 100.0F});
  instance.kernel->process(audio.data(), 8u, 127u, {0.0});
  for (float sample : audio) {
    ROTARY_CHECK(std::isfinite(sample));
  }

  std::array<float, 127u> mono{};
  for (std::size_t index = 0u; index < mono.size(); ++index) {
    mono[index] = static_cast<float>(std::sin(0.05 * static_cast<double>(index)));
  }
  instance.kernel->process(mono.data(), 1u, 127u, {0.0});
  for (float sample : mono) {
    ROTARY_CHECK(std::isfinite(sample));
  }
}

void processSilence(KernelInstance &instance, std::uint32_t total_frames) {
  std::array<float, kFrames> silence{};
  while (total_frames > 0u) {
    const std::uint32_t frames = total_frames < kFrames ? total_frames : kFrames;
    instance.kernel->process(silence.data(), 1u, frames, {0.0});
    total_frames -= frames;
  }
}

void testFast200ToStop25FreezesWithinTenSeconds() {
  KernelInstance instance;
  if (instance.kernel == nullptr) {
    return;
  }
  constexpr std::uint32_t sample_rate = 48000u;
  instance.kernel->prepare({static_cast<float>(sample_rate), 1u, kFrames});
  stage(instance, {2.0F, 200.0F, 0.1F, 800.0F, 0.0F, 100.0F, 100.0F, 100.0F, 100.0F});
  processSilence(instance, 8192u);
  stage(instance, {0.0F, 25.0F, 2.2F, 800.0F, 0.0F, 100.0F, 100.0F, 100.0F, 100.0F});
  processSilence(instance, sample_rate * 10u);

  std::array<float, kFrames> first{};
  first[0] = 1.0F;
  instance.kernel->process(first.data(), 1u, kFrames, {0.0});
  processSilence(instance, kFrames * 20u);
  std::array<float, kFrames> second{};
  second[0] = 1.0F;
  instance.kernel->process(second.data(), 1u, kFrames, {0.0});
  double energy = 0.0;
  double maximum_difference = 0.0;
  for (std::size_t index = 0u; index < first.size(); ++index) {
    energy += std::abs(static_cast<double>(first[index]));
    const double difference =
        std::abs(static_cast<double>(first[index]) - static_cast<double>(second[index]));
    maximum_difference = difference > maximum_difference ? difference : maximum_difference;
  }
  ROTARY_CHECK(energy > 0.0);
  ROTARY_CHECK(maximum_difference < 1.0e-5);
}

void testDenormalCrossoverTailFlushesAtTheBlockBoundary() {
  KernelInstance instance;
  if (instance.kernel == nullptr) {
    return;
  }
  instance.kernel->prepare({48000.0F, 1u, 400u});
  stage(instance, {1.0F, 100.0F, 2.2F, 200.0F, 0.0F, 75.0F, 45.0F, 55.0F, 100.0F});
  std::array<float, 1u> denormal_input{1.0e-31F};
  instance.kernel->process(denormal_input.data(), 1u, 1u, {0.0});
  std::array<float, 400u> drain{};
  instance.kernel->process(drain.data(), 1u, 400u, {0.0});
  std::array<float, 400u> silence{};
  instance.kernel->process(silence.data(), 1u, 400u, {0.0});
  for (float sample : silence) {
    ROTARY_CHECK(sample == 0.0F);
  }
}

void testStereoWidthOnlyAffectsCompleteMicrophonePairs() {
  std::array<float, kFrames> mono_width_zero{};
  std::array<float, kFrames> mono_width_full{};
  fillIdenticalInput(mono_width_zero.data(), 1u);
  mono_width_full = mono_width_zero;
  processFresh(mono_width_zero.data(), 1u, 0.0F, 100.0F);
  processFresh(mono_width_full.data(), 1u, 100.0F, 100.0F);
  for (std::size_t frame = 0u; frame < kFrames; ++frame) {
    ROTARY_CHECK(mono_width_zero[frame] == mono_width_full[frame]);
  }

  std::array<float, kFrames * 3u> odd_width_zero{};
  std::array<float, kFrames * 3u> odd_width_full{};
  fillIdenticalInput(odd_width_zero.data(), 3u);
  odd_width_full = odd_width_zero;
  processFresh(odd_width_zero.data(), 3u, 0.0F, 100.0F);
  processFresh(odd_width_full.data(), 3u, 100.0F, 100.0F);
  for (std::size_t frame = 0u; frame < kFrames; ++frame) {
    const std::size_t tail = 2u * kFrames + frame;
    ROTARY_CHECK(odd_width_zero[tail] == odd_width_full[tail]);
  }

  std::array<float, kFrames * 2u> stereo_width_zero{};
  std::array<float, kFrames * 2u> stereo_width_full{};
  fillIdenticalInput(stereo_width_zero.data(), 2u);
  stereo_width_full = stereo_width_zero;
  processFresh(stereo_width_zero.data(), 2u, 0.0F, 100.0F);
  processFresh(stereo_width_full.data(), 2u, 100.0F, 100.0F);
  double stereo_maximum_difference = 0.0;
  for (std::size_t index = 0u; index < stereo_width_zero.size(); ++index) {
    const double difference = std::abs(static_cast<double>(stereo_width_zero[index]) -
                                       static_cast<double>(stereo_width_full[index]));
    stereo_maximum_difference =
        difference > stereo_maximum_difference ? difference : stereo_maximum_difference;
  }
  ROTARY_CHECK(stereo_maximum_difference > 1.0e-6);

  std::array<float, kFrames> mono_amplitude_zero{};
  std::array<float, kFrames> mono_amplitude_full{};
  fillIdenticalInput(mono_amplitude_zero.data(), 1u);
  mono_amplitude_full = mono_amplitude_zero;
  processFresh(mono_amplitude_zero.data(), 1u, 0.0F, 0.0F);
  processFresh(mono_amplitude_full.data(), 1u, 0.0F, 100.0F);
  double amplitude_maximum_difference = 0.0;
  for (std::size_t frame = 0u; frame < kFrames; ++frame) {
    const double difference = std::abs(static_cast<double>(mono_amplitude_zero[frame]) -
                                       static_cast<double>(mono_amplitude_full[frame]));
    amplitude_maximum_difference =
        difference > amplitude_maximum_difference ? difference : amplitude_maximum_difference;
  }
  ROTARY_CHECK(amplitude_maximum_difference > 1.0e-6);
}

} // namespace

int main() {
  testDryTransparencyAndResetReplay();
  testContinuousSpeedChangesAndCapacity();
  testFast200ToStop25FreezesWithinTenSeconds();
  testDenormalCrossoverTailFlushesAtTheBlockBoundary();
  testStereoWidthOnlyAffectsCompleteMicrophonePairs();
  if (failures != 0) {
    std::fprintf(stderr, "%d Rotary Speaker contract check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Rotary Speaker native tests passed");
  return 0;
}
