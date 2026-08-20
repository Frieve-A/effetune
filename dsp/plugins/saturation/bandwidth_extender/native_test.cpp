#include "BandwidthExtenderPluginParams.h"
#include "allocation_guard.h"
#include "effetune/kernel.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const effetune::KernelDescriptor *
et_kernel_descriptor_BandwidthExtenderPlugin() noexcept;

namespace {

constexpr std::uint32_t kMaximumFrames = 257u;
constexpr std::size_t kKernelStorageBytes = 8192u;
constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kInverseSqrtTwo = 0.70710678118654752440084436210485;
using Params = effetune::generated::BandwidthExtenderPluginParams;

int failures = 0;

void check(bool condition, const char *message) noexcept {
  if (!condition) {
    std::fprintf(stderr, "Bandwidth Extender check failed: %s\n", message);
    ++failures;
  }
}

class KernelHarness final {
public:
  KernelHarness(float sample_rate, std::uint32_t channels) {
    descriptor_ = et_kernel_descriptor_BandwidthExtenderPlugin();
    check(descriptor_ != nullptr, "descriptor exists");
    if (descriptor_ == nullptr) {
      return;
    }
    check(descriptor_->objectSize <= storage_.size(), "kernel fits storage");
    check(descriptor_->paramsHash == Params::kHash, "parameter hash matches");
    kernel_ = descriptor_->construct(storage_.data());
    check(kernel_ != nullptr, "kernel constructs");
    if (kernel_ != nullptr) {
      kernel_->prepare({sample_rate, channels, kMaximumFrames});
      check(kernel_->preparedSuccessfully(), "kernel prepares");
      kernel_->setRandomSeed(0x12345678u, 0x9abcdef0u);
      kernel_->reset();
    }
  }

  ~KernelHarness() {
    if (kernel_ != nullptr) {
      descriptor_->destroy(kernel_);
    }
  }

  KernelHarness(const KernelHarness &) = delete;
  KernelHarness &operator=(const KernelHarness &) = delete;

  void stage(const Params &params) noexcept {
    if (kernel_ == nullptr) {
      return;
    }
    const et_status status =
        kernel_->stageParameters(&params.harmonicAmount, Params::kFloatCount, Params::kHash);
    check(status == ET_OK, "parameters stage");
    kernel_->applyPendingParameters();
  }

  void process(std::vector<float> &block, std::uint32_t channels, std::uint32_t frames) noexcept {
    effetune::allocation_guard::Scope allocation_scope;
    kernel_->process(block.data(), channels, frames, {0.0});
  }

  void reset() noexcept { kernel_->reset(); }

  [[nodiscard]] std::uint32_t latency() const noexcept {
    return kernel_ == nullptr ? 0u : kernel_->latencySamples();
  }

private:
  alignas(std::max_align_t) std::array<std::byte, kKernelStorageBytes> storage_{};
  const effetune::KernelDescriptor *descriptor_ = nullptr;
  effetune::PluginKernel *kernel_ = nullptr;
};

Params params(float harmonic_amount = 100.0F, float noise_amount = 100.0F, float cutoff_mode = 1.0F,
              float cutoff = 12000.0F) noexcept {
  return {harmonic_amount, noise_amount, cutoff_mode, cutoff};
}

std::vector<float> inputSignal(std::uint32_t frames, std::uint32_t channels, double sample_rate) {
  std::vector<float> audio(static_cast<std::size_t>(frames) * channels);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    const std::size_t offset = static_cast<std::size_t>(channel) * frames;
    const double channel_gain = channel == 0u ? 0.35 : 0.22;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double time = static_cast<double>(frame) / sample_rate;
      audio[offset + frame] =
          static_cast<float>(channel_gain * std::sin(2.0 * kPi * 5800.0 * time) +
                             0.12 * std::sin(2.0 * kPi * 7300.0 * time));
    }
  }
  return audio;
}

std::vector<float> render(KernelHarness &harness, const Params &parameters,
                          const std::vector<float> &input, std::uint32_t channels,
                          std::uint32_t frames, std::uint32_t block_size) {
  std::vector<float> output(input.size(), 0.0F);
  harness.stage(parameters);
  for (std::uint32_t start = 0u; start < frames;) {
    const std::uint32_t remaining = frames - start;
    const std::uint32_t count = remaining < block_size ? remaining : block_size;
    std::vector<float> block(static_cast<std::size_t>(count) * channels);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        block[static_cast<std::size_t>(channel) * count + frame] =
            input[static_cast<std::size_t>(channel) * frames + start + frame];
      }
    }
    harness.process(block, channels, count);
    for (std::uint32_t channel = 0u; channel < channels; ++channel) {
      for (std::uint32_t frame = 0u; frame < count; ++frame) {
        output[static_cast<std::size_t>(channel) * frames + start + frame] =
            block[static_cast<std::size_t>(channel) * count + frame];
      }
    }
    start += count;
  }
  return output;
}

bool finite(const std::vector<float> &audio) noexcept {
  for (const float sample : audio) {
    if (!std::isfinite(sample)) {
      return false;
    }
  }
  return true;
}

std::vector<float> difference(const std::vector<float> &wet, const std::vector<float> &dry) {
  std::vector<float> result(wet.size());
  for (std::size_t index = 0u; index < result.size(); ++index) {
    result[index] = wet[index] - dry[index];
  }
  return result;
}

double channelRms(const std::vector<float> &audio, std::uint32_t channels, std::uint32_t channel,
                  std::uint32_t start) noexcept {
  const std::uint32_t frames = static_cast<std::uint32_t>(audio.size() / channels);
  double energy = 0.0;
  for (std::uint32_t frame = start; frame < frames; ++frame) {
    const double sample = audio[static_cast<std::size_t>(channel) * frames + frame];
    energy += sample * sample;
  }
  return std::sqrt(energy / static_cast<double>(frames - start));
}

std::array<double, 2u> midSideRms(const std::vector<float> &audio, std::uint32_t start) noexcept {
  const std::uint32_t frames = static_cast<std::uint32_t>(audio.size() / 2u);
  double mid_energy = 0.0;
  double side_energy = 0.0;
  for (std::uint32_t frame = start; frame < frames; ++frame) {
    const double left = audio[frame];
    const double right = audio[frames + frame];
    const double mid = (left + right) * kInverseSqrtTwo;
    const double side = (left - right) * kInverseSqrtTwo;
    mid_energy += mid * mid;
    side_energy += side * side;
  }
  const double count = static_cast<double>(frames - start);
  return {std::sqrt(mid_energy / count), std::sqrt(side_energy / count)};
}

std::array<double, 2u> toneProjection(const std::vector<float> &audio, double sample_rate,
                                      double frequency, std::uint32_t start,
                                      std::uint32_t count) noexcept {
  double real = 0.0;
  double imaginary = 0.0;
  for (std::uint32_t offset = 0u; offset < count; ++offset) {
    const std::uint32_t frame = start + offset;
    const double phase = 2.0 * kPi * frequency * static_cast<double>(frame) / sample_rate;
    const double sample = audio[frame];
    real += sample * std::cos(phase);
    imaginary -= sample * std::sin(phase);
  }
  const double scale = 2.0 / static_cast<double>(count);
  return {real * scale, imaginary * scale};
}

double projectionMagnitude(const std::array<double, 2u> &projection) noexcept {
  return std::sqrt(projection[0] * projection[0] + projection[1] * projection[1]);
}

double averageBandPower(const std::vector<float> &audio, double sample_rate, double low_hz,
                        double high_hz, std::uint32_t start, std::uint32_t count) noexcept {
  constexpr std::uint32_t fft_size = 1024u;
  constexpr std::uint32_t hop_size = fft_size / 4u;
  const std::uint32_t first_bin =
      static_cast<std::uint32_t>(std::ceil(low_hz * fft_size / sample_rate));
  const std::uint32_t last_bin = static_cast<std::uint32_t>(high_hz * fft_size / sample_rate);
  double power = 0.0;
  std::uint32_t observations = 0u;
  for (std::uint32_t window_start = start;
       window_start + fft_size <= start + count && window_start + fft_size <= audio.size();
       window_start += hop_size) {
    for (std::uint32_t bin = first_bin; bin <= last_bin; ++bin) {
      double real = 0.0;
      double imaginary = 0.0;
      for (std::uint32_t index = 0u; index < fft_size; ++index) {
        const double window =
            0.5 - 0.5 * std::cos(2.0 * kPi * static_cast<double>(index) / fft_size);
        const double phase = 2.0 * kPi * static_cast<double>(bin * index) / fft_size;
        const double sample = audio[window_start + index] * window;
        real += sample * std::cos(phase);
        imaginary -= sample * std::sin(phase);
      }
      power += real * real + imaginary * imaginary;
      ++observations;
    }
  }
  return observations == 0u ? 0.0 : power / static_cast<double>(observations);
}

std::array<double, 2u> stereoComponentProjection(const std::vector<float> &audio,
                                                 double sample_rate, double frequency, bool side,
                                                 std::uint32_t start,
                                                 std::uint32_t count) noexcept {
  const std::uint32_t frames = static_cast<std::uint32_t>(audio.size() / 2u);
  double real = 0.0;
  double imaginary = 0.0;
  for (std::uint32_t offset = 0u; offset < count; ++offset) {
    const std::uint32_t frame = start + offset;
    const double phase = 2.0 * kPi * frequency * static_cast<double>(frame) / sample_rate;
    const double right_sign = side ? -1.0 : 1.0;
    const double component = (static_cast<double>(audio[frame]) +
                              right_sign * static_cast<double>(audio[frames + frame])) *
                             kInverseSqrtTwo;
    real += component * std::cos(phase);
    imaginary -= component * std::sin(phase);
  }
  const double scale = 2.0 / static_cast<double>(count);
  return {real * scale, imaginary * scale};
}

std::vector<float> harmonicTone(std::uint32_t frames, double sample_rate, double frequency) {
  std::vector<float> audio(frames);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    audio[frame] = static_cast<float>(
        0.35 * std::sin(2.0 * kPi * frequency * static_cast<double>(frame) / sample_rate + 0.37));
  }
  return audio;
}

enum class StereoReference { Mid, Side, Left, Right, LowCoherence };

std::vector<float> stereoReference(std::uint32_t frames, double sample_rate,
                                   StereoReference reference) {
  std::vector<float> audio(static_cast<std::size_t>(frames) * 2u);
  for (std::uint32_t frame = 0u; frame < frames; ++frame) {
    const double time = static_cast<double>(frame) / sample_rate;
    const double first = 0.24 * std::sin(2.0 * kPi * 8500.0 * time + 0.19) +
                         0.18 * std::sin(2.0 * kPi * 9300.0 * time - 0.41);
    double left = first;
    double right = first;
    if (reference == StereoReference::Side) {
      right = -first;
    } else if (reference == StereoReference::Left) {
      right = 0.0;
    } else if (reference == StereoReference::Right) {
      left = 0.0;
    } else if (reference == StereoReference::LowCoherence) {
      right = 0.24 * std::sin(2.0 * kPi * 8700.0 * time - 0.27) +
              0.18 * std::sin(2.0 * kPi * 9500.0 * time + 0.63);
    }
    audio[frame] = static_cast<float>(left);
    audio[frames + frame] = static_cast<float>(right);
  }
  return audio;
}

enum class DetectorCorpus { LowPass, Notch, Dark };

// transition_hz > 0 models a real anti-alias slope: the comb fades to -40 dB across the
// transition and keeps that residual floor above it instead of stopping outright.
std::vector<float> detectorCorpus(std::uint32_t frames, DetectorCorpus corpus,
                                  double sample_rate = 48000.0, double low_pass_hz = 13600.0,
                                  double transition_hz = 0.0) {
  constexpr double bin_hz = 48000.0 / 1024.0;
  const std::uint32_t last_bin = static_cast<std::uint32_t>(sample_rate * 0.48 / bin_hz);
  std::vector<float> audio(frames, 0.0F);
  for (std::uint32_t bin = 20u; bin <= last_bin; bin += 4u) {
    const double frequency = static_cast<double>(bin) * bin_hz;
    double low_pass_taper = 1.0;
    if (corpus == DetectorCorpus::LowPass && frequency >= low_pass_hz) {
      if (transition_hz <= 0.0) {
        continue;
      }
      const double excess = (frequency - low_pass_hz) / transition_hz;
      low_pass_taper = std::pow(10.0, -2.0 * (excess < 1.0 ? excess : 1.0));
    }
    if (corpus == DetectorCorpus::Notch && frequency >= 13000.0 && frequency <= 14800.0) {
      continue;
    }
    const double amplitude =
        low_pass_taper *
        (corpus == DetectorCorpus::Dark ? 0.015 * std::exp(-frequency / 4500.0) : 0.012);
    const double initial_phase = 2.0 * kPi * static_cast<double>((bin * 37u) % 101u) / 101.0;
    for (std::uint32_t frame = 0u; frame < frames; ++frame) {
      const double phase = 2.0 * kPi * frequency * static_cast<double>(frame) / sample_rate;
      audio[frame] += static_cast<float>(amplitude * std::sin(phase + initial_phase));
    }
  }
  return audio;
}

std::vector<float> fullBandNoise(std::uint32_t frames) {
  std::vector<float> audio(frames);
  std::uint32_t state = 0x61c88647u;
  for (float &sample : audio) {
    state ^= state << 13u;
    state ^= state >> 17u;
    state ^= state << 5u;
    sample = static_cast<float>(static_cast<double>(state) / 2147483648.0 - 1.0) * 0.08F;
  }
  return audio;
}

std::vector<float> ultrasonicDonor(std::uint32_t frames, std::uint32_t channels,
                                   double sample_rate) {
  std::vector<float> audio(static_cast<std::size_t>(frames) * channels, 0.0F);
  for (std::uint32_t channel = 0u; channel < channels; ++channel) {
    const std::size_t offset = static_cast<std::size_t>(channel) * frames;
    const double gain = channel == 0u ? 1.0 : 0.72;
    const double phase_offset = channel == 0u ? 0.0 : 0.31;
    for (double frequency = 7000.0; frequency <= 15500.0; frequency += 375.0) {
      const double initial_phase =
          2.0 * kPi * static_cast<double>(static_cast<std::uint32_t>(frequency) % 257u) / 257.0;
      for (std::uint32_t frame = 0u; frame < frames; ++frame) {
        const double phase = 2.0 * kPi * frequency * static_cast<double>(frame) / sample_rate;
        audio[offset + frame] +=
            static_cast<float>(0.008 * gain * std::sin(phase + initial_phase + phase_offset));
      }
    }
  }
  return audio;
}

std::vector<float> firstChannel(const std::vector<float> &audio, std::uint32_t channels) {
  const std::size_t frames = audio.size() / channels;
  return {audio.begin(), audio.begin() + static_cast<std::ptrdiff_t>(frames)};
}

double autoGeneratedRms(const std::vector<float> &input) {
  const std::uint32_t frames = static_cast<std::uint32_t>(input.size());
  KernelHarness wet_harness(48000.0F, 1u);
  KernelHarness dry_harness(48000.0F, 1u);
  const Params automatic = params(100.0F, 100.0F, 0.0F, 16000.0F);
  const std::vector<float> wet = render(wet_harness, automatic, input, 1u, frames, 127u);
  const std::vector<float> dry =
      render(dry_harness, params(0.0F, 0.0F, 0.0F, 16000.0F), input, 1u, frames, 127u);
  return channelRms(difference(wet, dry), 1u, 0u, 6000u);
}

void testLatencyBySampleRate() {
  KernelHarness rate_44(44100.0F, 2u);
  KernelHarness rate_48(48000.0F, 2u);
  KernelHarness rate_96(96000.0F, 2u);
  KernelHarness rate_192(192000.0F, 2u);
  check(rate_44.latency() == 1024u, "44.1 kHz latency is 1024 samples");
  check(rate_48.latency() == 1024u, "48 kHz latency is 1024 samples");
  check(rate_96.latency() == 2048u, "96 kHz latency is 2048 samples");
  check(rate_192.latency() == 4096u, "192 kHz latency is 4096 samples");
}

void testAmountZeroIsDelayedDry() {
  constexpr std::uint32_t frames = 5003u;
  KernelHarness harness(48000.0F, 1u);
  std::vector<float> input(frames, 0.0F);
  input[0] = 1.0F;
  const std::vector<float> output = render(harness, params(0.0F, 0.0F), input, 1u, frames, 113u);
  check(output[harness.latency()] == 1.0F, "amount zero aligns dry impulse to latency");
  double other_energy = 0.0;
  for (std::uint32_t index = 0u; index < frames; ++index) {
    if (index != harness.latency()) {
      other_energy += static_cast<double>(output[index]) * output[index];
    }
  }
  check(other_energy == 0.0, "amount zero adds no wet output");
}

void testIndependentAmountsScaleClampAndAdd() {
  constexpr std::uint32_t frames = 20003u;
  constexpr std::uint32_t analysis_start = 6000u;
  const std::vector<float> input = detectorCorpus(frames, DetectorCorpus::LowPass);
  KernelHarness dry_harness(48000.0F, 1u);
  KernelHarness harmonic_harness(48000.0F, 1u);
  KernelHarness harmonic_doubled_harness(48000.0F, 1u);
  KernelHarness harmonic_high_clamp_harness(48000.0F, 1u);
  KernelHarness harmonic_low_clamp_harness(48000.0F, 1u);
  KernelHarness noise_harness(48000.0F, 1u);
  KernelHarness noise_doubled_harness(48000.0F, 1u);
  KernelHarness noise_high_clamp_harness(48000.0F, 1u);
  KernelHarness noise_low_clamp_harness(48000.0F, 1u);
  KernelHarness combined_harness(48000.0F, 1u);
  const std::vector<float> dry =
      render(dry_harness, params(0.0F, 0.0F, 1.0F, 12000.0F), input, 1u, frames, 127u);
  const std::vector<float> harmonic =
      render(harmonic_harness, params(100.0F, 0.0F, 1.0F, 12000.0F), input, 1u, frames, 127u);
  const std::vector<float> harmonic_doubled = render(
      harmonic_doubled_harness, params(200.0F, 0.0F, 1.0F, 12000.0F), input, 1u, frames, 127u);
  const std::vector<float> harmonic_high_clamped = render(
      harmonic_high_clamp_harness, params(250.0F, 0.0F, 1.0F, 12000.0F), input, 1u, frames, 127u);
  const std::vector<float> harmonic_low_clamped = render(
      harmonic_low_clamp_harness, params(-20.0F, 0.0F, 1.0F, 12000.0F), input, 1u, frames, 127u);
  const std::vector<float> noise =
      render(noise_harness, params(0.0F, 100.0F, 1.0F, 12000.0F), input, 1u, frames, 127u);
  const std::vector<float> noise_doubled =
      render(noise_doubled_harness, params(0.0F, 200.0F, 1.0F, 12000.0F), input, 1u, frames, 127u);
  const std::vector<float> noise_high_clamped = render(
      noise_high_clamp_harness, params(0.0F, 250.0F, 1.0F, 12000.0F), input, 1u, frames, 127u);
  const std::vector<float> noise_low_clamped = render(
      noise_low_clamp_harness, params(0.0F, -20.0F, 1.0F, 12000.0F), input, 1u, frames, 127u);
  const std::vector<float> combined =
      render(combined_harness, params(100.0F, 100.0F, 1.0F, 12000.0F), input, 1u, frames, 127u);

  const double harmonic_rms = channelRms(difference(harmonic, dry), 1u, 0u, analysis_start);
  const double harmonic_doubled_rms =
      channelRms(difference(harmonic_doubled, dry), 1u, 0u, analysis_start);
  const double noise_rms = channelRms(difference(noise, dry), 1u, 0u, analysis_start);
  const double noise_doubled_rms =
      channelRms(difference(noise_doubled, dry), 1u, 0u, analysis_start);
  check(harmonic_rms > 1.0e-7, "Harmonic Amount 100 generates only harmonic content");
  check(noise_rms > 1.0e-7, "Noise Amount 100 generates only shaped noise");
  check(harmonic_doubled_rms > harmonic_rms * 1.9999 &&
            harmonic_doubled_rms < harmonic_rms * 2.0001,
        "Harmonic Amount 200 doubles only the harmonic component");
  check(noise_doubled_rms > noise_rms * 1.9999 && noise_doubled_rms < noise_rms * 2.0001,
        "Noise Amount 200 doubles only the noise component");
  check(harmonic_high_clamped == harmonic_doubled, "Harmonic Amount clamps above 200 percent");
  check(noise_high_clamped == noise_doubled, "Noise Amount clamps above 200 percent");
  check(harmonic_low_clamped == dry, "Harmonic Amount clamps below zero");
  check(noise_low_clamped == dry, "Noise Amount clamps below zero");
  double maximum_addition_error = 0.0;
  for (std::size_t index = 0u; index < combined.size(); ++index) {
    const double expected = static_cast<double>(harmonic[index]) +
                            static_cast<double>(noise[index]) - static_cast<double>(dry[index]);
    const double error = std::abs(static_cast<double>(combined[index]) - expected);
    if (error > maximum_addition_error) {
      maximum_addition_error = error;
    }
  }
  check(maximum_addition_error <= 2.0e-7,
        "Harmonic and Noise amounts add their independently smoothed components");
  check(finite(harmonic_doubled) && finite(noise_doubled) && finite(combined),
        "independent 200 percent component outputs remain finite");
}

void testSilenceAndFiniteOutput() {
  constexpr std::uint32_t frames = 10003u;
  KernelHarness silence_harness(192000.0F, 2u);
  const std::vector<float> silence(static_cast<std::size_t>(frames) * 2u, 0.0F);
  const std::vector<float> silent_output =
      render(silence_harness, params(0.0F, 100.0F, 1.0F, 6000.0F), silence, 2u, frames, 127u);
  check(silent_output == silence, "silence remains silent with Noise Amount enabled");

  KernelHarness signal_harness(48000.0F, 2u);
  const std::vector<float> input = inputSignal(frames, 2u, 48000.0);
  const std::vector<float> output =
      render(signal_harness, params(100.0F, 100.0F, 1.0F, 10000.0F), input, 2u, frames, 127u);
  check(finite(output), "finite input produces finite output");
}

void testBlockIndependenceAndResetReplay() {
  constexpr std::uint32_t frames = 12007u;
  const std::vector<float> input = inputSignal(frames, 2u, 48000.0);
  KernelHarness odd(48000.0F, 2u);
  KernelHarness one(48000.0F, 2u);
  const Params settings = params(82.0F, 82.0F, 1.0F, 11000.0F);
  const std::vector<float> odd_output = render(odd, settings, input, 2u, frames, 127u);
  const std::vector<float> one_output = render(one, settings, input, 2u, frames, 1u);
  check(odd_output == one_output, "output is independent of process block size");
  odd.reset();
  const std::vector<float> replay = render(odd, settings, input, 2u, frames, 65u);
  check(odd_output == replay, "reset reproduces detector, WOLA, and random state");

  KernelHarness dry(48000.0F, 2u);
  const std::vector<float> dry_output = render(dry, params(0.0F, 0.0F), input, 2u, frames, 127u);
  check(odd_output != dry_output, "both independent components generate high-band content");
}

void testHarmonicForwardMappingAndPhaseContinuity() {
  constexpr double sample_rate = 44100.0;
  constexpr std::uint32_t fft_size = 1024u;
  constexpr std::uint32_t source_bin = 209u;
  constexpr std::uint32_t frames = 19456u;
  constexpr std::uint32_t analysis_start = 8192u;
  constexpr std::uint32_t analysis_count = 8192u;
  const double source_frequency =
      static_cast<double>(source_bin) * sample_rate / static_cast<double>(fft_size);
  const double target_frequency = source_frequency * 2.0;
  const std::vector<float> input = harmonicTone(frames, sample_rate, source_frequency);
  const Params harmonic = params(100.0F, 0.0F, 1.0F, 10000.0F);

  KernelHarness odd(static_cast<float>(sample_rate), 1u);
  KernelHarness one(static_cast<float>(sample_rate), 1u);
  KernelHarness dry_harness(static_cast<float>(sample_rate), 1u);
  const std::vector<float> odd_output = render(odd, harmonic, input, 1u, frames, 127u);
  const std::vector<float> one_output = render(one, harmonic, input, 1u, frames, 1u);
  const std::vector<float> dry =
      render(dry_harness, params(0.0F, 0.0F, 1.0F, 10000.0F), input, 1u, frames, 127u);
  const std::vector<float> generated = difference(odd_output, dry);
  check(odd_output == one_output, "Harmonic phase propagation is block-size independent");
  odd.reset();
  const std::vector<float> replay = render(odd, harmonic, input, 1u, frames, 65u);
  check(odd_output == replay, "Harmonic donor and phase state replay after reset");

  const double target_magnitude = projectionMagnitude(
      toneProjection(generated, sample_rate, target_frequency, analysis_start, analysis_count));
  check(target_magnitude > 1.0e-4, "9 kHz tonal bin generates a measurable second harmonic");

  double mirror_magnitude = 0.0;
  constexpr std::array<std::uint32_t, 5u> old_mirror_bins{256u, 302u, 348u, 394u, 440u};
  for (const std::uint32_t bin : old_mirror_bins) {
    const double frequency = static_cast<double>(bin) * sample_rate / fft_size;
    const double magnitude = projectionMagnitude(
        toneProjection(generated, sample_rate, frequency, analysis_start, analysis_count));
    if (magnitude > mirror_magnitude) {
      mirror_magnitude = magnitude;
    }
  }
  check(mirror_magnitude < target_magnitude * 0.1,
        "Harmonic output does not repeat the reference band at 2 kHz intervals");

  double projection_real = 0.0;
  double projection_imaginary = 0.0;
  double projection_sum = 0.0;
  for (std::uint32_t start = analysis_start; start < analysis_start + analysis_count;
       start += fft_size / 4u) {
    const std::array<double, 2u> projection =
        toneProjection(generated, sample_rate, target_frequency, start, fft_size / 4u);
    projection_real += projection[0];
    projection_imaginary += projection[1];
    projection_sum += projectionMagnitude(projection);
  }
  const double coherent_sum =
      std::sqrt(projection_real * projection_real + projection_imaginary * projection_imaginary);
  check(coherent_sum > projection_sum * 0.95,
        "Harmonic target phase remains coherent across synthesis hops");
}

void testHarmonicDonorSearchAcrossCutoffsAndRates() {
  constexpr std::array<double, 4u> sample_rates{44100.0, 48000.0, 96000.0, 192000.0};
  constexpr std::array<double, 5u> cutoffs{12000.0, 14000.0, 16000.0, 18000.0, 20000.0};
  for (const double sample_rate : sample_rates) {
    const std::uint32_t fft_size = sample_rate <= 50000.0    ? 1024u
                                   : sample_rate <= 100000.0 ? 2048u
                                                             : 4096u;
    const double bin_hz = sample_rate / static_cast<double>(fft_size);
    const double ceiling_hz = 40000.0 < sample_rate * 0.46 ? 40000.0 : sample_rate * 0.46;
    const std::uint32_t ceiling_bin = static_cast<std::uint32_t>(ceiling_hz / bin_hz);
    const std::uint32_t frames = fft_size * 16u + 3u;
    const std::uint32_t analysis_start = fft_size * 6u;
    const std::uint32_t analysis_count = fft_size * 8u;
    for (const double cutoff : cutoffs) {
      const std::uint32_t cutoff_bin = static_cast<std::uint32_t>(std::ceil(cutoff / bin_hz));
      std::uint32_t target_bin = cutoff_bin + (ceiling_bin - cutoff_bin) / 2u;
      if ((target_bin & 1u) != 0u) {
        ++target_bin;
      }
      const std::uint32_t source_bin = target_bin / 2u;
      const double source_frequency = static_cast<double>(source_bin) * bin_hz;
      const double target_frequency = static_cast<double>(target_bin) * bin_hz;
      const std::vector<float> input = harmonicTone(frames, sample_rate, source_frequency);
      const Params harmonic = params(100.0F, 0.0F, 1.0F, static_cast<float>(cutoff));
      KernelHarness wet_harness(static_cast<float>(sample_rate), 1u);
      KernelHarness dry_harness(static_cast<float>(sample_rate), 1u);
      const std::vector<float> wet = render(wet_harness, harmonic, input, 1u, frames, 127u);
      const std::vector<float> dry =
          render(dry_harness, params(0.0F, 0.0F, 1.0F, static_cast<float>(cutoff)), input, 1u,
                 frames, 127u);
      const std::vector<float> generated = difference(wet, dry);
      const double target_magnitude = projectionMagnitude(
          toneProjection(generated, sample_rate, target_frequency, analysis_start, analysis_count));
      if (ceiling_hz - cutoff >= 500.0) {
        check(target_magnitude > 1.0e-6,
              "each usable cutoff and sample-rate family finds a valid harmonic donor");
      }
    }
  }
}

std::vector<float> renderNoiseReference(const std::vector<float> &input, std::uint32_t block_size) {
  constexpr std::uint32_t channels = 2u;
  const std::uint32_t frames = static_cast<std::uint32_t>(input.size() / channels);
  KernelHarness wet_harness(48000.0F, channels);
  KernelHarness dry_harness(48000.0F, channels);
  const std::vector<float> wet = render(wet_harness, params(0.0F, 100.0F, 1.0F, 10000.0F), input,
                                        channels, frames, block_size);
  const std::vector<float> dry =
      render(dry_harness, params(0.0F, 0.0F, 1.0F, 10000.0F), input, channels, frames, block_size);
  return difference(wet, dry);
}

std::vector<float> renderStereoHarmonicReference(const std::vector<float> &input,
                                                 std::uint32_t block_size) {
  constexpr std::uint32_t channels = 2u;
  const std::uint32_t frames = static_cast<std::uint32_t>(input.size() / channels);
  KernelHarness wet_harness(48000.0F, channels);
  KernelHarness dry_harness(48000.0F, channels);
  const std::vector<float> wet = render(wet_harness, params(100.0F, 0.0F, 1.0F, 10000.0F), input,
                                        channels, frames, block_size);
  const std::vector<float> dry =
      render(dry_harness, params(0.0F, 0.0F, 1.0F, 10000.0F), input, channels, frames, block_size);
  return difference(wet, dry);
}

void testStereoHarmonicSpatialRelationships() {
  constexpr std::uint32_t frames = 16003u;
  constexpr std::uint32_t analysis_start = 6000u;
  constexpr std::uint32_t projection_count = 8192u;
  constexpr double even_harmonic_frequency = 17000.0;
  const std::vector<float> mid_input = stereoReference(frames, 48000.0, StereoReference::Mid);
  const std::vector<float> mid_generated = renderStereoHarmonicReference(mid_input, 127u);
  const std::array<double, 2u> mid_rms = midSideRms(mid_generated, analysis_start);
  check(mid_rms[0] > 1.0e-7, "Mid reference generates Mid harmonic content");
  check(mid_rms[1] < mid_rms[0] * 1.0e-4,
        "Mid reference does not create material Side harmonic content");

  const std::vector<float> side_input = stereoReference(frames, 48000.0, StereoReference::Side);
  const std::vector<float> side_generated = renderStereoHarmonicReference(side_input, 127u);
  const std::array<double, 2u> side_rms = midSideRms(side_generated, analysis_start);
  check(side_rms[1] > 1.0e-7, "Side reference generates Side harmonic content");
  check(side_rms[0] < side_rms[1] * 1.0e-4, "Side reference does not fold even harmonics into Mid");
  const double side_even = projectionMagnitude(stereoComponentProjection(
      side_generated, 48000.0, even_harmonic_frequency, true, analysis_start, projection_count));
  const double mid_even = projectionMagnitude(stereoComponentProjection(
      side_generated, 48000.0, even_harmonic_frequency, false, analysis_start, projection_count));
  check(side_even > 1.0e-4 && mid_even < side_even * 1.0e-4,
        "the second harmonic of a Side tone remains Side");

  for (const StereoReference reference : {StereoReference::Left, StereoReference::Right}) {
    const std::vector<float> single_input = stereoReference(frames, 48000.0, reference);
    const std::vector<float> single_generated = renderStereoHarmonicReference(single_input, 127u);
    const double left_rms = channelRms(single_generated, 2u, 0u, analysis_start);
    const double right_rms = channelRms(single_generated, 2u, 1u, analysis_start);
    const double source_rms = reference == StereoReference::Left ? left_rms : right_rms;
    const double opposite_rms = reference == StereoReference::Left ? right_rms : left_rms;
    check(source_rms > 1.0e-7, "single-channel reference generates harmonic content");
    check(opposite_rms < source_rms * 1.0e-4,
          "single-channel harmonic content stays in its source channel");
  }

  const std::vector<float> low_coherence_input =
      stereoReference(frames, 48000.0, StereoReference::LowCoherence);
  const std::vector<float> low_coherence_generated =
      renderStereoHarmonicReference(low_coherence_input, 127u);
  const double low_left = channelRms(low_coherence_generated, 2u, 0u, analysis_start);
  const double low_right = channelRms(low_coherence_generated, 2u, 1u, analysis_start);
  check(low_left > 1.0e-7 && low_right > 1.0e-7,
        "low-coherence reference keeps harmonic energy in both channels");
  check(low_left < low_right * 2.0 && low_right < low_left * 2.0,
        "low-coherence harmonic synthesis keeps the stereo energy balance");
  const std::vector<float> side_odd = renderStereoHarmonicReference(side_input, 127u);
  const std::vector<float> side_one = renderStereoHarmonicReference(side_input, 1u);
  check(side_odd == side_one, "stereo Harmonic M/S tracking is block-size independent");
}

void testStereoNoiseSpatialRelationships() {
  constexpr std::uint32_t frames = 16003u;
  constexpr std::uint32_t analysis_start = 6000u;
  const std::vector<float> mid_input = stereoReference(frames, 48000.0, StereoReference::Mid);
  const std::vector<float> mid_generated = renderNoiseReference(mid_input, 127u);
  const std::array<double, 2u> mid_rms = midSideRms(mid_generated, analysis_start);
  check(mid_rms[0] > 1.0e-7, "in-phase reference generates Mid noise");
  check(mid_rms[1] < mid_rms[0] * 1.0e-4, "in-phase reference does not create material Side noise");

  const std::vector<float> side_input = stereoReference(frames, 48000.0, StereoReference::Side);
  const std::vector<float> side_generated = renderNoiseReference(side_input, 127u);
  const std::array<double, 2u> side_rms = midSideRms(side_generated, analysis_start);
  check(side_rms[1] > 1.0e-7, "Side-only reference generates Side noise");
  check(side_rms[0] < side_rms[1] * 1.0e-4,
        "Side-only reference does not collapse generated noise into Mid");
  const std::vector<float> side_one_frame = renderNoiseReference(side_input, 1u);
  check(side_generated == side_one_frame,
        "stereo Noise seed replay is independent of process block size");

  const std::vector<float> left_input = stereoReference(frames, 48000.0, StereoReference::Left);
  const std::vector<float> left_generated = renderNoiseReference(left_input, 127u);
  const double left_rms = channelRms(left_generated, 2u, 0u, analysis_start);
  const double right_rms = channelRms(left_generated, 2u, 1u, analysis_start);
  check(left_rms > 1.0e-7, "single-channel reference generates noise in its source channel");
  check(right_rms < left_rms * 1.0e-4,
        "single-channel reference does not rotate generated noise to the opposite channel");

  const std::vector<float> low_coherence_input =
      stereoReference(frames, 48000.0, StereoReference::LowCoherence);
  const std::vector<float> low_coherence_generated =
      renderNoiseReference(low_coherence_input, 127u);
  const double low_left = channelRms(low_coherence_generated, 2u, 0u, analysis_start);
  const double low_right = channelRms(low_coherence_generated, 2u, 1u, analysis_start);
  check(low_left > 1.0e-7 && low_right > 1.0e-7,
        "low-coherence reference keeps generated energy in both channels");
  check(low_left < low_right * 2.0 && low_right < low_left * 2.0,
        "low-coherence reference does not reverse the stereo energy balance");
}

void testAutoDetectorHighSideVeto() {
  constexpr std::uint32_t frames = 20003u;
  const double low_pass_generated =
      autoGeneratedRms(detectorCorpus(frames, DetectorCorpus::LowPass));
  const double notch_generated = autoGeneratedRms(detectorCorpus(frames, DetectorCorpus::Notch));
  const double noise_generated = autoGeneratedRms(fullBandNoise(frames));
  const double dark_generated = autoGeneratedRms(detectorCorpus(frames, DetectorCorpus::Dark));
  check(low_pass_generated > 1.0e-7, "Auto activates for a stable true low-pass boundary");
  check(notch_generated < 1.0e-10,
        "Auto vetoes a full-band notch when meaningful high-side energy returns");
  check(noise_generated < 1.0e-10, "Auto remains inactive for full-band noise");
  check(dark_generated < 1.0e-10, "Auto remains inactive for naturally dark full-band content");
}

void testAutoDetectorEngagesAtHighBoundaries() {
  constexpr std::uint32_t frames = 24007u;
  constexpr double sample_rate = 96000.0;
  constexpr std::uint32_t analysis_start = 10000u;
  constexpr std::uint32_t analysis_count = 12000u;
  struct Boundary {
    double hz;
    double transition_hz;
  };
  constexpr std::array<Boundary, 5u> boundaries{Boundary{20000.0, 0.0}, Boundary{22050.0, 0.0},
                                                Boundary{24000.0, 0.0}, Boundary{20000.0, 1500.0},
                                                Boundary{22050.0, 1500.0}};
  for (const Boundary &boundary : boundaries) {
    const std::vector<float> input = detectorCorpus(frames, DetectorCorpus::LowPass, sample_rate,
                                                    boundary.hz, boundary.transition_hz);
    KernelHarness wet_harness(static_cast<float>(sample_rate), 1u);
    KernelHarness dry_harness(static_cast<float>(sample_rate), 1u);
    const std::vector<float> wet =
        render(wet_harness, params(100.0F, 100.0F, 0.0F, 16000.0F), input, 1u, frames, 127u);
    const std::vector<float> dry =
        render(dry_harness, params(0.0F, 0.0F, 0.0F, 16000.0F), input, 1u, frames, 127u);
    const std::vector<float> generated = difference(wet, dry);
    const double top_hz = boundary.hz + boundary.transition_hz;
    const double source_band =
        averageBandPower(dry, sample_rate, boundary.hz - 3000.0, boundary.hz - 1000.0,
                         analysis_start, analysis_count);
    const double generated_band = averageBandPower(generated, sample_rate, top_hz + 1000.0,
                                                   top_hz + 6000.0, analysis_start, analysis_count);
    check(generated_band > source_band * 1.0e-4,
          "Auto engages for source boundaries at and above 20 kHz, brick wall or sloped");
    if (boundary.transition_hz > 0.0) {
      const double shoulder_band =
          averageBandPower(generated, sample_rate, boundary.hz + boundary.transition_hz * 0.5,
                           top_hz, analysis_start, analysis_count);
      check(shoulder_band > generated_band * 0.25,
            "Auto starts generation inside the roll-off shoulder, not above it");
    }
  }
}

void testNoiseEnvelopeAndCutoffContinuity() {
  constexpr std::uint32_t frames = 24003u;
  constexpr std::uint32_t analysis_start = 7000u;
  constexpr std::uint32_t analysis_count = 15000u;
  constexpr double cutoff = 13600.0;
  const std::vector<float> input = detectorCorpus(frames, DetectorCorpus::LowPass);

  KernelHarness wet_harness(48000.0F, 1u);
  KernelHarness dry_harness(48000.0F, 1u);
  const std::vector<float> wet = render(
      wet_harness, params(0.0F, 100.0F, 1.0F, static_cast<float>(cutoff)), input, 1u, frames, 127u);
  const std::vector<float> dry = render(
      dry_harness, params(0.0F, 0.0F, 1.0F, static_cast<float>(cutoff)), input, 1u, frames, 127u);
  const std::vector<float> generated = difference(wet, dry);
  const double below =
      averageBandPower(dry, 48000.0, 13000.0, 13500.0, analysis_start, analysis_count);
  const double boundary =
      averageBandPower(wet, 48000.0, 13700.0, 14200.0, analysis_start, analysis_count);
  const double generated_band =
      averageBandPower(generated, 48000.0, 14200.0, 16000.0, analysis_start, analysis_count);
  check(boundary > below * 0.25,
        "Noise synthesis avoids a material valley immediately above the cutoff");
  check(generated_band > below * 0.02,
        "Noise synthesis carries a useful envelope beyond the cutoff transition");
  check(generated_band < below * 8.0,
        "Noise synthesis allows useful overshoot but remains bounded by the observed envelope");
}

void testSampleRateDependentCeilingAndUltrasonicTaper() {
  constexpr std::array<double, 4u> sample_rates{44100.0, 48000.0, 96000.0, 192000.0};
  constexpr std::array<std::uint32_t, 2u> channel_counts{1u, 2u};
  for (const double sample_rate : sample_rates) {
    const std::uint32_t frames = static_cast<std::uint32_t>(sample_rate * 1.5) + 4096u;
    const std::uint32_t analysis_start = static_cast<std::uint32_t>(sample_rate * 0.45);
    const std::uint32_t analysis_count = static_cast<std::uint32_t>(sample_rate * 0.8);
    const double ceiling_hz = 40000.0 < sample_rate * 0.46 ? 40000.0 : sample_rate * 0.46;
    for (const std::uint32_t channels : channel_counts) {
      const std::vector<float> input = ultrasonicDonor(frames, channels, sample_rate);
      KernelHarness wet_harness(static_cast<float>(sample_rate), channels);
      KernelHarness dry_harness(static_cast<float>(sample_rate), channels);
      const std::vector<float> wet =
          render(wet_harness, params(0.0F, 100.0F, 1.0F, 16000.0F), input, channels, frames, 127u);
      const std::vector<float> dry =
          render(dry_harness, params(0.0F, 0.0F, 1.0F, 16000.0F), input, channels, frames, 127u);
      const std::vector<float> generated = firstChannel(difference(wet, dry), channels);
      const double band_18_to_20 = averageBandPower(generated, sample_rate, 18000.0, 20000.0,
                                                    analysis_start, analysis_count);
      check(band_18_to_20 > 1.0e-12,
            "each supported sample rate and channel shape generates a useful upper band");

      if (sample_rate >= 96000.0) {
        const double band_20_to_30 = averageBandPower(generated, sample_rate, 20000.0, 30000.0,
                                                      analysis_start, analysis_count);
        const double band_30_to_39 = averageBandPower(generated, sample_rate, 30000.0, 39000.0,
                                                      analysis_start, analysis_count);
        const double above_ceiling =
            averageBandPower(generated, sample_rate, 40500.0, sample_rate * 0.5 - 500.0,
                             analysis_start, analysis_count);
        check(band_20_to_30 > band_18_to_20 * 0.01,
              "96/192 kHz processing remains significant above 20 kHz");
        check(band_30_to_39 > band_20_to_30 * 0.01 && band_30_to_39 < band_20_to_30,
              "96/192 kHz ultrasonic output tapers across 20-30 and 30-39 kHz");
        check(above_ceiling < band_20_to_30 * 1.0e-5,
              "96/192 kHz output preserves the 40 kHz ceiling guard");
      } else {
        const double guard_low = ceiling_hz + 400.0;
        const double guard_high = sample_rate * 0.5 - 150.0;
        const double above_ceiling = averageBandPower(generated, sample_rate, guard_low, guard_high,
                                                      analysis_start, analysis_count);
        check(above_ceiling < band_18_to_20 * 1.0e-5,
              "44.1/48 kHz output does not alias into the Nyquist guard band");
      }
    }
  }
}

} // namespace

int main() {
  testLatencyBySampleRate();
  testAmountZeroIsDelayedDry();
  testIndependentAmountsScaleClampAndAdd();
  testSilenceAndFiniteOutput();
  testBlockIndependenceAndResetReplay();
  testHarmonicForwardMappingAndPhaseContinuity();
  testHarmonicDonorSearchAcrossCutoffsAndRates();
  testStereoHarmonicSpatialRelationships();
  testStereoNoiseSpatialRelationships();
  testAutoDetectorHighSideVeto();
  testAutoDetectorEngagesAtHighBoundaries();
  testNoiseEnvelopeAndCutoffContinuity();
  testSampleRateDependentCeilingAndUltrasonicTaper();
  return failures == 0 ? 0 : 1;
}
