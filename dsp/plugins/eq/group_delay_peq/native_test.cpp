#include "effetune/kernel.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_GroupDelayPEQPlugin() noexcept;

namespace {

constexpr std::uint32_t kHeaderBytes = 32u;
constexpr std::uint32_t kMagic = 0x31415445u;
constexpr std::uint32_t kMono = 1u;
constexpr std::uint32_t kReplacementDryReady = 1u << 16u;
constexpr float kLatencyMode0 = 0.0F;
constexpr float kLatencyMode128 = 1.0F;
constexpr float kReplacementDryLatencyMode = -1.0F;

int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (condition)
    return;
  std::fprintf(stderr, "group_delay_peq/native_test.cpp:%d: check failed: %s\n", line, expression);
  ++failures;
}

#define GROUP_DELAY_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

void writeU32(std::uint8_t *bytes, std::uint32_t value) noexcept {
  bytes[0] = static_cast<std::uint8_t>(value);
  bytes[1] = static_cast<std::uint8_t>(value >> 8u);
  bytes[2] = static_cast<std::uint8_t>(value >> 16u);
  bytes[3] = static_cast<std::uint8_t>(value >> 24u);
}

std::vector<std::uint8_t> makePayload(std::uint32_t frames, std::uint32_t tap = 0u,
                                      float gain = 1.0F, std::uint32_t sampleRate = 48000u,
                                      std::uint32_t channels = 1u, std::uint32_t topology = kMono) {
  std::vector<std::uint8_t> payload(kHeaderBytes + static_cast<std::size_t>(frames) * sizeof(float),
                                    0u);
  writeU32(payload.data(), kMagic);
  writeU32(payload.data() + 4u, channels);
  writeU32(payload.data() + 8u, frames);
  writeU32(payload.data() + 12u, sampleRate);
  writeU32(payload.data() + 16u, topology);
  const std::size_t offset = kHeaderBytes + static_cast<std::size_t>(tap) * sizeof(float);
  std::memcpy(payload.data() + offset, &gain, sizeof(gain));
  return payload;
}

struct Harness final {
  alignas(std::max_align_t) std::array<std::byte, 16384> storage{};
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_GroupDelayPEQPlugin();
  effetune::PluginKernel *kernel = nullptr;

  Harness() {
    GROUP_DELAY_CHECK(descriptor != nullptr);
    GROUP_DELAY_CHECK(descriptor != nullptr && descriptor->objectSize <= storage.size());
    if (descriptor == nullptr || descriptor->objectSize > storage.size())
      return;
    kernel = descriptor->construct(storage.data());
    GROUP_DELAY_CHECK(kernel != nullptr);
    if (kernel != nullptr) {
      kernel->prepare({48000.0F, 2u, 128u});
      GROUP_DELAY_CHECK(kernel->preparedSuccessfully());
      stage({kLatencyMode128, 0.0F});
    }
  }

  ~Harness() {
    if (kernel != nullptr)
      descriptor->destroy(kernel);
  }

  void stage(const std::array<float, 2> &parameters) noexcept {
    GROUP_DELAY_CHECK(kernel->stageParameters(parameters.data(),
                                              static_cast<std::uint32_t>(parameters.size()),
                                              descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }

  std::uint8_t *begin(const std::vector<std::uint8_t> &payload, std::uint32_t headBlock = 128u,
                      std::uint32_t channels = 1u, std::uint32_t topology = kMono,
                      std::uint32_t rateDivider = 1u) noexcept {
    const std::uint32_t frames = static_cast<std::uint32_t>(
        (payload.size() - kHeaderBytes) / sizeof(float) / (channels == 0u ? 1u : channels));
    const std::uint32_t byteSize = static_cast<std::uint32_t>(payload.size());
    const effetune::AssetBeginInfo info{
        channels, frames, topology, headBlock,           rateDivider,
        0u,       0u,     2u,       16u * 1024u * 1024u, byteSize};
    return kernel->beginAsset(0u, info);
  }

  bool commit(const std::vector<std::uint8_t> &payload, std::uint32_t headBlock = 128u) noexcept {
    std::uint8_t *staging = begin(payload, headBlock);
    if (staging == nullptr)
      return false;
    std::memcpy(staging, payload.data(), payload.size());
    return kernel->commitAsset(0u, static_cast<std::uint32_t>(payload.size()),
                               ET_ASSET_F32_MULTICH) == ET_OK;
  }

  void prepareToActive() noexcept {
    std::array<float, 256> silence{};
    for (std::uint32_t count = 0u;
         (kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING && count < 100u; ++count) {
      kernel->process(silence.data(), 2u, 128u, {0.0});
    }
    GROUP_DELAY_CHECK((kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  }
};

// Without a resident filter the kernel passes audio through and reports no latency.
void testBypassAndLatency() {
  Harness harness;
  std::array<float, 16> audio{};
  audio[0] = 1.0F;
  audio[8] = -0.5F;
  const auto expected = audio;
  harness.kernel->process(audio.data(), 2u, 8u, {0.0});
  GROUP_DELAY_CHECK(audio == expected);
  GROUP_DELAY_CHECK(harness.kernel->latencySamples() == 0u);

  // The reported latency is the head block plus the bulk delay of the designed filter.
  harness.stage({kLatencyMode128, 128.0F});
  GROUP_DELAY_CHECK(harness.commit(makePayload(257u, 128u, 1.0F)));
  GROUP_DELAY_CHECK(harness.kernel->latencySamples() == 256u);
  harness.prepareToActive();
}

// Assets that do not match the mono single-channel contract must be rejected.
void testAssetValidation() {
  Harness harness;
  GROUP_DELAY_CHECK(harness.begin(makePayload(64u), 64u) == nullptr);
  GROUP_DELAY_CHECK(harness.begin(makePayload(64u, 0u, 1.0F, 48000u, 2u, kMono), 128u, 2u) ==
                    nullptr);
  GROUP_DELAY_CHECK(harness.begin(makePayload(64u), 128u, 1u, kMono, 2u) == nullptr);
  GROUP_DELAY_CHECK(harness.begin(makePayload(64u), 128u, 1u, 0u) == nullptr);

  // A payload whose header does not match the staged asset is rejected on commit.
  const std::vector<std::uint8_t> payload = makePayload(64u, 0u, 1.0F, 96000u);
  std::uint8_t *staging = harness.begin(payload);
  GROUP_DELAY_CHECK(staging != nullptr);
  if (staging != nullptr) {
    std::memcpy(staging, payload.data(), payload.size());
    GROUP_DELAY_CHECK(harness.kernel->commitAsset(0u, static_cast<std::uint32_t>(payload.size()),
                                                  ET_ASSET_F32_MULTICH) != ET_OK);
    GROUP_DELAY_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ERROR);
  }
}

void testZeroLatencyActivationWaitsForCompleteWetBlock() {
  Harness harness;
  harness.stage({kLatencyMode0, 0.0F});
  GROUP_DELAY_CHECK(harness.commit(makePayload(257u), 0u));
  GROUP_DELAY_CHECK(harness.kernel->latencySamples() == 0u);

  std::array<float, 256> signal{};
  signal.fill(1.0F);
  harness.kernel->process(signal.data(), 2u, 128u, {0.0});
  GROUP_DELAY_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING);

  signal.fill(1.0F);
  harness.kernel->process(signal.data(), 2u, 128u, {0.0});
  GROUP_DELAY_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
}

// The replacement handshake fades to dry and reports readiness before a new filter is staged.
void testReplacementHandshake() {
  Harness harness;
  harness.stage({kLatencyMode128, 0.0F});
  GROUP_DELAY_CHECK(harness.commit(makePayload(257u)));
  harness.prepareToActive();

  std::array<float, 256> signal{};
  for (std::uint32_t block = 0u; block < 8u; ++block)
    harness.kernel->process(signal.data(), 2u, 128u, {0.0});

  harness.stage({kReplacementDryLatencyMode, 0.0F});
  for (std::uint32_t block = 0u; block < 4u; ++block)
    harness.kernel->process(signal.data(), 2u, 128u, {0.0});
  GROUP_DELAY_CHECK((harness.kernel->assetState(0u) & kReplacementDryReady) != 0u);

  // Clearing the asset returns the kernel to the bypass state.
  harness.kernel->clearAsset(0u);
  GROUP_DELAY_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_NONE);
  GROUP_DELAY_CHECK(harness.kernel->latencySamples() == 0u);
}

} // namespace

int main() {
  testBypassAndLatency();
  testAssetValidation();
  testZeroLatencyActivationWaitsForCompleteWetBlock();
  testReplacementHandshake();
  return failures == 0 ? 0 : 1;
}
