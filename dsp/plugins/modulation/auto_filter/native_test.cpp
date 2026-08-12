#include "AutoFilterPluginParams.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_AutoFilterPlugin() noexcept;

namespace {

using Params = effetune::generated::AutoFilterPluginParams;
constexpr std::size_t kKernelStorageBytes = 8192u;
constexpr std::uint32_t kMaxFrames = 257u;
int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Auto Filter check failed: %s\n", message);
    ++failures;
  }
}

class Harness final {
public:
  Harness(float sample_rate, std::uint32_t channels) {
    descriptor_ = et_kernel_descriptor_AutoFilterPlugin();
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
        kernel_->stageParameters(&params.mode, Params::kFloatCount, Params::kHash);
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

Params params(float low = 200.0F, float high = 4000.0F, float mix = 100.0F) noexcept {
  return {0.0F, 0.0F, low, high, 2.0F, mix, 0.5F, 0.0F, 90.0F, 24.0F, 20.0F, 250.0F, 0.0F};
}

std::vector<float> signal(std::uint32_t channels, std::uint32_t frames) {
  std::vector<float> audio(static_cast<std::size_t>(channels) * frames);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double phase = static_cast<double>(frame) * 0.071 + channel * 0.31;
      audio[static_cast<std::size_t>(channel) * frames + frame] =
          static_cast<float>(0.8 * std::sin(phase));
    }
  }
  return audio;
}

void testDryAndCanonicalBounds() {
  constexpr std::uint32_t frames = 257u;
  Harness dry_harness(48000.0F, 2u);
  std::vector<float> dry = signal(2u, frames);
  const std::vector<float> input = dry;
  dry_harness.stage(params(20000.0F, 20.0F, 0.0F));
  dry_harness.process(dry, 2u, frames);
  check(dry == input, "Mix zero is sample-exact dry");

  Harness reversed_harness(48000.0F, 2u);
  Harness canonical_harness(48000.0F, 2u);
  std::vector<float> reversed = input;
  std::vector<float> canonical = input;
  reversed_harness.stage(params(8000.0F, 100.0F));
  canonical_harness.stage(params(100.0F, 8000.0F));
  reversed_harness.process(reversed, 2u, frames);
  canonical_harness.process(canonical, 2u, frames);
  check(reversed == canonical, "reversed bounds equal the canonical complete snapshot");
}

void testExtremeEnvelopeFiniteAndReset() {
  constexpr std::uint32_t frames = 257u;
  Harness harness(192000.0F, 8u);
  const Params extreme{1.0F, 2.0F,   20.0F, 20000.0F, 20.0F, 100.0F, 20.0F,
                       1.0F, 180.0F, 60.0F, 1.0F,     10.0F, 1.0F};
  std::vector<float> first = signal(8u, frames);
  std::vector<float> replay = first;
  harness.stage(extreme);
  harness.process(first, 8u, frames);
  harness.reset();
  harness.stage(extreme);
  harness.process(replay, 8u, frames);
  check(first == replay, "reset replays controller and filter state exactly");
  for (float sample : first)
    check(std::isfinite(sample), "maximum-Q envelope output is finite");
}

void testLatestPendingTransitionContinuesInsideLongBlock() {
  Harness first(1000.0F, 1u);
  Harness second(1000.0F, 1u);
  Params initial = params(100.0F, 400.0F);
  initial.mix = 100.0F;
  Params midpoint = initial;
  midpoint.mode = 1.0F;
  midpoint.filterType = 1.0F;
  midpoint.direction = 1.0F;
  Params first_pending = initial;
  first_pending.filterType = 2.0F;
  first_pending.waveform = 1.0F;
  Params second_pending = initial;
  second_pending.mode = 1.0F;
  second_pending.direction = 0.0F;

  for (Harness *harness : {&first, &second}) {
    harness->stage(initial);
    std::vector<float> initialize(1u, 0.25F);
    harness->process(initialize, 1u, 1u);
    harness->stage(midpoint);
    std::vector<float> enter_fade_up(4u, 0.25F);
    harness->process(enter_fade_up, 1u, 4u);
  }

  first.stage(first_pending);
  second.stage(second_pending);
  std::vector<float> first_to_midpoint = signal(1u, 7u);
  std::vector<float> second_to_midpoint = first_to_midpoint;
  first.process(first_to_midpoint, 1u, 7u);
  second.process(second_to_midpoint, 1u, 7u);
  check(first_to_midpoint == second_to_midpoint,
        "latest pending topology stays inactive until the next dry midpoint");

  std::vector<float> first_after_midpoint = signal(1u, 3u);
  std::vector<float> second_after_midpoint = first_after_midpoint;
  first.process(first_after_midpoint, 1u, 3u);
  second.process(second_after_midpoint, 1u, 3u);
  check(first_after_midpoint != second_after_midpoint,
        "next transition advances inside the long fade-up block");
}

} // namespace

int main() {
  testDryAndCanonicalBounds();
  testExtremeEnvelopeFiniteAndReset();
  testLatestPendingTransitionContinuesInsideLongBlock();
  return failures == 0 ? 0 : 1;
}
