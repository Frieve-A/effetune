// FM Radio Simulator native lifecycle and broadcast-quality regression tests.
// Covers the plan's section 11 numeric goldens (stereo separation, THD,
// frequency response, and the bounded-output consequence of the MPX peak
// controller guarantee max|m| <= 0.99) plus allocation-guarded processing,
// latency reporting with dry-path alignment, seed/reset reproducibility, and
// corner-parameter torture stability.
#include "FMRadioSimulatorPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"
#include "effetune/telemetry.h"
#include "peak_controller.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <utility>
#include <vector>

extern "C" const effetune::KernelDescriptor *et_kernel_descriptor_FMRadioSimulatorPlugin() noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 128u;
constexpr std::size_t kKernelStorageBytes = 8192u;
constexpr double kTwoPi = 6.283185307179586476925286766559;
using Params = effetune::generated::FMRadioSimulatorPluginParams;
using effetune::plugins::lofi::PeakController;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "FM Radio Simulator check failed: %s\n", message);
    ++failures;
  }
}

// Schema defaults (params.json): Processing defaults to 0 dB so enabling the
// effect with defaults stays loudness-neutral.
Params defaultParams() noexcept {
  return {0.0F, 0.0F, 60.0F, 0.0F, 230.0F, 0.0F, 5.0F, 0.0F, 0.0F, 0.0F, 100.0F};
}

class KernelHarness final {
public:
  explicit KernelHarness(float sample_rate = 96000.0F, std::uint32_t max_channels = 4u) {
    descriptor_ = et_kernel_descriptor_FMRadioSimulatorPlugin();
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
      check(kernel_->preparedSuccessfully(), "kernel prepares at a plan rate");
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
        kernel_->stageParameters(&params.emphasis, Params::kFloatCount, Params::kHash);
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

  // Emits one telemetry frame and returns the cumulative click counter from
  // the type 16 / v1 payload (u32 at payload offset 20). This is the direct
  // test observation point for the FM threshold click behavior.
  std::uint32_t telemetryClickCount() noexcept {
    std::array<std::uint8_t, 1024u> storage{};
    effetune::TelemetryRing ring;
    ring.adopt(storage.data(), static_cast<std::uint32_t>(storage.size()));
    std::uint32_t sequence = 0u;
    effetune::TelemetryWriter writer(ring, 0u, sequence);
    kernel_->writeTelemetry(writer);
    std::array<std::uint8_t, 1024u> output{};
    std::uint32_t dropped = 0u;
    const std::uint32_t bytes =
        ring.read(output.data(), static_cast<std::uint32_t>(output.size()), &dropped);
    check(dropped == 0u, "telemetry ring drops nothing");
    check(bytes == 232u, "telemetry frame is 16-byte header + 216-byte payload");
    std::uint32_t clicks = 0u;
    if (bytes >= 40u) {
      std::memcpy(&clicks, output.data() + 16u + 20u, sizeof(clicks));
    }
    return clicks;
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

// Runs a stereo sine drive through the receiver and correlates both output
// channels against probe frequencies over the trailing analysis region.
struct ToneAnalysis final {
  double leftMagnitude;
  double rightMagnitude;
};

ToneAnalysis analyzeTone(KernelHarness &harness, const Params &params, double sample_rate,
                         double frequency, double left_amplitude, double right_amplitude,
                         std::uint32_t total_frames, std::uint32_t analysis_start,
                         double probe_frequency) {
  harness.stage(params);
  double left_real = 0.0;
  double left_imaginary = 0.0;
  double right_real = 0.0;
  double right_imaginary = 0.0;
  std::uint32_t analyzed = 0u;
  for (std::uint32_t offset = 0u; offset < total_frames;) {
    const std::uint32_t remaining = total_frames - offset;
    const std::uint32_t frames = remaining < kMaximumFrames ? remaining : kMaximumFrames;
    std::vector<float> audio(2u * frames, 0.0F);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double phase = kTwoPi * frequency * static_cast<double>(offset + frame) / sample_rate;
      audio[frame] = static_cast<float>(left_amplitude * std::sin(phase));
      audio[frames + frame] = static_cast<float>(right_amplitude * std::sin(phase));
    }
    harness.process(audio, 2u, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const std::uint32_t absolute_frame = offset + frame;
      if (absolute_frame < analysis_start) {
        continue;
      }
      const double phase =
          kTwoPi * probe_frequency * static_cast<double>(absolute_frame) / sample_rate;
      const double cosine = std::cos(phase);
      const double sine = std::sin(phase);
      left_real += static_cast<double>(audio[frame]) * cosine;
      left_imaginary -= static_cast<double>(audio[frame]) * sine;
      right_real += static_cast<double>(audio[frames + frame]) * cosine;
      right_imaginary -= static_cast<double>(audio[frames + frame]) * sine;
      ++analyzed;
    }
    offset += frames;
  }
  const double scale = analyzed > 0u ? 2.0 / static_cast<double>(analyzed) : 0.0;
  return {
      scale * std::sqrt(left_real * left_real + left_imaginary * left_imaginary),
      scale * std::sqrt(right_real * right_real + right_imaginary * right_imaginary),
  };
}

void testLatencyReportAndDryAlignment() {
  const std::array<std::pair<float, const char *>, 3u> rates = {{
      {48000.0F, "48 kHz"},
      {96000.0F, "96 kHz"},
      {192000.0F, "192 kHz"},
  }};
  for (const auto &[sample_rate, label] : rates) {
    KernelHarness harness(sample_rate, 2u);
    const std::uint32_t latency = harness.latency();
    check(latency > 0u && latency < static_cast<std::uint32_t>(sample_rate / 100.0F),
          "reported latency is positive and below 10 ms");
    Params dry = defaultParams();
    dry.mix = 0.0F;
    harness.stage(dry);
    bool aligned = false;
    bool leading_clean = true;
    std::uint32_t absolute = 0u;
    for (std::uint32_t block = 0u; block < 8u && !aligned; ++block) {
      std::vector<float> audio(2u * kMaximumFrames, 0.0F);
      if (block == 0u) {
        audio[0] = 1.0F;
        audio[kMaximumFrames] = -1.0F;
      }
      harness.process(audio, 2u, kMaximumFrames);
      for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame, ++absolute) {
        if (absolute < latency) {
          if (audio[frame] != 0.0F || audio[kMaximumFrames + frame] != 0.0F) {
            leading_clean = false;
          }
        } else if (absolute == latency) {
          aligned = audio[frame] == 1.0F && audio[kMaximumFrames + frame] == -1.0F;
        }
      }
    }
    std::printf("measured latency at %s: %u samples\n", label, latency);
    if (!aligned || !leading_clean) {
      std::fprintf(stderr, "dry alignment failed at %s (latency %u)\n", label, latency);
    }
    check(leading_clean, "dry path is silent before the reported latency");
    check(aligned, "dry impulse emerges exactly at the reported latency");
  }
}

void testPairModeLeavesExtraChannelsUntouched() {
  KernelHarness harness(96000.0F, 4u);
  harness.seed(0x13579bdfu, 0x2468ace0u);
  std::vector<float> audio = signal(4u, kMaximumFrames, 17u);
  const std::vector<float> original = audio;
  harness.stage(defaultParams());
  harness.process(audio, 4u, kMaximumFrames);
  bool untouched = true;
  for (std::uint32_t index = 2u * kMaximumFrames; index < 4u * kMaximumFrames; ++index) {
    if (audio[index] != original[index]) {
      untouched = false;
      break;
    }
  }
  check(untouched, "channels above the first pair remain untouched");
  check(finite(audio), "pair-mode output remains finite");

  KernelHarness mono(48000.0F, 1u);
  mono.seed(0x13579bdfu, 0x2468ace0u);
  std::vector<float> single = signal(1u, kMaximumFrames, 3u);
  mono.stage(defaultParams());
  mono.process(single, 1u, kMaximumFrames);
  check(finite(single), "mono input processes finite output");
}

// reset() alone must restore the complete initial deterministic state,
// including re-seeding the noise RNG from the stored seed. No compensating
// setRandomSeed() call is allowed here, so an RNG reset regression cannot
// hide behind an explicit reseed.
void testResetOnlyReproducibility() {
  constexpr std::uint32_t seed_low = 0x0badc0deu;
  constexpr std::uint32_t seed_high = 0x1234abcdu;
  const Params params = defaultParams();
  KernelHarness harness;
  harness.seed(seed_low, seed_high);
  const std::vector<float> first = renderSequence(harness, params);
  harness.reset();
  const std::vector<float> replay = renderSequence(harness, params);
  check(first == replay, "reset() alone reproduces the noise and receiver state");
  check(finite(first), "seeded output remains finite");
}

// Explicit reseed scenarios, separated from the reset-only contract: the same
// seed reproduces the stream after reset(), and a different seed diverges.
void testExplicitReseedReproducibility() {
  constexpr std::uint32_t seed_low = 0x0badc0deu;
  constexpr std::uint32_t seed_high = 0x1234abcdu;
  const Params params = defaultParams();
  KernelHarness harness;
  harness.seed(seed_low, seed_high);
  const std::vector<float> first = renderSequence(harness, params);
  harness.reset();
  harness.seed(seed_low, seed_high);
  const std::vector<float> replay = renderSequence(harness, params);
  check(first == replay, "reset plus the same explicit seed reproduces the stream");

  KernelHarness other;
  other.seed(seed_low ^ 0xffffffffu, seed_high);
  const std::vector<float> different = renderSequence(other, params);
  check(first != different, "a different seed produces a different noise stream");
}

// Section 11 golden: stereo separation >= 45 dB at 1 kHz with representative
// modulation (-10 dBFS drive, Processing 0 dB) in clean strong-field
// conditions (plan sections 10 / 15.10.2).
void testStereoSeparationGolden() {
  constexpr double sample_rate = 48000.0;
  constexpr std::uint32_t total_frames = 72000u;
  constexpr std::uint32_t analysis_start = 24000u;
  KernelHarness harness(48000.0F, 2u);
  harness.seed(0x5152f00du, 0x00c0ffeeu);
  Params params = defaultParams();
  params.processing = 0.0F;
  const ToneAnalysis tone = analyzeTone(harness, params, sample_rate, 1000.0, 0.31622776601683794,
                                        0.0, total_frames, analysis_start, 1000.0);
  const double separation_db =
      20.0 * std::log10(tone.leftMagnitude / (tone.rightMagnitude + 1.0e-12));
  std::printf("measured stereo separation: %.2f dB (gate >= 45 dB)\n", separation_db);
  check(tone.leftMagnitude > 0.05, "separation probe produces a driven channel");
  check(separation_db >= 45.0,
        "stereo separation at 1 kHz representative modulation stays >= 45 dB");
}

// THD at 1 kHz (harmonics 2..5) for an L=R sine drive at 48 kHz. Shared by
// the section 11 THD golden and the multipath distortion regression.
double measureThd1k(const Params &params, double amplitude, std::uint32_t seed_low,
                    std::uint32_t seed_high, double *fundamental_out) {
  constexpr double sample_rate = 48000.0;
  constexpr std::uint32_t total_frames = 72000u;
  constexpr std::uint32_t analysis_start = 24000u;
  KernelHarness harness(48000.0F, 2u);
  harness.seed(seed_low, seed_high);
  harness.stage(params);

  double harmonic_power = 0.0;
  std::array<double, 5u> real{};
  std::array<double, 5u> imaginary{};
  std::uint32_t analyzed = 0u;
  for (std::uint32_t offset = 0u; offset < total_frames;) {
    const std::uint32_t remaining = total_frames - offset;
    const std::uint32_t frames = remaining < kMaximumFrames ? remaining : kMaximumFrames;
    std::vector<float> audio(2u * frames, 0.0F);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double phase = kTwoPi * 1000.0 * static_cast<double>(offset + frame) / sample_rate;
      const float sample = static_cast<float>(amplitude * std::sin(phase));
      audio[frame] = sample;
      audio[frames + frame] = sample;
    }
    harness.process(audio, 2u, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const std::uint32_t absolute_frame = offset + frame;
      if (absolute_frame < analysis_start) {
        continue;
      }
      for (std::uint32_t order = 0u; order < real.size(); ++order) {
        const double phase = kTwoPi * 1000.0 * static_cast<double>(order + 1u) *
                             static_cast<double>(absolute_frame) / sample_rate;
        real[order] += static_cast<double>(audio[frame]) * std::cos(phase);
        imaginary[order] -= static_cast<double>(audio[frame]) * std::sin(phase);
      }
      ++analyzed;
    }
    offset += frames;
  }
  const double scale = 2.0 / static_cast<double>(analyzed);
  const double fundamental = scale * std::sqrt(real[0] * real[0] + imaginary[0] * imaginary[0]);
  for (std::uint32_t order = 1u; order < real.size(); ++order) {
    const double magnitude =
        scale * std::sqrt(real[order] * real[order] + imaginary[order] * imaginary[order]);
    harmonic_power += magnitude * magnitude;
  }
  if (fundamental_out != nullptr) {
    *fundamental_out = fundamental;
  }
  return std::sqrt(harmonic_power) / (fundamental + 1.0e-12);
}

// Section 11 golden: THD <= 0.3 % at 1 kHz, 100 % modulation (0 dBFS L=R,
// Processing 0 dB).
void testThdGolden() {
  Params params = defaultParams();
  params.processing = 0.0F;
  double fundamental = 0.0;
  const double thd = measureThd1k(params, 1.0, 0x00facadeu, 0x0defacedu, &fundamental);
  std::printf("measured THD at 1 kHz / 100 %% modulation: %.4f %% (gate <= 0.3 %%)\n", thd * 100.0);
  check(fundamental > 0.5, "THD probe produces a strong fundamental");
  check(thd <= 0.003, "THD at 1 kHz / 100 % modulation stays <= 0.3 %");
}

// Section 11 physical regression: static two-ray multipath raises THD well
// above the clean-path THD at the same representative drive (-10 dBFS).
void testMultipathThdRise() {
  Params clean = defaultParams();
  clean.processing = 0.0F;
  Params multipath = clean;
  multipath.multipath = 100.0F;
  multipath.pathDelay = 7.3F;
  const double amplitude = 0.31622776601683794;
  const double thd_clean = measureThd1k(clean, amplitude, 0x0badf00du, 0x0ddba115u, nullptr);
  const double thd_multipath =
      measureThd1k(multipath, amplitude, 0x0badf00du, 0x0ddba115u, nullptr);
  std::printf("measured multipath THD: clean %.4f %% -> mp=100 %.4f %%\n", thd_clean * 100.0,
              thd_multipath * 100.0);
  check(thd_clean < 0.01, "clean-path THD stays small at -10 dBFS");
  check(thd_multipath > 5.0 * thd_clean,
        "two-ray multipath raises THD by more than 5x over the clean path");
}

// Section 11 golden: frequency response within +/- 0.5 dB relative to 1 kHz
// across the broadcast band (probes at 100 Hz and 10 kHz).
void testFrequencyResponseGolden() {
  constexpr double sample_rate = 48000.0;
  constexpr std::uint32_t total_frames = 72000u;
  constexpr std::uint32_t analysis_start = 24000u;
  constexpr double amplitude = 0.31622776601683794;
  const std::array<double, 3u> frequencies = {100.0, 1000.0, 10000.0};
  std::array<double, 3u> magnitudes{};
  for (std::size_t index = 0u; index < frequencies.size(); ++index) {
    KernelHarness harness(48000.0F, 2u);
    harness.seed(0x600df00du, 0x0b105f00u);
    Params params = defaultParams();
    params.processing = 0.0F;
    const ToneAnalysis tone =
        analyzeTone(harness, params, sample_rate, frequencies[index], amplitude, amplitude,
                    total_frames, analysis_start, frequencies[index]);
    magnitudes[index] = tone.leftMagnitude;
  }
  check(magnitudes[1] > 0.05, "response probe produces a measurable 1 kHz tone");
  for (std::size_t index = 0u; index < frequencies.size(); ++index) {
    const double relative_db = 20.0 * std::log10(magnitudes[index] / magnitudes[1]);
    std::printf("measured response %.0f Hz: %+.3f dB re 1 kHz (gate +/- 0.5 dB)\n",
                frequencies[index], relative_db);
    check(relative_db >= -0.5 && relative_db <= 0.5,
          "frequency response stays within +/- 0.5 dB of 1 kHz");
  }
}

// A real receiver's audio output is AC-coupled. A sustained input offset and
// the discriminator's detuning offset must therefore settle back to zero
// without sacrificing the specified 30 Hz lower band edge.
void testDcCut() {
  auto settledMean = [](float input, float tuning) -> double {
    constexpr float sample_rate = 48000.0F;
    constexpr std::uint32_t total_frames = 96000u;
    constexpr std::uint32_t analysis_start = 48000u;
    KernelHarness harness(sample_rate, 2u);
    harness.seed(0x0dc0ffeeu, 0x5eed1234u);
    Params params = defaultParams();
    params.processing = 0.0F;
    params.tuning = tuning;
    harness.stage(params);
    double sum = 0.0;
    std::uint32_t count = 0u;
    for (std::uint32_t offset = 0u; offset < total_frames;) {
      const std::uint32_t remaining = total_frames - offset;
      const std::uint32_t frames = remaining < kMaximumFrames ? remaining : kMaximumFrames;
      std::vector<float> audio(2u * frames, input);
      harness.process(audio, 2u, frames);
      if (offset + frames > analysis_start) {
        const std::uint32_t first = offset < analysis_start ? analysis_start - offset : 0u;
        for (std::uint32_t frame = first; frame < frames; ++frame) {
          sum += static_cast<double>(audio[frame]);
          ++count;
        }
      }
      offset += frames;
    }
    return count > 0u ? sum / static_cast<double>(count) : 1.0;
  };

  const double input_dc = settledMean(0.7F, 0.0F);
  const double detuning_dc = settledMean(0.0F, 50.0F);
  std::printf("measured settled DC: input offset %.3e, +50 kHz detuning %.3e "
              "(gate |mean| < 0.001)\n",
              input_dc, detuning_dc);
  check(std::fabs(input_dc) < 0.001, "receiver output rejects a sustained input DC offset");
  check(std::fabs(detuning_dc) < 0.001, "receiver output rejects discriminator detuning DC");
}

// Section 11: the MPX peak controller guarantees max|m| <= 0.99, whose
// observable consequence is a bounded demodulated output even for full-scale
// square-wave and step drive at maximum Processing.
void testPeakControllerBoundedOutput() {
  KernelHarness harness(48000.0F, 2u);
  harness.seed(0x7e57ab1eu, 0x5eed5eedu);
  Params params = defaultParams();
  params.processing = 18.0F;
  harness.stage(params);
  float peak = 0.0F;
  bool all_finite = true;
  std::uint32_t absolute = 0u;
  for (std::uint32_t block = 0u; block < 96u; ++block) {
    std::vector<float> audio(2u * kMaximumFrames, 0.0F);
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame, ++absolute) {
      float sample;
      if (block < 32u) {
        sample = ((absolute / 600u) & 1u) == 0u ? 1.0F : -1.0F; // 40 Hz square
      } else if (block < 48u) {
        sample = 0.0F; // silence before the step
      } else {
        sample = 1.0F; // full-scale step
      }
      audio[frame] = sample;
      audio[kMaximumFrames + frame] = sample;
    }
    harness.process(audio, 2u, kMaximumFrames);
    if (!finite(audio)) {
      all_finite = false;
      break;
    }
    for (float sample : audio) {
      const float absolute_value = sample < 0.0F ? -sample : sample;
      peak = absolute_value > peak ? absolute_value : peak;
    }
  }
  std::printf("measured square/step output peak: %.3f (gate <= 2.0, finite)\n",
              static_cast<double>(peak));
  check(all_finite, "square and step drive stays finite at maximum Processing");
  check(peak <= 2.0F, "peak-controller-bounded modulation keeps the demodulated output bounded");
}

void testTortureCornerStability() {
  KernelHarness harness(44100.0F, 2u);
  harness.seed(0xdeadbeefu, 0x00c0ffeeu);
  Params corner = defaultParams();
  corner.processing = 18.0F;
  corner.signal = 0.0F;
  corner.tuning = 100.0F;
  corner.ifBand = 80.0F;
  corner.multipath = 100.0F;
  corner.pathDelay = 50.0F;
  corner.fading = 20.0F;
  corner.stereo = 1.0F;
  harness.stage(corner);
  bool all_finite = true;
  float peak = 0.0F;
  std::uint32_t absolute = 0u;
  for (std::uint32_t block = 0u; block < 128u; ++block) {
    if (block == 32u) {
      corner.tuning = -100.0F;
      corner.stereo = 0.0F;
      harness.stage(corner);
    } else if (block == 64u) {
      corner.tuning = 0.0F;
      corner.signal = 70.0F;
      corner.ifBand = 240.0F;
      harness.stage(corner);
    }
    std::vector<float> audio(2u * kMaximumFrames);
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame, ++absolute) {
      float sample;
      if (block < 32u) {
        sample = 1.0F; // sustained DC offset input
      } else if (block < 64u) {
        sample = ((absolute / 1100u) & 1u) == 0u ? 1.0F : -1.0F; // ~20 Hz square
      } else {
        sample = 0.0F; // silence after the storm
      }
      audio[frame] = sample;
      audio[kMaximumFrames + frame] = -sample;
    }
    harness.process(audio, 2u, kMaximumFrames);
    if (!finite(audio)) {
      all_finite = false;
      break;
    }
    for (float sample : audio) {
      const float absolute_value = sample < 0.0F ? -sample : sample;
      peak = absolute_value > peak ? absolute_value : peak;
    }
  }
  check(all_finite, "corner-parameter storm stays finite");
  check(peak <= 4.0F, "corner-parameter storm stays bounded");

  // Persistent-DC check: after returning to clean conditions and silence, the
  // trailing output must settle to the receiver noise floor with no DC ramp.
  Params clean = defaultParams();
  harness.stage(clean);
  double trailing_sum = 0.0;
  std::uint32_t trailing_count = 0u;
  for (std::uint32_t block = 0u; block < 128u; ++block) {
    std::vector<float> audio(2u * kMaximumFrames, 0.0F);
    harness.process(audio, 2u, kMaximumFrames);
    if (!finite(audio)) {
      all_finite = false;
      break;
    }
    if (block >= 96u) {
      for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame) {
        trailing_sum += static_cast<double>(audio[frame]);
        ++trailing_count;
      }
    }
  }
  const double trailing_dc =
      trailing_count > 0u ? trailing_sum / static_cast<double>(trailing_count) : 1.0;
  std::printf("measured post-storm trailing DC: %.3e (gate < 0.01)\n", trailing_dc);
  check(all_finite, "post-storm recovery stays finite");
  check(std::fabs(trailing_dc) < 0.01, "no persistent DC after the storm settles");
}

// Fixed per-rate latency report golden: the analytic resampler group delays
// plus the actual 15-sample peak-controller lookahead delay (the 16-slot ring
// reads the slot written 15 samples earlier).
void testReportedLatencyTable() {
  const std::array<std::pair<float, std::uint32_t>, 8u> expected = {{
      {44100.0F, 27u},
      {48000.0F, 27u},
      {88200.0F, 25u},
      {96000.0F, 24u},
      {176400.0F, 42u},
      {192000.0F, 39u},
      {352800.0F, 55u},
      {384000.0F, 51u},
  }};
  for (const auto &[rate, samples] : expected) {
    KernelHarness harness(rate, 2u);
    std::printf("reported latency at %.0f Hz: %u samples (golden %u)\n", static_cast<double>(rate),
                harness.latency(), samples);
    check(harness.latency() == samples, "reported latency matches the fixed per-rate golden");
  }
}

// Unit test of the production MPX peak controller (the real type from
// peak_controller.h, shared with kernel.cpp). Verifies the actual 15-sample
// impulse delay and the hard output ceiling that carries the section 5
// guarantee: with |L|,|R| <= ceiling, |m| = |0.45(L+R) + 0.45(L-R)c + 0.09p|
// <= 0.9 * ceiling + 0.09 <= 0.99.
void testPeakControllerUnit() {
  PeakController controller;
  controller.configure(192000.0);
  for (std::uint32_t index = 0u; index < 64u; ++index) {
    const float input = index == 0u ? 0.9F : 0.0F;
    const float output = controller.process(input);
    if (index == 15u) {
      check(output == 0.9F, "sub-threshold impulse emerges after exactly 15 samples at unity gain");
    } else {
      check(output == 0.0F, "peak controller stays silent outside the impulse slot");
    }
  }

  PeakController hostile;
  hostile.configure(192000.0);
  float highest = 0.0F;
  std::uint32_t state = 0x1234567u;
  for (std::uint32_t index = 0u; index < 20000u; ++index) {
    float input;
    if (index < 4000u) {
      input = (index & 1u) == 0u ? 1.5F : -1.5F;
    } else if (index < 8000u) {
      input = index < 6000u ? 2.0F : 0.0F;
    } else {
      state ^= state << 13u;
      state ^= state >> 17u;
      state ^= state << 5u;
      input = 4.0F * (static_cast<float>(state) / 4294967296.0F - 0.5F);
    }
    const float output = hostile.process(input);
    const float absolute = output < 0.0F ? -output : output;
    highest = absolute > highest ? absolute : highest;
  }
  std::printf("measured peak-controller ceiling: %.6f (gate <= 0.98)\n",
              static_cast<double>(highest));
  check(highest <= 0.980001F, "peak controller output never exceeds 0.98");
  check(0.9F * highest + 0.09F <= 0.99F,
        "MPX bound 0.9 * ceiling + 0.09 stays <= 0.99 (section 5 max|m|)");
}

// Section 6 smooth-tracking regression: parameter events (og/mx/bw/mp/dl and
// a continuous tn drag) must not create sample-to-sample discontinuities
// beyond a small multiple of the steady-tone slope. Guards against the former
// per-change IF state reset and instant target jumps.
void testParameterEventContinuity() {
  constexpr double sample_rate = 48000.0;
  constexpr double amplitude = 0.31622776601683794;
  KernelHarness harness(48000.0F, 2u);
  harness.seed(0x51e9c0deu, 0x00decadeu);
  Params params = defaultParams();
  harness.stage(params);

  std::uint32_t absolute = 0u;
  float previous = 0.0F;
  float previous2 = 0.0F;
  std::uint32_t history = 0u;
  // First difference (slope) catches hard jumps; the second difference
  // (curvature) additionally separates a smeared click from a legitimate
  // amplitude change. For gain-type events (pr) the de-emphasis/15 kHz-LPF
  // smearing keeps the instant-swap click's slope below 2.5x the post-event
  // tone slope, but its curvature exceeds the 1 kHz tone curvature many
  // times over, so the pr event is additionally gated on curvature.
  auto run = [&](std::uint32_t total) -> std::pair<double, double> {
    double max_diff = 0.0;
    double max_curve = 0.0;
    std::uint32_t processed = 0u;
    while (processed < total) {
      const std::uint32_t remaining = total - processed;
      const std::uint32_t frames = remaining < kMaximumFrames ? remaining : kMaximumFrames;
      std::vector<float> audio(2u * frames, 0.0F);
      for (std::uint32_t frame = 0u; frame < frames; ++frame) {
        const double phase = kTwoPi * 1000.0 * static_cast<double>(absolute + frame) / sample_rate;
        const float sample = static_cast<float>(amplitude * std::sin(phase));
        audio[frame] = sample;
        audio[frames + frame] = sample;
      }
      harness.process(audio, 2u, frames);
      for (std::uint32_t frame = 0u; frame < frames; ++frame) {
        if (history >= 1u) {
          const double diff = std::fabs(static_cast<double>(audio[frame]) - previous);
          max_diff = diff > max_diff ? diff : max_diff;
        }
        if (history >= 2u) {
          const double curve =
              std::fabs(static_cast<double>(audio[frame]) - 2.0 * static_cast<double>(previous) +
                        static_cast<double>(previous2));
          max_curve = curve > max_curve ? curve : max_curve;
        }
        previous2 = previous;
        previous = audio[frame];
        history = history < 2u ? history + 1u : history;
      }
      absolute += frames;
      processed += frames;
    }
    return {max_diff, max_curve};
  };

  run(24000u);
  const auto [baseline, baseline_curve] = run(4800u);
  const double gate = 2.5 * baseline;
  const double curve_gate = 2.5 * baseline_curve;
  std::printf("event continuity baseline max diff: %.5f (event gate %.5f), "
              "curvature %.5f (gate %.5f)\n",
              baseline, gate, baseline_curve, curve_gate);

  auto expectSmooth = [&](const char *label) -> std::pair<double, double> {
    harness.stage(params);
    const auto measured = run(4800u);
    std::printf("event continuity %s: max diff %.5f, curvature %.5f\n", label, measured.first,
                measured.second);
    check(measured.first <= gate, "parameter event stays free of discontinuities");
    return measured;
  };
  // A2-1: pr was the last continuous control applied instantly; the drive and
  // soft-clip amount now ramp with the 20 ms MPX-rate one-pole. A 9 dB step
  // nearly triples the transmitter drive while the limiter stays transparent
  // (0.331 * 2.82 = 0.93 < 0.98), so without the ramp the output jumps by the
  // momentary tone value. Detection requires three deliberate choices: the
  // event runs first (before og/mx shrink the wet path), it is shifted off
  // the shared cycle-boundary phase (a zero crossing, where an instant swap
  // is invisible) onto the tone peak by a quarter cycle plus full cycles, and
  // the metrics are read over a 2 ms onset window (96 samples = exactly two
  // cycles) before the ramped amplitude growth can mask the click. pr then
  // returns to 0 dB the same way so the remaining events see the original
  // levels and boundary phases (settle pads the section to 126 cycles).
  run(1212u);
  params.processing = 9.0F;
  harness.stage(params);
  const auto pr_up = run(96u);
  params.processing = 0.0F;
  harness.stage(params);
  const auto pr_down = run(96u);
  const auto pr_settle = run(4644u);
  std::printf("event continuity pr 0->9->0 dB: onset max diff %.5f / %.5f, "
              "curvature %.5f / %.5f, settle max diff %.5f\n",
              pr_up.first, pr_down.first, pr_up.second, pr_down.second, pr_settle.first);
  check(pr_up.first <= gate && pr_down.first <= gate && pr_settle.first <= gate,
        "pr steps stay free of discontinuities");
  check(pr_up.second <= curve_gate && pr_down.second <= curve_gate,
        "pr ramp keeps the drive steps free of click curvature");
  params.outputGain = -6.0F;
  expectSmooth("og -6 dB");
  params.mix = 40.0F;
  expectSmooth("mx 40 %");
  params.ifBand = 120.0F;
  expectSmooth("bw 120 kHz");
  params.multipath = 60.0F;
  params.pathDelay = 20.0F;
  expectSmooth("mp 60 % + dl 20 us");

  // Continuous tuning drag: a small tn step every 128-frame block, like a UI
  // drag. No IF/PLL state reset may run and no click may appear.
  double drag_max = 0.0;
  for (std::uint32_t stepIndex = 0u; stepIndex < 60u; ++stepIndex) {
    params.tuning += 0.5F;
    harness.stage(params);
    const double measured = run(128u).first;
    drag_max = measured > drag_max ? measured : drag_max;
  }
  const double drag_tail = run(4800u).first;
  drag_max = drag_tail > drag_max ? drag_tail : drag_max;
  std::printf("event continuity tn drag 0->30 kHz: max diff %.5f\n", drag_max);
  check(drag_max <= gate, "continuous tuning drag stays free of clicks and resets");
}

// Section 11 physical regression: stereo/mono noise penalty of 20 +/- 3 dB
// (silence input, st = 50 dBuV, forced Stereo vs forced Mono, same seed).
double silentNoiseFloorDb(float stereo_mode) {
  KernelHarness harness(48000.0F, 2u);
  harness.seed(0x00abcdefu, 0x12345678u);
  Params params = defaultParams();
  params.signal = 50.0F;
  params.stereo = stereo_mode;
  harness.stage(params);
  double sum = 0.0;
  double sum_squares = 0.0;
  std::uint32_t count = 0u;
  std::uint32_t absolute = 0u;
  constexpr std::uint32_t total = 96000u;
  while (absolute < total) {
    std::vector<float> audio(2u * kMaximumFrames, 0.0F);
    harness.process(audio, 2u, kMaximumFrames);
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame, ++absolute) {
      if (absolute < 24000u) {
        continue;
      }
      sum += static_cast<double>(audio[frame]);
      sum_squares += static_cast<double>(audio[frame]) * static_cast<double>(audio[frame]);
      ++count;
    }
  }
  const double mean = sum / static_cast<double>(count);
  const double variance = sum_squares / static_cast<double>(count) - mean * mean;
  return 10.0 * std::log10(variance > 1.0e-30 ? variance : 1.0e-30);
}

void testStereoMonoSnrDifference() {
  const double stereo_db = silentNoiseFloorDb(1.0F);
  const double mono_db = silentNoiseFloorDb(2.0F);
  const double difference = stereo_db - mono_db;
  std::printf("measured stereo/mono noise floors: %.2f / %.2f dBFS, diff %.2f dB "
              "(gate 20 +/- 3 dB)\n",
              stereo_db, mono_db, difference);
  check(difference >= 17.0 && difference <= 23.0,
        "stereo/mono SNR difference stays at 20 +/- 3 dB");
}

// Section 11 physical regression: FM threshold clicks accumulate on the
// telemetry counter below threshold CNR at every rate plan and stay absent on
// a clean carrier even at the extreme tuning offsets.
void testClickCounterTelemetry() {
  auto clicksAfterOneSecond = [](float sample_rate, float signal, float tuning,
                                 float input_amplitude) -> std::uint32_t {
    KernelHarness harness(sample_rate, 2u);
    harness.seed(0x13579bdfu, 0x2468ace0u);
    Params params = defaultParams();
    params.signal = signal;
    params.tuning = tuning;
    params.stereo = 2.0F;
    harness.stage(params);
    std::uint32_t frame = 0u;
    auto render = [&](std::uint32_t blocks) {
      for (std::uint32_t block = 0u; block < blocks; ++block) {
        std::vector<float> audio(2u * kMaximumFrames);
        for (std::uint32_t index = 0u; index < kMaximumFrames; ++index, ++frame) {
          const float input =
              static_cast<float>(static_cast<double>(input_amplitude) *
                                 std::sin(kTwoPi * 1000.0 * static_cast<double>(frame) /
                                          static_cast<double>(sample_rate)));
          audio[index] = input;
          audio[kMaximumFrames + index] = input;
        }
        harness.process(audio, 2u, kMaximumFrames);
      }
    };
    const std::uint32_t settle_blocks =
        (static_cast<std::uint32_t>(0.25F * sample_rate) + kMaximumFrames - 1u) / kMaximumFrames;
    const std::uint32_t measurement_blocks =
        (static_cast<std::uint32_t>(sample_rate) + kMaximumFrames - 1u) / kMaximumFrames;
    render(settle_blocks);
    const std::uint32_t before = harness.telemetryClickCount();
    render(measurement_blocks);
    return harness.telemetryClickCount() - before;
  };
  const std::uint32_t clean = clicksAfterOneSecond(96000.0F, 60.0F, 0.0F, 0.0F);
  const std::uint32_t weak = clicksAfterOneSecond(96000.0F, 0.0F, 0.0F, 0.0F);
  const std::uint32_t weak_44100 = clicksAfterOneSecond(44100.0F, 0.0F, 0.0F, 0.0F);
  const std::uint32_t positive_detune = clicksAfterOneSecond(96000.0F, 70.0F, 100.0F, 1.0F);
  const std::uint32_t negative_detune = clicksAfterOneSecond(96000.0F, 70.0F, -100.0F, 1.0F);
  std::printf("measured clicks in 1 s: clean(st=60) %u, weak(st=0) %u, "
              "weak(44.1 kHz) %u, strong(tn=+/-100 kHz) %u/%u\n",
              clean, weak, weak_44100, positive_detune, negative_detune);
  check(clean <= 1u, "clean carrier produces no threshold clicks");
  check(weak >= 5u, "below-threshold carrier produces frequent clicks");
  check(weak > clean, "click rate rises as CNR falls through the threshold");
  check(weak_44100 > 0u, "below-threshold carrier produces clicks at a 44.1 kHz host rate");
  check(positive_detune == 0u, "strong carrier at +100 kHz detune produces no false clicks");
  check(negative_detune == 0u, "strong carrier at -100 kHz detune produces no false clicks");
}

// A2-2 regression pinning: the demodulated FM noise must keep its triangular
// spectral shape. Historical real defect F-1 (the Kaiser-window polyphase
// shift bug) flattened this shape on rational resamplers with L >= 2; the
// 96 kHz host plan uses the 5/2 core->mpx decimator where F-1 occurred.
// Fixed seed, silence input, forced Mono, st = 50 dBuV: the 1/3-octave band
// levels 200 Hz .. 10 kHz are compared against the values measured on the
// current implementation, which passed the audited R0 gates (the R0-F1F2
// acceptance was +/- 3 dB vs the analytic reference; see
// tmp/dev/fm-radio-simulator/fm-radio-simulator-scratch/results/R0-F1F2-RESULT.md). This pins
// the existing shape against regressions; it is not a new quality gate.
void testDemodNoiseTriangularShape() {
  constexpr std::uint32_t settle = 48000u;
  constexpr std::uint32_t window = 32768u;
  constexpr double sample_rate = 96000.0;
  constexpr std::array<double, 18u> centers = {200.0,  250.0,  315.0,  400.0,  500.0,  630.0,
                                               800.0,  1000.0, 1250.0, 1600.0, 2000.0, 2500.0,
                                               3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0};
  // Reference band levels in dBFS, measured on the pinned implementation with
  // this exact seed / window / settle (provenance above). Regenerate by
  // reading the printed "measured demod-noise band" lines after an audited
  // intentional change.
  constexpr std::array<double, 18u> reference = {
      -142.45, -141.39, -135.23, -133.58, -130.28, -127.38, -123.60, -121.78, -119.25,
      -116.30, -113.83, -110.83, -108.83, -107.23, -105.18, -103.53, -102.43, -101.42};

  KernelHarness harness(96000.0F, 2u);
  harness.seed(0x0f1f2a2bu, 0x7a5e5eedu);
  Params params = defaultParams();
  params.signal = 50.0F;
  params.stereo = 2.0F; // forced Mono: pure demodulated-noise path
  harness.stage(params);

  std::vector<double> capture;
  capture.reserve(window);
  std::uint32_t absolute = 0u;
  while (capture.size() < window) {
    std::vector<float> audio(2u * kMaximumFrames, 0.0F);
    harness.process(audio, 2u, kMaximumFrames);
    for (std::uint32_t frame = 0u; frame < kMaximumFrames && capture.size() < window; ++frame) {
      if (absolute + frame >= settle) {
        capture.push_back(static_cast<double>(audio[frame]));
      }
    }
    absolute += kMaximumFrames;
  }

  std::vector<double> windowed(window);
  double window_sum = 0.0;
  for (std::uint32_t index = 0u; index < window; ++index) {
    const double hann = 0.5 - 0.5 * std::cos(kTwoPi * static_cast<double>(index) /
                                             static_cast<double>(window - 1u));
    windowed[index] = capture[index] * hann;
    window_sum += hann;
  }
  const double amplitude_scale = 2.0 / window_sum;
  const double bin_width = sample_rate / static_cast<double>(window);
  const double edge_ratio = std::pow(2.0, 1.0 / 6.0);
  bool shape_ok = true;
  for (std::size_t band = 0u; band < centers.size(); ++band) {
    const auto first_bin =
        static_cast<std::uint32_t>(std::ceil(centers[band] / edge_ratio / bin_width));
    const auto last_bin =
        static_cast<std::uint32_t>(std::floor(centers[band] * edge_ratio / bin_width));
    double band_power = 0.0;
    for (std::uint32_t bin = first_bin; bin <= last_bin; ++bin) {
      const double coefficient =
          2.0 * std::cos(kTwoPi * static_cast<double>(bin) / static_cast<double>(window));
      double s1 = 0.0;
      double s2 = 0.0;
      for (std::uint32_t index = 0u; index < window; ++index) {
        const double s0 = windowed[index] + coefficient * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      double power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
      if (power < 0.0) {
        power = 0.0;
      }
      // Single-sided sine-amplitude power per bin; summed over the band.
      band_power += 0.5 * power * amplitude_scale * amplitude_scale;
    }
    const double level_db = 10.0 * std::log10(band_power > 1.0e-30 ? band_power : 1.0e-30);
    const double deviation = level_db - reference[band];
    std::printf("measured demod-noise band %5.0f Hz: %7.2f dB (ref %7.2f, "
                "gate +/- 3 dB)\n",
                centers[band], level_db, reference[band]);
    if (deviation < -3.0 || deviation > 3.0) {
      shape_ok = false;
    }
  }
  check(shape_ok, "demodulated noise keeps the pinned triangular 1/3-octave shape");
}

// A2-3 regression pinning: numeric anchors of the Auto stereo blend CNR
// transition (historical real defect F-2, the CNR smoothstep blend). The
// extremes (st = 60 stereo, st = 0) are covered elsewhere; this pins the
// section 6.1 transition positions: st = 30 still essentially full stereo,
// st = 15 well into the mono transition, and the FM threshold click surge
// across st = 15 / 10 / 6. Bounds are the current implementation's measured
// values with tolerance (regression pinning, R0-audited behavior).
void testAutoBlendCnrTransition() {
  auto separationAt = [](float st) -> double {
    KernelHarness harness(48000.0F, 2u);
    harness.seed(0x5152f00du, 0x00c0ffeeu);
    Params params = defaultParams();
    params.signal = st; // sm stays Auto
    const ToneAnalysis tone = analyzeTone(harness, params, 48000.0, 1000.0, 0.31622776601683794,
                                          0.0, 72000u, 24000u, 1000.0);
    return 20.0 * std::log10(tone.leftMagnitude / (tone.rightMagnitude + 1.0e-12));
  };
  const double separation30 = separationAt(30.0F);
  const double separation15 = separationAt(15.0F);
  // Pinned from the current implementation: st=30 measured 47.72 dB (CNR
  // ~35.6 dB, smoothstep ~0.999 -> essentially full stereo), st=15 measured
  // 0.98 dB (CNR ~20.6 dB, smoothstep ~0.057 -> deep mono transition; matches
  // the R0 audit record "st15 sep 0.98 dB" in the plan section 15.10.4).
  std::printf("measured Auto-blend separation: st=30 %.2f dB (pin 44.0..51.5), "
              "st=15 %.2f dB (pin 0.0..2.5)\n",
              separation30, separation15);
  check(separation30 >= 44.0 && separation30 <= 51.5,
        "st=30 keeps essentially full stereo separation (pinned 47.72 dB)");
  check(separation15 >= 0.0 && separation15 <= 2.5,
        "st=15 sits well inside the mono transition (pinned 0.98 dB)");

  auto clicksAt = [](float st) -> std::uint32_t {
    KernelHarness harness(96000.0F, 2u);
    harness.seed(0x13579bdfu, 0x2468ace0u);
    Params params = defaultParams();
    params.signal = st; // sm stays Auto
    harness.stage(params);
    for (std::uint32_t block = 0u; block < 750u; ++block) {
      std::vector<float> audio(2u * kMaximumFrames, 0.0F);
      harness.process(audio, 2u, kMaximumFrames);
    }
    return harness.telemetryClickCount();
  };
  // FM threshold click surge, measured positions (1 s of silence at 96 kHz,
  // Auto blend, this seed): st=8..4 -> 0, st=3 -> 1, st=2 -> 5, st=1 -> 27,
  // st=0 -> 79 clicks. Pin one pre-surge point and three surge points with
  // tolerance bands around the measured counts, plus strict monotonicity.
  const std::uint32_t clicks6 = clicksAt(6.0F);
  const std::uint32_t clicks2 = clicksAt(2.0F);
  const std::uint32_t clicks1 = clicksAt(1.0F);
  const std::uint32_t clicks0 = clicksAt(0.0F);
  std::printf("measured Auto-blend clicks in 1 s: st=6 %u (pin <= 2), "
              "st=2 %u (pin 2..15), st=1 %u (pin 12..55), st=0 %u (pin 40..160)\n",
              clicks6, clicks2, clicks1, clicks0);
  check(clicks6 <= 2u, "st=6 stays out of the click surge (pinned 0)");
  check(clicks2 >= 2u && clicks2 <= 15u, "st=2 enters the click surge (pinned 5)");
  check(clicks1 >= 12u && clicks1 <= 55u, "st=1 climbs the click surge (pinned 27)");
  check(clicks0 >= 40u && clicks0 <= 160u, "st=0 reaches the deep click surge (pinned 79)");
  check(clicks6 < clicks2 && clicks2 < clicks1 && clicks1 < clicks0,
        "click rate rises monotonically through the threshold surge");
}

// Section 11 band-edge response golden: 30 Hz and 15 kHz within +/- 0.5 dB of
// the 1 kHz gain (-30 dBFS stereo drive, Processing 0 dB, 96 kHz).
void testBandEdgeResponseGolden() {
  constexpr double sample_rate = 96000.0;
  constexpr std::uint32_t total_frames = 96000u;
  constexpr std::uint32_t analysis_start = 48000u;
  constexpr double amplitude = 0.03162277660168379;
  const std::array<double, 3u> frequencies = {30.0, 1000.0, 15000.0};
  std::array<double, 3u> magnitudes{};
  for (std::size_t index = 0u; index < frequencies.size(); ++index) {
    KernelHarness harness(96000.0F, 2u);
    harness.seed(0x600df00du, 0x0b105f00u);
    Params params = defaultParams();
    const ToneAnalysis tone =
        analyzeTone(harness, params, sample_rate, frequencies[index], amplitude, amplitude,
                    total_frames, analysis_start, frequencies[index]);
    magnitudes[index] = tone.leftMagnitude;
  }
  check(magnitudes[1] > 0.005, "band-edge probe produces a measurable 1 kHz tone");
  for (std::size_t index = 0u; index < frequencies.size(); ++index) {
    const double relative_db = 20.0 * std::log10(magnitudes[index] / magnitudes[1]);
    std::printf("measured band-edge response %.0f Hz: %+.3f dB re 1 kHz "
                "(gate +/- 0.5 dB)\n",
                frequencies[index], relative_db);
    check(relative_db >= -0.5 && relative_db <= 0.5,
          "band-edge response stays within +/- 0.5 dB of 1 kHz");
  }
}

// Section 11 spurious regression at one program-realistic template point:
// a bin-aligned ~7 kHz tone at the template level (-10 dB below 5 kHz,
// -30 dB above 10 kHz, log-interpolated between) must keep the worst
// non-harmonic in-band component at or below -40 dBc.
void testProgramTemplateSpurious() {
  constexpr double sample_rate = 96000.0;
  constexpr std::uint32_t window = 16384u;
  constexpr std::uint32_t settle = 48000u;
  constexpr std::uint32_t fundamental_bin = 1195u;
  const double bin_width = sample_rate / static_cast<double>(window);
  const double tone_hz = static_cast<double>(fundamental_bin) * bin_width;
  const double level_db = -10.0 - 20.0 * (std::log(tone_hz / 5000.0) / std::log(2.0));
  const double amplitude = std::pow(10.0, level_db / 20.0);

  KernelHarness harness(96000.0F, 2u);
  harness.seed(0x7357da7au, 0x5eed1234u);
  Params params = defaultParams();
  harness.stage(params);
  std::vector<double> capture;
  capture.reserve(window);
  std::uint32_t absolute = 0u;
  constexpr std::uint32_t total = settle + window;
  while (absolute < total) {
    const std::uint32_t remaining = total - absolute;
    const std::uint32_t frames = remaining < kMaximumFrames ? remaining : kMaximumFrames;
    std::vector<float> audio(2u * frames, 0.0F);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double phase = kTwoPi * tone_hz * static_cast<double>(absolute + frame) / sample_rate;
      const float sample = static_cast<float>(amplitude * std::sin(phase));
      audio[frame] = sample;
      audio[frames + frame] = sample;
    }
    harness.process(audio, 2u, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      if (absolute + frame >= settle) {
        capture.push_back(static_cast<double>(audio[frame]));
      }
    }
    absolute += frames;
  }

  std::vector<double> windowed(window);
  for (std::uint32_t index = 0u; index < window; ++index) {
    const double hann = 0.5 - 0.5 * std::cos(kTwoPi * static_cast<double>(index) /
                                             static_cast<double>(window - 1u));
    windowed[index] = capture[index] * hann;
  }
  auto goertzel = [&windowed](std::uint32_t bin) -> double {
    const double coefficient =
        2.0 * std::cos(kTwoPi * static_cast<double>(bin) / static_cast<double>(window));
    double s1 = 0.0;
    double s2 = 0.0;
    for (std::uint32_t index = 0u; index < window; ++index) {
      const double s0 = windowed[index] + coefficient * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const double power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
    return power > 0.0 ? std::sqrt(power) : 0.0;
  };

  const double fundamental = goertzel(fundamental_bin);
  check(fundamental > 0.0, "template probe produces a measurable fundamental");
  const auto first_bin = static_cast<std::uint32_t>(std::ceil(30.0 / bin_width));
  const auto last_bin = static_cast<std::uint32_t>(std::floor(15000.0 / bin_width));
  double worst = 0.0;
  std::uint32_t worst_bin = 0u;
  for (std::uint32_t bin = first_bin; bin <= last_bin; ++bin) {
    bool excluded = bin <= 3u;
    for (std::uint32_t harmonic = fundamental_bin; harmonic <= last_bin + 4u;
         harmonic += fundamental_bin) {
      const std::uint32_t distance = bin > harmonic ? bin - harmonic : harmonic - bin;
      if (distance <= 4u) {
        excluded = true;
        break;
      }
    }
    if (excluded) {
      continue;
    }
    const double magnitude = goertzel(bin);
    if (magnitude > worst) {
      worst = magnitude;
      worst_bin = bin;
    }
  }
  const double worst_dbc = 20.0 * std::log10((worst + 1.0e-30) / fundamental);
  std::printf("measured template spurious: worst %.2f dBc at %.0f Hz "
              "(gate <= -40 dBc)\n",
              worst_dbc, static_cast<double>(worst_bin) * bin_width);
  check(worst_dbc <= -40.0, "worst non-harmonic in-band component stays at or below -40 dBc");
}

// Section 11 PLL recovery smoke: after a dead-carrier, full-detune parameter
// storm, returning to clean defaults must re-lock the pilot PLL and restore
// stereo separation.
void testPllRecoverySmoke() {
  KernelHarness harness(48000.0F, 2u);
  harness.seed(0xfee1600du, 0x0c0ffee0u);
  Params storm = defaultParams();
  storm.processing = 18.0F;
  storm.signal = 0.0F;
  storm.tuning = 100.0F;
  storm.ifBand = 80.0F;
  storm.multipath = 100.0F;
  storm.pathDelay = 50.0F;
  storm.fading = 20.0F;
  storm.stereo = 1.0F;
  harness.stage(storm);
  std::uint32_t absolute = 0u;
  for (std::uint32_t block = 0u; block < 375u; ++block) {
    std::vector<float> audio(2u * kMaximumFrames);
    for (std::uint32_t frame = 0u; frame < kMaximumFrames; ++frame, ++absolute) {
      const float sample = ((absolute / 1200u) & 1u) == 0u ? 1.0F : -1.0F;
      audio[frame] = sample;
      audio[kMaximumFrames + frame] = -sample;
    }
    harness.process(audio, 2u, kMaximumFrames);
  }

  const Params clean = defaultParams();
  const ToneAnalysis tone = analyzeTone(harness, clean, 48000.0, 1000.0, 0.31622776601683794, 0.0,
                                        72000u, 48000u, 1000.0);
  const double separation_db =
      20.0 * std::log10(tone.leftMagnitude / (tone.rightMagnitude + 1.0e-12));
  std::printf("measured post-storm separation: %.2f dB (gate >= 40 dB)\n", separation_db);
  check(tone.leftMagnitude > 0.05, "post-storm probe produces a driven channel");
  check(separation_db >= 40.0, "PLL recovers full stereo separation after the storm");
}

// U-4 regression: with all-default parameters (Processing 0 dB, Output 0 dB,
// Mix 100 %) the wet path must be loudness-neutral against the dry input
// within 0.5 dB for band-limited pink noise and a music-like multitone.
struct TestBiquad {
  double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0;
  double s1 = 0.0, s2 = 0.0;

  void lowPass(double frequency, double q, double sample_rate) noexcept {
    const double omega = kTwoPi * frequency / sample_rate;
    const double cosine = std::cos(omega);
    const double alpha = std::sin(omega) / (2.0 * q);
    const double inverse_a0 = 1.0 / (1.0 + alpha);
    b0 = 0.5 * (1.0 - cosine) * inverse_a0;
    b1 = (1.0 - cosine) * inverse_a0;
    b2 = b0;
    a1 = -2.0 * cosine * inverse_a0;
    a2 = (1.0 - alpha) * inverse_a0;
  }

  void highPass(double frequency, double q, double sample_rate) noexcept {
    const double omega = kTwoPi * frequency / sample_rate;
    const double cosine = std::cos(omega);
    const double alpha = std::sin(omega) / (2.0 * q);
    const double inverse_a0 = 1.0 / (1.0 + alpha);
    b0 = 0.5 * (1.0 + cosine) * inverse_a0;
    b1 = -(1.0 + cosine) * inverse_a0;
    b2 = b0;
    a1 = -2.0 * cosine * inverse_a0;
    a2 = (1.0 - alpha) * inverse_a0;
  }

  double process(double input) noexcept {
    const double output = b0 * input + s1;
    s1 = b1 * input - a1 * output + s2;
    s2 = b2 * input - a2 * output;
    return output;
  }
};

std::vector<float> makePinkSource(std::uint32_t frames) {
  std::vector<float> source(frames);
  std::uint32_t state = 0x2468abcdu;
  double b0 = 0.0, b1 = 0.0, b2 = 0.0, b3 = 0.0, b4 = 0.0, b5 = 0.0, b6 = 0.0;
  TestBiquad lp1;
  TestBiquad lp2;
  TestBiquad hp;
  lp1.lowPass(14000.0, 0.54119610, 48000.0);
  lp2.lowPass(14000.0, 1.30656296, 48000.0);
  hp.highPass(30.0, 0.70710678, 48000.0);
  double sum_squares = 0.0;
  for (std::uint32_t index = 0u; index < frames; ++index) {
    state ^= state << 13u;
    state ^= state >> 17u;
    state ^= state << 5u;
    const double white = static_cast<double>(state) / 2147483648.0 - 1.0;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const double pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    const double band_limited = hp.process(lp2.process(lp1.process(pink)));
    source[index] = static_cast<float>(band_limited);
    sum_squares += band_limited * band_limited;
  }
  const double rms = std::sqrt(sum_squares / static_cast<double>(frames));
  const float scale = static_cast<float>(0.1 / (rms > 1.0e-12 ? rms : 1.0));
  for (float &sample : source) {
    sample *= scale;
  }
  return source;
}

std::vector<float> makeMusicSource(std::uint32_t frames) {
  std::vector<float> source(frames);
  const std::array<double, 7u> tones = {110.0, 220.0, 440.0, 880.0, 1760.0, 3520.0, 7040.0};
  double sum_squares = 0.0;
  for (std::uint32_t index = 0u; index < frames; ++index) {
    const double seconds = static_cast<double>(index) / 48000.0;
    double sample = 0.0;
    for (std::size_t tone = 0u; tone < tones.size(); ++tone) {
      const double level = std::pow(2.0, -0.5 * static_cast<double>(tone));
      sample += level * std::sin(kTwoPi * tones[tone] * seconds + 0.7 * static_cast<double>(tone));
    }
    sample *= 0.7 + 0.3 * std::sin(kTwoPi * 1.3 * seconds);
    source[index] = static_cast<float>(sample);
    sum_squares += sample * sample;
  }
  const double rms = std::sqrt(sum_squares / static_cast<double>(frames));
  const float scale = static_cast<float>(0.1 / (rms > 1.0e-12 ? rms : 1.0));
  for (float &sample : source) {
    sample *= scale;
  }
  return source;
}

double loudnessDeltaDb(const std::vector<float> &source, float processing) {
  KernelHarness harness(48000.0F, 2u);
  harness.seed(0x600dbeefu, 0x600dcafeu);
  Params params = defaultParams();
  params.processing = processing;
  harness.stage(params);
  double input_power = 0.0;
  double output_power = 0.0;
  std::uint32_t count = 0u;
  std::uint32_t absolute = 0u;
  const auto total = static_cast<std::uint32_t>(source.size());
  while (absolute < total) {
    const std::uint32_t remaining = total - absolute;
    const std::uint32_t frames = remaining < kMaximumFrames ? remaining : kMaximumFrames;
    std::vector<float> audio(2u * frames, 0.0F);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      audio[frame] = source[absolute + frame];
      audio[frames + frame] = source[absolute + frame];
    }
    harness.process(audio, 2u, frames);
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      if (absolute + frame < 24000u) {
        continue;
      }
      input_power += static_cast<double>(source[absolute + frame]) *
                     static_cast<double>(source[absolute + frame]);
      output_power += static_cast<double>(audio[frame]) * static_cast<double>(audio[frame]);
      ++count;
    }
    absolute += frames;
  }
  return 10.0 * std::log10((output_power + 1.0e-30) / (input_power + 1.0e-30));
}

void testDefaultLoudnessNeutrality() {
  constexpr std::uint32_t frames = 120000u;
  const std::vector<float> pink = makePinkSource(frames);
  const std::vector<float> music = makeMusicSource(frames);
  const double pink_delta = loudnessDeltaDb(pink, 0.0F);
  const double music_delta = loudnessDeltaDb(music, 0.0F);
  const double pink_legacy = loudnessDeltaDb(pink, 6.0F);
  const double music_legacy = loudnessDeltaDb(music, 6.0F);
  std::printf("measured default loudness delta: pink %+.3f dB, music %+.3f dB "
              "(gate +/- 0.5 dB; former pr=6 default: pink %+.3f dB, "
              "music %+.3f dB)\n",
              pink_delta, music_delta, pink_legacy, music_legacy);
  check(std::fabs(pink_delta) <= 0.5,
        "default parameters stay loudness-neutral on band-limited pink noise");
  check(std::fabs(music_delta) <= 0.5,
        "default parameters stay loudness-neutral on a music-like multitone");
}

} // namespace

int main() {
  testLatencyReportAndDryAlignment();
  testReportedLatencyTable();
  testPeakControllerUnit();
  testPairModeLeavesExtraChannelsUntouched();
  testResetOnlyReproducibility();
  testExplicitReseedReproducibility();
  testStereoSeparationGolden();
  testThdGolden();
  testMultipathThdRise();
  testFrequencyResponseGolden();
  testDcCut();
  testBandEdgeResponseGolden();
  testProgramTemplateSpurious();
  testStereoMonoSnrDifference();
  testClickCounterTelemetry();
  testDemodNoiseTriangularShape();
  testAutoBlendCnrTransition();
  testParameterEventContinuity();
  testPllRecoverySmoke();
  testDefaultLoudnessNeutrality();
  testPeakControllerBoundedOutput();
  testTortureCornerStability();
  if (failures != 0) {
    std::fprintf(stderr, "%d FM Radio Simulator native check(s) failed\n", failures);
    return 1;
  }
  std::puts("All FM Radio Simulator lifecycle, parity-support, and broadcast-quality "
            "regression tests passed");
  return 0;
}
