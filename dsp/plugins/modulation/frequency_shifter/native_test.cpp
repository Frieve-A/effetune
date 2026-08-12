#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <utility>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FrequencyShifterPlugin() noexcept;

namespace {

constexpr std::uint32_t kFrames = 512u;
constexpr std::uint32_t kKernelStorageBytes = 8192u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "frequency_shifter/native_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define FREQUENCY_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

struct KernelInstance {
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage{};
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_FrequencyShifterPlugin();
  effetune::PluginKernel *kernel = nullptr;

  KernelInstance() {
    FREQUENCY_CHECK(descriptor != nullptr);
    if (descriptor != nullptr) {
      FREQUENCY_CHECK(descriptor->objectSize <= storage.size());
      kernel = descriptor->construct(storage.data());
      FREQUENCY_CHECK(kernel != nullptr);
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
      audio[static_cast<std::size_t>(channel) * kFrames + frame] =
          static_cast<float>(std::sin(0.017 * static_cast<double>(frame + channel * 7u)));
    }
  }
}

void stage(KernelInstance &instance, const std::array<float, 9u> &params) {
  FREQUENCY_CHECK(instance.descriptor->paramsFloatCount == params.size());
  FREQUENCY_CHECK(instance.kernel->stageParameters(params.data(),
                                                   static_cast<std::uint32_t>(params.size()),
                                                   instance.descriptor->paramsHash) == ET_OK);
  instance.kernel->applyPendingParameters();
}

void testSampleRateLatencyFamily() {
  constexpr std::array<std::pair<float, std::uint32_t>, 3u> cases{{
      {48000.0F, 114u},
      {96000.0F, 228u},
      {192000.0F, 456u},
  }};
  for (const auto &[sample_rate, expected] : cases) {
    KernelInstance instance;
    if (instance.kernel == nullptr) {
      return;
    }
    instance.kernel->prepare({sample_rate, 2u, kFrames});
    FREQUENCY_CHECK(instance.kernel->latencySamples() == expected);
  }
}

void testLatencyAndDryAlignment() {
  KernelInstance instance;
  if (instance.kernel == nullptr) {
    return;
  }
  instance.kernel->prepare({48000.0F, 2u, kFrames});
  FREQUENCY_CHECK(instance.kernel->latencySamples() == 114u);
  stage(instance, {0.0F, 8.0F, 440.0F, 20.0F, 800.0F, 0.15F, 0.0F, 0.0F, 0.0F});
  std::array<float, kFrames * 2u> audio{};
  audio[0] = 1.0F;
  instance.kernel->process(audio.data(), 2u, kFrames, {0.0});
  for (std::uint32_t frame = 0u; frame < 114u; ++frame) {
    FREQUENCY_CHECK(audio[frame] == 0.0F);
  }
  FREQUENCY_CHECK(audio[114] == 1.0F);
  for (float sample : audio) {
    FREQUENCY_CHECK(std::isfinite(sample));
  }
}

void testCanonicalBoundsAndResetReplay() {
  KernelInstance reversed;
  KernelInstance canonical;
  if (reversed.kernel == nullptr || canonical.kernel == nullptr) {
    return;
  }
  reversed.kernel->prepare({48000.0F, 2u, kFrames});
  canonical.kernel->prepare({48000.0F, 2u, kFrames});
  stage(reversed, {2.0F, 8.0F, 440.0F, 900.0F, 20.0F, 0.3F, 0.0F, 90.0F, 100.0F});
  stage(canonical, {2.0F, 8.0F, 440.0F, 20.0F, 900.0F, 0.3F, 0.0F, 90.0F, 100.0F});
  std::array<float, kFrames * 2u> left{};
  std::array<float, kFrames * 2u> right{};
  fillInput(left);
  right = left;
  reversed.kernel->process(left.data(), 2u, kFrames, {0.0});
  canonical.kernel->process(right.data(), 2u, kFrames, {0.0});
  for (std::size_t index = 0u; index < left.size(); ++index) {
    FREQUENCY_CHECK(left[index] == right[index]);
    FREQUENCY_CHECK(std::isfinite(left[index]));
  }

  std::array<float, kFrames * 2u> replay{};
  fillInput(replay);
  reversed.kernel->reset();
  reversed.kernel->process(replay.data(), 2u, kFrames, {0.0});
  for (std::size_t index = 0u; index < left.size(); ++index) {
    FREQUENCY_CHECK(left[index] == replay[index]);
  }
}

void testModeTransitionAndHighRateCapacity() {
  KernelInstance instance;
  if (instance.kernel == nullptr) {
    return;
  }
  instance.kernel->prepare({192000.0F, 8u, 127u});
  FREQUENCY_CHECK(instance.kernel->latencySamples() == 456u);
  stage(instance, {0.0F, 5000.0F, 10000.0F, 0.0F, 5000.0F, 2.0F, 0.0F, 180.0F, 100.0F});
  std::array<float, 127u * 8u> audio{};
  for (std::size_t index = 0u; index < audio.size(); ++index) {
    audio[index] = static_cast<float>((index % 31u) * (1.0 / 31.0) - 0.5);
  }
  instance.kernel->process(audio.data(), 8u, 127u, {0.0});
  stage(instance, {1.0F, 5000.0F, 10000.0F, 0.0F, 5000.0F, 2.0F, 1.0F, 180.0F, 100.0F});
  instance.kernel->process(audio.data(), 8u, 127u, {0.0});
  for (float sample : audio) {
    FREQUENCY_CHECK(std::isfinite(sample));
  }
}

void testTransitionRestagingKeepsTheActiveEnvelope() {
  KernelInstance instance;
  if (instance.kernel == nullptr) {
    return;
  }
  instance.kernel->prepare({48000.0F, 1u, kFrames});
  stage(instance, {1.0F, 0.0F, 0.0F, 20.0F, 800.0F, 0.15F, 0.0F, 0.0F, 100.0F});
  std::array<float, kFrames> warm{};
  warm.fill(1.0F);
  instance.kernel->process(warm.data(), 1u, kFrames, {0.0});

  stage(instance, {0.0F, 0.0F, 0.0F, 20.0F, 800.0F, 0.15F, 0.0F, 0.0F, 100.0F});
  std::array<float, 16u> fade_down{};
  fade_down.fill(1.0F);
  instance.kernel->process(fade_down.data(), 1u, 16u, {0.0});
  FREQUENCY_CHECK(std::abs(fade_down.back() - 15.0F / 64.0F) < 1.0e-6F);

  stage(instance, {2.0F, 0.0F, 0.0F, 20.0F, 800.0F, 0.15F, 1.0F, 0.0F, 100.0F});
  std::array<float, 1u> restaged{{1.0F}};
  instance.kernel->process(restaged.data(), 1u, 1u, {0.0});
  FREQUENCY_CHECK(std::abs(restaged[0] - 0.25F) < 1.0e-6F);

  stage(instance, {0.0F, 0.0F, 0.0F, 20.0F, 800.0F, 0.15F, 0.0F, 0.0F, 100.0F});
  std::array<float, 47u> to_midpoint{};
  to_midpoint.fill(1.0F);
  instance.kernel->process(to_midpoint.data(), 1u, 47u, {0.0});
  std::array<float, 1u> midpoint{{1.0F}};
  instance.kernel->process(midpoint.data(), 1u, 1u, {0.0});
  FREQUENCY_CHECK(midpoint[0] == 1.0F);

  stage(instance, {1.0F, 0.0F, 0.0F, 20.0F, 800.0F, 0.15F, 0.0F, 0.0F, 100.0F});
  std::array<float, 63u> finish_fade_up{};
  finish_fade_up.fill(1.0F);
  instance.kernel->process(finish_fade_up.data(), 1u, 63u, {0.0});
  std::array<float, 18u> next_fade_down{};
  next_fade_down.fill(1.0F);
  instance.kernel->process(next_fade_down.data(), 1u, 18u, {0.0});
  FREQUENCY_CHECK(next_fade_down.back() == 1.0F);
}

void testChannelChangeAdoptsRequestedTopologyImmediately() {
  KernelInstance reference;
  KernelInstance changed;
  if (reference.kernel == nullptr || changed.kernel == nullptr) {
    return;
  }
  reference.kernel->prepare({48000.0F, 3u, kFrames});
  changed.kernel->prepare({48000.0F, 3u, kFrames});

  stage(changed, {0.0F, 37.0F, 440.0F, 20.0F, 800.0F, 0.15F, 0.0F, 0.0F, 100.0F});
  std::array<float, kFrames * 2u> initial{};
  fillInput(initial);
  changed.kernel->process(initial.data(), 2u, kFrames, {0.0});

  const std::array<float, 9u> barber_down{2.0F,  37.0F, 440.0F, 20.0F, 800.0F,
                                          0.37F, 1.0F,  90.0F,  100.0F};
  stage(reference, barber_down);
  stage(changed, barber_down);
  std::array<float, kFrames * 3u> expected{};
  for (std::uint32_t channel = 0u; channel < 3u; ++channel) {
    for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
      expected[static_cast<std::size_t>(channel) * kFrames + frame] =
          static_cast<float>(std::sin(0.017 * static_cast<double>(frame + channel * 7u)));
    }
  }
  auto actual = expected;
  reference.kernel->process(expected.data(), 3u, kFrames, {0.0});
  changed.kernel->process(actual.data(), 3u, kFrames, {0.0});
  for (std::size_t index = 0u; index < expected.size(); ++index) {
    FREQUENCY_CHECK(expected[index] == actual[index]);
  }
}

void testMovingBarberBecomesStationaryWithoutRatePulsing() {
  KernelInstance instance;
  if (instance.kernel == nullptr) {
    return;
  }
  constexpr double sample_rate = 48000.0;
  instance.kernel->prepare({static_cast<float>(sample_rate), 2u, kFrames});
  stage(instance, {2.0F, 8.0F, 440.0F, 20.0F, 900.0F, 2.0F, 0.0F, 90.0F, 100.0F});
  std::uint64_t input_frame = 0u;
  auto process_tone = [&](std::array<float, kFrames * 2u> &audio) {
    for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
      const float sample = static_cast<float>(
          std::sin(6.283185307179586 * 1000.0 * static_cast<double>(input_frame++) / sample_rate));
      audio[frame] = sample;
      audio[kFrames + frame] = sample;
    }
    instance.kernel->process(audio.data(), 2u, kFrames, {0.0});
  };

  std::array<float, kFrames * 2u> audio{};
  for (std::uint32_t block = 0u; block < 48u; ++block) {
    process_tone(audio);
  }
  stage(instance, {2.0F, 8.0F, 440.0F, 173.0F, 173.0F, 2.0F, 0.0F, 90.0F, 100.0F});
  for (std::uint32_t block = 0u; block < 32u; ++block) {
    process_tone(audio);
  }

  double minimum_rms = 1.0e30;
  double maximum_rms = 0.0;
  double pending_energy = 0.0;
  std::uint32_t pending_samples = 0u;
  for (std::uint32_t block = 0u; block < 96u; ++block) {
    process_tone(audio);
    for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
      const double sample = static_cast<double>(audio[frame]);
      pending_energy += sample * sample;
      ++pending_samples;
      if (pending_samples == 1024u) {
        const double rms = std::sqrt(pending_energy / 1024.0);
        minimum_rms = rms < minimum_rms ? rms : minimum_rms;
        maximum_rms = rms > maximum_rms ? rms : maximum_rms;
        pending_energy = 0.0;
        pending_samples = 0u;
      }
    }
  }
  FREQUENCY_CHECK(maximum_rms / minimum_rms < 1.05);

  stage(instance, {2.0F, 8.0F, 440.0F, 173.0F, 173.0F, 2.0F, 1.0F, 90.0F, 100.0F});
  process_tone(audio);
  stage(instance, {2.0F, 8.0F, 440.0F, 20.0F, 900.0F, 2.0F, 1.0F, 90.0F, 100.0F});
  process_tone(audio);
  for (float sample : audio) {
    FREQUENCY_CHECK(std::isfinite(sample));
  }
  bool stereo_differs = false;
  for (std::uint32_t frame = 0u; frame < kFrames; ++frame) {
    stereo_differs = stereo_differs || audio[frame] != audio[kFrames + frame];
  }
  FREQUENCY_CHECK(stereo_differs);
}

double measureImageRejection(double sample_rate, double input_frequency) {
  KernelInstance instance;
  if (instance.kernel == nullptr) {
    return -1000.0;
  }
  instance.kernel->prepare({static_cast<float>(sample_rate), 1u, kFrames});
  constexpr double shift = 100.0;
  stage(instance,
        {0.0F, static_cast<float>(shift), 440.0F, 20.0F, 800.0F, 0.15F, 0.0F, 0.0F, 100.0F});
  const std::uint32_t total_frames = static_cast<std::uint32_t>(sample_rate / 2.0);
  const std::uint32_t analysis_start = static_cast<std::uint32_t>(sample_rate / 4.0);
  double desired_real = 0.0;
  double desired_imaginary = 0.0;
  double image_real = 0.0;
  double image_imaginary = 0.0;
  std::array<float, kFrames> audio{};
  for (std::uint32_t offset = 0u; offset < total_frames; offset += kFrames) {
    const std::uint32_t remaining = total_frames - offset;
    const std::uint32_t frame_count = remaining < kFrames ? remaining : kFrames;
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const double global_frame = static_cast<double>(offset + frame);
      audio[frame] = static_cast<float>(
          std::sin(6.283185307179586 * input_frequency * global_frame / sample_rate));
    }
    instance.kernel->process(audio.data(), 1u, frame_count, {0.0});
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const std::uint32_t global_frame = offset + frame;
      if (global_frame < analysis_start) {
        continue;
      }
      const double desired_phase =
          6.283185307179586 * (input_frequency + shift) * global_frame / sample_rate;
      const double image_phase =
          6.283185307179586 * (input_frequency - shift) * global_frame / sample_rate;
      desired_real += static_cast<double>(audio[frame]) * std::cos(desired_phase);
      desired_imaginary -= static_cast<double>(audio[frame]) * std::sin(desired_phase);
      image_real += static_cast<double>(audio[frame]) * std::cos(image_phase);
      image_imaginary -= static_cast<double>(audio[frame]) * std::sin(image_phase);
    }
  }
  const double desired = std::hypot(desired_real, desired_imaginary);
  const double image = std::hypot(image_real, image_imaginary);
  return 20.0 * std::log10(desired / image);
}

void testUsefulBandImageRejection() {
  for (double sample_rate : {48000.0, 96000.0, 192000.0}) {
    FREQUENCY_CHECK(measureImageRejection(sample_rate, 200.0) >= 20.0);
    for (double input_frequency : {500.0, 5000.0, 15000.0}) {
      FREQUENCY_CHECK(measureImageRejection(sample_rate, input_frequency) >= 30.0);
    }
  }
}

} // namespace

int main() {
  testSampleRateLatencyFamily();
  testLatencyAndDryAlignment();
  testCanonicalBoundsAndResetReplay();
  testModeTransitionAndHighRateCapacity();
  testTransitionRestagingKeepsTheActiveEnvelope();
  testChannelChangeAdoptsRequestedTopologyImmediately();
  testMovingBarberBecomesStationaryWithoutRatePulsing();
  testUsefulBandImageRejection();
  if (failures != 0) {
    std::fprintf(stderr, "%d Frequency Shifter contract check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Frequency Shifter native tests passed");
  return 0;
}
