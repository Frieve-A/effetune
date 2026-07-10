#include "ModalResonatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include "modal_resonator_common.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_ModalResonatorPlugin() noexcept;

namespace {

using Params = effetune::generated::ModalResonatorPluginParams;
constexpr std::uint32_t kMaximumChannels = 8u;
constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "modal_resonator/native_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define MODAL_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

Params defaultParams() noexcept {
  Params params{};
  constexpr std::array<float, 5u> frequency = {6.86F, 7.52F, 7.99F, 8.34F, 8.75F};
  constexpr std::array<float, 5u> decay = {15.0F, 12.0F, 10.0F, 8.0F, 6.0F};
  constexpr std::array<float, 5u> low_pass = {7.19F, 7.86F, 8.33F, 8.68F, 9.08F};
  constexpr std::array<float, 5u> high_pass = {5.8F, 6.48F, 6.94F, 7.29F, 7.7F};
  constexpr std::array<float, 5u> gain = {0.0F, -3.0F, -6.0F, -9.0F, -12.0F};
  for (std::uint32_t resonator = 0u; resonator < 5u; ++resonator) {
    params.resonatorEnabled[resonator] = 1.0F;
    params.frequencyLog[resonator] = frequency[resonator];
    params.decay[resonator] = decay[resonator];
    params.lowPassLog[resonator] = low_pass[resonator];
    params.highPassLog[resonator] = high_pass[resonator];
    params.gain[resonator] = gain[resonator];
  }
  params.mix = 25.0F;
  return params;
}

Params firstResonatorOnly() noexcept {
  Params params = defaultParams();
  for (std::uint32_t resonator = 1u; resonator < 5u; ++resonator) {
    params.resonatorEnabled[resonator] = 0.0F;
  }
  params.mix = 100.0F;
  return params;
}

std::vector<float> signal(std::uint32_t channels, std::uint32_t frames, std::uint32_t phase) {
  std::vector<float> audio(static_cast<std::size_t>(channels) * frames);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double position = static_cast<double>(phase + frame + channel * 17u);
      audio[static_cast<std::size_t>(channel) * frames + frame] =
          static_cast<float>(0.37 * std::sin(position * 0.071) + 0.19 * std::cos(position * 0.043));
    }
  }
  return audio;
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 48000.0F) {
    descriptor_ = et_kernel_descriptor_ModalResonatorPlugin();
    MODAL_CHECK(descriptor_ != nullptr);
    if (descriptor_ == nullptr)
      return;
    MODAL_CHECK(descriptor_->paramsHash == Params::kHash);
    MODAL_CHECK(descriptor_->paramsFloatCount == Params::kFloatCount);
    MODAL_CHECK(descriptor_->objectSize <= object_storage_.size());
    if (descriptor_->objectSize > object_storage_.size())
      return;
    kernel_ = descriptor_->construct(object_storage_.data());
    MODAL_CHECK(kernel_ != nullptr);
    prepare(sample_rate);
  }

  ~KernelHarness() {
    if (kernel_ != nullptr)
      descriptor_->destroy(kernel_);
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  void prepare(float sample_rate) {
    MODAL_CHECK(kernel_ != nullptr);
    if (kernel_ == nullptr)
      return;
    kernel_->prepare({sample_rate, kMaximumChannels, kMaximumFrames});
  }

  void stage(const Params &params) noexcept {
    MODAL_CHECK(kernel_ != nullptr);
    if (kernel_ == nullptr)
      return;
    MODAL_CHECK(kernel_->stageParameters(params.resonatorEnabled, Params::kFloatCount,
                                         Params::kHash) == ET_OK);
  }

  void process(std::vector<float> &audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    MODAL_CHECK(kernel_ != nullptr);
    MODAL_CHECK(audio.size() == static_cast<std::size_t>(channels) * frames);
    if (kernel_ == nullptr)
      return;
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->applyPendingParameters();
    kernel_->process(audio.data(), channels, frames, {0.0});
  }

  void reset() noexcept {
    if (kernel_ != nullptr)
      kernel_->reset();
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> object_storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

void testFiniteOutputAndReset() {
  const Params params = defaultParams();
  KernelHarness reset_harness;
  reset_harness.stage(params);
  std::vector<float> prefix = signal(2u, kMaximumFrames, 0u);
  reset_harness.process(prefix, 2u, kMaximumFrames);
  for (float sample : prefix)
    MODAL_CHECK(std::isfinite(sample));
  reset_harness.reset();
  reset_harness.stage(params);
  std::vector<float> actual = signal(2u, 97u, 401u);
  reset_harness.process(actual, 2u, 97u);

  KernelHarness fresh;
  fresh.stage(params);
  std::vector<float> expected = signal(2u, 97u, 401u);
  fresh.process(expected, 2u, 97u);
  MODAL_CHECK(actual == expected);
}

void testChannelCountChangeFullyResetsState() {
  const Params params = defaultParams();
  KernelHarness transitioned;
  transitioned.stage(params);
  std::vector<float> prefix = signal(1u, 113u, 0u);
  transitioned.process(prefix, 1u, 113u);
  std::vector<float> actual = signal(2u, 89u, 211u);
  transitioned.process(actual, 2u, 89u);

  KernelHarness fresh;
  fresh.stage(params);
  std::vector<float> expected = signal(2u, 89u, 211u);
  fresh.process(expected, 2u, 89u);
  MODAL_CHECK(actual == expected);
}

void testSampleRatePrepareFullyResetsState() {
  const Params params = defaultParams();
  KernelHarness transitioned;
  transitioned.stage(params);
  std::vector<float> prefix = signal(1u, 128u, 0u);
  transitioned.process(prefix, 1u, 128u);
  transitioned.prepare(44100.0F);
  transitioned.stage(params);
  std::vector<float> actual = signal(1u, 101u, 301u);
  transitioned.process(actual, 1u, 101u);

  KernelHarness fresh(44100.0F);
  fresh.stage(params);
  std::vector<float> expected = signal(1u, 101u, 301u);
  fresh.process(expected, 1u, 101u);
  MODAL_CHECK(actual == expected);
}

void testDisabledResonatorFreezesAllState() {
  const Params enabled = firstResonatorOnly();
  Params disabled = enabled;
  disabled.resonatorEnabled[0] = 0.0F;

  KernelHarness with_disabled_block;
  KernelHarness without_disabled_block;
  with_disabled_block.stage(enabled);
  without_disabled_block.stage(enabled);
  std::vector<float> prefix_a = signal(1u, 128u, 0u);
  std::vector<float> prefix_b = prefix_a;
  with_disabled_block.process(prefix_a, 1u, 128u);
  without_disabled_block.process(prefix_b, 1u, 128u);
  MODAL_CHECK(prefix_a == prefix_b);

  with_disabled_block.stage(disabled);
  std::vector<float> gap = signal(1u, 97u, 128u);
  with_disabled_block.process(gap, 1u, 97u);
  MODAL_CHECK(std::all_of(gap.begin(), gap.end(), [](float sample) { return sample == 0.0F; }));

  with_disabled_block.stage(enabled);
  std::vector<float> actual = signal(1u, 109u, 225u);
  std::vector<float> expected = actual;
  with_disabled_block.process(actual, 1u, 109u);
  without_disabled_block.process(expected, 1u, 109u);
  MODAL_CHECK(actual == expected);
}

void testParameterChangesPreserveDelayAndFilterState() {
  Params original = firstResonatorOnly();
  KernelHarness stateful;
  stateful.stage(original);
  std::vector<float> impulse(128u, 0.0F);
  impulse[0] = 1.0F;
  stateful.process(impulse, 1u, 128u);

  Params changed = original;
  changed.frequencyLog[0] = 7.43F;
  changed.decay[0] = 240.0F;
  changed.lowPassLog[0] = 9.3F;
  changed.highPassLog[0] = 4.2F;
  changed.gain[0] = 12.0F;
  stateful.stage(changed);
  std::vector<float> actual(128u, 0.0F);
  stateful.process(actual, 1u, 128u);

  KernelHarness fresh;
  fresh.stage(changed);
  std::vector<float> expected(128u, 0.0F);
  fresh.process(expected, 1u, 128u);
  MODAL_CHECK(actual != expected);
  MODAL_CHECK(
      std::any_of(actual.begin(), actual.end(), [](float sample) { return sample != 0.0F; }));
  MODAL_CHECK(
      std::all_of(expected.begin(), expected.end(), [](float sample) { return sample == 0.0F; }));
}

void testBlockSizeChangesPreserveState() {
  const Params params = firstResonatorOnly();
  std::vector<float> input = signal(1u, 128u, 0u);

  KernelHarness whole;
  whole.stage(params);
  std::vector<float> expected = input;
  whole.process(expected, 1u, 128u);

  KernelHarness split;
  split.stage(params);
  std::vector<float> first(input.begin(), input.begin() + 37);
  std::vector<float> second(input.begin() + 37, input.end());
  split.process(first, 1u, 37u);
  split.process(second, 1u, 91u);
  std::vector<float> actual;
  actual.reserve(input.size());
  actual.insert(actual.end(), first.begin(), first.end());
  actual.insert(actual.end(), second.begin(), second.end());
  MODAL_CHECK(actual == expected);
}

void testMaximumRateEightChannelCapacityAndAllocation() {
  constexpr double sample_rate = 192000.0;
  const std::uint32_t delay_length =
      effetune::plugins::resonator::modal_resonator::delayBufferLength(sample_rate);
  MODAL_CHECK(delay_length == 9560u);
  const std::uint64_t delay_bytes =
      static_cast<std::uint64_t>(delay_length) * 5u * 8u * sizeof(float);
  MODAL_CHECK(delay_bytes == 1529600u);

  KernelHarness harness(static_cast<float>(sample_rate));
  harness.stage(defaultParams());
  std::vector<float> audio = signal(8u, 128u, 0u);
  harness.process(audio, 8u, 128u);
  MODAL_CHECK(
      std::all_of(audio.begin(), audio.end(), [](float sample) { return std::isfinite(sample); }));

  Params malformed = firstResonatorOnly();
  malformed.frequencyLog[0] = -100.0F;
  harness.stage(malformed);
  std::vector<float> guarded = signal(8u, 128u, 128u);
  harness.process(guarded, 8u, 128u);
  MODAL_CHECK(std::all_of(guarded.begin(), guarded.end(),
                          [](float sample) { return std::isfinite(sample); }));
}

} // namespace

int main() {
  testFiniteOutputAndReset();
  testChannelCountChangeFullyResetsState();
  testSampleRatePrepareFullyResetsState();
  testDisabledResonatorFreezesAllState();
  testParameterChangesPreserveDelayAndFilterState();
  testBlockSizeChangesPreserveState();
  testMaximumRateEightChannelCapacityAndAllocation();
  if (failures != 0) {
    std::fprintf(stderr, "%d ModalResonator native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All ModalResonator native tests passed");
  return 0;
}
