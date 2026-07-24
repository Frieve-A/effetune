#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_RoomEqPlugin() noexcept;

namespace {

constexpr std::uint32_t kHeaderBytes = 32u;
constexpr std::uint32_t kMagic = 0x31415445u;
constexpr std::uint32_t kMono = 1u;
constexpr std::uint32_t kReplacementDryReady = 1u << 16u;
int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (condition)
    return;
  std::fprintf(stderr, "room_eq/native_test.cpp:%d: check failed: %s\n", line, expression);
  ++failures;
}

#define ROOM_EQ_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

void writeU32(std::uint8_t *bytes, std::uint32_t value) noexcept {
  bytes[0] = static_cast<std::uint8_t>(value);
  bytes[1] = static_cast<std::uint8_t>(value >> 8u);
  bytes[2] = static_cast<std::uint8_t>(value >> 16u);
  bytes[3] = static_cast<std::uint8_t>(value >> 24u);
}

std::vector<std::uint8_t> makePayload(std::uint32_t frames, std::uint32_t sampleRate,
                                      std::uint32_t tap = 0u, float gain = 1.0F) {
  std::vector<std::uint8_t> payload(kHeaderBytes + static_cast<std::size_t>(frames) * sizeof(float),
                                    0u);
  writeU32(payload.data(), kMagic);
  writeU32(payload.data() + 4u, 1u);
  writeU32(payload.data() + 8u, frames);
  writeU32(payload.data() + 12u, sampleRate);
  writeU32(payload.data() + 16u, kMono);
  const std::size_t offset = kHeaderBytes + static_cast<std::size_t>(tap) * sizeof(float);
  std::memcpy(payload.data() + offset, &gain, sizeof(gain));
  return payload;
}

std::array<float, 4> parameters(float filterDelay = 0.0F, float outputGain = 0.0F,
                                float channelDelay = 0.0F) noexcept {
  std::array<float, 4> values{};
  values[0] = 1.0F;
  values[1] = filterDelay;
  values[2] = channelDelay;
  values[3] = outputGain;
  return values;
}

struct Harness final {
  alignas(std::max_align_t) std::array<std::byte, 16384> storage{};
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_RoomEqPlugin();
  effetune::PluginKernel *kernel = nullptr;

  Harness() {
    ROOM_EQ_CHECK(descriptor != nullptr);
    ROOM_EQ_CHECK(descriptor != nullptr && descriptor->objectSize <= storage.size());
    if (descriptor == nullptr || descriptor->objectSize > storage.size())
      return;
    kernel = descriptor->construct(storage.data());
    ROOM_EQ_CHECK(kernel != nullptr);
    if (kernel != nullptr) {
      kernel->prepare({48000.0F, 2u, 128u});
      ROOM_EQ_CHECK(kernel->preparedSuccessfully());
      stage(parameters());
    }
  }

  ~Harness() {
    if (kernel != nullptr)
      descriptor->destroy(kernel);
  }

  void stage(const std::array<float, 4> &values) noexcept {
    ROOM_EQ_CHECK(kernel->stageParameters(values.data(), static_cast<std::uint32_t>(values.size()),
                                          descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }

  effetune::AssetBeginInfo assetInfo(std::uint32_t frames = 257u,
                                     std::uint32_t headBlock = 128u) const noexcept {
    return {1u, frames, kMono, headBlock,           1u,
            0u, 0u,     2u,    16u * 1024u * 1024u, kHeaderBytes + frames * sizeof(float)};
  }

  bool beginAndCommit(std::vector<std::uint8_t> payload, std::uint32_t headBlock = 128u) noexcept {
    const auto info = assetInfo(
        static_cast<std::uint32_t>((payload.size() - kHeaderBytes) / sizeof(float)), headBlock);
    std::uint8_t *staging = kernel->beginAsset(0u, info);
    if (staging == nullptr)
      return false;
    std::memcpy(staging, payload.data(), payload.size());
    return kernel->commitAsset(0u, static_cast<std::uint32_t>(payload.size()),
                               ET_ASSET_F32_MULTICH) == ET_OK;
  }

  void prepareToActive() noexcept {
    std::array<float, 256> silence{};
    for (std::uint32_t count = 0u;
         (kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING && count < 2000u; ++count) {
      kernel->process(silence.data(), 2u, 128u, {0.0});
    }
    ROOM_EQ_CHECK((kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  }
};

void testNoAssetBypassGainAndDelay() {
  Harness harness;
  std::array<float, 16> audio{};
  audio[0] = 1.0F;
  audio[8] = -0.5F;
  const auto expected = audio;
  harness.kernel->process(audio.data(), 2u, 8u, {0.0});
  ROOM_EQ_CHECK(audio == expected);
  ROOM_EQ_CHECK(harness.kernel->latencySamples() == 0u);

  harness.stage(parameters(0.0F, -6.0F, 2.0F));
  std::array<float, 512> warmup{};
  harness.kernel->process(warmup.data(), 2u, 128u, {0.0});
  harness.kernel->process(warmup.data(), 2u, 128u, {0.0});
  std::array<float, 16> delayed{};
  delayed[0] = 1.0F;
  harness.kernel->process(delayed.data(), 2u, 8u, {0.0});
  ROOM_EQ_CHECK(std::fabs(delayed[2] - std::pow(10.0F, -6.0F / 20.0F)) < 0.0001F);
}

void testLatencyPromotionAndFailedReplacement() {
  Harness harness;
  harness.stage(parameters(64.0F));
  ROOM_EQ_CHECK(harness.beginAndCommit(makePayload(257u, 48000u)));
  ROOM_EQ_CHECK(harness.kernel->latencySamples() == 192u);
  harness.prepareToActive();

  harness.stage(parameters(128.0F));
  auto payload = makePayload(257u, 48000u);
  auto info = harness.assetInfo();
  std::uint8_t *staging = harness.kernel->beginAsset(0u, info);
  ROOM_EQ_CHECK(staging != nullptr);
  ROOM_EQ_CHECK(harness.kernel->latencySamples() == 192u);
  payload[0] = 0u;
  std::memcpy(staging, payload.data(), payload.size());
  ROOM_EQ_CHECK(harness.kernel->commitAsset(0u, static_cast<std::uint32_t>(payload.size()),
                                            ET_ASSET_F32_MULTICH) == ET_ERR_ARGS);
  ROOM_EQ_CHECK(harness.kernel->latencySamples() == 192u);

  ROOM_EQ_CHECK(harness.beginAndCommit(makePayload(257u, 48000u)));
  ROOM_EQ_CHECK(harness.kernel->latencySamples() == 256u);
}

void testSharedMonoConvolutionAndDryAlignment() {
  Harness harness;
  harness.stage(parameters(64.0F));
  ROOM_EQ_CHECK(harness.beginAndCommit(makePayload(257u, 48000u, 64u, 0.5F)));
  ROOM_EQ_CHECK(harness.kernel->latencySamples() == 192u);
  harness.prepareToActive();

  std::array<float, 1024> captured{};
  std::array<float, 256> block{};
  block[0] = 1.0F;
  block[128] = 1.0F;
  for (std::uint32_t blockIndex = 0u; blockIndex < 4u; ++blockIndex) {
    harness.kernel->process(block.data(), 2u, 128u, {0.0});
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      std::memcpy(captured.data() + static_cast<std::size_t>(channel) * 512u + blockIndex * 128u,
                  block.data() + static_cast<std::size_t>(channel) * 128u, 128u * sizeof(float));
    }
    block.fill(0.0F);
  }
  ROOM_EQ_CHECK(std::fabs(captured[192] - 0.5F) < 0.0002F);
  ROOM_EQ_CHECK(std::fabs(captured[512u + 192u] - 0.5F) < 0.0002F);
}

void checkUnityBlock(const std::array<float, 256> &audio) noexcept {
  for (float sample : audio)
    ROOM_EQ_CHECK(std::fabs(sample - 1.0F) < 0.0003F);
}

void testContinuousInputDuringInitialAndReplacementPreparation() {
  struct PhaseCase {
    const char *name;
    std::uint32_t filterDelay;
  };
  constexpr PhaseCase phases[] = {
      {"minimum", 0u},
      {"linear", 64u},
      {"full", 64u},
  };
  constexpr std::uint32_t headBlocks[] = {0u, 128u};

  for (const PhaseCase &phase : phases) {
    for (const std::uint32_t headBlock : headBlocks) {
      (void)phase.name;
      Harness harness;
      harness.stage(parameters(static_cast<float>(phase.filterDelay)));
      const auto payload = makePayload(257u, 48000u, phase.filterDelay);
      ROOM_EQ_CHECK(harness.beginAndCommit(payload, headBlock));

      bool initialActive = false;
      std::array<float, 256> audio{};
      for (std::uint32_t block = 0u; block < 64u && !initialActive; ++block) {
        audio.fill(1.0F);
        harness.kernel->process(audio.data(), 2u, 128u, {0.0});
        initialActive = (harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE;
        if (initialActive)
          checkUnityBlock(audio);
      }
      ROOM_EQ_CHECK(initialActive);

      for (std::uint32_t block = 0u; block < 3u; ++block) {
        audio.fill(1.0F);
        harness.kernel->process(audio.data(), 2u, 128u, {0.0});
        checkUnityBlock(audio);
      }

      ROOM_EQ_CHECK(harness.beginAndCommit(payload, headBlock));
      bool replacementActive = false;
      for (std::uint32_t block = 0u; block < 64u && !replacementActive; ++block) {
        audio.fill(1.0F);
        harness.kernel->process(audio.data(), 2u, 128u, {0.0});
        checkUnityBlock(audio);
        replacementActive = (harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE;
      }
      ROOM_EQ_CHECK(replacementActive);
    }
  }
}

void testNonUnityReplacementUsesSharedMonoIr() {
  Harness harness;
  harness.stage(parameters());
  ROOM_EQ_CHECK(harness.beginAndCommit(makePayload(257u, 48000u, 0u, 0.5F), 0u));
  harness.prepareToActive();

  std::array<float, 256> audio{};
  for (std::uint32_t block = 0u; block < 6u; ++block) {
    audio.fill(1.0F);
    harness.kernel->process(audio.data(), 2u, 128u, {0.0});
  }
  ROOM_EQ_CHECK(std::fabs(audio[127] - 0.5F) < 0.0003F);
  ROOM_EQ_CHECK(std::fabs(audio[255] - 0.5F) < 0.0003F);

  auto dryParameters = parameters();
  dryParameters[0] = -1.0F;
  harness.stage(dryParameters);
  audio.fill(1.0F);
  harness.kernel->process(audio.data(), 2u, 128u, {0.0});
  ROOM_EQ_CHECK(audio[0] > 0.5F && audio[0] < 1.0F);
  ROOM_EQ_CHECK(std::fabs(audio[127] - 1.0F) < 0.0003F);
  ROOM_EQ_CHECK(std::fabs(audio[255] - 1.0F) < 0.0003F);
  ROOM_EQ_CHECK((harness.kernel->assetState(0u) & kReplacementDryReady) != 0u);

  harness.stage(parameters());
  ROOM_EQ_CHECK(harness.beginAndCommit(makePayload(257u, 48000u, 0u, 0.75F), 0u));
  audio.fill(1.0F);
  harness.kernel->process(audio.data(), 2u, 128u, {0.0});
  checkUnityBlock(audio);
  bool replacementActive = false;
  for (std::uint32_t block = 0u; block < 64u && !replacementActive; ++block) {
    audio.fill(1.0F);
    harness.kernel->process(audio.data(), 2u, 128u, {0.0});
    replacementActive = (harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE;
  }
  ROOM_EQ_CHECK(replacementActive);
  ROOM_EQ_CHECK(std::fabs(audio[127] - 0.75F) < 0.0003F);
  ROOM_EQ_CHECK(std::fabs(audio[255] - 0.75F) < 0.0003F);
  ROOM_EQ_CHECK((harness.kernel->assetState(0u) & kReplacementDryReady) == 0u);
}

void testFailedReplacementFallsBackToAlignedDry() {
  Harness harness;
  harness.stage(parameters());
  ROOM_EQ_CHECK(harness.beginAndCommit(makePayload(257u, 48000u, 0u, 0.5F), 0u));
  harness.prepareToActive();

  std::array<float, 256> audio{};
  for (std::uint32_t block = 0u; block < 6u; ++block) {
    audio.fill(1.0F);
    harness.kernel->process(audio.data(), 2u, 128u, {0.0});
  }
  auto dryParameters = parameters();
  dryParameters[0] = -1.0F;
  harness.stage(dryParameters);
  audio.fill(1.0F);
  harness.kernel->process(audio.data(), 2u, 128u, {0.0});
  ROOM_EQ_CHECK(std::fabs(audio[127] - 1.0F) < 0.0003F);
  ROOM_EQ_CHECK(std::fabs(audio[255] - 1.0F) < 0.0003F);
  ROOM_EQ_CHECK((harness.kernel->assetState(0u) & kReplacementDryReady) != 0u);

  harness.stage(parameters());
  auto payload = makePayload(257u, 48000u, 0u, 0.75F);
  std::uint8_t *staging = harness.kernel->beginAsset(0u, harness.assetInfo(257u, 0u));
  ROOM_EQ_CHECK(staging != nullptr);
  payload[0] = 0u;
  std::memcpy(staging, payload.data(), payload.size());
  ROOM_EQ_CHECK(harness.kernel->commitAsset(0u, static_cast<std::uint32_t>(payload.size()),
                                            ET_ASSET_F32_MULTICH) == ET_ERR_ARGS);
  audio.fill(1.0F);
  harness.kernel->process(audio.data(), 2u, 128u, {0.0});
  checkUnityBlock(audio);
}

void testRejectsAssetsBeyondMaximumTapCount() {
  Harness harness;
  constexpr std::uint32_t frames = 131073u;
  auto info = harness.assetInfo(frames);
  info.byteSize = kHeaderBytes + frames * sizeof(float);
  ROOM_EQ_CHECK(harness.kernel->beginAsset(0u, info) == nullptr);
}

} // namespace

int main() {
  testNoAssetBypassGainAndDelay();
  testLatencyPromotionAndFailedReplacement();
  testSharedMonoConvolutionAndDryAlignment();
  testContinuousInputDuringInitialAndReplacementPreparation();
  testNonUnityReplacementUsesSharedMonoIr();
  testFailedReplacementFallsBackToAlignedDry();
  testRejectsAssetsBeyondMaximumTapCount();
  return failures == 0 ? 0 : 1;
}
