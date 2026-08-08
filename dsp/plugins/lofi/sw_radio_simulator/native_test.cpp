#include "SWRadioSimulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_SWRadioSimulatorPlugin() noexcept;
extern "C" double et_sw_debug_interferer_program_power(effetune::PluginKernel *kernel,
                                                       double frequency) noexcept;
extern "C" double et_sw_debug_delay_capacity(effetune::PluginKernel *kernel) noexcept;
extern "C" double et_sw_debug_delay_tap(effetune::PluginKernel *kernel, int index) noexcept;
extern "C" double et_sw_debug_sync_pll_state(effetune::PluginKernel *kernel) noexcept;
extern "C" double et_sw_debug_sync_pll_frequency_hz(effetune::PluginKernel *kernel) noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
constexpr std::size_t kTelemetryBytes = 64u;
constexpr std::uint32_t kTelemetryFrameBytes = 40u;
using Params = effetune::generated::SWRadioSimulatorPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "SW Radio Simulator check failed: %s\n", message);
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
  return {1.0F, 4.5F, 50.0F, 90.0F, 6.0F,  -15.0F, 70.0F, 0.5F, 2.0F, 5.0F,   -35.0F, 1.0F,
          0.0F, 5.0F, 0.0F,  2.0F,  50.0F, -70.0F, 0.0F,  1.0F, 0.0F, 100.0F, 0.0F,   0.0F};
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 96000.0F, std::uint32_t max_channels = 4u) {
    descriptor_ = et_kernel_descriptor_SWRadioSimulatorPlugin();
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

  [[nodiscard]] std::uint32_t latency() const noexcept { return kernel_->latencySamples(); }

  [[nodiscard]] double interfererProgramPower(double frequency) const noexcept {
    return et_sw_debug_interferer_program_power(kernel_, frequency);
  }

  [[nodiscard]] double delayCapacity() const noexcept {
    return et_sw_debug_delay_capacity(kernel_);
  }

  [[nodiscard]] double delayTap(int index) const noexcept {
    return et_sw_debug_delay_tap(kernel_, index);
  }

  [[nodiscard]] double syncPllState() const noexcept { return et_sw_debug_sync_pll_state(kernel_); }

  [[nodiscard]] double syncPllFrequencyHz() const noexcept {
    return et_sw_debug_sync_pll_frequency_hz(kernel_);
  }

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

float telemetryScalar(KernelHarness &harness, std::uint32_t payload_offset) noexcept {
  std::array<std::uint8_t, kTelemetryBytes> frame{};
  check(harness.telemetry(frame, 47u) == kTelemetryFrameBytes,
        "telemetry is available for scalar checks");
  return readF32(frame.data() + 16u + payload_offset);
}

std::uint32_t telemetryCounter(KernelHarness &harness, std::uint32_t payload_offset) noexcept {
  std::array<std::uint8_t, kTelemetryBytes> frame{};
  check(harness.telemetry(frame, 47u) == kTelemetryFrameBytes,
        "telemetry is available for counter checks");
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

constexpr std::uint32_t kDetectorTotalFrames = 8193u;
constexpr std::array<std::uint32_t, 3u> kDetectorEventFrames = {1025u, 4097u, 6145u};

std::vector<float> renderDetectorTransitions(std::uint32_t block_size) {
  constexpr std::uint32_t channels = 2u;
  KernelHarness harness;
  harness.seed(0x5a17c0deu, 0x13572468u);
  Params params = defaultParams();
  harness.stage(params);
  std::vector<float> result(static_cast<std::size_t>(channels) * kDetectorTotalFrames);
  std::uint32_t offset = 0u;
  std::size_t event_index = 0u;
  while (offset < kDetectorTotalFrames) {
    if (event_index < kDetectorEventFrames.size() && offset == kDetectorEventFrames[event_index]) {
      params.detector = event_index == 1u ? 0.0F : 1.0F;
      harness.stage(params);
      ++event_index;
    }
    std::uint32_t frames =
        block_size < kDetectorTotalFrames - offset ? block_size : kDetectorTotalFrames - offset;
    if (event_index < kDetectorEventFrames.size() &&
        offset + frames > kDetectorEventFrames[event_index]) {
      frames = kDetectorEventFrames[event_index] - offset;
    }
    std::vector<float> block = makeSignal(channels, frames, offset);
    harness.process(block, channels, frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::memcpy(result.data() + static_cast<std::size_t>(channel) * kDetectorTotalFrames + offset,
                  block.data() + static_cast<std::size_t>(channel) * frames,
                  static_cast<std::size_t>(frames) * sizeof(float));
    }
    offset += frames;
  }
  return result;
}

struct ColdStart final {
  double seed_db = 0.0;
  double settled_median_db = 0.0;
  double transient_peak = 0.0;
  double settled_peak = 0.0;

  [[nodiscard]] double seedErrorDb() const noexcept { return seed_db - settled_median_db; }
};

// Renders one second from a cold start and reports both the AGC seed error and the output peak
// envelope. The seed is the carrier telemetry after a single frame - exactly one control tick,
// so nothing has had time to move it off the analytic value - and the settled reference is the
// median of the same telemetry over the second half of the render.
ColdStart renderColdStart(const Params &params, double sample_rate) {
  constexpr std::uint32_t channels = 2u;
  const std::uint32_t total_frames = static_cast<std::uint32_t>(sample_rate);
  const std::uint32_t transient_frames = static_cast<std::uint32_t>(sample_rate * 0.1);
  const std::uint32_t settle_frames = static_cast<std::uint32_t>(sample_rate * 0.5);
  KernelHarness harness(static_cast<float>(sample_rate), channels);
  harness.seed(0x51ad1ce0u, 0x0fedcba9u);
  harness.stage(params);
  ColdStart cold;
  std::vector<double> settled_carrier;
  settled_carrier.reserve(static_cast<std::size_t>(total_frames / kMaximumFrames) + 2u);
  std::uint32_t offset = 0u;
  while (offset < total_frames) {
    const std::uint32_t remaining = total_frames - offset;
    const std::uint32_t frames =
        offset == 0u ? 1u : (kMaximumFrames < remaining ? kMaximumFrames : remaining);
    std::vector<float> block = makeSignal(channels, frames, offset);
    harness.process(block, channels, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double magnitude = std::fabs(static_cast<double>(block[frame]));
      const std::uint32_t position = offset + frame;
      if (position < transient_frames) {
        cold.transient_peak = magnitude > cold.transient_peak ? magnitude : cold.transient_peak;
      } else if (position >= settle_frames) {
        cold.settled_peak = magnitude > cold.settled_peak ? magnitude : cold.settled_peak;
      }
    }
    const double carrier = static_cast<double>(telemetryScalar(harness, 0u));
    if (offset == 0u) {
      cold.seed_db = carrier;
    }
    if (offset >= settle_frames) {
      settled_carrier.push_back(carrier);
    }
    offset += frames;
  }
  std::sort(settled_carrier.begin(), settled_carrier.end());
  const std::size_t middle = settled_carrier.size() / 2u;
  cold.settled_median_db = settled_carrier.size() % 2u == 1u
                               ? settled_carrier[middle]
                               : 0.5 * (settled_carrier[middle - 1u] + settled_carrier[middle]);
  return cold;
}

// Reads the fade telemetry after a single frame from a cold start, which is the fading tap seed
// itself: only one control update and one interpolation step have run.
double firstFrameFadeDb(std::uint32_t seed_low, std::uint32_t seed_high) {
  KernelHarness harness(48000.0F, 2u);
  harness.seed(seed_low, seed_high);
  Params params = defaultParams();
  params.skywave = 100.0F;
  harness.stage(params);
  std::vector<float> block = makeSignal(1u, 1u);
  harness.process(block, 1u, 1u);
  return static_cast<double>(telemetryScalar(harness, 12u));
}

// The fading taps are drawn from their stationary distribution rather than left at zero. On a
// pure skywave path a zeroed pair nulls both sky modes, so the fade telemetry would sit exactly
// on its -80 dB floor for every seed; a seeded pair reports a finite depth that moves with the
// seed.
void testFadingTapsAreSeeded() {
  const double first = firstFrameFadeDb(0x51ad1ce0u, 0x0fedcba9u);
  const double second = firstFrameFadeDb(0x2468ace0u, 0x13579bdfu);
  check(first > -79.0, "the seeded fading taps leave the -80 dB fade floor");
  check(second > -79.0, "a second seed also leaves the -80 dB fade floor");
  check(std::fabs(first - second) > 1.0, "the seeded fade depth follows the random seed");
}

// Where a non-fading co-channel interferer sets the level the settled telemetry is the
// stationary RMS to a fraction of a decibel. A 64-seed sweep of the JS reference measured the
// worst |seed error| at 0.34 dB on the skywave corner, 0.54 dB detuned and 2.27 dB on the wide
// corner, so 4 dB is 1.8x the largest measured case.
constexpr double kSeedErrorLimitDb = 4.0;
// On the default settings the fading station sets the level instead. The pre-AGC telemetry is
// an attack/release envelope follower, so its settled reading sits above the stationary RMS the
// seed models and moves with the fading realisation: the same sweep measured the default seed
// error inside [-6.85, +5.43] dB. 10 dB is 1.46x that measured worst case.
constexpr double kFadedSeedErrorLimitDb = 10.0;
// Absolute sanity bound on the cold-start output peak. Full-strength QRM at unity output gain
// settles above full scale on the interfered corners by design, so this only catches a seed that
// opens the receiver by an order of magnitude. The sweep peaked at 1.59 across all four corners,
// so 2.5 is 1.57x the measured worst case.
constexpr double kColdStartPeakLimit = 2.5;

void checkColdStart(const char *name, const ColdStart &cold, double limit_db) {
  const double error_db = cold.seedErrorDb();
  const double magnitude = error_db < 0.0 ? -error_db : error_db;
  if (magnitude >= limit_db) {
    std::fprintf(stderr,
                 "SW Radio Simulator cold-start seed error on %s: %.3f dB (seed %.3f, "
                 "settled median %.3f) against a %.1f dB bound\n",
                 name, error_db, cold.seed_db, cold.settled_median_db, limit_db);
    ++failures;
  }
  if (cold.settled_peak <= 0.05) {
    std::fprintf(stderr, "SW Radio Simulator settled reference on %s is unusable: %.4f\n", name,
                 cold.settled_peak);
    ++failures;
  }
  if (cold.transient_peak >= kColdStartPeakLimit) {
    std::fprintf(stderr, "SW Radio Simulator cold-start peak on %s: %.4f against a %.1f bound\n",
                 name, cold.transient_peak, kColdStartPeakLimit);
    ++failures;
  }
}

// Bounds the error in the AGC cold-start seed. The seed is the analytic stationary RMS of the
// pre-AGC IF magnitude, so the distance between it and the settled telemetry is exactly what
// the AGC still has to walk off once the channel is running, and it is the only cold-start
// quantity this receiver actually controls. The output envelope is not: it is set by the
// zero-state edge the IF, detector and DC blocker produce while their states fill from zero,
// which on the default settings lands at 0.54 ms and reaches 2.4x the settled peak (-7.1 dBFS).
// The AM Radio Simulator produces the same edge from the same mechanism and a larger one
// (0.31 ms, 3.8x the settled peak, -1.3 dBFS), so it is inherited receiver behaviour rather
// than anything this plugin's cold start introduces, and out of scope here.
void testColdStartSeedErrorStaysBounded() {
  // The shipped defaults, so a broken seed cannot hide behind a chosen corner.
  checkColdStart("default", renderColdStart(defaultParams(), 48000.0), kFadedSeedErrorLimitDb);

  // A pure skywave path with full-strength co-channel QRM inside the IF passband. The seeded tap
  // statistics are analytic, so the same bound has to hold at the highest supported rate where
  // the fading filter poles are closest to the unit circle.
  Params skywave = defaultParams();
  skywave.skywave = 100.0F;
  skywave.interference = 0.0F;
  checkColdStart("skywave", renderColdStart(skywave, 48000.0), kSeedErrorLimitDb);
  checkColdStart("skywave 192 kHz", renderColdStart(skywave, 192000.0), kSeedErrorLimitDb);

  // Detuning past a narrow IF pushes the interferer carrier out of the passband while its
  // programme sidebands stay inside, so this corner is the one that separates an interferer
  // modelled as a bare carrier from the modulated station it actually is.
  Params detuned = defaultParams();
  detuned.tuning = 2.5F;
  detuned.ifBandwidth = 2.0F;
  detuned.interference = 0.0F;
  checkColdStart("detuned", renderColdStart(detuned, 48000.0), kSeedErrorLimitDb);

  // The widest IF with the interferer offset all the way out and the wanted station at its
  // floor. The programme sidebands then span a passband across which their density itself
  // varies by ~51 dB at the 48 kHz this corner renders (~40 dB at 96 kHz), so a single sample
  // taken at the offset underestimates the passband average by up to ~20 dB here (~17 dB at
  // 96 kHz): this corner is the one that separates a single-point density sample from the
  // passband average.
  Params wide = defaultParams();
  wide.ifBandwidth = 10.0F;
  wide.interferenceOffset = 10.0F;
  wide.interference = 0.0F;
  wide.signal = -50.0F;
  checkColdStart("wide", renderColdStart(wide, 48000.0), kSeedErrorLimitDb);
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
  constexpr std::uint32_t tap_id = 1818u;
  check(harness.telemetry(frame, tap_id) == kTelemetryFrameBytes,
        "telemetry frame is header plus 24-byte payload");
  check(readU16(frame.data()) == 18u, "telemetry uses the SW Radio Simulator frame type");
  check(readU16(frame.data() + 2u) == 1u, "telemetry uses format version 1");
  check(readU32(frame.data() + 4u) == tap_id, "telemetry preserves the tap id");
  check(readU16(frame.data() + 12u) == 24u, "telemetry payload is exactly 24 bytes");
  for (std::uint32_t offset = 16u; offset < 32u; offset += 4u) {
    check(std::isfinite(readF32(frame.data() + offset)), "telemetry scalar is finite");
  }
  const float carrier = readF32(frame.data() + 16u);
  check(carrier >= -80.0F && carrier <= 6.0F, "telemetry carrier level stays in the clamped range");
  const float fade_db = readF32(frame.data() + 28u);
  check(fade_db >= -80.0F && fade_db <= 6.0F, "telemetry fade depth stays in the clamped range");
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

void testDetectorTransitionDeterminismAndBlockDivision() {
  const std::vector<float> single = renderDetectorTransitions(1u);
  const std::vector<float> odd = renderDetectorTransitions(127u);
  const std::vector<float> replay = renderDetectorTransitions(127u);
  check(single == odd, "detector transitions are independent of block division");
  check(odd == replay, "detector transition state is deterministic for identical input");
  check(finite(single), "detector transitions never produce a non-finite sample");
}

void testDetectorCrossfadeIsContinuous() {
  constexpr std::uint32_t seed_low = 0x0badf00du;
  constexpr std::uint32_t seed_high = 0x31415926u;
  KernelHarness transitioned;
  KernelHarness continuous;
  transitioned.seed(seed_low, seed_high);
  continuous.seed(seed_low, seed_high);
  Params envelope = defaultParams();
  std::vector<float> transitioned_prefix = makeSignal(2u, 79u, 5u);
  std::vector<float> continuous_prefix = transitioned_prefix;
  transitioned.stage(envelope);
  continuous.stage(envelope);
  transitioned.process(transitioned_prefix, 2u, 79u);
  continuous.process(continuous_prefix, 2u, 79u);
  check(transitioned_prefix == continuous_prefix, "detector fixtures begin in sync");

  Params synchronous = envelope;
  synchronous.detector = 1.0F;
  std::vector<float> first_transition_sample = makeSignal(2u, 1u, 84u);
  std::vector<float> continuous_sample = first_transition_sample;
  transitioned.stage(synchronous);
  continuous.stage(envelope);
  transitioned.process(first_transition_sample, 2u, 1u);
  continuous.process(continuous_sample, 2u, 1u);
  check(first_transition_sample == continuous_sample,
        "detector changes begin from the continuous receiver output");

  std::vector<float> transition_tail = makeSignal(2u, 128u, 85u);
  std::vector<float> envelope_tail = transition_tail;
  transitioned.stage(synchronous);
  continuous.stage(envelope);
  transitioned.process(transition_tail, 2u, 128u);
  continuous.process(envelope_tail, 2u, 128u);
  check(transition_tail != envelope_tail,
        "detector crossfade changes the audio without resetting the receiver");
  check(finite(transition_tail), "detector transition remains finite");
}

void testSpeakerTransitionAndMaximumShape() {
  constexpr std::uint32_t seed_low = 0x2718281au;
  constexpr std::uint32_t seed_high = 0x16180339u;
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
  std::vector<float> transition_tail = makeSignal(2u, 128u, 84u);
  std::vector<float> off_tail = transition_tail;
  transitioned.stage(table);
  continuous.stage(off);
  transitioned.process(transition_tail, 2u, 128u);
  continuous.process(off_tail, 2u, 128u);
  check(transition_tail != off_tail,
        "speaker response crossfades without resetting receiver state");
  check(finite(transition_tail), "speaker transition remains finite");

  // Worst-case allocation shape: highest supported rate, widest channel count, and the maximum
  // ionospheric delay spread, which selects the longest tap of the prepared delay line.
  KernelHarness maximum(192000.0F, 8u);
  maximum.seed(1u, 2u);
  std::vector<float> audio = makeSignal(8u, kMaximumFrames);
  const std::vector<float> extra_channels = audio;
  Params maximum_params = defaultParams();
  maximum_params.delaySpread = 8.0F;
  maximum_params.skywave = 100.0F;
  maximum_params.fadingSpeed = 10.0F;
  maximum_params.staticRate = 100.0F;
  maximum_params.interference = 0.0F;
  maximum_params.detector = 1.0F;
  maximum_params.speaker = 2.0F;
  maximum.stage(maximum_params);
  maximum.process(audio, 8u, kMaximumFrames);
  check(finite(audio), "maximum sample-rate and channel shape remains finite");
  for (std::uint32_t channel = 2u; channel < 8u; ++channel) {
    const std::size_t offset = static_cast<std::size_t>(channel) * kMaximumFrames;
    check(std::memcmp(audio.data() + offset, extra_channels.data() + offset,
                      static_cast<std::size_t>(kMaximumFrames) * sizeof(float)) == 0,
          "channels above the first pair remain untouched");
  }
  check(maximum.delayCapacity() == 2212.0,
        "192 kHz prepares the 8 ms worst-case ionospheric delay line");
  check(maximum.delayTap(0) == 672.0, "maximum delay spread places the first sky tap at 3.5 ms");
  check(maximum.delayTap(1) == 2208.0, "maximum delay spread places the second sky tap at 11.5 ms");
  check(maximum.delayTap(1) < maximum.delayCapacity(),
        "the longest tap stays inside the prepared delay line");
}

void testDelayGeometryTracksDelaySpread() {
  KernelHarness minimum(48000.0F, 2u);
  minimum.seed(0x24681357u, 0x8ace0bdfu);
  Params params = defaultParams();
  params.delaySpread = 0.2F;
  minimum.stage(params);
  std::vector<float> audio = makeSignal(2u, 8u);
  minimum.process(audio, 2u, 8u);
  check(minimum.delayTap(0) == 4.0, "minimum delay spread rounds the first tap to 4 samples");
  check(minimum.delayTap(1) == 14.0, "minimum delay spread rounds the second tap to 14 samples");
  check(minimum.delayTap(1) > minimum.delayTap(0),
        "the second sky mode always arrives after the first");
}

void testSyncDetectorLocksToTheCarrier() {
  constexpr double sample_rate = 48000.0;
  Params params = defaultParams();
  params.detector = 1.0F;
  params.preEmphasis = 0.0F;
  params.skywave = 0.0F;
  params.staticRate = 0.0F;
  params.interference = -80.0F;
  params.hum = -80.0F;
  params.speaker = 0.0F;
  params.tuning = 0.25F;
  KernelHarness harness(static_cast<float>(sample_rate), 1u);
  harness.seed(0x0c0ffee0u, 0x5eed1234u);
  harness.stage(params);
  processTone(harness, 0.25, 24000u, 0u, sample_rate);
  check(harness.syncPllState() == 1.0, "the synchronous detector reaches the tracking state");
  const double estimated = harness.syncPllFrequencyHz();
  check(estimated > 240.0 && estimated < 260.0,
        "the recovered carrier frequency matches the tuning offset");

  // Retuning away from a locked station is the only way out of the tracking state, so this is the
  // corner that separates a loop which re-acquires from one that stays narrow-band locked to a
  // carrier it no longer receives. The smoothed carrier estimate has to slew past the 1,040 Hz
  // release corner and stay there for the whole 200 ms outside hold, which measures out at
  // 250-275 ms after the retune; the 500 ms render then leaves more than one further hold period.
  Params retuned = params;
  retuned.tuning = 5.0F;
  harness.stage(retuned);
  processTone(harness, 0.25, 24000u, 24000u, sample_rate);
  check(harness.syncPllState() == 0.0,
        "retuning past the release corner returns the tracking loop to capture");

  Params outside = params;
  outside.tuning = 5.0F;
  KernelHarness far_off(static_cast<float>(sample_rate), 1u);
  far_off.seed(0x0c0ffee0u, 0x5eed1234u);
  far_off.stage(outside);
  processTone(far_off, 0.25, 24000u, 0u, sample_rate);
  check(far_off.syncPllState() == 0.0,
        "a carrier beyond the pull-in range keeps the loop in capture");
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

  Params very_weak = stable;
  very_weak.signal = -50.0F;
  KernelHarness maximum_gain(static_cast<float>(sample_rate), 1u);
  maximum_gain.seed(0x13579bdfu, 0x2468ace0u);
  maximum_gain.stage(very_weak);
  processTone(maximum_gain, 0.0, 1u, 0u, sample_rate);
  check(telemetryScalar(maximum_gain, 4u) == 42.0F,
        "AGC maximum gain matches a practical receiver limit");

  Params weak = stable;
  weak.signal = -30.0F;
  KernelHarness level_change(static_cast<float>(sample_rate), 1u);
  level_change.seed(0xabcdef01u, 0x23456789u);
  level_change.stage(weak);
  processTone(level_change, 0.0, 1u, 0u, sample_rate);
  const float initial_gain = telemetryScalar(level_change, 4u);
  check(initial_gain > 23.5F && initial_gain < 24.5F,
        "AGC initializes from the selected signal level");

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
}

void testStaticAndInterfererModels() {
  constexpr double sample_rate = 48000.0;
  Params params = defaultParams();
  params.staticRate = 50.0F;
  params.skywave = 0.0F;
  params.interference = -80.0F;
  params.hum = -80.0F;
  params.speaker = 0.0F;
  KernelHarness harness(static_cast<float>(sample_rate), 1u);
  harness.seed(0x77777777u, 0x11111111u);
  harness.stage(params);
  processTone(harness, 0.0, 48000u, 0u, sample_rate);
  const std::uint32_t events = telemetryCounter(harness, 16u);
  check(events > 25u && events < 80u, "one second at 50 impulses per second stays Poisson-like");

  Params silent = params;
  silent.staticRate = 0.0F;
  KernelHarness quiet(static_cast<float>(sample_rate), 1u);
  quiet.seed(0x77777777u, 0x11111111u);
  quiet.stage(silent);
  processTone(quiet, 0.0, 4800u, 0u, sample_rate);
  check(telemetryCounter(quiet, 16u) == 0u, "a zero static rate never schedules an impulse");

  KernelHarness spectrum(static_cast<float>(sample_rate), 1u);
  spectrum.seed(0x2468ace0u, 0x13579bdfu);
  spectrum.stage(params);
  processTone(spectrum, 0.0, 128u, 0u, sample_rate);
  const double in_band = spectrum.interfererProgramPower(1000.0);
  const double out_of_band = spectrum.interfererProgramPower(12000.0);
  check(in_band > out_of_band * 100.0,
        "the interferer program noise is band limited to the modelled channel");
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
  harness.seed(2u, 0u);
  harness.stage(slow);
  processTone(harness, 0.0, kSlowFrames, 0u, sample_rate);
  const std::uint32_t before = telemetryCounter(harness, 16u);

  Params raised = slow;
  raised.staticRate = raised_rate;
  harness.stage(raised);
  StaticRateProbe probe;
  probe.first_event_frames = kProbeFrames;
  for (std::uint32_t frames = 0u; frames < kProbeFrames; frames += kProbeBlock) {
    processTone(harness, 0.0, kProbeBlock, kSlowFrames + frames, sample_rate);
    if (probe.first_event_frames == kProbeFrames && telemetryCounter(harness, 16u) > before) {
      probe.first_event_frames = frames + kProbeBlock;
    }
  }
  probe.events = telemetryCounter(harness, 16u) - before;
  return probe;
}

constexpr double kTwoPi = 6.28318530717958647692;

double singleBinAmplitude(const std::vector<float> &samples, std::size_t start, std::size_t length,
                          double sample_rate, double frequency) noexcept {
  double real = 0.0;
  double imaginary = 0.0;
  const double step = kTwoPi * frequency / sample_rate;
  for (std::size_t index = 0u; index < length; ++index) {
    const double angle = step * static_cast<double>(index);
    const double sample = static_cast<double>(samples[start + index]);
    real += sample * std::cos(angle);
    imaginary -= sample * std::sin(angle);
  }
  return 2.0 * std::sqrt(real * real + imaginary * imaginary) / static_cast<double>(length);
}

// Band power across +/-3 one-hertz bins - wide enough to hold a tone smeared by the
// Doppler-spread fading taps while staying far from its mirror.
double bandPower(const std::vector<float> &samples, std::size_t start, std::size_t length,
                 double sample_rate, double frequency) noexcept {
  double power = 0.0;
  for (int bin = -3; bin <= 3; ++bin) {
    const double amplitude =
        singleBinAmplitude(samples, start, length, sample_rate, frequency + bin);
    power += amplitude * amplitude;
  }
  return power;
}

constexpr double kPi = 3.14159265358979323846;
constexpr double kSsbSampleRate = 48000.0;
// Mirrors of the AGC constants in kernel.cpp, which live in the kernel's anonymous namespace.
constexpr double kAmAgcTargetDb = -6.0;
constexpr double kSsbAgcTargetDb = -18.0;
constexpr double kMinimumAgcGainDb = -12.0;
constexpr double kMaximumAgcGainDb = 42.0;
constexpr std::uint32_t kSsbTotalFrames = 76800u;
constexpr std::uint32_t kSsbWindowStart = 28800u;
constexpr std::uint32_t kSsbWindowLength = 48000u;

// Clean SSB reception path: no static, interference at the floor, hum at the floor and the
// speaker voicing off so the spectral bins measure the product-detector output directly.
Params ssbCleanParams(float mode, float tuning, float bfo, float skywave) noexcept {
  Params params = defaultParams();
  params.skywave = skywave;
  params.staticRate = 0.0F;
  params.interference = -80.0F;
  params.hum = -80.0F;
  params.speaker = 0.0F;
  params.mode = mode;
  params.tuning = tuning;
  params.bfoOffset = bfo;
  return params;
}

template <typename Generator>
std::vector<float> renderCapture(KernelHarness &harness, std::uint32_t frames,
                                 Generator &&generator) {
  std::vector<float> output(frames);
  for (std::uint32_t position = 0u; position < frames; position += kMaximumFrames) {
    const std::uint32_t block_frames =
        kMaximumFrames < frames - position ? kMaximumFrames : frames - position;
    std::vector<float> block(block_frames);
    for (std::uint32_t frame = 0u; frame < block_frames; ++frame) {
      block[frame] = generator(position + frame);
    }
    harness.process(block, 1u, block_frames);
    std::memcpy(output.data() + position, block.data(),
                static_cast<std::size_t>(block_frames) * sizeof(float));
  }
  return output;
}

std::vector<float> renderSsbSpectral(const Params &params, double amplitude, double tone_hz) {
  KernelHarness harness(static_cast<float>(kSsbSampleRate), 2u);
  harness.seed(0x55b0ffe0u, 0x1ce0c0deu);
  harness.stage(params);
  const std::vector<float> output =
      renderCapture(harness, kSsbTotalFrames, [amplitude, tone_hz](std::uint32_t frame) {
        return static_cast<float>(
            amplitude * std::sin(kTwoPi * tone_hz * static_cast<double>(frame) / kSsbSampleRate));
      });
  check(finite(output), "SSB spectral render stays finite");
  return output;
}

double ssbBand(const std::vector<float> &samples, double frequency) noexcept {
  return bandPower(samples, kSsbWindowStart, kSsbWindowLength, kSsbSampleRate, frequency);
}

// The Phase 0 frozen sign convention: delta = tn*1000 - bf, USB moves every component up by
// delta and LSB down by delta. With tn=0.5 kHz and bf=200 Hz a 1 kHz tone lands on 1300 Hz in
// USB and on 700 Hz in LSB, and the unwanted sideband sits at least ~50 dB down by design;
// 30 dB is asserted. The sk=0 / sk=100 endpoints validate the complex propagation equation
// rather than sound quality: a ground-only and a skywave-only path must both preserve the
// single-sideband structure.
void testSsbShiftSignAndSidebandSuppression() {
  for (float skywave : {0.0F, 100.0F}) {
    const std::vector<float> usb =
        renderSsbSpectral(ssbCleanParams(1.0F, 0.5F, 200.0F, skywave), 0.25, 1000.0);
    const std::vector<float> lsb =
        renderSsbSpectral(ssbCleanParams(2.0F, 0.5F, 200.0F, skywave), 0.25, 1000.0);
    check(ssbBand(usb, 1300.0) > 1000.0 * ssbBand(usb, 700.0),
          "USB keeps f+delta dominant over the unwanted sideband");
    check(ssbBand(usb, 1300.0) > 1000.0 * ssbBand(usb, 1000.0),
          "USB leaves no component at the untranslated tone");
    check(ssbBand(lsb, 700.0) > 1000.0 * ssbBand(lsb, 1300.0),
          "LSB keeps f-delta dominant over the unwanted sideband");
  }

  // A zero offset (delta = 0) reproduces the programme frequency exactly.
  const std::vector<float> zero =
      renderSsbSpectral(ssbCleanParams(1.0F, 0.0F, 0.0F, 0.0F), 0.25, 1000.0);
  check(ssbBand(zero, 1000.0) > 100.0 * ssbBand(zero, 700.0) &&
            ssbBand(zero, 1000.0) > 100.0 * ssbBand(zero, 1300.0),
        "zero BFO offset and zero tuning leave the tone untranslated");

  // The BFO alone must produce the same delta with the opposite knob sign.
  const std::vector<float> bfo_only =
      renderSsbSpectral(ssbCleanParams(1.0F, 0.0F, -300.0F, 0.0F), 0.25, 1000.0);
  check(ssbBand(bfo_only, 1300.0) > 1000.0 * ssbBand(bfo_only, 700.0),
        "BFO-only detuning shifts USB up by |bf|");
}

// The suppressed carrier would fall on |delta|. Silence leaves only the amplified noise floor
// there, the asymmetric limiter's DC generation is blocked by the transmit low cut, and a
// deterministic simulated-music mix must not re-insert a carrier tone either. The 360 Hz music
// component also probes the residual image below the 100 Hz low-cut corner: its USB image
// lands on 60 Hz while its source stays inside the Hilbert usable band, so the image has to
// stay suppressed by the allpass design.
void testSsbCarrierSuppression() {
  const std::vector<float> silence =
      renderSsbSpectral(ssbCleanParams(1.0F, 0.3F, 0.0F, 0.0F), 0.0, 1000.0);
  const double silence_residual =
      singleBinAmplitude(silence, kSsbWindowStart, kSsbWindowLength, kSsbSampleRate, 300.0);
  check(silence_residual < 0.01, "silent carrier residual stays at the noise floor");

  Params driven_params = ssbCleanParams(1.0F, 0.3F, 0.0F, 0.0F);
  driven_params.compression = 20.0F;
  const std::vector<float> driven = renderSsbSpectral(driven_params, 0.9, 1000.0);
  const double driven_residual =
      singleBinAmplitude(driven, kSsbWindowStart, kSsbWindowLength, kSsbSampleRate, 300.0);
  const double driven_main =
      singleBinAmplitude(driven, kSsbWindowStart, kSsbWindowLength, kSsbSampleRate, 1300.0);
  check(driven_residual < driven_main / 100.0,
        "the limiter-driven asymmetric DC never reappears as a carrier tone");

  KernelHarness music_harness(static_cast<float>(kSsbSampleRate), 2u);
  music_harness.seed(0x0301c0deu, 0x5eedbea7u);
  music_harness.stage(ssbCleanParams(1.0F, 0.3F, 0.0F, 0.0F));
  const std::vector<float> music =
      renderCapture(music_harness, kSsbTotalFrames, [](std::uint32_t frame) {
        const double t = static_cast<double>(frame) / kSsbSampleRate;
        return static_cast<float>(0.3 * std::sin(kTwoPi * 540.0 * t) +
                                  0.18 * std::sin(kTwoPi * 360.0 * t) +
                                  0.1 * std::sin(kTwoPi * 1240.0 * t));
      });
  check(finite(music), "SSB music render stays finite");
  const double music_residual =
      singleBinAmplitude(music, kSsbWindowStart, kSsbWindowLength, kSsbSampleRate, 300.0);
  const double music_main =
      singleBinAmplitude(music, kSsbWindowStart, kSsbWindowLength, kSsbSampleRate, 840.0);
  check(music_residual < music_main / 100.0,
        "simulated music leaves no re-inserted carrier at |delta|");
  check(ssbBand(music, 660.0) > 1000.0 * ssbBand(music, 60.0),
        "the below-corner image of an in-band component stays suppressed");
}

// Poisson inter-arrival times are memoryless, so a pending deadline drawn at the old rate has to
// have its remaining time rescaled when Static Rate changes. Without the rescale the long
// interval drawn at 0.125 impulses per second survives the parameter change and the receiver
// stays silent for seconds after the user asks for 100 impulses per second.
void testStaticRateIncreaseRescalesThePendingDeadline() {
  const StaticRateProbe held = probeStaticRateChange(0.125F);
  check(held.events == 0u, "the low static rate leaves a pending deadline beyond the probe window");

  // Measured 864 frames (18 ms) with the rescale in place; without it the pending interval runs
  // for about thirteen more seconds, so the first event would fall outside the probe window.
  const StaticRateProbe raised = probeStaticRateChange(100.0F);
  check(raised.first_event_frames <= 2400u,
        "raising the static rate rescales the pending deadline instead of waiting it out");
  check(raised.events > 50u && raised.events < 160u,
        "the rescaled schedule settles on the new Poisson rate");
}

constexpr std::uint32_t kModeSwitchTotalFrames = 8193u;
constexpr std::array<std::uint32_t, 4u> kModeSwitchEventFrames = {1025u, 3073u, 5121u, 7169u};

// AM -> USB (with a frozen detector change while in SSB) -> LSB -> AM. The final AM block sees
// the Synchronous selection staged during SSB against the frozen Envelope detector and starts
// the ordinary 20 ms crossfade.
void applyModeSwitchEvent(Params &params, std::size_t event_index) noexcept {
  switch (event_index) {
  case 0u:
    params.mode = 1.0F;
    params.bfoOffset = 250.0F;
    break;
  case 1u:
    params.detector = 1.0F;
    params.detectorRc = 500.0F;
    break;
  case 2u:
    params.mode = 2.0F;
    params.bfoOffset = -400.0F;
    break;
  default:
    params.mode = 0.0F;
    break;
  }
}

std::vector<float> renderModeSwitches(std::uint32_t block_size) {
  constexpr std::uint32_t channels = 2u;
  KernelHarness harness;
  harness.seed(0x51deba9du, 0x0ddba115u);
  Params params = defaultParams();
  harness.stage(params);
  std::vector<float> result(static_cast<std::size_t>(channels) * kModeSwitchTotalFrames);
  std::uint32_t offset = 0u;
  std::size_t event_index = 0u;
  while (offset < kModeSwitchTotalFrames) {
    if (event_index < kModeSwitchEventFrames.size() &&
        offset == kModeSwitchEventFrames[event_index]) {
      applyModeSwitchEvent(params, event_index);
      harness.stage(params);
      ++event_index;
    }
    std::uint32_t frames =
        block_size < kModeSwitchTotalFrames - offset ? block_size : kModeSwitchTotalFrames - offset;
    if (event_index < kModeSwitchEventFrames.size() &&
        offset + frames > kModeSwitchEventFrames[event_index]) {
      frames = kModeSwitchEventFrames[event_index] - offset;
    }
    std::vector<float> block = makeSignal(channels, frames, offset);
    harness.process(block, channels, frames);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      std::memcpy(result.data() + static_cast<std::size_t>(channel) * kModeSwitchTotalFrames +
                      offset,
                  block.data() + static_cast<std::size_t>(channel) * frames,
                  static_cast<std::size_t>(frames) * sizeof(float));
    }
    offset += frames;
  }
  return result;
}

void testModeSwitchDeterminismAndBlockDivision() {
  const std::vector<float> single = renderModeSwitches(1u);
  const std::vector<float> odd = renderModeSwitches(127u);
  const std::vector<float> replay = renderModeSwitches(127u);
  check(single == odd, "receiver mode switches are independent of block division");
  check(odd == replay, "receiver mode switch state is deterministic for identical input");
  check(finite(single), "receiver mode switches never produce a non-finite sample");
}

std::vector<float> renderSeededParams(const Params &params) {
  constexpr std::uint32_t total_frames = 512u;
  constexpr std::uint32_t channels = 2u;
  KernelHarness harness;
  harness.seed(0x0badc0deu, 0x600df00du);
  harness.stage(params);
  std::vector<float> result(static_cast<std::size_t>(channels) * total_frames);
  for (std::uint32_t offset = 0u; offset < total_frames; offset += kMaximumFrames) {
    const std::uint32_t frames =
        kMaximumFrames < total_frames - offset ? kMaximumFrames : total_frames - offset;
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

// Mutual inertness on the identical seed: the BFO offset must not touch a single sample or RNG
// draw while the mode is AM, and the frozen detector selection and RC must be equally inert
// while the mode is SSB (the section 5 freeze rule of the SSB plan).
void testSameSeedInertness() {
  Params am_reference = defaultParams();
  Params am_bfo = am_reference;
  am_bfo.bfoOffset = 1000.0F;
  const std::vector<float> am_output = renderSeededParams(am_reference);
  check(am_output == renderSeededParams(am_bfo), "the BFO offset is inert in AM");

  Params usb_reference = defaultParams();
  usb_reference.mode = 1.0F;
  Params usb_detector = usb_reference;
  usb_detector.detector = 1.0F;
  usb_detector.detectorRc = 500.0F;
  const std::vector<float> usb_output = renderSeededParams(usb_reference);
  check(usb_output == renderSeededParams(usb_detector),
        "the detector selection and RC are frozen and inert in SSB");
  check(usb_output != am_output, "USB reception differs from AM reception");
}

// A cold-started SSB receiver has no carrier to hold the AGC down, so silence opens the gain
// toward its limit while the S meter stays on the noise floor; the programme onset then drives
// both. The -80 dB interference of this configuration leaves the seeded level so low that both
// modes clamp at the +42 dB gain limit, so the mode-specific seed behind that behaviour is
// pinned by testColdStartAgcSeedIsModeSpecific instead of here.
void testSsbColdStartAgcTracksProgramme() {
  KernelHarness harness(static_cast<float>(kSsbSampleRate), 2u);
  harness.seed(0xc01d57a2u, 0x0fedcba9u);
  harness.stage(ssbCleanParams(1.0F, 0.0F, 0.0F, 0.0F));
  processTone(harness, 0.0, 24000u, 0u, kSsbSampleRate);
  const float silent_gain = telemetryScalar(harness, 4u);
  const float silent_s_meter = telemetryScalar(harness, 0u);
  check(silent_gain > 35.0F, "a silent SSB cold start opens the AGC toward its limit");
  check(silent_s_meter < -40.0F, "the suppressed carrier keeps the S meter on the noise floor");
  processTone(harness, 0.25, 48000u, 24000u, kSsbSampleRate);
  const float program_gain = telemetryScalar(harness, 4u);
  const float program_s_meter = telemetryScalar(harness, 0u);
  check(program_gain < silent_gain - 10.0F, "the programme onset pulls the AGC gain down");
  check(program_s_meter > silent_s_meter + 10.0F, "the programme onset raises the S meter");
  // Once the loop has settled on the programme, gain plus detected level is the SSB target
  // itself: this is what pins the constant kSsbAgcTargetDb from outside the kernel.
  const double settled_target_db = static_cast<double>(program_gain + program_s_meter);
  if (std::fabs(settled_target_db - kSsbAgcTargetDb) > 1.0) {
    std::fprintf(stderr, "SW Radio Simulator settled SSB AGC target: %.3f dB against %.1f\n",
                 settled_target_db, kSsbAgcTargetDb);
    ++failures;
  }
}

// The AGC gain and the S meter of the very first telemetry frame, which still carry the cold
// start seed: the seed sets the gain to the mode's own target minus the pre-AGC carrier level it
// predicts, and the first control update finds the detector already sitting on that prediction,
// so the two still sum to the target exactly. Interference stays at its default -35 dB - the
// -80 dB floor the spectral cases use pushes the prediction so far down that every mode clamps
// at the +42 dB gain limit, which erases the target the seed used.
struct ColdStartSeed final {
  double gain_db;
  double carrier_db;
};

ColdStartSeed coldStartSeed(float mode) {
  KernelHarness harness(static_cast<float>(kSsbSampleRate), 2u);
  harness.seed(0x0c01d5eeu, 0x0fedcba9u);
  Params params = defaultParams();
  params.mode = mode;
  harness.stage(params);
  processTone(harness, 0.0, 1u, 0u, kSsbSampleRate);
  return {static_cast<double>(telemetryScalar(harness, 4u)),
          static_cast<double>(telemetryScalar(harness, 0u))};
}

void checkColdStartSeedTarget(const char *name, const ColdStartSeed &seed, double target_db) {
  // Both gain limits are kept a decibel away: a clamped seed reports a target it never used.
  check(seed.gain_db > kMinimumAgcGainDb + 1.0 && seed.gain_db < kMaximumAgcGainDb - 1.0,
        "the cold start seed stays clear of the AGC gain limits");
  // Measured -18.000 dB for both sidebands and -6.000 dB for AM; the tolerance covers the
  // float32 telemetry quantisation of two levels around 35 dB, not a loop transient.
  if (std::fabs(seed.gain_db + seed.carrier_db - target_db) > 0.05) {
    std::fprintf(stderr, "SW Radio Simulator %s cold start seed: %.4f + %.4f against %.1f dB\n",
                 name, seed.gain_db, seed.carrier_db, target_db);
    ++failures;
  }
}

void testColdStartAgcSeedIsModeSpecific() {
  const ColdStartSeed am = coldStartSeed(0.0F);
  const ColdStartSeed usb = coldStartSeed(1.0F);
  const ColdStartSeed lsb = coldStartSeed(2.0F);
  checkColdStartSeedTarget("AM", am, kAmAgcTargetDb);
  checkColdStartSeedTarget("USB", usb, kSsbAgcTargetDb);
  checkColdStartSeedTarget("LSB", lsb, kSsbAgcTargetDb);
  // The suppressed carrier is left out of the SSB prediction, so what the seed expects there is
  // the co-channel interferer and the in-band noise alone: measured 19.8 dB below the AM level.
  check(usb.carrier_db < am.carrier_db - 12.0,
        "the SSB cold start seed omits the suppressed station carrier");
  check(usb.gain_db == lsb.gain_db && usb.carrier_db == lsb.carrier_db,
        "both sidebands seed the AGC identically");
}

// One cold start onset followed by a decay, sampled from the AGC gain telemetry. The seed is
// independent of AGC Speed, so the three settings enter the onset from the same gain and the
// first five milliseconds isolate the attack; the silence that follows isolates the release.
struct SsbAgcSpeedProbe final {
  double seed_db;
  double onset_db;
  double driven_db;
  double recovered_db;
};

constexpr std::uint32_t kSsbOnsetFrames = 240u;     // 5 ms
constexpr std::uint32_t kSsbDrivenFrames = 48000u;  // 1 s
constexpr std::uint32_t kSsbSilenceFrames = 48000u; // 1 s

SsbAgcSpeedProbe probeSsbAgcSpeed(float agc_speed) {
  KernelHarness harness(static_cast<float>(kSsbSampleRate), 2u);
  harness.seed(0x0a9c5eedu, 0x0fedcba9u);
  Params params = defaultParams();
  params.mode = 1.0F;
  params.agcSpeed = agc_speed;
  harness.stage(params);
  processTone(harness, 0.8, 1u, 0u, kSsbSampleRate);
  const double seed_db = static_cast<double>(telemetryScalar(harness, 4u));
  processTone(harness, 0.8, kSsbOnsetFrames - 1u, 1u, kSsbSampleRate);
  const double onset_db = static_cast<double>(telemetryScalar(harness, 4u));
  processTone(harness, 0.8, kSsbDrivenFrames - kSsbOnsetFrames, kSsbOnsetFrames, kSsbSampleRate);
  const double driven_db = static_cast<double>(telemetryScalar(harness, 4u));
  processTone(harness, 0.0, kSsbSilenceFrames, kSsbDrivenFrames, kSsbSampleRate);
  const double recovered_db = static_cast<double>(telemetryScalar(harness, 4u));
  return {seed_db, onset_db, driven_db, recovered_db};
}

// AGC Speed after the same two seconds of settling, stepped by an 18 dB rise of Signal and read
// 400 ms later. A cold start cannot show the AM attack - the AM seed already matches the carrier
// there, so nothing attacks - and each setting is measured against its own settled gain because
// the three drift apart while they settle.
constexpr std::uint32_t kAmSettleFrames = 96000u; // 2 s
constexpr std::uint32_t kAmStepFrames = 19200u;   // 400 ms

double amAgcStepAttackDb(float agc_speed) {
  KernelHarness harness(static_cast<float>(kSsbSampleRate), 2u);
  harness.seed(0x0a9c5eedu, 0x0fedcba9u);
  Params params = defaultParams();
  params.agcSpeed = agc_speed;
  params.signal = -30.0F;
  harness.stage(params);
  processTone(harness, 0.8, kAmSettleFrames, 0u, kSsbSampleRate);
  const double settled_db = static_cast<double>(telemetryScalar(harness, 4u));
  params.signal = -12.0F;
  harness.stage(params);
  processTone(harness, 0.8, kAmStepFrames, kAmSettleFrames, kSsbSampleRate);
  return static_cast<double>(telemetryScalar(harness, 4u)) - settled_db;
}

// A communications receiver fixes its SSB attack in the 1-10 ms range and wires the operator's
// AGC Speed to the release alone, so Slow, Mid and Fast have to reach the SSB release and only
// the release. The AM half of the test is what keeps the SSB half honest: the same telemetry
// field, the same three settings and the same harness separate the AM attack by decibels, so an
// SSB attack that agrees to a thousandth of a decibel is a property of the loop rather than of a
// probe that cannot see AGC Speed at all.
void testAgcSpeedReachesTheAttackInAmOnly() {
  const SsbAgcSpeedProbe slow = probeSsbAgcSpeed(0.0F);
  const SsbAgcSpeedProbe mid = probeSsbAgcSpeed(1.0F);
  const SsbAgcSpeedProbe fast = probeSsbAgcSpeed(2.0F);
  // The onset really is an attack: five milliseconds of programme pull the gain 6.9 dB below the
  // seed it started from, so the sample below is taken while the attack path owns the loop.
  check(slow.onset_db < slow.seed_db - 4.0 && mid.onset_db < mid.seed_db - 4.0 &&
            fast.onset_db < fast.seed_db - 4.0,
        "the SSB programme onset drives the AGC into attack within five milliseconds");
  const double onset_low = std::min(slow.onset_db, std::min(mid.onset_db, fast.onset_db));
  const double onset_high = std::max(slow.onset_db, std::max(mid.onset_db, fast.onset_db));
  // Measured 9.85247, 9.85252 and 9.85261 dB - a spread of 0.0001 dB, which is the residue of
  // the speed-dependent detector release riding out the tone's own envelope ripple. Restoring
  // the AM attack times to SSB leaves the gain within 0.07 dB of the seed instead, so the check
  // above fires first and this spread widens to 0.064 dB.
  if (onset_high - onset_low > 0.01) {
    std::fprintf(stderr, "SW Radio Simulator SSB onset gain by AGC Speed: %.5f %.5f %.5f dB\n",
                 slow.onset_db, mid.onset_db, fast.onset_db);
    ++failures;
  }
  // The release is the half AGC Speed does own: one second of silence recovers 0.56 dB on Slow,
  // 1.83 dB on Mid and 4.93 dB on Fast, each measured from its own driven gain.
  const double slow_recovery = slow.recovered_db - slow.driven_db;
  const double mid_recovery = mid.recovered_db - mid.driven_db;
  const double fast_recovery = fast.recovered_db - fast.driven_db;
  check(slow_recovery < mid_recovery && mid_recovery < fast_recovery,
        "AGC Speed still orders the SSB release");
  check(fast_recovery > slow_recovery + 2.0, "AGC Speed separates the SSB release by decibels");

  // AM keeps the attack the operator asked for: measured -2.4 dB on Slow, -10.0 dB on Mid and
  // -14.4 dB on Fast, 400 ms after the same step.
  const double slow_attack = amAgcStepAttackDb(0.0F);
  const double mid_attack = amAgcStepAttackDb(1.0F);
  const double fast_attack = amAgcStepAttackDb(2.0F);
  check(slow_attack > mid_attack && mid_attack > fast_attack, "AGC Speed orders the AM attack");
  check(slow_attack - fast_attack > 5.0,
        "AGC Speed separates the AM attack by decibels, not by thousandths");
}

// Syllabic programme with the crest factor of real voice: a formant-weighted harmonic stack
// gated 250 ms on / 150 ms off, which is the shape that made the pre-fix AGC park the smoothed
// envelope at the AM target and push the instantaneous waveform far past full scale.
std::vector<float> makeSyllabicProgramme(std::uint32_t channels, std::uint32_t frames,
                                         std::uint32_t offset, double sample_rate) {
  std::vector<float> audio(static_cast<std::size_t>(channels) * frames, 0.0F);
  constexpr double period = 0.4;
  constexpr double on = 0.25;
  constexpr double edge = 0.01;
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double t = static_cast<double>(offset + frame) / sample_rate;
    const double phase = t - std::floor(t / period) * period;
    double gate = 0.0;
    if (phase < on) {
      if (phase < edge) {
        gate = 0.5 - 0.5 * std::cos(kPi * phase / edge);
      } else if (phase > on - edge) {
        gate = 0.5 - 0.5 * std::cos(kPi * (on - phase) / edge);
      } else {
        gate = 1.0;
      }
    }
    if (gate == 0.0) {
      continue;
    }
    double value = 0.0;
    for (int harmonic = 1; harmonic <= 12; ++harmonic) {
      const double frequency = 130.0 * static_cast<double>(harmonic);
      const double weight = 1.0 / static_cast<double>(harmonic);
      value += weight * std::sin(kTwoPi * frequency * t);
    }
    const float sample = static_cast<float>(0.28 * gate * value);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      audio[static_cast<std::size_t>(channel) * frames + frame] = sample;
    }
  }
  return audio;
}

// The receiver must not hand the host a sample above full scale once its AGC has settled, in
// either sideband and at every AGC speed. The first second is skipped: a cold start has no
// programme to hold the loop down, so the gain is wide open when the first syllable arrives and
// a real receiver thumps there too - that transient is bounded by the physics of the loop, not
// by a limiter, and this plugin deliberately has none.
void testSsbOutputStaysBelowFullScale() {
  constexpr std::uint32_t channels = 2u;
  constexpr double settle_seconds = 1.0;
  constexpr double total_seconds = 3.0;
  const auto settle_frames = static_cast<std::uint32_t>(kSsbSampleRate * settle_seconds);
  const auto total_frames = static_cast<std::uint32_t>(kSsbSampleRate * total_seconds);
  for (float mode = 0.0F; mode <= 2.0F; mode += 1.0F) {
    for (float agc_speed = 0.0F; agc_speed <= 2.0F; agc_speed += 1.0F) {
      KernelHarness harness(static_cast<float>(kSsbSampleRate), channels);
      harness.seed(0x0dbf5000u, 0x0fedcba9u);
      Params params = defaultParams();
      params.mode = mode;
      params.agcSpeed = agc_speed;
      harness.stage(params);
      double peak = 0.0;
      for (std::uint32_t offset = 0u; offset < total_frames; offset += kMaximumFrames) {
        const std::uint32_t remaining = total_frames - offset;
        const std::uint32_t frames = kMaximumFrames < remaining ? kMaximumFrames : remaining;
        std::vector<float> block = makeSyllabicProgramme(channels, frames, offset, kSsbSampleRate);
        harness.process(block, channels, frames);
        check(finite(block), "settled SSB output stays finite");
        if (offset < settle_frames) {
          continue;
        }
        for (std::uint32_t frame = 0u; frame < frames * channels; ++frame) {
          const double magnitude = std::fabs(static_cast<double>(block[frame]));
          peak = magnitude > peak ? magnitude : peak;
        }
      }
      if (peak >= 1.0) {
        std::fprintf(stderr, "SW Radio Simulator settled peak at mode %.0f speed %.0f: %.4f\n",
                     static_cast<double>(mode), static_cast<double>(agc_speed), peak);
        ++failures;
      }
    }
  }
}

// Worst-case SSB allocation shape: highest supported rate, widest channel count, the longest
// ionospheric delay and full-range Mode/BFO endpoints. Every process call runs under the
// allocation guard, and switching modes afterwards must not allocate either because the SSB
// capacity was prepared up front for every mode.
void testSsbMaximumShapeAndModeSwitchesNeverAllocate() {
  KernelHarness maximum(192000.0F, 8u);
  maximum.seed(3u, 4u);
  Params params = defaultParams();
  params.delaySpread = 8.0F;
  params.skywave = 100.0F;
  params.fadingSpeed = 10.0F;
  params.staticRate = 100.0F;
  params.interference = 0.0F;
  params.speaker = 2.0F;
  params.ifBandwidth = 10.0F;
  params.tuning = 5.0F;
  params.mode = 1.0F;
  params.bfoOffset = -1000.0F;
  std::vector<float> audio = makeSignal(8u, kMaximumFrames);
  const std::vector<float> extra_channels = audio;
  maximum.stage(params);
  maximum.process(audio, 8u, kMaximumFrames);
  check(finite(audio), "the SSB maximum shape remains finite");
  for (std::uint32_t channel = 2u; channel < 8u; ++channel) {
    const std::size_t offset = static_cast<std::size_t>(channel) * kMaximumFrames;
    check(std::memcmp(audio.data() + offset, extra_channels.data() + offset,
                      static_cast<std::size_t>(kMaximumFrames) * sizeof(float)) == 0,
          "channels above the first pair remain untouched in SSB");
  }
  for (float mode : {2.0F, 0.0F, 1.0F}) {
    params.mode = mode;
    maximum.stage(params);
    std::vector<float> block = makeSignal(8u, kMaximumFrames, 64u);
    maximum.process(block, 8u, kMaximumFrames);
    check(finite(block), "mode switches at the maximum shape remain finite");
  }
}

} // namespace

int main() {
  testRoutingAndTelemetry();
  testDeterminismAndBlockDivision();
  testDetectorTransitionDeterminismAndBlockDivision();
  testDetectorCrossfadeIsContinuous();
  testSpeakerTransitionAndMaximumShape();
  testDelayGeometryTracksDelaySpread();
  testSyncDetectorLocksToTheCarrier();
  testAgcCarrierTracking();
  testStaticAndInterfererModels();
  testStaticRateIncreaseRescalesThePendingDeadline();
  testFadingTapsAreSeeded();
  testColdStartSeedErrorStaysBounded();
  testSsbShiftSignAndSidebandSuppression();
  testSsbCarrierSuppression();
  testModeSwitchDeterminismAndBlockDivision();
  testSameSeedInertness();
  testSsbColdStartAgcTracksProgramme();
  testColdStartAgcSeedIsModeSpecific();
  testAgcSpeedReachesTheAttackInAmOnly();
  testSsbOutputStaysBelowFullScale();
  testSsbMaximumShapeAndModeSwitchesNeverAllocate();
  return failures == 0 ? 0 : 1;
}
