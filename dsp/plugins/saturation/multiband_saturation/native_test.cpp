#include "MultibandSaturationPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_MultibandSaturationPlugin() noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
using Params = effetune::generated::MultibandSaturationPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Multiband Saturation check failed: %s\n", message);
    ++failures;
  }
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 48000.0F, std::uint32_t max_channels = 4u) {
    descriptor_ = et_kernel_descriptor_MultibandSaturationPlugin();
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
      kernel_->prepare({sample_rate, max_channels, kMaximumFrames});
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
        kernel_->stageParameters(&params.frequency1, Params::kFloatCount, Params::kHash);
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

Params defaultParams(float frequency1 = 200.0F, float frequency2 = 4000.0F) noexcept {
  return {frequency1,
          frequency2,
          {1.5F, 1.5F, 1.5F},
          {0.1F, 0.1F, 0.1F},
          {100.0F, 100.0F, 100.0F},
          {0.0F, 0.0F, 0.0F}};
}

Params changedBandParams() noexcept {
  return {200.0F,
          4000.0F,
          {10.0F, 0.0F, 6.5F},
          {-0.3F, 0.0F, 0.25F},
          {100.0F, 0.0F, 37.5F},
          {18.0F, -18.0F, 6.0F}};
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
  constexpr std::array<std::uint32_t, 4> block_sizes = {127u, 64u, 113u, 31u};
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
  KernelHarness harness;
  const Params params = defaultParams();
  const std::vector<float> first = renderSequence(harness, params, 2u, 40u, 3u);
  harness.reset();
  const std::vector<float> replay = renderSequence(harness, params, 2u, 40u, 3u);
  check(first == replay, "reset reproduces filters, buffers, and fade");
  check(finite(first), "reset replay remains finite");
}

void testBandChangesPreserveFilterState() {
  KernelHarness changed;
  KernelHarness control;
  const Params defaults = defaultParams();
  static_cast<void>(renderSequence(changed, defaults, 2u, 24u, 11u));
  static_cast<void>(renderSequence(control, defaults, 2u, 24u, 11u));

  std::vector<float> changed_block = signal(127u, 2u, 4101u);
  std::vector<float> control_block = changed_block;
  changed.stage(changedBandParams());
  control.stage(defaults);
  changed.process(changed_block, 2u, 127u);
  control.process(control_block, 2u, 127u);
  check(changed_block != control_block, "band parameters alter only rendered bands");

  const std::vector<float> changed_suffix = renderSequence(changed, defaults, 2u, 20u, 5001u);
  const std::vector<float> control_suffix = renderSequence(control, defaults, 2u, 20u, 5001u);
  check(changed_suffix == control_suffix, "band changes preserve all Linkwitz-Riley state");
}

void testFrequencyAndChannelChangesResetState() {
  KernelHarness evolved;
  KernelHarness fresh;
  static_cast<void>(renderSequence(evolved, defaultParams(), 2u, 32u, 7u));
  const Params changed = defaultParams(1600.0F, 18000.0F);
  const std::vector<float> after_change = renderSequence(evolved, changed, 4u, 24u, 7001u);
  const std::vector<float> from_fresh = renderSequence(fresh, changed, 4u, 24u, 7001u);
  check(after_change == from_fresh, "frequency and channel changes reset filters and fade");
  check(finite(after_change), "shape-reset output remains finite");
}

void testMaximumSampleRateAndChannels() {
  KernelHarness maximum(192000.0F, 8u);
  const std::vector<float> output =
      renderSequence(maximum, defaultParams(2000.0F, 20000.0F), 8u, 16u, 101u);
  check(finite(output), "192 kHz eight-channel output remains finite");
}

} // namespace

int main() {
  testResetReplay();
  testBandChangesPreserveFilterState();
  testFrequencyAndChannelChangesResetState();
  testMaximumSampleRateAndChannels();
  return failures == 0 ? 0 : 1;
}
