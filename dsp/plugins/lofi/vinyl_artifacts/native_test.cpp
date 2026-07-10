#include "VinylArtifactsPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_VinylArtifactsPlugin() noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
using Params = effetune::generated::VinylArtifactsPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Vinyl Artifacts check failed: %s\n", message);
    ++failures;
  }
}

class KernelHarness final {
public:
  KernelHarness() {
    descriptor_ = et_kernel_descriptor_VinylArtifactsPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr) {
      return;
    }
    check(descriptor_->objectSize <= storage_.size(), "kernel fits storage");
    check(descriptor_->paramsHash == Params::kHash, "descriptor hash matches");
    check(descriptor_->paramsFloatCount == Params::kFloatCount,
          "descriptor parameter count matches");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      kernel_->prepare({48000.0F, 4u, kMaximumFrames});
      kernel_->reset();
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  void seed(std::uint32_t low, std::uint32_t high) noexcept {
    if (kernel_ != nullptr) {
      kernel_->setRandomSeed(low, high);
      kernel_->reset();
    }
  }

  void stage(const Params &params) noexcept {
    if (kernel_ == nullptr) {
      return;
    }
    const et_status status =
        kernel_->stageParameters(&params.popsPerMinute, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
  }

  void process(std::vector<float> &audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    if (kernel_ == nullptr) {
      return;
    }
    check(audio.size() == static_cast<std::size_t>(channels) * frames, "audio shape matches");
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->applyPendingParameters();
    kernel_->process(audio.data(), channels, frames, {0.0});
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

Params artifactParams(float mix) noexcept {
  return {120.0F, 0.0F, 2000.0F, 0.0F, 0.0F, 0.0F, 100.0F, 3.5F, 200.0F, 100.0F, 0.0F, mix};
}

std::vector<float> signal(std::uint32_t frames, std::uint32_t channels, std::uint32_t phase) {
  std::vector<float> result(static_cast<std::size_t>(frames) * channels);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    const std::uint32_t offset = channel * frames;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      result[offset + frame] =
          static_cast<float>(0.61 * std::sin((frame + phase + channel * 11u) * 0.137) +
                             0.23 * std::cos((frame + phase * 3u + channel) * 0.053));
    }
  }
  return result;
}

std::vector<float> renderSequence(KernelHarness &harness, const Params &params) {
  constexpr std::array<std::uint32_t, 4> block_sizes = {63u, 128u, 17u, 91u};
  std::vector<float> rendered;
  for (std::size_t block = 0u; block < block_sizes.size(); ++block) {
    const std::uint32_t frames = block_sizes[block];
    std::vector<float> audio = signal(frames, 2u, static_cast<std::uint32_t>(block) * 131u + 7u);
    harness.stage(params);
    harness.process(audio, 2u, frames);
    rendered.insert(rendered.end(), audio.begin(), audio.end());
  }
  return rendered;
}

bool finite(const std::vector<float> &audio) noexcept {
  for (const float sample : audio) {
    if (!std::isfinite(sample)) {
      return false;
    }
  }
  return true;
}

void testSeedAndResetReplay() {
  constexpr std::uint32_t seed_low = 0x13579bdfu;
  constexpr std::uint32_t seed_high = 0x2468ace0u;
  const Params params = artifactParams(100.0F);

  KernelHarness harness;
  harness.seed(seed_low, seed_high);
  const std::vector<float> first = renderSequence(harness, params);
  harness.seed(seed_low, seed_high);
  const std::vector<float> replay = renderSequence(harness, params);
  harness.seed(seed_low ^ 0x01010101u, seed_high);
  const std::vector<float> different_seed = renderSequence(harness, params);

  check(first == replay, "reset and reseed reproduce all noise state");
  check(first != different_seed, "different seed changes generated artifacts");
  check(finite(first), "seeded output remains finite");
}

void testZeroMixFreezesStateBeforeChannelChange() {
  constexpr std::uint32_t seed_low = 0xeffe7a5eu;
  constexpr std::uint32_t seed_high = 0x10203040u;
  KernelHarness paused;
  KernelHarness uninterrupted;
  paused.seed(seed_low, seed_high);
  uninterrupted.seed(seed_low, seed_high);

  std::vector<float> prefix_paused = signal(127u, 2u, 19u);
  std::vector<float> prefix_uninterrupted = prefix_paused;
  paused.stage(artifactParams(100.0F));
  uninterrupted.stage(artifactParams(100.0F));
  paused.process(prefix_paused, 2u, 127u);
  uninterrupted.process(prefix_uninterrupted, 2u, 127u);
  check(prefix_paused == prefix_uninterrupted, "prefixes start in lockstep");

  std::vector<float> bypass = signal(61u, 4u, 137u);
  const std::vector<float> bypass_input = bypass;
  paused.stage(artifactParams(0.0F));
  paused.process(bypass, 4u, 61u);
  check(bypass == bypass_input, "zero mix returns every channel unchanged");

  std::vector<float> suffix_paused = signal(113u, 2u, 257u);
  std::vector<float> suffix_uninterrupted = suffix_paused;
  paused.stage(artifactParams(100.0F));
  uninterrupted.stage(artifactParams(100.0F));
  paused.process(suffix_paused, 2u, 113u);
  uninterrupted.process(suffix_uninterrupted, 2u, 113u);
  check(suffix_paused == suffix_uninterrupted,
        "zero mix freezes RNG and defers channel-count reset");
}

void testExtraChannelsAdvanceButRemainUnwritten() {
  constexpr std::uint32_t seed_low = 0x31415926u;
  constexpr std::uint32_t seed_high = 0x27182818u;
  KernelHarness all_channels;
  KernelHarness stereo_only;
  all_channels.seed(seed_low, seed_high);
  stereo_only.seed(seed_low, seed_high);

  std::vector<float> all_input = signal(97u, 4u, 11u);
  const std::vector<float> original = all_input;
  std::vector<float> stereo_input = signal(97u, 2u, 11u);
  const Params params = artifactParams(100.0F);
  all_channels.stage(params);
  stereo_only.stage(params);
  all_channels.process(all_input, 4u, 97u);
  stereo_only.process(stereo_input, 2u, 97u);

  bool stereo_changed = false;
  bool extra_unchanged = true;
  for (std::uint32_t channel = 0u; channel < 4u; ++channel) {
    for (std::uint32_t frame = 0u; frame < 97u; ++frame) {
      const std::size_t index = static_cast<std::size_t>(channel) * 97u + frame;
      if (channel < 2u) {
        stereo_changed = stereo_changed || all_input[index] != original[index];
      } else {
        extra_unchanged = extra_unchanged && all_input[index] == original[index];
      }
    }
  }
  check(stereo_changed, "first stereo pair receives generated artifacts");
  check(extra_unchanged, "channels above the stereo pair remain untouched");

  std::vector<float> all_suffix = signal(89u, 1u, 211u);
  std::vector<float> stereo_suffix = all_suffix;
  all_channels.stage(params);
  stereo_only.stage(params);
  all_channels.process(all_suffix, 1u, 89u);
  stereo_only.process(stereo_suffix, 1u, 89u);
  check(all_suffix != stereo_suffix, "hidden channels consume additional RNG draws");
  check(finite(all_input) && finite(all_suffix), "four-channel state progression remains finite");
}

} // namespace

int main() {
  testSeedAndResetReplay();
  testZeroMixFreezesStateBeforeChannelChange();
  testExtraChannelsAdvanceButRemainUnwritten();
  return failures == 0 ? 0 : 1;
}
