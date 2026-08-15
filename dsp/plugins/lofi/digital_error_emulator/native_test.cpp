#include "DigitalErrorEmulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_DigitalErrorEmulatorPlugin() noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
using Params = effetune::generated::DigitalErrorEmulatorPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Digital Error Emulator check failed: %s\n", message);
    ++failures;
  }
}

class KernelHarness final {
public:
  KernelHarness() {
    descriptor_ = et_kernel_descriptor_DigitalErrorEmulatorPlugin();
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
        kernel_->stageParameters(&params.bitErrorRateExponent, Params::kFloatCount, Params::kHash);
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

Params bluetoothLeParams(float wet_mix) noexcept { return {-2.0F, 10.0F, 48.0F, wet_mix}; }

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

std::vector<float> renderPartition(const std::vector<std::uint32_t> &partition) {
  constexpr std::uint32_t channels = 2u;
  std::uint32_t total_frames = 0u;
  for (const std::uint32_t frames : partition) {
    total_frames += frames;
  }
  const std::vector<float> source = signal(total_frames, channels, 23u);
  std::vector<float> result(static_cast<std::size_t>(channels) * total_frames);
  KernelHarness harness;
  harness.seed(0x6e23a91bu, 0u);
  const Params params{-2.0F, 2.0F, 48.0F, 100.0F};
  std::uint32_t position = 0u;
  for (const std::uint32_t frames : partition) {
    std::vector<float> block(static_cast<std::size_t>(channels) * frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::copy_n(source.data() + channel * total_frames + position, frames,
                  block.data() + channel * frames);
    }
    harness.stage(params);
    harness.process(block, channels, frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::copy_n(block.data() + channel * frames, frames,
                  result.data() + channel * total_frames + position);
    }
    position += frames;
  }
  return result;
}

void testPendingScheduleIsPartitionInvariant() {
  const std::vector<float> blocks128 = renderPartition({128u, 128u, 128u});
  std::vector<std::uint32_t> blocks8(48u, 8u);
  const std::vector<float> quantum8 = renderPartition(blocks8);
  const std::vector<float> irregular = renderPartition({7u, 31u, 5u, 113u, 19u, 83u, 126u});
  check(blocks128 == quantum8, "pending event schedule is invariant at Q=8");
  check(blocks128 == irregular, "pending event schedule is invariant for irregular blocks");
}

void testSeedAndResetReplay() {
  constexpr std::uint32_t seed_low = 0x13579bdfu;
  constexpr std::uint32_t seed_high = 0x2468ace0u;
  const Params params = bluetoothLeParams(100.0F);

  KernelHarness harness;
  harness.seed(seed_low, seed_high);
  const std::vector<float> first = renderSequence(harness, params);
  harness.seed(seed_low, seed_high);
  const std::vector<float> replay = renderSequence(harness, params);
  harness.seed(seed_low ^ 0x01010101u, seed_high);
  const std::vector<float> different_seed = renderSequence(harness, params);

  check(first == replay, "reset and reseed reproduce branch-sensitive RNG");
  check(first != different_seed, "different seed changes branch-sensitive output");
  check(finite(first), "seeded output remains finite");
}

void testWetMixDoesNotResetSchedule() {
  constexpr std::uint32_t seed_low = 0xeffe7a5eu;
  constexpr std::uint32_t seed_high = 0u;
  KernelHarness dry_prefix;
  KernelHarness wet_prefix;
  dry_prefix.seed(seed_low, seed_high);
  wet_prefix.seed(seed_low, seed_high);

  std::vector<float> first_dry = signal(127u, 2u, 19u);
  std::vector<float> first_wet = first_dry;
  dry_prefix.stage(bluetoothLeParams(0.0F));
  wet_prefix.stage(bluetoothLeParams(100.0F));
  dry_prefix.process(first_dry, 2u, 127u);
  wet_prefix.process(first_wet, 2u, 127u);
  check(first_dry != first_wet, "wet mix changes only the rendered prefix");

  std::vector<float> suffix_dry = signal(113u, 2u, 211u);
  std::vector<float> suffix_wet = suffix_dry;
  const Params wet = bluetoothLeParams(100.0F);
  dry_prefix.stage(wet);
  wet_prefix.stage(wet);
  dry_prefix.process(suffix_dry, 2u, 113u);
  wet_prefix.process(suffix_wet, 2u, 113u);
  check(suffix_dry == suffix_wet, "wet mix transition preserves schedule, RNG, and PLC state");
}

void testChannelResetRemainsDeterministic() {
  constexpr std::uint32_t seed_low = 0x10203040u;
  const Params params = bluetoothLeParams(100.0F);
  KernelHarness first;
  KernelHarness second;
  first.seed(seed_low, 0u);
  second.seed(seed_low, 0u);

  std::vector<float> prefix_first = signal(79u, 2u, 3u);
  std::vector<float> prefix_second = prefix_first;
  first.stage(params);
  second.stage(params);
  first.process(prefix_first, 2u, 79u);
  second.process(prefix_second, 2u, 79u);

  std::vector<float> grown_first = signal(97u, 4u, 149u);
  std::vector<float> grown_second = grown_first;
  first.stage(params);
  second.stage(params);
  first.process(grown_first, 4u, 97u);
  second.process(grown_second, 4u, 97u);
  check(grown_first == grown_second, "channel-count reset preserves deterministic RNG progression");
  check(finite(grown_first), "channel-count transition remains finite");
}

void testBerAndReferenceChangesPreserveOngoingError() {
  constexpr std::uint32_t seed_low = 0x55aa31c7u;
  KernelHarness changed;
  KernelHarness control;
  changed.seed(seed_low, 0u);
  control.seed(seed_low, 0u);

  const Params initial = bluetoothLeParams(100.0F);
  std::vector<float> prefix_changed = signal(128u, 2u, 17u);
  std::vector<float> prefix_control = prefix_changed;
  changed.stage(initial);
  control.stage(initial);
  changed.process(prefix_changed, 2u, 128u);
  control.process(prefix_control, 2u, 128u);
  check(prefix_changed == prefix_control, "seeded error prefix matches");

  Params retargeted = initial;
  retargeted.bitErrorRateExponent = -10.0F;
  retargeted.referenceFs = 96.0F;
  std::vector<float> suffix_changed = signal(128u, 2u, 145u);
  std::vector<float> suffix_control = suffix_changed;
  changed.stage(retargeted);
  control.stage(initial);
  changed.process(suffix_changed, 2u, 128u);
  control.process(suffix_control, 2u, 128u);
  check(suffix_changed == suffix_control,
        "BER/reference retarget preserves the active event and its concealment state");
}

} // namespace

int main() {
  testSeedAndResetReplay();
  testWetMixDoesNotResetSchedule();
  testChannelResetRemainsDeterministic();
  testBerAndReferenceChangesPreserveOngoingError();
  testPendingScheduleIsPartitionInvariant();
  return failures == 0 ? 0 : 1;
}
