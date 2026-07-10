#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_DattorroPlateReverbPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FDNReverbPlugin() noexcept;
extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_RSReverbPlugin() noexcept;

namespace {

constexpr std::uint32_t kFrames = 4096u;
constexpr std::uint32_t kMaxChannels = 8u;
constexpr std::uint32_t kStorageBytes = 16384u;
constexpr std::uint32_t kMaxParamCount = 13u;
constexpr std::uint32_t kSeedLow = 0x89abcdefu;
constexpr std::uint32_t kSeedHigh = 0x01234567u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (!condition) {
    std::fprintf(stderr, "reverb/reverb_native_test.cpp:%d: check failed: %s\n", line, expression);
    ++failures;
  }
}

#define REVERB_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

using AudioBuffer = std::vector<float>;
using ParamBuffer = std::array<float, kMaxParamCount>;

ParamBuffer dattorroParams(float decay = 0.5F) noexcept {
  return {0.0F, 0.9995F, 0.75F, 0.625F, decay, 0.7F, 0.0005F, 1.0F, 1.0F, 100.0F, 0.0F, 0.0F, 0.0F};
}

ParamBuffer fdnParams(float density = 8.0F) noexcept {
  return {1.2F, density, 0.0F, 10.0F, 5.0F, 6.0F, 100.0F, 3.0F, 0.3F, 100.0F, 100.0F, 0.0F, 100.0F};
}

ParamBuffer rsParams(float room_size = 2.0F, float pre_delay = 10.0F) noexcept {
  return {pre_delay, room_size, 2.4F, 8.0F, 0.7F, 80.0F, 2000.0F,
          200.0F,    100.0F,    0.0F, 0.0F, 0.0F, 0.0F};
}

AudioBuffer signal(std::uint32_t channel_count, std::uint32_t frame_count,
                   float scale = 1.0F) noexcept {
  AudioBuffer result(static_cast<std::size_t>(kFrames) * kMaxChannels, 0.0F);
  for (std::uint32_t channel = 0u; channel < channel_count; ++channel) {
    for (std::uint32_t frame = 0u; frame < frame_count; ++frame) {
      const int phase = static_cast<int>((frame * 17u + channel * 11u) % 43u) - 21;
      result[static_cast<std::size_t>(channel) * frame_count + frame] =
          static_cast<float>(phase) * 0.0175F * scale;
    }
  }
  return result;
}

bool equal(const AudioBuffer &left, const AudioBuffer &right, std::uint32_t sample_count) noexcept {
  for (std::uint32_t index = 0u; index < sample_count; ++index) {
    if (left[index] != right[index])
      return false;
  }
  return true;
}

std::uint64_t advanceSeed(std::uint64_t seed, std::uint32_t draws) noexcept {
  std::uint64_t state = seed;
  for (std::uint32_t draw = 0u; draw < draws; ++draw) {
    state ^= state << 13u;
    state ^= state >> 7u;
    state ^= state << 17u;
  }
  return state;
}

struct KernelHarness final {
  alignas(std::max_align_t) std::array<std::byte, kStorageBytes> storage{};
  const effetune::KernelDescriptor *descriptor = nullptr;
  effetune::PluginKernel *kernel = nullptr;

  KernelHarness(const effetune::KernelDescriptor *source, float sample_rate = 48000.0F,
                std::uint32_t max_channels = kMaxChannels, std::uint32_t max_frames = kFrames)
      : descriptor(source) {
    REVERB_CHECK(descriptor != nullptr);
    REVERB_CHECK(descriptor != nullptr && descriptor->objectSize <= storage.size());
    if (descriptor == nullptr || descriptor->objectSize > storage.size())
      return;
    kernel = descriptor->construct(storage.data());
    REVERB_CHECK(kernel != nullptr);
    if (kernel != nullptr) {
      kernel->prepare({sample_rate, max_channels, max_frames});
      kernel->setRandomSeed(kSeedLow, kSeedHigh);
    }
  }

  ~KernelHarness() {
    if (kernel != nullptr)
      descriptor->destroy(kernel);
  }

  void stage(const ParamBuffer &params, std::uint32_t count) noexcept {
    REVERB_CHECK(kernel != nullptr);
    if (kernel == nullptr)
      return;
    REVERB_CHECK(kernel->stageParameters(params.data(), count, descriptor->paramsHash) == ET_OK);
  }

  void reprepare(float sample_rate, std::uint32_t max_channels = kMaxChannels,
                 std::uint32_t max_frames = kFrames) noexcept {
    REVERB_CHECK(kernel != nullptr);
    if (kernel != nullptr) {
      kernel->prepare({sample_rate, max_channels, max_frames});
    }
  }

  void seed(std::uint64_t value) noexcept {
    REVERB_CHECK(kernel != nullptr);
    if (kernel != nullptr) {
      kernel->setRandomSeed(static_cast<std::uint32_t>(value),
                            static_cast<std::uint32_t>(value >> 32u));
    }
  }

  void process(AudioBuffer &audio, std::uint32_t channel_count,
               std::uint32_t frame_count) noexcept {
    if (kernel == nullptr)
      return;
    kernel->applyPendingParameters();
    effetune::allocation_guard::Scope allocation_scope;
    kernel->process(audio.data(), channel_count, frame_count, {0.0});
  }
};

void testDescriptors() noexcept {
  const effetune::KernelDescriptor *dattorro = et_kernel_descriptor_DattorroPlateReverbPlugin();
  const effetune::KernelDescriptor *fdn = et_kernel_descriptor_FDNReverbPlugin();
  const effetune::KernelDescriptor *rs = et_kernel_descriptor_RSReverbPlugin();
  REVERB_CHECK(dattorro != nullptr && dattorro->paramsHash == 0x22bc806fu);
  REVERB_CHECK(fdn != nullptr && fdn->paramsHash == 0x68a00ea5u);
  REVERB_CHECK(rs != nullptr && rs->paramsHash == 0xc3be374cu);
  REVERB_CHECK(dattorro != nullptr && dattorro->paramsFloatCount == 11u);
  REVERB_CHECK(fdn != nullptr && fdn->paramsFloatCount == 13u);
  REVERB_CHECK(rs != nullptr && rs->paramsFloatCount == 9u);
  REVERB_CHECK(dattorro != nullptr && dattorro->paramsByteCapacity == 0u);
  REVERB_CHECK(fdn != nullptr && fdn->paramsByteCapacity == 0u);
  REVERB_CHECK(rs != nullptr && rs->paramsByteCapacity == 0u);
  REVERB_CHECK(dattorro != nullptr && dattorro->objectSize <= 8192u);
  REVERB_CHECK(fdn != nullptr && fdn->objectSize <= 8192u);
  REVERB_CHECK(rs != nullptr && rs->objectSize <= 8192u);

  KernelHarness dattorro_harness(dattorro);
  KernelHarness fdn_harness(fdn);
  KernelHarness rs_harness(rs);
  REVERB_CHECK(dattorro_harness.kernel != nullptr &&
               dattorro_harness.kernel->latencySamples() == 0u);
  REVERB_CHECK(fdn_harness.kernel != nullptr && fdn_harness.kernel->latencySamples() == 0u);
  REVERB_CHECK(rs_harness.kernel != nullptr && rs_harness.kernel->latencySamples() == 0u);
}

void testExplicitReset(const effetune::KernelDescriptor *descriptor, const ParamBuffer &params,
                       std::uint32_t param_count) noexcept {
  KernelHarness harness(descriptor);
  harness.stage(params, param_count);
  AudioBuffer first = signal(1u, kFrames);
  harness.process(first, 1u, kFrames);
  harness.kernel->reset();
  AudioBuffer second = signal(1u, kFrames);
  harness.process(second, 1u, kFrames);
  REVERB_CHECK(equal(first, second, kFrames));
}

void testDattorroChannelState() noexcept {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_DattorroPlateReverbPlugin();
  KernelHarness changing(descriptor);
  changing.stage(dattorroParams(), 11u);
  AudioBuffer warmup = signal(1u, kFrames, 1.25F);
  changing.process(warmup, 1u, kFrames);
  AudioBuffer continued = signal(2u, kFrames, 0.5F);
  changing.process(continued, 2u, kFrames);

  KernelHarness fresh(descriptor);
  fresh.stage(dattorroParams(), 11u);
  AudioBuffer restarted = signal(2u, kFrames, 0.5F);
  fresh.process(restarted, 2u, kFrames);
  REVERB_CHECK(!equal(continued, restarted, kFrames * 2u));
}

void testFdnChannelState() noexcept {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_FDNReverbPlugin();
  KernelHarness changing(descriptor);
  changing.stage(fdnParams(), 13u);
  AudioBuffer warmup = signal(1u, kFrames, 1.25F);
  changing.process(warmup, 1u, kFrames);
  AudioBuffer continued = signal(2u, kFrames, 0.5F);
  changing.process(continued, 2u, kFrames);

  KernelHarness fresh(descriptor);
  fresh.stage(fdnParams(), 13u);
  AudioBuffer restarted = signal(2u, kFrames, 0.5F);
  fresh.process(restarted, 2u, kFrames);
  REVERB_CHECK(!equal(continued, restarted, kFrames * 2u));
}

void testRsChannelReset() noexcept {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_RSReverbPlugin();
  KernelHarness changing(descriptor);
  changing.stage(rsParams(), 9u);
  AudioBuffer warmup = signal(1u, kFrames, 1.25F);
  changing.process(warmup, 1u, kFrames);
  AudioBuffer reset_output = signal(2u, kFrames, 0.5F);
  changing.process(reset_output, 2u, kFrames);

  KernelHarness fresh(descriptor);
  fresh.stage(rsParams(), 9u);
  AudioBuffer expected = signal(2u, kFrames, 0.5F);
  fresh.process(expected, 2u, kFrames);
  REVERB_CHECK(equal(reset_output, expected, kFrames * 2u));
}

void testStatePreservingParameterChanges() noexcept {
  const effetune::KernelDescriptor *dattorro = et_kernel_descriptor_DattorroPlateReverbPlugin();
  KernelHarness dattorro_warmed(dattorro);
  dattorro_warmed.stage(dattorroParams(), 11u);
  AudioBuffer dattorro_warmup = signal(1u, kFrames);
  dattorro_warmed.process(dattorro_warmup, 1u, kFrames);
  dattorro_warmed.stage(dattorroParams(0.9F), 11u);
  AudioBuffer dattorro_continued = signal(1u, kFrames, 0.25F);
  dattorro_warmed.process(dattorro_continued, 1u, kFrames);
  KernelHarness dattorro_fresh(dattorro);
  dattorro_fresh.stage(dattorroParams(0.9F), 11u);
  AudioBuffer dattorro_restarted = signal(1u, kFrames, 0.25F);
  dattorro_fresh.process(dattorro_restarted, 1u, kFrames);
  REVERB_CHECK(!equal(dattorro_continued, dattorro_restarted, kFrames));

  const effetune::KernelDescriptor *fdn = et_kernel_descriptor_FDNReverbPlugin();
  KernelHarness fdn_warmed(fdn);
  fdn_warmed.stage(fdnParams(), 13u);
  AudioBuffer fdn_warmup = signal(1u, kFrames);
  fdn_warmed.process(fdn_warmup, 1u, kFrames);
  fdn_warmed.stage(fdnParams(4.0F), 13u);
  AudioBuffer fdn_continued = signal(1u, kFrames, 0.25F);
  fdn_warmed.process(fdn_continued, 1u, kFrames);
  KernelHarness fdn_fresh(fdn);
  fdn_fresh.stage(fdnParams(4.0F), 13u);
  AudioBuffer fdn_restarted = signal(1u, kFrames, 0.25F);
  fdn_fresh.process(fdn_restarted, 1u, kFrames);
  REVERB_CHECK(!equal(fdn_continued, fdn_restarted, kFrames));
}

void testRsRoomResetAndPredelay() noexcept {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_RSReverbPlugin();
  KernelHarness changing(descriptor);
  changing.stage(rsParams(2.0F), 9u);
  AudioBuffer warmup = signal(1u, kFrames, 1.25F);
  changing.process(warmup, 1u, kFrames);
  changing.stage(rsParams(5.0F), 9u);
  AudioBuffer changed = signal(1u, kFrames, 0.5F);
  changing.process(changed, 1u, kFrames);

  KernelHarness advanced(descriptor);
  advanced.stage(rsParams(2.0F), 9u);
  AudioBuffer advance = signal(1u, 1u, 1.25F);
  advanced.process(advance, 1u, 1u);
  advanced.stage(rsParams(5.0F), 9u);
  AudioBuffer expected = signal(1u, kFrames, 0.5F);
  advanced.process(expected, 1u, kFrames);
  REVERB_CHECK(equal(changed, expected, kFrames));

  KernelHarness zero_pre_delay(descriptor);
  zero_pre_delay.stage(rsParams(2.0F, 0.0F), 9u);
  AudioBuffer zero_output = signal(1u, kFrames);
  zero_pre_delay.process(zero_output, 1u, kFrames);
  KernelHarness max_pre_delay(descriptor);
  max_pre_delay.stage(rsParams(2.0F, 50.0F), 9u);
  AudioBuffer max_output = signal(1u, kFrames);
  max_pre_delay.process(max_output, 1u, kFrames);
  REVERB_CHECK(equal(zero_output, max_output, kFrames));
}

void testFdnSampleRateRngTransition() noexcept {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_FDNReverbPlugin();
  KernelHarness transition(descriptor);
  transition.stage(fdnParams(), 13u);
  AudioBuffer initialize = signal(1u, 1u);
  transition.process(initialize, 1u, 1u);
  transition.reprepare(96000.0F);
  AudioBuffer actual = signal(1u, kFrames, 0.75F);
  transition.process(actual, 1u, kFrames);

  KernelHarness reference(descriptor, 96000.0F);
  const std::uint64_t initial_seed = (static_cast<std::uint64_t>(kSeedHigh) << 32u) | kSeedLow;
  reference.seed(advanceSeed(initial_seed, 16u));
  reference.stage(fdnParams(), 13u);
  AudioBuffer expected = signal(1u, kFrames, 0.75F);
  reference.process(expected, 1u, kFrames);
  REVERB_CHECK(equal(actual, expected, kFrames));
}

void testRsSampleRateTransition() noexcept {
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_RSReverbPlugin();
  KernelHarness transition(descriptor);
  transition.stage(rsParams(2.0F), 9u);
  AudioBuffer transition_audio = signal(1u, 1u);
  transition.process(transition_audio, 1u, 1u);
  transition.stage(rsParams(5.0F), 9u);
  transition_audio = signal(1u, 1u, 0.5F);
  transition.process(transition_audio, 1u, 1u);
  transition.reprepare(96000.0F);

  KernelHarness reference(descriptor, 96000.0F);
  reference.stage(rsParams(2.0F), 9u);
  AudioBuffer reference_audio = signal(1u, 1u);
  reference.process(reference_audio, 1u, 1u);
  reference.stage(rsParams(5.0F), 9u);

  transition_audio = signal(1u, kFrames, 0.75F);
  reference_audio = signal(1u, kFrames, 0.75F);
  transition.process(transition_audio, 1u, kFrames);
  reference.process(reference_audio, 1u, kFrames);
  REVERB_CHECK(equal(transition_audio, reference_audio, kFrames));
  transition_audio = signal(1u, kFrames, 0.25F);
  reference_audio = signal(1u, kFrames, 0.25F);
  transition.process(transition_audio, 1u, kFrames);
  reference.process(reference_audio, 1u, kFrames);
  REVERB_CHECK(equal(transition_audio, reference_audio, kFrames));

  transition.stage(rsParams(7.0F), 9u);
  reference.stage(rsParams(7.0F), 9u);
  transition_audio = signal(1u, kFrames, 0.6F);
  reference_audio = signal(1u, kFrames, 0.6F);
  transition.process(transition_audio, 1u, kFrames);
  reference.process(reference_audio, 1u, kFrames);
  REVERB_CHECK(equal(transition_audio, reference_audio, kFrames));
  transition_audio = signal(1u, kFrames, 0.2F);
  reference_audio = signal(1u, kFrames, 0.2F);
  transition.process(transition_audio, 1u, kFrames);
  reference.process(reference_audio, 1u, kFrames);
  REVERB_CHECK(equal(transition_audio, reference_audio, kFrames));
}

void testHighRateCapacity() noexcept {
  constexpr std::uint64_t kRsPayloadBudget = 9u * 1024u * 1024u;
  constexpr std::uint64_t kSampleRate = 192000u;
  constexpr std::uint64_t kChannels = 8u;
  constexpr std::uint64_t pre_delay_samples = kSampleRate * 50u / 1000u;
  constexpr std::uint64_t allpass_samples = kSampleRate * 5u / 1000u;
  constexpr std::uint64_t comb_samples_per_channel = kSampleRate * 548u / 400u;
  constexpr std::uint64_t rs_buffer_bytes =
      (kChannels * pre_delay_samples + kChannels * comb_samples_per_channel +
       kChannels * 2u * allpass_samples) *
      sizeof(float);
  REVERB_CHECK(rs_buffer_bytes == 8785920u);
  REVERB_CHECK(rs_buffer_bytes < kRsPayloadBudget);

  AudioBuffer audio = signal(8u, 128u);
  {
    KernelHarness harness(et_kernel_descriptor_DattorroPlateReverbPlugin(), 192000.0F, 8u, 128u);
    harness.stage(dattorroParams(), 11u);
    harness.process(audio, 8u, 128u);
  }
  audio = signal(8u, 128u);
  {
    KernelHarness harness(et_kernel_descriptor_FDNReverbPlugin(), 192000.0F, 8u, 128u);
    harness.stage(fdnParams(), 13u);
    harness.process(audio, 8u, 128u);
  }
  audio = signal(8u, 128u);
  {
    KernelHarness harness(et_kernel_descriptor_RSReverbPlugin(), 192000.0F, 8u, 128u);
    harness.stage(rsParams(50.0F), 9u);
    harness.process(audio, 8u, 128u);
  }
}

} // namespace

int main() {
  const effetune::KernelDescriptor *dattorro = et_kernel_descriptor_DattorroPlateReverbPlugin();
  const effetune::KernelDescriptor *fdn = et_kernel_descriptor_FDNReverbPlugin();
  const effetune::KernelDescriptor *rs = et_kernel_descriptor_RSReverbPlugin();
  testDescriptors();
  testExplicitReset(dattorro, dattorroParams(), 11u);
  testExplicitReset(fdn, fdnParams(), 13u);
  testExplicitReset(rs, rsParams(), 9u);
  testDattorroChannelState();
  testFdnChannelState();
  testRsChannelReset();
  testStatePreservingParameterChanges();
  testRsRoomResetAndPredelay();
  testFdnSampleRateRngTransition();
  testRsSampleRateTransition();
  testHighRateCapacity();
  if (failures != 0) {
    std::fprintf(stderr, "Reverb native tests failed: %d\n", failures);
    return 1;
  }
  std::puts("Reverb native tests passed");
  return 0;
}
