#include "VinylSimulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_VinylSimulatorPlugin() noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
constexpr std::size_t kTelemetryBytes = 256u;
using Params = effetune::generated::VinylSimulatorPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Vinyl Simulator check failed: %s\n", message);
    ++failures;
  }
}

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
  return {0.0F, 16000.0F, 250.0F, 70.0F, 0.0F, 120.0F, 13.17F, 2.0F, 0.08F, 0.0F,
          1.0F, 18.0F,    8.0F,   2.0F,  0.4F, 15.0F,  0.25F,  1.0F, 0.0F,  100.0F};
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 96000.0F, std::uint32_t max_channels = 4u) {
    descriptor_ = et_kernel_descriptor_VinylSimulatorPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr) {
      return;
    }
    check(descriptor_->objectSize <= storage_.size(), "kernel fits fixed object storage");
    check(descriptor_->paramsHash == Params::kHash, "descriptor hash matches generated params");
    check(descriptor_->paramsFloatCount == Params::kFloatCount,
          "descriptor parameter count matches generated params");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      kernel_->prepare({sample_rate, max_channels, kMaximumFrames});
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  void seed(std::uint32_t low, std::uint32_t high) noexcept { kernel_->setRandomSeed(low, high); }

  void reset() noexcept { kernel_->reset(); }

  void stage(const Params &params) noexcept {
    const et_status status =
        kernel_->stageParameters(&params.cutLevel, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
  }

  void process(std::vector<float> &audio, std::uint32_t channels, std::uint32_t frames) noexcept {
    check(audio.size() == static_cast<std::size_t>(channels) * frames,
          "audio shape matches process arguments");
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->applyPendingParameters();
    kernel_->process(audio.data(), channels, frames, {0.0});
  }

  std::uint32_t latency() const noexcept { return kernel_->latencySamples(); }

  std::uint32_t telemetry(std::array<std::uint8_t, kTelemetryBytes> &output,
                          std::uint32_t tap_id) noexcept {
    std::array<std::uint8_t, kTelemetryBytes> ring_storage{};
    effetune::TelemetryRing ring;
    ring.adopt(ring_storage.data(), static_cast<std::uint32_t>(ring_storage.size()));
    std::uint32_t sequence = 0u;
    effetune::TelemetryWriter writer(ring, tap_id, sequence);
    kernel_->writeTelemetry(writer);
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
    check(dropped == 0u, "telemetry ring does not drop the fixed frame");
    return bytes;
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

std::vector<float> signal(std::uint32_t channels, std::uint32_t frames, std::uint32_t phase) {
  std::vector<float> result(static_cast<std::size_t>(channels) * frames);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      result[static_cast<std::size_t>(channel) * frames + frame] =
          static_cast<float>(0.61 * std::sin((frame + phase + channel * 7u) * 0.071) +
                             0.19 * std::cos((frame + phase * 3u + channel) * 0.023));
    }
  }
  return result;
}

bool finite(const std::vector<float> &audio) noexcept {
  for (float sample : audio) {
    if (!std::isfinite(sample)) {
      return false;
    }
  }
  return true;
}

std::vector<float> renderSequence(KernelHarness &harness, const Params &params) {
  constexpr std::array<std::uint32_t, 4u> block_sizes = {31u, 128u, 17u, 97u};
  std::vector<float> output;
  for (std::size_t block = 0u; block < block_sizes.size(); ++block) {
    std::vector<float> audio =
        signal(2u, block_sizes[block], static_cast<std::uint32_t>(block) * 131u + 5u);
    harness.stage(params);
    harness.process(audio, 2u, block_sizes[block]);
    output.insert(output.end(), audio.begin(), audio.end());
  }
  return output;
}

void testLatencyPairModeAndTelemetry() {
  KernelHarness harness;
  check(harness.latency() == 16u, "96 kHz fixed latency covers the maximum scan radius");
  Params dry_params = defaultParams();
  dry_params.mix = 0.0F;
  std::vector<float> impulse(64u * 4u, 0.0F);
  impulse[0] = 1.0F;
  impulse[64u] = -1.0F;
  for (std::uint32_t frame = 0u; frame < 64u; ++frame) {
    impulse[128u + frame] = 0.25F;
    impulse[192u + frame] = -0.5F;
  }
  const std::vector<float> original = impulse;
  harness.stage(dry_params);
  harness.process(impulse, 4u, 64u);
  for (std::uint32_t frame = 0u; frame < 16u; ++frame) {
    check(impulse[frame] == 0.0F && impulse[64u + frame] == 0.0F,
          "dry path starts with the reported fixed delay");
  }
  check(impulse[16u] == 1.0F && impulse[80u] == -1.0F,
        "dry impulse emerges at the reported latency");
  for (std::uint32_t index = 128u; index < 256u; ++index) {
    check(impulse[index] == original[index], "channels above the first pair remain untouched");
  }

  std::array<std::uint8_t, kTelemetryBytes> frame{};
  constexpr std::uint32_t tap_id = 1515u;
  check(harness.telemetry(frame, tap_id) == 64u, "telemetry frame is header plus 48-byte payload");
  check(readU16(frame.data()) == 15u, "telemetry uses the Vinyl Simulator frame type");
  check(readU16(frame.data() + 2u) == 1u, "telemetry uses format version 1");
  check(readU32(frame.data() + 4u) == tap_id, "telemetry preserves the tap id");
  check(readU16(frame.data() + 12u) == 48u, "telemetry payload is exactly 48 bytes");
  for (std::uint32_t offset = 16u; offset < 48u; offset += 4u) {
    check(std::isfinite(readF32(frame.data() + offset)), "telemetry scalar is finite");
  }
}

void testSeedResetAndReconfiguration() {
  constexpr std::uint32_t seed_low = 0x13579bdfu;
  constexpr std::uint32_t seed_high = 0x2468ace0u;
  const Params params = defaultParams();
  KernelHarness harness;
  harness.seed(seed_low, seed_high);
  const std::vector<float> first = renderSequence(harness, params);
  harness.reset();
  harness.seed(seed_low, seed_high);
  const std::vector<float> replay = renderSequence(harness, params);
  check(first == replay, "reset and reseed reproduce groove, defect, and stylus state");
  check(finite(first), "seeded physical output remains finite");

  Params high = params;
  high.quality = 2.0F;
  high.stylusShape = 0.0F;
  high.scanRadius = high.sideRadius;
  std::vector<float> prefix = signal(2u, 47u, 3u);
  harness.stage(params);
  harness.process(prefix, 2u, 47u);
  std::vector<float> transitioned = signal(2u, 91u, 99u);
  harness.stage(high);
  harness.process(transitioned, 2u, 91u);

  KernelHarness fresh;
  fresh.seed(seed_low, seed_high);
  std::vector<float> expected = signal(2u, 91u, 99u);
  fresh.stage(high);
  fresh.process(expected, 2u, 91u);
  check(transitioned == expected, "quality and shape changes rebuild the complete simulation");

  Params smooth = high;
  smooth.radius = 60.0F;
  smooth.speed = 2.0F;
  smooth.outputGain = -6.0F;
  std::vector<float> continued = signal(2u, 91u, 211u);
  harness.stage(smooth);
  harness.process(continued, 2u, 91u);
  KernelHarness smooth_fresh;
  smooth_fresh.seed(seed_low, seed_high);
  std::vector<float> restarted = signal(2u, 91u, 211u);
  smooth_fresh.stage(smooth);
  smooth_fresh.process(restarted, 2u, 91u);
  check(continued != restarted, "continuous parameters preserve and smooth the existing state");
  check(finite(transitioned) && finite(continued), "reconfigured output remains finite");
}

void testSampleRateLatency() {
  KernelHarness harness(192000.0F, 2u);
  check(harness.latency() == 27u, "192 kHz latency remains fixed and quality independent");
}

void testSeededDefectFidelity() {
  constexpr std::uint32_t seed_low = 0x0badc0deu;
  constexpr std::uint32_t seed_high = 0x1234abcdu;
  Params params = defaultParams();
  params.quality = 0.0F;
  params.dustRate = 10000.0F;
  params.scratchRate = 1000.0F;
  params.staticRate = 0.0F;
  KernelHarness harness;
  harness.seed(seed_low, seed_high);
  const std::vector<float> first = renderSequence(harness, params);
  harness.reset();
  harness.seed(seed_low, seed_high);
  const std::vector<float> replay = renderSequence(harness, params);
  check(first == replay, "seeded multi-kind dust and scratch distributions replay exactly");
  check(finite(first), "high-rate dust and scratch output remains finite");
}

void testMinimumMassStability() {
  constexpr std::array<float, 3u> sample_rates = {44100.0F, 48000.0F, 96000.0F};
  for (float sample_rate : sample_rates) {
    KernelHarness harness(sample_rate, 2u);
    harness.seed(0x10203040u, 0x50607080u);
    Params params = defaultParams();
    params.quality = sample_rate < 96000.0F ? 0.0F : 1.0F;
    params.tipMass = 0.1F;
    params.trackingForce = 5.0F;
    params.compliance = 5.0F;
    params.sideRadius = 25.0F;
    params.scanRadius = 25.0F;
    params.roughness = 0.1F;
    params.dustRate = 0.0F;
    params.staticRate = 0.0F;
    params.scratchRate = 0.0F;
    harness.stage(params);
    bool bounded = true;
    for (std::uint32_t block = 0u; block < 32u; ++block) {
      std::vector<float> audio(2u * kMaximumFrames, 0.0F);
      harness.process(audio, 2u, kMaximumFrames);
      if (!finite(audio)) {
        bounded = false;
        break;
      }
      for (float sample : audio) {
        const float absolute = sample < 0.0F ? -sample : sample;
        if (absolute > 10.0F) {
          bounded = false;
          break;
        }
      }
      if (!bounded) {
        break;
      }
    }
    check(bounded, "minimum-mass silent playback remains finite and bounded");
    std::array<std::uint8_t, kTelemetryBytes> frame{};
    check(harness.telemetry(frame, 1717u) == 64u, "stability run emits the fixed telemetry frame");
    check(readU32(frame.data() + 48u) == 0u, "stable silent playback does not report mistracking");
    check(readU32(frame.data() + 52u) == 0u, "stable silent playback does not report skips");
  }
}

void testSilentInputKeepsPhysicalSurfaceRunning() {
  KernelHarness harness;
  harness.seed(0x10203040u, 0x50607080u);
  std::vector<float> audio(2u * kMaximumFrames, 0.0F);
  Params params = defaultParams();
  params.roughness = 100.0F;
  params.dustRate = 0.0F;
  params.staticRate = 0.0F;
  params.scratchRate = 0.0F;
  harness.stage(params);
  harness.process(audio, 2u, kMaximumFrames);
  check(finite(audio), "silent-input physical output remains finite");
  bool generated_surface = false;
  for (float sample : audio) {
    if (sample != 0.0F) {
      generated_surface = true;
      break;
    }
  }
  check(generated_surface, "silent input still advances the source-generating surface model");
}

} // namespace

int main() {
  testLatencyPairModeAndTelemetry();
  testSeedResetAndReconfiguration();
  testSampleRateLatency();
  testSeededDefectFidelity();
  testMinimumMassStability();
  testSilentInputKeepsPhysicalSurfaceRunning();
  if (failures != 0) {
    std::fprintf(stderr, "%d Vinyl Simulator native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All Vinyl Simulator lifecycle, latency, pair-mode, and telemetry tests passed");
  return 0;
}
