#include "DSD64IMDSimulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_DSD64IMDSimulatorPlugin() noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 65u;
constexpr std::uint32_t kTelemetryBytes = 256u;
constexpr std::uint32_t kFrameBytes = 48u;
constexpr std::size_t kKernelStorageBytes = 8192u;
using Params = effetune::generated::DSD64IMDSimulatorPluginParams;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "dsd64_imd_simulator/native_test.cpp:%d: check failed: %s\n", line,
                 expression);
    ++failures;
  }
}

#define DSD_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

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
  return {24.0F, 50.0F, -30.0F, 0.0F, 1.4F, 20.0F, 150.0F, 10.5F, 25.0F, 75.0F, 0.0F, 0.0F};
}

std::vector<float> signal(std::uint32_t channels, std::uint32_t frames) {
  std::vector<float> audio(static_cast<std::size_t>(channels) * frames);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double phase = static_cast<double>(frame + channel * 7u) * 0.071;
      audio[static_cast<std::size_t>(channel) * frames + frame] =
          static_cast<float>(0.4 * std::sin(phase));
    }
  }
  return audio;
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate) : sample_rate_(sample_rate) {
    descriptor_ = et_kernel_descriptor_DSD64IMDSimulatorPlugin();
    DSD_CHECK(descriptor_ != nullptr);
    if (descriptor_ == nullptr)
      return;
    DSD_CHECK(descriptor_->paramsHash == Params::kHash);
    DSD_CHECK(descriptor_->paramsFloatCount == Params::kFloatCount);
    DSD_CHECK(descriptor_->objectSize <= object_storage_.size());
    if (descriptor_->objectSize > object_storage_.size())
      return;
    kernel_ = descriptor_->construct(object_storage_.data());
    DSD_CHECK(kernel_ != nullptr);
    ring_.adopt(ring_storage_.data(), static_cast<std::uint32_t>(ring_storage_.size()));
    if (kernel_ != nullptr) {
      kernel_->prepare({sample_rate, 2u, kMaximumFrames});
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
    DSD_CHECK(kernel_ != nullptr);
    if (kernel_ == nullptr)
      return;
    DSD_CHECK(kernel_->stageParameters(&params.amount, Params::kFloatCount, Params::kHash) ==
              ET_OK);
  }

  void process(std::vector<float> &audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    DSD_CHECK(kernel_ != nullptr);
    DSD_CHECK(audio.size() == static_cast<std::size_t>(channels) * frames);
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
    DSD_CHECK(dropped == 0u);
    return bytes;
  }

  const std::array<std::uint8_t, kTelemetryBytes> &output() const noexcept { return output_; }

  float sampleRate() const noexcept { return sample_rate_; }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> object_storage_{};
  std::array<std::uint8_t, kTelemetryBytes> ring_storage_{};
  std::array<std::uint8_t, kTelemetryBytes> output_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
  effetune::TelemetryRing ring_;
  float sample_rate_ = 0.0F;
};

void checkFrame(const KernelHarness &harness, std::uint32_t tap_id, bool valid) noexcept {
  const std::uint8_t *frame = harness.output().data();
  DSD_CHECK(readU16(frame) == 11u);
  DSD_CHECK(readU16(frame + 2u) == 1u);
  DSD_CHECK(readU32(frame + 4u) == tap_id);
  DSD_CHECK(readU32(frame + 8u) == 0u);
  DSD_CHECK(readU16(frame + 12u) == 32u);
  DSD_CHECK(readU16(frame + 14u) == 0u);
  const std::uint8_t *payload = frame + 16u;
  DSD_CHECK(readU32(payload) >= 1u);
  DSD_CHECK(readU32(payload) <= 2u);
  DSD_CHECK(readF32(payload + 4u) == harness.sampleRate());
  DSD_CHECK(readU32(payload + 8u) == (valid ? 1u : 0u));
  for (std::uint32_t offset = 12u; offset < 32u; offset += 4u) {
    DSD_CHECK(std::isfinite(readF32(payload + offset)));
  }
}

void testValidFrameAndResetDeterminism() {
  KernelHarness harness(96000.0F);
  const Params params = defaultParams();
  harness.stage(params);
  const std::vector<float> input = signal(2u, kMaximumFrames);
  std::vector<float> first = input;
  harness.process(first, 2u, kMaximumFrames);
  for (float sample : first)
    DSD_CHECK(std::isfinite(sample));
  constexpr std::uint32_t tap_id = 1101u;
  DSD_CHECK(harness.readTelemetry(tap_id) == kFrameBytes);
  checkFrame(harness, tap_id, true);

  harness.reset();
  harness.stage(params);
  std::vector<float> second = input;
  harness.process(second, 2u, kMaximumFrames);
  DSD_CHECK(first == second);
}

void testUnsupportedRatePassesThroughAndReportsInvalid() {
  KernelHarness harness(48000.0F);
  harness.stage(defaultParams());
  const std::vector<float> input = signal(2u, 31u);
  std::vector<float> output = input;
  harness.process(output, 2u, 31u);
  DSD_CHECK(output == input);
  constexpr std::uint32_t tap_id = 1102u;
  DSD_CHECK(harness.readTelemetry(tap_id) == kFrameBytes);
  checkFrame(harness, tap_id, false);
}

void testChannelChangeReinitializesFixedState() {
  const Params params = defaultParams();
  KernelHarness transitioned(96000.0F);
  transitioned.stage(params);
  std::vector<float> mono = signal(1u, 31u);
  transitioned.process(mono, 1u, 31u);
  std::vector<float> after_change = signal(2u, 31u);
  transitioned.process(after_change, 2u, 31u);

  KernelHarness fresh(96000.0F);
  fresh.stage(params);
  std::vector<float> expected = signal(2u, 31u);
  fresh.process(expected, 2u, 31u);
  DSD_CHECK(after_change == expected);
}

} // namespace

int main() {
  testValidFrameAndResetDeterminism();
  testUnsupportedRatePassesThroughAndReportsInvalid();
  testChannelChangeReinitializesFixedState();
  if (failures != 0) {
    std::fprintf(stderr, "%d DSD64 IMD native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All DSD64 IMD native tests passed");
  return 0;
}
