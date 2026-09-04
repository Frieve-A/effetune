#include "CrosstalkCancellationPluginParams.h"
#include "effetune/kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_CrosstalkCancellationPlugin() noexcept;

namespace {

constexpr std::uint32_t kHeaderBytes = 32u;
constexpr std::uint32_t kMagic = 0x31415445u;
constexpr std::uint32_t kTrueStereo = 3u;
constexpr std::uint32_t kReplacementDryReady = 1u << 16u;
constexpr std::uint32_t kMaximumFrames = 128u;
using Params = effetune::generated::CrosstalkCancellationPluginParams;

int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (condition)
    return;
  std::fprintf(stderr, "crosstalk_cancellation/native_test.cpp:%d: check failed: %s\n", line,
               expression);
  ++failures;
}

#define XTC_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

void writeU32(std::uint8_t *bytes, std::uint32_t value) noexcept {
  bytes[0] = static_cast<std::uint8_t>(value);
  bytes[1] = static_cast<std::uint8_t>(value >> 8u);
  bytes[2] = static_cast<std::uint8_t>(value >> 16u);
  bytes[3] = static_cast<std::uint8_t>(value >> 24u);
}

std::uint32_t payloadByteSize(std::uint32_t frames) noexcept {
  return kHeaderBytes + 4u * frames * static_cast<std::uint32_t>(sizeof(float));
}

std::vector<std::uint8_t>
makePayload(std::uint32_t frames, std::uint32_t sampleRate, std::uint32_t tap,
            const std::array<float, 4> &gains = {1.0F, 0.0F, 0.0F, 1.0F}) {
  std::vector<std::uint8_t> payload(payloadByteSize(frames), 0u);
  writeU32(payload.data(), kMagic);
  writeU32(payload.data() + 4u, 4u);
  writeU32(payload.data() + 8u, frames);
  writeU32(payload.data() + 12u, sampleRate);
  writeU32(payload.data() + 16u, kTrueStereo);
  for (std::uint32_t channel = 0u; channel < 4u; ++channel) {
    const std::size_t offset =
        kHeaderBytes + (static_cast<std::size_t>(channel) * frames + tap) * sizeof(float);
    std::memcpy(payload.data() + offset, &gains[channel], sizeof(float));
  }
  return payload;
}

Params parameters(float latency = 128.0F, float delay = 8.0F, float strength = 100.0F,
                  float outputGain = 0.0F) noexcept {
  return {latency, delay, strength, outputGain};
}

class Harness final {
public:
  explicit Harness(float sampleRate = 48000.0F) : sample_rate_(sampleRate) {
    descriptor_ = et_kernel_descriptor_CrosstalkCancellationPlugin();
    XTC_CHECK(descriptor_ != nullptr);
    if (descriptor_ == nullptr)
      return;
    XTC_CHECK(descriptor_->objectSize <= storage_.size());
    XTC_CHECK(descriptor_->paramsHash == Params::kHash);
    XTC_CHECK(descriptor_->paramsFloatCount == Params::kFloatCount);
    if (descriptor_->objectSize > storage_.size())
      return;
    kernel_ = descriptor_->construct(storage_.data());
    XTC_CHECK(kernel_ != nullptr);
    if (kernel_ != nullptr) {
      kernel_->prepare({sampleRate, 2u, kMaximumFrames});
      XTC_CHECK(kernel_->preparedSuccessfully());
      stage(parameters());
    }
  }

  ~Harness() {
    if (kernel_ != nullptr)
      descriptor_->destroy(kernel_);
  }

  void stage(const Params &values) noexcept {
    XTC_CHECK(kernel_->stageParameters(reinterpret_cast<const float *>(&values),
                                       Params::kFloatCount, Params::kHash) == ET_OK);
    kernel_->applyPendingParameters();
  }

  effetune::AssetBeginInfo assetInfo(std::uint32_t frames, std::uint32_t headBlock = 128u) const {
    return {4u, frames, kTrueStereo, headBlock,           1u,
            0u, 0u,     2u,          16u * 1024u * 1024u, payloadByteSize(frames)};
  }

  bool beginAndCommit(const std::vector<std::uint8_t> &payload,
                      std::uint32_t headBlock = 128u) noexcept {
    const std::uint32_t frames =
        static_cast<std::uint32_t>((payload.size() - kHeaderBytes) / (4u * sizeof(float)));
    std::uint8_t *staging = kernel_->beginAsset(0u, assetInfo(frames, headBlock));
    if (staging == nullptr)
      return false;
    std::memcpy(staging, payload.data(), payload.size());
    return kernel_->commitAsset(0u, static_cast<std::uint32_t>(payload.size()),
                                ET_ASSET_F32_MULTICH) == ET_OK;
  }

  void prepareToActive() noexcept {
    std::array<float, 2u * kMaximumFrames> silence{};
    for (std::uint32_t count = 0u;
         (kernel_->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING && count < 2000u; ++count) {
      kernel_->process(silence.data(), 2u, kMaximumFrames, {0.0});
    }
    XTC_CHECK((kernel_->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  }

  void primeWetMix() noexcept {
    std::array<float, 2u * kMaximumFrames> silence{};
    kernel_->process(silence.data(), 2u, kMaximumFrames, {0.0});
  }

  std::vector<float> render(const std::vector<float> &input,
                            const std::vector<std::uint32_t> &partitions) noexcept {
    XTC_CHECK(input.size() % 2u == 0u);
    const std::uint32_t totalFrames = static_cast<std::uint32_t>(input.size() / 2u);
    std::vector<float> output(input.size(), 0.0F);
    std::uint32_t offset = 0u;
    std::size_t partition = 0u;
    while (offset < totalFrames) {
      const std::uint32_t requested = partitions[partition % partitions.size()];
      const std::uint32_t remaining = totalFrames - offset;
      const std::uint32_t frames = requested < remaining ? requested : remaining;
      std::array<float, 2u * kMaximumFrames> block{};
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        std::copy_n(input.data() + static_cast<std::size_t>(channel) * totalFrames + offset, frames,
                    block.data() + static_cast<std::size_t>(channel) * frames);
      }
      kernel_->process(block.data(), 2u, frames, {0.0});
      for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
        std::copy_n(block.data() + static_cast<std::size_t>(channel) * frames, frames,
                    output.data() + static_cast<std::size_t>(channel) * totalFrames + offset);
      }
      offset += frames;
      ++partition;
    }
    return output;
  }

  effetune::PluginKernel *kernel() const noexcept { return kernel_; }
  float sampleRate() const noexcept { return sample_rate_; }

private:
  alignas(std::max_align_t) std::array<std::byte, 16384> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
  float sample_rate_ = 48000.0F;
};

std::vector<float> stereoImpulse(std::uint32_t frames, float left = 1.0F, float right = 0.0F) {
  std::vector<float> input(static_cast<std::size_t>(frames) * 2u, 0.0F);
  input[0] = left;
  input[frames] = right;
  return input;
}

void checkNear(float actual, float expected, float tolerance = 0.0003F) noexcept {
  XTC_CHECK(std::fabs(actual - expected) <= tolerance);
}

void testNoAssetIsExactPassThrough() {
  Harness harness;
  std::array<float, 18> audio{0.2F,  -0.3F, 0.4F,  -0.5F, 0.6F,  -0.7F, 0.8F,  -0.9F, 1.0F,
                              -0.1F, 0.3F,  -0.4F, 0.5F,  -0.6F, 0.7F,  -0.8F, 0.9F,  -1.0F};
  const auto expected = audio;
  harness.stage(parameters(1024.0F, 65536.0F, 0.0F, -24.0F));
  harness.kernel()->process(audio.data(), 2u, 9u, {0.0});
  XTC_CHECK(audio == expected);
  XTC_CHECK(harness.kernel()->latencySamples() == 0u);

  std::array<float, 9> mono{0.1F, 0.2F, 0.3F, 0.4F, 0.5F, 0.6F, 0.7F, 0.8F, 0.9F};
  const auto monoExpected = mono;
  harness.kernel()->process(mono.data(), 1u, 9u, {0.0});
  XTC_CHECK(mono == monoExpected);
}

std::vector<float> renderIdentity(float strength, float outputGain = 0.0F,
                                  std::uint32_t headBlock = 128u) {
  constexpr std::uint32_t filterDelay = 8u;
  Harness harness;
  harness.stage(parameters(static_cast<float>(headBlock), static_cast<float>(filterDelay), strength,
                           outputGain));
  XTC_CHECK(harness.beginAndCommit(makePayload(33u, 48000u, filterDelay), headBlock));
  XTC_CHECK(harness.kernel()->latencySamples() == headBlock + filterDelay);
  harness.prepareToActive();
  harness.kernel()->reset();
  harness.primeWetMix();
  return harness.render(stereoImpulse(400u, 1.0F, -0.5F), {37u, 128u, 11u});
}

void testIdentityStrengthAndOutputGain() {
  const auto wet = renderIdentity(100.0F);
  const auto dry = renderIdentity(0.0F);
  const auto half = renderIdentity(50.0F);
  constexpr std::uint32_t latency = 136u;
  checkNear(wet[latency], 1.0F);
  checkNear(wet[400u + latency], -0.5F);
  XTC_CHECK(wet.size() == dry.size());
  XTC_CHECK(wet.size() == half.size());
  for (std::size_t index = 0u; index < wet.size(); ++index) {
    checkNear(wet[index], dry[index]);
    checkNear(wet[index], half[index]);
  }

  const auto attenuated = renderIdentity(100.0F, -6.0F);
  checkNear(attenuated[latency], std::pow(10.0F, -6.0F / 20.0F));
}

void testTrueStereoPathOrderAndStrength() {
  constexpr std::uint32_t filterDelay = 5u;
  const std::array<float, 4> gains{0.5F, 0.25F, -0.2F, 0.75F};

  Harness wetHarness;
  wetHarness.stage(parameters(128.0F, static_cast<float>(filterDelay), 100.0F));
  XTC_CHECK(wetHarness.beginAndCommit(makePayload(33u, 48000u, filterDelay, gains)));
  wetHarness.prepareToActive();
  wetHarness.kernel()->reset();
  wetHarness.primeWetMix();
  const auto wetLeft = wetHarness.render(stereoImpulse(400u, 1.0F, 0.0F), {128u});
  constexpr std::uint32_t latency = 128u + filterDelay;
  checkNear(wetLeft[latency], 0.5F);
  checkNear(wetLeft[400u + latency], 0.25F);

  wetHarness.kernel()->reset();
  wetHarness.primeWetMix();
  const auto wetRight = wetHarness.render(stereoImpulse(400u, 0.0F, 1.0F), {17u, 63u, 128u});
  checkNear(wetRight[latency], -0.2F);
  checkNear(wetRight[400u + latency], 0.75F);

  Harness dryHarness;
  dryHarness.stage(parameters(128.0F, static_cast<float>(filterDelay), 0.0F));
  XTC_CHECK(dryHarness.beginAndCommit(makePayload(33u, 48000u, filterDelay, gains)));
  dryHarness.prepareToActive();
  dryHarness.kernel()->reset();
  dryHarness.primeWetMix();
  const auto dry = dryHarness.render(stereoImpulse(400u, 1.0F, 0.0F), {29u, 7u, 128u});
  checkNear(dry[latency], 1.0F);
  checkNear(dry[400u + latency], 0.0F);
}

void testEveryLatencyMode() {
  constexpr std::array<std::uint32_t, 5> headBlocks{0u, 128u, 256u, 512u, 1024u};
  for (const std::uint32_t headBlock : headBlocks) {
    Harness harness;
    harness.stage(parameters(static_cast<float>(headBlock), 17.0F));
    XTC_CHECK(harness.beginAndCommit(makePayload(33u, 48000u, 17u), headBlock));
    XTC_CHECK(harness.kernel()->latencySamples() == headBlock + 17u);
  }
}

void testBlockPartitionInvariance() {
  constexpr std::uint32_t filterDelay = 9u;
  const auto payload = makePayload(65u, 48000u, filterDelay, {0.7F, 0.2F, -0.15F, 0.8F});
  auto prepare = [&](Harness &harness) {
    harness.stage(parameters(128.0F, static_cast<float>(filterDelay), 73.0F, -2.0F));
    XTC_CHECK(harness.beginAndCommit(payload));
    harness.prepareToActive();
    harness.kernel()->reset();
    harness.primeWetMix();
  };
  Harness whole;
  Harness split;
  prepare(whole);
  prepare(split);
  constexpr std::uint32_t frames = 1000u;
  std::vector<float> input(2u * frames);
  std::uint32_t state = 0x12345678u;
  for (float &sample : input) {
    state = state * 1664525u + 1013904223u;
    sample = static_cast<float>(static_cast<std::int32_t>(state)) / 2147483648.0F * 0.2F;
  }
  const auto wholeOutput = whole.render(input, {128u});
  const auto splitOutput = split.render(input, {1u, 17u, 63u, 5u, 128u, 31u});
  XTC_CHECK(wholeOutput.size() == splitOutput.size());
  for (std::size_t index = 0u; index < wholeOutput.size(); ++index)
    checkNear(wholeOutput[index], splitOutput[index], 1.0e-6F);
}

void testInvalidAssetsEnterErrorState() {
  const auto payload = makePayload(33u, 48000u, 8u);
  const auto expectRejected = [&](auto mutate) {
    Harness harness;
    auto info = harness.assetInfo(33u);
    mutate(info);
    XTC_CHECK(harness.kernel()->beginAsset(0u, info) == nullptr);
    XTC_CHECK((harness.kernel()->assetState(0u) & 0xffu) == ET_ASSET_STATE_ERROR);
  };
  expectRejected([](auto &info) { info.topology = 2u; });
  expectRejected([](auto &info) { info.channels = 2u; });
  expectRejected([](auto &info) { info.processingChannels = 1u; });
  expectRejected([](auto &info) { info.rateDivider = 2u; });
  expectRejected([](auto &info) { info.pathCount = 4u; });
  expectRejected([](auto &info) { info.inputCount = 2u; });
  expectRejected([](auto &info) { info.headBlock = 64u; });
  expectRejected([](auto &info) { info.footprintBytes = 32u * 1024u * 1024u + 1u; });
  expectRejected([](auto &info) { --info.byteSize; });

  Harness corrupt;
  auto info = corrupt.assetInfo(33u);
  std::uint8_t *staging = corrupt.kernel()->beginAsset(0u, info);
  XTC_CHECK(staging != nullptr);
  auto badPayload = payload;
  badPayload[0] = 0u;
  std::memcpy(staging, badPayload.data(), badPayload.size());
  XTC_CHECK(corrupt.kernel()->commitAsset(0u, static_cast<std::uint32_t>(badPayload.size()),
                                          ET_ASSET_F32_MULTICH) == ET_ERR_ARGS);
  XTC_CHECK((corrupt.kernel()->assetState(0u) & 0xffu) == ET_ASSET_STATE_ERROR);
  XTC_CHECK(corrupt.kernel()->latencySamples() == 0u);
}

void testClearReturnsToExactBypass() {
  Harness harness;
  harness.stage(parameters(128.0F, 8.0F));
  XTC_CHECK(harness.beginAndCommit(makePayload(33u, 48000u, 8u)));
  harness.prepareToActive();
  harness.kernel()->clearAsset(0u);
  std::array<float, 16> audio{1.0F,  0.2F,  0.3F,  0.4F,  0.5F,  0.6F,  0.7F,  0.8F,
                              -1.0F, -0.2F, -0.3F, -0.4F, -0.5F, -0.6F, -0.7F, -0.8F};
  const auto expected = audio;
  harness.kernel()->process(audio.data(), 2u, 8u, {0.0});
  XTC_CHECK(audio == expected);
  XTC_CHECK(harness.kernel()->latencySamples() == 0u);
}

void testReplacementFailureReturnsToExactBypass() {
  constexpr std::uint32_t filterDelay = 8u;
  Harness harness;
  harness.stage(parameters(128.0F, static_cast<float>(filterDelay), 100.0F, -6.0F));
  XTC_CHECK(harness.beginAndCommit(makePayload(33u, 48000u, filterDelay)));
  harness.prepareToActive();
  harness.primeWetMix();

  auto replacement = makePayload(33u, 48000u, filterDelay);
  auto info = harness.assetInfo(33u);
  std::uint8_t *staging = harness.kernel()->beginAsset(0u, info);
  XTC_CHECK(staging != nullptr);
  replacement[0] = 0u;
  std::memcpy(staging, replacement.data(), replacement.size());
  XTC_CHECK(harness.kernel()->commitAsset(0u, static_cast<std::uint32_t>(replacement.size()),
                                          ET_ASSET_F32_MULTICH) == ET_ERR_ARGS);
  XTC_CHECK((harness.kernel()->assetState(0u) & 0xffu) == ET_ASSET_STATE_ERROR);
  XTC_CHECK(harness.kernel()->latencySamples() == 0u);

  std::array<float, 18> audio{0.2F,  -0.3F, 0.4F,  -0.5F, 0.6F,  -0.7F, 0.8F,  -0.9F, 1.0F,
                              -0.1F, 0.3F,  -0.4F, 0.5F,  -0.6F, 0.7F,  -0.8F, 0.9F,  -1.0F};
  const auto expected = audio;
  harness.kernel()->process(audio.data(), 2u, 9u, {0.0});
  XTC_CHECK(audio == expected);
}

void testReplacementDryLifecycleAndContinuity() {
  constexpr std::uint32_t filterDelay = 8u;
  Harness harness;
  harness.stage(parameters(128.0F, static_cast<float>(filterDelay), 100.0F));
  XTC_CHECK(
      harness.beginAndCommit(makePayload(33u, 48000u, filterDelay, {0.6F, 0.2F, 0.1F, 0.7F})));
  harness.prepareToActive();
  harness.kernel()->reset();
  std::array<float, 2u * kMaximumFrames> ones{};
  ones.fill(1.0F);
  for (std::uint32_t block = 0u; block < 4u; ++block) {
    auto audio = ones;
    harness.kernel()->process(audio.data(), 2u, kMaximumFrames, {0.0});
  }

  harness.stage(parameters(-1.0F, static_cast<float>(filterDelay), 100.0F));
  std::array<float, 2u * kMaximumFrames> fade{};
  fade.fill(1.0F);
  harness.kernel()->process(fade.data(), 2u, 127u, {0.0});
  XTC_CHECK((harness.kernel()->assetState(0u) & kReplacementDryReady) == 0u);
  std::array<float, 2> finalFrame{1.0F, 1.0F};
  harness.kernel()->process(finalFrame.data(), 2u, 1u, {0.0});
  XTC_CHECK((harness.kernel()->assetState(0u) & kReplacementDryReady) != 0u);
  for (std::uint32_t frame = 1u; frame < 127u; ++frame) {
    XTC_CHECK(std::fabs(fade[frame] - fade[frame - 1u]) < 0.01F);
    XTC_CHECK(std::fabs(fade[127u + frame] - fade[127u + frame - 1u]) < 0.01F);
  }

  XTC_CHECK(harness.beginAndCommit(makePayload(33u, 48000u, filterDelay)));
  harness.stage(parameters(128.0F, static_cast<float>(filterDelay), 100.0F));
  XTC_CHECK((harness.kernel()->assetState(0u) & kReplacementDryReady) == 0u);
  XTC_CHECK(harness.kernel()->latencySamples() == 128u + filterDelay);

  std::array<float, 2> previous{finalFrame[0], finalFrame[1]};
  for (std::uint32_t block = 0u;
       block < 2000u && (harness.kernel()->assetState(0u) & 0xffu) != ET_ASSET_STATE_ACTIVE;
       ++block) {
    auto audio = ones;
    harness.kernel()->process(audio.data(), 2u, kMaximumFrames, {0.0});
    for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
      for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
        const float sample = audio[static_cast<std::size_t>(channel) * kMaximumFrames + frame];
        XTC_CHECK(std::fabs(sample - previous[channel]) < 0.02F);
        previous[channel] = sample;
      }
    }
  }
  XTC_CHECK((harness.kernel()->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
}

} // namespace

int main() {
  testNoAssetIsExactPassThrough();
  testIdentityStrengthAndOutputGain();
  testTrueStereoPathOrderAndStrength();
  testEveryLatencyMode();
  testBlockPartitionInvariance();
  testInvalidAssetsEnterErrorState();
  testClearReturnsToExactBypass();
  testReplacementFailureReturnsToExactBypass();
  testReplacementDryLifecycleAndContinuity();
  if (failures != 0)
    std::fprintf(stderr, "%d Crosstalk Cancellation native test(s) failed\n", failures);
  return failures == 0 ? 0 : 1;
}
