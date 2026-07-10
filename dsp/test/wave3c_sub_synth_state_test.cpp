#include "SubSynthPluginParams.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_SubSynthPlugin() noexcept;

namespace {

constexpr std::uint32_t kMaxFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
using Params = effetune::generated::SubSynthPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "SubSynth state check failed: %s\n", message);
    ++failures;
  }
}

class KernelHarness final {
public:
  KernelHarness() {
    descriptor_ = et_kernel_descriptor_SubSynthPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr) {
      return;
    }
    check(descriptor_->objectSize <= storage_.size(), "kernel fits storage");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      kernel_->prepare({48000.0F, 2u, kMaxFrames});
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

  void setParams(const Params &params) noexcept {
    if (kernel_ == nullptr) {
      return;
    }
    const et_status status =
        kernel_->stageParameters(&params.subLevel, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
    kernel_->applyPendingParameters();
  }

  void process(std::vector<float> &audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    if (kernel_ == nullptr) {
      return;
    }
    check(audio.size() == static_cast<std::size_t>(channels) * frames, "audio shape matches");
    kernel_->process(audio.data(), channels, frames, {0.0});
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

Params defaultParams() noexcept {
  return {137.0F, 83.0F, 173.0F, -18.0F, 17.0F, -12.0F, 43.0F, -6.0F};
}

std::vector<float> signal(std::uint32_t frames, std::uint32_t channels, std::uint32_t phase) {
  std::vector<float> result(static_cast<std::size_t>(frames) * channels);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    const std::uint32_t offset = channel * frames;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      result[offset + frame] = static_cast<float>(
          0.55 * std::sin(static_cast<double>(frame + phase + channel * 7u) * 0.173) +
          0.2 * std::cos(static_cast<double>(frame + phase * 3u + channel) * 0.071));
    }
  }
  return result;
}

std::vector<float> channel(const std::vector<float> &audio, std::uint32_t frames,
                           std::uint32_t channel_index) {
  const auto begin = audio.begin() + static_cast<std::ptrdiff_t>(channel_index * frames);
  return {begin, begin + static_cast<std::ptrdiff_t>(frames)};
}

bool finite(const std::vector<float> &audio) noexcept {
  for (const float sample : audio) {
    if (!std::isfinite(sample)) {
      return false;
    }
  }
  return true;
}

bool channelEquals(const std::vector<float> &actual, std::uint32_t frames,
                   std::uint32_t channel_index, const std::vector<float> &expected) noexcept {
  if (expected.size() != frames) {
    return false;
  }
  const std::uint32_t offset = channel_index * frames;
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    if (actual[offset + frame] != expected[frame]) {
      return false;
    }
  }
  return true;
}

void testChannelGrowth() {
  constexpr std::uint32_t prefix_frames = 47u;
  constexpr std::uint32_t suffix_frames = 43u;
  const Params params = defaultParams();
  const std::vector<float> prefix = signal(prefix_frames, 1u, 13u);
  const std::vector<float> suffix = signal(suffix_frames, 2u, 101u);

  KernelHarness grown;
  grown.setParams(params);
  std::vector<float> grown_prefix = prefix;
  grown.process(grown_prefix, 1u, prefix_frames);
  std::vector<float> actual = suffix;
  grown.process(actual, 2u, suffix_frames);

  KernelHarness channel_zero;
  channel_zero.setParams(params);
  std::vector<float> zero_prefix = prefix;
  channel_zero.process(zero_prefix, 1u, prefix_frames);
  std::vector<float> expected_zero = channel(suffix, suffix_frames, 0u);
  channel_zero.process(expected_zero, 1u, suffix_frames);

  KernelHarness channel_one;
  channel_one.setParams(params);
  std::vector<float> expected_one = channel(suffix, suffix_frames, 1u);
  channel_one.process(expected_one, 1u, suffix_frames);

  check(finite(actual), "1-to-2 output remains finite");
  check(channelEquals(actual, suffix_frames, 0u, expected_zero),
        "existing channel state survives growth");
  check(channelEquals(actual, suffix_frames, 1u, expected_one),
        "new channel starts from zero state");
}

void testChannelShrinkAndRegrowth() {
  constexpr std::uint32_t prefix_frames = 47u;
  constexpr std::uint32_t middle_frames = 31u;
  constexpr std::uint32_t suffix_frames = 43u;
  const Params params = defaultParams();
  const std::vector<float> prefix = signal(prefix_frames, 2u, 29u);
  const std::vector<float> middle = signal(middle_frames, 1u, 79u);
  const std::vector<float> suffix = signal(suffix_frames, 2u, 101u);

  KernelHarness regrown;
  regrown.setParams(params);
  std::vector<float> actual_prefix = prefix;
  regrown.process(actual_prefix, 2u, prefix_frames);
  std::vector<float> actual_middle = middle;
  regrown.process(actual_middle, 1u, middle_frames);
  std::vector<float> actual = suffix;
  regrown.process(actual, 2u, suffix_frames);

  KernelHarness channel_zero;
  channel_zero.setParams(params);
  std::vector<float> zero_prefix = channel(prefix, prefix_frames, 0u);
  channel_zero.process(zero_prefix, 1u, prefix_frames);
  std::vector<float> zero_middle = middle;
  channel_zero.process(zero_middle, 1u, middle_frames);
  std::vector<float> expected_zero = channel(suffix, suffix_frames, 0u);
  channel_zero.process(expected_zero, 1u, suffix_frames);

  KernelHarness channel_one;
  channel_one.setParams(params);
  std::vector<float> one_prefix = channel(prefix, prefix_frames, 1u);
  channel_one.process(one_prefix, 1u, prefix_frames);
  std::vector<float> expected_one = channel(suffix, suffix_frames, 1u);
  channel_one.process(expected_one, 1u, suffix_frames);

  check(finite(actual), "2-to-1-to-2 output remains finite");
  check(channelEquals(actual, suffix_frames, 0u, expected_zero),
        "active channel remains continuous across shrink");
  check(channelEquals(actual, suffix_frames, 1u, expected_one),
        "inactive channel state survives shrink and regrowth");
}

void testSameCountTopologyReset() {
  constexpr std::uint32_t prefix_frames = 47u;
  constexpr std::uint32_t suffix_frames = 43u;
  Params first_order = defaultParams();
  first_order.dryLevel = 0.0F;
  first_order.subLowPassSlope = -6.0F;
  first_order.subHighPassSlope = 0.0F;
  first_order.dryHighPassSlope = 0.0F;
  Params second_order = first_order;
  second_order.subLowPassSlope = -12.0F;
  const std::vector<float> prefix = signal(prefix_frames, 1u, 17u);
  const std::vector<float> suffix = signal(suffix_frames, 1u, 113u);

  KernelHarness changed;
  changed.setParams(first_order);
  std::vector<float> changed_prefix = prefix;
  changed.process(changed_prefix, 1u, prefix_frames);
  changed.setParams(second_order);
  std::vector<float> actual = suffix;
  changed.process(actual, 1u, suffix_frames);

  KernelHarness fresh;
  fresh.setParams(second_order);
  std::vector<float> expected = suffix;
  fresh.process(expected, 1u, suffix_frames);

  check(finite(actual), "same-count topology transition remains finite");
  check(actual == expected, "first-to-second-order transition resets chain state");
}

void testOutOfRangeSlopeClampsToStageCapacity() {
  constexpr std::uint32_t frames = 61u;
  Params maximum_slope = defaultParams();
  maximum_slope.dryLevel = 0.0F;
  maximum_slope.subLowPassSlope = -24.0F;
  maximum_slope.subHighPassSlope = 0.0F;
  maximum_slope.dryHighPassSlope = 0.0F;
  Params out_of_range = maximum_slope;
  out_of_range.subLowPassSlope = -30.0F;
  const std::vector<float> input = signal(frames, 2u, 37u);

  KernelHarness bounded;
  bounded.setParams(maximum_slope);
  std::vector<float> expected = input;
  bounded.process(expected, 2u, frames);

  KernelHarness defended;
  defended.setParams(out_of_range);
  std::vector<float> actual = input;
  defended.process(actual, 2u, frames);

  check(finite(actual), "out-of-range slope output remains finite");
  check(actual == expected, "out-of-range slope clamps to the two-stage capacity");
}

} // namespace

int main() {
  testChannelGrowth();
  testChannelShrinkAndRegrowth();
  testSameCountTopologyReset();
  testOutOfRangeSlopeClampsToStageCapacity();
  return failures == 0 ? 0 : 1;
}
