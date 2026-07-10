#include "FiveBandDynamicEQParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <numbers>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FiveBandDynamicEQ() noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::uint32_t kMaximumChannels = 4u;
constexpr std::uint32_t kTelemetryBytes = 256u;
constexpr std::uint32_t kFrameBytes = 40u;
constexpr std::size_t kKernelStorageBytes = 8192u;
using Params = effetune::generated::FiveBandDynamicEQParams;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "five_band_dynamic_eq/native_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define DYNAMIC_EQ_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

std::uint16_t readU16(const std::uint8_t *input) noexcept {
  return static_cast<std::uint16_t>(input[0]) |
         static_cast<std::uint16_t>(static_cast<std::uint16_t>(input[1]) << 8u);
}

std::uint32_t readU32(const std::uint8_t *input) noexcept {
  return static_cast<std::uint32_t>(input[0]) | (static_cast<std::uint32_t>(input[1]) << 8u) |
         (static_cast<std::uint32_t>(input[2]) << 16u) |
         (static_cast<std::uint32_t>(input[3]) << 24u);
}

float readF32(const std::uint8_t *input) noexcept {
  const std::uint32_t bits = readU32(input);
  float value = 0.0F;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

Params defaultParams() noexcept {
  Params params{};
  constexpr std::array<float, 5u> frequencies = {100.0F, 300.0F, 1000.0F, 3000.0F, 10000.0F};
  constexpr std::array<float, 5u> thresholds = {-18.0F, -21.0F, -24.0F, -27.0F, -30.0F};
  for (std::uint32_t band = 0u; band < 5u; ++band) {
    params.enabled[band] = band == 2u ? 1.0F : 0.0F;
    params.filterType[band] = 0.0F;
    params.frequency[band] = frequencies[band];
    params.q[band] = 1.0F;
    params.maxGain[band] = 6.0F;
    params.threshold[band] = thresholds[band];
    params.ratio[band] = 2.0F;
    params.knee[band] = 3.0F;
    params.attack[band] = 10.0F;
    params.release[band] = 100.0F;
    params.sidechainFrequency[band] = frequencies[band];
    params.sidechainQ[band] = 1.0F;
  }
  return params;
}

std::vector<float> signal(std::uint32_t channels, std::uint32_t frames, std::uint32_t phase) {
  std::vector<float> audio(static_cast<std::size_t>(channels) * frames);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double position = static_cast<double>(frame + phase + channel * 13u);
      audio[static_cast<std::size_t>(channel) * frames + frame] =
          static_cast<float>(0.45 * std::sin(position * 0.071) + 0.15 * std::cos(position * 0.037));
    }
  }
  return audio;
}

std::vector<float> sineBlock(std::uint32_t start_frame, std::uint32_t frames = kMaximumFrames) {
  std::vector<float> audio(frames);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double phase = 2.0 * std::numbers::pi_v<double> * 1000.0 *
                         static_cast<double>(start_frame + frame) / 48000.0;
    audio[frame] = static_cast<float>(0.5 * std::sin(phase));
  }
  return audio;
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 48000.0F) {
    descriptor_ = et_kernel_descriptor_FiveBandDynamicEQ();
    DYNAMIC_EQ_CHECK(descriptor_ != nullptr);
    if (descriptor_ == nullptr)
      return;
    DYNAMIC_EQ_CHECK(descriptor_->paramsHash == Params::kHash);
    DYNAMIC_EQ_CHECK(descriptor_->paramsFloatCount == Params::kFloatCount);
    DYNAMIC_EQ_CHECK(descriptor_->objectSize <= object_storage_.size());
    if (descriptor_->objectSize > object_storage_.size())
      return;
    kernel_ = descriptor_->construct(object_storage_.data());
    DYNAMIC_EQ_CHECK(kernel_ != nullptr);
    ring_.adopt(ring_storage_.data(), static_cast<std::uint32_t>(ring_storage_.size()));
    if (kernel_ != nullptr) {
      kernel_->prepare({sample_rate, kMaximumChannels, kMaximumFrames});
      kernel_->reset();
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr)
      descriptor_->destroy(kernel_);
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  void stage(const Params &params) noexcept {
    DYNAMIC_EQ_CHECK(kernel_ != nullptr);
    if (kernel_ == nullptr)
      return;
    DYNAMIC_EQ_CHECK(kernel_->stageParameters(params.enabled, Params::kFloatCount, Params::kHash) ==
                     ET_OK);
  }

  void process(std::vector<float> &audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    DYNAMIC_EQ_CHECK(kernel_ != nullptr);
    DYNAMIC_EQ_CHECK(audio.size() == static_cast<std::size_t>(channels) * frames);
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

  std::uint32_t readTelemetry(std::uint32_t tap_id) noexcept {
    std::uint32_t sequence = 0u;
    effetune::TelemetryWriter writer(ring_, tap_id, sequence);
    kernel_->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring_.read(output_.data(), static_cast<std::uint32_t>(output_.size()), &dropped);
    DYNAMIC_EQ_CHECK(dropped == 0u);
    return bytes;
  }

  const std::array<std::uint8_t, kTelemetryBytes> &output() const noexcept { return output_; }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> object_storage_{};
  std::array<std::uint8_t, kTelemetryBytes> ring_storage_{};
  std::array<std::uint8_t, kTelemetryBytes> output_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
  effetune::TelemetryRing ring_;
};

void testFrameAndReset() {
  KernelHarness harness;
  harness.stage(defaultParams());
  std::vector<float> audio = signal(2u, kMaximumFrames, 0u);
  harness.process(audio, 2u, kMaximumFrames);
  for (float sample : audio)
    DYNAMIC_EQ_CHECK(std::isfinite(sample));
  constexpr std::uint32_t tap_id = 1401u;
  DYNAMIC_EQ_CHECK(harness.readTelemetry(tap_id) == kFrameBytes);
  const std::uint8_t *frame = harness.output().data();
  DYNAMIC_EQ_CHECK(readU16(frame) == 14u);
  DYNAMIC_EQ_CHECK(readU16(frame + 2u) == 1u);
  DYNAMIC_EQ_CHECK(readU32(frame + 4u) == tap_id);
  DYNAMIC_EQ_CHECK(readU32(frame + 8u) == 0u);
  DYNAMIC_EQ_CHECK(readU16(frame + 12u) == 24u);
  DYNAMIC_EQ_CHECK(readU16(frame + 14u) == 0u);
  const std::uint8_t *payload = frame + 16u;
  DYNAMIC_EQ_CHECK(payload[0] == 5u);
  DYNAMIC_EQ_CHECK(payload[1] == 0u);
  DYNAMIC_EQ_CHECK(readU16(payload + 2u) == 0u);
  for (std::uint32_t band = 0u; band < 5u; ++band) {
    const float gain = readF32(payload + 4u + band * 4u);
    DYNAMIC_EQ_CHECK(std::isfinite(gain));
    DYNAMIC_EQ_CHECK(gain >= -24.0F && gain <= 24.0F);
  }

  harness.reset();
  DYNAMIC_EQ_CHECK(harness.readTelemetry(tap_id) == 0u);
}

void testChannelChangeFullyResetsState() {
  const Params params = defaultParams();
  KernelHarness transitioned;
  transitioned.stage(params);
  std::vector<float> prefix = signal(1u, 61u, 0u);
  transitioned.process(prefix, 1u, 61u);
  std::vector<float> actual = signal(2u, 79u, 101u);
  transitioned.process(actual, 2u, 79u);

  KernelHarness fresh;
  fresh.stage(params);
  std::vector<float> expected = signal(2u, 79u, 101u);
  fresh.process(expected, 2u, 79u);
  DYNAMIC_EQ_CHECK(actual == expected);
}

void testDisabledBandFreezesAllState() {
  const Params enabled = defaultParams();
  Params disabled = enabled;
  disabled.enabled[2] = 0.0F;

  KernelHarness with_disabled_call;
  with_disabled_call.stage(enabled);
  std::vector<float> prefix_a = signal(2u, 73u, 0u);
  with_disabled_call.process(prefix_a, 2u, 73u);
  with_disabled_call.stage(disabled);
  std::vector<float> gap = signal(2u, 97u, 73u);
  const std::vector<float> gap_input = gap;
  with_disabled_call.process(gap, 2u, 97u);
  DYNAMIC_EQ_CHECK(gap == gap_input);
  with_disabled_call.stage(enabled);
  std::vector<float> actual = signal(2u, 83u, 170u);
  with_disabled_call.process(actual, 2u, 83u);

  KernelHarness without_disabled_call;
  without_disabled_call.stage(enabled);
  std::vector<float> prefix_b = signal(2u, 73u, 0u);
  without_disabled_call.process(prefix_b, 2u, 73u);
  without_disabled_call.stage(enabled);
  std::vector<float> expected = signal(2u, 83u, 170u);
  without_disabled_call.process(expected, 2u, 83u);
  DYNAMIC_EQ_CHECK(prefix_a == prefix_b);
  DYNAMIC_EQ_CHECK(actual == expected);
}

void testCoefficientHoldQuirkAndStatePreservation() {
  Params original = defaultParams();
  for (float &enabled : original.enabled)
    enabled = 0.0F;
  original.enabled[0] = 1.0F;
  original.frequency[0] = 200.0F;
  original.maxGain[0] = 12.0F;
  original.threshold[0] = -60.0F;
  original.ratio[0] = 8.0F;
  original.knee[0] = 0.0F;
  original.attack[0] = 0.1F;
  original.release[0] = 1.0F;
  original.sidechainFrequency[0] = 1000.0F;

  KernelHarness changed;
  KernelHarness control;
  changed.stage(original);
  control.stage(original);
  std::uint32_t frame_position = 0u;
  for (std::uint32_t block = 0u; block < 100u; ++block) {
    std::vector<float> changed_block = sineBlock(frame_position);
    std::vector<float> control_block = changed_block;
    changed.process(changed_block, 1u, kMaximumFrames);
    control.process(control_block, 1u, kMaximumFrames);
    DYNAMIC_EQ_CHECK(changed_block == control_block);
    frame_position += kMaximumFrames;
  }

  Params held = original;
  held.filterType[0] = 2.0F;
  held.frequency[0] = 8000.0F;
  held.q[0] = 7.0F;
  changed.stage(held);
  control.stage(original);
  std::vector<float> held_output = sineBlock(frame_position);
  std::vector<float> original_output = held_output;
  changed.process(held_output, 1u, kMaximumFrames);
  control.process(original_output, 1u, kMaximumFrames);
  DYNAMIC_EQ_CHECK(held_output == original_output);
  frame_position += kMaximumFrames;

  held.threshold[0] = -1.0F;
  Params original_with_new_threshold = original;
  original_with_new_threshold.threshold[0] = -1.0F;
  changed.stage(held);
  control.stage(original_with_new_threshold);
  bool outputs_differ = false;
  for (std::uint32_t block = 0u; block < 10u; ++block) {
    std::vector<float> changed_block = sineBlock(frame_position);
    std::vector<float> control_block = changed_block;
    changed.process(changed_block, 1u, kMaximumFrames);
    control.process(control_block, 1u, kMaximumFrames);
    if (changed_block != control_block)
      outputs_differ = true;
    frame_position += kMaximumFrames;
  }
  DYNAMIC_EQ_CHECK(outputs_differ);
}

} // namespace

int main() {
  testFrameAndReset();
  testChannelChangeFullyResetsState();
  testDisabledBandFreezesAllState();
  testCoefficientHoldQuirkAndStatePreservation();
  if (failures != 0) {
    std::fprintf(stderr, "%d FiveBandDynamicEQ native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All FiveBandDynamicEQ native tests passed");
  return 0;
}
