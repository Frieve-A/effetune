#include "effetune/kernel.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FIRCrossoverPlugin() noexcept;

namespace {

constexpr std::uint32_t kHeaderBytes = 32u;
constexpr std::uint32_t kPathBytes = 12u;
constexpr std::uint32_t kMagic = 0x31415445u;
constexpr std::uint32_t kMatrix = 4u;
constexpr std::uint32_t kReplacementDryReady = 1u << 16u;

int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (condition)
    return;
  std::fprintf(stderr, "fir_crossover/native_test.cpp:%d: check failed: %s\n", line, expression);
  ++failures;
}

#define FIR_CROSSOVER_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

void writeU32(std::uint8_t *bytes, std::uint32_t value) noexcept {
  bytes[0] = static_cast<std::uint8_t>(value);
  bytes[1] = static_cast<std::uint8_t>(value >> 8u);
  bytes[2] = static_cast<std::uint8_t>(value >> 16u);
  bytes[3] = static_cast<std::uint8_t>(value >> 24u);
}

void writeF32(std::uint8_t *bytes, float value) noexcept {
  std::memcpy(bytes, &value, sizeof(value));
}

std::vector<std::uint8_t> makePayload(std::uint32_t frames, const std::vector<float> &bandGains) {
  const std::uint32_t bands = static_cast<std::uint32_t>(bandGains.size());
  const std::uint32_t pathCount = bands * 2u;
  const std::size_t sampleOffset = kHeaderBytes + static_cast<std::size_t>(pathCount) * kPathBytes;
  std::vector<std::uint8_t> payload(
      sampleOffset + static_cast<std::size_t>(bands) * frames * sizeof(float), 0u);
  writeU32(payload.data(), kMagic);
  writeU32(payload.data() + 4u, bands);
  writeU32(payload.data() + 8u, frames);
  writeU32(payload.data() + 12u, 48000u);
  writeU32(payload.data() + 16u, kMatrix);
  writeU32(payload.data() + 20u, pathCount);
  for (std::uint32_t band = 0u; band < bands; ++band) {
    for (std::uint32_t input = 0u; input < 2u; ++input) {
      const std::size_t pathOffset =
          kHeaderBytes + static_cast<std::size_t>(band * 2u + input) * kPathBytes;
      writeU32(payload.data() + pathOffset, input);
      writeU32(payload.data() + pathOffset + 4u, band * 2u + input);
      writeU32(payload.data() + pathOffset + 8u, band);
    }
    writeF32(payload.data() + sampleOffset +
                 static_cast<std::size_t>(band) * frames * sizeof(float),
             bandGains[band]);
  }
  return payload;
}

struct Harness final {
  alignas(std::max_align_t) std::array<std::byte, 16384> storage{};
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_FIRCrossoverPlugin();
  effetune::PluginKernel *kernel = nullptr;

  Harness() {
    FIR_CROSSOVER_CHECK(descriptor != nullptr);
    FIR_CROSSOVER_CHECK(descriptor != nullptr && descriptor->objectSize <= storage.size());
    if (descriptor == nullptr || descriptor->objectSize > storage.size())
      return;
    kernel = descriptor->construct(storage.data());
    FIR_CROSSOVER_CHECK(kernel != nullptr);
    if (kernel != nullptr) {
      kernel->prepare({48000.0F, 8u, 128u});
      FIR_CROSSOVER_CHECK(kernel->preparedSuccessfully());
      stage({0.0F, 0.0F, 2.0F});
    }
  }

  ~Harness() {
    if (kernel != nullptr)
      descriptor->destroy(kernel);
  }

  void stage(const std::array<float, 3> &parameters) noexcept {
    FIR_CROSSOVER_CHECK(kernel->stageParameters(parameters.data(),
                                                static_cast<std::uint32_t>(parameters.size()),
                                                descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }

  bool commit(std::vector<std::uint8_t> payload, std::uint32_t bands,
              std::uint32_t headBlock = 0u) noexcept {
    const std::uint32_t pathCount = bands * 2u;
    const std::uint32_t frames = static_cast<std::uint32_t>(
        (payload.size() - kHeaderBytes - static_cast<std::size_t>(pathCount) * kPathBytes) /
        (static_cast<std::size_t>(bands) * sizeof(float)));
    const effetune::AssetBeginInfo info{bands,
                                        frames,
                                        kMatrix,
                                        headBlock,
                                        1u,
                                        pathCount,
                                        2u,
                                        bands * 2u,
                                        16u * 1024u * 1024u,
                                        static_cast<std::uint32_t>(payload.size())};
    std::uint8_t *staging = kernel->beginAsset(0u, info);
    if (staging == nullptr)
      return false;
    std::memcpy(staging, payload.data(), payload.size());
    return kernel->commitAsset(0u, static_cast<std::uint32_t>(payload.size()),
                               ET_ASSET_F32_MULTICH) == ET_OK;
  }

  void prepareToActive(std::uint32_t channels) noexcept {
    std::array<float, 1024> silence{};
    for (std::uint32_t count = 0u;
         (kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING && count < 100u; ++count) {
      kernel->process(silence.data(), channels, 128u, {0.0});
    }
    FIR_CROSSOVER_CHECK((kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  }
};

bool closeTo(float actual, float expected, float tolerance = 0.0001F) noexcept {
  const float difference = actual - expected;
  return (difference < 0.0F ? -difference : difference) <= tolerance;
}

void testMatrixRouting() {
  for (std::uint32_t bands = 2u; bands <= 4u; ++bands) {
    Harness harness;
    harness.stage({0.0F, 0.0F, static_cast<float>(bands)});
    std::vector<float> gains;
    for (std::uint32_t band = 0u; band < bands; ++band)
      gains.push_back(static_cast<float>(band + 1u) / 8.0F);
    FIR_CROSSOVER_CHECK(harness.commit(makePayload(257u, gains), bands));
    FIR_CROSSOVER_CHECK(harness.kernel->latencySamples() == 0u);
    harness.prepareToActive(bands * 2u);

    std::array<float, 1024> audio{};
    audio[0] = 1.0F;
    audio[128] = -0.5F;
    harness.kernel->process(audio.data(), bands * 2u, 128u, {0.0});
    for (std::uint32_t band = 0u; band < bands; ++band) {
      FIR_CROSSOVER_CHECK(closeTo(audio[static_cast<std::size_t>(band * 2u) * 128u], gains[band]));
      FIR_CROSSOVER_CHECK(
          closeTo(audio[static_cast<std::size_t>(band * 2u + 1u) * 128u], -0.5F * gains[band]));
    }
  }
}

void testZeroLatencyActivationWaitsForCompleteWetBlock() {
  Harness harness;
  harness.stage({0.0F, 0.0F, 2.0F});
  FIR_CROSSOVER_CHECK(harness.commit(makePayload(257u, {0.25F, 0.75F}), 2u, 0u));
  FIR_CROSSOVER_CHECK(harness.kernel->latencySamples() == 0u);

  std::array<float, 512> signal{};
  signal.fill(1.0F);
  harness.kernel->process(signal.data(), 4u, 128u, {0.0});
  FIR_CROSSOVER_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING);

  signal.fill(1.0F);
  harness.kernel->process(signal.data(), 4u, 128u, {0.0});
  FIR_CROSSOVER_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
}

void testSafeReplacementMute() {
  Harness harness;
  std::array<float, 512> initial{};
  initial.fill(1.0F);
  harness.kernel->process(initial.data(), 4u, 128u, {0.0});
  for (float sample : initial)
    FIR_CROSSOVER_CHECK(sample == 0.0F);

  harness.stage({128.0F, 64.0F, 2.0F});
  FIR_CROSSOVER_CHECK(harness.commit(makePayload(257u, {0.25F, 0.75F}), 2u, 128u));
  FIR_CROSSOVER_CHECK(harness.kernel->latencySamples() == 192u);
  harness.prepareToActive(4u);

  harness.stage({-1.0F, 64.0F, 2.0F});
  std::array<float, 512> signal{};
  signal.fill(1.0F);
  harness.kernel->process(signal.data(), 4u, 128u, {0.0});
  FIR_CROSSOVER_CHECK((harness.kernel->assetState(0u) & kReplacementDryReady) != 0u);
  signal.fill(1.0F);
  harness.kernel->process(signal.data(), 4u, 128u, {0.0});
  for (float sample : signal)
    FIR_CROSSOVER_CHECK(sample == 0.0F);

  FIR_CROSSOVER_CHECK(harness.commit(makePayload(257u, {0.125F, 0.875F}), 2u, 128u));
  harness.stage({128.0F, 64.0F, 2.0F});
  signal.fill(1.0F);
  harness.kernel->process(signal.data(), 4u, 128u, {0.0});
  for (float sample : signal)
    FIR_CROSSOVER_CHECK(sample == 0.0F);
  harness.prepareToActive(4u);
}

void testMalformedMatrixIsRejected() {
  Harness harness;
  std::vector<std::uint8_t> payload = makePayload(257u, {0.25F, 0.75F});
  writeU32(payload.data() + kHeaderBytes + 4u, 3u);
  const std::uint32_t bytes = static_cast<std::uint32_t>(payload.size());
  const effetune::AssetBeginInfo info{2u,   257u, kMatrix, 0u, 1u, 4u, 2u, 4u, 16u * 1024u * 1024u,
                                      bytes};
  std::uint8_t *staging = harness.kernel->beginAsset(0u, info);
  FIR_CROSSOVER_CHECK(staging != nullptr);
  if (staging == nullptr)
    return;
  std::memcpy(staging, payload.data(), payload.size());
  FIR_CROSSOVER_CHECK(harness.kernel->commitAsset(0u, bytes, ET_ASSET_F32_MULTICH) == ET_ERR_ARGS);
  FIR_CROSSOVER_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ERROR);
}

} // namespace

int main() {
  testMatrixRouting();
  testZeroLatencyActivationWaitsForCompleteWetBlock();
  testSafeReplacementMute();
  testMalformedMatrixIsRejected();
  return failures == 0 ? 0 : 1;
}
