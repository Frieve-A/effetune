#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FiveBandFIRPEQPlugin() noexcept;

namespace {

constexpr std::uint32_t kHeaderBytes = 32u;
constexpr std::uint32_t kMagic = 0x31415445u;
constexpr std::uint32_t kMono = 1u;
constexpr std::uint32_t kReplacementDryReady = 1u << 16u;

int failures = 0;

void check(bool condition, const char *expression, int line) noexcept {
  if (condition)
    return;
  std::fprintf(stderr, "five_band_fir_peq/native_test.cpp:%d: check failed: %s\n", line,
               expression);
  ++failures;
}

#define FIR_PEQ_CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

void writeU32(std::uint8_t *bytes, std::uint32_t value) noexcept {
  bytes[0] = static_cast<std::uint8_t>(value);
  bytes[1] = static_cast<std::uint8_t>(value >> 8u);
  bytes[2] = static_cast<std::uint8_t>(value >> 16u);
  bytes[3] = static_cast<std::uint8_t>(value >> 24u);
}

std::vector<std::uint8_t> makePayload(std::uint32_t frames, std::uint32_t tap = 0u,
                                      float gain = 1.0F) {
  std::vector<std::uint8_t> payload(kHeaderBytes + static_cast<std::size_t>(frames) * sizeof(float),
                                    0u);
  writeU32(payload.data(), kMagic);
  writeU32(payload.data() + 4u, 1u);
  writeU32(payload.data() + 8u, frames);
  writeU32(payload.data() + 12u, 48000u);
  writeU32(payload.data() + 16u, kMono);
  const std::size_t offset = kHeaderBytes + static_cast<std::size_t>(tap) * sizeof(float);
  std::memcpy(payload.data() + offset, &gain, sizeof(gain));
  return payload;
}

struct Harness final {
  alignas(std::max_align_t) std::array<std::byte, 16384> storage{};
  const effetune::KernelDescriptor *descriptor = et_kernel_descriptor_FiveBandFIRPEQPlugin();
  effetune::PluginKernel *kernel = nullptr;

  Harness() {
    FIR_PEQ_CHECK(descriptor != nullptr);
    FIR_PEQ_CHECK(descriptor != nullptr && descriptor->objectSize <= storage.size());
    if (descriptor == nullptr || descriptor->objectSize > storage.size())
      return;
    kernel = descriptor->construct(storage.data());
    FIR_PEQ_CHECK(kernel != nullptr);
    if (kernel != nullptr) {
      kernel->prepare({48000.0F, 2u, 128u});
      FIR_PEQ_CHECK(kernel->preparedSuccessfully());
      stage({128.0F, 0.0F});
    }
  }

  ~Harness() {
    if (kernel != nullptr)
      descriptor->destroy(kernel);
  }

  void stage(const std::array<float, 2> &parameters) noexcept {
    FIR_PEQ_CHECK(kernel->stageParameters(parameters.data(),
                                          static_cast<std::uint32_t>(parameters.size()),
                                          descriptor->paramsHash) == ET_OK);
    kernel->applyPendingParameters();
  }

  bool commit(std::vector<std::uint8_t> payload, std::uint32_t headBlock = 128u) noexcept {
    const std::uint32_t frames =
        static_cast<std::uint32_t>((payload.size() - kHeaderBytes) / sizeof(float));
    const effetune::AssetBeginInfo info{
        1u, frames, kMono, headBlock,           1u,
        0u, 0u,     2u,    16u * 1024u * 1024u, static_cast<std::uint32_t>(payload.size())};
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
         (kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING && count < 100u; ++count) {
      kernel->process(silence.data(), 2u, 128u, {0.0});
    }
    FIR_PEQ_CHECK((kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
  }
};

void testBypassAndLatency() {
  Harness harness;
  std::array<float, 16> audio{};
  audio[0] = 1.0F;
  audio[8] = -0.5F;
  const auto expected = audio;
  harness.kernel->process(audio.data(), 2u, 8u, {0.0});
  FIR_PEQ_CHECK(audio == expected);
  FIR_PEQ_CHECK(harness.kernel->latencySamples() == 0u);

  harness.stage({128.0F, 64.0F});
  FIR_PEQ_CHECK(harness.commit(makePayload(257u, 64u, 0.5F)));
  FIR_PEQ_CHECK(harness.kernel->latencySamples() == 192u);
  harness.prepareToActive();
}

void testZeroLatencyActivationWaitsForCompleteWetBlock() {
  Harness harness;
  harness.stage({0.0F, 0.0F});
  FIR_PEQ_CHECK(harness.commit(makePayload(257u), 0u));
  FIR_PEQ_CHECK(harness.kernel->latencySamples() == 0u);

  std::array<float, 256> signal{};
  signal.fill(1.0F);
  harness.kernel->process(signal.data(), 2u, 128u, {0.0});
  FIR_PEQ_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_PREPARING);

  signal.fill(1.0F);
  harness.kernel->process(signal.data(), 2u, 128u, {0.0});
  FIR_PEQ_CHECK((harness.kernel->assetState(0u) & 0xffu) == ET_ASSET_STATE_ACTIVE);
}

void testSharedMonoFilterAndReplacementHandshake() {
  Harness harness;
  harness.stage({128.0F, 0.0F});
  FIR_PEQ_CHECK(harness.commit(makePayload(257u)));
  harness.prepareToActive();

  std::array<float, 256> signal{};
  for (std::uint32_t block = 0u; block < 8u; ++block)
    harness.kernel->process(signal.data(), 2u, 128u, {0.0});

  harness.stage({-1.0F, 0.0F});
  for (std::uint32_t block = 0u; block < 4u; ++block)
    harness.kernel->process(signal.data(), 2u, 128u, {0.0});
  FIR_PEQ_CHECK((harness.kernel->assetState(0u) & kReplacementDryReady) != 0u);
}

} // namespace

int main() {
  testBypassAndLatency();
  testZeroLatencyActivationWaitsForCompleteWetBlock();
  testSharedMonoFilterAndReplacementHandshake();
  return failures == 0 ? 0 : 1;
}
