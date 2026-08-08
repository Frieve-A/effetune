#include "AMRadioSimulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_AMRadioSimulatorPlugin() noexcept;
extern "C" double et_am_debug_interferer_program_power(effetune::PluginKernel *kernel,
                                                       double frequency) noexcept;
extern "C" double et_am_debug_tuning_reception_gain(effetune::PluginKernel *kernel,
                                                    double offset_hz, double program_bandwidth_hz,
                                                    double if_bandwidth_hz) noexcept;
extern "C" double et_am_debug_modeled_tuning_offset(effetune::PluginKernel *kernel,
                                                    double offset_hz) noexcept;
extern "C" double et_am_debug_delay_q_checksum(effetune::PluginKernel *kernel) noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
constexpr std::size_t kTelemetryBytes = 64u;
using Params = effetune::generated::AMRadioSimulatorPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "AM Radio Simulator check failed: %s\n", message);
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
  return {1.0F, 6.0F, 50.0F, 90.0F, 6.0F,  0.0F,   -12.0F, 1.0F, 0.15F, 0.3F,  -65.0F,
          9.0F, 0.0F, 12.0F, 2.0F,  50.0F, -70.0F, 0.0F,   2.0F, 0.0F,  100.0F};
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 96000.0F, std::uint32_t max_channels = 4u) {
    descriptor_ = et_kernel_descriptor_AMRadioSimulatorPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr)
      return;
    check(descriptor_->objectSize <= storage_.size(), "kernel fits fixed object storage");
    check(descriptor_->paramsHash == Params::kHash, "descriptor hash matches generated params");
    check(descriptor_->paramsFloatCount == Params::kFloatCount,
          "descriptor parameter count matches generated params");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr)
      kernel_->prepare({sample_rate, max_channels, kMaximumFrames});
  }

  ~KernelHarness() {
    if (kernel_ != nullptr)
      descriptor_->destroy(kernel_);
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  void seed(std::uint32_t low, std::uint32_t high) noexcept { kernel_->setRandomSeed(low, high); }
  void reset() noexcept { kernel_->reset(); }

  void stage(const Params &params) noexcept {
    const et_status status =
        kernel_->stageParameters(&params.radio, Params::kFloatCount, Params::kHash);
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

  double interfererProgramPower(double frequency) const noexcept {
    return et_am_debug_interferer_program_power(kernel_, frequency);
  }

  double tuningReceptionGain(double offset_hz, double program_bandwidth_hz,
                             double if_bandwidth_hz) const noexcept {
    return et_am_debug_tuning_reception_gain(kernel_, offset_hz, program_bandwidth_hz,
                                             if_bandwidth_hz);
  }

  double modeledTuningOffset(double offset_hz) const noexcept {
    return et_am_debug_modeled_tuning_offset(kernel_, offset_hz);
  }

  double delayQChecksum() const noexcept { return et_am_debug_delay_q_checksum(kernel_); }

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
    check(dropped == 0u, "telemetry ring accepts the fixed frame");
    return bytes;
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

std::vector<float> makeSignal(std::uint32_t channels, std::uint32_t frames,
                              std::uint32_t offset = 0u) {
  std::vector<float> audio(static_cast<std::size_t>(channels) * frames);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double position = static_cast<double>(offset + frame + channel * 17u);
      audio[static_cast<std::size_t>(channel) * frames + frame] =
          static_cast<float>(0.37 * std::sin(position * 0.071) + 0.18 * std::cos(position * 0.023));
    }
  }
  return audio;
}

std::vector<float> makeTone(std::uint32_t frames, std::uint32_t offset, double amplitude,
                            double sample_rate) {
  std::vector<float> audio(frames);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double phase =
        6.28318530717958647692 * 1000.0 * static_cast<double>(offset + frame) / sample_rate;
    audio[frame] = static_cast<float>(amplitude * std::sin(phase));
  }
  return audio;
}

void processTone(KernelHarness &harness, double amplitude, std::uint32_t frames,
                 std::uint32_t offset, double sample_rate) {
  for (std::uint32_t position = 0u; position < frames; position += kMaximumFrames) {
    const std::uint32_t block_frames =
        kMaximumFrames < frames - position ? kMaximumFrames : frames - position;
    std::vector<float> block = makeTone(block_frames, offset + position, amplitude, sample_rate);
    harness.process(block, 1u, block_frames);
  }
}

struct ProgramMeasurement {
  double differenceRms = 0.0;
  double noiseRms = 0.0;
};

ProgramMeasurement measureProgram(float tuning) {
  constexpr double sample_rate = 44100.0;
  constexpr std::uint32_t settle_frames = 44100u;
  constexpr std::uint32_t measure_frames = 22050u;
  Params params = defaultParams();
  params.preEmphasis = 0.0F;
  params.compression = 0.0F;
  params.skywave = 0.0F;
  params.staticRate = 0.0F;
  params.interference = -80.0F;
  params.tuning = tuning;
  params.txBandwidth = 10.0F;
  params.ifBandwidth = 20.0F;
  params.hum = -80.0F;
  params.speaker = 0.0F;
  KernelHarness program(static_cast<float>(sample_rate), 1u);
  KernelHarness noise(static_cast<float>(sample_rate), 1u);
  program.seed(0x12345678u, 0x9abcdef0u);
  noise.seed(0x12345678u, 0x9abcdef0u);
  program.stage(params);
  noise.stage(params);
  double difference_power = 0.0;
  double noise_power = 0.0;
  for (std::uint32_t offset = 0u; offset < settle_frames + measure_frames;
       offset += kMaximumFrames) {
    const std::uint32_t remaining = settle_frames + measure_frames - offset;
    const std::uint32_t frames = remaining < kMaximumFrames ? remaining : kMaximumFrames;
    std::vector<float> with_program = makeTone(frames, offset, 0.25, sample_rate);
    std::vector<float> noise_only(frames, 0.0F);
    program.process(with_program, 1u, frames);
    noise.process(noise_only, 1u, frames);
    if (offset + frames > settle_frames) {
      const std::uint32_t begin = offset < settle_frames ? settle_frames - offset : 0u;
      for (std::uint32_t frame = begin; frame < frames; ++frame) {
        const double difference =
            static_cast<double>(with_program[frame]) - static_cast<double>(noise_only[frame]);
        difference_power += difference * difference;
        const double noise_sample = static_cast<double>(noise_only[frame]);
        noise_power += noise_sample * noise_sample;
      }
    }
  }
  return {std::sqrt(difference_power / static_cast<double>(measure_frames)),
          std::sqrt(noise_power / static_cast<double>(measure_frames))};
}

float telemetryScalar(KernelHarness &harness, std::uint32_t payload_offset) noexcept {
  std::array<std::uint8_t, kTelemetryBytes> frame{};
  check(harness.telemetry(frame, 47u) == 44u, "telemetry is available for scalar checks");
  return readF32(frame.data() + 16u + payload_offset);
}

std::uint32_t telemetryCounter(KernelHarness &harness, std::uint32_t payload_offset) noexcept {
  std::array<std::uint8_t, kTelemetryBytes> frame{};
  check(harness.telemetry(frame, 47u) == 44u, "telemetry is available for counter checks");
  return readU32(frame.data() + 16u + payload_offset);
}

bool finite(const std::vector<float> &audio) noexcept {
  for (float sample : audio) {
    if (!std::isfinite(sample))
      return false;
  }
  return true;
}

std::vector<float> render(std::uint32_t block_size) {
  constexpr std::uint32_t total_frames = 512u;
  constexpr std::uint32_t channels = 2u;
  KernelHarness harness;
  harness.seed(0x13579bdfu, 0x2468ace0u);
  harness.stage(defaultParams());
  std::vector<float> result(static_cast<std::size_t>(channels) * total_frames);
  for (std::uint32_t offset = 0u; offset < total_frames; offset += block_size) {
    const std::uint32_t frames =
        block_size < total_frames - offset ? block_size : total_frames - offset;
    std::vector<float> block = makeSignal(channels, frames, offset);
    harness.process(block, channels, frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::memcpy(result.data() + static_cast<std::size_t>(channel) * total_frames + offset,
                  block.data() + static_cast<std::size_t>(channel) * frames,
                  static_cast<std::size_t>(frames) * sizeof(float));
    }
  }
  return result;
}

std::vector<float> renderModeTransitions(std::uint32_t block_size) {
  constexpr std::uint32_t total_frames = 8193u;
  constexpr std::uint32_t channels = 2u;
  constexpr std::array<std::uint32_t, 2u> event_frames = {1025u, 5123u};
  KernelHarness harness;
  harness.seed(0x5a17c0deu, 0x13572468u);
  Params params = defaultParams();
  harness.stage(params);
  std::vector<float> result(static_cast<std::size_t>(channels) * total_frames);
  std::uint32_t offset = 0u;
  std::size_t event_index = 0u;
  while (offset < total_frames) {
    if (event_index < event_frames.size() && offset == event_frames[event_index]) {
      params.stereoMode = event_index == 0u ? 1.0F : 0.0F;
      harness.stage(params);
      ++event_index;
    }
    std::uint32_t frames = block_size < total_frames - offset ? block_size : total_frames - offset;
    if (event_index < event_frames.size() && offset + frames > event_frames[event_index]) {
      frames = event_frames[event_index] - offset;
    }
    std::vector<float> block = makeSignal(channels, frames, offset);
    harness.process(block, channels, frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::memcpy(result.data() + static_cast<std::size_t>(channel) * total_frames + offset,
                  block.data() + static_cast<std::size_t>(channel) * frames,
                  static_cast<std::size_t>(frames) * sizeof(float));
    }
    offset += frames;
  }
  return result;
}

constexpr std::uint32_t kRapidModeTotalFrames = 6001u;
constexpr std::uint32_t kRapidModeFirstSwitchFrame = 1024u;
constexpr std::uint32_t kRapidModeReverseFrame = 1504u;
constexpr std::uint32_t kRapidModeTransitionFrames = 1920u;
constexpr std::uint32_t kRapidModeFirstTransitionEndFrame =
    kRapidModeFirstSwitchFrame + kRapidModeTransitionFrames;

std::vector<float> renderRapidModeReversal(std::uint32_t block_size,
                                           std::uint32_t reverse_frame = kRapidModeReverseFrame) {
  constexpr std::uint32_t total_frames = kRapidModeTotalFrames;
  constexpr std::uint32_t channels = 2u;
  const std::array<std::uint32_t, 2u> event_frames = {kRapidModeFirstSwitchFrame, reverse_frame};
  KernelHarness harness;
  harness.seed(0x7c31a5e9u, 0x2468bdf0u);
  Params params = defaultParams();
  harness.stage(params);
  std::vector<float> result(static_cast<std::size_t>(channels) * total_frames);
  std::uint32_t offset = 0u;
  std::size_t event_index = 0u;
  while (offset < total_frames) {
    if (event_index < event_frames.size() && offset == event_frames[event_index]) {
      params.stereoMode = event_index == 0u ? 1.0F : 0.0F;
      harness.stage(params);
      ++event_index;
    }
    std::uint32_t frames = block_size < total_frames - offset ? block_size : total_frames - offset;
    if (event_index < event_frames.size() && offset + frames > event_frames[event_index]) {
      frames = event_frames[event_index] - offset;
    }
    std::vector<float> block = makeSignal(channels, frames, offset);
    harness.process(block, channels, frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::memcpy(result.data() + static_cast<std::size_t>(channel) * total_frames + offset,
                  block.data() + static_cast<std::size_t>(channel) * frames,
                  static_cast<std::size_t>(frames) * sizeof(float));
    }
    offset += frames;
  }
  return result;
}

void testRoutingAndTelemetry() {
  KernelHarness harness;
  check(harness.latency() == 0u, "kernel reports zero latency");
  Params dry = defaultParams();
  dry.mix = 0.0F;
  std::vector<float> audio = makeSignal(4u, 128u);
  const std::vector<float> original = audio;
  harness.stage(dry);
  harness.process(audio, 4u, 128u);
  check(audio == original, "dry first pair and extra channels remain unchanged");

  std::array<std::uint8_t, kTelemetryBytes> frame{};
  constexpr std::uint32_t tap_id = 1717u;
  check(harness.telemetry(frame, tap_id) == 44u, "telemetry frame is header plus 28-byte payload");
  check(readU16(frame.data()) == 17u, "telemetry uses the AM Radio Simulator frame type");
  check(readU16(frame.data() + 2u) == 2u, "telemetry uses format version 2");
  check(readU32(frame.data() + 4u) == tap_id, "telemetry preserves the tap id");
  check(readU16(frame.data() + 12u) == 28u, "telemetry payload is exactly 28 bytes");
  for (std::uint32_t offset = 16u; offset < 36u; offset += 4u) {
    check(std::isfinite(readF32(frame.data() + offset)), "telemetry scalar is finite");
  }
  const float stereo_blend = readF32(frame.data() + 32u);
  check(stereo_blend >= 0.0F && stereo_blend <= 1.0F, "telemetry stereo blend stays in range");
}

void testDeterminismAndBlockDivision() {
  const std::vector<float> single = render(1u);
  const std::vector<float> full = render(128u);
  check(single == full, "fixed seed output is independent of block division");
  check(finite(single), "reference output remains finite");

  KernelHarness harness;
  harness.seed(0x12345678u, 0x9abcdef0u);
  Params params = defaultParams();
  std::vector<float> first = makeSignal(2u, 128u, 11u);
  harness.stage(params);
  harness.process(first, 2u, 128u);
  harness.reset();
  harness.seed(0x12345678u, 0x9abcdef0u);
  std::vector<float> replay = makeSignal(2u, 128u, 11u);
  harness.stage(params);
  harness.process(replay, 2u, 128u);
  check(first == replay, "reset and reseed reproduce the complete simulation");

  const auto render_seed = [](std::uint32_t seed) {
    KernelHarness seeded;
    seeded.seed(seed, 0u);
    Params seeded_params = defaultParams();
    std::vector<float> output = makeSignal(2u, 128u, 11u);
    seeded.stage(seeded_params);
    seeded.process(output, 2u, 128u);
    return output;
  };
  const std::vector<float> seed_1 = render_seed(1u);
  const std::vector<float> seed_2 = render_seed(2u);
  const std::vector<float> seed_3 = render_seed(3u);
  const std::vector<float> seed_4 = render_seed(4u);
  const std::vector<float> seed_5 = render_seed(5u);
  check(seed_1 != seed_2 && seed_2 != seed_3 && seed_4 != seed_5,
        "adjacent execution seeds select distinct simulations");
}

void testModeTransitionDeterminismAndBlockDivision() {
  const std::vector<float> single = renderModeTransitions(1u);
  const std::vector<float> odd = renderModeTransitions(127u);
  const std::vector<float> replay = renderModeTransitions(127u);
  check(single == odd, "mode transitions are independent of block division");
  check(odd == replay, "mode transition state is deterministic for identical input");
  check(finite(single), "mode transitions never produce a non-finite sample");
}

void testRapidModeReversalDeterminismAndBlockDivision() {
  const std::vector<float> single = renderRapidModeReversal(1u);
  const std::vector<float> odd = renderRapidModeReversal(127u);
  const std::vector<float> replay = renderRapidModeReversal(127u);
  const std::vector<float> uninterrupted = renderRapidModeReversal(127u, kRapidModeTotalFrames);
  const std::vector<float> deferred =
      renderRapidModeReversal(127u, kRapidModeFirstTransitionEndFrame);
  check(single == odd, "sub-20 ms mode reversal is independent of block division");
  check(odd == replay, "sub-20 ms mode reversal is deterministic for identical input");
  check(finite(single), "sub-20 ms mode reversal never produces a non-finite sample");

  bool matches_uninterrupted_transition = true;
  for (std::uint32_t channel = 0u; channel < 2u; ++channel) {
    const std::size_t channel_offset = static_cast<std::size_t>(channel) * kRapidModeTotalFrames;
    matches_uninterrupted_transition &=
        std::memcmp(
            odd.data() + channel_offset + kRapidModeReverseFrame,
            uninterrupted.data() + channel_offset + kRapidModeReverseFrame,
            static_cast<std::size_t>(kRapidModeFirstTransitionEndFrame - kRapidModeReverseFrame) *
                sizeof(float)) == 0;
  }
  check(matches_uninterrupted_transition,
        "a sub-20 ms reversal waits for the in-progress C-QUAM transition to finish");
  check(std::memcmp(odd.data(), deferred.data(), odd.size() * sizeof(float)) == 0,
        "the pending Mono request starts when the first mode transition finishes");
  check(std::memcmp(uninterrupted.data(), deferred.data(), uninterrupted.size() * sizeof(float)) !=
            0,
        "the deferred Mono reference differs from uninterrupted C-QUAM");
  check(std::memcmp(odd.data() + kRapidModeTotalFrames - kMaximumFrames,
                    odd.data() + 2u * kRapidModeTotalFrames - kMaximumFrames,
                    static_cast<std::size_t>(kMaximumFrames) * sizeof(float)) == 0,
        "the pending Mono request eventually closes the stereo output");
}

void testModeTransitionRunsCompleteParallelPaths() {
  constexpr std::uint32_t seed_low = 0x7a31c0deu;
  constexpr std::uint32_t seed_high = 0x24681357u;
  KernelHarness transitioned;
  KernelHarness continuous;
  transitioned.seed(seed_low, seed_high);
  continuous.seed(seed_low, seed_high);
  Params mono = defaultParams();
  mono.speaker = 0.0F;
  transitioned.stage(mono);
  continuous.stage(mono);
  std::vector<float> prefix = makeSignal(2u, 128u, 0u);
  for (std::uint32_t offset = 0u; offset < 1024u; offset += 128u) {
    std::vector<float> transitioned_block = prefix;
    std::vector<float> continuous_block = prefix;
    transitioned.process(transitioned_block, 2u, 128u);
    continuous.process(continuous_block, 2u, 128u);
    check(transitioned_block == continuous_block, "mode transition fixtures begin in sync");
  }

  Params cquam = mono;
  cquam.stereoMode = 1.0F;
  transitioned.stage(cquam);
  continuous.stage(mono);
  std::vector<float> first_transition_sample = makeSignal(2u, 1u, 1024u);
  std::vector<float> continuous_sample = first_transition_sample;
  transitioned.process(first_transition_sample, 2u, 1u);
  continuous.process(continuous_sample, 2u, 1u);
  check(first_transition_sample == continuous_sample,
        "mode changes start exactly from the complete previous wet path");
}

void testCquamDelayResetOnReentry() {
  constexpr std::uint32_t seed_low = 0x6d4f210bu;
  constexpr std::uint32_t seed_high = 0x97531aceu;
  KernelHarness reentered;
  KernelHarness first_entry;
  reentered.seed(seed_low, seed_high);
  first_entry.seed(seed_low, seed_high);
  Params mono = defaultParams();
  mono.speaker = 0.0F;
  Params cquam = mono;
  cquam.stereoMode = 1.0F;
  reentered.stage(mono);
  first_entry.stage(mono);

  std::uint32_t offset = 0u;
  auto process_both = [&](std::uint32_t frames) {
    while (frames > 0u) {
      const std::uint32_t block_frames = frames < kMaximumFrames ? frames : kMaximumFrames;
      std::vector<float> input = makeSignal(2u, block_frames, offset);
      std::vector<float> reentered_block = input;
      std::vector<float> first_entry_block = input;
      reentered.process(reentered_block, 2u, block_frames);
      first_entry.process(first_entry_block, 2u, block_frames);
      offset += block_frames;
      frames -= block_frames;
    }
  };

  process_both(1024u);
  reentered.stage(cquam);
  process_both(4096u);
  reentered.stage(mono);
  process_both(4096u);
  reentered.stage(cquam);
  first_entry.stage(cquam);
  process_both(1u);
  check(reentered.delayQChecksum() == first_entry.delayQChecksum(),
        "C-QUAM reentry clears the Q propagation delay to its first-entry state");
}

void testCquamStereoBlendAndSeparation() {
  constexpr double sample_rate = 48000.0;
  constexpr std::uint32_t total_frames = 96000u;
  constexpr std::uint32_t measurement_start = 72000u;
  KernelHarness harness(static_cast<float>(sample_rate), 2u);
  harness.seed(0x1234abcdu, 0x9876fedcu);
  Params cquam = defaultParams();
  cquam.stereoMode = 1.0F;
  cquam.preEmphasis = 0.0F;
  cquam.compression = 0.0F;
  cquam.signal = 0.0F;
  cquam.skywave = 0.0F;
  cquam.staticRate = 0.0F;
  cquam.interference = -80.0F;
  cquam.tuning = 0.0F;
  cquam.txBandwidth = 10.0F;
  cquam.ifBandwidth = 20.0F;
  cquam.hum = -80.0F;
  cquam.speaker = 0.0F;
  harness.stage(cquam);

  double left_power = 0.0;
  double right_power = 0.0;
  std::uint32_t measured_frames = 0u;
  for (std::uint32_t offset = 0u; offset < total_frames; offset += kMaximumFrames) {
    const std::uint32_t frames =
        kMaximumFrames < total_frames - offset ? kMaximumFrames : total_frames - offset;
    std::vector<float> block(static_cast<std::size_t>(frames) * 2u, 0.0F);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double phase =
          6.28318530717958647692 * 1000.0 * static_cast<double>(offset + frame) / sample_rate;
      block[frame] = static_cast<float>(0.25 * std::sin(phase));
    }
    harness.process(block, 2u, frames);
    if (offset + frames > measurement_start) {
      const std::uint32_t begin = offset < measurement_start ? measurement_start - offset : 0u;
      for (std::uint32_t frame = begin; frame < frames; ++frame) {
        const double left = block[frame];
        const double right = block[frames + frame];
        left_power += left * left;
        right_power += right * right;
        ++measured_frames;
      }
    }
  }
  const float locked_blend = telemetryScalar(harness, 16u);
  check(locked_blend > 0.75F, "clean C-QUAM reception reports a meaningful positive stereo blend");
  check(measured_frames > 0u && left_power > right_power * 4.0,
        "locked C-QUAM reception separates an L-only program between outputs");

  Params mono = cquam;
  mono.stereoMode = 0.0F;
  harness.stage(mono);
  for (std::uint32_t offset = 0u; offset < 4800u; offset += kMaximumFrames) {
    const std::uint32_t frames = kMaximumFrames < 4800u - offset ? kMaximumFrames : 4800u - offset;
    std::vector<float> block(static_cast<std::size_t>(frames) * 2u, 0.0F);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double phase = 6.28318530717958647692 * 1000.0 *
                           static_cast<double>(total_frames + offset + frame) / sample_rate;
      block[frame] = static_cast<float>(0.25 * std::sin(phase));
    }
    harness.process(block, 2u, frames);
  }
  check(telemetryScalar(harness, 16u) < 0.01F,
        "switching to Mono closes the reported stereo blend");
}

void testUnsupportedCquamRateFallsBackToMono() {
  constexpr float sample_rate = 384000.0F;
  KernelHarness mono(sample_rate, 2u);
  KernelHarness cquam(sample_rate, 2u);
  mono.seed(0xabcdef01u, 0x10293847u);
  cquam.seed(0xabcdef01u, 0x10293847u);
  Params mono_params = defaultParams();
  Params cquam_params = mono_params;
  cquam_params.stereoMode = 1.0F;
  mono.stage(mono_params);
  cquam.stage(cquam_params);
  for (std::uint32_t offset = 0u; offset < 1024u; offset += kMaximumFrames) {
    std::vector<float> mono_block = makeSignal(2u, kMaximumFrames, offset);
    std::vector<float> cquam_block = mono_block;
    mono.process(mono_block, 2u, kMaximumFrames);
    cquam.process(cquam_block, 2u, kMaximumFrames);
    check(finite(mono_block) && finite(cquam_block),
          "384 kHz Mono and C-QUAM requests remain finite");
    check(mono_block == cquam_block,
          "384 kHz C-QUAM request follows the bit-identical Mono audio path");
  }
  check(telemetryScalar(cquam, 16u) == 0.0F,
        "384 kHz C-QUAM fallback keeps the stereo lamp blend off");
}

void testReconfigurationAndMaximumShape() {
  constexpr std::uint32_t seed_low = 0x0badf00du;
  constexpr std::uint32_t seed_high = 0x31415926u;
  KernelHarness transitioned;
  KernelHarness continuous;
  transitioned.seed(seed_low, seed_high);
  continuous.seed(seed_low, seed_high);
  Params off = defaultParams();
  off.speaker = 0.0F;
  std::vector<float> transitioned_prefix = makeSignal(2u, 79u, 5u);
  std::vector<float> continuous_prefix = transitioned_prefix;
  transitioned.stage(off);
  continuous.stage(off);
  transitioned.process(transitioned_prefix, 2u, 79u);
  continuous.process(continuous_prefix, 2u, 79u);
  check(transitioned_prefix == continuous_prefix, "speaker transition fixtures begin in sync");

  Params table = off;
  table.speaker = 2.0F;
  std::vector<float> first_transition_sample = makeSignal(2u, 1u, 84u);
  std::vector<float> continuous_sample = first_transition_sample;
  transitioned.stage(table);
  continuous.stage(off);
  transitioned.process(first_transition_sample, 2u, 1u);
  continuous.process(continuous_sample, 2u, 1u);
  check(first_transition_sample == continuous_sample,
        "speaker changes begin from the continuous receiver output");

  std::vector<float> transition_tail = makeSignal(2u, 128u, 85u);
  std::vector<float> off_tail = transition_tail;
  transitioned.stage(table);
  continuous.stage(off);
  transitioned.process(transition_tail, 2u, 128u);
  continuous.process(off_tail, 2u, 128u);
  check(transition_tail != off_tail,
        "speaker response crossfades without resetting receiver state");
  check(finite(transition_tail), "speaker transition remains finite");

  KernelHarness maximum(192000.0F, 8u);
  maximum.seed(1u, 2u);
  std::vector<float> audio = makeSignal(8u, kMaximumFrames);
  const std::vector<float> extra_channels = audio;
  Params maximum_params = defaultParams();
  maximum_params.stereoMode = 1.0F;
  maximum.stage(maximum_params);
  maximum.process(audio, 8u, kMaximumFrames);
  check(finite(audio), "maximum sample-rate and channel shape remains finite");
  for (std::uint32_t channel = 2u; channel < 8u; ++channel) {
    const std::size_t offset = static_cast<std::size_t>(channel) * kMaximumFrames;
    check(std::memcmp(audio.data() + offset, extra_channels.data() + offset,
                      static_cast<std::size_t>(kMaximumFrames) * sizeof(float)) == 0,
          "channels above the first pair remain untouched");
  }
}

void testAgcCarrierTracking() {
  constexpr double sample_rate = 48000.0;
  Params stable = defaultParams();
  stable.preEmphasis = 0.0F;
  stable.compression = 0.0F;
  stable.skywave = 0.0F;
  stable.staticRate = 0.0F;
  stable.interference = -80.0F;
  stable.hum = -80.0F;
  stable.speaker = 0.0F;

  KernelHarness modulation(static_cast<float>(sample_rate), 1u);
  modulation.seed(0x10203040u, 0x50607080u);
  modulation.stage(stable);
  processTone(modulation, 0.10, 96000u, 0u, sample_rate);
  const float low_modulation_gain = telemetryScalar(modulation, 4u);
  modulation.stage(stable);
  processTone(modulation, 0.50, 96000u, 96000u, sample_rate);
  const float high_modulation_gain = telemetryScalar(modulation, 4u);
  check(std::abs(high_modulation_gain - low_modulation_gain) < 0.35F,
        "AGC gain is independent of the audio modulation envelope");

  Params weak = stable;
  weak.signal = -30.0F;
  KernelHarness level_change(static_cast<float>(sample_rate), 1u);
  level_change.seed(0xabcdef01u, 0x23456789u);
  level_change.stage(weak);
  processTone(level_change, 0.0, 1u, 0u, sample_rate);
  const float initial_gain = telemetryScalar(level_change, 4u);
  check(initial_gain > 23.5F && initial_gain < 24.5F,
        "AGC initializes from the selected signal level");

  Params very_weak = stable;
  very_weak.signal = -50.0F;
  KernelHarness maximum_gain(static_cast<float>(sample_rate), 1u);
  maximum_gain.seed(0x13579bdfu, 0x2468ace0u);
  maximum_gain.stage(very_weak);
  processTone(maximum_gain, 0.0, 1u, 0u, sample_rate);
  check(telemetryScalar(maximum_gain, 4u) == 42.0F,
        "AGC maximum gain matches a practical receiver limit");

  Params strong = weak;
  strong.signal = -12.0F;
  level_change.stage(strong);
  processTone(level_change, 0.0, 24000u, 1u, sample_rate);
  const float attacked_gain = telemetryScalar(level_change, 4u);
  check(attacked_gain < 8.0F, "fast AGC promptly reduces gain for a stronger carrier");
  level_change.stage(weak);
  processTone(level_change, 0.0, 9600u, 24001u, sample_rate);
  const float recovering_gain = telemetryScalar(level_change, 4u);
  check(recovering_gain > attacked_gain && recovering_gain < 14.0F,
        "fast AGC releases gradually after the carrier becomes weaker");

  Params detector_weak = stable;
  detector_weak.signal = -36.0F;
  Params detector_strong = stable;
  detector_strong.signal = -12.0F;
  Params detector_fast = detector_weak;
  detector_fast.agcSpeed = 2.0F;
  Params detector_slow = detector_weak;
  detector_slow.agcSpeed = 0.0F;
  KernelHarness rising_fast(static_cast<float>(sample_rate), 1u);
  KernelHarness rising_slow(static_cast<float>(sample_rate), 1u);
  rising_fast.seed(0x11223344u, 0x55667788u);
  rising_slow.seed(0x11223344u, 0x55667788u);
  rising_fast.stage(detector_fast);
  rising_slow.stage(detector_slow);
  processTone(rising_fast, 0.0, 1u, 0u, sample_rate);
  processTone(rising_slow, 0.0, 1u, 0u, sample_rate);
  detector_fast.signal = detector_strong.signal;
  detector_slow.signal = detector_strong.signal;
  rising_fast.stage(detector_fast);
  rising_slow.stage(detector_slow);
  processTone(rising_fast, 0.0, 4800u, 1u, sample_rate);
  processTone(rising_slow, 0.0, 4800u, 1u, sample_rate);
  const float fast_rising_carrier = telemetryScalar(rising_fast, 0u);
  const float slow_rising_carrier = telemetryScalar(rising_slow, 0u);
  check(fast_rising_carrier > slow_rising_carrier + 3.0F,
        "AGC carrier detector attack follows the selected speed");

  detector_fast.signal = detector_strong.signal;
  detector_slow.signal = detector_strong.signal;
  KernelHarness falling_fast(static_cast<float>(sample_rate), 1u);
  KernelHarness falling_slow(static_cast<float>(sample_rate), 1u);
  falling_fast.seed(0x99aabbccu, 0xddeeff00u);
  falling_slow.seed(0x99aabbccu, 0xddeeff00u);
  falling_fast.stage(detector_fast);
  falling_slow.stage(detector_slow);
  processTone(falling_fast, 0.0, 1u, 0u, sample_rate);
  processTone(falling_slow, 0.0, 1u, 0u, sample_rate);
  detector_fast.signal = detector_weak.signal;
  detector_slow.signal = detector_weak.signal;
  falling_fast.stage(detector_fast);
  falling_slow.stage(detector_slow);
  processTone(falling_fast, 0.0, 24000u, 1u, sample_rate);
  processTone(falling_slow, 0.0, 24000u, 1u, sample_rate);
  const float fast_falling_carrier = telemetryScalar(falling_fast, 0u);
  const float slow_falling_carrier = telemetryScalar(falling_slow, 0u);
  check(fast_falling_carrier < slow_falling_carrier - 1.0F,
        "AGC carrier detector release follows the selected speed");
}

void testMaxShiftInterfererSpectrum() {
  constexpr double sample_rate = 44100.0;
  constexpr double maximum_shift = 15000.0;
  constexpr double maximum_if_half_bandwidth = 10000.0;
  constexpr double folded_program_threshold =
      sample_rate - maximum_shift - maximum_if_half_bandwidth;
  constexpr std::uint32_t bins = 131072u;
  KernelHarness harness(static_cast<float>(sample_rate));
  std::vector<float> initialization(1u, 0.0F);
  harness.stage(defaultParams());
  harness.process(initialization, 1u, 1u);
  double total_power = 0.0;
  double folded_power = 0.0;
  for (std::uint32_t bin = 0u; bin <= bins; ++bin) {
    const double frequency =
        sample_rate * 0.5 * static_cast<double>(bin) / static_cast<double>(bins);
    const double power = harness.interfererProgramPower(frequency);
    total_power += power;
    if (frequency >= folded_program_threshold)
      folded_power += power;
  }
  const double folded_interferer_db =
      10.0 * std::log10((folded_power * 0.35 * 0.35 + 1.0e-30) / (total_power + 1.0e-30));
  check(folded_interferer_db < -60.0,
        "max-shift adjacent program stays below the in-band alias limit");
}

void testExtendedTuningModel() {
  KernelHarness harness(44100.0F);
  check(harness.modeledTuningOffset(30000.0) == 15000.0,
        "positive tuning is limited to the alias-safe digital offset");
  check(harness.modeledTuningOffset(-30000.0) == -15000.0,
        "negative tuning is limited to the alias-safe digital offset");
  check(harness.tuningReceptionGain(0.0, 10000.0, 20000.0) == 1.0,
        "center tuning has unity reception gain");
  const double positive = harness.tuningReceptionGain(30000.0, 10000.0, 20000.0);
  const double negative = harness.tuningReceptionGain(-30000.0, 10000.0, 20000.0);
  check(positive > 0.015 && positive < 0.016,
        "maximum detuning applies the wideband IF stop-band loss");
  check(positive == negative, "tuning reception loss is symmetric");
  const ProgramMeasurement centered = measureProgram(0.0F);
  const ProgramMeasurement detuned = measureProgram(30.0F);
  check(centered.differenceRms > detuned.differenceRms * 10.0,
        "maximum detuning buries the desired program below the receiver noise");
  check(detuned.differenceRms < detuned.noiseRms * 0.25,
        "maximum-bandwidth detuned program remains below the receiver noise floor");
}

struct StaticRateProbe {
  std::uint32_t first_event_frames = 0u;
  std::uint32_t events = 0u;
};

// Runs two seconds at a very low static rate so that the pending exponential deadline is far in
// the future, raises the rate to `raised_rate`, then walks one second in small blocks recording
// when the first impulse lands and how many arrive in total.
StaticRateProbe probeStaticRateChange(float raised_rate) {
  constexpr double sample_rate = 48000.0;
  constexpr std::uint32_t kSlowFrames = 96000u;
  constexpr std::uint32_t kProbeBlock = 96u;
  constexpr std::uint32_t kProbeFrames = 48000u;
  Params slow = defaultParams();
  slow.staticRate = 0.125F;
  slow.skywave = 0.0F;
  slow.interference = -80.0F;
  slow.hum = -80.0F;
  slow.speaker = 0.0F;
  KernelHarness harness(static_cast<float>(sample_rate), 1u);
  harness.seed(0x77777777u, 0x11111111u);
  harness.stage(slow);
  processTone(harness, 0.0, kSlowFrames, 0u, sample_rate);
  const std::uint32_t before = telemetryCounter(harness, 20u);

  Params raised = slow;
  raised.staticRate = raised_rate;
  harness.stage(raised);
  StaticRateProbe probe;
  probe.first_event_frames = kProbeFrames;
  for (std::uint32_t frames = 0u; frames < kProbeFrames; frames += kProbeBlock) {
    processTone(harness, 0.0, kProbeBlock, kSlowFrames + frames, sample_rate);
    if (probe.first_event_frames == kProbeFrames && telemetryCounter(harness, 20u) > before) {
      probe.first_event_frames = frames + kProbeBlock;
    }
  }
  probe.events = telemetryCounter(harness, 20u) - before;
  return probe;
}

// Poisson inter-arrival times are memoryless, so a pending deadline drawn at the old rate has to
// have its remaining time rescaled when Static Rate changes. Without the rescale the long
// interval drawn at 0.125 impulses per second survives the parameter change and the receiver
// stays silent for seconds after the user asks for 100 impulses per second.
void testStaticRateIncreaseRescalesThePendingDeadline() {
  const StaticRateProbe held = probeStaticRateChange(0.125F);
  check(held.events == 0u, "the low static rate leaves a pending deadline beyond the probe window");

  // Measured 1632 frames (34 ms) with the rescale in place; without it the pending interval runs
  // for about thirty more seconds, so the first event would fall outside the probe window.
  const StaticRateProbe raised = probeStaticRateChange(100.0F);
  check(raised.first_event_frames <= 2400u,
        "raising the static rate rescales the pending deadline instead of waiting it out");
  check(raised.events > 50u && raised.events < 160u,
        "the rescaled schedule settles on the new Poisson rate");
}

} // namespace

int main() {
  testRoutingAndTelemetry();
  testDeterminismAndBlockDivision();
  testModeTransitionDeterminismAndBlockDivision();
  testRapidModeReversalDeterminismAndBlockDivision();
  testModeTransitionRunsCompleteParallelPaths();
  testCquamDelayResetOnReentry();
  testCquamStereoBlendAndSeparation();
  testUnsupportedCquamRateFallsBackToMono();
  testReconfigurationAndMaximumShape();
  testAgcCarrierTracking();
  testMaxShiftInterfererSpectrum();
  testExtendedTuningModel();
  testStaticRateIncreaseRescalesThePendingDeadline();
  return failures == 0 ? 0 : 1;
}
