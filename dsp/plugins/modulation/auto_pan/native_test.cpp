#include "AutoPanPluginParams.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_AutoPanPlugin() noexcept;

namespace {

using Params = effetune::generated::AutoPanPluginParams;
constexpr std::size_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kMaxFrames = 257u;
int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Auto Pan check failed: %s\n", message);
    ++failures;
  }
}

class Harness final {
public:
  Harness(float sample_rate, std::uint32_t channels) {
    descriptor_ = et_kernel_descriptor_AutoPanPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr)
      return;
    check(descriptor_->paramsFloatCount == Params::kFloatCount, "parameter count matches");
    check(descriptor_->paramsHash == Params::kHash, "parameter hash matches");
    check(descriptor_->objectSize <= storage_.size(), "kernel fits storage");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr)
      kernel_->prepare({sample_rate, channels, kMaxFrames});
  }

  ~Harness() {
    if (kernel_ != nullptr)
      descriptor_->destroy(kernel_);
  }

  void stage(const Params &params) noexcept {
    const et_status status =
        kernel_->stageParameters(&params.rate, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
    kernel_->applyPendingParameters();
  }

  void process(std::vector<float> &audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    kernel_->process(audio.data(), channels, frames, {0.0});
  }

  void reset() noexcept { kernel_->reset(); }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

Params params(float depth = 100.0F, float waveform = 0.0F) noexcept {
  return {0.7F, depth, 0.0F, 100.0F, waveform, 0.0F};
}

std::vector<float> signal(std::uint32_t channels, std::uint32_t frames) {
  std::vector<float> audio(static_cast<std::size_t>(channels) * frames);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      audio[static_cast<std::size_t>(channel) * frames + frame] =
          static_cast<float>(static_cast<double>((frame * 17u + channel * 11u) % 97u) / 48.0 - 1.0);
    }
  }
  return audio;
}

void testNeutralMonoAndPairs() {
  constexpr std::uint32_t frames = 257u;
  Harness stereo(48000.0F, 2u);
  std::vector<float> neutral = signal(2u, frames);
  const std::vector<float> dry = neutral;
  stereo.stage(params(0.0F, 1.0F));
  stereo.process(neutral, 2u, frames);
  check(neutral == dry, "Depth zero is sample-exact dry");

  Harness mono(48000.0F, 1u);
  std::vector<float> mono_audio = signal(1u, frames);
  const std::vector<float> mono_dry = mono_audio;
  mono.stage(params());
  mono.process(mono_audio, 1u, frames);
  check(mono_audio == mono_dry, "mono is sample-exact pass-through");

  Harness odd(48000.0F, 5u);
  std::vector<float> audio(static_cast<std::size_t>(5u) * frames, 1.0F);
  odd.stage(params());
  odd.process(audio, 5u, frames);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    check(audio[frame] == audio[static_cast<std::size_t>(2u) * frames + frame],
          "left members of each pair share a trajectory");
    check(audio[frames + frame] == audio[static_cast<std::size_t>(3u) * frames + frame],
          "right members of each pair share a trajectory");
    check(audio[static_cast<std::size_t>(4u) * frames + frame] == 1.0F, "odd tail is pass-through");
  }
}

void testResetReplayAndFinite() {
  constexpr std::uint32_t frames = 257u;
  Harness harness(192000.0F, 8u);
  const Params settings{20.0F, 100.0F, -15.5F, 91.25F, 1.0F, 359.5F};
  std::vector<float> first = signal(8u, frames);
  std::vector<float> replay = first;
  harness.stage(settings);
  harness.process(first, 8u, frames);
  harness.reset();
  harness.stage(settings);
  harness.process(replay, 8u, frames);
  check(first == replay, "reset replays phase and gain state exactly");
  for (float sample : first)
    check(std::isfinite(sample), "maximum shape remains finite");
}

void testLatestFadeUpRequestWaitsForNextDryMidpoint() {
  Harness latest(1000.0F, 2u);
  Harness cancelled(1000.0F, 2u);
  Harness unchanged(1000.0F, 2u);
  Params sine = params();
  sine.rate = 20.0F;
  sine.phase = 37.0F;
  Params triangle = sine;
  triangle.waveform = 1.0F;

  for (Harness *harness : {&latest, &cancelled, &unchanged}) {
    harness->stage(sine);
    std::vector<float> initialize(2u, 1.0F);
    harness->process(initialize, 2u, 1u);
    harness->stage(triangle);
    std::vector<float> enter_fade_up(8u, 1.0F);
    harness->process(enter_fade_up, 2u, 4u);
  }

  latest.stage(sine);
  cancelled.stage(sine);
  std::vector<float> latest_completion(6u, 1.0F);
  std::vector<float> cancelled_completion = latest_completion;
  std::vector<float> unchanged_completion = latest_completion;
  latest.process(latest_completion, 2u, 3u);
  cancelled.process(cancelled_completion, 2u, 3u);
  unchanged.process(unchanged_completion, 2u, 3u);
  check(latest_completion == unchanged_completion,
        "a fade-up request does not switch the full-wet waveform directly");
  check(cancelled_completion == unchanged_completion,
        "cancellation setup follows the unchanged waveform through fade-up");

  cancelled.stage(triangle);
  std::vector<float> latest_before_midpoint(6u, 1.0F);
  std::vector<float> cancelled_before_midpoint = latest_before_midpoint;
  latest.process(latest_before_midpoint, 2u, 3u);
  cancelled.process(cancelled_before_midpoint, 2u, 3u);
  check(latest_before_midpoint == cancelled_before_midpoint,
        "re-specification and cancellation remain inactive before the dry midpoint");

  std::vector<float> latest_midpoint(2u, 1.0F);
  std::vector<float> cancelled_midpoint = latest_midpoint;
  latest.process(latest_midpoint, 2u, 1u);
  cancelled.process(cancelled_midpoint, 2u, 1u);
  check(latest_midpoint == cancelled_midpoint,
        "waveform adoption occurs on the dry midpoint sample");

  std::vector<float> latest_after_midpoint(2u, 1.0F);
  std::vector<float> cancelled_after_midpoint = latest_after_midpoint;
  latest.process(latest_after_midpoint, 2u, 1u);
  cancelled.process(cancelled_after_midpoint, 2u, 1u);
  check(latest_after_midpoint != cancelled_after_midpoint,
        "the re-specified waveform becomes audible only after the midpoint");
}

} // namespace

int main() {
  testNeutralMonoAndPairs();
  testResetReplayAndFinite();
  testLatestFadeUpRequestWaitsForNextDryMidpoint();
  return failures == 0 ? 0 : 1;
}
