#include "PitchShifterPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_PitchShifterPlugin() noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
using Params = effetune::generated::PitchShifterPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Pitch Shifter check failed: %s\n", message);
    ++failures;
  }
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 48000.0F, std::uint32_t max_channels = 4u,
                         std::uint32_t max_frames = kMaximumFrames) {
    descriptor_ = et_kernel_descriptor_PitchShifterPlugin();
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
      kernel_->prepare({sample_rate, max_channels, max_frames});
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

  void reset() noexcept {
    if (kernel_ != nullptr) {
      kernel_->reset();
    }
  }

  void stage(const Params &params) noexcept {
    if (kernel_ == nullptr) {
      return;
    }
    const et_status status =
        kernel_->stageParameters(&params.pitchShift, Params::kFloatCount, Params::kHash);
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

Params activeParams(float pitch = -6.0F, float fine = 0.0F, float window = 80.0F,
                    float crossfade = 20.0F) noexcept {
  return {pitch, fine, window, crossfade};
}

std::vector<float> signal(std::uint32_t frames, std::uint32_t channels, std::uint32_t phase) {
  std::vector<float> result(static_cast<std::size_t>(frames) * channels);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    const std::size_t offset = static_cast<std::size_t>(channel) * frames;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      result[offset + frame] =
          static_cast<float>(0.57 * std::sin((frame + phase + channel * 7u) * 0.173) +
                             0.21 * std::cos((frame + phase * 3u + channel) * 0.071));
    }
  }
  return result;
}

std::vector<float> renderSequence(KernelHarness &harness, const Params &params,
                                  std::uint32_t channels, std::uint32_t block_count,
                                  std::uint32_t phase) {
  constexpr std::array<std::uint32_t, 4> block_sizes = {127u, 61u, 113u, 79u};
  std::vector<float> rendered;
  rendered.reserve(static_cast<std::size_t>(block_count) * channels * 128u);
  for (std::uint32_t block = 0u; block < block_count; ++block) {
    const std::uint32_t frames = block_sizes[block % block_sizes.size()];
    std::vector<float> audio = signal(frames, channels, phase + block * 131u);
    harness.stage(params);
    harness.process(audio, channels, frames);
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

void testResetReplay() {
  const Params params = activeParams();
  KernelHarness harness;
  const std::vector<float> first = renderSequence(harness, params, 2u, 200u, 3u);
  harness.reset();
  const std::vector<float> replay = renderSequence(harness, params, 2u, 200u, 3u);

  bool contains_audio = false;
  for (const float sample : first) {
    contains_audio = contains_audio || sample != 0.0F;
  }
  check(first == replay, "reset reproduces all ring and index state");
  check(contains_audio, "replay sequence reaches processed output");
  check(finite(first), "replay output remains finite");
}

void testUnityPitchFreezesBeforeShapeChange() {
  KernelHarness paused;
  KernelHarness uninterrupted;
  const Params active = activeParams(-4.0F, 0.0F, 80.0F, 20.0F);
  const std::vector<float> prefix_paused = renderSequence(paused, active, 2u, 180u, 11u);
  const std::vector<float> prefix_uninterrupted =
      renderSequence(uninterrupted, active, 2u, 180u, 11u);
  check(prefix_paused == prefix_uninterrupted, "prefixes start in lockstep");

  std::vector<float> bypass = signal(97u, 4u, 1701u);
  const std::vector<float> bypass_input = bypass;
  paused.stage(activeParams(0.0F, 0.0F, 500.0F, 40.0F));
  paused.process(bypass, 4u, 97u);
  check(bypass == bypass_input, "unity pitch returns all channels unchanged");

  const std::vector<float> resumed = renderSequence(paused, active, 2u, 32u, 2501u);
  const std::vector<float> control = renderSequence(uninterrupted, active, 2u, 32u, 2501u);
  check(resumed == control, "unity pitch freezes state and defers shape reset");
}

void testShapeChangesResetAllState() {
  KernelHarness evolved;
  KernelHarness fresh;
  static_cast<void>(renderSequence(evolved, activeParams(-6.0F, 0.0F, 80.0F, 20.0F), 2u, 72u, 5u));

  const Params changed = activeParams(3.0F, 25.0F, 100.0F, 25.0F);
  const std::vector<float> after_change = renderSequence(evolved, changed, 4u, 160u, 3001u);
  const std::vector<float> from_fresh = renderSequence(fresh, changed, 4u, 160u, 3001u);
  check(after_change == from_fresh, "channel, window, and hop shape changes fully reset state");
  check(finite(after_change), "shape-reset output remains finite");
}

void testInvalidHopFallsBackToHalfWindow() {
  KernelHarness fallback;
  KernelHarness explicit_half;
  const Params invalid = activeParams(-6.0F, 0.0F, 80.0F, 500.0F);
  const Params valid = activeParams(-6.0F, 0.0F, 80.0F, 40.0F);
  const std::vector<float> fallback_output = renderSequence(fallback, invalid, 1u, 200u, 101u);
  const std::vector<float> explicit_output = renderSequence(explicit_half, valid, 1u, 200u, 101u);
  check(fallback_output == explicit_output, "invalid hop falls back to half the logical window");
}

void testMaximumPreparedCapacity() {
  KernelHarness maximum(192000.0F, 8u, kMaximumFrames);
  std::vector<float> audio = signal(31u, 8u, 17u);
  maximum.stage(activeParams(6.0F, 50.0F, 500.0F, 40.0F));
  maximum.process(audio, 8u, 31u);

  bool all_zero = true;
  for (const float sample : audio) {
    all_zero = all_zero && sample == 0.0F;
  }
  check(all_zero, "maximum shape preserves initial zero-ring underrun");
  check(finite(audio), "maximum shape output remains finite");
}

} // namespace

int main() {
  testResetReplay();
  testUnityPitchFreezesBeforeShapeChange();
  testShapeChangesResetAllState();
  testInvalidHopFallsBackToHalfWindow();
  testMaximumPreparedCapacity();
  return failures == 0 ? 0 : 1;
}
